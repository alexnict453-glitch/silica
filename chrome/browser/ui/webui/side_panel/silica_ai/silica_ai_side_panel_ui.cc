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

#include "base/task/thread_pool.h"
#include "base/files/file_util.h"
#include "base/path_service.h"
#include "base/process/launch.h"
#include "base/command_line.h"
#include "build/build_config.h"

#if BUILDFLAG(IS_WIN)
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#endif

namespace {

bool IsOllamaRunning() {
#if BUILDFLAG(IS_WIN)
  WSADATA wsaData;
  if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
    return false;
  }
  SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
#else
  int sock = socket(AF_INET, SOCK_STREAM, 0);
#endif

  if (sock < 0
#if BUILDFLAG(IS_WIN)
      || sock == INVALID_SOCKET
#endif
  ) {
#if BUILDFLAG(IS_WIN)
    WSACleanup();
#endif
    return false;
  }

  sockaddr_in addr;
  addr.sin_family = AF_INET;
  addr.sin_port = htons(11434);
#if BUILDFLAG(IS_WIN)
  inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
#else
  addr.sin_addr.s_addr = inet_addr("127.0.0.1");
#endif

  int result = connect(sock, (struct sockaddr*)&addr, sizeof(addr));

#if BUILDFLAG(IS_WIN)
  closesocket(sock);
  WSACleanup();
#else
  close(sock);
#endif

  return result == 0;
}

void CheckAndStartOllama() {
  if (IsOllamaRunning()) {
    return;
  }
#if BUILDFLAG(IS_WIN)
  base::FilePath local_app_data;
  if (base::PathService::Get(base::DIR_LOCAL_APP_DATA, &local_app_data)) {
    base::FilePath ollama_path = local_app_data.Append(FILE_PATH_LITERAL("Programs\\Ollama\\ollama.exe"));
    if (base::PathExists(ollama_path)) {
      base::LaunchOptions options;
      base::CommandLine cmd(ollama_path);
      base::LaunchProcess(cmd, options);
    }
  }
#endif
}

}  // namespace

SilicaAiSidePanelUIConfig::SilicaAiSidePanelUIConfig()
    : DefaultTopChromeWebUIConfig(content::kChromeUIScheme,
                                  chrome::kChromeUISilicaAiSidePanelHost) {}

SilicaAiSidePanelUI::SilicaAiSidePanelUI(content::WebUI* web_ui)
    : TopChromeWebUIController(web_ui) {
  base::ThreadPool::PostTask(
      FROM_HERE, {base::MayBlock(), base::TaskPriority::BEST_EFFORT},
      base::BindOnce(&CheckAndStartOllama));
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
