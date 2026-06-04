// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_VIEWS_SIDE_PANEL_SILICA_AI_SILICA_AI_SIDE_PANEL_COORDINATOR_H_
#define CHROME_BROWSER_UI_VIEWS_SIDE_PANEL_SILICA_AI_SILICA_AI_SIDE_PANEL_COORDINATOR_H_

#include <memory>

#include "base/memory/raw_ptr.h"
#include "ui/base/unowned_user_data/scoped_unowned_user_data.h"

class BrowserWindowInterface;
class SidePanelEntryScope;
class SidePanelRegistry;

namespace views {
class View;
}

// Creates and registers the global Silica AI SidePanelEntry, and builds its
// WebUI-backed view on demand.
class SilicaAiSidePanelCoordinator {
 public:
  explicit SilicaAiSidePanelCoordinator(BrowserWindowInterface* browser);
  ~SilicaAiSidePanelCoordinator();

  DECLARE_USER_DATA(SilicaAiSidePanelCoordinator);
  static SilicaAiSidePanelCoordinator* From(BrowserWindowInterface* interface);

  void CreateAndRegisterEntry(SidePanelRegistry* global_registry);

  std::unique_ptr<views::View> CreateWebView(SidePanelEntryScope& scope);

 private:
  raw_ptr<BrowserWindowInterface> browser_;

  ui::ScopedUnownedUserData<SilicaAiSidePanelCoordinator>
      scoped_unowned_user_data_;
};

#endif  // CHROME_BROWSER_UI_VIEWS_SIDE_PANEL_SILICA_AI_SILICA_AI_SIDE_PANEL_COORDINATOR_H_
