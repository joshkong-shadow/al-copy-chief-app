/* AL Copy Chief — static dashboard (no build step, no framework, no backend).
 * Talks only to the GitHub REST API with the signed-in person's own token.
 * Contract with the cloud jobs: docs/TASK-PROTOCOL.md in the copy repo.
 * Section 1 is pure logic (no DOM) and is also loaded by node for testing.
 */
(function () {
'use strict';

/* =====================================================================
 * 1. PURE CORE
 * ===================================================================== */

const MARK = '<!-- al-copy-chief:v1 -->';
const APP = 'AL Copy Chief';

const TYPES = [
  { key: 'persona', name: 'Persona research', group: 'RESEARCH' },
  { key: 'angles', name: 'Shocking angles', group: 'RESEARCH' },
  { key: 'deep', name: 'Deep research', group: 'RESEARCH' },
  { key: 'script', name: 'Write a script', group: 'SCRIPTING' },
  { key: 'iteration', name: 'Script iteration analysis', group: 'ANALYSIS & ITERATIONS' },
  { key: 'winner', name: 'Add a winner', group: 'ANALYSIS & ITERATIONS' },
  { key: 'dossier', name: 'Product launch dossier', group: 'OTHERS' },
  { key: 'playbook', name: 'Product launch playbook', group: 'OTHERS' },
  { key: 'listicle', name: 'Listicle copy expansion', group: 'OTHERS' },
  { key: 'context', name: 'Context uploads', group: 'OTHERS' },
  { key: 'promote', name: 'Promotion', group: 'ME', ownerOnly: true }
];
const FORM_TYPES = TYPES.filter(function (t) { return !t.ownerOnly; });
const TYPE_BY_KEY = {};
TYPES.forEach(function (t) { TYPE_BY_KEY[t.key] = t; });

const STATUS = {
  queued: { text: 'Queued', tone: 'blue' },
  running: { text: 'Running', tone: 'blue' },
  'needs-you': { text: 'Waiting on you', tone: 'orange' },
  ready: { text: 'Ready for your feedback', tone: 'orange' },
  done: { text: 'Done', tone: 'green' },
  failed: { text: 'Failed', tone: 'red' }
};

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Tiny, safe markdown: everything is escaped first, then a small subset
 * (headings, bold, italics, inline code, lists, tables, quotes, rules,
 * links to https only) is turned back into tags. */
function mdInline(raw) {
  let s = escapeHtml(raw);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, function (m, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '[image: $1]');
  s = s.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, function (m, t, u) {
    return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>';
  });
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, function (m, i) { return '<code>' + codes[+i] + '</code>'; });
  return s;
}

function splitRow(line) {
  let t = line.trim();
  if (t.charAt(0) === '|') t = t.slice(1);
  if (t.charAt(t.length - 1) === '|') t = t.slice(0, -1);
  return t.split('|').map(function (c) { return c.trim(); });
}

