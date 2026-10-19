/* Team 10 X Archiver - results page.
 * 1) loads the post + its replies in the X tab (xcapture.js)  2) (optional) captures the original X page as one long ad-free PDF
 * 3) downloads media for embedding
 * 4) review: flag replies, pick images, highlight post/reply text to add information entries with quotes, fill in the Assessment
 * 5) export DOCX / TXT / PDF (original page or full thread) or copy DOCX content; add to the working document */
const $ = id => document.getElementById(id);
let job = null, data = null, builtAt = null, entries = [], pdfBlob = null;
const hlTargets = new Map();   // highlight key -> element on the review page
const commentUi = new Map();   // reply id -> { cb }
const commentById = new Map();
let entrySeq = 0;

/* ------------------------------------------------------------------ utilities */
const p2 = n => String(n).padStart(2, '0');
const logEl = $('log');
function log(t) { logEl.textContent += t + '\n'; logEl.scrollTop = logEl.scrollHeight; }
function setStatus(t) { $('status').textContent = t; }
function setBar(p) { $('bar').style.width = Math.max(0, Math.min(100, p)) + '%'; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function nowParts(d) { d = d || new Date(); return { d: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, t: `${p2(d.getHours())}:${p2(d.getMinutes())}` }; }
function tparts(t) {
  if (!t || !t.epoch) return null;
  const x = nowParts(new Date(t.epoch * 1000));
  return { d: x.d, t: x.t, approx: !!t.approx };
}
const stampAt = t => { const x = tparts(t); return x ? `${x.d} at ${x.t}${x.approx ? ' (approx.)' : ''}` : 'Unknown'; };
const stampComma = t => { const x = tparts(t); return x ? `${x.d}, ${x.t}${x.approx ? ' (approx.)' : ''}` : 'Unknown'; };
const dateOnly = t => { const x = tparts(t); return x ? x.d : 'Unknown date'; };
const nameLine = a => a.handle ? (a.name && a.name !== a.handle ? `${a.name} (@${a.handle})` : '@' + a.handle) : (a.name || 'Unknown');
const urlLine = a => a.url || '';
// Removes emoji (and the invisible joiners/variation selectors that go with them), keeping (c) (R) (TM).
const EMOJI_RE = /(?![©®™])\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}‍️⃣]/gu;
const stripEmoji = s => String(s == null ? '' : s).replace(EMOJI_RE, '')
  .replace(/(\S) {2,}(?=\S)/g, '$1 ').replace(/[ \t]+(\r?\n)/g, '$1').replace(/[ \t]+$/, '');
const lines = s => String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
const safeName = s => String(s).replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const Q = s => '“' + s + '”';
const statusId = u => { const m = String(u || '').match(/\/status(?:es)?\/(\d+)/); return m ? m[1] : ''; };
const snip = s => { const x = String(s || '').replace(/\s+/g, ' ').trim(); return !x ? '(no text)' : x.length <= 80 ? x : x.slice(0, 78).replace(/\s+\S*$/, '') + '…'; };

function el(doc, tag, props, ...kids) {
  const e = doc.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (k === 'class') { if (v) e.className = v; }
    else if (k === 'text') e.textContent = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  kids.flat().forEach(k => { if (k == null || k === false) return; e.append(k.nodeType ? k : doc.createTextNode(k)); });
  return e;
}
const linkIn = (doc, url, text) => url ? el(doc, 'a', { href: url, target: '_blank', rel: 'noopener', text: text || url }) : doc.createTextNode('');
const link = (url, text) => linkIn(document, url, text);

async function focusMe() {
  try {
    const t = await chrome.tabs.getCurrent();
    if (t) { await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); }
  } catch (e) { /* ignore */ }
}

/* -------------------------------------------------------------------- capture (in the X tab) */
// Progress messages from xcapture.js running in the X tab.
chrome.runtime.onMessage.addListener(m => {
  if (!m || !m.t10x) return;
  if (m.t10x === 'log') log(m.msg);
  else if (m.t10x === 'progress') { setStatus(m.msg); if (m.pct != null) setBar(m.pct); }
});

// The tab showing this post, or a temporary tab opened for it.
async function xTab(id) {
  if (job.tabId) {
    try { const t = await chrome.tabs.get(job.tabId); if (statusId(t.url) === id) return { tab: t, temp: false }; } catch (e) { /* closed */ }
  }
  log('Opening the X post in a new tab...');
  const t = await chrome.tabs.create({ url: `https://x.com/i/status/${id}`, active: false });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const x = await chrome.tabs.get(t.id).catch(() => null);
    if (!x) throw new Error('The X tab was closed.');
    if (x.status === 'complete') break;
  }
  await sleep(800);
  return { tab: await chrome.tabs.get(t.id), temp: true };
}
async function toFront(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  await sleep(600);
}

// Runs xcapture.js in the X tab for one post; the Stop button on this page interrupts it.
async function runCapture(tab, pid, max) {
  const target = { tabId: tab.id };
  await chrome.scripting.executeScript({ target, files: ['xcapture.js'] });
  const [r] = await chrome.scripting.executeScript({ target, func: (p, m) => window.__T10X.capture({ id: p, max: m }), args: [pid, max] });
  return r && r.result;
}
let stopAll = false;
function showStop(tab, label) {
  const stop = $('stopBtn');
  stop.textContent = label; stop.style.display = 'inline-block'; stop.disabled = false;
  stop.onclick = () => { stopAll = true; stop.disabled = true; stop.textContent = 'Stopping...'; chrome.tabs.sendMessage(tab.id, { t10xStop: true }).catch(() => { }); };
}
const hideStop = () => { $('stopBtn').style.display = 'none'; };
async function waitLoaded(tabId) {
  await sleep(300);
  for (let i = 0; i < 60; i++) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) throw new Error('The X tab was closed.');
    if (t.status === 'complete') break;
    await sleep(250);
  }
}

async function captureX(id) {
  const { tab, temp } = await xTab(id);
  let moved = false;
  try {
    setStatus('Loading the post and its replies in the X tab (it is brought to the front – leave it alone until this page returns)...');
    await toFront(tab);
    showStop(tab, 'Stop loading replies (keep what has been collected)');
    let res;
    try { res = await runCapture(tab, id, job.maxReplies || 1000); } finally { hideStop(); }
    if (!res || !res.ok) throw new Error((res && res.error) || 'No result came back from the X tab.');
    if (job.opts.pdf) {
      try { await stitchPdf(tab); } catch (e) { log('PDF capture failed: ' + (e.message || e)); setStatus('PDF capture failed: ' + (e.message || e)); await sleep(1500); }
    }
    // Fewer replies on the page than X reports? Usually they are replies to replies, which X only shows on each reply's own page.
    const st = res.stats || {}, fi = res.tweets.findIndex(t => t.id === id), found = res.tweets.length - fi - 1;
    const want = st.reported == null ? 0 : Math.min(st.reported, job.maxReplies || 1000);
    if (want && found < want && !st.stopped) {
      const cands = res.tweets.slice(fi + 1).filter(t => t.replies > 0);
      if (!cands.length) log(`X reports ${st.reported} replies but shows ${found}. The others are hidden by X (deleted, from protected, suspended or blocked accounts, or filtered out) and cannot be captured.`);
      else {
        await focusMe();
        const go = await ask(`X reports ${st.reported} replies for this post, but ${found} ${found === 1 ? 'was' : 'were'} found on the post's page.\n\n` +
          `Most of the rest are probably replies to replies: X only shows those on each reply's own page. ${cands.length} of the replies found have replies of their own.\n\n` +
          `Search them too? The X tab will open each of those replies in turn – this can take a little while (roughly ${Math.max(1, Math.round(cands.length * 6 / 60))} minute(s) or more). You can stop at any time and keep what has been found.`,
          ['No, continue with what was found', 'Yes, search replies to replies']);
        if (go === 1) { moved = true; await toFront(tab); await deepSearch(tab, res, id, want); }
        else log('Replies to replies were not searched.');
      }
    }
    return res;
  } finally {
    hideStop();
    if (temp) await chrome.tabs.remove(tab.id).catch(() => { });
    else if (moved) await chrome.tabs.update(tab.id, { url: job.url }).catch(() => { }); // put the user's tab back on the post
    await focusMe();
  }
}

