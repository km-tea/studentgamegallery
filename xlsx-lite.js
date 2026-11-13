/* 엑셀(.xlsx)·CSV 읽기, .xlsx 만들기 — 외부 라이브러리 없이 브라우저 기능만 사용 (학교 네트워크가 CDN을 막아도 동작)
   XlsxLite.readFile(file)       → Promise<2차원 배열>  (.xlsx / .csv / .txt)
   XlsxLite.makeXlsx(rows, name) → Blob
   XlsxLite.download(blob, 파일이름)                                                          */
(function () {
  var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  function u16(d, o) { return d[o] | (d[o + 1] << 8); }
  function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; }

  // ---------- 읽기: .xlsx 는 zip 안의 XML ----------
  function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('이 브라우저에서는 엑셀 파일을 읽을 수 없어요. 엑셀에서 .csv로 저장해서 올려 주세요'));
    var s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(s).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function unzip(buf) {
    var d = new Uint8Array(buf), eocd = -1;
    for (var i = d.length - 22; i >= Math.max(0, d.length - 65557); i--) if (u32(d, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return Promise.reject(new Error('엑셀(.xlsx) 파일이 아니에요'));
    var n = u16(d, eocd + 10), p = u32(d, eocd + 16), files = {}, jobs = [];
    for (var k = 0; k < n && u32(d, p) === 0x02014b50; k++) {
      var method = u16(d, p + 10), csize = u32(d, p + 20), nlen = u16(d, p + 28), elen = u16(d, p + 30), clen = u16(d, p + 32), lho = u32(d, p + 42);
      var name = new TextDecoder().decode(d.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (!/^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/worksheets\/[^/]+\.xml)$/.test(name)) continue; // 필요한 것만 푼다
      (function (name, method, csize, lho) {
        var start = lho + 30 + u16(d, lho + 26) + u16(d, lho + 28), raw = d.subarray(start, start + csize);
        var job = method === 0 ? Promise.resolve(raw) : method === 8 ? inflateRaw(raw) : Promise.reject(new Error('지원하지 않는 압축 방식이에요'));
        jobs.push(job.then(function (x) { files[name] = new TextDecoder().decode(x); }));
      })(name, method, csize, lho);
    }
    return Promise.all(jobs).then(function () { return files; });
  }
  function xml(s) { return new DOMParser().parseFromString(s, 'application/xml'); }
  function els(node, tag) { return Array.prototype.slice.call(node.getElementsByTagNameNS('*', tag)); }
  function colIndex(ref) { var m = /^([A-Z]+)/i.exec(ref || ''), n = 0; if (!m) return -1; m[1].toUpperCase().split('').forEach(function (c) { n = n * 26 + c.charCodeAt(0) - 64; }); return n - 1; }
  function textOf(node) { return els(node, 't').filter(function (t) { return !t.parentNode || t.parentNode.localName !== 'rPh'; }).map(function (t) { return t.textContent; }).join(''); }

  function readXlsx(buf) {
    return unzip(buf).then(function (f) {
      var shared = f['xl/sharedStrings.xml'] ? els(xml(f['xl/sharedStrings.xml']), 'si').map(textOf) : [];
      var sheetPath = null;
      if (f['xl/workbook.xml'] && f['xl/_rels/workbook.xml.rels']) {
        var sh = els(xml(f['xl/workbook.xml']), 'sheet')[0];
        var rid = sh && (sh.getAttributeNS(NS_R, 'id') || sh.getAttribute('r:id'));
        els(xml(f['xl/_rels/workbook.xml.rels']), 'Relationship').forEach(function (r) {
          if (r.getAttribute('Id') === rid) { var t = r.getAttribute('Target'); sheetPath = t.charAt(0) === '/' ? t.slice(1) : 'xl/' + t; }
        });
      }
      if (!sheetPath || !f[sheetPath]) sheetPath = Object.keys(f).filter(function (k) { return /^xl\/worksheets\//.test(k); }).sort()[0];
      if (!sheetPath) throw new Error('엑셀에서 시트를 찾지 못했어요');
      var rows = [], rIdx = 0;
      els(xml(f[sheetPath]), 'row').forEach(function (row) {
        var ri = row.getAttribute('r') ? parseInt(row.getAttribute('r'), 10) - 1 : rIdx; rIdx = ri + 1;
        var cIdx = 0, line = rows[ri] = rows[ri] || [];
        els(row, 'c').forEach(function (c) {
          var ci = colIndex(c.getAttribute('r')); if (ci < 0) ci = cIdx; cIdx = ci + 1;
          var t = c.getAttribute('t'), v = els(c, 'v')[0], val = '';
          if (t === 'inlineStr') val = textOf(c);
          else if (v) val = t === 's' ? (shared[parseInt(v.textContent, 10)] || '') : t === 'b' ? (v.textContent === '1' ? 'TRUE' : 'FALSE') : v.textContent;
          line[ci] = val;
        });
      });
      return normalize(rows);
    });
  }
  function normalize(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) { var r = rows[i] || [], line = []; for (var j = 0; j < r.length; j++) line[j] = r[j] == null ? '' : String(r[j]); out.push(line); }
    while (out.length && !out[out.length - 1].some(function (c) { return String(c).trim(); })) out.pop();
    return out;
  }

  // ---------- 읽기: CSV (엑셀 "CSV(쉼표로 분리)"는 한글이 EUC-KR이라 자동으로 구분) ----------
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
    catch (e) { return new TextDecoder('euc-kr').decode(buf); }
  }
  function parseCsv(text) {
    var first = text.split(/\r?\n/)[0] || '', delim = ',';
    [',', ';', '\t'].forEach(function (d) { if (first.split(d).length > first.split(delim).length) delim = d; });
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return normalize(rows);
  }

  function readFile(file) {
    var name = (file.name || '').toLowerCase();
    if (/\.xls$/.test(name)) return Promise.reject(new Error('옛날 형식(.xls)은 읽을 수 없어요. 엑셀에서 「다른 이름으로 저장 → Excel 통합 문서(.xlsx)」로 저장해 주세요'));
    return file.arrayBuffer().then(function (buf) {
      if (/\.(csv|txt|tsv)$/.test(name)) return parseCsv(decodeText(buf));
      return readXlsx(buf);
    });
  }

  // ---------- 쓰기: 압축 없이 담은 최소 .xlsx ----------
  var CRC = (function () { var t = [], c; for (var n = 0; n < 256; n++) { c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var nm = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data), len = data.length;
      var lh = new Uint8Array(30 + nm.length), lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(12, 0x21, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, len, true); lv.setUint32(22, len, true); lv.setUint16(26, nm.length, true); lh.set(nm, 30);
      var ch = new Uint8Array(46 + nm.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, len, true); cv.setUint32(24, len, true); cv.setUint16(28, nm.length, true); cv.setUint32(42, offset, true); ch.set(nm, 46);
      parts.push(lh, data); central.push(ch); offset += lh.length + len;
    });
    var cdSize = central.reduce(function (s, c) { return s + c.length; }, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function esc(s) { return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function colName(i) { var s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; }
  function makeXlsx(rows, sheetName) {
    var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
    var cols = '<cols>' + Array.apply(null, Array(width)).map(function (_, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="28" customWidth="1"/>'; }).join('') + '</cols>';
    var data = rows.map(function (r, ri) {
      return '<row r="' + (ri + 1) + '">' + r.map(function (v, ci) { return '<c r="' + colName(ci) + (ri + 1) + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v == null ? '' : v) + '</t></is></c>'; }).join('') + '</row>';
    }).join('');
    var X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    return zip([
      { name: '[Content_Types].xml', text: X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
      { name: '_rels/.rels', text: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + NS_R + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', text: X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + NS_R + '"><sheets><sheet name="' + esc(sheetName || 'Sheet1').slice(0, 31) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + NS_R + '/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: 'xl/worksheets/sheet1.xml', text: X + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + cols + '<sheetData>' + data + '</sheetData></worksheet>' }
    ]);
  }
  function download(blob, filename) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  window.XlsxLite = { readFile: readFile, makeXlsx: makeXlsx, download: download, parseCsv: parseCsv };
})();