function renderMarkdown(md) {
  const lines = String(md == null ? '' : md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // {tag, items}
  let quote = [];
  function flushPara() { if (para.length) { out.push('<p>' + para.map(mdInline).join(' ') + '</p>'); para = []; } }
  function flushList() { if (list) { out.push('<' + list.tag + '>' + list.items.map(function (i) { return '<li>' + mdInline(i) + '</li>'; }).join('') + '</' + list.tag + '>'); list = null; } }
  function flushQuote() { if (quote.length) { out.push('<blockquote>' + quote.map(mdInline).join('<br>') + '</blockquote>'); quote = []; } }
  function flushAll() { flushPara(); flushList(); flushQuote(); }
  let inFence = false; let fence = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      if (inFence) { out.push('<pre class="md-pre"><code>' + escapeHtml(fence.join('\n')) + '</code></pre>'); fence = []; inFence = false; }
      else { flushAll(); inFence = true; }
      continue;
    }
    if (inFence) { fence.push(line); continue; }
    if (/^\s*$/.test(line)) { flushAll(); continue; }
    if (/^\s*<!--.*-->\s*$/.test(line)) continue;
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flushAll();
      const lvl = Math.min(5, m[1].length + 2);
      out.push('<h' + lvl + '>' + mdInline(m[2].replace(/\s+#+\s*$/, '')) + '</h' + lvl + '>');
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flushAll();
      const head = splitRow(line);
      i += 1;
      const rows = [];
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) { i += 1; rows.push(splitRow(lines[i])); }
      out.push('<table><thead><tr>' + head.map(function (c) { return '<th>' + mdInline(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + mdInline(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>');
      continue;
    }
    if ((m = /^\s*>\s?(.*)$/.exec(line))) { flushPara(); flushList(); quote.push(m[1]); continue; }
    if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
      flushPara(); flushQuote();
      if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
      list.items.push(m[1]); continue;
    }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara(); flushQuote();
      if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
      list.items.push(m[1]); continue;
    }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
    flushList(); flushQuote();
    para.push(line.trim());
  }
  if (inFence) out.push('<pre class="md-pre"><code>' + escapeHtml(fence.join('\n')) + '</code></pre>');
  flushAll();
  return out.join('\n');
}

/* ---------- issue title + body (protocol §1) ---------- */
function shortText(s, max) {
  max = max || 70;
  const one = String(s || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean)[0] || '';
  const t = one.replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max - 1).trim() + '…' : t;
}
function buildIssueTitle(typeKey, short) {
  return TYPE_BY_KEY[typeKey].name + ' · ' + (shortText(short) || 'Untitled');
}
/* fields: [[label, value], …] in form order; blank values are left out.
 * files: repo paths (uploads + picked research). */
function buildIssueBody(typeKey, fields, files) {
  const kept = [];
  fields.forEach(function (f) {
    const v = f[1] == null ? '' : String(f[1]).replace(/\r\n/g, '\n').trim();
    if (v !== '') kept.push([f[0], v]);
  });
  const uniqFiles = [];
  (files || []).forEach(function (p) { if (p && uniqFiles.indexOf(p) < 0) uniqFiles.push(p); });
  const lines = [MARK, '## Brief'];
  kept.forEach(function (f) { lines.push('**' + f[0] + ':** ' + f[1]); });
  lines.push('', '## Files');
  uniqFiles.forEach(function (p) { lines.push('- ' + p); });
  const obj = { type: typeKey, fields: {}, files: uniqFiles };
  kept.forEach(function (f) { obj.fields[f[0]] = f[1]; });
  // backticks are escaped so a value can never close the ```json fence
  lines.push('', '```json', JSON.stringify(obj).replace(/`/g, '\\u0060'), '```');
  return lines.join('\n') + '\n';
}
function parseIssueBody(body) {
  const b = String(body || '').replace(/\r\n/g, '\n');
  const res = { fields: {}, files: [], brief: '', ok: b.indexOf(MARK) >= 0 };
  const m = /```json\s*\n([\s\S]*?)\n```/.exec(b);
  if (m) { try { const o = JSON.parse(m[1]); res.fields = o.fields || {}; res.files = o.files || []; res.type = o.type; } catch (e) { /* ignore */ } }
  const bm = /## Brief\s*\n([\s\S]*?)(\n## Files|\n```json|$)/.exec(b);
  res.brief = bm ? bm[1].trim() : '';
  if (!res.files.length) {
    const fm = /## Files\s*\n([\s\S]*?)(\n```json|\n## |$)/.exec(b);
    if (fm) res.files = fm[1].split('\n').map(function (l) { return l.replace(/^\s*-\s*/, '').trim(); }).filter(Boolean);
  }
  return res;
}

/* ---------- commands (protocol §4) ---------- */
function quoteLines(text) {
  return String(text).replace(/\r\n/g, '\n').split('\n').map(function (l) { return l ? '> ' + l : '>'; }).join('\n');
}
/* opts: {version, proposalsFirst, upload, general, parts:[{label, feedback, edited}]} */
function buildFeedbackComment(opts) {
  const lines = ['/feedback', 'Version: ' + opts.version, 'Proposals first: ' + (opts.proposalsFirst ? 'yes' : 'no')];
  if (opts.upload) lines.push('Upload: ' + opts.upload);
  const g = (opts.general || '').trim();
  if (g) lines.push('', '## General', g);
  (opts.parts || []).forEach(function (p) {
    const fb = (p.feedback || '').trim();
    const ed = p.edited == null ? '' : String(p.edited).replace(/\r\n/g, '\n').trim();
    if (!fb && !ed) return;
    lines.push('', '## ' + p.label);
    if (fb) lines.push('Feedback: ' + fb.replace(/\s*\n\s*/g, ' '));
    if (ed) { lines.push('Edited text:'); lines.push(quoteLines(ed)); }
  });
  return lines.join('\n') + '\n';
}
function buildApproveComment(text) {
  const t = (text || '').trim();
  return '/approve' + (t ? '\n\n' + t : '') + '\n';
}
function buildRefineComment(note) {
  const t = (note || '').trim();
  return '/refine' + (t ? '\n\n' + t : '') + '\n';
}
function buildFinalComment(upload, note) {
  const t = (note || '').trim();
  return '/final\nUpload: ' + upload + (t ? '\n\n' + t : '') + '\n';
}

/* ---------- uploads (protocol §2) ---------- */
function pad(n) { return (n < 10 ? '0' : '') + n; }
function stampNow(d) {
  d = d || new Date();
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + '-' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds());
}
function sanitizeFilename(name) {
  let n = String(name || 'file').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  n = n.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+/, '').replace(/-+(\.[A-Za-z0-9]+)$/, '$1');
  return n || 'file';
}
function uploadPath(login, stamp, filename) {
  return 'uploads/' + login + '/' + stamp + '/' + sanitizeFilename(filename);
}

/* ---------- issues → states ---------- */
function labelNames(issue) { return (issue.labels || []).map(function (l) { return typeof l === 'string' ? l : l.name; }); }
function statusOf(issue) {
  const ls = labelNames(issue);
  const order = ['failed', 'needs-you', 'ready', 'running', 'queued', 'done'];
  for (let i = 0; i < order.length; i++) if (ls.indexOf('status:' + order[i]) >= 0) return order[i];
  return 'queued';
}
function typeOf(issue) {
  const t = labelNames(issue).filter(function (l) { return /^type:/.test(l); })[0];
  return t ? t.slice(5) : '';
}
function shortNameOf(issue) {
  const t = String(issue.title || '');
  const type = TYPE_BY_KEY[typeOf(issue)];
  if (type && t.indexOf(type.name + ' · ') === 0) return t.slice(type.name.length + 3);
  if (/^Promote · /.test(t)) return t.slice(10);
  const i = t.indexOf(' · ');
  return i > 0 ? t.slice(i + 3) : t;
}

/* ---------- job folders (protocol §5) ---------- */
/* rel: paths inside jobs/issue-<N>/. Returns versions [{k, scripts, docx, html}] oldest first.
 * Older layout (no v<k>/ folder): the job root's scripts/ + docx/ count as version 1. */
function versionsFrom(rel) {
  const vs = {};
  rel.forEach(function (p) {
    const m = /^v(\d+)\/(scripts|docx|html)\/([^/]+)$/.exec(p);
    if (!m) return;
    const k = +m[1];
    vs[k] = vs[k] || { k: k, scripts: [], docx: [], html: [] };
    vs[k][m[2]].push(p);
  });
  let list = Object.keys(vs).map(function (k) { return vs[k]; });
  if (!list.length) {
    const v1 = { k: 1, scripts: [], docx: [], html: [], legacy: true };
    rel.forEach(function (p) {
      const m = /^(scripts|docx|html)\/([^/]+)$/.exec(p);
      if (m) v1[m[1]].push(p);
    });
    if (v1.scripts.length || v1.docx.length) list = [v1];
  }
  list.forEach(function (v) {
    v.scripts = v.scripts.filter(function (p) { return /\.md$/i.test(p); }).sort();
    v.docx = v.docx.filter(function (p) { return /\.docx$/i.test(p); }).sort();
  });
  return list.sort(function (a, b) { return a.k - b.k; });
}

/* ---------- script decks → parts for the feedback UI ---------- */
function sentenceCase(s) {
  const t = String(s).trim().split(/(\s+)/).map(function (w) { return /\d/.test(w) ? w : w.toLowerCase(); }).join('');
  return t.replace(/^([^A-Za-z]*)([a-z])/, function (m, a, b) { return a + b.toUpperCase(); });
}
const BEAT_RE = /^###\s+BEAT\s+(\d+)\s*[—–:-]+\s*(.*?)\s*(?:\(\s*(\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2})\s*\))?\s*$/i;
const HOOK_BOLD_RE = /^\s*(?:[-*]\s+)?\*\*\s*HOOK\s+([A-Z])\b\s*(?:\(([^)]*)\))?\s*:?\s*\*\*\s*:?\s*(.*)$/i;
const HOOK_PLAIN_RE = /^\s*(?:[-*]\s+)?HOOK\s+([A-Z])\b\s*(?:\(([^)]*)\))?\s*[:—–]\s*(.+)$/i;
const HOOK_H3_RE = /^###\s+HOOK\s+([A-Z])\b\s*(?:\(([^)]*)\))?.*$/i;
function cleanText(lines) {
  return lines.join('\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
function countWords(s) { return (String(s).match(/[A-Za-z0-9][A-Za-z0-9'’.,%$-]*/g) || []).length; }
function deckLabel(path) {
  const base = String(path).split('/').pop().replace(/\.md$/i, '');
  return base.replace(/_/g, ' · ').replace(/([a-z])([A-Z])/g, '$1 $2');
}
function parseDeck(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const card = {}; const beats = []; const hooks = [];
  let title = ''; let section = 'other'; let cur = null; let inVO = false; let hook = null;
  lines.forEach(function (line) {
    if (/^#\s/.test(line) && !title) { title = line.replace(/^#\s+/, '').trim(); }
    if (/^#{1,2}\s/.test(line)) {
      const t = line.replace(/^#+\s+/, '').trim().toUpperCase();
      section = /HOOK/.test(t) ? 'hooks' : /SCRIPT CARD/.test(t) ? 'card' : /SCRIPT/.test(t) && !/CARD/.test(t) ? 'script' : 'other';
      cur = null; inVO = false; hook = null; return;
    }
    if (/^###\s/.test(line)) {
      inVO = false; hook = null; cur = null;
      const bm = BEAT_RE.exec(line);
      if (bm) { cur = { kind: 'beat', n: +bm[1], name: sentenceCase(bm[2]), time: bm[3] ? bm[3].replace(/\s+/g, '') : '', lines: [] }; beats.push(cur); return; }
      const hm = HOOK_H3_RE.exec(line);
      if (hm) { hook = { kind: 'hook', letter: hm[1].toUpperCase(), note: (hm[2] || '').trim(), lines: [] }; hooks.push(hook); return; }
      return;
    }
    if (section === 'card') {
      const cm = /^\*\*([^*]+?):\*\*\s*(.*)$/.exec(line);
      if (cm) card[cm[1].trim().toUpperCase()] = cm[2].trim();
      return;
    }
    const hb = HOOK_BOLD_RE.exec(line) || (section === 'hooks' ? HOOK_PLAIN_RE.exec(line) : null);
    if (hb && (section === 'hooks' || !cur)) {
      hook = { kind: 'hook', letter: hb[1].toUpperCase(), note: (hb[2] || '').trim(), lines: hb[3] ? [hb[3]] : [] };
      hooks.push(hook); cur = null; inVO = false; return;
    }
    if (hook) {
      if (/^\s*$/.test(line)) { if (cleanText(hook.lines)) hook = null; return; }
      if (/^\s*\*\*[^*]+:\*\*/.test(line) || /^\s*\*[^*].*\*\s*$/.test(line)) { hook = null; return; }
      hook.lines.push(line); return;
    }
    if (cur) {
      const lab = /^\s*\*\*([^*]+?):\*\*\s*(.*)$/.exec(line);
      if (lab) { inVO = /^(VO|V\.O\.|VOICEOVER|VOICE-OVER)$/i.test(lab[1].trim()); if (inVO && lab[2]) cur.lines.push(lab[2]); return; }
      if (inVO) cur.lines.push(line);
    }
  });
  const seen = {};
  const hookParts = hooks.filter(function (x) { if (seen[x.letter]) return false; seen[x.letter] = 1; return cleanText(x.lines); })
    .sort(function (a, b) { return a.letter < b.letter ? -1 : 1; })
    .map(function (x) { return { kind: 'hook', label: 'Hook ' + x.letter, note: x.note, text: cleanText(x.lines) }; });
  const beatParts = beats.map(function (b) { return { kind: 'beat', label: 'Beat ' + b.n + ' · ' + b.name, time: b.time, text: cleanText(b.lines) }; });
  const words = beatParts.reduce(function (n, b) { return n + countWords(b.text); }, 0);
  const winner = ((card['BASE WINNER'] || '').match(/\bW\d+\b/) || [''])[0];
  const structure = card.STRUCTURE ? sentenceCase(card.STRUCTURE.split(/[—(,]/)[0]) : '';
  const messenger = card.MESSENGER ? card.MESSENGER.split(/\s[(—–]|,|\(/)[0].trim() : '';
  return { title: title, card: card, parts: hookParts.concat(beatParts), hooks: hookParts, beats: beatParts, words: words, structure: structure, winner: winner, messenger: messenger };
}

/* ---------- promotion task body (protocol §6) ---------- */
function buildPromoteBody(login, paths, note) {
  const lines = [MARK, '## Brief', '**Promote from:** ' + login, '**What:** ' + paths.join(', ')];
  const n = String(note || '').replace(/\r\n/g, '\n').trim();
  if (n) lines.push("**Owner's note:** " + n);
  return lines.join('\n') + '\n';
}

/* ---------- RESULT.md ---------- */
function splitResult(md) {
  const t = String(md || '').replace(/\r\n/g, '\n');
  const m = /^\s*STATUS:\s*([^\n]*)\n?/.exec(t);
  return m ? { status: m[1].trim(), body: t.slice(m[0].length) } : { status: '', body: t };
}

/* ---------- small helpers ---------- */
function productKey(name) {
  const s = String(name || '').toLowerCase();
  if (/sht|superhuman\s*test|shtest/.test(s)) return 'sht';
  if (/b2o|burn2o|burn20/.test(s)) return 'b2o';
  return s.replace(/[^a-z0-9]+/g, '');
}
function basename(p) { return String(p || '').split('/').pop(); }
function encPath(p) { return String(p).split('/').map(encodeURIComponent).join('/'); }
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0];
  return rows.slice(1).filter(function (r) { return r.some(Boolean); }).map(function (r) { const o = {}; head.forEach(function (h, i) { o[h] = r[i]; }); return o; });
}
function monthYear(d) {
  const m = /^(\d{4})(\d{2})/.exec(String(d || ''));
  if (!m) return '';
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + m[1];
}

const CORE = {
  TYPES: TYPES, STATUS: STATUS, escapeHtml: escapeHtml, renderMarkdown: renderMarkdown, buildIssueTitle: buildIssueTitle,
  buildIssueBody: buildIssueBody, parseIssueBody: parseIssueBody, buildFeedbackComment: buildFeedbackComment,
  buildApproveComment: buildApproveComment, buildRefineComment: buildRefineComment, buildFinalComment: buildFinalComment, buildPromoteBody: buildPromoteBody,
  stampNow: stampNow, sanitizeFilename: sanitizeFilename, uploadPath: uploadPath, statusOf: statusOf, typeOf: typeOf,
  shortNameOf: shortNameOf, versionsFrom: versionsFrom, parseDeck: parseDeck, splitResult: splitResult, productKey: productKey,
  parseCsv: parseCsv, deckLabel: deckLabel
};
if (typeof module !== 'undefined' && module.exports) { module.exports = CORE; }
if (typeof document === 'undefined') return;

/* =====================================================================
 * 2. BROWSER APP
 * ===================================================================== */

const API = 'https://api.github.com';
const DEMO = new URLSearchParams(location.search).get('demo') === '1';
const LS_TOKEN = 'alcc.token';
const LS_REPO = 'alcc.repo';
const DEFAULT_REPO = 'joshkong-shadow/al-copy-chief';

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

const S = {
  token: DEMO ? 'demo' : lsGet(LS_TOKEN),
  repo: (DEMO ? '' : lsGet(LS_REPO)) || DEFAULT_REPO,
  login: '', name: '', branch: 'main',
  data: { index: [], engines: [], examples: {}, config: {}, errors: [] },
  issues: [], issuesLoaded: false, issuesError: '',
  tree: null, treeSha: '', treeTruncated: false,
  jobCache: {}, runningSince: {},
  forms: {}, task: {}, navOpen: false, prs: null
};

/* ---------- DOM helper (never sets innerHTML from repo text) ---------- */
function h(tag, attrs) {
  const el = document.createElement(tag);
  const a = attrs || {};
  Object.keys(a).forEach(function (k) {
    const v = a[k];
    if (v == null || v === false) return;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v; // only ever given renderMarkdown() output (escaped)
    else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'disabled') el.disabled = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  });
  for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
  return el;
}
function append(el, kid) {
  if (kid == null || kid === false) return;
  if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
  el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
}
function setKids(el) { el.replaceChildren(); for (let i = 1; i < arguments.length; i++) append(el, arguments[i]); }
function mdBlock(text) { return h('div', { class: 'md', html: renderMarkdown(text) }); }
function pill(status, text) { const st = STATUS[status] || { text: status, tone: 'grey' }; return h('span', { class: 'pill ' + st.tone }, text || st.text); }
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show';
  clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = ''; }, 5000);
}
let uid = 0;
function nextId(p) { uid += 1; return (p || 'f') + uid; }

/* ---------- API layer ---------- */
function ApiError(status, message) { this.status = status; this.message = message; }
ApiError.prototype = Object.create(Error.prototype);
function repoPath(p) { return '/repos/' + S.repo + p; }

async function api(method, path, opts) {
  opts = opts || {};
  if (DEMO) return demoApi(method, path, opts);
  const headers = { Authorization: 'Bearer ' + S.token, 'X-GitHub-Api-Version': '2022-11-28', Accept: opts.accept || (opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json') };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(API + path, { method: method, headers: headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, cache: 'no-store' });
  } catch (e) { throw new ApiError(0, 'Could not reach GitHub. Check your connection.'); }
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.message || msg; } catch (e) { /* ignore */ }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return null;
  if (opts.blob) return res.blob();
  if (opts.raw || opts.text) return res.text();
  return res.json();
}
function getText(path) { return api('GET', repoPath('/contents/' + encPath(path)), { raw: true }); }
function getBlob(path) { return api('GET', repoPath('/contents/' + encPath(path)), { raw: true, blob: true }); }
function errText(e) {
  if (!e) return 'Something went wrong.';
  if (e.status === 401) return 'GitHub did not accept the token (401). It may have expired: sign out and sign in with a new one.';
  if (e.status === 403) return 'GitHub refused (403): ' + e.message + '. The token may be missing a permission.';
  if (e.status === 404) return 'Not found (404). The file may not exist yet, or the token cannot see this repo.';
  return (e.status ? 'GitHub error ' + e.status + ': ' : '') + (e.message || String(e));
}

async function downloadRepoFile(path) {
  try {
    toast('Downloading ' + basename(path) + '…');
    const blob = await getBlob(path);
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: basename(path) });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  } catch (e) { toast(DEMO && e.status === 404 ? 'Demo: ' + basename(path) + ' is not in the demo fixtures (a real download would fetch it from the repo).' : errText(e)); }
}
function dlLink(path, text) {
  return h('a', { href: '#', onclick: function (ev) { ev.preventDefault(); downloadRepoFile(path); } }, text || basename(path));
}

function b64FromFile(file) {
  return new Promise(function (res, rej) {
    const r = new FileReader();
    r.onload = function () { res(String(r.result).split(',')[1] || ''); };
    r.onerror = function () { rej(new Error('Could not read the file')); };
    r.readAsDataURL(file);
  });
}
function b64FromText(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function putContents(path, b64, message, sha, onProgress) {
  const body = { message: message, content: b64 };
  if (sha) body.sha = sha;
  if (DEMO) return demoApi('PUT', repoPath('/contents/' + encPath(path)), { body: body, onProgress: onProgress });
  return new Promise(function (res, rej) {
    const x = new XMLHttpRequest();
    x.open('PUT', API + repoPath('/contents/' + encPath(path)));
    x.setRequestHeader('Authorization', 'Bearer ' + S.token);
    x.setRequestHeader('Accept', 'application/vnd.github+json');
    x.setRequestHeader('X-GitHub-Api-Version', '2022-11-28');
    x.setRequestHeader('Content-Type', 'application/json');
    if (x.upload && onProgress) x.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = function () {
      let j = {}; try { j = JSON.parse(x.responseText); } catch (e) { /* ignore */ }
      if (x.status >= 200 && x.status < 300) res(j); else rej(new ApiError(x.status, j.message || x.statusText));
    };
    x.onerror = function () { rej(new ApiError(0, 'Upload failed: could not reach GitHub.')); };
    x.send(JSON.stringify(body));
  });
}
function postComment(n, body) { return api('POST', repoPath('/issues/' + n + '/comments'), { body: { body: body } }); }

/* ---------- demo mode ---------- */
const DEMO_STATE = { issues: null, nextNumber: 100, log: [] };
async function demoFetchJson(p) { const r = await fetch('demo/' + p, { cache: 'no-store' }); if (!r.ok) throw new ApiError(404, 'Not Found'); return r.json(); }
async function demoIssues() { if (!DEMO_STATE.issues) DEMO_STATE.issues = await demoFetchJson('issues.json'); return DEMO_STATE.issues; }
function demoLog(method, path, body) {
  let shown = body;
  if (body && typeof body.content === 'string' && body.content.length > 80) {
    shown = Object.assign({}, body, { content: '<base64, ' + body.content.length + ' characters>' });
  }
  DEMO_STATE.log.push({ method: method, path: path, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) });
  window.__demoLog = DEMO_STATE.log;
  const list = document.getElementById('demolog-body');
  if (!list) return;
  const write = method !== 'GET';
  const row = h('div', { class: 'logrow' + (write ? ' write' : '') }, h('span', { class: 'm' }, method), ' ' + path);
  if (shown !== undefined) {
    if (shown && typeof shown.body === 'string' && Object.keys(shown).length === 1) row.appendChild(document.createTextNode('\nbody:\n' + shown.body));
    else row.appendChild(document.createTextNode('\n' + JSON.stringify(shown, null, 2)));
  }
  list.appendChild(row);
  while (list.children.length > 200) list.removeChild(list.firstChild);
  if (write) { list.scrollTop = list.scrollHeight; document.getElementById('demolog').classList.remove('closed'); }
}
async function demoApi(method, path, opts) {
  demoLog(method, path, opts.body);
  const base = '/repos/' + S.repo;
  const url = new URL('https://x' + path);
  const p = url.pathname;
  if (method === 'GET') {
    if (p === '/user') return { login: 'joshkong-shadow', name: 'Josh (demo)' };
    if (p === base) return { full_name: S.repo, default_branch: 'main', private: true };
    if (p === base + '/commits/main') return 'demo-sha-1';
    if (p === base + '/commits') {
      let dates = {}; try { dates = await demoFetchJson('file-dates.json'); } catch (e) { /* none */ }
      const d = dates[url.searchParams.get('path')] || '2026-10-01T00:00:00Z';
      return [{ commit: { committer: { date: d } } }];
    }
    if (p === base + '/git/trees/main') return demoFetchJson('tree.json');
    if (p === base + '/issues') {
      const all = await demoIssues();
      const want = (url.searchParams.get('labels') || '').split(',').filter(Boolean);
      const state = url.searchParams.get('state') || 'open';
      return all.filter(function (i) { const ls = labelNames(i); return (state === 'all' || i.state === state) && want.every(function (w) { return ls.indexOf(w) >= 0; }); });
    }
    let m;
    if ((m = new RegExp('^' + base + '/issues/(\\d+)$').exec(p))) {
      const i = (await demoIssues()).filter(function (x) { return x.number === +m[1]; })[0];
      if (!i) throw new ApiError(404, 'Not Found'); return i;
    }
    if ((m = new RegExp('^' + base + '/issues/(\\d+)/events$').exec(p))) {
      return [{ event: 'labeled', label: { name: 'status:running' }, created_at: new Date(Date.now() - 22 * 60000).toISOString() }];
    }
    if ((m = new RegExp('^' + base + '/issues/(\\d+)/comments$').exec(p))) {
      try { return await demoFetchJson('comments-' + m[1] + '.json'); } catch (e) { return []; }
    }
    if ((m = new RegExp('^' + base + '/contents/(.+)$').exec(p))) {
      const rel = m[1];
      const r = await fetch('demo/' + rel, { cache: 'no-store' });
      if (!r.ok) throw new ApiError(404, 'Not Found');
      if (opts.blob) return r.blob();
      if (opts.raw) return r.text();
      const text = await r.text();
      return { sha: 'demo-sha', content: b64FromText(text), encoding: 'base64' };
    }
    throw new ApiError(404, 'Not in demo fixtures');
  }
  // writes: never sent; logged above, answered with a plausible reply
  const all = await demoIssues();
  let m;
  if (method === 'PUT' && /\/contents\//.test(p)) {
    if (opts.onProgress) { for (let k = 1; k <= 4; k++) { await new Promise(function (r) { setTimeout(r, 120); }); opts.onProgress(k / 4); } }
    return { content: { path: decodeURIComponent(p.split('/contents/')[1]) } };
  }
  if (method === 'POST' && p === base + '/issues') {
    const n = DEMO_STATE.nextNumber++;
    const issue = { number: n, title: opts.body.title, body: opts.body.body, state: 'open', user: { login: S.login }, labels: opts.body.labels.map(function (l) { return { name: l }; }), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), html_url: '#' };
    all.unshift(issue);
    return issue;
  }
  if (method === 'POST' && (m = new RegExp('^' + base + '/issues/(\\d+)/labels$').exec(p))) {
    const i = all.filter(function (x) { return x.number === +m[1]; })[0];
    if (i) opts.body.labels.forEach(function (l) { i.labels.push({ name: l }); });
    return [];
  }
  if (method === 'PATCH' && (m = new RegExp('^' + base + '/(issues|pulls)/(\\d+)$').exec(p))) {
    const i = all.filter(function (x) { return x.number === +m[2]; })[0];
    if (i && opts.body.state) i.state = opts.body.state;
    return i || {};
  }
  if (method === 'PUT' && (m = new RegExp('^' + base + '/pulls/(\\d+)/merge$').exec(p))) {
    const i = all.filter(function (x) { return x.number === +m[1]; })[0];
    if (i) i.state = 'closed';
    return { merged: true };
  }
  if (method === 'POST' && /\/comments$/.test(p)) return { id: Date.now(), html_url: '#' };
  return {};
}

/* ---------- data loading ---------- */
async function loadData() {
  const files = [['RESEARCH-INDEX.json', 'index', []], ['ENGINES.json', 'engines', []], ['EXAMPLES.json', 'examples', {}], ['copy-chief.config.json', 'config', {}]];
  S.data.errors = [];
  await Promise.all(files.map(async function (f) {
    try { S.data[f[1]] = JSON.parse(await getText(f[0])); }
    catch (e) { S.data[f[1]] = f[2]; S.data.errors.push(f[0] + ': ' + errText(e)); }
  }));
}
function products() {
  const counts = {};
  (S.data.index || []).forEach(function (r) { if (r.product && r.product !== 'General') counts[r.product] = (counts[r.product] || 0) + 1; });
  const pb = ((S.data.examples.playbook || {}).dossiers) || [];
  pb.forEach(function (d) { if (!(d in counts)) counts[d] = 0; });
  return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
}
function ex(type) { return S.data.examples[type] || {}; }
function exField(type, key) { const f = ex(type).fields || {}; return f[key] || []; }

async function refreshTasks() {
  try {
    const list = await api('GET', repoPath('/issues?labels=task&state=open&per_page=100&sort=updated'));
    S.issues = list.filter(function (i) { return !i.pull_request && labelNames(i).indexOf('archived') < 0; });
    S.issuesLoaded = true; S.issuesError = '';
  } catch (e) { S.issuesError = errText(e); }
  await refreshTree();
  await Promise.all(S.issues.filter(function (i) { return statusOf(i) === 'running'; }).map(async function (i) {
    try {
      const ev = await api('GET', repoPath('/issues/' + i.number + '/events?per_page=100'));
      const last = ev.filter(function (e) { return e.event === 'labeled' && e.label && e.label.name === 'status:running'; }).pop();
      if (last) S.runningSince[i.number] = Date.parse(last.created_at);
    } catch (e) { /* minutes are optional */ }
  }));
}
async function refreshTree() {
  try {
    const sha = await api('GET', repoPath('/commits/' + encodeURIComponent(S.branch)), { accept: 'application/vnd.github.sha', text: true });
    if (sha && sha === S.treeSha && S.tree) return;
    const t = await api('GET', repoPath('/git/trees/' + encodeURIComponent(S.branch) + '?recursive=1'));
    S.tree = (t.tree || []).filter(function (e) { return e.type === 'blob'; }).map(function (e) { return e.path; });
    S.treeTruncated = !!t.truncated; S.treeSha = sha; S.jobCache = {};
  } catch (e) { S.tree = S.tree || null; }
}
/* paths inside jobs/issue-<n>/ (relative) */
async function jobFiles(n) {
  const prefix = 'jobs/issue-' + n + '/';
  if (S.tree && !S.treeTruncated) return S.tree.filter(function (p) { return p.indexOf(prefix) === 0; }).map(function (p) { return p.slice(prefix.length); });
  if (S.jobCache[n]) return S.jobCache[n];
  const out = [];
  async function walk(dir, depth) {
    let items;
    try { items = await api('GET', repoPath('/contents/' + encPath(prefix + dir))); } catch (e) { return; }
    if (!Array.isArray(items)) return;
    for (const it of items) {
      const rel = (dir ? dir + '/' : '') + it.name;
      if (it.type === 'file') out.push(rel);
      else if (it.type === 'dir' && ((depth < 2 && /^(v\d+|scripts|docx|html|out|feedback)$/.test(it.name)) || (/^out(\/|$)/.test(dir) && depth < 3 && it.name !== 'raw'))) await walk(rel, depth + 1);
    }
  }
  await walk('', 0);
  S.jobCache[n] = out;
  return out;
}

/* ---------- routing ---------- */
function route() {
  const r = (location.hash || '#home').slice(1);
  const m = /^task\/(\d+)$/.exec(r);
  if (m) return { screen: 'task', n: +m[1] };
  const ok = ['home', 'how', 'profile', 'team'].concat(FORM_TYPES.map(function (t) { return t.key; }));
  return { screen: ok.indexOf(r) >= 0 ? r : 'home' };
}
function go(screen) { if (location.hash === '#' + screen) render(); else location.hash = '#' + screen; }
window.addEventListener('hashchange', function () { S.navOpen = false; render(); window.scrollTo(0, 0); });

/* ---------- shell ---------- */
function needsYouCount() {
  return S.issues.filter(function (i) { const s = statusOf(i); return (s === 'needs-you' || s === 'ready') && i.user && i.user.login === S.login; }).length;
}
function navItem(key, label, badge) {
  const r = route();
  const cur = r.screen === key || (key === 'home' && r.screen === 'task');
  return h('button', { class: 'nav-item', type: 'button', 'aria-current': cur ? 'page' : null, onclick: function () { go(key); } }, label, badge ? h('span', { class: 'pill orange' }, badge) : null);
}
function shell(content) {
  const n = needsYouCount();
  const groups = [
    ['', [['home', 'Task overview', n ? n + ' need you' : ''], ['how', 'How it works']]],
    ['RESEARCH', [['persona', 'Persona research'], ['angles', 'Shocking angles'], ['deep', 'Deep research']]],
    ['SCRIPTING', [['script', 'Write a script']]],
    ['ANALYSIS & ITERATIONS', [['iteration', 'Script iteration analysis'], ['winner', 'Add a winner']]],
    ['OTHERS', [['dossier', 'Product launch dossier'], ['playbook', 'Product launch playbook'], ['listicle', 'Listicle copy expansion'], ['context', 'Context uploads']]],
    ['ME', [['profile', 'My profile']].concat(isOwner() ? [['team', 'Team learnings']] : [])]
  ];
  const nav = h('nav', { class: 'nav' + (S.navOpen ? ' open' : ''), 'aria-label': 'Sections' },
    h('div', { class: 'nav-top' },
      h('div', { class: 'brand' }, h('div', { class: 'brand-name' }, APP), h('div', { class: 'brand-sub' }, 'Alpha Lion copy system')),
      h('button', { class: 'btn2 sm nav-menu-btn', type: 'button', 'aria-expanded': S.navOpen ? 'true' : 'false', 'aria-controls': 'nav-groups', onclick: function () { S.navOpen = !S.navOpen; render(); } }, S.navOpen ? 'Close menu' : 'Menu')),
    h('div', { class: 'nav-groups', id: 'nav-groups' }, groups.map(function (g) {
      return h('div', { class: 'nav-group' }, g[0] ? h('div', { class: 'nav-group-name' }, g[0]) : null, g[1].map(function (it) { return navItem(it[0], it[1], it[2]); }));
    })),
    h('div', { class: 'me' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, (S.login || '?').charAt(0).toUpperCase()),
      h('div', { class: 'me-text' }, h('span', { class: 'me-name' }, S.name || S.login), h('span', { class: 'me-sub' }, S.repo),
        h('button', { class: 'linkbtn', type: 'button', onclick: signOut }, DEMO ? 'Leave demo' : 'Sign out'))));
  const main = h('main', { class: 'main', id: 'main' });
  if (DEMO) main.appendChild(h('div', { class: 'demo-banner' }, 'Demo mode: sample data, nothing is sent to GitHub. Every call the page would make is shown in the demo log.'));
  if (S.data.errors.length) main.appendChild(h('div', { class: 'gate err' }, 'Some shared files did not load, so parts of the page are empty: ', S.data.errors.join(' · ')));
  append(main, content);
  return h('div', { class: 'shell' }, nav, main);
}
function demoPanel() {
  if (!DEMO) return null;
  let panel = document.getElementById('demolog');
  if (panel) return panel;
  panel = h('section', { class: 'demolog closed', id: 'demolog', 'aria-label': 'Demo log' },
    h('div', { class: 'demolog-head' }, h('h4', {}, 'Demo log: calls the page would make'),
      h('div', { class: 'wrap-row' },
        h('button', { class: 'btn2 xs', type: 'button', onclick: function () { document.getElementById('demolog-body').replaceChildren(); DEMO_STATE.log.length = 0; } }, 'Clear'),
        h('button', { class: 'btn2 xs', type: 'button', onclick: function () { panel.classList.toggle('closed'); } }, 'Show / hide'))),
    h('div', { class: 'demolog-body', id: 'demolog-body' }));
  document.body.appendChild(panel);
  return panel;
}
function header(title, lead, crumbs) {
  return h('div', { class: 'head' }, crumbs || null, h('h2', {}, title), lead ? h('div', { class: 'hint lead' }, lead) : null);
}

let renderSeq = 0;
function render() {
  const app = document.getElementById('app');
  if (!S.token) { app.replaceChildren(signInScreen()); return; }
  if (!S.login) { app.replaceChildren(h('div', { class: 'boot' }, 'Signing in…')); return; }
  const r = route();
  renderSeq += 1;
  activeValidate = null;
  const fn = SCREENS[r.screen] || SCREENS.home;
  const content = fn(r);
  app.replaceChildren(shell(content));
  demoPanel();
}

/* ---------- sign in ---------- */
function signInScreen(err) {
  const token = h('input', { class: 'in', id: 'tok', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…' });
  const repo = h('input', { class: 'in', id: 'repo', value: S.repo || DEFAULT_REPO, spellcheck: 'false' });
  const msg = h('div', { class: 'gate err', hidden: !err, role: 'alert' }, err || '');
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'card', onsubmit: async function (ev) {
    ev.preventDefault();
    const t = token.value.trim(); const rp = repo.value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, '');
    if (!t || !/^[\w.-]+\/[\w.-]+$/.test(rp)) { msg.hidden = false; msg.textContent = 'Paste your token, and write the repo as owner/name.'; return; }
    btn.disabled = true; btn.textContent = 'Checking…';
    S.token = t; S.repo = rp;
    try { await startSession(); lsSet(LS_TOKEN, t); lsSet(LS_REPO, rp); render(); }
    catch (e) { S.token = null; S.login = ''; btn.disabled = false; btn.textContent = 'Sign in'; msg.hidden = false; msg.textContent = errText(e); }
  } },
    h('label', { class: 'lbl', for: 'tok' }, h('span', {}, 'Your GitHub token ', h('span', { class: 'req' }, '*')), token,
      h('span', { class: 'hint' }, 'Kept only in this browser. Never share it; anyone with it can act as you in the copy repo.')),
    h('label', { class: 'lbl', for: 'repo' }, h('span', {}, 'Copy repo'), repo,
      h('span', { class: 'hint' }, 'Leave as it is unless you have been told the repo moved (for example to the company account).')),
    msg, h('div', { class: 'wrap-row' }, btn, /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? h('a', { href: '?demo=1' }, 'Try the demo (no token needed)') : null));
  return h('div', { class: 'signin' },
    h('div', { class: 'head' }, h('h2', {}, 'Sign in to ' + APP), h('div', { class: 'hint lead' }, 'You sign in with a GitHub token: a password-like key that lets this page read and write the copy repo for you.')),
    h('div', { class: 'card' }, h('h3', {}, 'Make your token (once, about 2 minutes)'),
      h('ol', {},
        h('li', {}, 'Open ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener noreferrer' }, 'GitHub: new fine-grained token'), ' (sign in to GitHub if asked).'),
        h('li', {}, 'Name it "AL Copy Chief" and pick an expiry date.'),
        h('li', {}, 'Resource owner: the account that owns the copy repo. Repository access: "Only select repositories", then pick the copy repo only.'),
        h('li', {}, 'Under Repository permissions, set:'),
      ),
      h('div', { class: 'perm' },
        h('span', { class: 'b' }, 'Contents'), h('span', {}, 'Read and write'),
        h('span', { class: 'b' }, 'Issues'), h('span', {}, 'Read and write'),
        h('span', { class: 'b' }, 'Metadata'), h('span', {}, 'Read-only (GitHub adds it for you)')),
      h('div', { class: 'hint' }, 'Then click "Generate token", copy it and paste it below. If GitHub says the owner must approve it, ask them.')),
    form);
}
async function startSession() {
  const u = await api('GET', '/user');
  const r = await api('GET', repoPath(''));
  S.login = u.login; S.name = u.name || u.login; S.branch = r.default_branch || 'main';
  await loadData();
  await refreshTasks();
}
function signOut() {
  if (DEMO) { location.href = location.pathname; return; }
  lsDel(LS_TOKEN); lsDel(LS_REPO);
  S.token = null; S.login = ''; S.issues = []; S.tree = null; S.forms = {}; S.task = {};
  render();
}

