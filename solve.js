// site-generator-speed-01-pecut-r2 — a fresh, dependency-free, pure-JavaScript
// drop-in for makefun-site 1.0.0. Written from the competition README's
// semantics in this session. No native code, no WASM, no hardcoded answers,
// no caching across cases: every case is built from its own input alone.
//
// Speed ideas: one line scan per body, a fused word count, an iterative
// inline renderer with an explicit frame stack (no recursion, no per-mark
// slice/re-scan), compiled templates (new Function, once per case), and
// memoised slugs / link resolutions inside a single case only.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- escaping

const ESCMAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;
const ESC_TEST = /[&<>"']/;
function esc(s) {
  if (!ESC_TEST.test(s)) return s;
  return s.replace(ESC_RE, (c) => ESCMAP[c]);
}
function escChar(c) {
  const e = ESCMAP[c];
  return e === undefined ? c : e;
}

// ---------------------------------------------------------------- text

const SLUG_MAX = 64;

function slugifySlow(plain) {
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  return finishSlug(out);
}

function finishSlug(out) {
  if (out.length > SLUG_MAX) out = out.slice(0, SLUG_MAX);
  let e = out.length;
  while (e > 0 && out.charCodeAt(e - 1) === 45) e--;
  if (e !== out.length) out = out.slice(0, e);
  return out === '' ? 'untitled' : out;
}

function slugify(text, cache) {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  let out = '';
  let gap = false;
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) >= 128) { ascii = false; break; }
  }
  if (!ascii) {
    out = slugifySlow(text.normalize('NFKD').replace(/\p{M}/gu, ''));
    cache.set(text, out);
    return out;
  }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let keep = -1;
    if (c >= 65 && c <= 90) keep = c + 32;
    else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
    if (keep === -1) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += String.fromCharCode(keep);
  }
  out = finishSlug(out);
  cache.set(text, out);
  return out;
}

function uniqueSlug(slug, taken) {
  if (!taken.has(slug)) { taken.add(slug); return slug; }
  let n = 2;
  let out = slug + '-2';
  while (taken.has(out)) { n++; out = slug + '-' + n; }
  taken.add(out);
  return out;
}