// Opens replies that have replies of their own (biggest first) and adds what is found under them, until X's reported
// total is reached, nothing is left to open, or Stop is pressed.
async function deepSearch(tab, res, id, want) {
  const tw = res.tweets, byId = new Map(tw.map(t => [t.id, t])), st = res.stats;
  const fi = tw.findIndex(t => t.id === id);
  tw.forEach((t, i) => { t.depth = i > fi ? (t.depth || 0) : 0; });
  const queue = tw.slice(fi + 1).filter(t => t.replies > 0).sort((a, b) => b.replies - a.replies);
  let found = tw.length - fi - 1, opened = 0, added = 0;
  stopAll = false;
  showStop(tab, 'Stop searching (keep what has been found)');
  log(`Searching replies to replies: ${queue.length} repl${queue.length === 1 ? 'y has' : 'ies have'} replies of their own.`);
  try {
    while (queue.length && found < want && !stopAll && opened < 300) {
      const p = queue.shift(); opened++;
      setStatus(`Searching replies to replies – opening reply ${opened} (by @${p.handle}, ${p.replies} repl${p.replies === 1 ? 'y' : 'ies'}). ${found} of ${want} found so far...`);
      setBar(Math.min(80, 70 + (found / want) * 10));
      try {
        await chrome.tabs.update(tab.id, { url: p.url }); await waitLoaded(tab.id);
        const r = await runCapture(tab, p.id, p.replies);
        if (!r || !r.ok) { log(`Could not open the reply by @${p.handle}: ${(r && r.error) || 'no result'}`); continue; }
        if (r.stats) st.ads = (st.ads || 0) + (r.stats.ads || 0);
        const sub = r.tweets, pi = sub.findIndex(t => t.id === p.id), kids = [];
        let fresh = 0;
        sub.slice(pi + 1).forEach(k => {
          const old = byId.get(k.id);
          if (!old) { kids.push(k); byId.set(k.id, k); fresh++; return; }
          // already captured flat on the main page: move it under its parent
          if (!old.parent && tw.indexOf(old) > fi && old !== p) { tw.splice(tw.indexOf(old), 1); kids.push(old); }
        });
        if (!kids.length) continue;
        let pos = tw.indexOf(p) + 1;
        while (pos < tw.length && (tw[pos].depth || 0) > p.depth) pos++;
        kids.forEach(k => { k.depth = p.depth + 1; k.parent = p.id; });
        tw.splice(pos, 0, ...kids);
        found = tw.length - fi - 1; added += fresh;
        kids.filter(k => k.replies > 0 && !queue.includes(k)).forEach(k => queue.push(k));
      } catch (e) { log(`Error opening the reply by @${p.handle}: ${e.message || e}`); if (/closed/.test(e.message || '')) break; }
    }
  } finally { hideStop(); }
  log(`Replies to replies: opened ${opened} repl${opened === 1 ? 'y' : 'ies'}, ${added} more found – ${found} of ${st.reported} in total.` +
    (stopAll ? ' (stopped by you)' : '') + (found < want && !stopAll && !queue.length ? ' The rest are hidden by X (deleted, protected, suspended or blocked accounts, or filtered out).' : ''));
  st.deep = { opened, added };
}

/* ------------------------------------------ one long, ad-free PDF of the original X page */
// X only draws the posts near the screen, so a normal "print to PDF" comes out blank. Instead the page is
// scrolled one screen at a time, each screen is photographed and the photos are stacked into one long PDF page.
const dbgAttach = t => new Promise((res, rej) => chrome.debugger.attach(t, '1.3', () => chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res()));
const dbgSend = (t, m, p) => new Promise((res, rej) => chrome.debugger.sendCommand(t, m, p || {}, r => chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(r)));
const dbgDetach = t => new Promise(res => chrome.debugger.detach(t, () => { void chrome.runtime.lastError; res(); }));

