// @ts-nocheck — vanilla DOM/TS; type-checking disabled for this WebUI bundle.
/* eslint-disable -- Ported vanilla-DOM app (see @ts-nocheck above); intentionally not Chromium-idiomatic TS. */
// Silica AI — all sidebar tools. buildTabs(ctx) returns the tab descriptors.
import {
  h, SPEED_QUALITY_SETTINGS, DETAIL_SETTINGS, RECOMMENDED_MODELS, QUANTS, POPULAR_MODELS,
} from './util.js';
import {renderMarkdown} from './markdown.js';
import * as ollama from './ollama.js';
import {chunkText, extractFile, scrapeUrl, youTubeId, fetchTranscript} from './extract.js';

// ---------- shared builders ----------
function panel(title, desc, ...children) {
  return h('div', {class: 'panel'},
    h('h2', {class: 'panel-title'}, title),
    desc ? h('p', {class: 'panel-desc'}, desc) : null,
    ...children);
}

function sliderGroup(settings, idx = 2) {
  const label = h('div', {class: 'slider-label'});
  const input = h('input', {type: 'range', min: 0, max: settings.length - 1, step: 1, value: idx});
  const sync = () => { const s = settings[+input.value]; label.textContent = s.label; label.style.color = s.color; };
  input.addEventListener('input', sync);
  sync();
  return {el: h('div', {class: 'slider-group'}, label, input), get value() { return settings[+input.value]; }};
}

function outputBox() {
  const el = h('div', {class: 'output stream'});
  el.append(h('span', {class: 'placeholder'}, 'Output will appear here.'));
  let touched = false;
  const ensure = () => { if (!touched) { el.textContent = ''; touched = true; } };
  const scroll = () => { el.scrollTop = el.scrollHeight; };
  return {
    el,
    reset() { el.className = 'output stream'; el.textContent = ''; touched = false; },
    sys(t) { ensure(); el.append(h('div', {class: 'sys'}, t)); scroll(); },
    err(t) { ensure(); el.append(h('div', {class: 'err'}, t)); scroll(); },
    ok(t) { ensure(); el.append(h('div', {class: 'ok'}, t)); scroll(); },
    line(t) { ensure(); el.append(h('div', {}, t)); scroll(); },
    write(t) { ensure(); el.append(document.createTextNode(t)); scroll(); },
    markdown(md) { el.className = 'output md'; el.innerHTML = renderMarkdown(md); el.scrollTop = 0; },
  };
}

