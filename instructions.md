# Instructions & Project Guidelines: Chromium-Based Browser

## 1. Project Overview
This repository contains a Chromium-based web browser. All code generation, refactoring, and debugging must align with the architectural patterns, security models, and performance standards of the Chromium project.

---

## 2. Architectural Guidelines & Constraints

### Multi-Process Architecture
Chromium is modular and operates across distinct security boundaries. When writing or modifying code, identify which process it runs in:
*   **Browser Process (UI/Privileged):** Handles the main window, UI, navigation, network requests, and coordination. Avoid running heavy computational or blocking tasks here.
*   **Renderer Process (Unprivileged/Sandboxed):** Handles Blink layout engine, V8 JavaScript, and DOM rendering. Assume this process can be compromised; never trust input from it.
*   **Network/Utility Processes:** Isolated helper processes.

### Threading and Concurrency
Chromium is strictly asynchronous and multi-threaded.
*   **Never block the UI Thread:** Long-running operations must be posted to background threads using `base::ThreadPool` or dedicated task runners.
*   **Sequence Safety:** Prefer sequences (`base::SequencedTaskRunner`) over raw locks (`base::Lock`) to prevent deadlocks.
*   **Callback Lifetimes:** Always use `base::BindOnce` or `base::BindRepeating` combined with weak pointers (`base::WeakPtrFactory`) to prevent "use-after-free" crashes when callbacks execute asynchronously.

---

## 3. Technology Stack & Coding Standards

### C++ Core Rules (If modifying Native Chromium/Blink)
*   **Memory Safety:** 
    *   Use `std::unique_ptr<T>` for exclusive ownership.
    *   Use `scoped_refptr<T>` for shared ownership (only when strictly necessary).
    *   Use `raw_ptr<T>` (MiraclePtr) instead of raw C-style pointers `T*` for class members to protect against Use-After-Free (UAF) vulnerabilities.
*   **String Formatting:** Use `std::string_view` for read-only string parameters. Avoid passing raw `const std::string&` if a view suffices.
*   **Base Library:** Always check if a helper exists in `base/` (e.g., `base::Value`, `base::Time`, `base::CommandLine`) before writing custom utility logic.

### Web & Frontend Rules (If modifying Browser UI, WebUI, or Extensions)
*   **WebUI Security:** When writing WebUI pages (`chrome://`), adhere to strict Content Security Policies (CSP). Never use `eval()` or inline scripts.
*   **V8 & Memory:** When writing JavaScript/TypeScript, write memory-efficient code to prevent memory leaks in long-lived renderer processes. Clean up event listeners.
*   **Chrome Extension APIs:** Utilize asynchronous `chrome.*` APIs. Prefer promise-based API calls over callback-based calls where supported.

---

## 4. Security & Sanitization [CRITICAL]
Chromium's security model is built on the **Principle of Least Privilege**:
*   **Inter-Process Communication (IPC):** Use Mojo for all IPC. Validate all incoming parameters from Mojo interfaces in the Browser process. Never assume data sent from the Renderer process is safe.
*   **Sanitization:** Sanitize all external strings, URLs, and file paths before processing them. Use Chromium's built-in URL parsing utilities (`GURL`).
*   **Origin Boundaries:** Respect Site Isolation. Never bypass or expose private cross-origin data across renderer boundaries.

---

## 5. Performance & Efficiency
Browsers must be fast and lightweight:
*   **Avoid Polling:** Prefer event-driven patterns, observers, and callbacks over polling or active-waiting loops.
*   **Allocation Overhead:** Minimize heap allocations in performance-critical paths (such as rendering, networking, or frame generation). Use move semantics (`std::move`) to avoid copying large structures.
*   **Lazy Initialization:** Initialize subsystems and services lazily (only when they are first needed) to keep startup time minimal.

---

## 6. AI Agent Interaction Rules
When answering questions or writing code for this repository, the AI must:
1.  **Declare process context:** State whether the generated code is intended for the Browser process, Renderer process, or an extension.
2.  **Ensure Thread-Safety:** Ensure all asynchronous patterns use Chromium-safe task posting and weak reference factories where applicable.
3.  **No Deprecated APIs:** Avoid using deprecated base APIs (e.g., avoid legacy Mojo bindings or deprecated `base::ListValue`).
4.  **Security First:** Highlight any potential security or IPC vulnerabilities when generating code that handles user input or network data.