// Content extraction: file reading, web scraping, YouTube transcripts, chunking.
// Extension host_permissions let these fetches bypass page CORS.

/** Split text into memory-safe word chunks. */
export function chunkText(text, size = 1500) {
  const words = (text || '').split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(' '));
  return out.length ? out : [''];
}

function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,svg,iframe,header,footer,nav,form').forEach((n) => n.remove());
  const body = doc.body || doc.documentElement;
  return (body.textContent || '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Read a local file to text. PDFs use an optional pdf.js drop-in (see README). */
export async function extractFile(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.pdf')) {
    const pdfjs = await ensurePdfjs();
    if (!pdfjs) {
      throw new Error(
        'PDF support needs pdf.js. Add pdf.min.mjs + pdf.worker.min.mjs to the ' +
        "extension's vendor/ folder (see README), or use a .txt / .md / .html file.");
    }
    return extractPdf(file, pdfjs);
  }
  const text = await file.text();
  if (name.endsWith('.html') || name.endsWith('.htm')) return htmlToText(text);
  return text;
}

let pdfjsPromise;
/** Lazily load a vendored pdf.js (vendor/pdf.min.mjs), or return null if absent. */
async function ensurePdfjs() {
  if (globalThis.pdfjsLib) return globalThis.pdfjsLib;
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      try {
        const mod = await import(chrome.runtime.getURL('vendor/pdf.min.mjs'));
        const lib = mod.default || mod;
        if (lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.mjs');
        globalThis.pdfjsLib = lib;
        return lib;
      } catch (_) {
        return null;
      }
    })();
  }
  return pdfjsPromise;
}

async function extractPdf(file, pdfjs) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({data: buf}).promise;
  let out = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    out += content.items.map((it) => it.str).join(' ') + '\n';
  }
  return out.trim();
}

async function wikiExtract(url) {
  const u = new URL(url);
  const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/');
  let title = parts[0] === 'wiki' && parts[1] ? parts[1] : parts[parts.length - 1];
  title = decodeURIComponent(title);
  const api = `${u.protocol}//${u.host}/api.php?action=query&prop=extracts&explaintext=1` +
    `&titles=${encodeURIComponent(title)}&format=json&redirects=1&origin=*`;
  const data = await (await fetch(api)).json();
  const pages = (data.query && data.query.pages) || {};
  for (const id of Object.keys(pages)) {
    if (id !== '-1' && pages[id].extract) return pages[id].extract;
  }
  return '';
}

/** Fetch a web page and return readable text, with wiki-API and Jina fallbacks. */
export async function scrapeUrl(url, maxChars = 8000) {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const low = url.toLowerCase();
  if (low.includes('wikipedia.org') || low.includes('fandom.com') || low.includes('wikia.org')) {
    try { const t = await wikiExtract(url); if (t) return t.slice(0, maxChars); } catch (_) {}
  }
  try {
    const res = await fetch(url, {headers: {'Accept': 'text/html,application/xhtml+xml'}});
    if (res.ok) {
      const text = htmlToText(await res.text());
      const head = text.slice(0, 400).toLowerCase();
      if (text.length > 200 &&
          !/enable javascript|checking your browser|enable cookies|verify you are human/.test(head)) {
        return text.slice(0, maxChars);
      }
    }
  } catch (_) { /* fall through to Jina */ }
  // Lightweight cloud reader fallback for JS-walled / blocked pages.
  const jr = await fetch('https://r.jina.ai/' + url);
  if (jr.ok) return (await jr.text()).slice(0, maxChars);
  throw new Error('Could not fetch this page (it may be blocked, offline, or JS-only).');
}

export function youTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.replace(/\//g, '') || null;
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(embed|v|shorts)\/([^/?]+)/);
      if (m) return m[2];
    }
  } catch (_) {}
  const m = String(url).match(/[?&]v=([^&]+)/);
  return m ? m[1] : null;
}

/** Fetch and flatten a YouTube transcript for a video id. */
export async function fetchTranscript(videoId) {
  const page = await (await fetch('https://www.youtube.com/watch?v=' + videoId,
    {headers: {'Accept-Language': 'en'}})).text();
  const m = page.match(/"captionTracks":(\[[\s\S]*?\])/);
  if (!m) throw new Error('No captions found (the video may have none, or be private).');
  let tracks;
  try { tracks = JSON.parse(m[1]); } catch (_) { throw new Error('Could not parse caption data.'); }
  if (!tracks.length) throw new Error('No captions available for this video.');
  const pick = tracks.find((t) => (t.languageCode || '').startsWith('en')) || tracks[0];
  const base = pick.baseUrl.replace(/\\u0026/g, '&');
  const tr = await fetch(base + '&fmt=json3');
  let text = '';
  if (tr.ok) {
    try {
      const data = await tr.json();
      text = (data.events || []).map((e) => (e.segs || []).map((s) => s.utf8 || '').join('')).join(' ');
    } catch (_) {}
  }
  if (!text.trim()) {
    // XML fallback
    const xml = await (await fetch(base)).text();
    text = xml.replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('The transcript came back empty.');
  return text;
}