/* =====================================================================
 * 3. SCREENS
 * ===================================================================== */
const SCREENS = {};

/* ---------- Task overview ---------- */
function taskName(i) {
  const f = parseIssueBody(i.body).fields;
  const short = shortNameOf(i);
  return f.Product && short.indexOf(f.Product) < 0 ? short + ' · ' + f.Product : short;
}
function statusText(i) {
  const s = statusOf(i);
  if (s === 'running') {
    const since = S.runningSince[i.number];
    return since ? 'Running · ' + Math.max(1, Math.round((Date.now() - since) / 60000)) + ' min' : 'Running';
  }
  if (s === 'ready' && typeOf(i) === 'script') {
    const v = latestVersionK(i.number);
    return v ? 'v' + v + ' ready for your feedback' : STATUS.ready.text;
  }
  return STATUS[s].text;
}
function treeJob(n) {
  if (!S.tree) return null;
  const prefix = 'jobs/issue-' + n + '/';
  return S.tree.filter(function (p) { return p.indexOf(prefix) === 0; }).map(function (p) { return p.slice(prefix.length); });
}
function latestVersionK(n) {
  const rel = treeJob(n); if (!rel) return 0;
  const vs = versionsFrom(rel); return vs.length ? vs[vs.length - 1].k : 0;
}
/* A one-shot task's deliverables: anything under out/ (sub-folders too), minus the raw evidence and
 * working files; the same document as .docx + .pdf + .md is listed once (Word first). */
