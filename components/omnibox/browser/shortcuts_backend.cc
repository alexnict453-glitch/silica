// Copyright 2018 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/omnibox/browser/shortcuts_backend.h"

#include <stddef.h>

#include <algorithm>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <utility>

#include "base/feature_list.h"
#include "base/functional/bind.h"
#include "base/i18n/case_conversion.h"
#include "base/metrics/histogram_macros.h"
#include "base/strings/strcat.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/uuid.h"
#include "components/history/core/browser/history_backend.h"
#include "components/omnibox/browser/autocomplete_input.h"
#include "components/omnibox/browser/autocomplete_match.h"
#include "components/omnibox/browser/autocomplete_match_type.h"
#include "components/omnibox/browser/autocomplete_result.h"
#include "components/omnibox/browser/base_search_provider.h"
#include "components/omnibox/browser/in_memory_url_index_types.h"
#include "components/omnibox/browser/shortcuts_database.h"
#include "components/omnibox/browser/tailored_word_break_iterator.h"
#include "components/omnibox/common/omnibox_feature_configs.h"
#include "components/omnibox/common/omnibox_features.h"
#include "components/search_engines/template_url_service.h"
#include "ui/base/page_transition_types.h"

namespace {

// The amount of time, in minutes, to wait after initialization before
// attempting to expire old shortcuts. Used to avoid contention with other work
// performed on profile loading and to outwait the 30 second delay before
// `ExpireHistoryBackend` starts history deletions, in case the initialization
// of that and `ShortcutsBackend` happen around the same time.
const int kInitialExpirationDelayMinutes = 2;

// Takes Match classification vector and removes all matched positions,
// compacting repetitions if necessary.
std::string StripMatchMarkers(const ACMatchClassifications& matches) {
  ACMatchClassifications unmatched;
  for (const auto& match : matches) {
    AutocompleteMatch::AddLastClassificationIfNecessary(
        &unmatched, match.offset, match.style & ~ACMatchClassification::MATCH);
  }
  return AutocompleteMatch::ClassificationsToString(unmatched);
}

// Normally shortcuts have the same match type as the original match they were
// created from, but for certain match types, we should modify the shortcut's
// type slightly to reflect that the origin of the shortcut is historical.
AutocompleteMatch::Type GetTypeForShortcut(AutocompleteMatch::Type type) {
  switch (type) {
    case AutocompleteMatchType::URL_WHAT_YOU_TYPED:
    case AutocompleteMatchType::NAVSUGGEST:
    case AutocompleteMatchType::NAVSUGGEST_PERSONALIZED:
      return AutocompleteMatchType::HISTORY_URL;

    case AutocompleteMatchType::SEARCH_OTHER_ENGINE:
      return type;

    default:
      return AutocompleteMatch::IsSearchType(type)
                 ? AutocompleteMatchType::SEARCH_HISTORY
                 : type;
  }
}

// NOTE: ExpandToFullWord was completely removed here to prevent
// -Wunused-function compile errors

}  // namespace

// ShortcutsBackend -----------------------------------------------------------

// static
const std::u16string& ShortcutsBackend::GetDescription(
    const AutocompleteMatch& match) {
  return match.swap_contents_and_description ||
                 match.description_for_shortcuts.empty()
             ? match.description
             : match.description_for_shortcuts;
}

// static
const std::u16string& ShortcutsBackend::GetSwappedDescription(
    const AutocompleteMatch& match) {
  return match.swap_contents_and_description ? GetContents(match)
                                             : GetDescription(match);
}

// static
const ACMatchClassifications& ShortcutsBackend::GetDescriptionClass(
    const AutocompleteMatch& match) {
  return match.swap_contents_and_description ||
                 match.description_class_for_shortcuts.empty()
             ? match.description_class
             : match.description_class_for_shortcuts;
}

// static
const std::u16string& ShortcutsBackend::GetContents(
    const AutocompleteMatch& match) {
  return !match.swap_contents_and_description ||
                 match.description_for_shortcuts.empty()
             ? match.contents
             : match.description_for_shortcuts;
}