function fileField(accept, onChange) {
  const name = h('span', {class: 'filename'}, 'No file selected');
  const input = h('input', {type: 'file', accept});
  input.addEventListener('change', () => {
    const f = input.files[0];
    name.textContent = f ? f.name : 'No file selected';
    if (onChange) onChange(f);
  });
  return {
    el: h('div', {class: 'row'}, h('label', {class: 'btn subtle filebtn'}, 'Choose file', input), name),
    get file() { return input.files[0] || null; },
  };
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function download(filename, text) {
  const blob = new Blob([text], {type: 'text/markdown'});
  const url = URL.createObjectURL(blob);
  const a = h('a', {href: url, download: filename});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const NO_LATEX = 'CRITICAL: Do not use LaTeX notation (such as $, $$, \\[, \\() for formulas. Write equations in plain text or unicode.';

// Centralised run lifecycle: model check, abort handling, button state, timer.
async function guard(ctx, out, btn, busyLabel, fn, {requireModel = true} = {}) {
  if (ctx.isBusy()) return;
  if (requireModel && !ctx.getModel()) {
    out.reset();
    out.err('No model selected. Install one in the ⚙️ Models tab first.');
    return;
  }
  const signal = ctx.newRun();
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = busyLabel;
  const t0 = performance.now();
  try {
    await fn(signal, () => ((performance.now() - t0) / 1000).toFixed(1));
  } catch (e) {
    if (e && e.name === 'AbortError') out.sys('■ Stopped.');
    else out.err('Error: ' + ((e && e.message) || e));
  } finally {
    ctx.endRun();
    btn.disabled = false; btn.textContent = old;
  }
}

// ============================================================ CHAT
function chatTab(ctx) {
  const messages = [];
  const convo = h('div', {class: 'output md'});
  convo.append(h('span', {class: 'placeholder'}, 'Ask anything. Your local model answers here.'));
  const input = h('textarea', {placeholder: 'Message your local model…  (Enter to send, Shift+Enter for newline)', rows: 2});
  const send = h('button', {class: 'btn primary'}, 'Send');
  const clear = h('button', {class: 'btn subtle'}, 'Clear');

  function bubble(role, text) {
    if (convo.querySelector('.placeholder')) convo.textContent = '';
    const body = h('div', {class: 'chat-body'});
    if (role === 'user') body.textContent = text; else body.innerHTML = renderMarkdown(text);
    convo.append(h('div', {class: 'chat-bubble ' + role},
      h('div', {class: 'chat-role'}, role === 'user' ? 'You' : 'Silica AI'), body));
    convo.scrollTop = convo.scrollHeight;
    return body;
  }

  async function run() {
    const text = input.value.trim();
    if (!text || ctx.isBusy()) return;
    if (!ctx.getModel()) { bubble('assistant', '_No model selected — install one in the Models tab._'); return; }
    input.value = '';
    messages.push({role: 'user', content: text});
    bubble('user', text);
    const body = bubble('assistant', '');
    body.classList.add('streaming');
    const signal = ctx.newRun();
    send.disabled = true;
    try {
      let full = '';
      full = await ollama.chat({model: ctx.getModel(), messages, signal}, (delta, acc) => {
        body.textContent = acc; convo.scrollTop = convo.scrollHeight;
      });
      body.classList.remove('streaming');
      body.innerHTML = renderMarkdown(full);
      messages.push({role: 'assistant', content: full});
    } catch (e) {
      body.classList.remove('streaming');
      body.innerHTML = renderMarkdown((body.textContent || '') +
        (e.name === 'AbortError' ? '\n\n_■ Stopped._' : '\n\n_Error: ' + e.message + '_'));
    } finally {
      ctx.endRun(); send.disabled = false;
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); }
  });
  send.addEventListener('click', run);
  clear.addEventListener('click', () => {
    messages.length = 0;
    convo.textContent = '';
    convo.append(h('span', {class: 'placeholder'}, 'Ask anything. Your local model answers here.'));
  });

  const el = panel('Chat', null,
    convo,
    h('div', {class: 'row tight'}, input),
    h('div', {class: 'row tight'}, send, clear));
  return {id: 'chat', icon: '💬', label: 'Chat', el};
}

// ============================================================ WEB SUMMARIZER
function summarizerTab(ctx) {
  const url = h('input', {type: 'text', placeholder: 'https://example.com/article', spellcheck: false});
  const speed = sliderGroup(SPEED_QUALITY_SETTINGS);
  const detail = sliderGroup(DETAIL_SETTINGS);
  const out = outputBox();
  const btn = h('button', {class: 'btn primary block'}, 'Summarize');

  btn.addEventListener('click', () => guard(ctx, out, btn, 'Summarizing…', async (signal, secs) => {
    const u = url.value.trim();
    if (!u) { out.reset(); out.err('Enter a URL first.'); return; }
    out.reset();
    out.sys('Fetching ' + u + ' …');
    const text = await scrapeUrl(u, speed.value.chunk_size * 4);
    out.sys('Fetched ' + text.length + ' chars. Summarizing with ' + ctx.getModel() + '…');
    const prompt =
      'Summarize the following text clearly and concisely. Extract key facts.\n' +
      'Detail requirement: ' + detail.value.instructions + '\n' +
      'Format the output beautifully in Markdown, with bold headers and tables where useful.\n' +
      NO_LATEX + '\n\nText:\n' + text;
    let first = true; let full = '';
    full = await ollama.generate({model: ctx.getModel(), prompt, options: speed.value.options, signal},
      (d) => { if (first) { out.reset(); first = false; } out.write(d); });
    out.markdown(full + '\n\n---\n*⏱️ Completed in ' + secs() + 's.*');
  }));

  const el = panel('Web Summarizer', 'Fetch any page and get a clean Markdown summary.',
    url,
    h('div', {class: 'row'}, speed.el, detail.el),
    btn, out.el);
  return {id: 'sum', icon: '🌐', label: 'Summarize', el};
}