function outDocs(rel) {
  const docs = rel.filter(function (p) {
    return /^out\//.test(p) && /\.(docx|pdf|md|html|csv|xlsx)$/i.test(p) &&
      !/(^|\/)(raw|data|_work|tool-results|assets|moments)\//i.test(p) && !/(^|\/)(PLAN|RESULT|README)\.md$/i.test(p);
  });
  const rank = function (p) { return ['docx', 'pdf', 'html', 'md'].indexOf(p.split('.').pop().toLowerCase()) + 1 || 9; };
  const latest = latestRound(rel);
  if (latest) docs.splice(0, docs.length, ...docs.filter(function (p) { return p.indexOf('out/r' + latest + '/') === 0; }));
  const best = {};
  docs.forEach(function (p) { const k = p.replace(/\.[^.]+$/, ''); if (!best[k] || rank(p) < rank(best[k])) best[k] = p; });
  return Object.keys(best).map(function (k) { return best[k]; }).sort();
}
/* feedback rounds on a one-shot task land in out/r<K>/ (protocol: CLAUDE.md, Feedback rounds) */
function latestRound(rel) {
  let k = 0; rel.forEach(function (p) { const m = /^out\/r(\d+)\//.exec(p); if (m && +m[1] > k) k = +m[1]; }); return k;
}
const BULK_FEEDBACK_TYPES = ['dossier', 'playbook'];
function docLabel(p) { return basename(p).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '); }
function downloadCard(t, out) {
  const round = latestRound(t.rel);
  return h('div', { class: 'card' },
    h('div', { class: 'between' }, h('h3', {}, 'Download'), round ? h('span', { class: 'pill orange' }, 'Round ' + round + ' · after your feedback') : null),
    out.map(function (p) {
      const word = /\.docx$/i.test(p);
      return h('div', { class: 'file solid' }, h('span', {}, docLabel(p), ' ', h('span', { class: 'hint' }, '· ' + p.split('.').pop().toUpperCase())),
        h('button', { class: word ? 'btn' : 'btn2', type: 'button', onclick: function () { downloadRepoFile(t.pre + p); } }, word ? 'Download (Word)' : 'Download', h('span', { class: 'sr-only' }, ' ' + basename(p))));
    }));
}
function bulkFeedbackCard(t) {
  t.bulk = t.bulk || '';
  const area = h('textarea', { class: 'in', rows: 6, placeholder: 'All your notes in one go: what to change, add, cut or rethink. Section names or page numbers help.', oninput: function (e) { t.bulk = e.target.value; validate(); } });
  area.value = t.bulk;
  const missing = h('div', { class: 'gate slim', hidden: true });
  const btn = h('button', { class: 'btn', type: 'button' }, 'Send feedback');
  const edited = function () { return storedPaths(t, 'edited')[0] || ''; };
  function validate() {
    const miss = [];
    if (!t.bulk.trim() && !edited()) miss.push('your feedback or your edited Word file');
    if (anyUploading(t)) miss.push('wait for the upload to finish');
    missing.hidden = !miss.length; missing.textContent = 'Missing before you can submit: ' + miss.join(', ') + '.';
    btn.disabled = !!miss.length;
  }
  btn.addEventListener('click', function () {
    btn.disabled = true; btn.textContent = 'Sending…';
    const body = buildFeedbackComment({ version: 'latest', proposalsFirst: t.proposals, upload: edited(), general: t.bulk, parts: [] });
    commandBox(t, 'Feedback', body, function () { t.bulk = ''; t._uploads = {}; })
      .catch(function (e) { btn.textContent = 'Send feedback'; validate(); toast(errText(e)); });
  });
  activeValidate = validate; setTimeout(validate, 0);
  return h('div', { class: 'card' }, h('h3', {}, 'Feedback'),
    field('Your feedback on the whole document', area),
    h('div', { class: 'hint' }, 'Everything you name is addressed; everything else stays as it is. The new version appears above as the next round.'),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: t.proposals, onchange: function (e) { t.proposals = e.target.checked; } }), 'Show me proposals before changing anything'),
    uploader(t, 'edited', 'Edited the Word file yourself? Upload it and every edit is kept word for word.', { button: 'Upload edited Word file', accept: '.docx', multiple: false }),
    missing, h('div', { class: 'wrap-row' }, btn));
}
function latestCell(i) {
  const rel = treeJob(i.number);
  const s = statusOf(i);
  if (!rel) return '—';
  const pre = 'jobs/issue-' + i.number + '/';
  if (typeOf(i) === 'script') {
    const vs = versionsFrom(rel);
    if (vs.length) {
      const v = vs[vs.length - 1];
      const rc = v.docx.filter(function (p) { return /reviewcut/i.test(p); })[0] || v.docx[0];
      if (rc) return dlLink(pre + rc, 'Review Cut v' + v.k + ' (Word)');
    }
  }
  const out = outDocs(rel);
  if (out.length === 1) return dlLink(pre + out[0], /\.docx$/i.test(out[0]) ? 'Download (Word)' : basename(out[0]));
  if (out.length > 1) return h('a', { href: '#task/' + i.number }, out.length + ' files');
  if (s === 'needs-you' && rel.indexOf('PLAN.md') >= 0) return h('a', { href: '#task/' + i.number }, 'Plan to approve');
  return '—';
}
async function archiveTask(i) {
  if (!window.confirm('Archive "' + i.title + '"? It leaves Work in progress. Nothing is deleted.')) return;
  try {
    await api('POST', repoPath('/issues/' + i.number + '/labels'), { body: { labels: ['archived'] } });
    await api('PATCH', repoPath('/issues/' + i.number), { body: { state: 'closed', state_reason: 'not_planned' } });
    S.issues = S.issues.filter(function (x) { return x.number !== i.number; });
    toast('Archived #' + i.number + '.');
    render();
  } catch (e) { toast(errText(e)); }
}
SCREENS.home = function () {
  const exs = S.data.examples;
  const starters = FORM_TYPES.map(function (t) {
    const e = exs[t.key] || {};
    return h('div', { class: 'tile' },
      h('div', { class: 'eyebrow' }, e.group || t.group), h('h4', {}, e.name || t.name),
      h('div', { class: 'hint grow' }, e.what || ''),
      e.sample ? h('div', { class: 'hint' }, 'Sample output: ', dlLink(e.sample)) : null,
      h('button', { class: 'btn2', type: 'button', style: 'align-self:flex-start', onclick: function () { go(t.key); } }, 'Start', h('span', { class: 'sr-only' }, ': ' + t.name)));
  });
  let body;
  if (S.issuesError) body = h('div', { class: 'gate err' }, S.issuesError);
  else if (!S.issues.length) body = h('div', { class: 'empty' }, S.issuesLoaded ? 'Nothing in progress. Start a task above.' : 'Loading…');
  else body = h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, ['Task', 'Type', 'Who', 'Status', 'Latest', ''].map(function (c) { return h('th', { scope: 'col' }, c || h('span', { class: 'sr-only' }, 'Actions')); }))),
    h('tbody', {}, S.issues.map(function (i) {
      const t = TYPE_BY_KEY[typeOf(i)];
      return h('tr', {},
        h('td', {}, taskName(i)), h('td', {}, t ? t.name : '—'), h('td', {}, i.user ? i.user.login : ''),
        h('td', {}, pill(statusOf(i), statusText(i))), h('td', {}, latestCell(i)),
        h('td', { class: 'actions' },
          h('button', { class: 'btn2', type: 'button', onclick: function () { location.hash = '#task/' + i.number; } }, 'Open', h('span', { class: 'sr-only' }, ' ' + i.title)),
          h('button', { class: 'btn2', type: 'button', onclick: function () { archiveTask(i); } }, 'Archive', h('span', { class: 'sr-only' }, ' ' + i.title))));
    }))));
  return [
    header('Task overview', ['Start something new, or pick up work in progress. Not sure where to start? See ', h('a', { href: '#how' }, 'How it works'), '.']),
    h('div', { class: 'card' }, h('h3', {}, 'Start a new task'), h('div', { class: 'grid-start' }, starters)),
    h('div', { class: 'card' }, h('div', { class: 'between' }, h('h3', {}, 'Work in progress'), h('span', { class: 'hint' }, 'Updates every 30 seconds.')), body)
  ];
};

/* ---------- How it works ---------- */
SCREENS.how = function () {
  const route5 = [
    ['Deep research', 'Know the audience: their fears, words and what they’ve tried.'],
    ['Shocking angles', 'Turn the research into scary, specific angles. You pick.'],
    ['Write a script', 'One script per angle on a proven engine. Approve the plan first.'],
    ['Feedback rounds', 'High-level, then line by line, on the task page.'],
    ['Your final', 'Mark it final so the system learns. When it wins, Add a winner.']
  ];
  const exs = S.data.examples;
  return [
    header('How it works', 'The order our strongest scripts were made in, and what each task is for. Every example below is a real request and a real output.'),
    h('div', { class: 'card' }, h('h3', {}, 'The route to a strong script'),
      h('div', { class: 'route' }, route5.map(function (r, i) {
        return h('div', { class: 'tile' }, h('div', { class: 'step' }, 'STEP ' + (i + 1)), h('h4', {}, r[0]), h('div', { class: 'hint' }, r[1]));
      })),
      h('div', { class: 'hint' }, 'Skip a step when you already have it (an angle, or research that’s already saved).')),
    FORM_TYPES.map(function (t) {
      const e = exs[t.key]; if (!e) return null;
      return h('div', { class: 'card' },
        h('div', { class: 'between' }, h('h3', {}, e.name || t.name), h('span', { class: 'hint' }, e.group || t.group)),
        h('div', { class: 'hint', style: 'font-size:13px' }, e.what || ''),
        e.request ? h('div', { class: 'ex' }, h('div', { class: 'b' }, 'A real request'), h('blockquote', {}, e.request)) : null,
        e.sample ? h('div', { class: 'hint' }, 'What came back: ', dlLink(e.sample)) : null);
    })
  ];
};