async function stitchPdf(tab) {
  const target = { tabId: tab.id };
  const ex = (func, args) => chrome.scripting.executeScript({ target, func, args: args || [] }).then(r => r && r[0] && r[0].result);
  setStatus('Capturing the original X page as a PDF (removing ads, loading images)...');
  log('PDF: removing ads / sign-up bars, loading lazy images...');
  await chrome.scripting.executeScript({ target, files: ['cleanpage.js'] });
  await ex(() => window.__T10CLEAN.prepare({ noScroll: true }));
  setBar(75);
  let attached = false;
  try {
    await dbgAttach(target); attached = true;
    await dbgSend(target, 'Emulation.setEmulatedMedia', { media: 'screen' });
    const shots = []; let y = 0, vh = 0, lastY = -1;
    for (let i = 0; i < 400; i++) {
      const m = await ex(async yy => {
        scrollTo(0, yy); await new Promise(r => setTimeout(r, 200));
        if (window.__T10CLEAN) window.__T10CLEAN.again();
        const vis = [...document.images].filter(im => { const r = im.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
        const t0 = Date.now();
        while (Date.now() - t0 < 900 && vis.some(im => !im.complete)) await new Promise(r => setTimeout(r, 100));
        return { y: scrollY, vh: innerHeight, H: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) };
      }, [y]);
      if (m.y <= lastY) break;
      vh = m.vh; lastY = m.y;
      const s = await dbgSend(target, 'Page.captureScreenshot', { format: 'jpeg', quality: 80 });
      shots.push({ b64: s.data, y: m.y });
      setStatus(`Capturing the original X page as a PDF (screen ${i + 1})...`);
      if (m.y + m.vh >= m.H - 2) break;
      y = m.y + m.vh;
    }
    if (!shots.length) throw new Error('No screenshots could be taken.');
    const out = T10Pdf.fromShots(shots, vh);
    pdfBlob = new Blob([out.bytes], { type: 'application/pdf' });
    log(`PDF: created from ${shots.length} screens, ${Math.round(out.height)}px tall` + (out.scale < 1 ? `, scaled to ${Math.round(out.scale * 100)}%` : '') +
      (out.pages > 1 ? `, split into ${out.pages} very long pages (too tall for one PDF page)` : ', one page') + ` (${Math.round(out.bytes.length / 1024)} KB)`);
  } finally {
    if (attached) await dbgDetach(target);
    try { await ex(() => { if (window.__T10CLEAN) window.__T10CLEAN.restore(); scrollTo(0, 0); }); } catch (e) { /* tab gone */ }
  }
}
async function ensurePdf() {
  if (pdfBlob) return;
  const { tab, temp } = await xTab(data.id);
  try { await toFront(tab); await stitchPdf(tab); }
  finally { if (temp) await chrome.tabs.remove(tab.id).catch(() => { }); await focusMe(); }
}

/* ---------------------------------------------------------------- data model */
function buildData(res, id) {
  const tw = res.tweets || [], fi = tw.findIndex(t => t.id === id);
  if (fi < 0) throw new Error('The post itself could not be read from the X page.');
  const person = t => ({ name: t.name || '', handle: t.handle || '', url: t.handle ? 'https://x.com/' + t.handle : '' });
  const epoch = iso => { const n = Date.parse(iso || ''); return isNaN(n) ? 0 : n / 1000; };
  const media = t => (t.media || []).map(m => ({ type: m.type, src: m.src, target: m.target || '', include: true }));
  const quoted = q => q ? { author: person(q), posted: { epoch: epoch(q.time) }, text: q.text || '', url: q.url || '' } : null;
  const item = (t, kind) => ({
    id: t.id, kind, author: person(t), posted: { epoch: epoch(t.time) }, body: t.text || '', media: media(t), links: t.links || [],
    quoted: quoted(t.quoted), replyingTo: t.replyingTo || [], metrics: t.metrics || '', truncated: !!t.truncated, url: t.url,
    depth: kind === 'reply' ? (t.depth || 0) : 0, replies: t.replies,
    checked: false, reason: ''
  });
  const f = item(tw[fi], 'post');
  const d = {
    ...f, title: snip(f.body), videos: tw[fi].videos || [], stats: res.stats || {},
    comments: [...tw.slice(0, fi).map(t => item(t, 'context')), ...tw.slice(fi + 1).map(t => item(t, 'reply'))]
  };
  d.comments.forEach(c => commentById.set(c.id, c));
  return d;
}
const replies = () => data.comments.filter(c => c.kind === 'reply');
const context = () => data.comments.filter(c => c.kind === 'context');

/* ---------------------------------------------------------------------- media */
async function toJpeg(blob) {
  const bmp = await createImageBitmap(blob);
  const sc = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * sc)), h = Math.max(1, Math.round(bmp.height * sc));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
  const out = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
  const bytes = new Uint8Array(await out.arrayBuffer());
  const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(out); });
  return { bytes, w, h, dataUrl };
}
async function loadOne(src) {
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 20000);
    const res = await fetch(src, { signal: ctl.signal, credentials: 'omit' }); clearTimeout(to);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await toJpeg(await res.blob());
  } catch (e) { log('Could not embed media: ' + (e.message || e) + ' (' + src.slice(0, 80) + '...)'); return {}; }
}
async function fetchMedia(d) {
  const all = [...d.media, ...d.comments.flatMap(c => c.media)];
  if (!all.length) return;
  const cache = new Map();
  let next = 0, done = 0;
  const worker = async () => {
    while (next < all.length) {
      const m = all[next++];
      if (!cache.has(m.src)) cache.set(m.src, loadOne(m.src));
      Object.assign(m, await cache.get(m.src));
      done++;
      setStatus(`Downloading media ${done} of ${all.length}...`);
      setBar(85 + (done / all.length) * 10);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

/* ---------------------------------------------------------------- highlights */
// Highlight keys: 'body' (the post), 'qbody' (the post it quotes), 'c:<id>' (a reply), 'cq:<id>' (the post a reply quotes).
function textFor(key) {
  if (key === 'body') return data.body;
  if (key === 'qbody') return data.quoted ? data.quoted.text : '';
  const c = commentById.get(key.slice(key.indexOf(':') + 1)) || {};
  return key.startsWith('cq:') ? (c.quoted ? c.quoted.text : '') : (c.body || '');
}
function srcFor(key) {
  const by = a => nameLine(a);
  if (key === 'body') return { label: `Post by ${by(data.author)}`, date: stampComma(data.posted), url: data.url };
  if (key === 'qbody') return { label: `Post by ${by(data.quoted.author)}, quoted in the post by ${by(data.author)}`, date: stampComma(data.quoted.posted), url: data.quoted.url || data.url };
  const c = commentById.get(key.slice(key.indexOf(':') + 1)), what = c.kind === 'context' ? 'Earlier post in the thread' : 'Reply';
  if (key.startsWith('cq:')) return { label: `Post by ${by(c.quoted.author)}, quoted in a ${what.toLowerCase()} by ${by(c.author)}`, date: stampComma(c.quoted.posted), url: c.quoted.url || c.url, cid: c.id };
  return { label: `${what} by ${by(c.author)}`, date: stampComma(c.posted), url: c.url, cid: c.id };
}
const srcText = s => s ? `${s.label}, ${s.date} – ${s.url}` : '';

// Renders text into e, wrapping every quoted range (from the information entries) in <mark>.
function paint(e, key, text) {
  const doc = e.ownerDocument;
  const ents = entries.filter(x => x.key === key && x.end > x.start);
  e.textContent = '';
  if (!ents.length) { e.textContent = text; return; }
  const pts = [...new Set([0, text.length, ...ents.flatMap(x => [x.start, x.end])])].sort((a, b) => a - b);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], seg = text.slice(a, b);
    if (!seg) continue;
    const cov = ents.filter(x => x.start <= a && x.end >= b);
    if (cov.length) e.append(el(doc, 'mark', { class: 'hl', 'data-e': cov.map(x => x.id).join(' '), title: 'Quoted in an information entry – click to see it' }, seg));
    else e.append(doc.createTextNode(seg));
  }
}
function hlEl(doc, tag, cls, key, text, interactive) {
  const e = el(doc, tag, { class: cls });
  if (!text) { e.textContent = '(no text)'; return e; }
  e.setAttribute('data-hl', key);
  paint(e, key, text);
  if (interactive) hlTargets.set(key, e);
  return e;
}
const repaintAll = () => hlTargets.forEach((e, key) => paint(e, key, textFor(key)));

function rootOf(n) { n = n && (n.nodeType === 1 ? n : n.parentElement); return n ? n.closest('[data-hl]') : null; }
function offsetIn(root, node, off) { const r = document.createRange(); r.setStart(root, 0); r.setEnd(node, off); return r.toString().length; }
// The highlighted text, as { key, start, end, quote }, if it lies inside the post, a quoted post or one reply.
// A drag that starts or ends just outside the text (e.g. past the end of a reply) is clamped to that text.
function currentSel() {
  const s = window.getSelection();
  if (!s || !s.rangeCount || s.isCollapsed) return null;
  const r = s.getRangeAt(0), a = rootOf(r.startContainer), z = rootOf(r.endContainer), root = a || z;
  if (!root || (a && z && a !== z) || !$('view').contains(root)) return a && z ? { multi: true } : null;
  const key = root.getAttribute('data-hl'), text = textFor(key);
  let st = a ? offsetIn(root, r.startContainer, r.startOffset) : 0;
  let en = z ? offsetIn(root, r.endContainer, r.endOffset) : text.length;
  while (st < en && /\s/.test(text[st])) st++;
  while (en > st && /\s/.test(text[en - 1])) en--;
  if (en <= st) return null;
  return { key, start: st, end: en, quote: text.slice(st, en).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n') };
}

function hideBar() { $('hlBar').style.display = 'none'; }
function onSelection() {
  if (document.querySelector('.ovl')) return;
  const sel = currentSel();
  if (!sel || sel.multi) { hideBar(); if (sel && sel.multi) toast('Highlight text within a single post or reply.'); return; }
  const bar = $('hlBar'), r = window.getSelection().getRangeAt(0).getBoundingClientRect();
  bar.style.display = 'block';
  const bw = bar.offsetWidth, bh = bar.offsetHeight;
  let top = r.top + scrollY - bh - 8;
  if (r.top - bh - 8 < 4) top = r.bottom + scrollY + 8;
  const left = Math.max(scrollX + 6, Math.min(r.left + scrollX + r.width / 2 - bw / 2, scrollX + document.documentElement.clientWidth - bw - 6));
  bar.style.top = top + 'px'; bar.style.left = left + 'px';
}
function startEntry(errId) {
  const sel = currentSel();
  if (!sel || sel.multi) {
    const msg = sel && sel.multi ? 'Highlight text within a single post or reply, then press the button.' : 'Highlight some text in the post or in a reply first, then press the button.';
    if (errId && $(errId)) $(errId).textContent = msg; else toast(msg);
    return;
  }
  if (errId && $(errId)) $(errId).textContent = '';
  hideBar(); openModal(sel);
}

function flash(node) { if (!node) return; node.classList.add('flash'); setTimeout(() => node.classList.remove('flash'), 1600); }
function jumpToMark(id) { const m = document.querySelector(`#view mark.hl[data-e~="${id}"]`); if (m) { m.scrollIntoView({ block: 'center', behavior: 'smooth' }); flash(m); } }
function jumpToEntry(id) { const c = document.getElementById('entry-' + id); if (c) { c.scrollIntoView({ block: 'center', behavior: 'smooth' }); flash(c); } }

let toastTimer = null;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, 2600);
}
function updateDock() {
  if (!data || !$('fInfo')) return;
  $('dockInfo').textContent = `Information: ${infoItems().length}`;
  $('dockFlag').textContent = `Flagged replies: ${selected().length}`;
}