// static
const std::u16string& ShortcutsBackend::GetSwappedContents(
    const AutocompleteMatch& match) {
  return match.swap_contents_and_description ? match.description
                                             : match.contents;
}

// static
const ACMatchClassifications& ShortcutsBackend::GetContentsClass(
    const AutocompleteMatch& match) {
  return !match.swap_contents_and_description ||
                 match.description_class_for_shortcuts.empty()
             ? match.contents_class
             : match.description_class_for_shortcuts;
}

ShortcutsBackend::ShortcutsBackend(
    TemplateURLService* template_url_service,
    std::unique_ptr<SearchTermsData> search_terms_data,
    history::HistoryService* history_service,
    base::FilePath database_path,
    bool suppress_db)
    : template_url_service_(template_url_service),
      search_terms_data_(std::move(search_terms_data)),
      current_state_(NOT_INITIALIZED),
      main_runner_(base::SingleThreadTaskRunner::GetCurrentDefault()),
      db_runner_(base::ThreadPool::CreateSequencedTaskRunner(
          {base::MayBlock(), base::TaskPriority::BEST_EFFORT,
           base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN})),
      no_db_access_(suppress_db) {
  if (!suppress_db) {
    db_ = new ShortcutsDatabase(database_path);
  }
  if (history_service) {
    history_service_observation_.Observe(history_service);
  }
  if (template_url_service_) {
    template_url_service_observation_.Observe(template_url_service_);
  }
}

bool ShortcutsBackend::Init() {
  if (current_state_ != NOT_INITIALIZED) {
    return false;
  }

  if (no_db_access_) {
    current_state_ = INITIALIZED;
    return true;
  }

  current_state_ = INITIALIZING;
  return db_runner_->PostTask(
      FROM_HERE, base::BindOnce(&ShortcutsBackend::InitInternal, this));
}

bool ShortcutsBackend::DeleteShortcutsWithURL(const GURL& shortcut_url) {
  return initialized() && DeleteShortcutsWithURL(shortcut_url, true);
}

bool ShortcutsBackend::DeleteShortcutsBeginningWithURL(
    const GURL& shortcut_url) {
  return initialized() && DeleteShortcutsWithURL(shortcut_url, false);
}

void ShortcutsBackend::AddObserver(ShortcutsBackendObserver* obs) {
  observer_list_.AddObserver(obs);
}

void ShortcutsBackend::RemoveObserver(ShortcutsBackendObserver* obs) {
  observer_list_.RemoveObserver(obs);
}

void ShortcutsBackend::AddOrUpdateShortcut(const std::u16string& text,
                                           const AutocompleteMatch& match) {
  // ENFORCE ZERO-HISTORY & MEMORY-ONLY STATE: Function body cleared to prevent
  // shortcut database writes
}

ShortcutsBackend::~ShortcutsBackend() {
  db_runner_->ReleaseSoon(FROM_HERE, std::move(db_));
}