// ============================================================ IMAGE TRANSLATOR
function translatorTab(ctx) {
  const file = fileField('image/*');
  const lang = h('input', {type: 'text', value: 'English'});
  const speed = sliderGroup(SPEED_QUALITY_SETTINGS);
  const out = outputBox();
  const btn = h('button', {class: 'btn primary block'}, 'Translate');

  btn.addEventListener('click', () => guard(ctx, out, btn, 'Translating…', async (signal, secs) => {
    if (!file.file) { out.reset(); out.err('Choose an image first.'); return; }
    out.reset(); out.sys('Reading image and analyzing with ' + ctx.getModel() + '…');
    const b64 = await fileToBase64(file.file);
    const target = lang.value.trim() || 'English';
    const prompt =
      'You are an expert multilingual translator. Analyze this image. Extract any visible foreign text ' +
      'and translate it into ' + target + '.\n\nStrict instructions:\n' +
      '1. The ENTIRE response MUST be written in ' + target + '. Do not write any other language.\n' +
      '2. If text is blurry, cut off, or illegible, do NOT guess — say it is unreadable.\n' +
      '3. Handle exemptive phrases carefully (e.g. "excluding/except X" means X is exempt, not forbidden).\n' +
      '4. Format the output in beautiful Markdown, using tables where appropriate.\n5. ' + NO_LATEX;
    let first = true; let full = '';
    full = await ollama.chat({
      model: ctx.getModel(),
      messages: [{role: 'user', content: prompt, images: [b64]}],
      options: speed.value.options, signal,
    }, (d) => { if (first) { out.reset(); first = false; } out.write(d); });
    out.markdown(full + '\n\n---\n*⏱️ Translated in ' + secs() + 's. (Needs a vision model, e.g. llava or moondream.)*');
  }));

  const el = panel('Image Translator', 'Extract and translate text from a photo or screenshot.',
    file.el,
    h('div', {class: 'row'}, h('div', {class: 'field grow'}, h('label', {}, 'Target language'), lang), speed.el),
    btn, out.el);
  return {id: 'trans', icon: '📷', label: 'Translate', el};
}