/* ------------------------------------------------------------------ rendering */
function mediaEls(doc, list, interactive) {
  return list.map(m => {
    const kids = [
      m.dataUrl ? el(doc, 'img', { src: m.dataUrl, alt: m.type }) : el(doc, 'div', { class: 'meta', text: `[${m.type} could not be embedded – it will be exported as a URL only] ${m.src}` }),
      m.type !== 'image' ? el(doc, 'div', { class: 'meta', text: m.type[0].toUpperCase() + m.type.slice(1) }) : null,
      m.target ? el(doc, 'div', { class: 'meta' }, 'Points to: ', linkIn(doc, m.target)) : null
    ];
    if (!interactive) return el(doc, 'div', { class: 'media' }, kids);
    const box = el(doc, 'div', { class: 'media mbox' + (m.include === false ? ' off' : '') });
    const cb = el(doc, 'input', { type: 'checkbox', title: 'Include this image in the DOCX / TXT / clipboard export and the working document' });
    cb.checked = m.include !== false;
    const lbl = el(doc, 'span', { text: cb.checked ? 'Included in export' : 'Left out of export' });
    cb.addEventListener('change', () => {
      m.include = cb.checked; box.classList.toggle('off', !cb.checked);
      lbl.textContent = cb.checked ? 'Included in export' : 'Left out of export';
    });
    box.append(el(doc, 'label', { class: 'pickrow' }, cb, lbl), ...kids.filter(Boolean));
    const img = box.querySelector('img');
    if (img) img.addEventListener('click', () => { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); });
    return box;
  });
}

function whoEls(doc, a) {
  return [
    el(doc, 'div', { class: 'name' }, a.url ? linkIn(doc, a.url, a.name || '@' + a.handle) : (a.name || 'Unknown'), a.handle && a.name ? `  @${a.handle}` : ''),
    el(doc, 'div', { class: 'meta' }, 'Profile: ', linkIn(doc, a.url) || '')
  ];
}
function quotedBox(doc, q, key, interactive) {
  if (!q) return null;
  return el(doc, 'div', { class: 'quoted' },
    el(doc, 'div', { class: 'meta' }, 'QUOTED POST  |  ', q.author.url ? linkIn(doc, q.author.url, nameLine(q.author)) : nameLine(q.author),
      q.posted.epoch ? '  |  ' + stampAt(q.posted) : '', q.url && statusId(q.url) ? ['  |  ', linkIn(doc, q.url, 'Quoted post URL')] : null),
    hlEl(doc, 'div', 'body', key, q.text, interactive));
}

function postBox(doc, interactive) {
  const d = data, media = mediaEls(doc, d.media, interactive), st = d.stats || {};
  const notes = [];
  if (st.ads) notes.push(`${st.ads} promoted post(s) (ads) skipped`);
  if (st.unavailable) notes.push(`${st.unavailable} unavailable/deleted post(s) shown by X`);
  if (st.hitMax) notes.push(`stopped at the ${job.maxReplies} reply limit chosen in the popup`);
  if (st.stopped) notes.push('reply loading ' + st.stopped.replace(/ – .*$/, ''));
  return el(doc, 'div', { class: 'box post' },
    el(doc, 'div', { class: 'meta', text: 'ORIGINAL POST' }),
    whoEls(doc, d.author),
    el(doc, 'div', { class: 'meta', text: 'Posted: ' + stampAt(d.posted) }),
    el(doc, 'div', { class: 'meta' }, 'Post URL: ', linkIn(doc, d.url)),
    d.replyingTo.length ? el(doc, 'div', { class: 'meta', text: 'Replying to: ' + d.replyingTo.join(' ') }) : null,
    d.metrics ? el(doc, 'div', { class: 'meta', text: 'Engagement (at capture): ' + d.metrics }) : null,
    hlEl(doc, 'div', 'body', 'body', d.body, interactive),
    quotedBox(doc, d.quoted, 'qbody', interactive),
    interactive && media.length > 1 ? el(doc, 'div', { class: 'imggrid' }, media) : media,
    d.links.length ? el(doc, 'div', { class: 'meta' }, 'Post links to: ', d.links.map((u, i) => [i ? ' | ' : '', linkIn(doc, u)])) : null,
    el(doc, 'div', { class: 'meta', style: 'margin-top:8px', text: `Replies captured: ${replies().length}` + (st.reported != null ? ` of ${st.reported} reported by X` : '') + (context().length ? ` | earlier posts in the thread: ${context().length}` : '') + (notes.length ? ' | ' + notes.join(' | ') : '') }));
}

