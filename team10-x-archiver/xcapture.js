/* Team 10 X Archiver - page-side capture of an X post and its replies (injected into the X tab).
 * X has no public API, so this reads the conversation the way you see it: it scrolls the page, clicks
 * "Show more replies" / "Show probable spam" style buttons, and collects every post as it is drawn
 * (X only keeps the posts near the screen in the page, so they are collected while scrolling).
 * Promoted posts (ads) and the "Discover more" section after the conversation are skipped. */
(function () {
  'use strict';
  if (window.__T10X) return;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const say = (kind, msg, pct) => { try { chrome.runtime.sendMessage({ t10x: kind, msg, pct }); } catch (e) { /* results tab closed */ } };
  const statusOf = h => { const m = String(h || '').match(/\/status(?:es)?\/(\d+)/); return m ? m[1] : ''; };
  const abs = h => { try { return new URL(h, location.origin).href; } catch (e) { return ''; } };
  const clean = s => String(s || '').replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const upsize = u => { try { const x = new URL(u); if (x.hostname === 'pbs.twimg.com' && x.pathname.startsWith('/media/')) x.searchParams.set('name', 'large'); return x.href; } catch (e) { return u; } };

  // Text of a post as written: emoji come from <img alt>, shortened t.co links are expanded to the full address X keeps hidden.
  function richText(node, links) {
    let s = '';
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { s += c.nodeValue; continue; }
        if (c.nodeType !== 1) continue;
        if (c.tagName === 'IMG') { s += c.getAttribute('alt') || ''; continue; }
        if (c.tagName === 'BR') { s += '\n'; continue; }
        if (c.tagName === 'A' && /^https?:\/\/t\.co\//i.test(c.href || '')) {
          const full = (c.textContent || '').replace(/…+\s*$/, '').trim();
          s += full;
          if (links) links.push(/^https?:\/\//i.test(full) ? full : c.href);
          continue;
        }
        walk(c);
      }
    })(node);
    return s;
  }

  function quoteBox(art) { // a quoted post is a clickable box inside the post with its own name line
    const names = [...art.querySelectorAll('[data-testid="User-Name"]')].slice(1);
    for (const n of names) { const q = n.closest('div[role="link"]'); if (q && art.contains(q)) return q; }
    return null;
  }
  function who(un) {
    if (!un) return { name: '', handle: '' };
    const as = [...un.querySelectorAll('a[href^="/"]')];
    const h = as.map(a => a.getAttribute('href')).find(x => /^\/[A-Za-z0-9_]{1,15}$/.test(x));
    let handle = h ? h.slice(1) : '';
    if (!handle) { const sp = [...un.querySelectorAll('span,div')].find(x => /^@[A-Za-z0-9_]{1,15}$/.test((x.textContent || '').trim())); if (sp) handle = sp.textContent.trim().slice(1); }
    let name = as[0] ? clean(richText(as[0])) : '';
    if (!handle || !name) {
      const t = clean(richText(un)), m = t.match(/@([A-Za-z0-9_]{1,15})/);
      if (!handle && m) handle = m[1];
      if (!name) name = t.split('@')[0].trim();
    }
    if (name.startsWith('@')) name = '';
    return { name, handle };
  }

  // Is this article the main post that was opened? Its own links (time, /photo/1, /video/1, /analytics ...) point at its status ID,
  // or X marks it as the main post (tabindex -1) while the address bar shows that ID.
  function isMainPost(art, locId) {
    const qb = quoteBox(art), re = new RegExp('/status(?:es)?/' + locId + '(?:[/?#]|$)');
    if ([...art.querySelectorAll('a[href]')].some(a => !(qb && qb.contains(a)) && re.test(a.getAttribute('href') || ''))) return true;
    return art.getAttribute('tabindex') === '-1' && statusOf(location.pathname) === locId;
  }

  function parse(art, locId) {
    const qb = quoteBox(art), own = e => !(qb && qb.contains(e));
    const first = sel => [...art.querySelectorAll(sel)].find(own) || null;
    const all = sel => [...art.querySelectorAll(sel)].filter(own);
    const w = who(first('[data-testid="User-Name"]'));
    const tm = first('time[datetime]'), ta = tm && tm.closest('a[href*="/status/"]');
    let id = ta ? statusOf(ta.getAttribute('href')) : '';
    const focal = isMainPost(art, locId);
    if (focal) id = locId;
    if (!id) return null;
    // Promoted posts: X's ad tracking wrapper, or an "Ad" / "Promoted" label in the post's header line.
    // Labels inside the post text, photos or the video player (which can show its own "Ad" during pre-roll adverts) do not count,
    // and the main post is never treated as an ad.
    const ad = !focal && (!!(art.closest('[data-testid="placementTracking"]') || art.querySelector('[data-testid="placementTracking"]')) ||
      all('span').some(s => !s.children.length && /^(Ad|Promoted)$/.test((s.textContent || '').trim()) &&
        !s.closest('[data-testid="tweetText"],[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="videoComponent"],[data-testid="card.wrapper"],video,[role="group"]')));
    const tt = first('[data-testid="tweetText"]'), links = [];
    const text = tt ? clean(richText(tt, links)) : '';
    const media = [], videos = [];
    all('[data-testid="tweetPhoto"] img').forEach(im => { if (/pbs\.twimg\.com\/media\//.test(im.src)) media.push({ type: 'image', src: upsize(im.src), target: '' }); });
    all('video').forEach(v => {
      const p = v.getAttribute('poster');
      if (p) media.push({ type: /tweet_video_thumb/.test(p) ? 'GIF thumbnail' : 'video thumbnail', src: p, target: '' });
      const s = v.currentSrc || v.src || ((v.querySelector('source') || {}).src) || '';
      if (/^https:\/\/video\.twimg\.com\/.+\.mp4/i.test(s)) videos.push(s);
    });
    const card = first('[data-testid="card.wrapper"]');
    if (card) {
      const a = card.querySelector('a[href]'), href = a ? a.href : '', ci = card.querySelector('img');
      if (href) links.push(href);
      if (ci && /pbs\.twimg\.com/.test(ci.src)) media.push({ type: 'link preview', src: ci.src, target: href });
    }
    let quoted = null;
    if (qb) {
      const qw = who(qb.querySelector('[data-testid="User-Name"]')), qt = qb.querySelector('[data-testid="tweetText"]');
      const qtm = qb.querySelector('time[datetime]'), qa = qb.querySelector('a[href*="/status/"]');
      quoted = {
        name: qw.name, handle: qw.handle, text: qt ? clean(richText(qt)) : '', time: qtm ? qtm.getAttribute('datetime') : '',
        url: qa ? abs(qa.getAttribute('href')).split('?')[0] : (qw.handle ? 'https://x.com/' + qw.handle : '')
      };
      qb.querySelectorAll('[data-testid="tweetPhoto"] img').forEach(im => { if (/pbs\.twimg\.com\/media\//.test(im.src)) media.push({ type: 'image (in quoted post)', src: upsize(im.src), target: '' }); });
    }
    const rt = [...art.querySelectorAll('div')].find(d => own(d) && /^Replying to\b/.test((d.textContent || '').trim()) && d.textContent.length < 400 && !d.querySelector('[data-testid="tweetText"],[data-testid="User-Name"]'));
    const replyingTo = rt ? [...new Set([...rt.querySelectorAll('a')].map(a => clean(a.textContent)).filter(x => x.startsWith('@')))] : [];
    const grp = first('[role="group"][aria-label]');
    // X's own reply count: the reply button says "12 Replies. Reply" ("Reply" alone = none); the action bar label has the same number.
    const rb = first('[data-testid="reply"]'), rl = (rb && rb.getAttribute('aria-label')) || '', gl = (grp && grp.getAttribute('aria-label')) || '';
    let replies = null;
    const mm = (rl + ' ' + gl).match(/([\d.,]+)\s*([KkMm])?\s*repl/i);
    if (mm) { replies = parseFloat(mm[1].replace(/,/g, '')); if (/k/i.test(mm[2] || '')) replies *= 1000; if (/m/i.test(mm[2] || '')) replies *= 1e6; replies = Math.round(replies); }
    else if (rb) replies = 0;
    const seen = new Set();
    return {
      id, focal, name: w.name, handle: w.handle,
      url: w.handle ? `https://x.com/${w.handle}/status/${id}` : `https://x.com/i/status/${id}`,
      time: tm ? tm.getAttribute('datetime') : '', text, links: [...new Set(links)],
      media: media.filter(m => !seen.has(m.src) && seen.add(m.src)), videos: [...new Set(videos)], quoted, replyingTo,
      metrics: grp ? clean(grp.getAttribute('aria-label')) : '', replies, truncated: !!first('[data-testid="tweet-text-show-more-link"]'), ad
    };
  }

  const isMarker = cell => !cell.querySelector('article') && ([...cell.querySelectorAll('h2,[role="heading"]')].some(h => /^(discover more|more posts|more replies from|you might like)/i.test((h.textContent || '').trim())) ||
    /^discover more|sourced from across x/i.test((cell.textContent || '').trim()));
  const TOMB = /^(this post is unavailable|this post was deleted|this post is from an account|you.re unable to view this post|this post is from a suspended account)/i;

  function pageError() {
    const t = (document.querySelector('[data-testid="primaryColumn"]') || document.body || {}).textContent || '';
    if (/hmm\.\.\.this page doesn.t exist|this page doesn.t exist/i.test(t)) return 'X says this page doesn\'t exist – the post may have been deleted.';
    if (/this post (is unavailable|was deleted)/i.test(t) && !document.querySelector('article[data-testid="tweet"]')) return 'X says this post is unavailable or was deleted.';
    if (/these posts are protected/i.test(t)) return 'This account\'s posts are protected – you can only capture them if you follow the account.';
    if (/account suspended/i.test(t)) return 'X says this account is suspended.';
    if (!document.querySelector('article[data-testid="tweet"]') && document.querySelector('[data-testid="loginButton"],[data-testid="login"],a[href="/login"]'))
      return 'X is asking you to log in. Log in to X in this browser, then try again.';
    return '';
  }

  // Buttons that load more of the conversation (never "Show more" inside a post – that opens the post).
  function expand(clicked) {
    let n = 0;
    document.querySelectorAll('[data-testid="cellInnerDiv"] [role="button"], [data-testid="cellInnerDiv"] button').forEach(b => {
      if (b.closest('article') || clicked.has(b)) return;
      const t = (b.textContent || '').trim();
      if (t.length > 140 || !/^show\b/i.test(t) || !/(repl|spam|post|offensive)/i.test(t)) return;
      clicked.add(b); b.click(); n++;
    });
    return n;
  }

  // What the page looked like, for the log, when the main post could not be picked out.
  function diagnose(id, map, order, adIds, markerText) {
    const arts = [...document.querySelectorAll('article[data-testid="tweet"]')];
    const main = arts.find(a => isMainPost(a, id));
    const d = [`DIAGNOSTICS: page ${location.pathname}; ${arts.length} post(s) on screen now, ${document.querySelectorAll('[data-testid="cellInnerDiv"]').length} cell(s); ${order.length} collected; ${adIds.size} treated as ads` +
      (adIds.has(id) ? ' (INCLUDING THE MAIN POST)' : '') + (markerText ? `; stopped at "${markerText}"` : '')];
    if (main) {
      const p = parse(main, id);
      d.push(`main post found on screen: ${p ? `id ${p.id}, @${p.handle}, ad=${p.ad}, in a cell=${!!main.closest('[data-testid="cellInnerDiv"]')}` : 'but it could not be read'}`);
    } else d.push('main post is not on screen now');
    d.push('first posts collected: ' + order.slice(0, 5).map(k => `${k} (@${(map.get(k) || {}).handle})`).join(', '));
    return d.join(' | ');
  }

  let stopReq = false;
  try { chrome.runtime.onMessage.addListener(m => { if (m && m.t10xStop) stopReq = true; }); } catch (e) { /* no messaging */ }

  async function capture(o) {
    stopReq = false;
    const id = String(o.id), max = Math.max(1, +o.max || 1000), started = Date.now();
    say('progress', 'Waiting for X to show the post...', 3);
    const findFocal = () => [...document.querySelectorAll('article[data-testid="tweet"]')].some(a => isMainPost(a, id));
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) {
      ok = findFocal();
      if (!ok) { const err = pageError(); if (err && i > 8) return { ok: false, error: err }; await sleep(500); }
    }
    if (!ok) return { ok: false, error: pageError() || 'The post did not appear on the X page (it may be deleted or protected, or X may need you to log in).' };
    const mainArt = [...document.querySelectorAll('article[data-testid="tweet"]')].find(a => isMainPost(a, id));
    const reported = mainArt ? (parse(mainArt, id) || {}).replies : null;
    const target = reported == null ? max : Math.min(max, reported);
    say('log', reported == null ? 'X does not show a reply count for this post – loading replies until the end of the conversation.'
      : `X reports ${reported} repl${reported === 1 ? 'y' : 'ies'} for this post` + (reported > max ? ` – loading up to the ${max} chosen in the popup.` : '.'));

    const map = new Map(), order = [], adIds = new Set(), tombs = new Set(), clicked = new WeakSet();
    let ended = false, hitMax = false, stall = 0, retries = 0, idle = 0, stopWhy = '', markerText = '', mainY = null;

    function collect() {
      const seq = [];
      let lastId = '';
      const units = [...document.querySelectorAll('[data-testid="cellInnerDiv"], article[data-testid="tweet"]')]
        .filter(u => u.matches('[data-testid="cellInnerDiv"]') || !u.closest('[data-testid="cellInnerDiv"]'));
      for (const cell of units) {
        if (cell.matches('[data-testid="cellInnerDiv"]') && isMarker(cell)) {
          // Only a block BELOW the main post ends the conversation ("You might like" etc. can also appear above it).
          if (mainY != null && cell.getBoundingClientRect().top + scrollY > mainY) { ended = true; markerText = (cell.textContent || '').trim().slice(0, 60); break; }
          continue;
        }
        const art = cell.matches('article') ? cell : cell.querySelector('article[data-testid="tweet"]');
        if (!art) { const tx = (cell.textContent || '').trim(); if (TOMB.test(tx)) tombs.add(lastId + '|' + tx.slice(0, 60)); continue; } // X redraws cells: count each one once
        const t = parse(art, id);
        if (!t) continue;
        lastId = t.id;
        if (t.ad) { adIds.add(t.id); continue; }
        if (t.id === id) mainY = art.getBoundingClientRect().top + scrollY;
        seq.push(t);
      }
      let added = 0, prev = null;
      seq.forEach((t, i) => {
        if (map.has(t.id)) { const o2 = map.get(t.id); if (t.text.length > o2.text.length || t.media.length > o2.media.length) Object.assign(o2, t); prev = t.id; return; }
        map.set(t.id, t); added++;
        let at;
        if (prev) at = order.indexOf(prev) + 1;
        else { const nx = seq.slice(i + 1).find(x => order.includes(x.id)); at = nx ? order.indexOf(nx.id) : order.length; }
        order.splice(at, 0, t.id); prev = t.id;
      });
      return added;
    }
    const replyCount = () => { const f = order.indexOf(id); return f < 0 ? 0 : order.length - f - 1; };
    async function settle() {
      let last = -1, same = 0;
      for (let i = 0; i < 12 && same < 2; i++) {
        const n = document.querySelectorAll('article[data-testid="tweet"]').length + document.querySelectorAll('[data-testid="cellInnerDiv"]').length * 1000;
        same = n === last ? same + 1 : 0; last = n; await sleep(100);
      }
    }
    async function waitSpinner() {
      const t0 = Date.now();
      while (Date.now() - t0 < 5000 && document.querySelector('[data-testid="primaryColumn"] [role="progressbar"]')) await sleep(200);
    }
    async function handleRetry() {
      const b = [...document.querySelectorAll('[data-testid="primaryColumn"] [role="button"], [data-testid="primaryColumn"] button')].find(x => /^retry$/i.test((x.textContent || '').trim()));
      if (!b) return false;
      retries++;
      if (retries > 8) { say('log', 'X kept refusing to load more replies – stopping with what has been collected.'); ended = true; return false; }
      const wait = Math.min(60, 5 * Math.pow(2, retries - 1));
      say('log', `X said "Something went wrong" (usually a rate limit) – waiting ${wait}s, then retrying (${retries}/8)`);
      say('progress', `X is limiting requests – waiting ${wait}s before retrying...`);
      await sleep(wait * 1000); b.click(); await sleep(2500);
      return true;
    }

    scrollTo(0, 0); await sleep(400);
    if (reported === 0) { // nothing to look for: just take the post (and any earlier posts in the thread shown above it)
      collect(); say('log', 'No replies to load – skipping the reply search.');
    }
    for (let it = 0; it < 6000 && reported !== 0; it++) {
      const added = collect(), n = replyCount(), focalSeen = order.includes(id);
      say('progress', `Loading replies on X (keep this tab in front)... ${n}` + (reported != null ? ` of ${target}` : '') + ' replies found' +
        (focalSeen ? '' : ` – ${order.length} post(s) seen, main post not identified yet`) + ` (step ${it + 1})`, Math.min(70, 5 + (n / Math.max(1, target)) * 65));
      if (document.hidden && it % 10 === 0) say('log', 'The X tab is not visible – X stops loading in background tabs, so bring it to the front.');
      if (n >= target) { if (n >= max && (reported == null || reported > max)) hitMax = true; break; }
      if (ended) break;
      if (stopReq) { stopWhy = 'stopped by you – keeping what has been collected'; break; }
      if (Date.now() - started > 30 * 60 * 1000) { stopWhy = 'stopped after 30 minutes – keeping what has been collected'; break; }
      if (await handleRetry()) { stall = 0; idle = 0; continue; }
      const nClicked = expand(clicked);
      if (nClicked) { say('log', `Clicked ${nClicked} "show more replies" button(s)`); await sleep(500); await waitSpinner(); await settle(); }
      const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
      if (added || nClicked) { stall = 0; idle = 0; }
      else {
        idle++;
        if (idle >= 25) { stopWhy = 'nothing new appeared for 25 scroll steps – stopping'; break; } // safety net
        if (atEnd) { stall++; if (stall >= 4) break; await sleep(400 + stall * 300); }
      }
      scrollBy(0, Math.round(innerHeight * 0.9));
      await sleep(180);
      await waitSpinner();
      await settle();
    }
    if (stopWhy) say('log', 'Reply loading ' + stopWhy + '.');
    if (!order.includes(id)) say('log', 'The main post itself was not recognised on the page – everything collected is listed as replies.');
    collect();
    scrollTo(0, 0);
    let tweets = order.map(k => map.get(k));
    if (!order.includes(id)) { const fx = tweets.find(t => t.focal); if (fx) { fx.altId = fx.id; fx.id = id; order[order.indexOf(fx.altId)] = id; } }
    if (!order.includes(id)) say('log', diagnose(id, map, order, adIds, markerText));
    if (!order.includes(id)) return { ok: false, error: `The main post (ID ${id}) could not be recognised on the X page, so its replies cannot be told apart from other posts. Reload the post on X, check it opens normally, and try again.` };
    const f = order.indexOf(id);
    if (hitMax && f >= 0) tweets = tweets.slice(0, f + 1 + max);
    return {
      ok: true, tweets,
      stats: { ads: adIds.size, unavailable: tombs.size, ended, hitMax, stopped: stopWhy, reported, loggedOut: !!document.querySelector('[data-testid="loginButton"]') }
    };
  }

  window.__T10X = { capture };
})();