// ============================================================ AI QUIZLET
function quizletTab(ctx) {
  const file = fileField('.txt,.md,.csv,.log,.json,.html,.htm,.pdf');
  const speed = sliderGroup(SPEED_QUALITY_SETTINGS);
  const noLimit = h('input', {type: 'checkbox'});
  noLimit.checked = true;
  const limit = h('input', {type: 'text', value: '10', style: {width: '54px'}, disabled: true});
  noLimit.addEventListener('change', () => { limit.disabled = noLimit.checked; });
  const genBtn = h('button', {class: 'btn primary'}, 'Generate cards');
  const out = outputBox();

  let flashcards = [];
  const cardsBox = h('div', {class: 'cards-list'});
  const cardsWrap = h('div', {}, h('div', {class: 'section-label'}, 'Study cards'), cardsBox);
  cardsWrap.hidden = true;

  // ---- test mode ----
  const testWrap = h('div', {});
  testWrap.hidden = true;
  const qEl = h('div', {class: 'quiz-q'});
  const ansEl = h('input', {type: 'text', placeholder: 'Type your definition or explanation…'});
  const submitBtn = h('button', {class: 'btn primary'}, 'Submit answer');
  const stopTestBtn = h('button', {class: 'btn danger'}, 'End test & score');
  const fbEl = h('div', {class: 'quiz-feedback'});
  const progEl = h('div', {class: 'quiz-progress'});
  testWrap.append(h('div', {class: 'quiz-card'}, progEl, qEl, ansEl,
    h('div', {class: 'row tight', style: {justifyContent: 'center', marginTop: '10px'}}, submitBtn, stopTestBtn), fbEl));

  let deck = [];
  let current = null;
  let score = 0;
  let tested = 0;
  let testState = 'submit';

  function renderCards() {
    cardsBox.textContent = '';
    if (!flashcards.length) { cardsBox.append(h('div', {class: 'placeholder'}, 'No cards yet.')); return; }
    flashcards.forEach((c) => cardsBox.append(
      h('div', {class: 'flashcard'}, h('span', {class: 'front'}, c.front), h('span', {}, '·'), h('span', {class: 'back'}, c.back))));
  }

  function nextQuestion() {
    if (!deck.length) { endTest(true); return; }
    testState = 'submit';
    submitBtn.textContent = 'Submit answer';
    submitBtn.classList.add('primary');
    current = deck[Math.floor(Math.random() * deck.length)];
    qEl.textContent = 'Define or explain: “' + current.front + '”';
    ansEl.value = '';
    fbEl.textContent = '';
    progEl.textContent = deck.length + ' card(s) left · score ' + score.toFixed(1) + '/' + tested;
    ansEl.focus();
  }

  function startTest() {
    if (!flashcards.length) { out.err('Generate cards first.'); return; }
    deck = [...flashcards]; score = 0; tested = 0;
    cardsWrap.hidden = true; testWrap.hidden = false;
    nextQuestion();
  }

  function endTest(mastered) {
    testWrap.hidden = true; cardsWrap.hidden = false;
    const pct = tested ? (score / tested * 100).toFixed(0) : 0;
    out.reset();
    out.ok((mastered ? '🏆 Deck mastered! ' : 'Test ended. ') +
      'Final score: ' + score.toFixed(1) + ' / ' + tested + ' (' + pct + '%).');
  }

  async function gradeAnswer() {
    if (testState === 'next') { nextQuestion(); return; }
    if (!current || ctx.isBusy()) return;
    const userAns = ansEl.value.trim();
    const signal = ctx.newRun();
    submitBtn.disabled = true; submitBtn.textContent = 'Grading…';
    fbEl.textContent = 'Tutor is evaluating…';
    const prompt =
      'Question: What is the definition of "' + current.front + '"?\n' +
      'Correct answer: ' + current.back + '\nStudent answer: ' + userAns + '\n' +
      'Grade strictly as "Grade: [CORRECT, MOSTLY CORRECT, PARTIALLY CORRECT, or INCORRECT] - [brief explanation]". ' + NO_LATEX;
    try {
      const full = await ollama.generate({model: ctx.getModel(), prompt, signal},
        (d, acc) => { fbEl.textContent = acc; });
      const grade = (full.split('Grade:')[1] || full).split('-')[0].toUpperCase();
      if (grade.includes('MOSTLY CORRECT')) { deck = deck.filter((c) => c !== current); score += 0.8; tested++; }
      else if (grade.includes('CORRECT') && !grade.includes('INCORRECT')) { deck = deck.filter((c) => c !== current); score += 1; tested++; }
      else if (grade.includes('PARTIAL')) { score += 0.5; tested++; }
      else { tested++; }
      testState = 'next';
      submitBtn.textContent = 'Next question';
    } catch (e) {
      fbEl.textContent = e.name === 'AbortError' ? '■ Stopped.' : 'Error: ' + e.message;
    } finally {
      ctx.endRun(); submitBtn.disabled = false;
    }
  }

  submitBtn.addEventListener('click', gradeAnswer);
  ansEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); gradeAnswer(); } });
  stopTestBtn.addEventListener('click', () => endTest(false));

  genBtn.addEventListener('click', () => guard(ctx, out, genBtn, 'Generating…', async (signal, secs) => {
    if (!file.file) { out.reset(); out.err('Choose a document first.'); return; }
    out.reset(); out.sys('Extracting document…');
    const text = await extractFile(file.file);
    const chunks = chunkText(text, speed.value.chunk_size);
    out.sys('Split into ' + chunks.length + ' segment(s). Extracting key terms…');
    const seen = new Set();
    const found = [];
    for (let i = 0; i < chunks.length; i++) {
      out.sys('Reading segment ' + (i + 1) + ' of ' + chunks.length + '…');
      const prompt =
        'Extract as many critical study terms, concepts, formulas, and vocabulary as needed to comprehensively ' +
        'cover this material. Output ONLY lines in the exact format "Term | Definition", one per line. ' + NO_LATEX +
        '\n\nText:\n' + chunks[i];
      const res = await ollama.generate({model: ctx.getModel(), prompt, options: speed.value.options, signal});
      for (const line of res.split('\n')) {
        const l = line.trim();
        if (l.includes('|') && !seen.has(l)) {
          seen.add(l);
          const [front, back] = [l.slice(0, l.indexOf('|')).trim(), l.slice(l.indexOf('|') + 1).trim()];
          if (front && back) found.push({front, back});
        }
      }
    }
    flashcards = found;
    // Optional top-N selection.
    if (!noLimit.checked) {
      const n = Math.max(1, parseInt(limit.value, 10) || 10);
      if (found.length > n) {
        out.sys('Selecting the ' + n + ' highest-yield cards…');
        const list = found.map((c) => c.front + ' | ' + c.back).join('\n');
        const sel = await ollama.generate({model: ctx.getModel(), options: speed.value.options, signal,
          prompt: 'From the following flashcards, select the ' + n + ' most high-yield, essential cards for passing ' +
            'a strict exam. Output exactly those cards as "Term | Definition", nothing else.\n\n' + list});
        const picked = [];
        for (const line of sel.split('\n')) {
          const l = line.trim();
          if (l.includes('|')) picked.push({front: l.slice(0, l.indexOf('|')).trim(), back: l.slice(l.indexOf('|') + 1).trim()});
        }
        if (picked.length) flashcards = picked;
      }
    }
    renderCards();
    cardsWrap.hidden = false;
    out.reset();
    out.ok('Compiled ' + flashcards.length + ' card(s) in ' + secs() + 's. Press “Start test” to practise.');
  }));

  const startBtn = h('button', {class: 'btn subtle'}, 'Start test');
  startBtn.addEventListener('click', startTest);

  const el = panel('AI Quizlet', 'Turn a document into flashcards, then quiz yourself with AI grading.',
    file.el,
    h('div', {class: 'row'}, speed.el),
    h('div', {class: 'row tight'},
      h('label', {class: 'row tight', style: {gap: '5px'}}, noLimit, 'No limit'),
      h('label', {class: 'row tight', style: {gap: '5px'}}, 'Limit', limit)),
    h('div', {class: 'row tight'}, genBtn, startBtn),
    out.el, testWrap, cardsWrap);
  return {id: 'quiz', icon: '📚', label: 'Quizlet', el};
}