/* ---------- form helpers ---------- */
function form(type, defaults) {
  if (!S.forms[type]) S.forms[type] = Object.assign({ _uploads: {} }, JSON.parse(JSON.stringify(defaults || {})));
  return S.forms[type];
}
function reqMark() { return h('span', { class: 'req', 'aria-hidden': 'true' }, '*'); }
function field(label, control, o) {
  o = o || {};
  const id = control.id || (control.id = nextId('f'));
  return h('div', { class: 'lbl' },
    h('label', { for: id }, label, o.req ? [' ', reqMark(), h('span', { class: 'sr-only' }, ' (required)')] : null, o.opt ? [' ', h('span', { class: 'opt' }, o.opt)] : null),
    control, o.hint ? h('span', { class: 'hint' }, o.hint) : null);
}
function input(st, key, o) {
  o = o || {};
  return h('input', { class: 'in', value: st[key] || '', placeholder: o.placeholder, 'aria-label': o.aria, type: o.type || 'text', oninput: function (e) { st[key] = e.target.value; if (o.onchange) o.onchange(); revalidate(); } });
}
function textarea(st, key, o) {
  o = o || {};
  const t = h('textarea', { class: 'in', rows: o.rows || 4, placeholder: o.placeholder, 'aria-label': o.aria, oninput: function (e) { st[key] = e.target.value; revalidate(); } });
  t.value = st[key] || '';
  return t;
}
function select(st, key, options, o) {
  o = o || {};
  if (st[key] == null && options.length) st[key] = options[0][0];
  const s = h('select', { class: 'in', onchange: function (e) { st[key] = e.target.value; if (o.rerender) render(); else revalidate(); } },
    options.map(function (op) { return h('option', { value: op[0], selected: st[key] === op[0] ? true : null }, op[1]); }));
  s.value = st[key] == null ? '' : st[key];
  return s;
}
function productSelect(st, extra) {
  const opts = products().map(function (p) { return [p, p]; }).concat(extra || []);
  if (!opts.length) opts.push(['', '(no products loaded)']);
  return select(st, 'product', opts, { rerender: true });
}
function chips(st, key, options, label) {
  return h('div', { class: 'wrap-row', role: 'group', 'aria-label': label },
    options.map(function (op) {
      return h('button', { class: 'chip', type: 'button', 'aria-pressed': st[key] === op[0] ? 'true' : 'false', onclick: function () { st[key] = op[0]; render(); } }, op[1]);
    }));
}
function checkbox(st, key, label) {
  return h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!st[key], onchange: function (e) { st[key] = e.target.checked; revalidate(); } }), h('span', {}, label));
}
function examples(list, summary) {
  if (!list || !list.length) return null;
  return h('details', { class: 'ex' }, h('summary', {}, summary || 'See real examples'),
    list.map(function (x) { return h('blockquote', {}, quoteEx(x)); }));
}
function quoteEx(x) { // quote the person's words; "request → what it became" keeps the arrow part outside the quotes
  x = String(x);
  if (/^["“]/.test(x)) return x;
  const i = x.indexOf(' → ');
  return i > 0 ? '"' + x.slice(0, i) + '"' + x.slice(i) : '"' + x + '"';
}

/* uploads: stored right away at uploads/<login>/<stamp>/<file>; the path is shown */
function uploadsOf(st, key) { st._uploads[key] = st._uploads[key] || []; return st._uploads[key]; }
function storedPaths(st, key) { return uploadsOf(st, key).filter(function (u) { return u.state === 'stored'; }).map(function (u) { return u.path; }); }
function allStored(st) { let out = []; Object.keys(st._uploads).forEach(function (k) { out = out.concat(storedPaths(st, k)); }); return out; }
function anyUploading(st) { return Object.keys(st._uploads).some(function (k) { return st._uploads[k].some(function (u) { return u.state === 'uploading'; }); }); }
function uploader(st, key, text, o) {
  o = o || {};
  const list = h('ul', { class: 'uplist', 'aria-live': 'polite' });
  const fileInput = h('input', { type: 'file', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true', accept: o.accept || null, multiple: o.multiple === false ? null : true });
  function draw() {
    setKids(list, uploadsOf(st, key).map(function (u, idx) {
      let status;
      if (u.state === 'uploading') status = h('span', { class: 'wrap-row' }, 'Uploading ' + Math.round(u.pct * 100) + '%', h('span', { class: 'bar', role: 'progressbar', 'aria-valuenow': Math.round(u.pct * 100), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Upload progress for ' + u.name }, h('span', { style: 'width:' + Math.round(u.pct * 100) + '%' })));
      else if (u.state === 'stored') status = h('span', {}, 'Stored at ', h('span', { class: 'path' }, u.path));
      else status = h('span', { class: 'bad' }, 'Failed: ' + u.error);
      return h('li', {}, h('span', { class: 'b' }, u.name), status,
        u.state !== 'uploading' ? h('button', { class: 'btn2 xs', type: 'button', onclick: function () { uploadsOf(st, key).splice(idx, 1); draw(); revalidate(); } }, 'Remove from this task', h('span', { class: 'sr-only' }, ': ' + u.name)) : null);
    }));
  }
  fileInput.addEventListener('change', function () {
    const files = Array.prototype.slice.call(fileInput.files || []);
    fileInput.value = '';
    st._stamp = st._stamp || stampNow();
    files.forEach(function (f) {
      const taken = allStoredOrPending(st);
      let name = sanitizeFilename(f.name); let path = uploadPath(S.login, st._stamp, name); let k = 2;
      while (taken.indexOf(path) >= 0) { name = sanitizeFilename(f.name).replace(/(\.[^.]+)?$/, '-' + k + '$1'); path = uploadPath(S.login, st._stamp, name); k++; }
      const u = { name: f.name, path: path, state: 'uploading', pct: 0 };
      uploadsOf(st, key).push(u); draw(); revalidate();
      if (f.size > 50 * 1024 * 1024) { u.state = 'failed'; u.error = 'over 50 MB; GitHub cannot take it this way.'; draw(); revalidate(); return; }
      b64FromFile(f).then(function (b64) {
        return putContents(path, b64, 'upload: ' + basename(path), null, function (p) { u.pct = p; draw(); });
      }).then(function () { u.state = 'stored'; u.pct = 1; draw(); revalidate(); if (o.onStored) o.onStored(u); })
        .catch(function (e) { u.state = 'failed'; u.error = errText(e); draw(); revalidate(); });
    });
  });
  draw();
  return h('div', { class: 'stack-sm' },
    h('div', { class: 'file' }, h('span', {}, text), h('button', { class: 'btn2', type: 'button', onclick: function () { fileInput.click(); } }, o.button || 'Upload'), fileInput),
    list);
}
function allStoredOrPending(st) { let out = []; Object.keys(st._uploads).forEach(function (k) { out = out.concat(st._uploads[k].filter(function (u) { return u.state !== 'failed'; }).map(function (u) { return u.path; })); }); return out; }

/* search over RESEARCH-INDEX.json + checkboxes */
function researchPicker(st, key, placeholder) {
  st[key] = st[key] || [];
  const q = h('input', { class: 'in', placeholder: placeholder, 'aria-label': 'Search saved research', value: st[key + 'Q'] || '' });
  const list = h('div', { class: 'stack-sm' });
  const note = h('div', { class: 'hint' });
  function draw() {
    const words = (st[key + 'Q'] || '').toLowerCase().split(/\s+/).filter(Boolean);
    const idx = S.data.index || [];
    const prod = st.product;
    const sel = idx.filter(function (r) { return st[key].indexOf(r.path) >= 0; });
    const hits = idx.filter(function (r) {
      if (st[key].indexOf(r.path) >= 0) return false;
      const hay = (r.name + ' ' + r.kind + ' ' + r.product + ' ' + r.path).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    }).sort(function (a, b) { return ((b.product === prod) - (a.product === prod)) || String(b.date).localeCompare(String(a.date)); });
    const shown = hits.slice(0, 10);
    setKids(list, sel.concat(shown).map(function (r) {
      return h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: st[key].indexOf(r.path) >= 0, onchange: function (e) {
        if (e.target.checked) st[key].push(r.path); else st[key] = st[key].filter(function (p) { return p !== r.path; });
        draw(); revalidate();
      } }), h('span', {}, r.name + ' ', h('span', { class: 'hint' }, '· ' + r.kind + ' · ' + r.product + (r.date ? ' · ' + monthYear(r.date) : ''))));
    }));
    note.textContent = !idx.length ? 'No saved research loaded.' : hits.length > shown.length ? 'Showing ' + shown.length + ' of ' + hits.length + '. Type to narrow the list.' : (hits.length ? '' : 'Nothing matches.') + (sel.length ? ' ' + sel.length + ' picked.' : '');
  }
  q.addEventListener('input', function () { st[key + 'Q'] = q.value; draw(); });
  draw();
  return [q, list, note];
}

/* the submit footer + "Missing before you can submit" check */
let activeValidate = null;
function revalidate() { if (activeValidate) activeValidate(); }
function submitBar(type, collect, o) {
  const st = form(type);
  const missing = h('div', { class: 'gate slim', hidden: true });
  const btn = h('button', { class: 'btn', type: 'button' }, o.button);
  const err = h('div', { class: 'gate err', hidden: true, role: 'alert' });
  function validate() {
    const c = collect();
    const miss = c.missing.slice();
    if (anyUploading(st)) miss.push('wait for the uploads to finish');
    missing.hidden = !miss.length;
    missing.textContent = 'Missing before you can submit: ' + miss.join(', ') + '.';
    btn.disabled = !!miss.length || st._sending;
    return c;
  }
  btn.addEventListener('click', async function () {
    const c = validate(); if (c.missing.length || anyUploading(st)) return;
    st._sending = true; btn.disabled = true; btn.textContent = 'Sending…'; err.hidden = true;
    try {
      const files = c.files.concat(allStored(st));
      const issue = await api('POST', repoPath('/issues'), { body: { title: buildIssueTitle(type, c.short), body: buildIssueBody(type, c.fields, files), labels: ['task', 'type:' + type] } });
      delete S.forms[type];
      S.issues.unshift(issue);
      toast('Task #' + issue.number + ' started. Track it in Task overview.');
      location.hash = '#task/' + issue.number;
    } catch (e) {
      st._sending = false; btn.textContent = o.button; err.hidden = false; err.textContent = errText(e); validate();
    }
  });
  activeValidate = validate;
  setTimeout(validate, 0);
  return h('div', { class: 'stack-sm' }, missing, err,
    h('div', { class: 'wrap-row' }, btn, o.timing ? h('span', { class: 'hint' }, o.timing) : null));
}
function lines(v) { return String(v || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }

/* ---------- Persona research ---------- */
SCREENS.persona = function () {
  const st = form('persona', { pr: '' });
  const L = { list: 'Personas or angles, one per line' };
  const deeper = ['Sentiments and frustrations', 'Skepticism', 'Where other products fail them', 'At least the top 10 objections'];
  function collect() {
    const missing = [];
    if (!st.product) missing.push('the product');
    if (!lines(st.list).length) missing.push('at least one persona or angle');
    return { missing: missing, short: lines(st.list).join(' · '), files: [],
      fields: [['Product', st.product], [L.list, st.list], ['Go deeper on (always)', deeper.join(' · ')]] };
  }
  const prods = products();
  if (!st.pr) st.pr = prods[0] || '';
  const past = (S.data.index || []).filter(function (r) { return r.product === st.pr && !/listicle|scripts|playbook|product dossier/.test(r.kind); });
  return [
    header('Persona research', 'Our original customer research: one briefing per buyer or angle, to understand how they think. Always delivered in our standard persona format.'),
    h('div', { class: 'card' },
      field('Product', productSelect(st), { req: true }),
      field(L.list, textarea(st, 'list', { rows: 4 }), { req: true }),
      examples(exField('persona', L.list)),
      h('div', { class: 'hint' }, 'Every briefing always goes deeper on: ' + deeper.join(' · ') + '.'),
      h('div', { class: 'hint' }, 'Several personas run one at a time; you’re asked before each next one.'),
      submitBar('persona', collect, { button: 'Start persona research' })),
    h('div', { class: 'card' },
      h('div', { class: 'between' }, h('h3', {}, 'Appendix: research we’ve already done'), chips(st, 'pr', prods.map(function (p) { return [p, p]; }), 'Product')),
      h('div', { class: 'stack-sm' }, past.length ? past.map(function (p) {
        return h('div', { class: 'file solid' }, h('span', {}, p.name + ' ', h('span', { class: 'hint' }, '· ' + p.kind + (p.date ? ' · ' + monthYear(p.date) : ''))), dlLink(p.path, 'Open'));
      }) : h('div', { class: 'empty' }, 'Nothing saved for this product yet.')))
  ];
};

/* ---------- Shocking angles ---------- */
SCREENS.angles = function () {
  const st = form('angles', { from: 'mech' });
  const Q = {
    mech: ['A mechanism or angle', 'Which mechanism or angle are you trying to make shocking?', 'e.g. a body process working against the buyer', 'mechanism'],
    user: ['A type of buyer', 'What type of buyer are you trying to shock into buying?', 'e.g. men on GLP-1 who are losing muscle along with the fat', 'user'],
    ben: ['A benefit', 'Which benefits are you trying to find shocking facts about?', 'e.g. energy, muscle growth, focus', 'benefit']
  };
  const MINE = 'Mine our reviews and a rival’s for how buyers describe these problems';
  const bench = ex('angles').benchmarks || [];
  const q = Q[st.from];
  function collect() {
    const missing = [];
    if (!st.product) missing.push('the product');
    if (!(st['q_' + st.from] || '').trim()) missing.push('what you are starting from');
    return { missing: missing, short: st['q_' + st.from], files: [],
      fields: [['Product', st.product], ['What are you starting from?', q[0]], [q[1], st['q_' + st.from]], ['The bar to beat', bench.join(' · ')], ['Other angles you liked', st.liked], [MINE, 'yes (always)']] };
  }
  return [
    header('Shocking angles', 'Turns a mechanism, a buyer or a benefit into scary, number-led ad angles. You pick the best; they become fact-checked hook cards ready for Write a script.'),
    h('div', { class: 'card' },
      field('Product', productSelect(st), { req: true }),
      h('h4', {}, 'What are you starting from? ', reqMark()),
      chips(st, 'from', [['mech', Q.mech[0]], ['user', Q.user[0]], ['ben', Q.ben[0]]], 'What are you starting from?'),
      field(q[1], input(st, 'q_' + st.from, { placeholder: q[2] })),
      examples(exField('angles', q[3]), 'What past inputs led to'),
      h('div', { class: 'tile' }, h('h4', {}, 'The bar to beat'),
        h('div', { class: 'hint' }, 'Every new angle is held to our best: ', bench.length ? bench.map(function (b, i) { return [i ? ' · ' : '', h('b', { class: 'b' }, b)]; }) : '(not loaded)', '.'),
        field('Other angles you liked', input(st, 'liked', { placeholder: 'e.g. an earlier angle that worked' }), { opt: '(optional)' })),
      h('div', { class: 'hint' }, 'Always included: our reviews and a rival’s are mined for how buyers describe these problems.'),
      uploader(st, 'ctx', ['Add context ', h('span', { class: 'opt' }, '(optional)'), ': notes, a brief, screenshots']),
      h('div', { class: 'gate' }, 'You’ll get 12–20 candidates, each with its number, what it lands on (sex · looking like a man · drive/money · death) and its strength. You pick (e.g. "I like 1, 3, 6"); only those become hook cards.'),
      submitBar('angles', collect, { button: 'Find angles', timing: 'About 20–30 minutes. Track it in Task overview.' }))
  ];
};

/* ---------- Deep research ---------- */
SCREENS.deep = function () {
  const st = form('deep', {});
  const G = 'The group or problem, in one line';
  const core = ex('deep').coreQuestions || [];
  function collect() {
    const missing = [];
    if (!st.product) missing.push('the product');
    if (!(st.group || '').trim()) missing.push('the group or problem');
    return { missing: missing, short: st.group, files: [], fields: [['Product', st.product], [G, st.group], ['Extra questions', st.extra]] };
  }
  return [
    header('Deep research', 'Our benchmark research treatment for any group or problem: Reddit threads, reviews, studies and the ads they see, answering our five core questions. Saved for every future task.'),
    h('div', { class: 'card' },
      field('Product', productSelect(st), { req: true }),
      field(G, input(st, 'group', { placeholder: 'Who you want to understand' }), { req: true }),
      examples(exField('deep', G)),
      h('div', { class: 'tile' }, h('h4', {}, 'The five core questions (always answered)'),
        core.length ? h('details', { class: 'ex' }, h('summary', {}, 'Show the five questions'),
          h('blockquote', {}, core.map(function (c, i) { return [i ? h('br') : null, (i + 1) + '. ' + c]; }))) : h('div', { class: 'hint' }, '(not loaded)')),
      field('Extra questions', textarea(st, 'extra', { rows: 3, placeholder: 'Anything else you want answered. Answers the core five don’t cover go in an appendix.' }), { opt: '(optional)' }),
      h('div', { class: 'hint' }, 'Depth: at least our benchmark standard, always: 2,300+ real quotes and data points, 600+ from Reddit threads, 350+ from reviews, an 18,000+ word document. If Reddit blocks the usual route, ' + APP + ' uses the tested workarounds. A thinner run is sent back, not delivered.'),
      uploader(st, 'ctx', ['Add context ', h('span', { class: 'opt' }, '(optional)'), ': earlier research, notes']),
      submitBar('deep', collect, { button: 'Start research', timing: 'A few hours. Track it in Task overview.' }))
  ];
};

/* ---------- Write a script ---------- */
SCREENS.script = function () {
  const st = form('script', { hasAngle: 'yes', angle: '', count: '1', engine: 'propose', who: 'creator', cast: 'pick', research: [], openEng: '', openEx: '', deep: false });
  const A = 'Your angle OR hook, in one line';
  const N = 'Your narrative or sales argument';
  const PROPOSE = 'Let ' + APP + ' propose';
  const pk = productKey(st.product || products()[0]);
  const engines = (S.data.engines || []).filter(function (e) { return !e.products || e.products.indexOf(pk) >= 0; });
  const cast = ((ex('script').cast || {})[pk]) || [];
  const castOpts = [['pick', 'Let ' + APP + ' pick from the winner’s cast']].concat(cast.map(function (c) { return [c, c]; })).concat([['new', 'Someone new (add their Instagram below)']]);
  if (castOpts.map(function (o) { return o[0]; }).indexOf(st.cast) < 0) st.cast = 'pick';
  if (st.engine !== 'propose' && !engines.some(function (e) { return e.name === st.engine; })) st.engine = 'propose';

  function collect() {
    if (st.angle === undefined && Array.isArray(st.angles)) st.angle = st.angles[0] || '';  // saved drafts from the old form
    const angle = (st.angle || '').trim();
    const missing = [];
    if (!st.product) missing.push('the product');
    if (!angle) missing.push('your angle or hook');
    let who = '';
    if (st.who === 'ai') who = 'AI Voiceover';
    else if (st.who === 'creator') { who = 'Creator'; if (!(st.creatorDesc || '').trim()) missing.push('a description of the creator'); }
    else {
      who = 'Influencer — ' + (st.cast === 'pick' ? castOpts[0][1] : st.cast === 'new' ? 'Someone new' : st.cast);
      if (st.cast === 'new' && !(st.infLink || '').trim()) missing.push('the new influencer’s Instagram link');
    }
    const model = [st.modelLink].concat(storedPaths(st, 'model')).filter(function (x) { return x && String(x).trim(); }).join('\n');
    return { missing: missing, short: angle, files: st.research.slice(),
      fields: [['Product', st.product], ['How many scripts', st.count], [A, angle], [N, st.narrative],
        ['Engine', st.engine === 'propose' ? PROPOSE : st.engine], ['A script to model on', model], ['Who says it', who],
        ['Tone of voice', st.who === 'ai' ? st.tone : ''], ['Describe the creator', st.who === 'creator' ? st.creatorDesc : ''],
        ['New influencer’s Instagram (look them up and study how they talk)', st.who === 'inf' && st.cast === 'new' ? st.infLink : ''], ['Do proper research into each angle first', st.deep ? 'yes' : 'no']] };
  }

  const gateCard = h('div', { class: 'card' }, h('h3', {}, 'Do you have an angle yet?'),
    chips(st, 'hasAngle', [['yes', 'Yes, I have one'], ['no', 'No, help me find one']], 'Do you have an angle yet?'),
    st.hasAngle === 'no' ? h('div', { class: 'gate' }, 'Our strongest scripts start from a scary, specific angle. Do this first, then come back: ',
      h('button', { class: 'btn2', type: 'button', onclick: function () { go('angles'); } }, 'Find shocking angles'), ' ',
      h('button', { class: 'btn2', type: 'button', onclick: function () { go('deep'); } }, 'Deep research on the audience'),
      h('br'), 'Already did one? Pick it below under "Research and context" and its angles come in automatically.') : null);
  const out = [header('Write a script', 'Video scripts built on our proven winners. Each script comes back as one Review Cut (Word): five hooks A–E and the full script.'), gateCard];
  if (st.hasAngle !== 'yes') { activeValidate = null; return out; }

  if (st.angle === undefined && Array.isArray(st.angles)) st.angle = st.angles[0] || '';
  const angleIn = h('input', { class: 'in', value: st.angle || '', placeholder: 'One line: the scary, specific idea, or the hook you want to open with', oninput: function (e) { st.angle = e.target.value; revalidate(); } });
  out.push(h('div', { class: 'card' },
    h('div', { class: 'row2' }, field('Product', productSelect(st), { req: true }), field('How many scripts', input(st, 'count'), { opt: '(all on this one angle)' })),
    field(A, angleIn, { req: true, hint: 'One angle per script. For another angle, start a new task.' }), examples(exField('script', A)),
    field(N, textarea(st, 'narrative', { rows: 4, placeholder: 'Problem → why it happens → what the product does → proof' }), { opt: '(optional, bullets are fine)' }),
    examples(exField('script', N))));

  const others = products().filter(function (p) { return productKey(p) !== 'b2o'; });
  const shareNote = others.map(function (p) {
    const k = productKey(p); const names = (S.data.engines || []).filter(function (e) { return (e.products || []).indexOf(k) >= 0 && (e.products || []).indexOf('b2o') >= 0; }).map(function (e) { return e.name; });
    const b = products().filter(function (x) { return productKey(x) === 'b2o'; })[0];
    return names.length && b ? p + ' uses the ' + b + ' structures (' + names.join(', ') + ').' : '';
  }).filter(Boolean).join(' ');
  out.push(h('div', { class: 'card' }, h('h3', {}, 'Structure (engine)'),
    h('div', { class: 'hint' }, 'Once you type your angle, each engine gets a match score out of 10 for it. ' + APP + ' proposes the best and you approve it before writing, or pick one yourself.'),
    h('label', { class: 'chk' }, h('input', { type: 'radio', name: 'eng', checked: st.engine === 'propose', onchange: function () { st.engine = 'propose'; render(); } }), 'Let ' + APP + ' propose the best match (recommended)'),
    h('div', { class: 'grid-eng' }, engines.length ? engines.map(function (e) {
      const open = st.openEng === e.name; const openEx = st.openEx === e.name;
      return h('div', { class: 'tile eng' + (st.engine === e.name ? ' chosen' : '') },
        h('div', { class: 'between' }, h('h4', {}, e.name), h('span', { class: 'pill grey', title: 'Scores appear once a score source exists' }, 'Match —/10')),
        h('div', { class: 'hint' }, e.description + ' ', h('span', { class: 'dim' }, 'Based on ' + e.basedOn + '.')),
        h('div', { class: 'hint' }, h('b', { class: 'b' }, 'Best for:'), ' ' + e.bestFor),
        h('div', { class: 'wrap-row' },
          h('button', { class: 'btn2 sm', type: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: function () { st.openEng = open ? '' : e.name; render(); } }, open ? 'Hide structure' : 'View structure'),
          h('button', { class: 'btn2 sm', type: 'button', 'aria-expanded': openEx ? 'true' : 'false', onclick: function () { st.openEx = openEx ? '' : e.name; render(); } }, openEx ? 'Hide scripts' : 'Scripts using it'),
          h('label', { class: 'chk', style: 'font-size:13px' }, h('input', { type: 'radio', name: 'eng', checked: st.engine === e.name, onchange: function () { st.engine = e.name; render(); } }), 'Use', h('span', { class: 'sr-only' }, ' ' + e.name))),
        open ? h('div', { class: 'hint' }, h('b', { class: 'b' }, 'Beats:'), ' ' + e.beats) : null,
        openEx ? h('div', { class: 'hint' }, h('b', { class: 'b' }, 'Winners:'), ' ' + e.winners, h('br'), h('b', { class: 'b' }, 'Your finals:'), ' ' + e.finals) : null);
    }) : h('div', { class: 'empty' }, 'No engines loaded.')),
    shareNote ? h('div', { class: 'hint' }, shareNote) : null,
    h('div', { class: 'lbl' }, h('span', {}, 'A script to model on ', h('span', { class: 'opt' }, '(optional)')),
      input(st, 'modelLink', { placeholder: 'Paste a link', aria: 'Link to a script to model on' }),
      uploader(st, 'model', 'Paste a link, or upload a script you like the style of'),
      h('span', { class: 'hint' }, 'Used for this task only. It joins the template library only after it proves itself, through Add a winner.'))));

  const whoCard = h('div', { class: 'card' }, h('h3', {}, 'Who says it'),
    chips(st, 'who', [['ai', 'AI Voiceover'], ['creator', 'Creator'], ['inf', 'Influencer']], 'Who says it'));
  if (st.who === 'ai') whoCard.appendChild(field('Tone of voice', input(st, 'tone', { placeholder: 'e.g. calm, doctor-like narrator; urgent and alarming' })));
  if (st.who === 'creator') whoCard.appendChild(field('Describe the creator', input(st, 'creatorDesc', { placeholder: 'e.g. Personal trainer who has trained 2,000+ clients; big, friendly, no-nonsense' }), { req: true }));
  if (st.who === 'inf') {
    whoCard.appendChild(field('Which influencer', select(st, 'cast', castOpts, { rerender: true })));
    if (st.cast === 'new') whoCard.appendChild(field('Their Instagram link', input(st, 'infLink', { placeholder: 'https://www.instagram.com/…' }), { req: true, hint: APP + ' looks them up, studies how they talk and tailors the script to them.' }));
  }
  out.push(whoCard);

  out.push(h('div', { class: 'card' }, h('h3', {}, 'Research and context'),
    h('div', { class: 'hint' }, APP + ' already reads the product’s dossier, winners and your finals. Add anything else this script should lean on.'),
    checkbox(st, 'deep', 'Do proper research into each angle first'),
    researchPicker(st, 'research', 'Search saved research, angles and scripts…'),
    uploader(st, 'ctx', 'Or upload files: research, angle cards, a write-up, screenshots')));

  out.push(h('div', { class: 'card' },
    h('div', { class: 'hint' }, 'Takes about 20–30 minutes per batch. You don’t need to wait: start another task or close the page, and track it in Task overview. First you’ll approve the plan (engine, creator, idea per script).'),
    submitBar('script', collect, { button: 'Submit' })));
  return out;
};

/* ---------- Script iteration analysis ---------- */
SCREENS.iteration = function () {
  const st = form('iteration', {});
  const L = 'Facebook post links (with comments), one per line';
  const sample = ex('iteration').sampleUrl || '';
  function collect() {
    const n = lines(st.links).length;
    return { missing: n ? [] : ['at least one ad link'], short: n + (n === 1 ? ' ad' : ' ads'), files: [],
      fields: [[L, st.links]] };
  }
  return [
    header('Script iteration analysis', 'For ads that showed promise but didn’t win. You get, per ad, a short performance summary against the account average and an edit brief: what to keep, what’s leaking, what to change. Edit it, then hand it to the video editors.'),
    h('div', { class: 'card' },
      field(L, textarea(st, 'links', { rows: 4, placeholder: sample }), { req: true,
        hint: ['Use the ad’s "Facebook Post with Comments" link: it looks like ', h('code', {}, 'facebook.com/<page id>/posts/<post id>/?dco_ad_id=<ad id>'), '. The full ad name works too.'] }),
      h('div', { class: 'hint' }, 'Stats come from Meta and Moby (read-only) and are compared with the account averages already stored in the skill. Comes back as one Word doc per ad: full ad name · stats with the average in grey · KEEP / LEAK / EDIT · word-for-word transcript with timestamps. Two or more ads also get one summary scoreboard.'),
      submitBar('iteration', collect, { button: 'Analyse ads', timing: 'About 10–20 minutes per ad.' }))
  ];
};

/* ---------- Add a winner ---------- */
SCREENS.winner = function () {
  const st = form('winner', {});
  const L = 'Paste the winning ads, one link per line';
  const sample = ex('winner').sampleUrl || '';
  function collect() {
    const n = lines(st.links).length;
    return { missing: n ? [] : ['at least one winning ad'], short: n + (n === 1 ? ' winner' : ' winners') + (st.product ? ' · ' + st.product : ''), files: [],
      fields: [[L, st.links], ['Product', st.product], ['Why it’s a winner', st.why]] };
  }
  return [
    header('Add a winner', 'For ads that proved themselves. ' + APP + ' transcribes each, breaks the script down line by line, and adds it to the master template library and the product’s winner pack, so every future script can use it.'),
    h('div', { class: 'card' },
      field(L, textarea(st, 'links', { rows: 4, placeholder: sample }), { req: true, hint: 'Just the links: the "Facebook Post with Comments" link, or the full ad name. No other instructions needed.' }),
      h('div', { class: 'row2' }, field('Product', productSelect(st)), field('Why it’s a winner', input(st, 'why', { placeholder: 'e.g. past 90 days, spend above our winner bar' }), { opt: '(optional)' })),
      h('div', { class: 'hint' }, 'Duplicates of each other or of winners we already have are flagged automatically. Comes back as the updated master template reference and a short note on what changed.'),
      submitBar('winner', collect, { button: 'Add winners' }))
  ];
};

/* ---------- Product launch dossier ---------- */
SCREENS.dossier = function () {
  const st = form('dossier', {});
  const L = 'Product page link or name';
  const e = ex('dossier');
  function collect() {
    return { missing: (st.link || '').trim() ? [] : ['the product page link or name'], short: st.link, files: [],
      fields: [[L, st.link], ['Ingredient label', storedPaths(st, 'label').join('\n')]] };
  }
  const linkIn = input(st, 'link', { placeholder: 'https://…/products/…' });
  return [
    header('Product launch dossier', 'For a new product: what’s in it, the real science per ingredient, why it wins, and what we can say. Becomes the source of truth for every later task on that product.'),
    h('div', { class: 'card' },
      field(L, linkIn, { req: true }),
      h('div', { class: 'lbl' }, h('span', {}, 'Ingredient label ', h('span', { class: 'opt' }, '(screenshot)')), uploader(st, 'label', 'Drop the Supplement Facts panel', { accept: 'image/*,.pdf' })),
      e.request ? h('details', { class: 'ex' }, h('summary', {}, 'See a real example'), h('blockquote', {}, e.request + (e.sample ? ' → ' + basename(e.sample) : ''))) : null,
      h('div', { class: 'hint' }, APP + ' then asks one short set of questions (who reads it, which rival to compare against, any brand claims to check).'),
      (e.waiting || []).length ? h('div', { class: 'card inner' }, h('h4', {}, 'Products waiting to launch'),
        e.waiting.map(function (w) {
          return h('div', { class: 'file' }, h('span', {}, w.name + ' · ' + String(w.status || '').toLowerCase()),
            h('button', { class: 'btn2', type: 'button', onclick: function () { st.link = w.name; render(); } }, 'Add material', h('span', { class: 'sr-only' }, ' for ' + w.name)));
        })) : null,
      submitBar('dossier', collect, { button: 'Build dossier' }))
  ];
};

/* ---------- Product launch playbook ---------- */
SCREENS.playbook = function () {
  const st = form('playbook', {});
  const ds = (ex('playbook').dossiers || []);
  function collect() { return { missing: st.dossier ? [] : ['the dossier'], short: st.dossier, files: [], fields: [['Dossier', st.dossier]] }; }
  return [
    header('Product launch playbook', 'Built on a finished dossier: the go-to-market playbook, then a persona briefing for each audience.'),
    h('div', { class: 'card' },
      field('Dossier', select(st, 'dossier', ds.length ? ds.map(function (d) { return [d, d + ' (done)']; }) : [['', '(no dossiers loaded)']]), { req: true, hint: 'No dossier yet? Build one first in Product launch dossier.' }),
      h('div', { class: 'gate' }, 'Two stops for you: confirm the persona list (5–7), then approve the playbook before the persona briefings are written.'),
      submitBar('playbook', collect, { button: 'Build playbook' }))
  ];
};

/* ---------- Listicle copy expansion ---------- */
SCREENS.listicle = function () {
  const st = form('listicle', { mode: 'aud', last2: '365-day guarantee + receipts', ctxPick: [] });
  const AUD = 'Audiences, one per line'; const ANG = 'The angle or concept';
  function collect() {
    const missing = [];
    if (!st.product) missing.push('the product');
    if (!(st.ref || '').trim() && !storedPaths(st, 'shots').length) missing.push('the reference listicle');
    if (st.mode === 'aud' && !lines(st.aud).length) missing.push('at least one audience');
    if (st.mode === 'ang' && !(st.ang || '').trim()) missing.push('the angle or concept');
    return { missing: missing, short: st.mode === 'aud' ? lines(st.aud).join(' · ') : st.ang, files: st.ctxPick.slice(),
      fields: [['Product', st.product], ['Reference listicle', st.ref], ['Tailor it to', st.mode === 'aud' ? 'Audiences (one version each)' : 'One angle or concept'],
        [AUD, st.mode === 'aud' ? st.aud : ''], [ANG, st.mode === 'ang' ? st.ang : ''], ['The ad people arrive from', st.arrive],
        ['Your narrative for the reasons', st.narr], ['Last two reasons', st.last2]] };
  }
  return [
    header('Listicle copy expansion', 'Takes one of our "9 reasons" listicles and writes new versions: the top of the page and all 9 reasons, for each audience or angle.'),
    h('div', { class: 'card' },
      h('div', { class: 'row2' }, field('Product', productSelect(st), { req: true }), field('Reference listicle', input(st, 'ref', { placeholder: 'Live link, or upload screenshots below' }), { req: true })),
      h('h4', {}, 'Tailor it to'),
      chips(st, 'mode', [['aud', 'Audiences (one version each)'], ['ang', 'One angle or concept']], 'Tailor it to'),
      st.mode === 'aud' ? [field(AUD, textarea(st, 'aud', { rows: 4 }), { req: true }), examples(exField('listicle', 'audiences'), 'See a real example')]
        : [field(ANG, input(st, 'ang'), { req: true }), examples(exField('listicle', 'angle'), 'See a real example')],
      field('The ad people arrive from', input(st, 'arrive', { placeholder: 'e.g. an ad that says \'don\'t buy fat burners, most of them are junk\'' }), { opt: '(optional)' }),
      field('Your narrative for the reasons', textarea(st, 'narr', { rows: 3 }), { opt: '(optional; direction, not a script)' }),
      field('Last two reasons', input(st, 'last2')),
      h('div', { class: 'lbl' }, h('span', {}, 'Context to use ', h('span', { class: 'opt' }, '(research, persona files, scripts, dossier: anything relevant)')), researchPicker(st, 'ctxPick', 'Search saved files…')),
      uploader(st, 'shots', 'Upload the reference screenshots or other files'),
      h('div', { class: 'gate' }, 'Before any reason is written, you approve the plan for each version: who lands here, the ad they clicked, the one objection, the 9 reasons and their order.'),
      submitBar('listicle', collect, { button: 'Plan listicles' }))
  ];
};

/* ---------- Context uploads ---------- */
SCREENS.context = function () {
  const st = form('context', {});
  function collect() {
    const files = storedPaths(st, 'files');
    const ls = lines(st.links);
    return { missing: files.length || ls.length ? [] : ['a file or a link'], short: st.what || (files[0] ? basename(files[0]) : ls[0]), files: [],
      fields: [['Or links, one per line', st.links], ['Product', st.product], ['What it’s for', st.what]] };
  }
  return [
    header('Context uploads', 'Add studies, articles, reviews or brand docs anytime. Each is read, filed with what it supports, and becomes searchable from every task. (Every task page also has its own upload.)'),
    h('div', { class: 'card' },
      uploader(st, 'files', 'Drop files here'),
      field('Or links, one per line', textarea(st, 'links', { rows: 3 })),
      h('div', { class: 'row2' }, field('Product', productSelect(st, [['Both / general', 'Both / general']])), field('What it’s for', input(st, 'what', { placeholder: 'e.g. proof for the tongue-fat angle' }), { opt: '(optional)' })),
      submitBar('context', collect, { button: 'Add to context' }))
  ];
};

/* ---------- learnings (protocol §6: per person; owners promote) ---------- */
function learningKind(rel) { // rel: path inside profiles/<login>/
  if (/^memory\/[^/]+\.md$/i.test(rel)) return 'memory';
  if (/^agent-memory\/[^/]+$/.test(rel)) return 'lesson';
  if (/^casebook\/(cases\/)?[^/]+$/.test(rel)) return 'case';
  if (/^proposals\/[^/]+\.md$/i.test(rel)) return 'proposal';
  if (rel === 'profile.md') return 'preferences';
  return '';
}
async function profileFiles() { // [{login, path, rel, kind}]
  let paths = [];
  if (S.tree && !S.treeTruncated) paths = S.tree.filter(function (p) { return /^profiles\/[^/]+\/./.test(p); });
  else {
    const walk = async function (dir, depth) {
      let items; try { items = await api('GET', repoPath('/contents/' + encPath(dir))); } catch (e) { return; }
      if (!Array.isArray(items)) return;
      for (const it of items) { if (it.type === 'file') paths.push(it.path); else if (it.type === 'dir' && depth < 3) await walk(it.path, depth + 1); }
    };
    await walk('profiles', 0);
  }
  return paths.map(function (p) {
    const m = /^profiles\/([^/]+)\/(.+)$/.exec(p);
    return m ? { login: m[1], path: p, rel: m[2], kind: learningKind(m[2]) } : null;
  }).filter(function (x) { return x && x.kind; });
}
const fileDates = {};
async function fileDate(path) { // date of the last commit that touched the file
  if (path in fileDates) return fileDates[path];
  try {
    const c = await api('GET', repoPath('/commits?path=' + encodeURIComponent(path) + '&per_page=1'));
    fileDates[path] = c && c[0] ? Date.parse(c[0].commit.committer.date) : 0;
  } catch (e) { fileDates[path] = 0; }
  return fileDates[path];
}
function isOwner() { return (S.data.config.owners || []).indexOf(S.login) >= 0; }
function learningView(item) { // expandable, escaped view of one file
  const body = h('div', { class: 'stack-sm' });
  const d = h('details', { class: 'tile' },
    h('summary', { class: 'between' }, h('span', {}, h('span', { class: 'b' }, basename(item.path)), ' ', h('span', { class: 'hint' }, '· ' + item.kind + (item.date ? ' · ' + new Date(item.date).toLocaleDateString() : ''))), h('span', { class: 'hint' }, 'View')),
    body);
  d.addEventListener('toggle', function () {
    if (!d.open || body.childNodes.length) return;
    body.appendChild(h('div', { class: 'empty' }, 'Loading…'));
    getText(item.path).then(function (txt) {
      body.replaceChildren(/\.md$/i.test(item.path) ? mdBlock(txt) : h('pre', { class: 'md-pre' }, txt));
    }).catch(function (e) { body.replaceChildren(h('div', { class: 'gate err' }, errText(e))); });
  });
  return d;
}

/* ---------- My profile ---------- */
SCREENS.profile = function () {
  const learnBox = h('div', { class: 'stack-sm' }, h('div', { class: 'empty' }, 'Loading…'));
  const scoreBox = h('div', { class: 'stack-sm' }, h('div', { class: 'empty' }, 'Loading…'));
  const base = 'profiles/' + S.login + '/';
  const seq = renderSeq;
  refreshTree().then(profileFiles).then(async function (all) {
    const mine = all.filter(function (x) { return x.login === S.login; });
    await Promise.all(mine.map(async function (x) { x.date = await fileDate(x.path); }));
    if (seq !== renderSeq) return;
    mine.sort(function (a, b) { return b.date - a.date; });
    setKids(learnBox, mine.length ? mine.map(learningView) : [h('div', { class: 'empty' }, 'Nothing learned yet. It fills in from your finals and feedback.')]);
  }).catch(function (e) { if (seq === renderSeq) learnBox.replaceChildren(h('div', { class: 'gate err' }, errText(e))); });
  getText(base + 'scoreboard.csv').then(function (csv) {
    if (seq !== renderSeq) return;
    const rows = parseCsv(csv);
    const col = rows.length && 'pct_words_changed' in rows[0] ? 'pct_words_changed' : rows.length && 'pct_lines_touched' in rows[0] ? 'pct_lines_touched' : '';
    const vals = rows.map(function (r) { return parseFloat(r[col]); }).filter(function (v) { return !isNaN(v); });
    if (!vals.length) { scoreBox.replaceChildren(h('div', { class: 'hint' }, 'No finals scored yet.')); return; }
    const last = vals[vals.length - 1];
    const avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    scoreBox.replaceChildren(h('div', { class: 'big' }, last.toFixed(1) + '%'),
      h('div', { class: 'hint' }, 'Words changed on your latest final. Average over ' + vals.length + ' final' + (vals.length === 1 ? '' : 's') + ': ' + avg.toFixed(1) + '%.'));
  }).catch(function (e) {
    if (seq !== renderSeq) return;
    scoreBox.replaceChildren(h('div', { class: 'hint' }, e.status === 404 ? 'No finals scored yet.' : errText(e)));
  });
  return [
    header('My profile', 'What ' + APP + ' has learned about how you like your copy. Yours only.'),
    h('div', { class: 'card' }, h('h3', {}, 'My learnings'),
      h('div', { class: 'hint' }, 'What ' + APP + ' has learned from your work. It applies to your tasks straight away. Josh can promote any of it into the core system for everyone.'),
      learnBox),
    h('div', { class: 'card' }, h('h3', {}, 'My scoreboard'), h('div', { class: 'hint' }, 'How much you change ' + APP + '’s drafts. It should fall over time.'), scoreBox)
  ];
};

/* ---------- Team learnings (owners only) ---------- */
function promoteDialog(item, onDone) {
  const note = h('textarea', { class: 'in', rows: 4, id: nextId('n'), placeholder: 'Optional: what to keep, change or merge' });
  const err = h('div', { class: 'gate err', hidden: true, role: 'alert' });
  const send = h('button', { class: 'btn', type: 'button' }, 'Promote to core');
  const cancel = h('button', { class: 'btn2', type: 'button' }, 'Cancel');
  const dlg = h('dialog', { class: 'modal', 'aria-labelledby': 'dlg-title' },
    h('div', { class: 'stack' },
      h('h3', { id: 'dlg-title' }, 'Promote to core'),
      h('div', { class: 'hint' }, 'From ', h('span', { class: 'b' }, item.login), ': ', h('code', {}, item.path)),
      h('div', { class: 'hint' }, 'Opening this task is your approval. The job writes the shared files for everyone.'),
      field('Owner’s note', note, { opt: '(optional)' }), err,
      h('div', { class: 'wrap-row' }, send, cancel)));
  cancel.addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('close', function () { dlg.remove(); });
  send.addEventListener('click', async function () {
    send.disabled = true; send.textContent = 'Sending…';
    try {
      const issue = await api('POST', repoPath('/issues'), { body: { title: 'Promote · ' + item.login + ' · ' + basename(item.path), body: buildPromoteBody(item.login, [item.path], note.value), labels: ['task', 'type:promote'] } });
      S.issues.unshift(issue);
      dlg.close(); toast('Promotion task #' + issue.number + ' opened. Track it in Task overview.');
      if (onDone) onDone();
    } catch (e) { send.disabled = false; send.textContent = 'Promote to core'; err.hidden = false; err.textContent = errText(e); }
  });
  document.body.appendChild(dlg);
  dlg.showModal();
  note.focus();
}
async function dismissLearning(item) {
  const p = 'profiles/' + item.login + '/dismissed.json';
  let sha = null; let list = [];
  try {
    const meta = await api('GET', repoPath('/contents/' + encPath(p)));
    sha = meta.sha;
    list = JSON.parse(decodeURIComponent(escape(atob(String(meta.content || '').replace(/\s/g, ''))))) || [];
  } catch (e) { if (e.status !== 404) throw e; }
  if (list.indexOf(item.path) < 0) list.push(item.path);
  await putContents(p, b64FromText(JSON.stringify(list, null, 1) + '\n'), 'dismiss: ' + item.path, sha);
  return list;
}
SCREENS.team = function () {
  if (!isOwner()) return [header('Team learnings', 'Only owners can see this page.')];
  const box = h('div', { class: 'stack' }, h('div', { class: 'empty' }, 'Loading…'));
  const seq = renderSeq;
  (async function () {
    await refreshTree();
    const all = await profileFiles();
    const logins = {}; all.forEach(function (x) { logins[x.login] = 1; });
    const dismissed = {};
    await Promise.all(Object.keys(logins).map(async function (l) {
      try { dismissed[l] = JSON.parse(await getText('profiles/' + l + '/dismissed.json')) || []; } catch (e) { dismissed[l] = []; }
    }));
    const items = all.filter(function (x) { return (dismissed[x.login] || []).indexOf(x.path) < 0; });
    await Promise.all(items.map(async function (x) { x.date = await fileDate(x.path); }));
    if (seq !== renderSeq) return;
    const groups = {};
    items.forEach(function (x) { (groups[x.login] = groups[x.login] || []).push(x); });
    Object.keys(groups).forEach(function (l) { groups[l].sort(function (a, b) { return b.date - a.date; }); });
    const order = Object.keys(groups).sort(function (a, b) { return groups[b][0].date - groups[a][0].date; });
    function draw() {
      if (!order.some(function (l) { return groups[l].length; })) { box.replaceChildren(h('div', { class: 'empty' }, 'No learnings or proposals to review.')); return; }
      setKids(box, order.filter(function (l) { return groups[l].length; }).map(function (l) {
        return h('div', { class: 'card' }, h('div', { class: 'between' }, h('h3', {}, l), h('span', { class: 'hint' }, groups[l].length + ' item' + (groups[l].length === 1 ? '' : 's'))),
          groups[l].map(function (x) {
            const dis = h('button', { class: 'btn2 sm', type: 'button' }, 'Dismiss', h('span', { class: 'sr-only' }, ' ' + x.path));
            dis.addEventListener('click', async function () {
              if (!window.confirm('Dismiss ' + basename(x.path) + ' from ' + l + '? It stays in their profile; it just leaves this list.')) return;
              dis.disabled = true;
              try { await dismissLearning(x); groups[l].splice(groups[l].indexOf(x), 1); toast('Dismissed.'); draw(); }
              catch (e) { dis.disabled = false; toast(errText(e)); }
            });
            return h('div', { class: 'stack-sm' }, learningView(x),
              h('div', { class: 'wrap-row' },
                h('button', { class: 'btn2 sm', type: 'button', onclick: function () { promoteDialog(x); } }, 'Promote to core', h('span', { class: 'sr-only' }, ' ' + x.path)), dis));
          }));
      }));
    }
    draw();
  })().catch(function (e) { if (seq === renderSeq) box.replaceChildren(h('div', { class: 'gate err' }, errText(e))); });
  return [header('Team learnings', 'Every person’s learnings and proposals, newest first. Promote what should apply to everyone; dismiss what should not.'), box];
};

/* ---------- Task page ---------- */
SCREENS.task = function (r) {
  activeValidate = null;
  const n = r.n;
  const box = h('div', { class: 'stack' }, h('div', { class: 'empty' }, 'Loading task #' + n + '…'));
  const seq = renderSeq;
  loadTask(n).then(function (t) { if (seq === renderSeq) setKids(box, taskView(t)); })
    .catch(function (e) { if (seq === renderSeq) box.replaceChildren(h('div', { class: 'gate err' }, errText(e)), h('a', { href: '#home' }, 'Back to Task overview')); });
  return box;
};
async function loadTask(n) {
  const known = S.task[n];
  let issue = (known && !known.stale && known.issue) || S.issues.filter(function (i) { return i.number === n; })[0];
  if (!issue || (known && known.stale)) issue = await api('GET', repoPath('/issues/' + n));
  const rel = await jobFiles(n);
  const pre = 'jobs/issue-' + n + '/';
  const t = S.task[n] = Object.assign(S.task[n] || { fb: {}, general: '', proposals: true, _uploads: {}, decks: {} }, { issue: issue, rel: rel, pre: pre, stale: false });
  const has = function (p) { return rel.indexOf(p) >= 0; };
  const reads = [];
  t.plan = null; t.result = null;
  if (has('PLAN.md')) reads.push(getText(pre + 'PLAN.md').then(function (x) { t.plan = x; }).catch(function () { }));
  if (has('RESULT.md')) reads.push(getText(pre + 'RESULT.md').then(function (x) { t.result = x; }).catch(function () { }));
  t.versions = typeOf(issue) === 'script' ? versionsFrom(rel) : [];
  const latest = t.versions[t.versions.length - 1];
  if (latest) latest.scripts.forEach(function (p) {
    if (t.decks[p]) return;
    reads.push(getText(pre + p).then(function (md) { t.decks[p] = parseDeck(md); }).catch(function () { t.decks[p] = null; }));
  });
  if (statusOf(issue) === 'failed') reads.push(api('GET', repoPath('/issues/' + n + '/comments?per_page=100')).then(function (c) { t.lastComment = c[c.length - 1]; }).catch(function () { }));
  await Promise.all(reads);
  return t;
}
function reloadTask(n) { if (S.task[n]) S.task[n].stale = true; S.tree = null; S.treeSha = ''; refreshTree().then(render); }

function commandBox(t, label, body, after) {
  // sends one command comment; shows the result inline
  return postComment(t.issue.number, body).then(function () {
    toast(label + ' sent. The job picks it up in a minute; the status changes to Running.');
    t.issue.labels = (t.issue.labels || []).filter(function (l) { return !/^status:/.test(l.name || l); }).concat([{ name: 'status:queued' }]);
    if (after) after();
    render();
  });
}
function planCard(t) {
  const area = h('textarea', { class: 'in', rows: 3, placeholder: 'Changes before it continues (optional): e.g. "I like 1, 3, 6" or "use a different creator for script 2"' });
  area.value = t.planNote || '';
  const btn = h('button', { class: 'btn', type: 'button' }, t.planNote ? 'Send changes and continue' : 'Approve and continue');
  area.addEventListener('input', function () { t.planNote = area.value; btn.textContent = area.value.trim() ? 'Send changes and continue' : 'Approve and continue'; });
  btn.addEventListener('click', function () {
    btn.disabled = true; btn.textContent = 'Sending…';
    commandBox(t, 'Approval', buildApproveComment(area.value), function () { t.planNote = ''; })
      .catch(function (e) { btn.disabled = false; btn.textContent = 'Approve and continue'; toast(errText(e)); });
  });
  return h('div', { class: 'card warn' }, h('h3', {}, 'The plan, waiting for your OK'),
    t.plan ? mdBlock(t.plan) : h('div', { class: 'hint' }, 'The plan file has not arrived yet. Refresh in a minute.'),
    field('Changes', area, { opt: '(optional)' }), h('div', { class: 'wrap-row' }, btn));
}
function resultCard(t, open) {
  if (!t.result) return null;
  const r = splitResult(t.result);
  return h('details', { class: 'card', open: open ? true : null }, h('summary', {}, h('span', { class: 'b', style: 'font-size:14px' }, 'The job’s report' + (r.status ? ' · ' + r.status : ''))), mdBlock(r.body));
}
function briefCard(t) {
  const b = parseIssueBody(t.issue.body);
  return h('details', { class: 'card' }, h('summary', {}, h('span', { class: 'b', style: 'font-size:14px' }, 'Your brief')),
    b.brief ? mdBlock(b.brief) : mdBlock(t.issue.body || ''),
    b.files.length ? h('div', { class: 'stack-sm' }, h('h4', {}, 'Files'), b.files.map(function (p) { return h('div', { class: 'hint' }, dlLink(p, p)); })) : null);
}
function statusNote(t) {
  const s = statusOf(t.issue);
  if (s === 'queued' || s === 'running') return h('div', { class: 'gate' }, s === 'running' ? 'A job is working on this now. You don’t need to wait here: this page and Task overview update every 30 seconds.' : 'Waiting to start. It usually starts within a minute or two.');
  if (s === 'failed') return h('div', { class: 'gate err' }, 'The job hit an error. ', t.lastComment ? h('div', {}, mdBlock(t.lastComment.body || '')) : 'See the last comment on the task.');
  return null;
}
function taskView(t) {
  const i = t.issue; const type = TYPE_BY_KEY[typeOf(i)] || { name: 'Task' };
  const crumbs = h('div', { class: 'crumbs' }, h('a', { href: '#home' }, 'Task overview'), ' / ' + type.name);
  if (typeOf(i) === 'script') return scriptTaskView(t, crumbs);
  const s = statusOf(i);
  const out = outDocs(t.rel);
  return [
    h('div', { class: 'head' }, crumbs, h('h2', {}, taskName(i)), h('div', { class: 'hint lead' }, pill(s, statusText(i)), ' · started by ' + (i.user ? i.user.login : '?') + ' · #' + i.number)),
    statusNote(t),
    s === 'needs-you' ? planCard(t) : null,
    out.length ? downloadCard(t, out) : null,
    out.length && (s === 'done' || s === 'ready') && BULK_FEEDBACK_TYPES.indexOf(typeOf(i)) >= 0 ? bulkFeedbackCard(t) : null,
    resultCard(t, s === 'done' || s === 'failed'),
    briefCard(t)
  ];
}

/* script task: versions + per-part feedback */
function scriptTaskView(t, crumbs) {
  const i = t.issue; const s = statusOf(i);
  const v = t.versions[t.versions.length - 1];
  const decks = v ? v.scripts.map(function (p) { return { path: p, deck: t.decks[p] }; }) : [];
  const first = decks[0] && decks[0].deck;
  const f = parseIssueBody(i.body).fields;
  const sub = [];
  if (first && first.structure) sub.push(first.structure + (first.winner ? ' (' + first.winner + ')' : ''));
  else if (f.Engine) sub.push(f.Engine);
  if (first && first.messenger) sub.push(first.messenger); else if (f['Who says it']) sub.push(f['Who says it']);
  if (first && first.words) sub.push(first.words + ' words');
  sub.push('started by ' + (i.user ? i.user.login : '?'));
  const out = [h('div', { class: 'head' }, crumbs, h('h2', {}, taskName(i)), h('div', { class: 'hint lead' }, pill(s, statusText(i)), ' · ' + sub.join(' · ')))];
  out.push(statusNote(t));
  if (s === 'needs-you') out.push(planCard(t));
  if (!v) { out.push(resultCard(t, true), briefCard(t)); return out; }

  const canSend = s === 'ready';
  const multi = decks.length > 1;
  const partsUI = [];
  const allParts = [];
  decks.forEach(function (d, di) {
    const dl = deckLabel(d.path);
    if (multi) partsUI.push(h('h3', { style: 'margin-top:8px' }, 'Script ' + (di + 1) + ': ' + dl));
    if (!d.deck) { partsUI.push(h('div', { class: 'gate err' }, 'Could not read ' + basename(d.path) + '.')); return; }
    if (!d.deck.parts.length) { partsUI.push(h('div', { class: 'hint' }, 'This script could not be split into hooks and beats; use general feedback below.')); return; }
    d.deck.parts.forEach(function (p) {
      const key = d.path + '|' + p.label;
      const label = multi ? dl + ' · ' + p.label : p.label;
      const fb = t.fb[key] = t.fb[key] || { feedback: '', edited: null, editing: false };
      allParts.push({ key: key, label: label, original: p.text, fb: fb });
      const wrap = h('div', { class: 'part' + (fb.feedback.trim() || (fb.edited != null && fb.edited.trim() !== p.text) ? ' touched' : '') });
      function draw() {
        const touched = fb.feedback.trim() || (fb.edited != null && fb.edited.trim() !== p.text);
        wrap.className = 'part' + (touched ? ' touched' : '');
        const editBtn = h('button', { class: 'btn2 xs', type: 'button', 'aria-expanded': fb.editing ? 'true' : 'false', onclick: function () { fb.editing = !fb.editing; if (fb.editing && fb.edited == null) fb.edited = p.text; draw(); } }, fb.editing ? 'Done editing' : 'Edit text', h('span', { class: 'sr-only' }, ': ' + p.label));
        let textEl;
        if (fb.editing) {
          textEl = h('textarea', { class: 'in', rows: Math.min(14, Math.max(3, p.text.split('\n').length + 1)), 'aria-label': 'Edit the text of ' + p.label, oninput: function (e) { fb.edited = e.target.value; revalidate(); } });
          textEl.value = fb.edited;
        } else {
          const shown = fb.edited != null ? fb.edited : p.text;
          textEl = h('div', { class: 'part-text' }, shown, fb.edited != null && fb.edited.trim() !== p.text ? h('div', { class: 'hint' }, 'Edited by you: kept word for word.') : null);
        }
        const fbIn = h('input', { class: 'in', value: fb.feedback, placeholder: 'Feedback on this part (optional)', 'aria-label': 'Feedback on ' + p.label, oninput: function (e) { fb.feedback = e.target.value; const tch = fb.feedback.trim() || (fb.edited != null && fb.edited.trim() !== p.text); wrap.className = 'part' + (tch ? ' touched' : ''); revalidate(); } });
        setKids(wrap, 
          h('div', { class: 'between' }, h('h4', {}, p.label, p.note ? h('span', { class: 'part-time' }, '(' + p.note + ')') : null, p.time ? h('span', { class: 'part-time' }, p.time) : null), canSend ? editBtn : null),
          textEl, canSend ? fbIn : null);
      }
      draw();
      partsUI.push(wrap);
    });
  });

  const pre = t.pre;
  const rcs = v.docx.filter(function (p) { return /reviewcut/i.test(p); });
  const otherDocx = v.docx.filter(function (p) { return rcs.indexOf(p) < 0; });
  const dlBtns = (rcs.length ? rcs : v.docx.slice(0, 1)).map(function (p) {
    return h('button', { class: 'btn2', type: 'button', onclick: function () { downloadRepoFile(pre + p); } }, rcs.length > 1 ? 'Download ' + deckLabelFromDocx(p) + ' (Word)' : 'Download Review Cut (Word)');
  });
  const card = h('div', { class: 'card' },
    h('div', { class: 'between' }, h('h3', {}, 'Version ' + v.k + ' ', h('span', { class: 'pill orange' }, 'Latest')), h('div', { class: 'wrap-row' }, dlBtns)),
    otherDocx.length ? h('div', { class: 'hint' }, 'Also: ', otherDocx.map(function (p, k) { return [k ? ' · ' : '', dlLink(pre + p, /scripts/i.test(basename(p)) ? 'Production deck (Word)' : basename(p))]; })) : null,
    h('div', { class: 'hint' }, canSend ? 'Read it here. Give feedback under any hook or beat, or edit a line directly; leave the rest blank.' : 'Read it here. Feedback opens when this version is ready for your feedback.'),
    partsUI);

  if (canSend) {
    const gen = h('textarea', { class: 'in', rows: 3, placeholder: 'e.g. Beats 2–4 need to agitate the problem more; feels too summarised', oninput: function (e) { t.general = e.target.value; revalidate(); } });
    gen.value = t.general;
    const missing = h('div', { class: 'gate slim', hidden: true });
    const sendBtn = h('button', { class: 'btn', type: 'button' }, 'Send feedback → version ' + (v.k + 1));
    const refineBtn = h('button', { class: 'btn2', type: 'button' }, 'Review with recent learnings');
    const finalBtn = h('button', { class: 'btn2', type: 'button', 'aria-expanded': t.finalOpen ? 'true' : 'false' }, 'This is my final');
    const edited = function () { return storedPaths(t, 'edited')[0] || ''; };
    function validate() {
      const any = t.general.trim() || edited() || allParts.some(function (p) { return p.fb.feedback.trim() || (p.fb.edited != null && p.fb.edited.trim() !== p.original); });
      const miss = [];
      if (!any) miss.push('feedback on at least one part, general feedback, or your edited Word file');
      if (anyUploading(t)) miss.push('wait for the upload to finish');
      missing.hidden = !miss.length; missing.textContent = 'Missing before you can submit: ' + miss.join(', ') + '.';
      sendBtn.disabled = !!miss.length;
      if (finalValidate) finalValidate();
    }
    let finalValidate = null;
    sendBtn.addEventListener('click', function () {
      const parts = allParts.map(function (p) {
        const ed = p.fb.edited != null && p.fb.edited.trim() !== p.original ? p.fb.edited : '';
        return { label: p.label, feedback: p.fb.feedback, edited: ed };
      });
      const body = buildFeedbackComment({ version: v.k, proposalsFirst: t.proposals, upload: edited(), general: t.general, parts: parts });
      sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
      commandBox(t, 'Feedback', body, function () { t.fb = {}; t.general = ''; t._uploads = {}; t._stamp = null; })
        .catch(function (e) { sendBtn.textContent = 'Send feedback → version ' + (v.k + 1); validate(); toast(errText(e)); });
    });
    refineBtn.addEventListener('click', function () {
      refineBtn.disabled = true;
      commandBox(t, 'Review request', buildRefineComment(t.general)).catch(function (e) { refineBtn.disabled = false; toast(errText(e)); });
    });
    finalBtn.addEventListener('click', function () { t.finalOpen = !t.finalOpen; render(); });
    card.appendChild(field('General feedback on the whole script', gen));
    card.appendChild(h('div', { class: 'hint' }, 'Text you edit directly is kept exactly as you wrote it. Feedback is addressed, and only the parts you gave feedback on change.'));
    card.appendChild(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: t.proposals, onchange: function (e) { t.proposals = e.target.checked; } }), 'Show me proposals before changing anything'));
    card.appendChild(uploader(t, 'edited', 'Edited the Word file yourself? Upload it and every edit is kept word for word.', { button: 'Upload edited Word file', accept: '.docx', multiple: false }));
    card.appendChild(missing);
    card.appendChild(h('div', { class: 'wrap-row' }, sendBtn, refineBtn, finalBtn));
    card.appendChild(h('div', { class: 'hint' }, '"This is my final" compares your final with the first cut and teaches the system what you changed. A new case needs a lead’s OK; a new principle needs Josh’s.'));
    if (t.finalOpen) {
      const note = h('textarea', { class: 'in', rows: 2, placeholder: 'Anything to know about the final (optional)', oninput: function (e) { t.finalNote = e.target.value; } });
      note.value = t.finalNote || '';
      const fMissing = h('div', { class: 'gate slim', hidden: true });
      const fBtn = h('button', { class: 'btn', type: 'button' }, 'Send my final');
      finalValidate = function () {
        const p = storedPaths(t, 'final')[0];
        const miss = p ? [] : ['your final Word file'];
        if (anyUploading(t)) miss.push('wait for the upload to finish');
        fMissing.hidden = !miss.length; fMissing.textContent = 'Missing before you can submit: ' + miss.join(', ') + '.';
        fBtn.disabled = !!miss.length;
      };
      fBtn.addEventListener('click', function () {
        const p = storedPaths(t, 'final')[0]; if (!p) return;
        fBtn.disabled = true; fBtn.textContent = 'Sending…';
        commandBox(t, 'Final', buildFinalComment(p, t.finalNote), function () { t.finalOpen = false; t.finalNote = ''; t._uploads = {}; t._stamp = null; })
          .catch(function (e) { fBtn.textContent = 'Send my final'; finalValidate(); toast(errText(e)); });
      });
      card.appendChild(h('div', { class: 'card inner' }, h('h4', {}, 'Send your final'),
        uploader(t, 'final', 'Upload your final Word file', { button: 'Upload final Word file', accept: '.docx', multiple: false }),
        field('Note', note, { opt: '(optional)' }), fMissing, h('div', { class: 'wrap-row' }, fBtn)));
    }
    activeValidate = validate;
    setTimeout(validate, 0);
  }
  out.push(card);

  if (t.versions.length > 1) {
    const fbFiles = t.rel.filter(function (p) { return /^feedback\/r\d+\.md$/.test(p); });
    out.push(h('div', { class: 'card' }, h('h3', {}, 'Earlier versions'),
      h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Version'), h('th', { scope: 'col' }, 'What changed'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Downloads')))),
        h('tbody', {}, t.versions.slice(0, -1).reverse().map(function (ov) {
          const rc = ov.docx.filter(function (p) { return /reviewcut/i.test(p); })[0] || ov.docx[0];
          const fbf = 'feedback/r' + ov.k + '.md';
          return h('tr', {}, h('td', {}, 'v' + ov.k),
            h('td', {}, ov.k === 1 ? 'First cut' : 'After your feedback round ' + (ov.k - 1), fbFiles.indexOf(fbf) >= 0 ? [' · ', dlLink(pre + fbf, 'your feedback on it')] : null),
            h('td', {}, rc ? dlLink(pre + rc, 'Review Cut (Word)') : '—'));
        }))))));
  }
  out.push(resultCard(t, false), briefCard(t));
  return out;
}
function deckLabelFromDocx(p) { return basename(p).replace(/\.docx$/i, '').replace(/^AlphaLion_/, '').replace(/_/g, ' '); }

