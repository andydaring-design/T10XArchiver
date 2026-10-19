/* Minimal PDF writer (no dependencies): stacks viewport screenshots (JPEG) of a page into one long PDF page.
 * PDF pages cannot be taller than 200 inches, so very long pages are scaled down (to no less than 35%) and,
 * if still too tall, split into several very long pages. */
(function (g) {
  const enc = new TextEncoder();
  const f = n => (Math.round(n * 100) / 100).toString();
  const MAX_PT = 14400, PT = 0.75, MIN_SCALE = 0.35;

  function jpegSize(b) {
    for (let i = 2; i < b.length - 9;) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6] };
      i += 2 + len;
    }
    throw new Error('Could not read a screenshot image.');
  }
  const b64bytes = s => { const bin = atob(s), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };

  function build(images, pages) {
    const parts = [], offs = [];
    let len = 0;
    const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    push('%PDF-1.4\n'); push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
    const firstImg = 3, firstPage = 3 + images.length;
    const obj = (n, dict, stream) => {
      offs[n] = len; push(n + ' 0 obj\n'); push(dict);
      if (stream) { push('\nstream\n'); push(stream); push('\nendstream'); }
      push('\nendobj\n');
    };
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + pages.map((p, i) => (firstPage + i * 2) + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>');
    images.forEach((im, i) => obj(firstImg + i, '<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.length + ' >>', im.bytes));
    pages.forEach((p, i) => {
      const pn = firstPage + i * 2, used = [...new Set(p.items.map(it => it.img))];
      obj(pn, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(p.w) + ' ' + f(p.h) + '] /Resources << /XObject << ' +
        used.map(k => '/Im' + k + ' ' + (firstImg + k) + ' 0 R').join(' ') + ' >> >> /Contents ' + (pn + 1) + ' 0 R >>');
      const cs = enc.encode(p.items.map(it => 'q ' + f(it.w) + ' 0 0 ' + f(it.h) + ' ' + f(it.x) + ' ' + f(it.y) + ' cm /Im' + it.img + ' Do Q').join('\n'));
      obj(pn + 1, '<< /Length ' + cs.length + ' >>', cs);
    });
    const n = firstPage + pages.length * 2, xref = len;
    let x = 'xref\n0 ' + n + '\n0000000000 65535 f \n';
    for (let i = 1; i < n; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    push(x); push('trailer\n<< /Size ' + n + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    const out = new Uint8Array(len); let p = 0;
    for (const b of parts) { out.set(b, p); p += b.length; }
    return out;
  }

  // shots: [{ b64 (JPEG), y (CSS px scroll position) }], vh: viewport height in CSS px
  function fromShots(shots, vh) {
    const images = shots.map(s => { const bytes = b64bytes(s.b64), d = jpegSize(bytes); return { bytes, w: d.w, h: d.h, y: s.y }; });
    const dpr = images[0].h / vh, cssW = images[0].w / dpr;
    const totalH = Math.max(...images.map(im => im.y + im.h / dpr));
    const scale = Math.max(MIN_SCALE, Math.min(1, MAX_PT / (totalH * PT)));
    const k = PT * scale, pageCss = totalH * k <= MAX_PT + 0.5 ? totalH : MAX_PT / k, pages = [];
    for (let top = 0; top < totalH - 1; top += pageCss) {
      const h = Math.min(pageCss, totalH - top), items = [];
      images.forEach((im, i) => {
        const ih = im.h / dpr;
        if (im.y + ih <= top || im.y >= top + h) return;
        items.push({ img: i, x: 0, y: (top + h - (im.y + ih)) * k, w: cssW * k, h: ih * k });
      });
      pages.push({ w: cssW * k, h: h * k, items });
    }
    return { bytes: build(images, pages), pages: pages.length, scale, width: cssW, height: totalH };
  }

  g.T10Pdf = { fromShots, build, jpegSize };
})(typeof window !== 'undefined' ? window : globalThis);