function longDate(date, cache) {
  const hit = cache.get(date);
  if (hit !== undefined) return hit;
  const v = `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
  cache.set(date, v);
  return v;
}

// Words: runs of non-whitespace in the raw body, counted in one char scan.
function isWS(c) {
  return c <= 32 || c === 160 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
}
function countWords(text) {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c <= 32) inWord = false;
    else if (c < 128 || (c !== 160 && c !== 0x1680 && !(c >= 0x2000 && c <= 0x200a) && c !== 0x2028 && c !== 0x2029 && c !== 0x202f && c !== 0x205f && c !== 0x3000 && c !== 0xfeff)) {
      if (!inWord) { inWord = true; n++; }
    } else inWord = false;
  }
  return n;
}

// ---------------------------------------------------------------- front matter

const FM_LINE = /^([a-z_]+):(?: (.*))?$/;
const FM_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FM_NAME = /^[a-z0-9-]+$/;
const FM_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FM_TAG = /^[^"[\]]+$/;
const FM_KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function fmStringOf(raw) {
  if (raw.charCodeAt(0) === 34) { // '"'
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' }; // '['
  return { value: raw };
}

function fmValueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = fmStringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = FM_DATE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (let i = 0; i < tags.length; i++) {
        if (tags[i] === '' || !FM_TAG.test(tags[i])) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return FM_NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return FM_SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

// Parse front matter without splitting the whole text: walk lines by indexOf.
// Returns { data, body } or { error }.
function parseFrontMatter(text) {
  let nl = text.indexOf('\n');
  const first = nl === -1 ? text : text.slice(0, nl);
  if (first !== '---') return { error: 'no front matter' };
  // Find the closing '---' line.
  let pos = nl === -1 ? text.length : nl + 1;
  let closeStart = -1;
  let closeEnd = -1;
  while (pos < text.length) {
    const e = text.indexOf('\n', pos);
    const line = e === -1 ? text.slice(pos) : text.slice(pos, e);
    if (line === '---') { closeStart = pos; closeEnd = e; break; }
    pos = e === -1 ? text.length : e + 1;
  }
  if (closeStart === -1) return { error: 'the front matter is not closed' };
  const data = {};
  // The front matter is a handful of lines; split only that slice.
  const fmLines = text.slice(nl + 1, closeStart).split('\n');
  for (let li = 0; li < fmLines.length; li++) {
    const line = fmLines[li];
    if (line === '') continue; // split leaves a trailing '' after the last \n
    if (/^[ \t]*$/.test(line) || line.charCodeAt(0) === 35) continue; // blank or '#'
    const m = FM_LINE.exec(line);
    if (!m) return { error: `line ${li + 2} is not "key: value"` };
    const key = m[1];
    let raw = m[2] === undefined ? '' : m[2];
    let r = raw.length;
    while (r > 0 && (raw.charCodeAt(r - 1) === 32 || raw.charCodeAt(r - 1) === 9)) r--;
    if (r !== raw.length) raw = raw.slice(0, r);
    if (!FM_KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = fmValueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  const body = closeEnd === -1 ? '' : text.slice(closeEnd + 1);
  return { data, body };
}

// ---------------------------------------------------------------- markdown

const ESCAPABLE_CODE = new Uint8Array(128);
for (const ch of ['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']) ESCAPABLE_CODE[ch.charCodeAt(0)] = 1;
const ESC_ENT = [];
ESC_ENT[38] = '&amp;';
ESC_ENT[60] = '&lt;';
ESC_ENT[62] = '&gt;';
ESC_ENT[34] = '&quot;';
ESC_ENT[39] = '&#39;';
// The next inline special, found by one regex scan (C speed) instead of a
// per-character JS loop.
const SPEC_RE = /[\\`*\[&<>"']/g;

// Count the run of '\' immediately before j (not before `from`): a closer
// is escaped iff that run has odd length (the run pairs up left to right,
// and a trailing lone '\' escapes the next char, which is escapable here).
function escapedRun(s, j, from) {
  let bs = 0;
  let k = j - 1;
  while (k >= from && s.charCodeAt(k) === 92) { bs++; k--; }
  return bs % 2 === 1;
}

function findStrong(s, from, limit) {
  let j = s.indexOf('**', from);
  while (j !== -1 && j + 1 < limit) {
    if (!escapedRun(s, j, from)) return j;
    j = s.indexOf('**', j + 1);
  }
  return -1;
}

function findSingleStar(s, from, limit) {
  let j = s.indexOf('*', from);
  while (j !== -1 && j < limit) {
    if (escapedRun(s, j, from)) { j = s.indexOf('*', j + 1); continue; }
    if (s.charCodeAt(j + 1) === 42) { j = s.indexOf('*', j + 2); continue; }
    return j;
  }
  return -1;
}

function findCloseBracket(s, from, limit) {
  let j = s.indexOf(']', from);
  while (j !== -1 && j < limit) {
    if (!escapedRun(s, j, from)) return j;
    j = s.indexOf(']', j + 1);
  }
  return -1;
}

// Iterative inline renderer. `out` is an array of string pieces. Frames are
// held in one flat stack (5 slots each: kind, end, start, href, after), so
// no per-frame object or buffer array is allocated: a frame's content
// accumulates in `out` from `start` and is sliced out on close. A frame is
// only pushed after its closer was found ahead, so content is scanned once
// and never re-sliced for recursion.
function inlineInto(s, link, out) {
  const st = [];
  let limit = s.length;
  let i = 0;
  let run = 0;
  const flush = (to) => {
    if (to > run) out.push(s.slice(run, to)); // segments hold no specials: they are broken out below
  };
  while (i < s.length) {
    // A frame ends exactly here: close it.
    if (st.length !== 0 && i === st[st.length - 4]) {
      const kind = st[st.length - 5];
      const end = st[st.length - 4];
      const start = st[st.length - 3];
      const href = st[st.length - 2];
      const after = st[st.length - 1];
      flush(end);
      const inner = out.slice(start).join('');
      out.length = start;
      if (kind === 2) { i = after; run = i; }
      else { i = end + (kind === 0 ? 2 : 1); run = i; }
      st.length -= 5;
      limit = st.length === 0 ? s.length : st[st.length - 4];
      if (kind === 0) out.push('<strong>' + inner + '</strong>');
      else if (kind === 1) out.push('<em>' + inner + '</em>');
      else out.push('<a href="' + esc(href) + '">' + inner + '</a>');
      continue;
    }
    // Jump (one regex scan) to the next special at or after i.
    SPEC_RE.lastIndex = i;
    const m = SPEC_RE.exec(s);
    if (m === null || m.index >= limit) { i = limit; continue; }
    i = m.index;
    const cc = s.charCodeAt(i);
    if (cc === 92) { // backslash
      if (i + 1 < limit && ESCAPABLE_CODE[s.charCodeAt(i + 1)] === 1) {
        flush(i);
        out.push(escChar(s[i + 1]));
        i += 2;
        run = i;
      } else {
        i++;
      }
      continue;
    }
    if (cc === 96) { // backtick
      const j = s.indexOf('`', i + 1);
      if (j > i + 1 && j < limit) {
        flush(i);
        out.push('<code>' + esc(s.slice(i + 1, j)) + '</code>');
        i = j + 1;
        run = i;
      } else {
        i++;
      }
      continue;
    }
    if (cc === 42) { // '*'
      if (s.charCodeAt(i + 1) === 42) {
        const j = findStrong(s, i + 2, limit);
        if (j > i + 2) {
          flush(i);
          st.push(0, j, out.length, '', 0);
          limit = j;
          i += 2;
          run = i;
        } else {
          flush(i);
          out.push('**');
          i += 2;
          run = i;
        }
      } else {
        const j = findSingleStar(s, i + 1, limit);
        if (j > i + 1) {
          flush(i);
          st.push(1, j, out.length, '', 0);
          limit = j;
          i += 1;
          run = i;
        } else {
          i++;
        }
      }
      continue;
    }
    if (cc === 91) { // '['
      const k = findCloseBracket(s, i + 1, limit);
      let done = false;
      if (k !== -1 && s.charCodeAt(k + 1) === 40) {
        const mm = s.indexOf(')', k + 2);
        if (mm !== -1 && mm < limit) {
          const target = s.slice(k + 2, mm);
          if (target !== '' && !/\s/.test(target)) {
            flush(i);
            st.push(2, k, out.length, link(target), mm + 1);
            limit = k;
            i += 1;
            run = i;
            done = true;
          }
        }
      }
      if (!done) i++;
      continue;
    }
    // An HTML special: flush the plain run and push its entity.
    flush(i);
    out.push(ESC_ENT[cc]);
    i++;
    run = i;
  }
  flush(s.length);
  // Unclosed frames cannot exist: a frame is only pushed after its closer
  // was found ahead, and the loop always reaches it.
}

function inlineStr(s, link) {
  const out = [];
  inlineInto(s, link, out);
  return out.join('');
}

const isBlankLine = (l) => {
  for (let i = 0; i < l.length; i++) {
    const c = l.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
};

function trimLine(l) {
  let a = 0;
  let b = l.length;
  while (a < b && (l.charCodeAt(a) === 32 || l.charCodeAt(a) === 9)) a++;
  while (b > a && (l.charCodeAt(b - 1) === 32 || l.charCodeAt(b - 1) === 9)) b--;
  return l.slice(a, b);
}

// Fence open: ``` + optional lang [A-Za-z0-9_+-]* + spaces/tabs only. Returns lang or null.
function fenceLang(l) {
  if (l.charCodeAt(0) !== 96 || l.charCodeAt(1) !== 96 || l.charCodeAt(2) !== 96) return null;
  let i = 3;
  while (i < l.length) {
    const c = l.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) i++;
    else break;
  }
  const lang = l.slice(3, i);
  while (i < l.length) {
    const c = l.charCodeAt(i);
    if (c !== 32 && c !== 9) return null;
    i++;
  }
  return lang;
}

function isFenceClose(l) {
  if (l.charCodeAt(0) !== 96 || l.charCodeAt(1) !== 96 || l.charCodeAt(2) !== 96) return false;
  for (let i = 3; i < l.length; i++) {
    const c = l.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

// Heading: 1-6 '#', space/tab, non-empty text. Returns { depth, text } or null.
function headingOf(l) {
  let n = 0;
  while (n < 6 && l.charCodeAt(n) === 35) n++;
  if (n === 0) return null;
  if (l.charCodeAt(n) !== 32 && l.charCodeAt(n) !== 9) return null;
  const text = trimLine(l.slice(n + 1));
  if (text === '') return null;
  return { depth: n, text };
}

function isHR(l) {
  if (l.length < 3) return false;
  const c0 = l.charCodeAt(0);
  const c1 = l.charCodeAt(1);
  const c2 = l.charCodeAt(2);
  if (!((c0 === 45 && c1 === 45 && c2 === 45) || (c0 === 42 && c1 === 42 && c2 === 42))) return false;
  for (let i = 3; i < l.length; i++) {
    const c = l.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

// A line of 2+ spaces then a non-space: /^ {2,}\S/ on the line.
function isContinued(l) {
  let sp = 0;
  while (sp < l.length && l.charCodeAt(sp) === 32) sp++;
  if (sp < 2 || sp >= l.length) return false;
  const c = l.charCodeAt(sp);
  return c > 32 && c !== 160 && c !== 0x1680 && !(c >= 0x2000 && c <= 0x200a) && c !== 0x2028 && c !== 0x2029 && c !== 0x202f && c !== 0x205f && c !== 0x3000 && c !== 0xfeff;
}

function isBlockStart(l) {
  if (l.length === 0) return true;
  const c0 = l.charCodeAt(0);
  if (c0 === 32 || c0 === 9) return isBlankLine(l);
  if (c0 === 96) return fenceLang(l) !== null;
  if (c0 === 35) return headingOf(l) !== null;
  if (c0 === 45 || c0 === 42) return isHR(l);
  return false;
}

// Render one body's lines. Returns { html, toc, excerpt }.
function renderMarkdown(lines, link, slugCache) {
  const out = [];
  const toc = [];
  const ids = new Set();
  let excerpt = null;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    const c0 = line.charCodeAt(0);
    if (line.length === 0 || ((c0 === 32 || c0 === 9) && isBlankLine(line))) { i++; continue; }
    if (c0 === 96) {
      const lang = fenceLang(line);
      if (lang !== null) {
        out.push(lang === '' ? '<pre><code>' : '<pre><code class="language-' + lang + '">');
        i++;
        while (i < n && !isFenceClose(lines[i])) { out.push(esc(lines[i])); out.push('\n'); i++; }
        i++; // skip the close line, or past the end
        out.push('</code></pre>\n');
        continue;
      }
    } else if (c0 === 35) {
      const h = headingOf(line);
      if (h !== null) {
        const id = uniqueSlug(slugify(h.text, slugCache), ids);
        const html = inlineStr(h.text, link);
        out.push('<h' + h.depth + ' id="' + id + '">' + html + '</h' + h.depth + '>\n');
        if (h.depth === 2 || h.depth === 3) toc.push({ level: h.depth, id, html });
        i++;
        continue;
      }
    } else if (c0 === 45 || c0 === 42) {
      if (isHR(line)) { out.push('<hr>\n'); i++; continue; }
    } else if (c0 === 62) { // '>'
      const body = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        let l = lines[i];
        l = l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1);
        body.push(trimLine(l));
        i++;
      }
      const kept = body.filter((l) => l !== '');
      if (kept.length === 0) out.push('<blockquote>\n</blockquote>\n');
      else out.push('<blockquote>\n<p>' + inlineStr(kept.join('\n'), link) + '</p>\n</blockquote>\n');
      continue;
    }
    // List?
    let bullet = false;
    let ordered = false;
    let startNum = 1;
    let itemText = null;
    if ((line.charCodeAt(0) === 45 || line.charCodeAt(0) === 42) && line.charCodeAt(1) === 32) {
      bullet = true;
      itemText = line.slice(2);
    } else {
      // digits + '. '
      let d = 0;
      while (d < 9 && d < line.length && line.charCodeAt(d) >= 48 && line.charCodeAt(d) <= 57) d++;
      if (d > 0 && d < line.length && line.charCodeAt(d) === 46 && line.charCodeAt(d + 1) === 32) {
        ordered = true;
        startNum = Number(line.slice(0, d));
        itemText = line.slice(d + 2);
      }
    }
    if (bullet || ordered) {
      const items = [];
      let cur = [trimLine(itemText)];
      i++;
      while (i < n) {
        const l = lines[i];
        let mText = null;
        let mOrd = false;
        let mNum = 1;
        if (bullet && (l.charCodeAt(0) === 45 || l.charCodeAt(0) === 42) && l.charCodeAt(1) === 32) {
          mText = l.slice(2);
        } else if (ordered) {
          let d = 0;
          while (d < 9 && d < l.length && l.charCodeAt(d) >= 48 && l.charCodeAt(d) <= 57) d++;
          if (d > 0 && d < l.length && l.charCodeAt(d) === 46 && l.charCodeAt(d + 1) === 32) {
            mOrd = true;
            mNum = Number(l.slice(0, d));
            mText = l.slice(d + 2);
          }
        }
        if (mText !== null) {
          // A marker line only continues the list when it matches this list's kind.
          if (bullet && (l.charCodeAt(0) === 45 || l.charCodeAt(0) === 42) && l.charCodeAt(1) === 32) {
            items.push(cur);
            cur = [trimLine(mText)];
            i++;
          } else if (ordered && mOrd) {
            items.push(cur);
            cur = [trimLine(mText)];
            i++;
          } else break;
        } else if (isContinued(l)) {
          cur.push(trimLine(l));
          i++;
        } else break;
      }
      items.push(cur);
      const tag = ordered ? 'ol' : 'ul';
      out.push(ordered && startNum !== 1 ? '<ol start="' + startNum + '">\n' : '<' + tag + '>\n');
      for (const parts of items) out.push('<li>' + inlineStr(parts.join('\n'), link) + '</li>\n');
      out.push('</' + tag + '>\n');
      continue;
    }
    // Paragraph: render straight into the main output; only the first
    // paragraph needs its HTML as a string (the excerpt).
    const body = [trimLine(line)];
    i++;
    while (i < n && !isBlockStart(lines[i])) { body.push(trimLine(lines[i])); i++; }
    const pStart = out.length;
    out.push('<p>');
    inlineInto(body.join('\n'), link, out);
    out.push('</p>\n');
    if (excerpt === null) excerpt = out.slice(pStart + 1, out.length - 1).join('');
  }
  return { html: out.join(''), toc, excerpt: excerpt === null ? '' : excerpt };
}

// ---------------------------------------------------------------- templates

class TemplateError extends Error {}

const TPL_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const TPL_FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const TPL_IF = /^if (not )?(\S+)$/;
const TPL_INCLUDE = /^include "([a-z0-9-]+)"$/;

function tplPathOf(name, text) {
  if (!TPL_PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tplTokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: tplPathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function tplParse(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tplTokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = TPL_FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: tplPathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = TPL_IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: tplPathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else !== null && parent.else !== undefined ? parent.else : parent.then;
      } else if ((m = TPL_INCLUDE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

// --- template code generation ------------------------------------------------
// A compiled template is fn(out, $s, T, D): $s is the scope chain (objects
// linked by prototype, all null-prototype, so a name resolves innermost
// first and never hits Object.prototype), T the compiled-template map,
// D the include depth.

function lk(o, k) {
  return o !== null && typeof o === 'object' && Object.hasOwn(o, k) ? o[k] : undefined;
}
function tx(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    let s = '';
    for (let i = 0; i < v.length; i++) {
      if (i !== 0) s += ', ';
      s += tx(v[i]);
    }
    return s;
  }
  return '';
}
function tr(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

function genLookup(path, sv, bindings) {
  // `bindings` holds the loop-bound names in scope, innermost last. A bound
  // first name is a plain JS variable (resolved at compile time); anything
  // else is read from the root scope object.
  let first = null;
  for (let b = bindings.length - 1; b >= 0; b--) {
    if (bindings[b] === path[0]) { first = path[0]; break; }
  }
  let e = first !== null ? first : sv + '[' + JSON.stringify(path[0]) + ']';
  for (let k = 1; k < path.length; k++) e = '$lk(' + e + ',' + JSON.stringify(path[k]) + ')';
  return e;
}

function genNodes(nodes, sv, depth, code, bindings) {
  for (const n of nodes) {
    if (n.kind === 'text') code.push('$o.push(' + JSON.stringify(n.text) + ');');
    else if (n.kind === 'var') code.push('$o.push($esc($tx(' + genLookup(n.path, sv, bindings) + ')));');
    else if (n.kind === 'raw') code.push('$o.push($tx(' + genLookup(n.path, sv, bindings) + '));');
    else if (n.kind === 'if') {
      const cond = '$tr(' + genLookup(n.path, sv, bindings) + ')';
      code.push('if(' + (n.not ? '!' + cond : cond) + '){');
      genNodes(n.then, sv, depth, code, bindings);
      code.push('}');
      if (n.else !== null) {
        code.push('else{');
        genNodes(n.else, sv, depth, code, bindings);
        code.push('}');
      }
    } else if (n.kind === 'for') {
      const d = depth + 1;
      const xs = '$x' + d;
      const kk = '$k' + d;
      const itv = n.name === 'loop' ? '$v' + d : n.name;
      code.push('{const ' + xs + '=' + genLookup(n.path, sv, bindings) + ';if(Array.isArray(' + xs + ')){let ' + kk + '=0;for(const ' + itv + ' of ' + xs + '){');
      code.push('const loop={index:' + kk + '+1,first:' + kk + '===0,last:' + kk + '===' + xs + '.length-1,length:' + xs + '.length};');
      const b2 = bindings.concat(n.name === 'loop' ? ['loop'] : [n.name, 'loop']);
      genNodes(n.body, sv, d, code, b2);
      code.push(kk + '++;}}}');
    } else if (n.kind === 'include') {
      if (bindings.length === 0) {
        code.push('if($D<8){const $f=$T.get(' + JSON.stringify(n.name) + ');if($f)$f($o,' + sv + ',$T,$D+1);}');
      } else {
        // Inside a loop: the callee runs in the same scope, so materialise
        // the current loop bindings into one scope object for the call.
        code.push('if($D<8){const $f=$T.get(' + JSON.stringify(n.name) + ');if($f){const $sc=Object.create(' + sv + ');');
        for (let b = 0; b < bindings.length; b++) {
          if (bindings[b] !== 'loop') code.push('$sc[' + JSON.stringify(bindings[b]) + ']=' + bindings[b] + ';');
        }
        code.push('$sc.loop=loop;$f($o,$sc,$T,$D+1);}}');
      }
    }
  }
}

function compileTemplate(nodes) {
  const code = [];
  genNodes(nodes, '$s', 0, code, []);
  const fn = new Function('$esc', '$tx', '$tr', '$lk', 'return function($o,$s,$T,$D){' + code.join('') + '}')(esc, tx, tr, lk);
  return fn;
}

// True when a template's output is fully determined by the case-global
// scope (site/tags/recent) plus loop variables bound by its own for-loops
// over case-determined collections. Such a template renders identically
// for every page in the case, so it can be rendered once and cached.
// `determined` holds the case-determined names in scope; `visiting`
// guards include cycles (conservative: a cycle is not hoistable).
const CASE_GLOBALS = new Set(['site', 'tags', 'recent']);
function isCaseDetermined(nodes, determined, parsed, visiting) {
  for (const n of nodes) {
    if (n.kind === 'text') continue;
    if (n.kind === 'var' || n.kind === 'raw') {
      if (!determined.has(n.path[0])) return false;
    } else if (n.kind === 'if') {
      if (!determined.has(n.path[0])) return false;
      if (!isCaseDetermined(n.then, determined, parsed, visiting)) return false;
      if (n.else !== null && !isCaseDetermined(n.else, determined, parsed, visiting)) return false;
    } else if (n.kind === 'for') {
      if (!determined.has(n.path[0])) return false;
      const d2 = new Set(determined);
      d2.add(n.name);
      d2.add('loop');
      if (!isCaseDetermined(n.body, d2, parsed, visiting)) return false;
    } else if (n.kind === 'include') {
      const sub = parsed.get(n.name);
      if (sub === undefined) continue;
      if (visiting.has(n.name)) return false;
      visiting.add(n.name);
      const ok = isCaseDetermined(sub, determined, parsed, visiting);
      visiting.delete(n.name);
      if (!ok) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------- build

const RESERVED = ['posts', 'tags', 'page'];

function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

function hasScheme(t) {
  const c0 = t.charCodeAt(0);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return false;
  for (let i = 1; i < t.length; i++) {
    const d = t.charCodeAt(i);
    if (d === 58) return true;
    if (!((d >= 48 && d <= 57) || (d >= 65 && d <= 90) || (d >= 97 && d <= 122) || d === 43 || d === 45 || d === 46)) return false;
  }
  return false;
}

export function run(input) {
  const base = input.site.base_url.replace(/\/+$/, '');
  const slugCache = new Map();
  const dateCache = new Map();
  const report = [];
  const broken = new Set();

  // Templates, parsed in code-unit order of name.
  const templates = new Map();
  const parsed = new Map();
  const tplNames = Object.keys(input.templates).sort(byCodeUnits);
  for (const name of tplNames) {
    try {
      const nodes = tplParse(name, input.templates[name]);
      parsed.set(name, nodes);
      templates.set(name, compileTemplate(nodes));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }

  // Sources, in code-unit order of path.
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  let sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) sources.push({ path: f.path, text: f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n') });
    else statics.push({ path: f.path, content: f.content });
  }

  // Front matter + checks, in order.
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let ownDir = null;
    if (s.path.startsWith('tags/')) ownDir = 'tags';
    else if (s.path.startsWith('page/')) ownDir = 'page';
    if (ownDir !== null) {
      report.push(`refused ${s.path}: ${ownDir}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout !== undefined ? s.data.layout : (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  sources = kept;

  // Permalinks.
  const takenByDir = new Map();
  const bySource = new Map();
  for (const s of sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let taken = takenByDir.get(dir);
    if (taken === undefined) {
      taken = new Set(dir === '' ? RESERVED : []);
      takenByDir.set(dir, taken);
    }
    const slug = uniqueSlug(s.data.slug !== undefined ? s.data.slug : slugify(s.data.title, slugCache), taken);
    s.slug = slug;
    s.outDir = dir === '' ? slug : dir + '/' + slug;
    s.url = base + '/' + s.outDir + '/';
    bySource.set(s.path, s);
  }

  // Markdown, with cached link resolution per (dir, target).
  const staticPaths = new Set();
  for (const f of statics) staticPaths.add(f.path);
  const dirPartsCache = new Map();
  const linkCache = new Map();
  const resolveRel = (dir, rel) => {
    let parts = dirPartsCache.get(dir);
    if (parts === undefined) {
      parts = dir === '' ? [] : dir.split('/');
      dirPartsCache.set(dir, parts);
    }
    const p = parts.slice();
    const segs = rel.split('/');
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (p.length === 0) return null;
        p.pop();
      } else p.push(seg);
    }
    return p.join('/');
  };
  for (const s of sources) {
    const dir = dirOf(s.path);
    const srcPath = s.path;
    let lc = linkCache.get(dir);
    if (lc === undefined) { lc = new Map(); linkCache.set(dir, lc); }
    const link = (target) => {
      if (hasScheme(target) || target.charCodeAt(0) === 47 || target.charCodeAt(0) === 35) return target;
      const hit = lc.get(target);
      if (hit !== undefined) {
        if (hit === null) broken.add(`broken-link ${srcPath} -> ${target}`);
        return hit === null ? target : hit;
      }
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolveRel(dir, rel);
      let out = null;
      if (path !== null) {
        const pg = bySource.get(path);
        if (pg !== undefined) out = pg.url + frag;
        else if (staticPaths.has(path)) out = base + '/' + path + frag;
      }
      if (out === null) {
        lc.set(target, null);
        broken.add(`broken-link ${srcPath} -> ${target}`);
        return target;
      }
      lc.set(target, out);
      return out;
    };
    const lines = s.body.split('\n');
    const md = renderMarkdown(lines, link, slugCache);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
    s.words = countWords(s.body);
  }

  // Collections.
  const posts = sources.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  // Tags.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const names = s.data.tags !== undefined ? s.data.tags : [];
    const out = [];
    for (const name of names) {
      const slug = slugify(name, slugCache);
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push(name);
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name, slugCache);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: base + '/tags/' + slug + '/', posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of sources) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map((name) => {
      const slug = slugify(name, slugCache);
      const t = bySlug.get(slug);
      return t !== undefined ? t : { name, slug, url: '', posts: [] };
    });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // Cards / pages.
  const dateLongOf = (s) => (s.data.date === undefined ? '' : longDate(s.data.date, dateCache));
  const readingOf = (s) => Math.max(1, Math.ceil(s.words / 200));
  const cards = new Map();
  const cardOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date !== undefined ? s.data.date : '',
    date_long: dateLongOf(s),
    summary: s.data.summary !== undefined ? s.data.summary : '',
    excerpt: s.excerpt,
    reading_minutes: readingOf(s),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  });
  for (const p of posts) cards.set(p, cardOf(p));
  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date !== undefined ? s.data.date : '', date_long: dateLongOf(s) });
  const pageOf = (s) => {
    const c = cardOf(s);
    c.slug = s.slug;
    c.content = s.html;
    c.toc = s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html }));
    c.newer = linkOf(s.post ? s.newer : null);
    c.older = linkOf(s.post ? s.older : null);
    c.is_post = s.post;
    return c;
  };

  // Layouts.
  const output = {};
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  // Hoist case-determined templates: render once per case, cache the string.
  {
    const hoistScope = Object.create(null);
    hoistScope.site = site;
    hoistScope.tags = allTags;
    hoistScope.recent = recent;
    for (const name of tplNames) {
      const nodes = parsed.get(name);
      if (nodes === undefined) continue;
      if (!isCaseDetermined(nodes, CASE_GLOBALS, parsed, new Set([name]))) continue;
      const fn = templates.get(name);
      if (fn === undefined) continue;
      const out = [];
      fn(out, hoistScope, templates, 0);
      const str = out.join('');
      templates.set(name, (o) => { o.push(str); });
    }
  }
  const renderScope = Object.create(null);
  renderScope.site = site;
  renderScope.tags = allTags;
  renderScope.recent = recent;
  const render = (name, vars) => {
    const fn = templates.get(name);
    if (fn === undefined) return null;
    renderScope.page = undefined;
    renderScope.posts = undefined;
    renderScope.pager = undefined;
    renderScope.tag = undefined;
    for (const k of Object.keys(vars)) renderScope[k] = vars[k];
    const out = [];
    fn(out, renderScope, templates, 0);
    return out.join('');
  };
  for (const s of sources) output[s.outDir + '/index.html'] = render(s.layout, { page: pageOf(s) });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? base + '/' : base + '/page/' + k + '/');
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : 'page/' + k + '/index.html'] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) } });
    if (html !== null) output['tags/' + t.slug + '/index.html'] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  let staticCount = statics.length;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // Report.
  const lines = [...report, ...broken].sort(byCodeUnits);
  let pageCount = 0;
  for (const s of sources) if (!s.post) pageCount++;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${staticCount} static files`);
  output['build-report.txt'] = lines.join('\n') + '\n';
  return output;
}