/* =====================================================================
 * 4. START + POLLING
 * ===================================================================== */
setInterval(function () {
  if (!S.login || document.visibilityState !== 'visible') return;
  const r = route();
  if (r.screen === 'home') { refreshTasks().then(function () { if (route().screen === 'home') render(); }); }
  else if (r.screen === 'task') {
    const t = S.task[r.n];
    // keep typed feedback safe: only refresh a task page while nothing is being typed
    const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (t && !typing) {
      const before = statusOf(t.issue);
      api('GET', repoPath('/issues/' + r.n)).then(function (i) {
        S.issues = S.issues.map(function (x) { return x.number === i.number ? i : x; });
        if (statusOf(i) !== before || before === 'running' || before === 'queued') { t.issue = i; reloadTask(r.n); }
      }).catch(function () { });
    }
  }
}, 30000);
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && S.login && route().screen === 'home') refreshTasks().then(render);
});

(async function boot() {
  if (!S.token) { render(); return; }
  render();
  try { await startSession(); render(); }
  catch (e) {
    if (DEMO) { document.getElementById('app').replaceChildren(h('div', { class: 'boot' }, 'Demo fixtures did not load: ' + errText(e) + ' Serve the folder over http (python3 -m http.server).')); return; }
    S.token = null; S.login = '';
    if (e.status === 401) lsDel(LS_TOKEN);
    document.getElementById('app').replaceChildren(signInScreen(errText(e)));
  }
})();

})();
