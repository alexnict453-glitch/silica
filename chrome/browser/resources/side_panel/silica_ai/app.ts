// @ts-nocheck — vanilla DOM/TS; type-checking disabled for this WebUI bundle.
/* eslint-disable -- Ported vanilla-DOM app (see @ts-nocheck above); intentionally not Chromium-idiomatic TS. */
// Silica AI — side panel orchestrator.
import {h, getHost, setHost, DEFAULT_HOST, fmtSize} from './util.js';
import * as ollama from './ollama.js';
import {buildTabs} from './tabs.js';

const $ = (id) => document.getElementById(id);
const modelPicker = $('modelPicker');
const statusDot = $('statusDot');
const statusText = $('statusText');

const state = {controller: null, model: '', models: []};

// ---- run / abort management (shared by all tools) ----
function setBusy(busy) {
  $('btnStop').disabled = !busy;
  statusDot.classList.toggle('busy', busy);
}
function newRun() {
  if (state.controller) state.controller.abort();
  state.controller = new AbortController();
  setBusy(true);
  return state.controller.signal;
}
function endRun() {
  setBusy(false);
  state.controller = null;
}
function stop() {
  if (state.controller) state.controller.abort();
  if (state.model) ollama.unload(state.model);
}

// ---- status helpers ----
function setStatus(kind, text) {
  statusDot.className = 'dot ' + kind;
  statusText.textContent = text;
}
const shortName = (n) => (n || '').split(':')[0];

async function monitor() {
  try {
    const data = await ollama.ps();
    const m = (data.models || [])[0];
    if (state.controller) {
      setStatus('busy', m ? `⚡ Generating · ${shortName(m.name || m.model)}` : '⚡ Generating…');
    } else if (m) {
      setStatus('ok', `🧠 Ready · ${shortName(m.name || m.model)} · ${fmtSize(m.size)} loaded`);
    } else {
      setStatus('ok', 'Idle · Ollama connected');
    }
  } catch (_) {
    setStatus(state.controller ? 'busy' : 'err', 'Ollama not reachable — run `ollama serve`');
  }
}

// ---- models ----
async function refreshModels() {
  try {
    const models = await ollama.listModels();
    state.models = models;
    modelPicker.innerHTML = '';
    if (models.length) {
      models.forEach((m) => modelPicker.append(h('option', {value: m}, m)));
      if (!models.includes(state.model)) state.model = models[0];
      modelPicker.value = state.model;
    } else {
      modelPicker.append(h('option', {value: ''}, 'No models installed'));
      state.model = '';
    }
  } catch (_) {
    state.models = [];
    state.model = '';
    modelPicker.innerHTML = '';
    modelPicker.append(h('option', {value: ''}, 'Ollama not reachable'));
  }
  document.dispatchEvent(new CustomEvent('models-changed', {detail: state.models}));
}

// ---- header wiring ----
modelPicker.addEventListener('change', () => { state.model = modelPicker.value; });
$('btnRefresh').addEventListener('click', () => { refreshModels(); monitor(); });
$('btnStop').addEventListener('click', stop);
$('btnFree').addEventListener('click', async () => {
  if (state.model) { await ollama.unload(state.model); monitor(); }
});

$('btnSettings').addEventListener('click', async () => {
  const panel = $('settingsPanel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) $('hostInput').value = await getHost();
});
$('btnSaveHost').addEventListener('click', async () => {
  await setHost($('hostInput').value || DEFAULT_HOST);
  $('settingsPanel').hidden = true;
  await refreshModels();
  monitor();
});

// ---- build tabs ----
const ctx = {
  getModel: () => state.model,
  getModels: () => state.models,
  refreshModels,
  newRun,
  endRun,
  isBusy: () => !!state.controller,
};

const tabs = buildTabs(ctx);
const tabbar = $('tabbar');
const content = $('content');
function select(idx) {
  tabs.forEach((t, i) => {
    t.el.classList.toggle('active', i === idx);
    t._btn.classList.toggle('active', i === idx);
  });
}
tabs.forEach((t, idx) => {
  const btn = h('button', {class: 'tab', title: t.label},
    h('span', {class: 'tab-ico'}, t.icon), t.label);
  btn.addEventListener('click', () => select(idx));
  t._btn = btn;
  tabbar.append(btn);
  content.append(t.el);
});
select(0);

// ---- boot ----
getHost().then((hostVal) => { $('hostInput').value = hostVal; });
refreshModels();
monitor();
setInterval(monitor, 3000);
