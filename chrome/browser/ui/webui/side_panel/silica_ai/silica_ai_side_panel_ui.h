// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_WEBUI_SIDE_PANEL_SILICA_AI_SILICA_AI_SIDE_PANEL_UI_H_
#define CHROME_BROWSER_UI_WEBUI_SIDE_PANEL_SILICA_AI_SILICA_AI_SIDE_PANEL_UI_H_

#include <string_view>

#include "chrome/browser/ui/webui/top_chrome/top_chrome_web_ui_controller.h"
#include "chrome/browser/ui/webui/top_chrome/top_chrome_webui_config.h"
#include "chrome/common/webui_url_constants.h"
#include "content/public/common/url_constants.h"

class SilicaAiSidePanelUI;

// WebUIConfig for the Silica AI side panel. Always available.
class SilicaAiSidePanelUIConfig
    : public DefaultTopChromeWebUIConfig<SilicaAiSidePanelUI> {
 public:
  SilicaAiSidePanelUIConfig();
};

// The Silica AI side panel WebUI. Data-source only: all logic runs in the
// front-end and talks to a local Ollama server over fetch().
class SilicaAiSidePanelUI : public TopChromeWebUIController {
 public:
  explicit SilicaAiSidePanelUI(content::WebUI* web_ui);
  SilicaAiSidePanelUI(const SilicaAiSidePanelUI&) = delete;
  SilicaAiSidePanelUI& operator=(const SilicaAiSidePanelUI&) = delete;
  ~SilicaAiSidePanelUI() override;

  static constexpr std::string_view GetWebUIName() {
    return "SilicaAiSidePanel";
  }

 private:
  WEB_UI_CONTROLLER_TYPE_DECL();
};

#endif  // CHROME_BROWSER_UI_WEBUI_SIDE_PANEL_SILICA_AI_SILICA_AI_SIDE_PANEL_UI_H_
