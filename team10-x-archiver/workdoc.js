/* Team 10 X Archiver - working document features on the results page.
 * Loaded BEFORE results.js; it uses results.js globals (job, data, builtAt, $, el, ...) only inside functions, after they exist. */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ---- small modal prompt: returns the index of the button pressed */
function ask(msg, labels) {
  return new Promise(res => {
    const ov = el(document, 'div', { class: 'ovl' });
    const btns = labels.map((l, i) => {
      const b = el(document, 'button', { type: 'button', class: 'abtn' + (i === 0 && labels.length > 1 ? ' alt' : ''), text: l });
      b.addEventListener('click', () => { ov.remove(); res(i); }); return b;
    });
    ov.append(el(document, 'div', { class: 'mdl' }, el(document, 'div', { style: 'white-space:pre-wrap', text: msg }), el(document, 'div', { class: 'mbtns' }, btns)));
    document.body.append(ov); btns[btns.length - 1].focus();
  });
}

/* ---- post record stored in the working document JSON (images are kept as data URLs) */
const storedMedia = x => ({ url: x.url, dataUrl: x.dataUrl || '', w: x.w || 0, h: x.h || 0 });
function postRecord() {
  const m = buildModel(), day = dateOnly(data.posted);
  return {
    key: 'https://x.com/i/status/' + data.id,
    heading: m.heading, title: m.title, handle: m.handle, author: m.author, postedBy: m.postedBy, profileUrl: m.profileUrl,
    postedOn: m.postedOn, inReplyTo: m.inReplyTo, metrics: m.metrics, pubIso: /^\d{4}-/.test(day) ? day : builtAt.d, url: m.url,
    capturedOn: m.capturedOn, capturedBy: m.capturedBy, body: m.body, quoted: m.quoted, links: m.links, media: m.media.map(storedMedia),
    comments: m.comments.map(c => ({ username: c.username, url: c.url, commentUrl: c.commentUrl, date: c.date, position: c.position, replyingTo: c.replyingTo,
      metrics: c.metrics, text: c.text, quoted: c.quoted, media: c.media.map(storedMedia), reason: c.reason })),
    notes: m.notes, info: m.info.map(x => ({ text: x.text, quote: x.quote || '', source: x.source || '' })), next: m.next
  };
}
const stable = o => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.keys(v).sort().reduce((r, kk) => (r[kk] = v[kk], r), {}) : v);
const sameRecord = (a, b) => {
  const f = r => { const c = { ...r }; delete c.capturedOn; delete c.added; delete c.updated; return stable(c); };
  return f(a) === f(b);
};
const byDate = posts => [...posts].sort((a, b) => (a.pubIso || '').localeCompare(b.pubIso || '') || (a.added || '').localeCompare(b.added || ''));

async function refreshSummary() {
  const doc = await T10Store.read(job.workingDoc);
  const posts = doc ? byDate(doc.posts) : [];
  $('sumText').textContent = posts.length ? posts.map(a => `${a.pubIso}  @${a.handle}  ${a.title}`).join('\n') : '-none-';
}

async function addToWorkingDoc() {
  if (!validate()) return;
  const doc = await T10Store.read(job.workingDoc);
  if (!doc) { setStatus('The working document could not be found – it may have been cleared from the browser.'); return; }
  const rec = postRecord(), i = doc.posts.findIndex(a => a.key === rec.key);
  if (i < 0) {
    rec.added = new Date().toISOString(); doc.posts.push(rec); await T10Store.write(doc.name, doc);
    setStatus('Post added to the working document.');
  } else if (sameRecord(doc.posts[i], rec)) {
    await ask('(already added)\n\nThis post is already in the working document and nothing has changed.', ['OK']);
  } else {
    const r = await ask('This post is already in the working document, but something has changed (flagged replies, reasons, images, information entries or the Assessment).\n\nUpdate the existing entry for this post?', ['No, leave it as it is', 'Yes, update it']);
    if (r === 1) {
      rec.added = doc.posts[i].added; rec.updated = new Date().toISOString(); doc.posts[i] = rec;
      await T10Store.write(doc.name, doc); setStatus('Existing entry for this post updated.');
    }
  }
  await refreshSummary();
}