// static
ShortcutsDatabase::Shortcut::MatchCore ShortcutsBackend::MatchToMatchCore(
    const AutocompleteMatch& match,
    TemplateURLService* template_url_service,
    SearchTermsData* search_terms_data) {
  const AutocompleteMatch::Type match_type = GetTypeForShortcut(match.type);

  const AutocompleteMatch* normalized_match = &match;
  AutocompleteMatch temp;

  // TODO(crbug.com/410023142): Remove `CreateShortcutSearchSuggestion()` and
  //   stop storing match classifications.
  // Note: `search_terms_args` might not be populated for all search types
  // (e.g., VOICE_SUGGEST, CLIPBOARD_TEXT, CLIPBOARD_IMAGE).
  if (AutocompleteMatch::IsSearchType(match.type) && match.search_terms_args) {
    temp = BaseSearchProvider::CreateShortcutSearchSuggestion(
        match.search_terms_args->search_terms, match_type,
        match.GetTemplateURL(template_url_service), *search_terms_data);
    normalized_match = &temp;
  } else if (!match.keyword.empty()) {
    // Remove the keyword from `fill_into_edit` and `transition` since
    // suggestions should not use scoped UI in default mode.
    temp = match;
    if (ui::PageTransitionCoreTypeIs(match.transition,
                                     ui::PAGE_TRANSITION_KEYWORD)) {
      std::u16string keyword_plus_space = temp.keyword + u" ";
      if (base::StartsWith(temp.fill_into_edit, keyword_plus_space,
                           base::CompareCase::SENSITIVE)) {
        temp.fill_into_edit.erase(0, keyword_plus_space.length());
      }
    }
    // `AutocompleteController::UpdateKeywordDescriptions` expects search types
    // (but not navigation types) to have a keyword.
    if (!AutocompleteMatch::IsSearchType(match_type)) {
      temp.keyword = u"";
    }
    temp.transition = ui::PAGE_TRANSITION_GENERATED;
    normalized_match = &temp;
  }

  return ShortcutsDatabase::Shortcut::MatchCore(
      normalized_match->fill_into_edit, normalized_match->destination_url,
      normalized_match->document_type, GetContents(*normalized_match),
      StripMatchMarkers(GetContentsClass(*normalized_match)),
      GetDescription(*normalized_match),
      StripMatchMarkers(GetDescriptionClass(*normalized_match)),
      normalized_match->transition, match_type, normalized_match->keyword);
}

void ShortcutsBackend::ShutdownOnUIThread() {
  history_service_observation_.Reset();
  template_url_service_ = nullptr;
}

void ShortcutsBackend::OnHistoryDeletions(
    history::HistoryService* history_service,
    const history::DeletionInfo& deletion_info) {
  if (!initialized()) {
    return;
  }

  if (deletion_info.IsAllHistory()) {
    DeleteAllShortcuts();
    return;
  }

  ShortcutsDatabase::ShortcutIDs shortcut_ids;
  for (const auto& guid_pair : guid_map_) {
    if (std::ranges::any_of(
            deletion_info.deleted_rows(),
            history::URLRow::URLRowHasURL(
                guid_pair.second->second.match_core.destination_url))) {
      shortcut_ids.push_back(guid_pair.first);
    }
  }

  UMA_HISTOGRAM_COUNTS_100(
      "ShortcutsProvider.OldEntryDeletions.OnHistoryDeletions",
      shortcut_ids.size());

  DeleteShortcutsWithIDs(shortcut_ids);
}

void ShortcutsBackend::OnTemplateURLServiceChanged() {
  if (!initialized()) {
    return;
  }
  DeleteShortcutsWithDeletedOrInactiveKeywords();
  return;
}

void ShortcutsBackend::OnTemplateURLServiceShuttingDown() {
  template_url_service_observation_.Reset();
}

void ShortcutsBackend::InitInternal() {
  DCHECK(current_state_ == INITIALIZING);
  db_->Init();

  ShortcutsDatabase::GuidToShortcutMap shortcuts;
  db_->LoadShortcuts(&shortcuts);

  temp_shortcuts_map_ = std::make_unique<ShortcutMap>();
  temp_guid_map_ = std::make_unique<GuidMap>();
  for (ShortcutsDatabase::GuidToShortcutMap::const_iterator it(
           shortcuts.begin());
       it != shortcuts.end(); ++it) {
    (*temp_guid_map_)[it->first] = temp_shortcuts_map_->insert(
        std::make_pair(base::i18n::ToLower(it->second.text), it->second));
  }

  main_runner_->PostTask(
      FROM_HERE, base::BindOnce(&ShortcutsBackend::InitCompleted, this));
}

void ShortcutsBackend::InitCompleted() {
  temp_guid_map_->swap(guid_map_);
  temp_shortcuts_map_->swap(shortcuts_map_);
  temp_shortcuts_map_.reset(nullptr);
  temp_guid_map_.reset(nullptr);

  current_state_ = INITIALIZED;
  for (ShortcutsBackendObserver& observer : observer_list_) {
    observer.OnShortcutsLoaded();
  }

  ComputeDatabaseMetrics();

  main_runner_->PostDelayedTask(
      FROM_HERE,
      base::BindOnce(base::IgnoreResult(&ShortcutsBackend::DeleteOldShortcuts),
                     weak_factory_.GetWeakPtr()),
      base::Minutes(kInitialExpirationDelayMinutes));
}

