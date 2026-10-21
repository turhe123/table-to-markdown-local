// app.js — Table to Markdown Converter. Everything runs on this device: no network requests.
// Forward mode turns pasted / dropped tabular text (TSV, CSV, HTML table, Markdown) into a Markdown table;
// reverse mode turns a Markdown table into CSV. Papa (papaparse) is loaded as a classic script in <head>.
import { toast, downloadBlob, formatBytes, wireDropzone } from './site.js';

const $ = (id) => document.getElementById(id);
const els = {
  modeMd: $('mode-md'), modeCsv: $('mode-csv'),
  format: $('format'), flavor: $('flavor'),
  header: $('opt-header'), pad: $('opt-pad'), trim: $('opt-trim'), escape: $('opt-escape'),
  input: $('input'), inputLabel: $('input-label'), sample: $('load-sample'), sample2: $('load-sample-2'), clear: $('clear'),
  zone: $('dropzone'), file: $('file-input'),
  results: $('results'), empty: $('empty'), card: $('output-card'),
  output: $('output'), outputLabel: $('output-label'), summary: $('summary'),
  copy: $('copy'), download: $('download'), preview: $('preview'), previewHint: $('preview-hint'),
};

const LARGE_ROWS = 5000;
const PREVIEW_ROWS = 500;
const MAX_FILE = 50 * 1024 * 1024;
const OK_FILE = /\.(csv|tsv|tab|txt|md|markdown|html?)$/i;

// Fictional demo data: five drinks at the made-up Tidepool Roasters cafe.
const SAMPLE_ROWS = [
  ['Drink', 'Size ml', 'Price', 'Notes'],
  ['Flat White', '180', '4.20', 'Double ristretto, silky milk'],
  ['Cortado', '120', '3,80', 'Equal parts espresso | milk'],
  ['Tidepool Cold Brew', '350', '5.10', 'Steeped 18 hours'],
  ['Oat Cappuccino', '240', '4.60', 'Oat milk, cocoa dust'],
  ['Sea Salt Mocha', '300', '5.40', 'Seasonal special'],
];

const state = {
  mode: 'md',          // 'md' = table → Markdown, 'csv' = Markdown → CSV
  align: [],           // per column: 'auto' | 'left' | 'center' | 'right'
  resetAlign: false,   // next render takes alignment from the input (fresh paste / file / sample)
  notices: [],         // extra alerts (rejected files) shown until the input changes
  output: '',
  hadResult: false,
};

/* ---------- Display width (for padding that lines up in a monospace font) ---------- */
const ZERO_WIDTH = /[\p{M}\u200B-\u200F\u2060\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u;
const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]|\p{Emoji_Presentation}/u;

export function displayWidth(s) {
  let w = 0;
  for (const ch of s) {               // iterates by code point, so emoji and astral characters count once
    if (ZERO_WIDTH.test(ch)) continue;  // combining marks, joiners, variation selectors
    w += WIDE.test(ch) ? 2 : 1;
  }
  return w;
}

/* ---------- Parsing ---------- */
const SEP_RE = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
const FORMAT_NAMES = {
  tsv: 'tab separated', csv: 'comma separated', semicolon: 'semicolon separated',
  html: 'HTML table', markdown: 'Markdown table',
};

function normalise(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function findMdSeparator(lines) {
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.includes('-') && SEP_RE.test(l) && lines[i - 1].includes('|') && (l.includes('|') || lines[i - 1].trim().startsWith('|'))) return i;
  }
  return -1;
}

function splitMdRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim());
}

function parseMarkdown(text, unescapeAll) {
  const lines = text.split('\n');
  const sep = findMdSeparator(lines);
  if (sep < 0) return { error: 'This does not look like a Markdown table. It needs a header row followed by a separator row such as | --- | --- |.' };
  const align = splitMdRow(lines[sep]).map((c) => {
    const l = c.startsWith(':'), r = c.endsWith(':');
    return l && r ? 'center' : r ? 'right' : l ? 'left' : 'auto';
  });
  const raw = [lines[sep - 1]];
  for (let i = sep + 1; i < lines.length && lines[i].trim() && lines[i].includes('|'); i++) raw.push(lines[i]);
  const unescape = (c) => {
    c = c.replace(/<br\s*\/?>/gi, '\n');
    return unescapeAll ? c.replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, '$1') : c.replace(/\\\|/g, '|');
  };
  return { rows: raw.map((l) => splitMdRow(l).map(unescape)), align, detected: 'markdown' };
}