// ============================================================ STUDY GUIDE
function guideTab(ctx) {
  const file = fileField('.txt,.md,.csv,.log,.json,.html,.htm,.pdf');
  const speed = sliderGroup(SPEED_QUALITY_SETTINGS);
  const out = outputBox();
  const genBtn = h('button', {class: 'btn primary'}, 'Generate guide');
  const exportBtn = h('button', {class: 'btn subtle'}, '💾 Export .md');
  let lastMd = '';

  genBtn.addEventListener('click', () => guard(ctx, out, genBtn, 'Generating…', async (signal, secs) => {
    if (!file.file) { out.reset(); out.err('Choose a document first.'); return; }
    out.reset(); out.sys('Extracting document…');
    const text = await extractFile(file.file);
    const chunks = chunkText(text, speed.value.chunk_size);
    out.sys('Compiling ' + chunks.length + ' chapter(s)…');
    let md = '# Study guide: ' + (file.file.name || '').replace(/\.[^.]+$/, '').toUpperCase() + '\n\n';
    out.reset();
    let first = true;
    for (let i = 0; i < chunks.length; i++) {
      const header = '## Chapter ' + (i + 1) + '\n\n';
      md += header;
      if (first) { out.reset(); first = false; }
      out.write(header);
      const prompt =
        'You are an elite academic tutor. Write a detailed, comprehensive study-guide chapter for this section. ' +
        'Explain all core themes, define every key term, and outline important details. Use Markdown. ' + NO_LATEX +
        '\n\nText to study:\n' + chunks[i];
      const part = await ollama.generate({model: ctx.getModel(), prompt, options: speed.value.options, signal},
        (d) => out.write(d));
      md += part + '\n\n---\n\n';
    }
    lastMd = md + '\n*⏱️ Compiled in ' + secs() + 's across ' + chunks.length + ' segment(s).*';
    out.markdown(lastMd);
  }));

  exportBtn.addEventListener('click', () => {
    if (!lastMd) { out.err('Generate a guide first.'); return; }
    download('study-guide.md', lastMd);
  });

  const el = panel('Study Guide', 'Compile a thorough, chapter-by-chapter guide from a document.',
    file.el,
    h('div', {class: 'row'}, speed.el),
    h('div', {class: 'row tight'}, genBtn, exportBtn),
    out.el);
  return {id: 'guide', icon: '📖', label: 'Guide', el};
}