function commentBox(doc, c, interactive) {
  const box = el(doc, 'div', { class: 'box comment' + (c.checked ? ' sel' : '') });
  box.style.marginLeft = (Math.min(c.depth || 0, 10) * 28) + 'px';
  const cb = el(doc, 'input', { type: 'checkbox', title: 'Flag this reply to save' });
  cb.checked = !!c.checked;
  if (!interactive) cb.disabled = true;

  const reasonWrap = el(doc, 'div', { class: 'reason' });
  const body = el(doc, 'div', { class: 'cbody' },
    whoEls(doc, c.author),
    el(doc, 'div', { class: 'meta' }, (c.kind === 'context' ? 'Earlier post in the thread' : 'Reply') + ' | ' + stampAt(c.posted) + ' | ', linkIn(doc, c.url, 'Reply URL')),
    c.replyingTo.length ? el(doc, 'div', { class: 'meta', text: 'Replying to: ' + c.replyingTo.join(' ') }) : null,
    c.metrics ? el(doc, 'div', { class: 'meta', text: 'Engagement (at capture): ' + c.metrics }) : null,
    hlEl(doc, 'div', 'body', 'c:' + c.id, c.body, interactive),
    c.truncated ? el(doc, 'div', { class: 'meta', text: '(X shortened this reply on the page – open it on X to read all of it)' }) : null,
    quotedBox(doc, c.quoted, 'cq:' + c.id, interactive),
    mediaEls(doc, c.media, interactive),
    reasonWrap);

  if (interactive) {
    commentUi.set(c.id, { cb });
    const ta = el(doc, 'textarea', { rows: 2, placeholder: 'Why do you want to save this reply?' });
    ta.value = c.reason || '';
    ta.addEventListener('input', () => { c.reason = ta.value; });
    reasonWrap.append(el(doc, 'label', { text: 'Reason for saving this reply' }), ta);
    reasonWrap.style.display = c.checked ? 'block' : 'none';
    cb.addEventListener('change', () => {
      c.checked = cb.checked;
      box.classList.toggle('sel', cb.checked);
      reasonWrap.style.display = cb.checked ? 'block' : 'none';
      if (cb.checked && !document.querySelector('.ovl')) ta.focus({ preventScroll: true });
      updateDock();
    });
  } else if (c.checked) {
    reasonWrap.style.display = 'block';
    reasonWrap.append(el(doc, 'label', { text: 'Reason for saving this reply' }), el(doc, 'div', { class: 'printval', text: c.reason || 'None given' }));
  }
  box.append(el(doc, 'div', { class: 'cwrap' }, cb, body));
  return box;
}

/* ---- information entries with quotes */
function entryBox(e) {
  const box = el(document, 'div', { class: 'box entry', id: 'entry-' + e.id });
  const x = el(document, 'button', { type: 'button', class: 'xbtn', title: 'Delete this entry', text: '×' });
  x.addEventListener('click', () => { entries.splice(entries.indexOf(e), 1); box.remove(); repaintAll(); updateDock(); });
  const ta = el(document, 'textarea', { rows: 2 });
  ta.value = e.text;
  ta.addEventListener('input', () => { e.text = ta.value; });
  const show = el(document, 'button', { type: 'button', class: 'linkbtn', text: 'Show in page' });
  show.addEventListener('click', () => jumpToMark(e.id));
  box.append(x, ta, el(document, 'div', { class: 'printval quoteval', text: Q(e.quote) }),
    el(document, 'div', { class: 'srcline' }, 'Source: ', e.src.label + ', ' + e.src.date + ' – ', link(e.src.url, 'open on X'), '  ', show));
  return box;
}

function openModal(sel) {
  const src = srcFor(sel.key);
  const c = src.cid ? commentById.get(src.cid) : null;
  const ov = el(document, 'div', { class: 'ovl' });
  const ta = el(document, 'textarea', { rows: 4, placeholder: 'Enter the information relating to this quote...' });
  const err = el(document, 'div', { class: 'err' });
  const flag = el(document, 'input', { type: 'checkbox' });
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const add = () => {
    if (!ta.value.trim()) { err.textContent = 'Please enter the information before adding.'; ta.focus(); return; }
    const e = { id: 'e' + (++entrySeq), text: ta.value.trim(), quote: sel.quote, key: sel.key, start: sel.start, end: sel.end, src };
    entries.push(e); $('entries').append(entryBox(e));
    window.getSelection().removeAllRanges(); $('infoErr').textContent = '';
    close(); repaintAll();
    if (c && flag.checked) { const u = commentUi.get(c.id); if (u && !u.cb.checked) { u.cb.checked = true; u.cb.dispatchEvent(new Event('change')); } }
    updateDock();
    toast('Information entry added' + (c && flag.checked ? ' and reply flagged' : '') + '.');
  };
  const onKey = ev => { if (ev.key === 'Escape') close(); else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) add(); };
  const bAdd = el(document, 'button', { type: 'button', class: 'abtn', text: 'Add' });
  const bCancel = el(document, 'button', { type: 'button', class: 'abtn alt', text: 'Cancel' });
  bAdd.addEventListener('click', add); bCancel.addEventListener('click', close);
  ov.append(el(document, 'div', { class: 'mdl' },
    el(document, 'h3', { text: 'Add Information Entry With Quote' }),
    el(document, 'div', { class: 'meta', text: 'Quoted text' }),
    el(document, 'div', { class: 'printval quoteval', style: 'margin-left:0', text: Q(sel.quote) }),
    el(document, 'div', { class: 'meta', style: 'margin-top:6px', text: 'Source: ' + src.label + ', ' + src.date }),
    el(document, 'label', { text: 'Information' }), ta,
    c && !c.checked ? el(document, 'label', { class: 'chk' }, flag, 'Also flag this ' + (c.kind === 'context' ? 'post' : 'reply') + ' as a Reply of Interest') : null,
    err, el(document, 'div', { class: 'mbtns' }, bCancel, bAdd)));
  document.addEventListener('keydown', onKey);
  document.body.append(ov); ta.focus();
}

function assessment(doc, interactive, man) {
  const wrap = el(doc, 'div', { id: 'assess' });
  wrap.append(el(doc, 'h2', { class: 'sec', text: 'Assessment' }));
  const fld = (id, label, rows, hint, val) => el(doc, 'div', { class: 'field' },
    el(doc, 'label', {}, label, el(doc, 'span', { class: 'hint', text: interactive ? hint || '' : '' })),
    interactive ? el(doc, 'textarea', { id, rows }) : el(doc, 'div', { class: 'printval', text: val || '' }));
  wrap.append(fld('fNotes', 'Notes', 3, '', man.notes));
  if (interactive) {
    const info = fld('fInfo', 'Information', 4, ' (required – one item per line; entries added with quotes appear below)');
    info.append(el(doc, 'div', { class: 'err', id: 'infoErr' }), el(doc, 'div', { id: 'entries' }));
    wrap.append(info);
  } else {
    const f = el(doc, 'div', { class: 'field' }, el(doc, 'label', { text: 'Information' }));
    const items = infoItems();
    if (!items.length) f.append(el(doc, 'div', { class: 'printval', text: '' }));
    items.forEach(x => f.append(el(doc, 'div', { class: 'box entry', style: 'padding-left:12px' },
      el(doc, 'div', { class: 'body', text: x.text }),
      x.quote ? el(doc, 'div', { class: 'printval quoteval', text: Q(x.quote) }) : null,
      x.source ? el(doc, 'div', { class: 'srcline', text: 'Source: ' + x.source }) : null)));
    wrap.append(f);
  }
  wrap.append(fld('fNext', 'Next Action(s)', 4, ' (one item per line)', man.next));
  return wrap;
}

