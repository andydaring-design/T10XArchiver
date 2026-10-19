/* Team 10 - working document storage (Origin Private File System) plus .T10x import / export.
 * Shared by the popup and the results page (same extension origin).
 *
 * Compatibility: every document read from disk or from an imported file goes through normDoc(), which
 *  - fills any section that is missing (older files) with a sensible default, and
 *  - ignores any section it does not know about (newer files).
 * So sections can be added or removed in later versions without breaking old exports. */
const T10Store = (() => {
  const KIND = 'team10-x-working-doc', DOC_VERSION = 1;
  const FORMAT = 'Team10-XArchiver-WorkingDoc', FORMAT_VERSION = 1, EXT = '.T10x';
  const NAME_RE = /^D\d{3} [A-Z]{1,4} Media Search - X$/;
  const dir = () => navigator.storage.getDirectory();
  const fname = n => n + '.json';
  const bad = msg => Object.assign(new Error(msg), { user: true });

  /* ---------------------------------------------------------------- tolerant readers */
  const str = v => typeof v === 'string' ? v : (v == null ? '' : String(v));
  const num = v => Number.isFinite(+v) ? +v : 0;
  const arr = v => Array.isArray(v) ? v : [];
  const httpUrl = v => /^https?:\/\//i.test(str(v)) ? str(v) : '';
  const isoDay = v => /^\d{4}-\d{2}-\d{2}/.test(str(v)) ? str(v).slice(0, 10) : '';

  function normInfo(i) {
    if (typeof i === 'string') i = { text: i };
    if (!i || typeof i !== 'object' || (!str(i.text).trim() && !str(i.quote).trim())) return null;
    return { text: str(i.text), quote: str(i.quote), source: str(i.source) };
  }
  function normMedia(m) {
    if (!m || typeof m !== 'object') return null;
    const du = str(m.dataUrl), url = httpUrl(m.url), okDu = /^data:image\//i.test(du) ? du : '';
    if (!url && !okDu) return null;
    return { url, dataUrl: okDu, w: num(m.w), h: num(m.h) };
  }
  function normQuoted(q) {
    if (!q || typeof q !== 'object' || (!str(q.text).trim() && !str(q.by).trim())) return null;
    return { by: str(q.by), date: str(q.date), url: httpUrl(q.url), text: str(q.text) };
  }
  function normComment(c) {
    if (!c || typeof c !== 'object') return null;
    return {
      username: str(c.username), url: str(c.url), commentUrl: httpUrl(c.commentUrl), date: str(c.date), position: str(c.position),
      replyingTo: str(c.replyingTo), metrics: str(c.metrics), text: str(c.text), quoted: normQuoted(c.quoted),
      media: arr(c.media).map(normMedia).filter(Boolean), reason: str(c.reason)
    };
  }
  function normPost(a) {
    if (!a || typeof a !== 'object') return null;
    const url = httpUrl(a.url), title = str(a.title);
    if (!url && !title.trim()) return null;
    const iso = isoDay(a.pubIso) || isoDay(a.capturedOn) || new Date().toISOString().slice(0, 10);
    return {
      key: str(a.key) || url.split('#')[0].split('?')[0], heading: str(a.heading) || `${iso} - @${str(a.handle)} - ${title}`,
      title, handle: str(a.handle), author: str(a.author), postedBy: str(a.postedBy), profileUrl: str(a.profileUrl),
      postedOn: str(a.postedOn), inReplyTo: str(a.inReplyTo), metrics: str(a.metrics), pubIso: iso, url,
      capturedOn: str(a.capturedOn), capturedBy: str(a.capturedBy),
      body: str(a.body), quoted: normQuoted(a.quoted), links: arr(a.links).map(httpUrl).filter(Boolean), media: arr(a.media).map(normMedia).filter(Boolean),
      comments: arr(a.comments).map(normComment).filter(Boolean),
      notes: str(a.notes), info: arr(a.info).map(normInfo).filter(Boolean), next: arr(a.next).map(str).filter(s => s.trim()),
      added: str(a.added), updated: str(a.updated)
    };
  }
  const normGroup = g => (g && typeof g === 'object') ? { subject: str(g.subject).trim() || 'Untitled', points: arr(g.points).map(normInfo).filter(Boolean) } : null;
  function normDoc(o) {
    if (!o || typeof o !== 'object') return null;
    const name = str(o.name), m = name.match(/^D(\d{3}) ([A-Z]{1,4}) /);
    return {
      kind: KIND, version: DOC_VERSION, name,
      docNumber: str(o.docNumber) || (m ? m[1] : ''), initials: str(o.initials) || (m ? m[2] : ''), created: str(o.created),
      posts: arr(o.posts).map(normPost).filter(Boolean),
      master: Array.isArray(o.master) ? o.master.map(normGroup).filter(Boolean) : null,
      actionsMaster: Array.isArray(o.actionsMaster) ? o.actionsMaster.map(str).filter(s => s.trim()) : null
    };
  }

  /* ---------------------------------------------------------------- OPFS */
  async function exists(name) { try { await (await dir()).getFileHandle(fname(name)); return true; } catch (e) { return false; } }
  async function read(name) {
    try { const fh = await (await dir()).getFileHandle(fname(name)); return normDoc(JSON.parse(await (await fh.getFile()).text())); }
    catch (e) { return null; }
  }
  async function write(name, obj) {
    const fh = await (await dir()).getFileHandle(fname(name), { create: true });
    const w = await fh.createWritable(); await w.write(JSON.stringify(obj)); await w.close();
  }
  async function remove(name) {
    try { await (await dir()).removeEntry(fname(name)); } catch (e) { if (e.name !== 'NotFoundError') throw e; }
  }
  async function list() {
    const out = [], d = await dir();
    for await (const [n, h] of d.entries()) {
      if (h.kind !== 'file' || !n.endsWith('.json')) continue;
      try {
        const f = await h.getFile(), o = JSON.parse(await f.text());
        if (o && o.kind === KIND) out.push({ name: str(o.name), posts: arr(o.posts).length, size: f.size });
      } catch (e) { /* not ours */ }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  async function create(num3, initials) {
    const name = `D${num3} ${initials} Media Search - X`;
    if (await exists(name)) throw new Error('A working document called "' + name + '" already exists – use Load Doc instead.');
    const doc = normDoc({ name, docNumber: num3, initials, created: new Date().toISOString() });
    await write(name, doc);
    return doc;
  }
  const getActive = async () => (await chrome.storage.local.get('workingDoc')).workingDoc || '';
  const setActive = name => name ? chrome.storage.local.set({ workingDoc: name }) : chrome.storage.local.remove('workingDoc');

  /* ---------------------------------------------------------------- .T10x files */
  async function sha256(text) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  async function exportDoc(name) {
    const doc = await read(name);
    if (!doc) throw new Error('Document not found: ' + name);
    const env = {
      format: FORMAT, formatVersion: FORMAT_VERSION, app: 'Team 10 X Archiver',
      appVersion: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '', exported: new Date().toISOString(),
      name: doc.name, postCount: doc.posts.length, checksum: 'sha256:' + await sha256(JSON.stringify(doc)), payload: doc
    };
    return { blob: new Blob([JSON.stringify(env)], { type: 'application/octet-stream' }), filename: doc.name + EXT };
  }
  // Validates an exported file's text. Returns { doc, warnings } or throws an Error with .user = true and a plain message.
  async function parseImport(text) {
    const warnings = [];
    let env;
    try { env = JSON.parse(text); } catch (e) { throw bad('This is not a Team 10 X Archiver file (it could not be read).'); }
    if (env && env.format === 'Team10-NewsExtractor-WorkingDoc') throw bad('This is a News Article Extractor file – import it in the Team 10 News Article Extractor instead.');
    if (env && env.format === 'Team10-RedditArchiver-WorkingDoc') throw bad('This is a Reddit Archiver file – import it in the Team 10 Reddit Archiver instead.');
    if (!env || typeof env !== 'object' || env.format !== FORMAT) throw bad('This file is not a Team 10 X Archiver working document.');
    if (typeof env.formatVersion !== 'number' || env.formatVersion < 1) throw bad('This file has an unknown format version.');
    if (!env.payload || typeof env.payload !== 'object') throw bad('This file is incomplete – it contains no document.');
    if (env.formatVersion <= FORMAT_VERSION) {
      if (typeof env.checksum !== 'string' || !env.checksum.startsWith('sha256:')) throw bad('This file has no valid checksum – it may be damaged or have been edited.');
      if (env.checksum.slice(7) !== await sha256(JSON.stringify(env.payload))) throw bad('The checksum does not match – this file is damaged or has been edited.');
    } else warnings.push('This file was made by a newer version of the extension. Sections this version does not know about were ignored.');
    const doc = normDoc(env.payload);
    if (!doc || !NAME_RE.test(doc.name)) throw bad('The document name inside this file is not valid.');
    if (!doc.posts.length && Number(env.postCount) > 0) throw bad('No posts could be read from this file.');
    const lost = arr(env.payload.posts).length - doc.posts.length;
    if (lost > 0) warnings.push(`${lost} post${lost === 1 ? '' : 's'} in the file could not be read and ${lost === 1 ? 'was' : 'were'} skipped.`);
    return { doc, warnings };
  }

  return { exists, read, write, remove, list, create, getActive, setActive, exportDoc, parseImport, EXT };
})();