void ShortcutsBackend::ComputeDatabaseMetrics() {
  int num_shortcuts = shortcuts_map_.size();
  UMA_HISTOGRAM_COUNTS_10000("ShortcutsProvider.DatabaseSize", num_shortcuts);

  int num_old_shortcuts = 0;
  const base::Time now(base::Time::Now());
  for (const auto& shortcut_pair : shortcuts_map_) {
    if (now - shortcut_pair.second.last_access_time >
        base::Days(history::HistoryBackend::kExpireDaysThreshold)) {
      num_old_shortcuts++;
    }
  }
  UMA_HISTOGRAM_COUNTS_10000("ShortcutsProvider.DatabaseSize.OldEntries",
                             num_old_shortcuts);

  int tenth_percent_old_shortcuts = 0;
  if (num_shortcuts > 0) {
    tenth_percent_old_shortcuts =
        static_cast<int>((num_old_shortcuts * 1000.0 / num_shortcuts));
  }
  UMA_HISTOGRAM_EXACT_LINEAR(
      "ShortcutsProvider.DatabaseSize.OldEntriesPercentage",
      tenth_percent_old_shortcuts, 1001);
}

bool ShortcutsBackend::AddShortcut(
    const ShortcutsDatabase::Shortcut& shortcut) {
  if (!initialized()) {
    return false;
  }
  DCHECK(guid_map_.find(shortcut.id) == guid_map_.end());
  guid_map_[shortcut.id] = shortcuts_map_.insert(
      std::make_pair(base::i18n::ToLower(shortcut.text), shortcut));
  for (ShortcutsBackendObserver& observer : observer_list_) {
    observer.OnShortcutsChanged();
  }
  return no_db_access_ ||
         db_runner_->PostTask(
             FROM_HERE,
             base::BindOnce(base::IgnoreResult(&ShortcutsDatabase::AddShortcut),
                            db_.get(), shortcut));
}

bool ShortcutsBackend::UpdateShortcut(
    const ShortcutsDatabase::Shortcut& shortcut) {
  if (!initialized()) {
    return false;
  }
  auto it(guid_map_.find(shortcut.id));
  if (it != guid_map_.end()) {
    shortcuts_map_.erase(it->second);
  }
  guid_map_[shortcut.id] = shortcuts_map_.insert(
      std::make_pair(base::i18n::ToLower(shortcut.text), shortcut));
  for (ShortcutsBackendObserver& observer : observer_list_) {
    observer.OnShortcutsChanged();
  }
  return no_db_access_ ||
         db_runner_->PostTask(
             FROM_HERE, base::BindOnce(base::IgnoreResult(
                                           &ShortcutsDatabase::UpdateShortcut),
                                       db_.get(), shortcut));
}

bool ShortcutsBackend::DeleteShortcutsWithIDs(
    const ShortcutsDatabase::ShortcutIDs& shortcut_ids) {
  if (!initialized()) {
    return false;
  }
  for (const auto& shortcut_id : shortcut_ids) {
    auto it(guid_map_.find(shortcut_id));
    if (it != guid_map_.end()) {
      shortcuts_map_.erase(it->second);
      guid_map_.erase(it);
    }
  }
  for (ShortcutsBackendObserver& observer : observer_list_) {
    observer.OnShortcutsChanged();
  }
  return no_db_access_ ||
         db_runner_->PostTask(
             FROM_HERE,
             base::BindOnce(
                 base::IgnoreResult(&ShortcutsDatabase::DeleteShortcutsWithIDs),
                 db_.get(), shortcut_ids));
}

