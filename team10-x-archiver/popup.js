const $ = id => document.getElementById(id);
let tab = null;
const X_POST = /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/([A-Za-z0-9_]{1,15}|i\/web|i)\/status(es)?\/\d+/i;
const statusId = u => { const m = String(u || '').match(/\/status(?:es)?\/(\d+)/); return m ? m[1] : ''; };
const STANDALONE = new URLSearchParams(location.search).get('manage') === '1'; // opened in its own window (see Import below)
const IS_MAC = /Mac/i.test(navigator.platform || navigator.userAgent || '');

// remember the export tick boxes
const readOpts = () => ({ docx: $('optDocx').checked, pdf: $('optPdf').checked, thread: $('optThread').checked, txt: $('optTxt').checked, pdfLayout: $('pdfLayout').value });
const syncLayout = () => { $('pdfLayout').disabled = !$('optThread').checked; };
const saveOpts = () => { syncLayout(); chrome.storage.local.set({ opts: readOpts() }); };
['optDocx', 'optPdf', 'optThread', 'optTxt', 'pdfLayout'].forEach(id => $(id).addEventListener('change', saveOpts));

function setWd(name) { $('wdName').textContent = name || 'No Working Document'; }

function openModal(...kids) {
  const ov = document.createElement('div'); ov.className = 'ovl';
  const m = document.createElement('div'); m.className = 'mdl'; m.append(...kids);
  ov.append(m); document.body.append(ov); return ov;
}
const mk = (tag, props, ...kids) => {
  const e = document.createElement(tag);
  Object.entries(props || {}).forEach(([k, v]) => { if (k === 'text') e.textContent = v; else e.setAttribute(k, v); });
  e.append(...kids); return e;
};
function needName() {
  if ($('name').value.trim()) return true;
  showErr('Please enter your name (Team Member) before continuing.'); $('name').focus(); return false;
}

$('newDoc').addEventListener('click', () => {
  showErr(''); if (!needName()) return;
  const num = mk('input', { type: 'text', id: 'dNum', maxlength: '3', inputmode: 'numeric', placeholder: 'e.g. 2 or 002', autocomplete: 'off' });
  const ini = mk('input', { type: 'text', id: 'dIni', maxlength: '4', placeholder: 'e.g. GH (max 4 letters)', autocomplete: 'off' });
  const err = mk('div', { style: 'color:#f15900;margin-top:8px' });
  const create = mk('button', { text: 'Create' }), cancel = mk('button', { class: 'alt', text: 'Cancel' });
  num.addEventListener('input', () => { num.value = num.value.replace(/\D/g, '').slice(0, 3); err.textContent = ''; });
  ini.addEventListener('input', () => { ini.value = ini.value.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 4); err.textContent = ''; });
  const ov = openModal(mk('h2', { text: 'Start a New Document' }),
    mk('label', { text: 'Document number (max 3 digits)' }, num), mk('label', { text: 'Case initials (max 4 letters)' }, ini),
    err, mk('div', { class: 'row' }, cancel, create));
  num.focus();
  cancel.addEventListener('click', () => ov.remove());
  create.addEventListener('click', async () => {
    const n = num.value.replace(/\D/g, '').slice(0, 3), i = ini.value.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 4);
    if (!n) { err.textContent = 'Enter a document number.'; num.focus(); return; }
    if (!i) { err.textContent = 'Enter the case initials.'; ini.focus(); return; }
    try {
      const doc = await T10Store.create(n.padStart(3, '0'), i);
      await T10Store.setActive(doc.name); setWd(doc.name); ov.remove();
    } catch (e) { err.textContent = e.message || String(e); }
  });
});

