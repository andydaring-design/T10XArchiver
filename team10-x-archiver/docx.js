/* Minimal DOCX writer (no dependencies): builds a .docx (zip, stored) from a plain model. */
(function (g) {
  const enc = new TextEncoder();

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  function zip(files) {
    const now = new Date();
    const dt = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const tm = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const parts = [], centrals = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = f.data, len = data.length, crc = crc32(data);
      const lh = new Uint8Array(30 + name.length), v = new DataView(lh.buffer);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
      v.setUint16(10, tm, true); v.setUint16(12, dt, true); v.setUint32(14, crc, true);
      v.setUint32(18, len, true); v.setUint32(22, len, true); v.setUint16(26, name.length, true); v.setUint16(28, 0, true);
      lh.set(name, 30);
      const ch = new Uint8Array(46 + name.length), c = new DataView(ch.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true); c.setUint16(12, tm, true); c.setUint16(14, dt, true); c.setUint32(16, crc, true);
      c.setUint32(20, len, true); c.setUint32(24, len, true); c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true); ch.set(name, 46);
      parts.push(lh, data); centrals.push(ch); offset += lh.length + len;
    }
    const cdSize = centrals.reduce((s, a) => s + a.length, 0);
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    const all = [...parts, ...centrals, end];
    const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

  const RF = f => '<w:rFonts w:ascii="' + f + '" w:hAnsi="' + f + '" w:eastAsia="' + f + '" w:cs="' + f + '"/>';
  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' + RF('Aptos') + '<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="000000"/></w:rPr></w:style>' +
    // [level, font, half-points, space before, space after, italic]
    [[1, 'Aptos Display', 40, 360, 80, 0], [2, 'Aptos Display', 32, 160, 80, 0], [3, 'Aptos', 28, 160, 80, 0], [4, 'Aptos', 24, 80, 40, 1]].map(([n, font, sz, before, after, it]) =>
      '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>' +
      '<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="' + before + '" w:after="' + after + '"/><w:outlineLvl w:val="' + (n - 1) + '"/></w:pPr>' +
      '<w:rPr>' + RF(font) + (it ? '<w:i/><w:iCs/>' : '') + '<w:color w:val="0F4761"/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr></w:style>').join('') +
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="InfoQuote"><w:name w:val="Info Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0"/><w:ind w:left="1080"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="InfoSource"><w:name w:val="Info Source"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0"/><w:ind w:left="1080"/></w:pPr><w:rPr><w:color w:val="595959"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>' +
    '</w:styles>';

  const NUMBERING = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' +
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>' +
    '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

  /* shared helpers: one context per document so image ids / relationships stay unique */
  function newCtx() {
    const ctx = { images: [], docPrId: 1 };
    const BR = '<w:r><w:br/></w:r>';
    ctx.run = (text, o) => {
      o = o === true ? { b: true } : (o || {});
      const rpr = (o.b ? '<w:b/>' : '') + (o.u ? '<w:u w:val="single"/>' : '');
      return String(text == null ? '' : text).split(/\r?\n/).map((p, i) =>
        '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + (i ? '<w:br/>' : '') + '<w:t xml:space="preserve">' + esc(p) + '</w:t></w:r>').join('');
    };
    // o: { pbb: page break before, jc: alignment, after: space-after override in twips }
    ctx.para = (runs, style, bullet, o) => {
      o = o || {};
      const st = style || (bullet ? 'ListParagraph' : '');
      return '<w:p><w:pPr>' + (st ? '<w:pStyle w:val="' + st + '"/>' : '') + (o.pbb ? '<w:pageBreakBefore/>' : '') +
        (bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '') +
        (o.after != null ? '<w:spacing w:after="' + o.after + '"/>' : '') + (o.jc ? '<w:jc w:val="' + o.jc + '"/>' : '') + '</w:pPr>' + (runs || '') + '</w:p>';
    };
    // several "Label: value" lines in ONE paragraph, separated by line breaks
    ctx.block = (pairs, o) => ctx.para(pairs.map(([l, v], i) => (i ? BR : '') + ctx.run(l, true) + (v !== undefined && v !== '' ? ctx.run(' ' + v) : '')).join(''), null, false, o);
    ctx.labeled = (label, value, o) => ctx.block([[label, value]], o);
    // tight bullet list; items are {text, quote?, source?}; the last paragraph carries the normal space after the list
    ctx.bullets = items => {
      const out = [];
      items.forEach((x, i) => {
        const last = i === items.length - 1;
        out.push(ctx.para(ctx.run(x.text), null, true, { after: last && !x.quote && !x.source ? 120 : null }));
        if (x.quote) out.push(ctx.para(ctx.run('“' + x.quote + '”'), 'InfoQuote', false, { after: last && !x.source ? 120 : null }));
        if (x.source) out.push(ctx.para(ctx.run('Source: ' + x.source), 'InfoSource', false, { after: last ? 120 : null }));
      });
      return out;
    };
    ctx.imgRun = med => {
      if (!med || !med.bytes) return ctx.run('[media not embedded] ' + (med && med.fallback || ''));
      const id = ctx.images.length + 1;
      const rid = 'rIdImg' + id, name = 'image' + id + '.jpg';
      ctx.images.push({ rid, name, data: med.bytes });
      let cx = Math.max(1, med.w) * 9525, cy = Math.max(1, med.h) * 9525;
      const sc = Math.min(1, 4572000 / cx, 3657600 / cy);
      cx = Math.round(cx * sc); cy = Math.round(cy * sc);
      const pid = ctx.docPrId++;
      return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
        '<wp:docPr id="' + pid + '" name="Picture ' + pid + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
        '<pic:nvPicPr><pic:cNvPr id="' + pid + '" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    };
    return ctx;
  }

  /* one X post, in the single-post layout (also used for every post in the final document) */
  function postBody(ctx, m, pbb) {
    const { run, para, labeled } = ctx, b = [];
    const quote = q => {
      if (!q) return;
      b.push(labeled('Quoted Post:', q.by + (q.date ? ', ' + q.date : '') + (q.url ? ' \u2013 ' + q.url : '')));
      if (q.text) b.push(para(run(q.text), 'Quote'));
    };
    b.push(para(run(m.heading), 'Heading2', false, { pbb }));
    const hdr = [['Posted By:', m.postedBy], ['Profile/Page URL:', m.profileUrl], ['Posted On:', m.postedOn], ['Post URL:', m.url]];
    if (m.inReplyTo) hdr.push(['In Reply To:', m.inReplyTo]);
    if (m.metrics) hdr.push(['Engagement (at capture):', m.metrics]);
    hdr.push(['Archive Link:', ''], ['Captured On:', m.capturedOn], ['Captured By:', m.capturedBy]);
    b.push(ctx.block(hdr));

    b.push(para(run('Original Post Text and/or Media'), 'Heading3'));
    String(m.body || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean).forEach(p => b.push(para(run(p))));
    if (!String(m.body || '').trim()) b.push(para(run('(no text)')));
    quote(m.quoted);
    (m.links || []).forEach(u => b.push(labeled('Post links to:', u)));
    (m.media || []).forEach(x => b.push(para(ctx.imgRun(x))));

    b.push(para(run('Reply(s) of Interest'), 'Heading3'));
    if (!m.comments.length) b.push(para(run('No replies selected.')));
    m.comments.forEach((c, i) => {
      b.push(para(run('Reply ' + (i + 1)), 'Heading4'));
      const pairs = [['Username:', c.username], ['Profile URL:', c.url], ['Reply URL:', c.commentUrl], ['Replied On:', c.date]];
      if (c.position) pairs.push(['Position:', c.position]);
      if (c.replyingTo) pairs.push(['Replying To:', c.replyingTo]);
      if (c.metrics) pairs.push(['Engagement (at capture):', c.metrics]);
      b.push(ctx.block(pairs));
      b.push(labeled('Reply:', c.text));
      quote(c.quoted);
      (c.media || []).forEach((x, j) => b.push(para((j ? '' : run('Media: ', true)) + ctx.imgRun(x))));
      b.push(labeled('Reason:', c.reason || 'None given'));
    });

    b.push(para(run('Assessment'), 'Heading3'));
    b.push(labeled('Notes:', m.notes || 'No notes'));
    const info = m.info || [];
    b.push(labeled('Information:', '', info.length ? { after: 0 } : null));
    b.push(...ctx.bullets(info));
    if (m.next && m.next.length) {
      b.push(labeled('Next Action(s):', '', { after: 0 }));
      b.push(...ctx.bullets(m.next.map(text => ({ text }))));
    } else b.push(labeled('Next Action(s):', 'No further actions recommended'));
    return b;
  }

  function pack(ctx, body) {
    const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1304" w:right="1304" w:bottom="1304" w:left="1304" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>';
    const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + body.join('') + sect + '</w:body></w:document>';
    const images = ctx.images;
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
      images.map(im => '<Relationship Id="' + im.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + im.name + '"/>').join('') +
      '</Relationships>';
    const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>';
    const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
    return zip([
      { name: '[Content_Types].xml', data: enc.encode(types) },
      { name: '_rels/.rels', data: enc.encode(rootRels) },
      { name: 'word/document.xml', data: enc.encode(documentXml) },
      { name: 'word/styles.xml', data: enc.encode(STYLES) },
      { name: 'word/numbering.xml', data: enc.encode(NUMBERING) },
      { name: 'word/_rels/document.xml.rels', data: enc.encode(rels) },
      ...images.map(im => ({ name: 'word/media/' + im.name, data: im.data }))
    ]);
  }

  function build(m) { const ctx = newCtx(); return pack(ctx, postBody(ctx, m, false)); }

  /* the combined working document */
  function buildFinal(f) {
    const ctx = newCtx(), { run, para } = ctx, b = [];
    b.push(para(run(f.title + '\n' + f.range), 'Heading1', false, { jc: 'center' }));
    b.push(para(run('Undertaken by', { b: true, u: true }), null, false, { jc: 'center' }));
    b.push(para(run(f.members.join(', ')), null, false, { jc: 'center' }));
    b.push(para(''));
    b.push(para(run('Searched Terms'), 'Heading2'));
    b.push(para(run('Below are listed each subject searched for, the account(s) or search used, and the search terms used in each case.')));

    const W = [2046, 2046, 5206];
    const cell = (w, inner) => '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/></w:tcPr>' + inner + '</w:tc>';
    const hdr = ['Subject', 'Account(s) / Search Used', 'Search Terms (each on new line)'];
    const bd = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="000000"/>').join('');
    b.push('<w:tbl><w:tblPr><w:tblW w:w="9298" w:type="dxa"/><w:tblBorders>' + bd + '</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>' +
      '<w:tblGrid>' + W.map(w => '<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>' +
      '<w:tr>' + hdr.map((h, i) => cell(W[i], para(run(h, true), null, false, { after: 0 }))).join('') + '</w:tr>' +
      '<w:tr>' + cell(W[0], para('', null, false, { after: 0 })) + cell(W[1], para('', null, false, { after: 0 })) + cell(W[2], para('', null, true)) + '</w:tr></w:tbl>');

    f.posts.forEach(p => { b.push(...postBody(ctx, p, true)); });

    b.push(para(run('All Extracted Information'), 'Heading2', false, { pbb: true }));
    b.push(para(run('Below is a list of all information contained within the X posts and replies, broken down by subject.')));
    f.master.forEach(g => {
      if (!g.points.length) return;
      b.push(para(run(g.subject), 'Heading3'));
      b.push(...ctx.bullets(g.points));
    });

    b.push(para(run('Suggested Actions'), 'Heading2', false, { pbb: true }));
    b.push(para(run('After conducting a thorough search of X, we recommend the following actions:')));
    b.push(...ctx.bullets(f.actions.map(text => ({ text }))));
    return pack(ctx, b);
  }

  g.T10Docx = { build, buildFinal, zip };
})(typeof window !== 'undefined' ? window : globalThis);