/* ---- step 1: pick and group the information points */
function pickInfo(posts, saved) {
  return new Promise(resolve => {
    let id = 0, drag = null;
    const keyOf = p => p.text + '\u0001' + (p.quote || '') + '\u0001' + (p.source || '');
    const avail = [];
    posts.forEach(a => (a.info || []).forEach(x => avail.push({ id: ++id, text: x.text, quote: x.quote || '', source: x.source || ('@' + a.handle + ' – ' + a.title), chk: false })));
    const used = new Set(), left = [], groups = [];
    (saved || []).forEach(g => {
      const pts = [];
      (g.points || []).forEach(sp => {
        const p = avail.find(q => !used.has(q.id) && keyOf(q) === keyOf(sp));
        if (p) { used.add(p.id); pts.push(p); }
      });
      groups.push({ id: ++id, name: g.subject, points: pts });
    });
    avail.forEach(p => { if (!used.has(p.id)) left.push(p); });

    const L = el(document, 'div', { class: 'pane' }), R = el(document, 'div', { class: 'pane' });
    const name = el(document, 'input', { type: 'text', placeholder: 'Subject name', style: 'max-width:300px' });
    const err = el(document, 'div', { class: 'err' });
    const bAdd = el(document, 'button', { type: 'button', class: 'abtn', text: 'Add subject' });
    const bRem = el(document, 'button', { type: 'button', class: 'abtn alt', text: 'Remove' });
    const bCancel = el(document, 'button', { type: 'button', class: 'abtn alt', text: 'Cancel' });
    const bDone = el(document, 'button', { type: 'button', class: 'abtn', text: 'Done' });
    const ov = el(document, 'div', { class: 'ovl' }, el(document, 'div', { class: 'mdl wide' },
      el(document, 'h3', { text: 'Select and group the information points' }),
      el(document, 'div', { class: 'meta', text: 'Tick points on the left, type a subject name and press [Add subject]. Drag points to move them or re-order them; the orange line shows where a point will land.' }),
      el(document, 'div', { class: 'cols' },
        el(document, 'div', { class: 'colw' }, el(document, 'div', { class: 'name', text: 'All information points' }), L),
        el(document, 'div', { class: 'colw' }, el(document, 'div', { class: 'name', text: 'Document: subjects & points' }), R)),
      el(document, 'div', { class: 'brow' }, name, bAdd, el(document, 'span', { style: 'flex:1' }), bRem, bCancel, bDone), err));

    const clearInd = () => ov.querySelectorAll('.ib,.ia,.dend').forEach(e => e.classList.remove('ib', 'ia', 'dend'));
    const listOf = z => z === 'left' ? left : z.points;
    function move(p, zone, idx) {
      let src = left.includes(p) ? left : null;
      if (!src) groups.forEach(g => { if (g.points.includes(p)) src = g.points; });
      const si = src.indexOf(p); src.splice(si, 1);
      const dst = listOf(zone); if (src === dst && si < idx) idx--;
      dst.splice(idx, 0, p); p.chk = false; render();
    }
    function ptEl(p, zone) {
      const cb = el(document, 'input', { type: 'checkbox' }); cb.checked = p.chk;
      cb.addEventListener('change', () => { p.chk = cb.checked; });
      const d = el(document, 'div', { class: 'pt', draggable: 'true' }, cb,
        el(document, 'div', { class: 'ptx' }, p.text, p.quote ? el(document, 'div', { class: 'ptq', text: '“' + p.quote + '”' }) : null,
          p.source ? el(document, 'div', { class: 'ptq', style: 'font-style:normal', text: p.source }) : null));
      d.addEventListener('dragstart', ev => { drag = p; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', p.text); });
      d.addEventListener('dragend', () => { drag = null; clearInd(); });
      d.addEventListener('dragover', ev => {
        if (!drag) return; ev.preventDefault(); ev.stopPropagation(); clearInd();
        const r = d.getBoundingClientRect(); d._before = ev.clientY < r.top + r.height / 2; d.classList.add(d._before ? 'ib' : 'ia');
      });
      d.addEventListener('drop', ev => {
        ev.preventDefault(); ev.stopPropagation(); if (!drag) return;
        const dp = drag, idx = listOf(zone).indexOf(p) + (d._before ? 0 : 1); clearInd(); drag = null; move(dp, zone, idx);
      });
      return d;
    }
    function endZone(node, zone) {
      node.addEventListener('dragover', ev => { if (!drag) return; ev.preventDefault(); clearInd(); node.classList.add('dend'); });
      node.addEventListener('drop', ev => { ev.preventDefault(); if (!drag) return; const dp = drag; clearInd(); drag = null; move(dp, zone, listOf(zone).length); });
    }
    function grpEl(g) {
      const gn = el(document, 'div', { class: 'gn', text: g.name });
      const bEdit = el(document, 'button', { type: 'button', class: 'gbtn', text: 'edit' });
      const bX = el(document, 'button', { type: 'button', class: 'gbtn', title: 'Delete this subject (its points go back to the left)', text: '×' });
      const gh = el(document, 'div', { class: 'gh' }, gn, bEdit, bX);
      bEdit.addEventListener('click', () => {
        const inp = el(document, 'input', { type: 'text' }); inp.value = g.name; gn.textContent = ''; gn.append(inp); inp.focus(); inp.select();
        let done = false;
        const fin = ok => { if (done) return; done = true; if (ok && inp.value.trim()) g.name = inp.value.trim(); render(); };
        inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') fin(true); else if (ev.key === 'Escape') fin(false); });
        inp.addEventListener('blur', () => fin(true));
      });
      bX.addEventListener('click', () => { left.push(...g.points.map(p => (p.chk = false, p))); groups.splice(groups.indexOf(g), 1); render(); });
      gh.addEventListener('dragover', ev => { if (!drag) return; ev.preventDefault(); ev.stopPropagation(); clearInd(); gh.classList.add('ia'); });
      gh.addEventListener('drop', ev => { ev.preventDefault(); ev.stopPropagation(); if (!drag) return; const dp = drag; clearInd(); drag = null; move(dp, g, 0); });
      const box = el(document, 'div', { class: 'grp' }, gh, g.points.map(p => ptEl(p, g)));
      endZone(box, g); return box;
    }
    function render() {
      L.textContent = ''; R.textContent = '';
      left.forEach(p => L.append(ptEl(p, 'left')));
      if (!left.length) L.append(el(document, 'div', { class: 'meta', text: '(no points left on this side)' }));
      groups.forEach(g => R.append(grpEl(g)));
      if (!groups.length) R.append(el(document, 'div', { class: 'meta', text: 'Nothing here yet – tick points on the left, enter a subject name and press [Add subject].' }));
    }
    endZone(L, 'left');
    bAdd.addEventListener('click', () => {
      const n = name.value.trim(), sel = left.filter(p => p.chk);
      if (!sel.length) { err.textContent = 'Tick at least one point on the left first.'; return; }
      if (!n) { err.textContent = 'Enter a subject name.'; name.focus(); return; }
      err.textContent = ''; sel.forEach(p => { left.splice(left.indexOf(p), 1); p.chk = false; });
      groups.push({ id: ++id, name: n, points: sel }); name.value = ''; render();
      R.scrollTop = R.scrollHeight;
    });
    name.addEventListener('keydown', ev => { if (ev.key === 'Enter') bAdd.click(); });
    bRem.addEventListener('click', () => {
      let n = 0; groups.forEach(g => { const keep = []; g.points.forEach(p => { if (p.chk) { p.chk = false; left.push(p); n++; } else keep.push(p); }); g.points = keep; });
      if (!n) err.textContent = 'Tick the points on the right that you want to put back first.'; else err.textContent = '';
      render();
    });
    bCancel.addEventListener('click', () => { ov.remove(); resolve(null); });
    bDone.addEventListener('click', async () => {
      if (left.length) {
        const r = await ask(`${left.length} information point${left.length === 1 ? ' has' : 's have'} not been moved across.\n\nAnything not moved across will be left out of the document. Continue?`, ['Go back', 'Continue']);
        if (r !== 1) return;
      }
      ov.remove();
      resolve(groups.filter(g => g.points.length).map(g => ({ subject: g.name, points: g.points.map(p => ({ text: p.text, quote: p.quote, source: p.source })) })));
    });
    document.body.append(ov); render(); name.focus();
  });
}

/* ---- step 2: pick the suggested actions */
function pickActions(posts, saved) {
  return new Promise(resolve => {
    const items = [...new Set(posts.flatMap(a => a.next || []))], on = new Set(saved || []);
    const rows = items.map(t => ({ t, cb: el(document, 'input', { type: 'checkbox' }) }));
    rows.forEach(r => { r.cb.checked = on.has(r.t); });
    const bAll = el(document, 'button', { type: 'button', class: 'abtn alt', text: 'Select all' });
    const bCancel = el(document, 'button', { type: 'button', class: 'abtn alt', text: 'Cancel' });
    const bDone = el(document, 'button', { type: 'button', class: 'abtn', text: 'Done' });
    const list = el(document, 'div', { class: 'pane', style: 'height:50vh' },
      rows.length ? rows.map(r => el(document, 'label', { class: 'pt', style: 'cursor:pointer' }, r.cb, el(document, 'div', { class: 'ptx', text: r.t }))) : el(document, 'div', { class: 'meta', text: 'No suggested actions were entered for any post.' }));
    const ov = el(document, 'div', { class: 'ovl' }, el(document, 'div', { class: 'mdl wide' },
      el(document, 'h3', { text: 'Select the suggested actions to include' }),
      el(document, 'div', { class: 'meta', text: 'Actions from all posts are combined here. Tick the ones to include at the end of the document.' }),
      list, el(document, 'div', { class: 'brow' }, bAll, el(document, 'span', { style: 'flex:1' }), bCancel, bDone)));
    bAll.addEventListener('click', () => rows.forEach(r => { r.cb.checked = true; }));
    bCancel.addEventListener('click', () => { ov.remove(); resolve(null); });
    bDone.addEventListener('click', async () => {
      const miss = rows.filter(r => !r.cb.checked).length;
      if (miss) {
        const r = await ask(`${miss} action${miss === 1 ? ' is' : 's are'} not ticked.\n\nAnything not ticked will be left out of the document. Continue?`, ['Go back', 'Continue']);
        if (r !== 1) return;
      }
      ov.remove(); resolve(rows.filter(r => r.cb.checked).map(r => r.t));
    });
    document.body.append(ov);
  });
}

/* ---- final DOCX */
const dataUrlBytes = u => { const b = atob(u.split(',')[1] || ''), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
const monthYear = iso => { const [y, m] = iso.split('-'); return MONTHS[(+m || 1) - 1] + ' ' + y; };

const withBytes = x => ({ ...x, bytes: x.dataUrl ? dataUrlBytes(x.dataUrl) : null, fallback: x.url });
async function createFinal() {
  try {
    const doc = await T10Store.read(job.workingDoc);
    if (!doc || !doc.posts.length) { await ask('No posts have been added to this working document yet.', ['OK']); return; }
    const posts = byDate(doc.posts);
    const master = await pickInfo(posts, doc.master); if (!master) return;
    doc.master = master; await T10Store.write(doc.name, doc);
    const actions = await pickActions(posts, doc.actionsMaster); if (!actions) return;
    doc.actionsMaster = actions; await T10Store.write(doc.name, doc);

    setStatus('Creating the final DOCX...');
    const members = [...new Set(posts.map(a => a.capturedBy).filter(Boolean))];
    const f = {
      title: `D${doc.docNumber} X`,
      range: `${monthYear(posts[0].pubIso)} - ${monthYear(posts[posts.length - 1].pubIso)}`,
      members,
      posts: posts.map(a => ({ ...a, media: a.media.map(withBytes), comments: a.comments.map(c => ({ ...c, media: c.media.map(withBytes) })) })),
      master, actions
    };
    await saveBlob(new Blob([T10Docx.buildFinal(f)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), safeName(doc.name) + '.docx');
    setStatus('Final DOCX created: ' + doc.name);
  } catch (e) { setStatus('Error creating final DOCX: ' + (e.message || e)); log('Error (final DOCX): ' + (e.stack || e)); }
}

/* ---- wiring (called from results.js once the page is ready) */
async function initWorkDoc() {
  if (!job.workingDoc || !(await T10Store.exists(job.workingDoc))) return;
  $('docCtl').style.display = 'block';
  $('wdLineName').textContent = job.workingDoc; $('wdLine').style.display = 'block';
  $('toggleSum').style.display = 'inline';
  $('dlAdd').style.display = 'inline-block'; $('dlAdd').disabled = false;
  $('dlAdd').addEventListener('click', () => addToWorkingDoc().catch(e => setStatus('Error: ' + (e.message || e))));
  $('toggleSum').addEventListener('click', async () => {
    const open = $('sumBox').style.display === 'block';
    if (!open) await refreshSummary();
    $('sumBox').style.display = open ? 'none' : 'block';
  });
  $('finalBtn').addEventListener('click', createFinal);
  await refreshSummary();
}