// Walks an HTML table in a detached document (never the live page) and repeats merged cells.
export function parseHtmlTable(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const grid = [];
  const trs = [...table.rows];
  trs.forEach((tr, r) => {
    grid[r] = grid[r] || [];
    let c = 0;
    for (const cell of tr.cells) {
      while (grid[r][c] !== undefined) c++;
      cell.querySelectorAll('br').forEach((br) => br.replaceWith('\uE000'));
      const text = cell.textContent.replace(/[ \t\n\r\f\u00A0]+/g, ' ').split('\uE000').map((p) => p.trim()).join('\n').trim();
      const cs = Math.min(Math.max(cell.colSpan || 1, 1), 1000);
      const rs = Math.min(Math.max(cell.rowSpan || 1, 1), trs.length - r);
      for (let i = 0; i < rs; i++) {
        grid[r + i] = grid[r + i] || [];
        for (let j = 0; j < cs; j++) grid[r + i][c + j] = text;
      }
      c += cs;
    }
  });
  return grid.map((row) => Array.from(row, (v) => v ?? ''));
}

function parseDelimited(text, delimiter) {
  const res = window.Papa.parse(text, { delimiter, delimitersToGuess: [',', '\t', ';'], skipEmptyLines: 'greedy' });
  const q = res.errors.find((e) => e.type === 'Quotes');
  if (q) {
    const row = Number.isFinite(q.row) ? ` near row ${q.row + 1}` : '';
    return { error: `Unbalanced quotes${row}: a cell starts with a double quote (") that is never closed. Add the missing closing quote, or write a quote inside a quoted cell as two quotes ("").` };
  }
  const d = res.meta.delimiter;
  return { rows: res.data, detected: d === '\t' ? 'tsv' : d === ';' ? 'semicolon' : 'csv' };
}

export function parseTable(text, format = 'auto') {
  if (format === 'auto') {
    if (/<table[\s>]/i.test(text)) format = 'html';
    else if (findMdSeparator(text.split('\n')) >= 0 && text.trim().startsWith('|')) format = 'markdown';
    else if ((text.split('\n').find((l) => l.trim()) || '').includes('\t')) format = 'tsv';
  }
  if (format === 'html') {
    const rows = parseHtmlTable(text);
    return rows && rows.length ? { rows, detected: 'html' } : { error: 'No <table> element was found in this HTML.' };
  }
  if (format === 'markdown') return parseMarkdown(text, false);
  const delim = { tsv: '\t', csv: ',', semicolon: ';' }[format] || '';
  return parseDelimited(text, delim);
}

