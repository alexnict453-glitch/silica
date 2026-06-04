// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/views/side_panel/silica_ai/silica_ai_side_panel_coordinator.h"

#include "base/functional/callback.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/side_panel/side_panel_entry.h"
#include "chrome/browser/ui/side_panel/side_panel_registry.h"
#include "chrome/browser/ui/views/side_panel/side_panel_web_ui_view.h"
#include "chrome/browser/ui/webui/side_panel/silica_ai/silica_ai_side_panel_ui.h"
#include "chrome/common/webui_url_constants.h"
#include "chrome/grit/generated_resources.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "url/gurl.h"

using SidePanelWebUIViewT_SilicaAiSidePanelUI =
    SidePanelWebUIViewT<SilicaAiSidePanelUI>;
BEGIN_TEMPLATE_METADATA(SidePanelWebUIViewT_SilicaAiSidePanelUI,
                        SidePanelWebUIViewT)
END_METADATA

DEFINE_USER_DATA(SilicaAiSidePanelCoordinator);

SilicaAiSidePanelCoordinator::SilicaAiSidePanelCoordinator(
    BrowserWindowInterface* browser)
    : browser_(browser),
      scoped_unowned_user_data_(browser->GetUnownedUserDataHost(), *this) {}

SilicaAiSidePanelCoordinator::~SilicaAiSidePanelCoordinator() = default;

// static
SilicaAiSidePanelCoordinator* SilicaAiSidePanelCoordinator::From(
    BrowserWindowInterface* interface) {
  return Get(interface->GetUnownedUserDataHost());
}

void SilicaAiSidePanelCoordinator::CreateAndRegisterEntry(
    SidePanelRegistry* global_registry) {
  global_registry->Register(std::make_unique<SidePanelEntry>(
      SidePanelEntry::Key(SidePanelEntry::Id::kSilicaAi),
      base::BindRepeating(&SilicaAiSidePanelCoordinator::CreateWebView,
                          base::Unretained(this)),
      /*default_content_width_callback=*/base::NullCallback()));
}

std::unique_ptr<views::View> SilicaAiSidePanelCoordinator::CreateWebView(
    SidePanelEntryScope& scope) {
  return std::make_unique<SidePanelWebUIViewT<SilicaAiSidePanelUI>>(
      scope, base::RepeatingClosure(), base::RepeatingClosure(),
      std::make_unique<WebUIContentsWrapperT<SilicaAiSidePanelUI>>(
          GURL(chrome::kChromeUISilicaAiSidePanelURL), browser_->GetProfile(),
          IDS_SILICA_AI_TITLE,
          /*esc_closes_ui=*/false));
}