$('loadDoc').addEventListener('click', async () => {
  showErr(''); if (!needName()) return;
  const docs = await T10Store.list();
  let chosen = '';
  const box = mk('div', { class: 'dlist' });
  const load = mk('button', { text: 'Load' }), cancel = mk('button', { class: 'alt', text: 'Cancel' });
  load.disabled = true;
  const ov = openModal(mk('h2', { text: 'Load Document' }), box, mk('div', { class: 'row' }, cancel, load));
  const pick = async name => { await T10Store.setActive(name); setWd(name); ov.remove(); };
  if (!docs.length) box.append(mk('div', { text: 'No working documents found. Use [Start a New Document] first.', style: 'cursor:default' }));
  docs.forEach(d => {
    const row = mk('div', { text: `${d.name}  (${d.posts} post${d.posts === 1 ? '' : 's'})` });
    row.addEventListener('click', () => { box.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); row.classList.add('sel'); chosen = d.name; load.disabled = false; });
    row.addEventListener('dblclick', () => pick(d.name));
    box.append(row);
  });
  cancel.addEventListener('click', () => ov.remove());
  load.addEventListener('click', () => chosen && pick(chosen));
});

/* ------------------------------------------------------------------ Manage Docs */
const fmtSize = b => b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1) + ' MB';

function confirmBox(title, text, okLabel) {
  return new Promise(res => {
    const ok = mk('button', { text: okLabel }), no = mk('button', { class: 'alt', text: 'Cancel' });
    const ov = openModal(mk('h2', { text: title }), mk('div', { text, style: 'white-space:pre-wrap;color:#e8e8e8;max-height:220px;overflow:auto' }), mk('div', { class: 'row' }, no, ok));
    ov.style.zIndex = 20;
    ok.addEventListener('click', () => { ov.remove(); res(true); });
    no.addEventListener('click', () => { ov.remove(); res(false); });
    no.focus();
  });
}

async function saveFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  try { await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' }); }
  catch (e) { const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function openManage() {
  const msg = mk('div', { class: 'mmsg' }), list = mk('div', { class: 'mlist' });
  const all = mk('input', { type: 'checkbox' });
  const bDel = mk('button', { text: 'Delete' }), bExp = mk('button', { text: 'Export' }), bImp = mk('button', { text: 'Import' }), bClose = mk('button', { class: 'alt', text: 'Close' });
  const file = mk('input', { type: 'file', accept: '.T10x,.t10x', style: 'display:none' });
  const ov = openModal(mk('h2', { text: 'Manage Docs' }), mk('label', { class: 'chk' }, all, 'Select all'), list, msg,
    mk('div', { class: 'row' }, bDel, bExp, bImp), mk('div', { class: 'row' }, bClose), file);
  let rows = [];
  const say = t => { msg.textContent = t || ''; };
  const ticked = () => rows.filter(r => r.cb.checked).map(r => r.name);

  async function refresh() {
    const docs = await T10Store.list(), active = await T10Store.getActive();
    list.textContent = ''; rows = []; all.checked = false;
    if (!docs.length) list.append(mk('div', { text: 'No working documents are stored. Use [New Doc] or [Import].', style: 'padding:8px;color:#e8e8e8' }));
    docs.forEach(d => {
      const cb = mk('input', { type: 'checkbox' });
      list.append(mk('label', { class: 'mrow' }, cb, mk('span', {}, d.name, mk('small', { text: `${d.posts} post${d.posts === 1 ? '' : 's'}  |  ${fmtSize(d.size)}${d.name === active ? '  |  current working document' : ''}` }))));
      rows.push({ name: d.name, cb });
    });
  }
  all.addEventListener('change', () => rows.forEach(r => { r.cb.checked = all.checked; }));

  bDel.addEventListener('click', async () => {
    const names = ticked();
    if (!names.length) return say('Tick the document(s) you want to delete first.');
    const ok = await confirmBox(`Permanently delete ${names.length} document${names.length === 1 ? '' : 's'}?`,
      names.join('\n') + '\n\nThis cannot be undone. Use Export first if you may need it again.', 'Delete');
    if (!ok) return;
    try {
      for (const n of names) await T10Store.remove(n);
      if (names.includes(await T10Store.getActive())) { await T10Store.setActive(''); setWd(''); }
      await refresh(); say(`Deleted ${names.length} document${names.length === 1 ? '' : 's'}.`);
    } catch (e) { say('Delete failed: ' + (e.message || e)); }
  });

  bExp.addEventListener('click', async () => {
    const names = ticked();
    if (!names.length) return say('Tick the document(s) you want to export first.');
    try {
      for (const n of names) { const { blob, filename } = await T10Store.exportDoc(n); await saveFile(blob, filename); }
      say(`Exported ${names.length} file${names.length === 1 ? '' : 's'} (${T10Store.EXT}) to your Downloads folder.`);
    } catch (e) { say('Export failed: ' + (e.message || e)); }
  });

  bImp.addEventListener('click', () => {
    say('');
    // Chrome closes the toolbar popup as soon as a file dialog opens, so the import would never run: do it in its own small window.
    if (!STANDALONE) {
      chrome.windows.create({ url: chrome.runtime.getURL('popup.html?manage=1'), type: 'popup', width: 430, height: 660 });
      window.close(); return;
    }
    file.click();
  });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0]; if (!f) return;
    try {
      const { doc, warnings } = await T10Store.parseImport(await f.text());
      if (await T10Store.exists(doc.name)) {
        const cur = await T10Store.read(doc.name);
        const ok = await confirmBox('Replace existing document?',
          `"${doc.name}" already exists here (${cur ? cur.posts.length : 0} posts).\nThe file you are importing contains ${doc.posts.length} post${doc.posts.length === 1 ? '' : 's'}.\n\nReplace the existing document with the imported one?`, 'Replace');
        if (!ok) { say('Import cancelled.'); file.value = ''; return; }
      }
      await T10Store.write(doc.name, doc);
      await T10Store.setActive(doc.name); setWd(doc.name); // an imported document becomes the working document straight away
      await refresh();
      say(`Imported and loaded "${doc.name}" (${doc.posts.length} post${doc.posts.length === 1 ? '' : 's'}).` + (warnings.length ? '\n' + warnings.join('\n') : ''));
    } catch (e) { say('Import failed: ' + (e.user ? e.message : 'the file could not be read (' + (e.message || e) + ').')); }
    file.value = '';
  });
  bClose.addEventListener('click', () => { ov.remove(); if (STANDALONE) window.close(); });
  await refresh();
  if (STANDALONE) say('Click Import and choose your .T10x file.');
}
$('manageDoc').addEventListener('click', () => { showErr(''); openManage(); });

