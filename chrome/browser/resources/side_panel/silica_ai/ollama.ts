// @ts-nocheck — vanilla DOM/TS; type-checking disabled for this WebUI bundle.
// Minimal Ollama REST client (streaming NDJSON), used by every Silica AI tool.
import {getHost} from './util.js';

async function url(path) {
  return (await getHost()) + path;
}

/** Parse a streaming application/x-ndjson body, invoking onObj for each JSON line. */
async function streamNDJSON(endpoint, body, signal, onObj) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
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
      headers: {'Content-Type': 'application/json'},
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
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({model, name: model}),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
}
