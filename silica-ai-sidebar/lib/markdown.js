// Compact Markdown -> HTML renderer with the Python app's LaTeX cleanup baked in.
import {escapeHtml} from './util.js';

const SUB = {'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','+':'₊','-':'₋','=':'₌','(':'₍',')':'₎','a':'ₐ','e':'ₑ','h':'ₕ','i':'ᵢ','j':'ⱼ','k':'ₖ','l':'ₗ','m':'ₘ','n':'ₙ','o':'ₒ','p':'ₚ','r':'ᵣ','s':'ₛ','t':'ₜ','u':'ᵤ','v':'ᵥ','x':'ₓ'};
const SUP = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻','=':'⁼','(':'⁽',')':'⁾','a':'ᵃ','b':'ᵇ','c':'ᶜ','d':'ᵈ','e':'ᵉ','i':'ⁱ','n':'ⁿ','x':'ˣ','y':'ʸ'};
const SYMBOLS = {'\\neq':'≠','\\approx':'≈','\\leq':'≤','\\geq':'≥','\\pm':'±','\\in':'∈','\\infty':'∞','\\times':'×','\\div':'÷','\\cdot':'·','\\alpha':'α','\\beta':'β','\\gamma':'γ','\\delta':'δ','\\Delta':'Δ','\\theta':'θ','\\pi':'π','\\sigma':'σ','\\omega':'ω','\\lambda':'λ','\\mu':'μ','\\phi':'φ','\\psi':'ψ','\\rho':'ρ','\\tau':'τ','\\sum':'Σ','\\prod':'Π','\\sqrt':'√','\\rightarrow':'→','\\to':'→','\\leftarrow':'←','\\leftrightarrow':'↔','\\Rightarrow':'⇒','\\Leftrightarrow':'⇔'};

// Plain-ASCII placeholder tokens; an AI emitting "@@SXF0@@" verbatim is implausible.
const fenceTok = (i) => '@@SXF' + i + '@@';
const codeTok = (i) => '@@SXC' + i + '@@';
const FENCE_RE = /^@@SXF(\d+)@@$/;
const CODE_RE = /@@SXC(\d+)@@/g;

export function cleanLatex(text) {
  let t = text;
  t = t.replace(/\^?\\circ/g, '°');
  for (const [k, v] of Object.entries(SYMBOLS)) t = t.split(k).join(v);
  t = t.replace(/\$\$/g, '').replace(/\$/g, '').replace(/\\\[|\\\]|\\\(|\\\)/g, '');
  const wrap = /\\(text|mathrm|textbf|textit|mathbf|bold|vec|bar|hat|deg)\{([^{}]+)\}/g;
  while (wrap.test(t)) { wrap.lastIndex = 0; t = t.replace(wrap, '$2'); }
  t = t.replace(/_\{([^{}]+)\}/g, (m, c) => [...c].map((ch) => SUB[ch] || ch).join(''));
  t = t.replace(/_([a-zA-Z0-9+\-=()])/g, (m, c) => SUB[c] || c);
  t = t.replace(/\^\{([^{}]+)\}/g, (m, c) => [...c].map((ch) => SUP[ch] || ch).join(''));
  t = t.replace(/\^([a-zA-Z0-9+\-=()])/g, (m, c) => SUP[c] || c);
  t = t.replace(/\\[a-zA-Z]+/g, '');
  return t;
}

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return codeTok(codes.length - 1); });
  s = escapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    (m, t, u) => `<a href="${u.replace(/"/g, '%22')}" target="_blank" rel="noopener">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(CODE_RE, (m, i) => `<code>${escapeHtml(codes[+i])}</code>`);
  return s;
}

const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l);
const isBlockStart = (l, lines, i) =>
  /^\s*$/.test(l) || /^#{1,6}\s/.test(l) || /^\s*(---|\*\*\*|___)\s*$/.test(l) ||
  FENCE_RE.test(l) || /^\s*>\s?/.test(l) ||
  /^\s*[-*+]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l) ||
  (l.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]));

export function renderMarkdown(src) {
  let text = cleanLatex(src || '');
  const fences = [];
  text = text.replace(/```[\w-]*\n?([\s\S]*?)```/g, (m, code) => {
    fences.push(code.replace(/\n$/, '')); return '\n' + fenceTok(fences.length - 1) + '\n';
  });
  const lines = text.split('\n');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(FENCE_RE);
    if (fence) { html += `<pre><code>${escapeHtml(fences[+fence[1]])}</code></pre>`; i++; continue; }
    if (/^\s*$/.test(line)) { i++; continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { html += '<hr>'; i++; continue; }
    const head = line.match(/^(#{1,6})\s+(.*)$/);
    if (head) { const lv = head[1].length; html += `<h${lv}>${inline(head[2].trim())}</h${lv}>`; i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      html += `<blockquote>${inline(buf.join(' '))}</blockquote>`; continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const parse = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const headers = parse(line); i += 2;
      let t = `<table><thead><tr>${headers.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>`;
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
        t += `<tr>${parse(lines[i]).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`; i++;
      }
      html += t + '</tbody></table>'; continue;
    }
    const ordered = /^\s*\d+[.)]\s+/.test(line);
    if (ordered || /^\s*[-*+]\s+/.test(line)) {
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const items = [];
      while (i < lines.length) { const m = lines[i].match(re); if (!m) break; items.push(inline(m[1])); i++; }
      html += `<${ordered ? 'ol' : 'ul'}>${items.map((it) => `<li>${it}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
      continue;
    }
    const buf = [];
    while (i < lines.length && !isBlockStart(lines[i], lines, i)) { buf.push(lines[i]); i++; }
    if (buf.length) html += `<p>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`;
  }
  return html;
}
