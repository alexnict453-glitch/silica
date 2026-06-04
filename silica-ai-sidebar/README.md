# Silica AI — sidebar accessory

A local-AI studio that lives in the Silica **side panel**. It's a port of the
"Local AI Studio" desktop app into the browser. Everything runs on your own
machine through [Ollama](https://ollama.com) — nothing is sent to the cloud.

![brand](icons/icon48.png)

## Tools (9 tabs)

| Tab | What it does |
| --- | --- |
| 💬 Chat | Conversational chat with your local model. |
| 🌐 Summarize | Fetch any web page and produce a clean Markdown summary. |
| 📷 Translate | Extract & translate text from an image (needs a vision model). |
| 📚 Quizlet | Turn a document into flashcards, then quiz yourself with AI grading. |
| 📖 Guide | Compile a chapter-by-chapter study guide; export as Markdown. |
| 📺 Video | Turn a YouTube transcript into structured notes; export as Markdown. |
| 🔍 Search | Semantically scan a document for a concept (not just keywords). |
| 🔬 Solver | Two-stage diagram/formula solver: a vision model transcribes, an LLM explains. |
| ⚙️ Models | Install, browse, and delete Ollama models, with RAM/disk estimates. |

## Requirements

- **Ollama** installed and running — start it with `ollama serve` or the Ollama app.
- **At least one model** pulled. Use the **⚙️ Models** tab, or run e.g.
  `ollama pull llama3.1:8b` (and a vision model like `ollama pull llava` for the
  image tools).

## Install (load into Silica / Chrome)

1. Open `chrome://extensions` (in Silica this also works as `silica://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this `silica-ai-sidebar/` folder.
4. Click the **Silica AI** toolbar icon (the diamond) — the side panel opens.
   If you don't see the icon, open the puzzle-piece menu and pin it.

## Using it

- Choose your active model from the header dropdown.
- Header buttons: **⟳** refresh model list · **🧹** unload model from RAM ·
  **■** stop the current generation · **⚙** set the Ollama URL.
- The status line shows the connection state and which model is loaded.

## Ollama connection

- Defaults to `http://127.0.0.1:11434`. Change it under **⚙** if Ollama runs elsewhere.
- No `OLLAMA_ORIGINS` configuration is needed: Ollama allows browser-extension
  origins by default, and the extension's host permissions bypass CORS — which is
  also what lets Web Summarizer and Video Notes fetch external pages.

## PDF support (optional)

Text documents (`.txt .md .csv .log .json .html`) work out of the box. To enable
`.pdf` in Quizlet / Guide / Search:

1. Download the **mjs** build of pdf.js from
   <https://github.com/mozilla/pdf.js/releases> (or the `pdfjs-dist` package).
2. Copy `pdf.min.mjs` and `pdf.worker.min.mjs` into `silica-ai-sidebar/vendor/`.
3. Reload the extension — PDFs now extract automatically.

## Privacy

All inference is local via Ollama. Web Summarizer fetches only the URL you type;
Video Notes fetches only the YouTube page you type. Nothing else leaves your machine.

## Permissions, and why

- `sidePanel` — to live in the side panel.
- `storage` — remembers your Ollama URL.
- hosts `127.0.0.1:11434` / `localhost:11434` — to talk to Ollama.
- `<all_urls>` — only used to fetch the pages you enter in Summarize / Video.

## Files

```
manifest.json      MV3 manifest (side panel + permissions)
background.js      opens the panel on toolbar click
sidepanel.html     panel shell
styles.css         Silica-themed dark UI
app.js             header, model picker, status monitor, tab routing
tabs.js            the 9 tools
lib/ollama.js      streaming Ollama REST client
lib/markdown.js    Markdown -> HTML (+ LaTeX cleanup)
lib/extract.js     web scrape / YouTube transcript / file & PDF reading
lib/util.js        helpers + ported settings/model tables
icons/             generated diamond mark (tools/gen_icons.py)
vendor/            optional pdf.js drop-in
```

## Optional: ship it inside Silica

This is a standard MV3 extension. To bake it into the Silica build as an
always-present component extension (no manual "Load unpacked"), it can be
registered under `chrome/browser/resources/` via the component-extension loader.
Ask and that can be wired up.

---
Themed to the Silica Figma palette — `#181818` canvas, `#8ab4f8` accent.