function buildView(doc, interactive) {
  const man = interactive ? { notes: '', next: '' } : manual();
  const wrap = el(doc, 'div', { id: 'archive' });
  wrap.append(el(doc, 'div', { class: 'hdrbox' }, 'Page built: ', el(doc, 'b', { text: builtAt.d + ', ' + builtAt.t }), '   |   Team Member: ', el(doc, 'b', { text: job.name })));
  if (interactive) wrap.append(el(doc, 'div', { class: 'tip' },
    el(doc, 'b', { text: 'How to use this page: ' }),
    'tick the replies of interest (and give a reason); highlight text in the post, a quoted post or any reply and press "Add Information Entry With Quote"; ' +
    'untick an image to leave it out of the export; fill in the Assessment at the bottom, then press Export or Add to Working Document.'));
  const ctx = context();
  if (ctx.length) {
    wrap.append(el(doc, 'h2', { class: 'sec', text: `Earlier posts in this thread (${ctx.length})` }),
      el(doc, 'div', { class: 'meta', text: 'The archived post is a reply; these are the posts above it in the conversation.' }));
    ctx.forEach(c => wrap.append(commentBox(doc, c, interactive)));
  }
  wrap.append(postBox(doc, interactive));
  if (interactive) {
    const btn = el(doc, 'button', { type: 'button', class: 'abtn', text: 'Add Information Entry With Quote' });
    btn.addEventListener('mousedown', e => e.preventDefault()); // keep the text selection
    btn.addEventListener('click', () => startEntry('entryErr'));
    wrap.append(el(doc, 'div', { class: 'actionrow' }, btn, el(doc, 'div', { class: 'err', id: 'entryErr' })));
  }
  const rs = replies();
  wrap.append(el(doc, 'h2', { class: 'sec', text: `Replies (${rs.length})` }));
  if (!rs.length) wrap.append(el(doc, 'div', { class: 'meta', text: 'No replies were captured.' }));
  rs.forEach(c => wrap.append(commentBox(doc, c, interactive)));
  wrap.append(assessment(doc, interactive, man));
  return wrap;
}

/* --------------------------------------------------------------------- export */
const manual = () => { const g = id => ($(id) ? $(id).value : ''); return { notes: g('fNotes').trim(), info: g('fInfo'), next: g('fNext') }; };
const infoItems = () => [
  ...lines(manual().info).map(text => ({ text })),
  ...entries.map(e => ({ text: (e.text || '').trim() || '(no comment)', quote: e.quote, source: srcText(e.src) }))
];
function validate() {
  const ok = infoItems().length > 0;
  $('infoErr').textContent = ok ? '' : 'Information is required – please enter at least one item (or add an entry with a quote) before exporting.';
  if (!ok) { $('fInfo').scrollIntoView({ block: 'center' }); $('fInfo').focus(); }
  return ok;
}

const heading = () => `${dateOnly(data.posted)} - @${data.author.handle} - ${data.title}`;
const baseName = () => safeName(stripEmoji(heading()).replace(/\u2026/g, '')) || 'X post';
const selected = () => data.comments.filter(c => c.checked);
const included = list => list.filter(m => m.include !== false);

async function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try { await chrome.downloads.download({ url, filename, saveAs: true }); }
  catch (e) { const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

const mediaModel = m => ({ url: m.target || m.src, bytes: m.bytes, w: m.w, h: m.h, dataUrl: m.dataUrl, fallback: m.target || m.src });
const quotedModel = q => q ? { by: nameLine(q.author), date: q.posted.epoch ? stampComma(q.posted) : '', url: q.url, text: q.text } : null;

// One model feeds the DOCX file, the clipboard copy, the TXT export and the working document.
function buildModel() {
  const man = manual();
  return {
    heading: heading(), title: data.title, handle: data.author.handle, author: nameLine(data.author),
    postedBy: nameLine(data.author), profileUrl: urlLine(data.author), postedOn: stampComma(data.posted), url: data.url,
    inReplyTo: data.replyingTo.join(', '), metrics: data.metrics,
    capturedOn: builtAt.d + ', ' + builtAt.t, capturedBy: job.name,
    body: data.body, quoted: quotedModel(data.quoted), links: data.links, media: included(data.media).map(mediaModel),
    comments: selected().map(c => ({
      username: nameLine(c.author), url: urlLine(c.author), commentUrl: c.url, date: stampComma(c.posted),
      position: c.kind === 'context' ? 'Earlier post in the thread (the archived post replies to it)' : '',
      replyingTo: c.replyingTo.join(', '), metrics: c.metrics,
      text: c.body + (c.truncated ? ' [shortened by X – see the reply URL for the full text]' : ''), quoted: quotedModel(c.quoted),
      media: included(c.media).map(mediaModel), reason: (c.reason || '').trim()
    })),
    notes: man.notes, info: infoItems(), next: lines(man.next)
  };
}

async function saveDocx() {
  const bytes = T10Docx.build(buildModel());
  await saveBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), baseName() + '.docx');
}

function buildTxt() {
  const EQ = '='.repeat(80), DASH = '-'.repeat(80), m = buildModel(), L = [];
  const ind = (s, pad) => String(s).replace(/\r?\n/g, '\r\n' + pad);
  const quote = q => { if (q) L.push(`Quoted Post: ${q.by}${q.date ? ', ' + q.date : ''}${q.url ? ' – ' + q.url : ''}`, '  ' + ind(Q(q.text), '  ')); };
  L.push(EQ, `--- ${m.heading} ---`, DASH,
    `Posted By: ${m.postedBy}`, `Profile/Page URL: ${m.profileUrl}`, `Posted On: ${m.postedOn}`, `Post URL: ${m.url}`);
  if (m.inReplyTo) L.push(`In Reply To: ${m.inReplyTo}`);
  if (m.metrics) L.push(`Engagement (at capture): ${m.metrics}`);
  L.push('Archive Link:', DASH, `Captured On: ${m.capturedOn}`, `Captured By: ${m.capturedBy}`, DASH,
    '--- Original Post Text and/or Media ---', DASH, m.body || '(no text)');
  quote(m.quoted);
  m.links.forEach(u => L.push(`Post links to: ${u}`));
  m.media.forEach(x => L.push(x.url));
  L.push(EQ, '', EQ, '--- Reply(s) of Interest ---');
  if (!m.comments.length) L.push(DASH, 'No replies selected.');
  m.comments.forEach((c, i) => {
    L.push(DASH, `Reply ${i + 1}`, DASH, `Username: ${c.username}`, `Profile URL: ${c.url}`, `Reply URL: ${c.commentUrl}`, `Replied On: ${c.date}`);
    if (c.position) L.push(`Position: ${c.position}`);
    if (c.replyingTo) L.push(`Replying To: ${c.replyingTo}`);
    if (c.metrics) L.push(`Engagement (at capture): ${c.metrics}`);
    L.push(DASH, `Reply: ${c.text}`);
    quote(c.quoted);
    if (c.media.length) L.push(`Media: ${c.media.map(x => x.url).join(' ')}`);
    L.push(DASH, `Reason: ${c.reason || 'None given'}`);
  });
  L.push(EQ, '', EQ, '--- Assessment ---', `Notes: ${m.notes || 'No notes'}`, DASH, 'Information:');
  m.info.forEach(x => {
    L.push('  - ' + ind(x.text, '    '));
    if (x.quote) L.push('      ' + ind(Q(x.quote), '       '));
    if (x.source) L.push('      Source: ' + x.source);
  });
  L.push(DASH, 'Next Action(s):');
  if (m.next.length) m.next.forEach(x => L.push('  - ' + x)); else L.push('  No further actions recommended');
  L.push(EQ);
  return L.join('\r\n') + '\r\n';
}
async function saveTxt() {
  await saveBlob(new Blob([stripEmoji(buildTxt())], { type: 'text/plain;charset=utf-8' }), baseName() + '.txt');
}
async function savePdf() {
  await ensurePdf();
  await saveBlob(pdfBlob, baseName() + ' - original page.pdf');
}

