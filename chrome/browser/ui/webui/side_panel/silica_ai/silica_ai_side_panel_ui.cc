// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/webui/side_panel/silica_ai/silica_ai_side_panel_ui.h"

#include "chrome/browser/profiles/profile.h"
#include "chrome/grit/side_panel_silica_ai_resources.h"
#include "chrome/grit/side_panel_silica_ai_resources_map.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_data_source.h"
#include "services/network/public/mojom/content_security_policy.mojom.h"
#include "ui/webui/webui_util.h"

SilicaAiSidePanelUIConfig::SilicaAiSidePanelUIConfig()
    : DefaultTopChromeWebUIConfig(content::kChromeUIScheme,
                                  chrome::kChromeUISilicaAiSidePanelHost) {}

SilicaAiSidePanelUI::SilicaAiSidePanelUI(content::WebUI* web_ui)
    : TopChromeWebUIController(web_ui) {
  Profile* const profile = Profile::FromWebUI(web_ui);
  content::WebUIDataSource* source = content::WebUIDataSource::CreateAndAdd(
      profile, chrome::kChromeUISilicaAiSidePanelHost);

  webui::SetupWebUIDataSource(source, kSidePanelSilicaAiResources,
                              IDR_SIDE_PANEL_SILICA_AI_SILICA_AI_HTML);

  // Silica AI calls a local Ollama server, and falls back to the r.jina.ai
  // reader for web summaries. The default WebUI connect-src would block these.
  source->OverrideContentSecurityPolicy(
      network::mojom::CSPDirectiveName::ConnectSrc,
      "connect-src 'self' http://localhost:11434 http://127.0.0.1:11434 "
      "https:;");

  // The Markdown renderer assigns innerHTML; relax Trusted Types for this UI.
  source->DisableTrustedTypesCSP();
}

SilicaAiSidePanelUI::~SilicaAiSidePanelUI() = default;

WEB_UI_CONTROLLER_TYPE_IMPL(SilicaAiSidePanelUI)
