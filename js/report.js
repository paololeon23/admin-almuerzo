(function (root) {
  function utf8(str) {
    return new TextEncoder().encode(str);
  }
  function concat(parts) {
    var len = 0;
    var i;
    for (i = 0; i < parts.length; i += 1) len += parts[i].length;
    var out = new Uint8Array(len);
    var o = 0;
    for (i = 0; i < parts.length; i += 1) {
      out.set(parts[i], o);
      o += parts[i].length;
    }
    return out;
  }
  function u16(n) {
    return new Uint8Array([n & 255, (n >>> 8) & 255]);
  }
  function u32(n) {
    return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  }
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    var n;
    var c;
    var k;
    for (n = 0; n < 256; n += 1) {
      c = n;
      for (k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xffffffff;
    var i;
    for (i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zipStore(files) {
    var locals = [];
    var centrals = [];
    var offset = 0;
    files.forEach(function (file) {
      var name = utf8(file.name);
      var data = typeof file.data === "string" ? utf8(file.data) : file.data;
      var crc = crc32(data);
      var local = concat([
        utf8("PK\u0003\u0004"),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        name,
        data,
      ]);
      var central = concat([
        utf8("PK\u0001\u0002"),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    });
    var central = concat(centrals);
    var end = concat([
      utf8("PK\u0005\u0006"),
      u16(0),
      u16(0),
      u16(files.length),
      u16(files.length),
      u32(central.length),
      u32(offset),
      u16(0),
    ]);
    return concat(locals.concat([central, end]));
  }
  function xmlEsc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function defaultColumns() {
    return [
      { key: "supervisor", label: "Supervisor", align: "left", width: 38 },
      { key: "comidas", label: "Comidas", align: "center", width: 12, num: true },
      { key: "extras", label: "Extras", align: "center", width: 12, num: true },
      { key: "comedor", label: "Comedor", align: "left", width: 28 },
      { key: "total", label: "Total", align: "center", width: 12, num: true },
    ];
  }
  function columnsOf(meta) {
    return meta && meta.columns && meta.columns.length ? meta.columns : defaultColumns();
  }
  function sheetNameOf(meta) {
    var name = String((meta && meta.sheet) || "Listado").replace(/[\\/*?:\[\]]/g, " ").trim();
    return name.slice(0, 31) || "Listado";
  }
  function footerOf(rows, meta, cols) {
    if (meta && meta.footer) return meta.footer;
    var out = {};
    cols.forEach(function (col, i) {
      if (i === 0) out[col.key] = "Total";
      else if (col.num) {
        out[col.key] = rows.reduce(function (a, r) {
          return a + (Number(r[col.key]) || 0);
        }, 0);
      } else out[col.key] = "";
    });
    return out;
  }

  function xlsx(rows, meta) {
    var cols = columnsOf(meta);
    var title = (meta && meta.title) || "Qberries";
    var subtitle = (meta && meta.subtitle) || "";
    var foot = footerOf(rows, meta, cols);
    var lastCol = cols.length;
    function cellInline(ref, text, style) {
      return '<c r="' + ref + '" t="inlineStr" s="' + style + '"><is><t>' + xmlEsc(text) + "</t></is></c>";
    }
    function cellNum(ref, num, style) {
      return '<c r="' + ref + '" s="' + style + '"><v>' + Number(num) + "</v></c>";
    }
    function colLetter(n) {
      var s = "";
      var x = n;
      while (x > 0) {
        var m = (x - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        x = Math.floor((x - 1) / 26);
      }
      return s;
    }
    var sheetRows = [];
    sheetRows.push('<row r="1" ht="24" customHeight="1">' + cellInline("A1", title, 1) + "</row>");
    sheetRows.push('<row r="2" ht="18" customHeight="1">' + cellInline("A2", subtitle, 2) + "</row>");
    sheetRows.push('<row r="3"></row>');
    sheetRows.push(
      '<row r="4" ht="22" customHeight="1">' +
        cols
          .map(function (col, i) {
            return cellInline(colLetter(i + 1) + "4", col.label, 3);
          })
          .join("") +
        "</row>"
    );
    rows.forEach(function (r, i) {
      var n = 5 + i;
      var zebra = i % 2 === 1;
      sheetRows.push(
        '<row r="' +
          n +
          '" ht="20" customHeight="1">' +
          cols
            .map(function (col, ci) {
              var ref = colLetter(ci + 1) + n;
              var val = r[col.key];
              var numeric = col.num || (typeof val === "number" && isFinite(val));
              var center = numeric || col.align === "center";
              if (numeric) return cellNum(ref, val, zebra ? 7 : 5);
              return cellInline(ref, val == null ? "" : String(val), center ? (zebra ? 7 : 5) : zebra ? 6 : 4);
            })
            .join("") +
          "</row>"
      );
    });
    var last = 5 + rows.length;
    sheetRows.push(
      '<row r="' +
        last +
        '" ht="22" customHeight="1">' +
        cols
          .map(function (col, ci) {
            var ref = colLetter(ci + 1) + last;
            var val = foot[col.key];
            var numeric = col.num || (typeof val === "number" && isFinite(val));
            var center = numeric || col.align === "center";
            if (numeric) return cellNum(ref, val == null ? 0 : val, 9);
            return cellInline(ref, val == null ? "" : String(val), center ? 9 : 8);
          })
          .join("") +
        "</row>"
    );
    var colXml = cols
      .map(function (col, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (col.width || 16) + '" customWidth="1"/>';
      })
      .join("");
    var mergeEnd = colLetter(lastCol);
    var sheet =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="18"/>' +
      "<cols>" +
      colXml +
      "</cols>" +
      "<sheetData>" +
      sheetRows.join("") +
      "</sheetData>" +
      '<mergeCells count="2"><mergeCell ref="A1:' +
      mergeEnd +
      '1"/><mergeCell ref="A2:' +
      mergeEnd +
      '2"/></mergeCells>' +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="1"/>' +
      "</worksheet>";
    var styles =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="5">' +
      '<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="16"/><color rgb="FF3F8736"/><name val="Calibri"/></font>' +
      '<font><sz val="10"/><color rgb="FF6B7380"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF3F8736"/><name val="Calibri"/></font>' +
      "</fonts>" +
      '<fills count="5">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF55A846"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF6E7"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF7F8FA"/><bgColor indexed="64"/></patternFill></fill>' +
      "</fills>" +
      '<borders count="2">' +
      "<border><left/><right/><top/><bottom/><diagonal/></border>" +
      '<border><left style="thin"><color rgb="FFDCE3DC"/></left><right style="thin"><color rgb="FFDCE3DC"/></right><top style="thin"><color rgb="FFDCE3DC"/></top><bottom style="thin"><color rgb="FFDCE3DC"/></bottom><diagonal/></border>' +
      "</borders>" +
      '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
      '<cellXfs count="10">' +
      "<xf/>" +
      '<xf fontId="1" fillId="0" borderId="0" applyFont="1"><alignment vertical="center"/></xf>' +
      '<xf fontId="2" fillId="0" borderId="0" applyFont="1"><alignment vertical="center"/></xf>' +
      '<xf fontId="3" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf fontId="0" fillId="0" borderId="1" applyBorder="1"><alignment vertical="center"/></xf>' +
      '<xf fontId="0" fillId="0" borderId="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf fontId="0" fillId="4" borderId="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>' +
      '<xf fontId="0" fillId="4" borderId="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf fontId="4" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>' +
      '<xf fontId="4" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>' +
      "</cellXfs></styleSheet>";
    var workbook =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' +
      xmlEsc(sheetNameOf(meta)) +
      '" sheetId="1" r:id="rId1"/></sheets></workbook>';
    var rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>";
    var wbRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>";
    var types =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      "</Types>";
    var bytes = zipStore([
      { name: "[Content_Types].xml", data: types },
      { name: "_rels/.rels", data: rels },
      { name: "xl/workbook.xml", data: workbook },
      { name: "xl/_rels/workbook.xml.rels", data: wbRels },
      { name: "xl/styles.xml", data: styles },
      { name: "xl/worksheets/sheet1.xml", data: sheet },
    ]);
    return new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  function pdfEscape(str) {
    var out = "";
    var i;
    for (i = 0; i < str.length; i += 1) {
      var c = str.charCodeAt(i);
      if (c === 40 || c === 41 || c === 92) out += "\\" + str.charAt(i);
      else if (c === 0x2013 || c === 0x2014) out += "-";
      else if (c === 0x00b7) out += "\\267";
      else if (c >= 32 && c <= 126) out += str.charAt(i);
      else if (c > 127 && c < 256) out += "\\" + ("00" + c.toString(8)).slice(-3);
      else out += "?";
    }
    return out;
  }
  function clip(str, max) {
    var s = String(str || "");
    return s.length > max ? s.slice(0, max - 1) + "." : s;
  }
  function pdf(rows, meta) {
    var colsMeta = columnsOf(meta);
    var title = (meta && meta.title) || "Qberries";
    var subtitle = (meta && meta.subtitle) || "";
    var foot = footerOf(rows, meta, colsMeta);
    var W = 842;
    var H = 595;
    var margin = 36;
    var headerH = 54;
    var usable = W - margin * 2;
    var weightSum = colsMeta.reduce(function (a, c) {
      return a + (c.width || 16);
    }, 0);
    var x = margin;
    var cols = colsMeta.map(function (col) {
      var w = Math.floor((usable * (col.width || 16)) / weightSum);
      var item = {
        x: x,
        w: w,
        key: col.key,
        label: String(col.label || "").toUpperCase(),
        align: col.align || (col.num ? "center" : "left"),
        num: !!col.num,
        clip: col.clip || (col.num ? 10 : 36),
      };
      x += w;
      return item;
    });
    if (cols.length) cols[cols.length - 1].w = margin + usable - cols[cols.length - 1].x;
    var rowH = 22;
    var tableTop = H - headerH - 58;
    var pages = [];
    var perPage = Math.max(1, Math.floor((tableTop - 70) / rowH) - 1);
    var p;
    for (p = 0; p < Math.max(1, Math.ceil(rows.length / perPage)); p += 1) {
      pages.push(rows.slice(p * perPage, (p + 1) * perPage));
    }

    function pageStream(chunk, pageIndex, isLast) {
      var y = tableTop;
      var s = [];
      s.push("0.333 0.659 0.275 rg 0 " + (H - headerH) + " " + W + " " + headerH + " re f");
      s.push("1 1 1 rg");
      s.push("BT /F2 16 Tf 36 " + (H - 28) + " Td (" + pdfEscape(title) + ") Tj ET");
      s.push("BT /F1 10 Tf 36 " + (H - 44) + " Td (" + pdfEscape(subtitle) + ") Tj ET");
      s.push("BT /F1 9 Tf " + (W - 160) + " " + (H - 36) + " Td (Pagina " + (pageIndex + 1) + " de " + pages.length + ") Tj ET");
      s.push("0.247 0.529 0.212 rg " + margin + " " + y + " " + (W - margin * 2) + " " + rowH + " re f");
      s.push("1 1 1 rg");
      cols.forEach(function (col) {
        var tx = col.align === "center" ? col.x + col.w / 2 - Math.min(28, col.label.length * 2.4) : col.x + 8;
        s.push("BT /F2 8 Tf " + tx + " " + (y + 7) + " Td (" + pdfEscape(col.label) + ") Tj ET");
      });
      y -= rowH;
      chunk.forEach(function (r, i) {
        if (i % 2 === 1) s.push("0.918 0.965 0.906 rg " + margin + " " + y + " " + (W - margin * 2) + " " + rowH + " re f");
        s.push("0.106 0.122 0.141 rg");
        cols.forEach(function (col) {
          var raw = r[col.key];
          var text = clip(raw, col.clip);
          var numeric = col.num || (typeof raw === "number" && isFinite(raw));
          var center = numeric || col.align === "center";
          var tx = center ? col.x + col.w / 2 - String(text).length * 3 : col.x + 8;
          s.push("BT /F1 9 Tf " + tx + " " + (y + 7) + " Td (" + pdfEscape(text) + ") Tj ET");
        });
        y -= rowH;
      });
      if (isLast) {
        s.push("0.918 0.965 0.906 rg " + margin + " " + y + " " + (W - margin * 2) + " " + rowH + " re f");
        s.push("0.247 0.529 0.212 rg");
        cols.forEach(function (col) {
          var raw = foot[col.key];
          var text = clip(raw, col.clip);
          var numeric = col.num || (typeof raw === "number" && isFinite(raw));
          var center = numeric || col.align === "center";
          var tx = center ? col.x + col.w / 2 - String(text).length * 3 : col.x + 8;
          s.push("BT /F2 9 Tf " + tx + " " + (y + 7) + " Td (" + pdfEscape(text) + ") Tj ET");
        });
        y -= 28;
        s.push("0.42 0.45 0.49 rg");
        s.push("BT /F1 8 Tf 36 24 Td (Documento generado por Qberries Lunch Admin  -  uso interno) Tj ET");
      }
      return s.join("\n");
    }

    var objects = [];
    objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n");
    var kids = pages
      .map(function (_, i) {
        return 3 + i * 2 + " 0 R";
      })
      .join(" ");
    objects.push("2 0 obj << /Type /Pages /Kids [" + kids + "] /Count " + pages.length + " >> endobj\n");
    var font1 = 3 + pages.length * 2;
    var font2 = font1 + 1;
    pages.forEach(function (chunk, i) {
      var pageId = 3 + i * 2;
      var contentId = pageId + 1;
      var stream = pageStream(chunk, i, i === pages.length - 1);
      objects.push(
        pageId +
          " 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 " +
          W +
          " " +
          H +
          "] /Resources << /Font << /F1 " +
          font1 +
          " 0 R /F2 " +
          font2 +
          " 0 R >> >> /Contents " +
          contentId +
          " 0 R >> endobj\n"
      );
      objects.push(
        contentId +
          " 0 obj << /Length " +
          stream.length +
          " >> stream\n" +
          stream +
          "\nendstream endobj\n"
      );
    });
    objects.push(font1 + " 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n");
    objects.push(font2 + " 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> endobj\n");

    var xref = [];
    var body = "%PDF-1.4\n";
    var pos = body.length;
    objects.forEach(function (obj) {
      xref.push(pos);
      body += obj;
      pos = body.length;
    });
    var xrefStart = body.length;
    var xrefBlock = "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
    xref.forEach(function (p) {
      xrefBlock += ("0000000000" + p).slice(-10) + " 00000 n \n";
    });
    body +=
      xrefBlock +
      "trailer << /Size " +
      (objects.length + 1) +
      " /Root 1 0 R >>\nstartxref\n" +
      xrefStart +
      "\n%%EOF";
    return new Blob([body], { type: "application/pdf" });
  }

  root.QberriesReport = { xlsx: xlsx, pdf: pdf };
})(typeof window !== "undefined" ? window : globalThis);