// PDF of the post and every captured reply (with highlights, flags and the Assessment), via Chrome's print dialog.
// "long" = one continuous page, "pages" = A4.
const PAGE_W = 794, MAX_PAGE_H = 19000; // px at 96dpi; PDF pages top out around 200 inches
async function saveThreadPdf() {
  const css = await (await fetch('archive.css')).text();
  const long = (job.opts.pdfLayout || 'long') === 'long';
  const iframe = document.createElement('iframe');
  iframe.style.cssText = `position:fixed;left:-20000px;top:0;width:${PAGE_W}px;height:600px;border:0`;
  document.body.appendChild(iframe);
  const d = iframe.contentDocument;
  const name = baseName() + ' - full thread';
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(name)}</title><style>${css}</style></head><body class="print"></body></html>`);
  d.close();
  if (long) d.head.append(el(d, 'style', { text: 'body.print{padding:24px 30px}' }));
  d.body.appendChild(buildView(d, false));
  await Promise.all([...d.images].map(i => i.decode().catch(() => { })));
  if (long) {
    const h = Math.ceil(d.documentElement.scrollHeight) + 4, ph = Math.min(h, MAX_PAGE_H);
    d.head.append(el(d, 'style', { text: `@page{size:${PAGE_W}px ${ph}px;margin:0}` + (h <= MAX_PAGE_H ? '@media print{.box,.box.entry{break-inside:auto}}' : '') }));
    if (h > MAX_PAGE_H) log(`Thread is too tall for one PDF page (${h}px) – split into ${Math.ceil(h / MAX_PAGE_H)} very long pages.`);
  }
  const oldTitle = document.title; document.title = name;
  const w = iframe.contentWindow;
  w.addEventListener('afterprint', () => { document.title = oldTitle; setTimeout(() => iframe.remove(), 500); });
  w.focus(); w.print();
  setTimeout(() => { document.title = oldTitle; if (iframe.isConnected) iframe.remove(); }, 300000);
}

/* ------------------------------------------------------- clipboard (DOCX content) */
// Same content and layout as the DOCX, as rich HTML so it pastes into Word / Google Docs with formatting.
function modelToHtml(m) {
  const e = s => escHtml(s == null ? '' : s).replace(/\r?\n/g, '<br>');
  const P = (inner, st) => `<p style="margin:0 0 6pt 0;${st || ''}">${inner}</p>`;
  const block = pairs => P(pairs.map(([l, v]) => `<b>${e(l)}</b>${v !== undefined && v !== '' ? ' ' + e(v) : ''}`).join('<br>'));
  const HS = { 2: ['Aptos Display', 16, '', 12], 3: ['Aptos', 14, '', 10], 4: ['Aptos', 12, 'font-style:italic;', 8] };
  const H = (n, t) => { const [f, sz, st, bf] = HS[n]; return `<h${n} style="font-family:'${f}',Calibri,Arial,sans-serif;font-size:${sz}pt;font-weight:normal;${st}color:#0F4761;margin:${bf}pt 0 4pt 0">${e(t)}</h${n}>`; };
  const img = x => {
    if (!x || !x.dataUrl) return P(e('[media not embedded] ' + ((x && x.fallback) || '')));
    const sc = Math.min(1, 480 / Math.max(1, x.w), 384 / Math.max(1, x.h));
    return P(`<img src="${x.dataUrl}" width="${Math.round(x.w * sc)}" height="${Math.round(x.h * sc)}" alt="">`);
  };
  const quote = q => q ? block([['Quoted Post:', q.by + (q.date ? ', ' + q.date : '') + (q.url ? ' – ' + q.url : '')]]) + (q.text ? P(e(q.text), 'margin-left:36pt;font-style:italic') : '') : '';
  const UL = lis => `<ul style="margin:0 0 6pt 0">${lis.join('')}</ul>`;
  const LI = (t, q, s) => `<li style="margin:0">${e(t)}${q ? `<br><i style="color:#595959">${e(Q(q))}</i>` : ''}${s ? `<br><span style="color:#595959;font-size:9pt">Source: ${e(s)}</span>` : ''}</li>`;
  const o = [];
  o.push(H(2, m.heading));
  const hdr = [['Posted By:', m.postedBy], ['Profile/Page URL:', m.profileUrl], ['Posted On:', m.postedOn], ['Post URL:', m.url]];
  if (m.inReplyTo) hdr.push(['In Reply To:', m.inReplyTo]);
  if (m.metrics) hdr.push(['Engagement (at capture):', m.metrics]);
  hdr.push(['Archive Link:', ''], ['Captured On:', m.capturedOn], ['Captured By:', m.capturedBy]);
  o.push(block(hdr));
  o.push(H(3, 'Original Post Text and/or Media'));
  const paras = String(m.body || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (!paras.length) o.push(P('(no text)'));
  paras.forEach(p => o.push(P(e(p))));
  o.push(quote(m.quoted));
  m.links.forEach(u => o.push(block([['Post links to:', u]])));
  m.media.forEach(x => o.push(img(x)));
  o.push(H(3, 'Reply(s) of Interest'));
  if (!m.comments.length) o.push(P('No replies selected.'));
  m.comments.forEach((c, i) => {
    const pairs = [['Username:', c.username], ['Profile URL:', c.url], ['Reply URL:', c.commentUrl], ['Replied On:', c.date]];
    if (c.position) pairs.push(['Position:', c.position]);
    if (c.replyingTo) pairs.push(['Replying To:', c.replyingTo]);
    if (c.metrics) pairs.push(['Engagement (at capture):', c.metrics]);
    o.push(H(4, 'Reply ' + (i + 1)), block(pairs), block([['Reply:', c.text]]), quote(c.quoted));
    c.media.forEach((x, j) => { if (!j) o.push(P('<b>Media:</b>')); o.push(img(x)); });
    o.push(block([['Reason:', c.reason || 'None given']]));
  });
  o.push(H(3, 'Assessment'), block([['Notes:', m.notes || 'No notes']]), `<p style="margin:0;"><b>Information:</b></p>`);
  if (m.info.length) o.push(UL(m.info.map(x => LI(x.text, x.quote, x.source))));
  if (m.next.length) o.push(`<p style="margin:0;"><b>Next Action(s):</b></p>`, UL(m.next.map(x => LI(x))));
  else o.push(block([['Next Action(s):', 'No further actions recommended']]));
  return `<div style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:12pt;color:#000000">${o.join('')}</div>`;
}

async function copyDocx() {
  const html = modelToHtml(buildModel()), text = buildTxt();
  try {
    if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) throw new Error('Async clipboard not available');
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
  } catch (err) {
    const holder = document.createElement('div');
    holder.contentEditable = 'true';
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:800px';
    holder.innerHTML = html;
    document.body.appendChild(holder);
    const range = document.createRange(); range.selectNodeContents(holder);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
    sel.removeAllRanges(); holder.remove();
    if (!ok) throw err;
  }
  setStatus('DOCX content copied to the clipboard – switch to your document and paste (Ctrl+V / Cmd+V).');
}

