# Enable PDF support

Drop two files from pdf.js into this folder to enable `.pdf` documents in the
Flashcards, Study Guide, and Smart Search tools:

- `pdf.min.mjs`
- `pdf.worker.min.mjs`

Get them from the **mjs** build at <https://github.com/mozilla/pdf.js/releases>
(or from the `pdfjs-dist` npm package, `build/` directory). After copying them in,
reload the extension at `chrome://extensions`. PDFs will then extract automatically
— no other changes needed.

Text documents (`.txt`, `.md`, `.csv`, `.log`, `.json`, `.html`) work without this.
