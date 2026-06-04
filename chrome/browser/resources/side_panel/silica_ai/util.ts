// @ts-nocheck — vanilla DOM/TS; type-checking disabled for this WebUI bundle.
// Shared helpers + ported configuration tables for Silica AI.

/** Tiny hyperscript DOM builder. */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function fmtSize(bytes) {
  if (!bytes) return '0 GB';
  return (bytes / 1024 ** 3).toFixed(1) + ' GB';
}

// ---- Ollama host (persisted) ----
const HOST_KEY = 'silica_ai_host';
export const DEFAULT_HOST = 'http://127.0.0.1:11434';

export async function getHost() {
  try {
    const v = localStorage.getItem(HOST_KEY);
    if (v) return v;
  } catch (_) { /* localStorage unavailable */ }
  return DEFAULT_HOST;
}

export async function setHost(value) {
  let v = (value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(v)) v = 'http://' + v;
  if (!v) v = DEFAULT_HOST;
  try { localStorage.setItem(HOST_KEY, v); } catch (_) { /* ignore */ }
  return v;
}

// ---- Ported tuning tables (from the Python Local AI Studio) ----
export const SPEED_QUALITY_SETTINGS = [
  {label: '🚀 Ultra Fast',  options: {num_ctx: 1024,  temperature: 0.1, top_p: 0.4},  chunk_size: 800,  color: '#e98c84'},
  {label: '⚡ Fast',        options: {num_ctx: 2048,  temperature: 0.3, top_p: 0.6},  chunk_size: 1300, color: '#e0a064'},
  {label: '⚖️ Balanced',    options: {num_ctx: 4096,  temperature: 0.5, top_p: 0.8},  chunk_size: 1800, color: '#8ab4f8'},
  {label: '🧠 High Quality', options: {num_ctx: 8192,  temperature: 0.7, top_p: 0.9},  chunk_size: 2500, color: '#b794f6'},
  {label: '🏆 Max Quality',  options: {num_ctx: 12288, temperature: 0.8, top_p: 0.95}, chunk_size: 3500, color: '#7ad19b'},
];

export const DETAIL_SETTINGS = [
  {label: '❄️ Minimal',       instructions: 'Provide a highly condensed overview focusing strictly on the 2-3 most essential points. Limit details.', color: '#9aa0a6'},
  {label: '📌 Concise',       instructions: 'Format your summary using clear, brief bullet points outlining key ideas without unnecessary filler.', color: '#e0a064'},
  {label: '⚖️ Standard',      instructions: 'Provide a balanced, standard detailed summary. Explain central concepts clearly and structure important arguments.', color: '#8ab4f8'},
  {label: '📖 Comprehensive', instructions: 'Provide a highly detailed, deeply informative layout. Include detailed concept explanations and expand fully on technical contexts.', color: '#b794f6'},
  {label: '🔍 Deep-Dive',     instructions: 'Produce an exhaustive breakdown. Trace every fact, key data point, and conceptual sequence mentioned in the input, leaving nothing out.', color: '#7ad19b'},
];

export const RECOMMENDED_MODELS = [
  {name: 'gemma2:2b',          params: 2.3,  desc: 'Lightweight & fast',                 heavy: false, vision: false},
  {name: 'qwen2.5:3b',         params: 3.0,  desc: 'Strong small all-rounder',           heavy: false, vision: false},
  {name: 'llama3.2:3b',        params: 3.0,  desc: "Meta's compact model",               heavy: false, vision: false},
  {name: 'moondream',          params: 1.8,  desc: 'Fast lightweight visual reasoner',   heavy: false, vision: true},
  {name: 'llava:7b',           params: 7.0,  desc: 'Popular vision + chat model',        heavy: false, vision: true},
  {name: 'mistral:7b',         params: 7.0,  desc: 'Robust 7B workhorse',                heavy: false, vision: false},
  {name: 'qwen2.5:7b',         params: 7.0,  desc: 'Excellent 7B reasoning',             heavy: false, vision: false},
  {name: 'llama3.1:8b',        params: 8.0,  desc: 'Great general 8B model',             heavy: false, vision: false},
  {name: 'deepseek-r1:8b',     params: 8.0,  desc: 'Chain-of-thought reasoning',         heavy: false, vision: false},
  {name: 'llama3.2-vision:11b',params: 11.0, desc: "Meta's visual reasoning",            heavy: true,  vision: true},
  {name: 'mistral-nemo',       params: 12.0, desc: 'Robust 12B, large context',          heavy: true,  vision: false},
  {name: 'phi4',               params: 14.0, desc: "Microsoft's high-IQ small model",    heavy: true,  vision: false},
  {name: 'qwen2.5:32b',        params: 32.0, desc: 'Flagship dense reasoning',           heavy: true,  vision: false},
  {name: 'llama3.3:70b',       params: 70.0, desc: 'Gold-standard open weights',         heavy: true,  vision: false},
  {name: 'deepseek-r1:70b',    params: 70.0, desc: 'Advanced reasoning, 70B',            heavy: true,  vision: false},
];

export const QUANTS = [
  {label: 'Q2_K (max savings)',   suffix: '-q2_K',   file_mult: 0.35, ram_mult: 0.40, overhead: 3.5},
  {label: 'Q3_K_M (compressed)',  suffix: '-q3_K_M', file_mult: 0.46, ram_mult: 0.50, overhead: 3.8},
  {label: 'Q4_K_M (balanced)',    suffix: '',        file_mult: 0.58, ram_mult: 0.65, overhead: 4.5},
  {label: 'Q5_K_M (high quality)',suffix: '-q5_K_M', file_mult: 0.72, ram_mult: 0.78, overhead: 4.8},
  {label: 'Q6_K (high precision)',suffix: '-q6_K',   file_mult: 0.85, ram_mult: 0.90, overhead: 5.0},
  {label: 'Q8_0 (near lossless)', suffix: '-q8_0',   file_mult: 1.05, ram_mult: 1.15, overhead: 5.5},
  {label: 'FP16 (unquantized)',   suffix: '-fp16',   file_mult: 2.00, ram_mult: 2.10, overhead: 6.5},
];

export const POPULAR_MODELS = [
  'mistral', 'mistral:7b', 'mistral-nemo', 'mistral-small', 'mixtral:8x7b',
  'gemma2', 'gemma2:2b', 'gemma2:9b', 'gemma2:27b',
  'qwen2.5:1.5b', 'qwen2.5:3b', 'qwen2.5:7b', 'qwen2.5:14b', 'qwen2.5:32b', 'qwen2.5-coder',
  'llama3.2:1b', 'llama3.2:3b', 'llama3.1:8b', 'llama3.1:70b', 'llama3.3:70b',
  'llama3.2-vision:11b', 'llava:7b', 'llava:13b',
  'deepseek-r1:1.5b', 'deepseek-r1:7b', 'deepseek-r1:8b', 'deepseek-r1:14b', 'deepseek-r1:32b', 'deepseek-r1:70b',
  'moondream', 'phi4', 'phi3:3.8b', 'codellama', 'command-r',
];