// ============================================================ VIDEO NOTES
function videoTab(ctx) {
  const url = h('input', {type: 'text', placeholder: 'https://www.youtube.com/watch?v=…', spellcheck: false});
  const speed = sliderGroup(SPEED_QUALITY_SETTINGS);
  const detail = sliderGroup(DETAIL_SETTINGS);
  const out = outputBox();
  const genBtn = h('button', {class: 'btn primary'}, 'Generate notes');
  const exportBtn = h('button', {class: 'btn subtle'}, '💾 Export .md');
  let lastMd = '';

  genBtn.addEventListener('click', () => guard(ctx, out, genBtn, 'Processing…', async (signal, secs) => {
    const id = youTubeId(url.value.trim());
    if (!id) { out.reset(); out.err('Enter a valid YouTube watch/share URL.'); return; }
    out.reset(); out.sys('Fetching transcript (video ' + id + ')…');
    const transcript = await fetchTranscript(id);
    const chunks = chunkText(transcript, speed.value.chunk_size);
    out.sys('Transcript retrieved. Extracting notes from ' + chunks.length + ' segment(s)…');
    const partials = [];
    for (let i = 0; i < chunks.length; i++) {
      out.sys('Extracting concepts from segment ' + (i + 1) + ' of ' + chunks.length + '…');
      const prompt =
        'Extract all key concepts, facts, dates, names, and structured points from this transcript segment with ' +
        'maximum pedagogical depth. No intros or conclusions. Provide complete explicit context.\n\nSegment:\n' + chunks[i];
      partials.push(await ollama.generate({model: ctx.getModel(), prompt, options: speed.value.options, signal}));
    }
    out.sys('Consolidating into a unified study guide…');
    const booster = DETAIL_SETTINGS.indexOf(detail.value) >= 3
      ? '\nAvoid generalizations. Keep every technical definition, proper name, exact formula, date, and statistic.'
      : '';
    const prompt =
      'You are an elite curriculum editor. Synthesize these raw notes from sequential video segments into one ' +
      'cohesive, professional master study guide.\nGuidelines:\n1. Group related topics; merge overlaps.\n' +
      '2. Remove redundancy but keep exact metrics, numbers, steps, names, variables.\n' +
      '3. Use Markdown with clear headers (H3/H4), bullets, and tables where useful.\n' +
      '4. Do not mention segment numbers.\n5. Detail level: ' + detail.value.instructions + '\n6. ' + NO_LATEX + booster +
      '\n\nRaw segment notes:\n' + partials.join('\n\n---\n\n');
    let md = '# Video notes: ' + id + '\n\n';
    out.reset(); out.write(md);
    const final = await ollama.generate({model: ctx.getModel(), prompt, options: speed.value.options, signal},
      (d) => out.write(d));
    lastMd = md + final + '\n\n---\n*⏱️ Generated in ' + secs() + 's across ' + chunks.length + ' segment(s).*';
    out.markdown(lastMd);
  }));

  exportBtn.addEventListener('click', () => {
    if (!lastMd) { out.err('Generate notes first.'); return; }
    download('video-notes.md', lastMd);
  });

  const el = panel('Video Notes', 'Turn a YouTube video transcript into structured study notes.',
    url,
    h('div', {class: 'row'}, speed.el, detail.el),
    h('div', {class: 'row tight'}, genBtn, exportBtn),
    out.el);
  return {id: 'yt', icon: '📺', label: 'Video', el};
}

// ============================================================ SMART SEARCH
function searchTab(ctx) {
  const file = fileField('.txt,.md,.csv,.log,.json,.html,.htm,.pdf');
  const query = h('input', {type: 'text', placeholder: 'Concept to search for (e.g. photosynthesis)…'});
  const speed = sliderGroup(SPEED_QUALITY_SETTINGS);
  const out = outputBox();
  const btn = h('button', {class: 'btn primary block'}, 'Smart search');

  btn.addEventListener('click', () => guard(ctx, out, btn, 'Searching…', async (signal, secs) => {
    if (!file.file) { out.reset(); out.err('Choose a document first.'); return; }
    const q = query.value.trim();
    if (!q) { out.reset(); out.err('Enter a search query.'); return; }
    out.reset(); out.sys('Extracting document…');
    const text = await extractFile(file.file);
    const chunks = chunkText(text, speed.value.chunk_size);
    out.sys('Scanning ' + chunks.length + ' segment(s) for “' + q + '”…');
    let matches = 0;
    for (let i = 0; i < chunks.length; i++) {
      const prompt =
        'You are a semantic search engine. If this text contains concepts, synonyms, or facts conceptually related ' +
        'to "' + q + '", output a brief 2-sentence summary of the most relevant information. If there is absolutely ' +
        'no match, output strictly the word NO_MATCH.\n\nSegment ' + (i + 1) + ':\n' + chunks[i];
      const res = (await ollama.generate({model: ctx.getModel(), prompt, options: speed.value.options, signal})).trim();
      if (!res.includes('NO_MATCH')) {
        matches++;
        out.line('🔍 Segment ' + (i + 1) + '/' + chunks.length);
        out.line(res);
        out.line('');
      }
    }
    out.sys('Done — ' + matches + ' match(es) across ' + chunks.length + ' segment(s) in ' + secs() + 's.');
  }));

  const el = panel('Smart Search', 'Semantically scan a document for a concept (not just keywords).',
    file.el, query,
    h('div', {class: 'row'}, speed.el),
    btn, out.el);
  return {id: 'search', icon: '🔍', label: 'Search', el};
}