/* ---------- Markdown generation ---------- */
const NUMERIC = /^[-+]?(\d+|\d{1,3}([,.' \u00A0\u202F]\d{3})+)([.,]\d+)?$/;
function isNumericColumn(body, c) {
  let seen = 0;
  for (const row of body) {
    const v = (row[c] || '').trim().replace(/^[-+]?[$€£¥₹]\s?|\s?[$€£¥₹%]$/g, '');
    if (!v) continue;
    if (!NUMERIC.test(v)) return false;
    seen++;
  }
  return seen > 0;
}

function shape(rows, opts) {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const clean = rows.map((r) => Array.from({ length: cols }, (_, i) => {
    const v = r[i] == null ? '' : String(r[i]);
    return opts.trim ? v.split('\n').map((l) => l.trim()).join('\n').trim() : v;
  }));
  let header, body;
  if (opts.header) { header = clean[0] || []; body = clean.slice(1); }
  else { header = Array.from({ length: cols }, () => ''); body = clean; }
  header = header.map((h, i) => (h.trim() ? h : `Column ${i + 1}`));
  const aligns = Array.from({ length: cols }, (_, i) => {
    const a = opts.align[i] || 'auto';
    return a === 'auto' ? (isNumericColumn(body, i) ? 'right' : 'auto') : a;
  });
  return { cols, header, body, aligns };
}

function escapeCell(s, opts) {
  if (opts.escape) s = s.replace(/([\\*_`])/g, '\\$1');
  s = s.replace(/\|/g, '\\|');
  return s.replace(/\n/g, opts.flavor === 'plain' ? ' ' : '<br>');
}

function padCell(s, width, align) {
  const gap = width - displayWidth(s);
  if (gap <= 0) return s;
  if (align === 'right') return ' '.repeat(gap) + s;
  if (align === 'center') { const l = Math.floor(gap / 2); return ' '.repeat(l) + s + ' '.repeat(gap - l); }
  return s + ' '.repeat(gap);
}

function sepCell(width, align) {
  const w = Math.max(3, width);
  if (align === 'left') return ':' + '-'.repeat(w - 1);
  if (align === 'right') return '-'.repeat(w - 1) + ':';
  if (align === 'center') return ':' + '-'.repeat(w - 2) + ':';
  return '-'.repeat(w);
}

export function toMarkdown(rows, opts) {
  const t = shape(rows, opts);
  const H = t.header.map((s) => escapeCell(s, opts));
  const B = t.body.map((r) => r.map((s) => escapeCell(s, opts)));
  const outer = opts.flavor !== 'plain' || t.cols === 1;
  const line = (cells) => (outer ? `| ${cells.join(' | ')} |` : cells.join(' | '));
  let lines;
  if (opts.pad) {
    const widths = H.map((h, i) => Math.max(3, displayWidth(h), ...B.map((r) => displayWidth(r[i]))));
    lines = [
      line(H.map((h, i) => padCell(h, widths[i], t.aligns[i]))),
      line(widths.map((w, i) => sepCell(w, t.aligns[i]))),
      ...B.map((r) => line(r.map((s, i) => padCell(s, widths[i], t.aligns[i])))),
    ];
  } else {
    lines = [line(H), line(t.aligns.map((a) => sepCell({ auto: 3, center: 5 }[a] || 4, a))), ...B.map(line)];
  }
  return { text: lines.join('\n') + '\n', ...t };
}

export function toCsv(rows) {
  return window.Papa.unparse(rows, { newline: '\n' }) + '\n';
}

/* ---------- UI ---------- */
const options = () => ({
  header: els.header.checked, pad: els.pad.checked, trim: els.trim.checked, escape: els.escape.checked,
  flavor: els.flavor.value, align: state.align,
});

function alertEl(kind, text) {
  const el = document.createElement('div');
  el.className = `alert alert--${kind}`;
  if (kind === 'error') el.setAttribute('role', 'alert');
  el.textContent = text;
  return el;
}

function setAlign(col, value) {
  state.align[col] = value;
  render();
}

const ALIGN_BUTTONS = [['auto', 'Auto', 'auto (numbers right)'], ['left', 'L', 'left'], ['center', 'C', 'center'], ['right', 'R', 'right']];

function renderPreview(header, body, aligns, reverse) {
  const thead = document.createElement('thead');
  const names = document.createElement('tr');
  header.forEach((h, i) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = h;
    th.style.textAlign = aligns[i] === 'auto' ? 'left' : aligns[i];
    names.appendChild(th);
  });
  thead.appendChild(names);
  if (!reverse) {
    const ctl = document.createElement('tr');
    ctl.className = 't2m-align-row';
    header.forEach((h, i) => {
      const td = document.createElement('td');
      const group = document.createElement('div');
      group.className = 't2m-align';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', `Alignment for ${h}`);
      const current = state.align[i] || 'auto';
      for (const [value, label, word] of ALIGN_BUTTONS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 't2m-align__btn';
        b.textContent = label;
        b.title = `Align ${word}`;
        b.setAttribute('aria-label', `Align ${h} ${value}`);
        b.setAttribute('aria-pressed', String(current === value));
        b.addEventListener('click', () => setAlign(i, value));
        group.appendChild(b);
      }
      td.appendChild(group);
      ctl.appendChild(td);
    });
    thead.appendChild(ctl);
  }
  const tbody = document.createElement('tbody');
  for (const row of body.slice(0, PREVIEW_ROWS)) {
    const tr = document.createElement('tr');
    row.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v;
      if (aligns[i] !== 'auto') td.style.textAlign = aligns[i];
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  els.preview.replaceChildren(thead, tbody);
}

function showEmpty() {
  els.results.replaceChildren(...state.notices.map((n) => alertEl('error', n)));
  els.empty.hidden = false;
  els.card.hidden = true;
  state.output = '';
  state.hadResult = false;
}

function render({ reveal = false } = {}) {
  const text = normalise(els.input.value);
  if (!text.trim()) return showEmpty();
  els.empty.hidden = true;
  const alerts = state.notices.map((n) => alertEl('error', n));
  const reverse = state.mode === 'csv';
  const parsed = reverse ? parseMarkdown(text, true) : parseTable(text, els.format.value);
  if (parsed.error) {
    els.results.replaceChildren(...alerts, alertEl('error', parsed.error));
    els.card.hidden = true;
    state.output = '';
    state.hadResult = false;
    return;
  }
  if (state.resetAlign) { state.align = parsed.align ? [...parsed.align] : []; state.resetAlign = false; }

  let header, body, aligns, out;
  if (reverse) {
    const cols = Math.max(...parsed.rows.map((r) => r.length));
    const rows = parsed.rows.map((r) => Array.from({ length: cols }, (_, i) => {
      const v = r[i] ?? '';
      return els.trim.checked ? v.trim() : v;
    }));
    [header, ...body] = rows;
    aligns = Array.from({ length: cols }, (_, i) => parsed.align[i] || 'auto');
    out = toCsv(rows);
  } else {
    const md = toMarkdown(parsed.rows, options());
    ({ header, body, aligns } = md);
    out = md.text;
  }
  state.output = out;
  els.output.value = out;
  const fmt = reverse ? 'Markdown table' : FORMAT_NAMES[parsed.detected];
  const how = !reverse && els.format.value === 'auto' ? `detected ${fmt}` : fmt;
  els.summary.textContent = `${body.length} ${body.length === 1 ? 'row' : 'rows'} × ${header.length} ${header.length === 1 ? 'column' : 'columns'} · ${how} · ${formatBytes(new Blob([out]).size)}`;

  if (body.length > LARGE_ROWS) alerts.push(alertEl('ok', `Large table: ${body.length.toLocaleString('en')} rows. Conversion still runs on your device, but the preview below shows only the first ${PREVIEW_ROWS} rows.`));
  else if (body.length > PREVIEW_ROWS) alerts.push(alertEl('ok', `The preview shows the first ${PREVIEW_ROWS} of ${body.length.toLocaleString('en')} rows. The output above has all of them.`));
  els.results.replaceChildren(...alerts);
  renderPreview(header, body, aligns, reverse);
  els.card.hidden = false;
  if (reveal || !state.hadResult) els.card.scrollIntoView({ block: 'nearest' });
  state.hadResult = true;
}

let timer = 0;
function scheduleRender() {
  clearTimeout(timer);
  timer = setTimeout(render, 60);
}

function loadText(text, { reveal = true } = {}) {
  els.input.value = normalise(text);
  state.resetAlign = true;
  clearTimeout(timer);
  render({ reveal });
}

function sampleText() {
  if (state.mode === 'csv') return toMarkdown(SAMPLE_ROWS, { header: true, pad: true, trim: true, escape: false, flavor: 'gfm', align: [] }).text;
  return SAMPLE_ROWS.map((r) => r.join('\t')).join('\n');
}

function setMode(mode) {
  if (mode === state.mode) return;
  const carry = state.output;
  state.mode = mode;
  const md = mode === 'md';
  els.modeMd.setAttribute('aria-pressed', String(md));
  els.modeCsv.setAttribute('aria-pressed', String(!md));
  document.querySelectorAll('.md-only').forEach((el) => { el.hidden = !md; });
  els.inputLabel.textContent = md ? 'Your table' : 'Your Markdown table';
  els.input.placeholder = md
    ? 'Paste straight from Excel or Google Sheets (select the cells, copy, paste here). CSV, TSV and tables copied from web pages work too.'
    : 'Paste a Markdown table here, for example:\n| Name | Value |\n| --- | ---: |\n| alpha | 1 |';
  els.outputLabel.textContent = md ? 'Markdown' : 'CSV';
  els.copy.textContent = md ? 'Copy Markdown' : 'Copy CSV';
  els.download.textContent = md ? 'Download table.md' : 'Download table.csv';
  els.previewHint.hidden = !md;
  // Round trip: the current result becomes the new input.
  if (carry) {
    if (md) els.format.value = 'auto';
    loadText(carry, { reveal: false });
  } else render();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* fall back below (older Safari, no permission) */ }
  const active = document.activeElement;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  if (active && active.focus) active.focus();
  return ok;
}

let copyReset = 0;
async function copyResult() {
  if (!state.output) { toast('Nothing to copy yet. Paste a table first.'); return; }
  const what = state.mode === 'md' ? 'Markdown' : 'CSV';
  if (await copyText(state.output)) {
    toast(`${what} copied to the clipboard`);
    els.copy.textContent = 'Copied ✓';
    clearTimeout(copyReset);
    copyReset = setTimeout(() => { els.copy.textContent = `Copy ${what}`; }, 1600);
  } else {
    els.output.focus();
    els.output.select();
    toast('Copy was blocked by the browser. The text is selected: press Ctrl/⌘ + C.');
  }
}

function downloadResult() {
  if (!state.output) return;
  const md = state.mode === 'md';
  const blob = new Blob([state.output], { type: md ? 'text/markdown;charset=utf-8' : 'text/csv;charset=utf-8' });
  const name = md ? 'table.md' : 'table.csv';
  downloadBlob(blob, name);
  toast(`Saved ${name} (${formatBytes(blob.size)})`);
}

async function handleFiles(files) {
  const good = files.filter((f) => OK_FILE.test(f.name));
  const bad = files.filter((f) => !OK_FILE.test(f.name));
  state.notices = [];
  if (bad.length) state.notices.push(`Skipped ${bad.map((f) => f.name).join(', ')}: only CSV, TSV, TXT, HTML and Markdown files can be read.`);
  const file = good[0];
  if (file && file.size > MAX_FILE) {
    state.notices.push(`${file.name} is ${formatBytes(file.size)}, which is too large to convert in the browser (limit ${formatBytes(MAX_FILE)}).`);
  } else if (file) {
    if (good.length > 1) state.notices.push(`Only one file is converted at a time, so ${file.name} was loaded and the others were skipped.`);
    const text = await file.text();
    if (state.mode === 'md') els.format.value = /\.html?$/i.test(file.name) ? 'html' : 'auto';
    loadText(text);
    toast(`${file.name} loaded (${formatBytes(file.size)}), nothing was uploaded`);
    return;
  }
  render({ reveal: true });
}

// Paste: when the clipboard carries an HTML table (spreadsheets, web pages), read it through DOMParser
// so merged cells and line breaks survive, and put it in the box as tab separated text.
els.input.addEventListener('paste', (e) => {
  if (state.mode !== 'md' || !e.clipboardData) return;
  const html = e.clipboardData.getData('text/html');
  if (!html || !/<table[\s>]/i.test(html)) return;
  const rows = parseHtmlTable(html);
  if (!rows || !rows.length) return;
  e.preventDefault();
  const tsv = window.Papa.unparse(rows, { delimiter: '\t', newline: '\n' });
  const { selectionStart: s, selectionEnd: end } = els.input;
  els.input.setRangeText(tsv, s, end, 'end');
  state.notices = [];
  state.resetAlign = true;
  clearTimeout(timer);
  render({ reveal: true });
});
els.input.addEventListener('input', () => {
  if (state.notices.length) state.notices = [];
  scheduleRender();
});

[els.format, els.flavor, els.header, els.pad, els.trim, els.escape].forEach((el) => el.addEventListener('change', () => {
  if (el === els.format) state.resetAlign = true;
  render();
}));
els.modeMd.addEventListener('click', () => setMode('md'));
els.modeCsv.addEventListener('click', () => setMode('csv'));
[els.sample, els.sample2].forEach((b) => b.addEventListener('click', () => {
  state.notices = [];
  if (state.mode === 'md') els.format.value = 'auto';
  loadText(sampleText());
}));
els.clear.addEventListener('click', () => {
  state.notices = [];
  els.input.value = '';
  render();
  els.input.focus();
});
els.copy.addEventListener('click', copyResult);
els.download.addEventListener('click', downloadResult);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); copyResult(); }
});
wireDropzone(els.zone, els.file, handleFiles);
// Dropping a file straight onto the textarea works too.
els.input.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
els.input.addEventListener('drop', (e) => {
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) { e.preventDefault(); handleFiles(files); }
});

render();

// Called by the factory's screenshot script to show the tool in a realistic, fictional state.
window.__demo = async () => {
  const res = await fetch('./tests/fixtures/tidepool.tsv');
  setMode('md');
  els.format.value = 'auto';
  loadText(await res.text());
  state.align[0] = 'left';
  render();
};

export { handleFiles, downloadBlob };
