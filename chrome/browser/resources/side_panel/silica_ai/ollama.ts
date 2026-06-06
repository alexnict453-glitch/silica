// @ts-nocheck — vanilla DOM/TS; type-checking disabled for this WebUI bundle.
/* eslint-disable -- Ported vanilla-DOM app (see @ts-nocheck above); intentionally not Chromium-idiomatic TS. */
// Minimal Ollama REST client (streaming NDJSON), used by every Silica AI tool.
import {getHost} from './util.js';

async function url(path) {
  return (await getHost()) + path;
}

/** Parse a streaming application/x-ndjson body, invoking onObj for each JSON line. */
async function streamNDJSON(endpoint, body, signal, onObj) {
  // No 'Content-Type' header on purpose. Sending application/json would make
  // this a non-simple cross-origin request, triggering a CORS preflight that
  // Ollama answers with HTTP 403. Left off, the POST stays a "simple" request
  // (text/plain) exactly like the working GET /api/tags — and Ollama parses
  // the JSON body regardless of content type.
  let res;
  try {
    res = await fetch(endpoint, {method: 'POST', body: JSON.stringify(body), signal});
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new Error('Could not reach Ollama. Make sure it is running (ollama serve); ' +
      'if it is, restart it with OLLAMA_ORIGINS="*".');
  }
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    if (res.status === 403) {
      throw new Error('Ollama blocked the request (HTTP 403). Restart Ollama with ' +
        'OLLAMA_ORIGINS="*" so it accepts requests from the browser.');
    }
    throw new Error('HTTP ' + res.status + (t ? ': ' + t.slice(0, 200) : ''));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    buf += decoder.decode(value, {stream: true});
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try { onObj(JSON.parse(line)); } catch (_) { /* skip partial */ }
    }
  }
  buf = buf.trim();
  if (buf) { try { onObj(JSON.parse(buf)); } catch (_) {} }
}

/** Returns a sorted list of installed model names. */
export async function listModels() {
  const res = await fetch(await url('/api/tags'));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const names = (data.models || []).map((m) => m.model || m.name).filter(Boolean);
  return [...new Set(names)].sort();
}

/** Currently loaded (in-memory) models, used for the resource monitor. */
export async function ps() {
  const res = await fetch(await url('/api/ps'));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}

/** Unload a model from memory (keep_alive: 0). */
export async function unload(model) {
  if (!model || /^no models/i.test(model)) return;
  try {
    await fetch(await url('/api/generate'), {
      method: 'POST',
      body: JSON.stringify({model, prompt: '', keep_alive: 0}),
    });
  } catch (_) { /* best effort */ }
}

/** Streaming text completion. Returns the full text; calls onToken(delta, full). */
export async function generate({model, prompt, images, options, signal}, onToken) {
  let full = '';
  const body = {model, prompt, stream: true, options: options || {}};
  if (images && images.length) body.images = images;
  await streamNDJSON(await url('/api/generate'), body, signal, (o) => {
    if (o.response) { full += o.response; if (onToken) onToken(o.response, full); }
  });
  return full;
}

/** Streaming chat completion. messages: [{role, content, images?}]. */
export async function chat({model, messages, options, signal}, onToken) {
  let full = '';
  await streamNDJSON(await url('/api/chat'),
    {model, messages, stream: true, options: options || {}}, signal, (o) => {
      const c = o.message && o.message.content;
      if (c) { full += c; if (onToken) onToken(c, full); }
    });
  return full;
}

/** Pull (download) a model, streaming progress objects {status, completed, total}. */
export async function pull({model, signal}, onProgress) {
  await streamNDJSON(await url('/api/pull'),
    {model, name: model, stream: true}, signal, (o) => { if (onProgress) onProgress(o); });
}

/** Delete an installed model. */
export async function del(model) {
  const res = await fetch(await url('/api/delete'), {
    method: 'DELETE',
    body: JSON.stringify({model, name: model}),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
}