// ============================================================ DIAGRAM SOLVER
function solverTab(ctx) {
  const file = fileField('image/*');
  const visionSel = h('select', {});
  const explainSel = h('select', {});
  const out = outputBox();
  const btn = h('button', {class: 'btn primary block'}, 'Analyze & explain');

  function fillSelects(models) {
    [visionSel, explainSel].forEach((sel) => {
      const prev = sel.value;
      sel.innerHTML = '';
      if (!models.length) { sel.append(h('option', {value: ''}, 'No models installed')); return; }
      models.forEach((m) => sel.append(h('option', {value: m}, m)));
      sel.value = prev && models.includes(prev) ? prev : models[0];
    });
    const vis = models.find((m) => /vision|llava|moondream|vl/i.test(m));
    if (vis) visionSel.value = vis;
  }
  fillSelects(ctx.getModels());
  document.addEventListener('models-changed', (e) => fillSelects(e.detail));

  btn.addEventListener('click', () => guard(ctx, out, btn, 'Analyzing…', async (signal, secs) => {
    if (!file.file) { out.reset(); out.err('Choose a diagram image first.'); return; }
    if (!visionSel.value || !explainSel.value) { out.reset(); out.err('Install a model first.'); return; }
    out.reset(); out.sys('Step 1 — extracting structure with ' + visionSel.value + '…');
    const b64 = await fileToBase64(file.file);
    const visionPrompt =
      'You are a scientific image extraction engine. Transcribe the raw structures: exact formula symbols and ' +
      'variables; atomic structures / reaction steps; or every node, block, connection, and arrow. Be specific ' +
      'and objective — transcribe, do not interpret yet.';
    out.line('### Step 1 — visual extraction (' + visionSel.value + ')');
    const desc = await ollama.chat({
      model: visionSel.value,
      messages: [{role: 'user', content: visionPrompt, images: [b64]}], signal,
    }, (d) => out.write(d));
    out.write('\n\n');
    out.sys('Step 2 — verifying & explaining with ' + explainSel.value + '…');
    const explainPrompt =
      'You are an expert scientific tutor and fact-checker. Given this raw visual extraction, verify it for logical ' +
      'consistency (flag impossible structures), identify the subject/formula/diagram, and explain how it works. ' +
      'Format as beautiful Markdown with headers and bullets. ' + NO_LATEX + '\n\nRaw visual description:\n' + desc;
    let full = '### Step 2 — verification & explanation (' + explainSel.value + ')\n\n';
    const before = full;
    full = before + await ollama.generate({model: explainSel.value, prompt: explainPrompt, signal}, (d) => out.write(d));
    out.markdown('### Step 1 extraction\n\n' + desc + '\n\n' + full + '\n\n---\n*⏱️ Analyzed in ' + secs() + 's.*');
  }, {requireModel: false}));

  const el = panel('Diagram Solver', 'Two-stage: a vision model transcribes, an LLM verifies and explains.',
    file.el,
    h('div', {class: 'field'}, h('label', {}, 'Vision model'), visionSel),
    h('div', {class: 'field'}, h('label', {}, 'Explaining model'), explainSel),
    btn, out.el);
  return {id: 'solver', icon: '🔬', label: 'Solver', el};
}