function showErr(msg) { $('err').textContent = msg || ''; }

(async () => {
  const s = await chrome.storage.local.get(['member', 'remember', 'opts', 'maxReplies']);
  if (s.remember && s.member) { $('name').value = s.member; $('remember').checked = true; }
  if (s.opts) {
    $('optDocx').checked = !!s.opts.docx; $('optPdf').checked = !!s.opts.pdf; $('optThread').checked = !!s.opts.thread; $('optTxt').checked = !!s.opts.txt;
    if (s.opts.pdfLayout) $('pdfLayout').value = s.opts.pdfLayout;
  }
  syncLayout();
  if (s.maxReplies) $('maxReplies').value = s.maxReplies;
  let wd = await T10Store.getActive();
  if (wd && !(await T10Store.exists(wd))) { wd = ''; await T10Store.setActive(''); }
  setWd(wd);
  if (STANDALONE) { openManage(); return; }
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && X_POST.test(tab.url)) $('url').value = tab.url.split('?')[0];
})();

$('name').addEventListener('input', () => showErr(''));
$('url').addEventListener('input', () => showErr(''));

$('extract').addEventListener('click', async () => {
  const name = $('name').value.trim();
  if (!name) { showErr('Please enter your name (Team Member) before continuing.'); $('name').focus(); return; }
  const url = $('url').value.trim();
  if (!url || !X_POST.test(url)) { showErr('Open a single X post (or paste its URL above), then try again.'); $('url').focus(); return; }

  if ($('remember').checked) await chrome.storage.local.set({ member: name, remember: true });
  else await chrome.storage.local.remove(['member', 'remember']);
  await chrome.storage.local.set({ maxReplies: $('maxReplies').value, opts: readOpts() });

  const onTab = tab && statusId(tab.url) === statusId(url); // the post is open in the current tab: capture it there
  const job = {
    name, url, maxReplies: +$('maxReplies').value,
    tabId: onTab ? tab.id : null, windowId: onTab ? tab.windowId : null,
    workingDoc: await T10Store.getActive(),
    opts: readOpts(),
    started: Date.now()
  };
  await chrome.storage.local.set({ job });
  await chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });
  window.close();
});