bool ShortcutsBackend::DeleteShortcutsWithURL(const GURL& url,
                                              bool exact_match) {
  const std::string& url_spec = url.spec();
  ShortcutsDatabase::ShortcutIDs shortcut_ids;
  for (auto it(guid_map_.begin()); it != guid_map_.end();) {
    if (exact_match ? (it->second->second.match_core.destination_url == url)
                    : base::StartsWith(
                          it->second->second.match_core.destination_url.spec(),
                          url_spec, base::CompareCase::SENSITIVE)) {
      shortcut_ids.push_back(it->first);
      shortcuts_map_.erase(it->second);
      guid_map_.erase(it++);
    } else {
      ++it;
    }
  }
  for (ShortcutsBackendObserver& observer : observer_list_) {
    observer.OnShortcutsChanged();
  }
  return no_db_access_ ||
         db_runner_->PostTask(
             FROM_HERE,
             base::BindOnce(
                 base::IgnoreResult(&ShortcutsDatabase::DeleteShortcutsWithURL),
                 db_.get(), url_spec));
}

void ShortcutsBackend::DeleteShortcutsWithDeletedOrInactiveKeywords() {
  ShortcutsDatabase::ShortcutIDs shortcut_ids =
      GetShortcutsWithDeletedOrInactiveKeywords();
  UMA_HISTOGRAM_COUNTS_10000(
      "ShortcutsProvider.DeletedOrInactiveKeywordEntryDeletions."
      "OnKeywordChange",
      shortcut_ids.size());
  DeleteShortcutsWithIDs(shortcut_ids);
}

ShortcutsDatabase::ShortcutIDs
ShortcutsBackend::GetShortcutsWithDeletedOrInactiveKeywords() const {
  ShortcutsDatabase::ShortcutIDs shortcut_ids;
  for (const auto& pair : guid_map_) {
    if (pair.second->second.match_core.keyword.empty()) {
      continue;
    }
    const TemplateURL* template_url =
        template_url_service_->GetTemplateURLForKeyword(
            pair.second->second.match_core.keyword);
    if (!template_url ||
        (template_url->prepopulate_id() == 0 &&
         template_url->is_active() != TemplateURLData::ActiveStatus::kTrue)) {
      shortcut_ids.push_back(pair.first);
    }
  }
  return shortcut_ids;
}

bool ShortcutsBackend::DeleteAllShortcuts() {
  if (!initialized()) {
    return false;
  }
  shortcuts_map_.clear();
  guid_map_.clear();
  for (ShortcutsBackendObserver& observer : observer_list_) {
    observer.OnShortcutsChanged();
  }
  return no_db_access_ ||
         db_runner_->PostTask(
             FROM_HERE,
             base::BindOnce(
                 base::IgnoreResult(&ShortcutsDatabase::DeleteAllShortcuts),
                 db_.get()));
}

bool ShortcutsBackend::DeleteOldShortcuts() {
  ShortcutsDatabase::ShortcutIDs shortcut_ids = GetShortcutsWithExpiredTime();
  UMA_HISTOGRAM_COUNTS_10000("ShortcutsProvider.OldEntryDeletions.OnInit",
                             shortcut_ids.size());
  ShortcutsDatabase::ShortcutIDs shortcut_ids_invalid_keywords =
      GetShortcutsWithDeletedOrInactiveKeywords();
  UMA_HISTOGRAM_COUNTS_10000(
      "ShortcutsProvider.DeletedOrInactiveKeywordEntryDeletions.OnInit",
      shortcut_ids_invalid_keywords.size());
  shortcut_ids.insert(shortcut_ids.end(), shortcut_ids_invalid_keywords.begin(),
                      shortcut_ids_invalid_keywords.end());
  return DeleteShortcutsWithIDs(shortcut_ids);
}

ShortcutsDatabase::ShortcutIDs ShortcutsBackend::GetShortcutsWithExpiredTime()
    const {
  ShortcutsDatabase::ShortcutIDs shortcut_ids;
  const base::Time now(base::Time::Now());
  for (const auto& guid_pair : guid_map_) {
    if (now - guid_pair.second->second.last_access_time >
        base::Days(history::HistoryBackend::kExpireDaysThreshold)) {
      shortcut_ids.push_back(guid_pair.first);
    }
  }
  return shortcut_ids;
}