async function guarded(fn, label) {
  if (!validate()) return false;
  try { setStatus('Creating ' + label + '...'); await fn(); return true; }
  catch (e) { setStatus('Error creating ' + label + ': ' + (e.message || e)); log('Error (' + label + '): ' + (e.stack || e)); return false; }
}

async function doExport() {
  if (!validate()) return;
  $('exportBtn').disabled = true;
  const chosen = [];
  if (job.opts.docx) chosen.push([saveDocx, 'DOCX']);
  if (job.opts.txt) chosen.push([saveTxt, 'TXT']);
  if (job.opts.pdf) chosen.push([savePdf, 'PDF (original page)']);
  if (job.opts.thread) chosen.push([saveThreadPdf, 'PDF (full thread)']);
  if (!chosen.length) setStatus('No export formats were ticked in the popup – use the Download buttons above.');
  for (const [fn, label] of chosen) await guarded(fn, label);
  if (chosen.length) setStatus('Export finished (' + chosen.map(c => c[1]).join(', ') + '). Use the Download buttons to save a format again.');
  ['dlDocx', 'dlTxt', 'dlPdf', 'dlThread'].forEach(id => { $(id).disabled = false; });
  $('exportBtn').disabled = false;
}

/* ---------------------------------------------------------------------- videos */
const videoJobs = new Map(); // download id -> url
chrome.downloads.onChanged.addListener(d => {
  if (videoJobs.has(d.id) && d.state && d.state.current === 'interrupted') {
    setStatus('A video download was refused (the link may have expired). Opening it in a new tab instead – right-click the video there and choose "Save video as...".');
    window.open(videoJobs.get(d.id), '_blank');
    videoJobs.delete(d.id);
  }
});
async function dlVideo(url, n) {
  try {
    const id = await chrome.downloads.download({ url, filename: `${baseName()} - video ${n}.mp4`, saveAs: true });
    videoJobs.set(id, url);
    setStatus(`Video ${n} download started.`);
  } catch (e) { setStatus('Video download failed: ' + (e.message || e)); window.open(url, '_blank'); }
}
function renderVideoButtons() {
  const hasVideo = data.media.some(m => /video thumbnail/.test(m.type));
  if (!data.videos.length && !hasVideo) return;
  const box = document.createElement('div');
  box.id = 'videoBtns';
  data.videos.forEach((url, i) => {
    const b = el(document, 'button', { text: `Download Video ${i + 1}` });
    b.addEventListener('click', () => dlVideo(url, i + 1));
    box.append(b);
  });
  if (hasVideo) box.append(el(document, 'div', { class: 'meta', style: 'margin:0 0 8px', text: 'X streams most videos in pieces, so they cannot be saved from here – the video thumbnail is archived, and the video can be saved from the post on X if needed.' }));
  $('downloads').append(box);
}

/* ------------------------------------------------------- review-page wiring */
function wireReviewPage() {
  // Floating "Add Information Entry With Quote" button next to highlighted text (works in the post and in every reply).
  $('hlAdd').addEventListener('mousedown', e => e.preventDefault());
  $('hlAdd').addEventListener('click', () => startEntry(null));
  document.addEventListener('mouseup', e => { if (!$('hlBar').contains(e.target)) setTimeout(onSelection, 0); });
  document.addEventListener('keyup', e => { if (e.shiftKey || e.key === 'Shift') onSelection(); });
  document.addEventListener('selectionchange', () => { if (window.getSelection().isCollapsed) hideBar(); });
  // Click a highlight to jump to its information entry.
  $('view').addEventListener('click', e => {
    const m = e.target.closest && e.target.closest('mark.hl');
    if (m && window.getSelection().isCollapsed) jumpToEntry(m.getAttribute('data-e').split(' ')[0]);
  });
  $('fInfo').addEventListener('input', () => { updateDock(); if (infoItems().length) $('infoErr').textContent = ''; });
  $('dock').style.display = 'flex';
  $('dockAssess').addEventListener('click', () => $('assess').scrollIntoView({ behavior: 'smooth' }));
  $('dockTop').addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
  // Warn before closing the tab with review work in it.
  addEventListener('beforeunload', e => {
    const m = manual();
    if (data && (entries.length || selected().length || m.notes || m.info.trim() || m.next.trim())) { e.preventDefault(); e.returnValue = ''; }
  });
  updateDock();
}

/* ----------------------------------------------------------------------- main */
(async function main() {
  $('toggleLog').addEventListener('click', () => { logEl.style.display = logEl.style.display === 'none' ? 'block' : 'none'; });
  try {
    job = (await chrome.storage.local.get('job')).job;
    if (!job) throw new Error('No capture job found. Start again from the extension popup.');
    job.opts = job.opts || {};
    const id = statusId(job.url);
    if (!id) throw new Error('No X post ID found in: ' + job.url);
    log('Team Member: ' + job.name);
    log('Source URL: ' + job.url);
    const res = await captureX(id);
    data = buildData(res, id);
    const st = data.stats;
    log(`Post by ${nameLine(data.author)}: ${replies().length} replies captured` + (context().length ? `, ${context().length} earlier post(s) in the thread` : '') + '.');
    if (st.ads) log(`${st.ads} promoted post(s) (ads) were skipped.`);
    if (st.hitMax) log(`Stopped at the ${job.maxReplies} reply limit chosen in the popup.`);
    if (st.stopped) log('Reply loading ' + st.stopped + '.');
    if (!replies().length && st.loggedOut) log('X did not show any replies and seems to be logged out – log in to X in this browser to capture replies.');
    if (data.comments.some(c => c.truncated)) log('Some replies were shortened by X ("Show more") – the reply URL leads to the full text.');
    setBar(85);
    await fetchMedia(data);
    builtAt = nowParts();
    $('view').appendChild(buildView(document, true));
    $('postCtl').style.display = 'block';
    $('exportRow').style.display = 'block';
    $('dlDocx').addEventListener('click', () => guarded(saveDocx, 'DOCX'));
    $('dlTxt').addEventListener('click', () => guarded(saveTxt, 'TXT'));
    $('dlPdf').addEventListener('click', () => guarded(savePdf, 'PDF (original page)'));
    $('dlThread').addEventListener('click', () => guarded(saveThreadPdf, 'PDF (full thread)'));
    $('dlCopy').addEventListener('click', () => guarded(copyDocx, 'clipboard copy'));
    $('dlCopy').disabled = false;
    $('exportBtn').addEventListener('click', doExport);
    renderVideoButtons();
    wireReviewPage();
    await initWorkDoc().catch(e => log('Working document error: ' + (e.message || e)));
    setBar(100);
    setStatus(`Capture complete – ${replies().length} replies. Tick the replies to save, highlight post or reply text to add information entries, fill in the Assessment, then press Export.`);
    logEl.style.display = 'none'; $('toggleLog').style.display = 'inline';
    await focusMe();
  } catch (e) {
    setStatus('Capture failed: ' + (e.message || e));
    log('ERROR: ' + (e.stack || e));
    await focusMe();
  }
})();