// ============================================================ MODEL MANAGER
function managerTab(ctx) {
  const search = h('input', {type: 'text', placeholder: 'Search models to install (e.g. mistral, llama)…', spellcheck: false});
  const suggest = h('div', {class: 'suggest'});
  const installBtn = h('button', {class: 'btn primary'}, 'Install');
  const status = h('div', {class: 'statusline'}, h('span', {}, 'Ollama model manager ready.'));

  search.addEventListener('input', () => {
    const typed = search.value.trim().toLowerCase();
    suggest.textContent = '';
    if (!typed) return;
    POPULAR_MODELS.filter((m) => m.includes(typed)).slice(0, 6).forEach((m) =>
      suggest.append(h('span', {class: 'chip', onClick: () => { search.value = m; suggest.textContent = ''; }}, m)));
  });

  async function doPull(name) {
    if (!name || ctx.isBusy()) return;
    const signal = ctx.newRun();
    installBtn.disabled = true;
    status.textContent = 'Requesting ' + name + '…';
    try {
      await ollama.pull({model: name, signal}, (p) => {
        if (p.total) status.textContent = 'Downloading ' + name + ': ' +
          ((p.completed || 0) / p.total * 100).toFixed(1) + '% (' + (p.status || '') + ')';
        else status.textContent = p.status || 'working…';
      });
      status.textContent = '✓ Installed ' + name;
      await ctx.refreshModels();
    } catch (e) {
      status.textContent = e.name === 'AbortError' ? '■ Stopped.' : 'Download failed: ' + e.message;
    } finally {
      ctx.endRun(); installBtn.disabled = false;
    }
  }

  installBtn.addEventListener('click', () => doPull(search.value.trim()));

  // recommended list with quantization-based footprint estimates
  const quant = sliderGroup(QUANTS, 2);
  const recBox = h('div', {});
  function renderRec() {
    recBox.textContent = '';
    const q = quant.value;
    const group = (heavy, label, cls) => {
      recBox.append(h('div', {class: 'section-label ' + cls}, label));
      RECOMMENDED_MODELS.filter((m) => m.heavy === heavy).forEach((m) => {
        const fileGb = (m.params * q.file_mult).toFixed(1);
        const ramGb = (m.params * q.ram_mult + q.overhead).toFixed(1);
        const dl = h('button', {class: 'btn subtle', onClick: () => doPull(m.name)}, 'Install');
        recBox.append(h('div', {class: 'model-row'},
          h('div', {class: 'info'},
            h('div', {class: 'name'}, m.name, m.vision ? h('span', {class: 'badge vision', style: {marginLeft: '6px'}}, 'VISION') : null),
            h('div', {class: 'meta'}, '~' + ramGb + ' GB RAM · ~' + fileGb + ' GB disk · ' + m.desc)),
          dl));
      });
    };
    group(false, '✅ Safe & optimized', 'good');
    group(true, '⚠️ High resource (lots of RAM)', 'warn');
  }
  quant.el.querySelector('input').addEventListener('input', renderRec);
  renderRec();

  // installed list
  const installedBox = h('div', {});
  function renderInstalled(models) {
    installedBox.textContent = '';
    if (!models.length) { installedBox.append(h('div', {class: 'placeholder'}, 'No models installed.')); return; }
    models.forEach((m) => {
      const del = h('button', {class: 'btn danger', onClick: async () => {
        if (!confirm('Delete ' + m + '?')) return;
        try { await ollama.del(m); status.textContent = 'Deleted ' + m; await ctx.refreshModels(); }
        catch (e) { status.textContent = 'Delete failed: ' + e.message; }
      }}, 'Delete');
      installedBox.append(h('div', {class: 'model-row'}, h('div', {class: 'info'}, h('div', {class: 'name'}, m)), del));
    });
  }
  renderInstalled(ctx.getModels());
  document.addEventListener('models-changed', (e) => renderInstalled(e.detail));

  const el = panel('Models', 'Install, browse, and remove your local Ollama models.',
    h('div', {class: 'row tight'}, h('div', {class: 'grow'}, search), installBtn),
    suggest, status,
    h('div', {class: 'divider'}),
    h('div', {class: 'section-label'}, 'Footprint estimate'), quant.el,
    recBox,
    h('div', {class: 'divider'}),
    h('div', {class: 'section-label'}, 'Installed'), installedBox);
  return {id: 'mgr', icon: '⚙️', label: 'Models', el};
}

// ---------- assemble ----------
export function buildTabs(ctx) {
  return [
    chatTab(ctx),
    summarizerTab(ctx),
    translatorTab(ctx),
    quizletTab(ctx),
    guideTab(ctx),
    videoTab(ctx),
    searchTab(ctx),
    solverTab(ctx),
    managerTab(ctx),
  ];
}
