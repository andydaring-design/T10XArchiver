/* Team 10 X Archiver - prepares the live page for a one-page PDF capture:
 * hides ads / cookie banners / pop-ups, un-sticks fixed bars, loads lazy images. restore() undoes everything it hid. */
(function () {
  const AD_TOK = new Set(('ad ads adv advert adverts advertisement advertising adslot adunit adwrapper adcontainer adbox sponsor sponsored promoted outbrain taboola dfp mpu leaderboard interstitial ' +
    'cookie cookies consent gdpr popup modal newsletter xpromo').split(' '));
  const AD_SEL = ['ins.adsbygoogle', '[id^="google_ads"]', '[id*="div-gpt-ad"]', '[class*="adsbygoogle"]', '[data-ad]', '[data-ad-slot]', '[data-ad-unit]', '[data-adunit]', '[data-google-query-id]',
    '[aria-label*="dvertis" i]', '[aria-label*="ponsored" i]', '[id*="taboola" i]', '[class*="taboola" i]', '[id*="outbrain" i]', '[class*="outbrain" i]',
    'a[href*="doubleclick.net"]', 'a[href*="googleadservices"]', 'a[href*="adclick"]',
    // X: sign-up bars, log-in pop-ups, the account menu / navigation (it shows the logged-in team member's account) and the sidebar (trends, ads, "who to follow")
    '[data-testid="BottomBar"]', '#layers [role="dialog"]', '[data-testid="sheetDialog"]', '[data-testid="sidebarColumn"]', 'header[role="banner"]',
    '[data-testid="DMDrawer"]', '[data-testid="GrokDrawer"]'];
  const AD_FRAME = /doubleclick|googlesyndication|adservice|amazon-adsystem|criteo|taboola|outbrain|adnxs|pubmatic|rubiconproject|openx|smartadserver|adsrvr|moatads|\/ads?\//i;
  const LABEL = /^\s*(advertisement|advertisements|advertisment|sponsored( content)?|story continues( below)?( advertisement)?|continue reading below|ad|ads)\s*$/i;
  const CSS = '[data-t10-hide]{display:none!important}[data-t10-static]{position:static!important}[data-t10-abs]{position:absolute!important}html.t10-unlock,html.t10-unlock body{overflow:visible!important}';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const hide = e => e.setAttribute('data-t10-hide', '1');
  const sigOf = e => ((e.getAttribute('class') || '') + ' ' + (e.id || '')).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const adTok = e => sigOf(e).split(/[^a-z0-9]+/).some(t => AD_TOK.has(t));

  // X: promoted posts, and the "Discover more" section (and everything after it) below the conversation
  function xPass() {
    document.querySelectorAll('[data-testid="placementTracking"]').forEach(e => hide(e.closest('[data-testid="cellInnerDiv"]') || e));
    let after = false;
    document.querySelectorAll('[data-testid="cellInnerDiv"]').forEach(c => {
      if (!after && [...c.querySelectorAll('h2,[role="heading"]')].some(h => /^(discover more|more posts)\b/i.test((h.textContent || '').trim()))) after = true;
      if (after) hide(c);
    });
  }

  function pass() {
    xPass();
    AD_SEL.forEach(s => { try { document.querySelectorAll(s).forEach(hide); } catch (e) { /* bad selector */ } });
    document.querySelectorAll('iframe').forEach(f => {
      const sig = (f.src || '') + ' ' + (f.id || '') + ' ' + (f.name || '') + ' ' + (f.title || '') + ' ' + (f.getAttribute('class') || '');
      if (AD_FRAME.test(sig) || /(^|[^a-z])ads?([^a-z]|$)/i.test(sig.replace(/[_-]/g, ' '))) hide(f);
    });
    const vw = innerWidth, vh = innerHeight;
    document.body.querySelectorAll('*').forEach(e => {
      if (e.hasAttribute('data-t10-hide')) return;
      if (e.children.length === 0 && e.textContent.length < 60 && LABEL.test(e.textContent)) { hide(e); return; }
      if (/(^|-)(ad|ads|promoted)(-|$)/.test(e.localName)) { hide(e); return; }
      if (adTok(e) && e.querySelectorAll('p').length <= 8) { hide(e); return; }
      const cs = getComputedStyle(e);
      if (cs.position === 'sticky') e.setAttribute('data-t10-static', '1');
      else if (cs.position === 'fixed') {
        const r = e.getBoundingClientRect();
        if (r.width * r.height > 0.3 * vw * vh || r.top > vh * 0.5) hide(e); else e.setAttribute('data-t10-abs', '1');
      }
    });
  }

  window.__T10CLEAN = {
    async prepare(opt) {
      this.restore();
      const st = document.createElement('style'); st.id = 't10-clean-style'; st.textContent = CSS; document.documentElement.appendChild(st);
      document.documentElement.classList.add('t10-unlock');
      pass();
      document.querySelectorAll('img').forEach(i => {
        const d = i.getAttribute('data-src') || i.getAttribute('data-lazy-src') || i.getAttribute('data-original');
        if (d && (!i.getAttribute('src') || /^data:/.test(i.getAttribute('src')))) i.setAttribute('src', d);
        const ds = i.getAttribute('data-srcset'); if (ds && !i.getAttribute('srcset')) i.setAttribute('srcset', ds);
        i.loading = 'eager';
      });
      if (opt && opt.noScroll) { scrollTo(0, 0); await sleep(150); return { height: document.documentElement.scrollHeight, width: document.documentElement.clientWidth }; }
      let y = 0; const step = Math.max(300, innerHeight * 0.7);
      for (let n = 0; n < 80; n++) {
        scrollTo(0, y); await sleep(220);
        if (y + innerHeight >= document.documentElement.scrollHeight) break;
        y += step;
      }
      await sleep(400);
      await Promise.race([Promise.all([...document.images].map(im => im.complete ? 1 : new Promise(r => { im.onload = im.onerror = r; }))), sleep(8000)]);
      pass(); // ads that loaded while scrolling
      scrollTo(0, 0); await sleep(400);
      return {
        height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
        width: document.documentElement.clientWidth
      };
    },
    again() { pass(); }, // X redraws posts as you scroll, so the clean-up is repeated before each screenshot
    restore() {
      const s = document.getElementById('t10-clean-style'); if (s) s.remove();
      document.documentElement.classList.remove('t10-unlock');
      document.querySelectorAll('[data-t10-hide],[data-t10-static],[data-t10-abs]').forEach(e => {
        e.removeAttribute('data-t10-hide'); e.removeAttribute('data-t10-static'); e.removeAttribute('data-t10-abs');
      });
    }
  };
})();
