"use strict";
/*
 * PDF -> EPUB (texto reflowable), pensado para PDFs de fics do Archive of Our
 * Own (a versão HTML do AO3 impressa como PDF). Roda inteiro no navegador:
 * pdf.js só lê o texto, o resto (capítulos, parágrafos, itálicos, página de
 * abertura com tags e resumo, sumário, metadados) é reconstruído aqui.
 *
 * API: PdfConvert.convert(arrayBuffer, { pdfjs?, JSZip?, fileName? })
 *      -> Promise<{ data: Uint8Array, title, author, chapters, words }>
 *
 * Funciona também em PDFs que não são do AO3: sem a tabela de tags, vira um
 * livro simples; os capítulos são detectados por títulos em negrito/maiores.
 */
(function (root) {
  const LABELS_FRONT = ["Rating", "Archive Warning", "Archive Warnings", "Category", "Fandom", "Relationship", "Characters", "Additional Tags", "Series", "Collections", "Language", "Stats"];
  const LABEL_ROW_RE = new RegExp("^(" + LABELS_FRONT.join("|") + "):\\s*(.*)$");
  const SECTION_RE = /^(Summary|Notes|Chapter Summary|Chapter Notes|Chapter End Notes|End Notes)$/;
  const SCENE_RE = /^[\s*~—–\-_#•·⁂=]{1,15}$/;
  const SYMBOL_ONLY_RE = /^[^\p{L}\p{N}]{1,6}$/u; // ex.: 🌙 ou ✦ sozinhos na linha = separador de cena
  const FOOTER_RE = /^Please drop by the Archive and comment/i;

  // ------------------------------------------------------------------ extração

  async function extractPages(doc, onProgress) {
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      try { await page.getOperatorList(); } catch (e) { /* fontes: segue sem nomes */ }
      const tc = await page.getTextContent();
      const view = page.view; // [x0,y0,x1,y1]
      const fontName = {};
      for (const k of Object.keys(tc.styles || {})) {
        try { const f = page.commonObjs.get(k); fontName[k] = (f && f.name) || ""; } catch (e) { fontName[k] = ""; }
      }
      let links = [];
      try {
        const ann = await page.getAnnotations();
        links = ann.filter((a) => a.subtype === "Link" && a.url && a.rect).map((a) => ({ url: a.url, r: a.rect }));
      } catch (e) { /* sem links */ }
      const items = [];
      for (const it of tc.items) {
        if (typeof it.str !== "string" || !it.str.length) continue;
        const size = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 10;
        const fn = (fontName[it.fontName] || "").toLowerCase();
        const x = it.transform[4], y = it.transform[5];
        let href = null;
        for (const l of links) {
          const cx = x + it.width / 2, cy = y + size * 0.3;
          if (cx >= l.r[0] && cx <= l.r[2] && cy >= l.r[1] && cy <= l.r[3]) { href = l.url; break; }
        }
        items.push({
          s: it.str, x, y, w: it.width, size,
          i: /italic|oblique/.test(fn), b: /bold|black|heavy/.test(fn), href,
        });
      }
      pages.push({ index: p - 1, width: view[2] - view[0], height: view[3] - view[1], items });
      if (onProgress) onProgress(p, doc.numPages);
    }
    return pages;
  }

  // Junta os itens de cada página em linhas (itens com o mesmo y).
  function buildLines(pages) {
    const out = [];
    for (const pg of pages) {
      const rows = [];
      const sorted = pg.items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
      for (const it of sorted) {
        let row = rows.find((r) => Math.abs(r.y - it.y) < Math.max(2, it.size * 0.25));
        if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
        row.items.push(it);
      }
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) {
        row.items.sort((a, b) => a.x - b.x);
        const runs = [];
        let prev = null;
        for (const it of row.items) {
          let s = it.s;
          if (prev) {
            const gap = it.x - (prev.x + prev.w);
            if (gap > Math.max(it.size, prev.size) * 0.12 && !/\s$/.test(prev.s) && !/^\s/.test(s)) s = " " + s;
          }
          const last = runs[runs.length - 1];
          if (last && last.i === it.i && last.b === it.b && last.href === it.href) last.t += s;
          else runs.push({ t: s, i: it.i, b: it.b, href: it.href });
          prev = it;
        }
        const text = runs.map((r) => r.t).join("").replace(/\s+/g, " ").trim();
        if (!text) continue;
        const x0 = row.items[0].x;
        const lastIt = row.items[row.items.length - 1];
        const size = Math.max(...row.items.map((i) => i.size));
        const allBold = row.items.every((i) => i.b || !i.s.trim());
        out.push({ page: pg.index, pageWidth: pg.width, y: row.y, x0, x1: lastIt.x + lastIt.w, size, runs, text, allBold });
      }
    }
    return out;
  }

  function median(a) {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  }

  function geometry(lines) {
    const sizeCount = new Map();
    for (const l of lines) { const k = Math.round(l.size * 2) / 2; sizeCount.set(k, (sizeCount.get(k) || 0) + l.text.length); }
    let bodySize = 12, best = -1;
    for (const [k, v] of sizeCount) if (v > best) { best = v; bodySize = k; }
    const bodyLines = lines.filter((l) => Math.abs(l.size - bodySize) < 0.6);
    const xCount = new Map();
    for (const l of bodyLines) { const k = Math.round(l.x0); xCount.set(k, (xCount.get(k) || 0) + 1); }
    let bodyX = bodyLines.length ? bodyLines[0].x0 : 0; best = -1;
    for (const [k, v] of xCount) if (v > best) { best = v; bodyX = k; }
    const x1s = bodyLines.map((l) => l.x1).sort((a, b) => a - b);
    const rightX = x1s.length ? x1s[Math.floor(x1s.length * 0.98)] : bodyX + 400;
    const gaps = [];
    for (let i = 1; i < lines.length; i++) {
      const a = lines[i - 1], b = lines[i];
      if (a.page === b.page && Math.abs(a.size - bodySize) < 0.6 && Math.abs(b.size - bodySize) < 0.6) gaps.push(a.y - b.y);
    }
    // passo de linha típico = mediana dos intervalos "pequenos"
    const small = gaps.filter((g) => g > 0);
    const m0 = median(small);
    const pitch = median(small.filter((g) => g < m0 * 1.25)) || m0 || bodySize * 1.2;
    const minY = Math.min.apply(null, lines.map((l) => l.y));
    return { bodySize, bodyX, rightX, pitch, indent: 6, minY };
  }

  // ------------------------------------------------------------ blocos / texto

  function addSep(a, b) {
    // a, b: strings de fim/início de linha. Regras do Chrome ao quebrar linhas:
    // quebra depois de hífen colado em letra e antes/depois de travessão.
    if (/[A-Za-z0-9À-ɏ]-$/.test(a)) return "";
    if (/—$/.test(a) || /^—/.test(b)) return "";
    return " ";
  }

  function appendLine(par, line) {
    const prevText = par.runs.map((r) => r.t).join("");
    const sep = addSep(prevText, line.runs[0] ? line.runs[0].t.trimStart() : "");
    const runs = line.runs.map((r) => ({ ...r }));
    if (runs.length) runs[0].t = runs[0].t.replace(/^\s+/, "");
    if (sep) {
      // o espaço vai para o lado não-itálico para não gerar <em>palavra </em>
      const last = par.runs[par.runs.length - 1];
      if (last && !last.i) last.t += sep; else runs[0].t = sep + runs[0].t;
    }
    for (const r of runs) {
      const last = par.runs[par.runs.length - 1];
      if (last && last.i === r.i && last.b === r.b && last.href === r.href) last.t += r.t;
      else par.runs.push(r);
    }
    par.x1 = line.x1;
    par.lastLine = line;
  }

  function firstWordWidth(line) {
    const first = line.text.split(" ")[0] || "";
    const total = line.x1 - line.x0;
    return total * (first.length / Math.max(1, line.text.length));
  }

  function parseBlocks(lines, g) {
    const blocks = [];
    let par = null;
    const flush = () => { if (par) { blocks.push(par); par = null; } };
    const pageCenter = (l) => l.pageWidth / 2;
    const bodyWidth = g.rightX - g.bodyX;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (FOOTER_RE.test(l.text)) { flush(); continue; }

      if (l.size > g.bodySize * 1.25 && l.allBold) {
        flush();
        const prev = blocks[blocks.length - 1];
        if (prev && prev.type === "heading" && prev.lastLine.page === l.page && Math.abs(prev.lastLine.y - l.y - l.size * 1.3) < l.size * 0.6) {
          prev.text += " " + l.text; prev.lastLine = l; // título quebrado em duas linhas
        } else blocks.push({ type: "heading", text: l.text, lastLine: l, page: l.page });
        continue;
      }
      if (SECTION_RE.test(l.text) && l.x0 <= g.bodyX + g.indent) { flush(); blocks.push({ type: "label", text: l.text }); continue; }
      if (SCENE_RE.test(l.text) || SYMBOL_ONLY_RE.test(l.text)) { flush(); blocks.push({ type: "scene", text: l.text.trim() }); continue; }

      const quote = l.x0 >= g.bodyX + g.indent;
      const width = l.x1 - l.x0;
      const centered = Math.abs((l.x0 + l.x1) / 2 - pageCenter(l)) < 5 && width < bodyWidth * 0.8 && l.x0 > g.bodyX + 4 && !quote;

      let join = false;
      if (par && par.kind === (centered ? "center" : quote ? "quote" : "body") && !centered) {
        const pl = par.lastLine;
        if (pl.page === l.page) {
          join = pl.y - l.y < g.pitch * 1.4 && pl.y - l.y > 0;
        } else {
          // quebra de página: o parágrafo continua se a 1ª palavra da nova
          // linha não coubesse no fim da linha anterior (quebra gulosa)
          const ptxt = par.runs.map((r) => r.t).join("");
          const limit = g.rightX + 2;
          const noPunct = !/[.!?…”"’')\]*:;]$/.test(ptxt.trim());
          const wouldFit = par.x1 + g.bodySize * 0.25 + firstWordWidth(l) <= limit;
          join = noPunct || !wouldFit;
        }
      }
      if (join) appendLine(par, l);
      else {
        flush();
        par = { type: "para", kind: centered ? "center" : quote ? "quote" : "body", runs: [], x1: 0, lastLine: l, firstLine: l };
        appendLine(par, l);
        par.runs[0].t = par.runs[0].t.replace(/^\s+/, "");
      }
    }
    flush();
    return blocks;
  }

  // ------------------------------------------------------------- modelo do livro

  function plain(block) { return block.runs.map((r) => r.t).join("").replace(/\s+/g, " ").trim(); }

  function buildBook(blocks, frontLines, g) {
    const book = { title: "", author: "", sourceUrl: "", workId: "", meta: {}, summary: [], notes: [], chapters: [] };

    // 1) capa: "Posted originally…", linhas Rótulo: valor (valores podem quebrar)
    let lastLabel = null;
    for (const l of frontLines) {
      const m = LABEL_ROW_RE.exec(l.text);
      if (m && l.x0 < 120) { lastLabel = m[1] === "Archive Warnings" ? "Archive Warning" : m[1]; book.meta[lastLabel] = m[2].trim(); continue; }
      const u = /https?:\/\/(?:www\.)?archiveofourown\.org\/works\/(\d+)/i.exec(l.text);
      if (u) { book.workId = u[1]; book.sourceUrl = "https://archiveofourown.org/works/" + u[1]; lastLabel = null; continue; }
      if (lastLabel && l.x0 > 120) book.meta[lastLabel] += " " + l.text;
      else if (!book.title && !lastLabel) book.title = l.text;
    }

    // 2) percorre os blocos
    let state = "front"; // front | summary | notes | chapStart | cSummary | cNotes | body | endNotes
    let chap = null;
    const startChapter = (title) => {
      chap = { title, summary: [], notes: [], body: [], endNotes: [] };
      book.chapters.push(chap);
      state = "chapStart";
    };
    let lastFront = null;

    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      if (b.type === "heading") {
        const next = blocks[bi + 1];
        if (!chap && next && next.type === "para" && /^by\s+/i.test(plain(next))) {
          book.title = b.text;
          book.author = plain(next).replace(/^by\s+/i, "").trim();
          bi++; state = "front"; continue;
        }
        startChapter(b.text);
        continue;
      }
      if (b.type === "label") {
        const t = b.text;
        if (!chap) state = t === "Summary" ? "summary" : "notes";
        else if (t === "Chapter Summary" || t === "Summary") state = state === "body" || state === "endNotes" ? "endNotes" : "cSummary";
        else if (t === "Chapter Notes") state = state === "body" || state === "endNotes" ? "endNotes" : "cNotes";
        else state = "endNotes";
        lastFront = null;
        continue;
      }
      const isQuote = b.type === "para" && b.kind === "quote";
      if (state === "summary" || state === "notes") {
        // resumo/notas da obra: vão até o próximo título ou rótulo — ou, em
        // fics de capítulo único, até uma quebra de página forçada (página curta)
        if (b.type === "para" && lastFront && b.firstLine.page !== lastFront.page && lastFront.y > g.minY + g.pitch * 3) {
          startChapter(book.title || ""); state = "body"; chap.body.push(b); continue;
        }
        if (b.type === "para") { (state === "summary" ? book.summary : book.notes).push(b); lastFront = b.lastLine; }
        continue;
      }
      if (state === "cSummary" || state === "cNotes") {
        if (isQuote) { (state === "cSummary" ? chap.summary : chap.notes).push(b); continue; }
        state = "body";
      } else if (state === "endNotes") {
        chap.endNotes.push(b); continue;
      } else if (!chap) {
        startChapter(book.title || ""); state = "body";
      } else if (state === "chapStart") state = "body";
      chap.body.push(b);
    }

    book.chapters = book.chapters.filter((c) => c.body.length || c.summary.length || c.notes.length || c.endNotes.length);
    return book;
  }

  // ------------------------------------------------------------------- saída

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function runsToHtml(runs) {
    let html = "";
    for (const r of runs) {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.t);
      if (!m[2]) { html += esc(r.t); continue; }
      let core = esc(m[2]);
      if (r.i) core = "<em>" + core + "</em>";
      if (r.b) core = "<strong>" + core + "</strong>";
      if (r.href) core = '<a href="' + esc(r.href) + '">' + core + "</a>";
      html += esc(m[1]) + core + esc(m[3]);
    }
    return html;
  }

  function blocksToHtml(blocks, inQuote) {
    // blocos "quote" consecutivos viram um <blockquote> único
    let html = "";
    for (const b of blocks) {
      if (b.type === "scene") html += '<p class="scene-break">' + esc(b.text) + "</p>\n";
      else if (b.kind === "center") html += '<p class="center">' + runsToHtml(b.runs) + "</p>\n";
      else if (b.kind === "quote" && !inQuote) html += "<blockquote><p>" + runsToHtml(b.runs) + "</p></blockquote>\n";
      else html += "<p>" + runsToHtml(b.runs) + "</p>\n";
    }
    return html;
  }

  const XHTML_HEAD = (title, lang) =>
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="' + lang + '" xml:lang="' + lang + '"><head><meta charset="utf-8"/><title>' + esc(title) + '</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>';

  const CSS = `body{font-family:serif;line-height:1.45;margin:0}
h1.chapter-title,h1.work-title{text-align:center;font-size:1.5em;margin:1.2em 0 1em}
h1.work-title a{color:inherit;text-decoration:none}
p{margin:0 0 .9em}
p.center{text-align:center}
p.scene-break{text-align:center;margin:1.2em 0}
.byline{text-align:center;margin:0 0 1.4em}
.work-meta p{margin:0 0 .35em;text-indent:0}
.work-meta b{font-weight:bold}
.label{font-weight:bold;margin:1.2em 0 .4em}
blockquote{margin:.4em 0 1em 1.2em}
blockquote p{margin:0 0 .7em}
section.chapter-notes,section.chapter-endnotes{margin:0 0 1.2em}
section.chapter-endnotes{margin-top:1.8em;border-top:1px solid #888;padding-top:.6em}
`;

  function splitTags(s) { return s ? s.split(/,\s+/).map((x) => x.trim()).filter(Boolean) : []; }

  async function buildEpub(book, JSZip, fileTitle) {
    const m = book.meta;
    const title = book.title || fileTitle || "Untitled";
    const author = book.author || "Unknown";
    const lang = /portugu|^pt/i.test(m.Language || "") ? "pt" : /spanish|español|^es/i.test(m.Language || "") ? "es" : "en";
    const stats = m.Stats || "";
    const published = (/Published:\s*(\d{4}-\d{2}-\d{2})/.exec(stats) || [])[1];
    const updated = (/(?:Updated|Completed):\s*(\d{4}-\d{2}-\d{2})/.exec(stats) || [])[1];
    const words = (/Words:\s*([\d,.]+)/.exec(stats) || [])[1];
    const chaptersStat = (/Chapters:\s*(\d+)\s*\/\s*(\d+|\?)/.exec(stats) || []);
    const completed = chaptersStat[1] && chaptersStat[1] === chaptersStat[2];
    const summaryText = book.summary.map(plain).join("\n");
    const id = book.workId ? "ao3:" + book.workId : "urn:uuid:" + uuid();

    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file("META-INF/container.xml",
      '<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    zip.file("EPUB/style.css", CSS);

    // --- página de abertura (igual à que montei para os outros EPUBs)
    const metaRows = [];
    const row = (label, val) => { if (val) metaRows.push('<p><b>' + esc(label) + ":</b> " + esc(val) + "</p>"); };
    row("Rating", m.Rating); row("Archive Warning", m["Archive Warning"]); row("Category", m.Category);
    row("Fandom", m.Fandom); row("Relationship", m.Relationship); row("Characters", m.Characters);
    row("Additional Tags", m["Additional Tags"]); row("Language", m.Language); row("Series", m.Series); row("Stats", stats);
    const titleHtml = book.sourceUrl ? '<a href="' + esc(book.sourceUrl) + '">' + esc(title) + "</a>" : esc(title);
    let preface = XHTML_HEAD(title, lang) + '<section epub:type="frontmatter preface" role="doc-preface">';
    preface += '<h1 class="work-title">' + titleHtml + "</h1>";
    preface += '<p class="byline">by ' + esc(author) + "</p>";
    if (metaRows.length) preface += '<div class="work-meta">' + metaRows.join("\n") + "</div>";
    if (book.summary.length) preface += '<p class="label">Summary</p><blockquote>' + blocksToHtml(book.summary, true) + "</blockquote>";
    if (book.notes.length) preface += '<p class="label">Notes</p><blockquote>' + blocksToHtml(book.notes, true) + "</blockquote>";
    preface += "</section></body></html>";
    zip.file("EPUB/preface.xhtml", preface);

    // --- capítulos
    const chFiles = [];
    book.chapters.forEach((c, idx) => {
      const file = "c" + (idx + 1) + ".xhtml";
      let h = XHTML_HEAD(c.title || title, lang);
      h += '<h1 class="chapter-title" id="c' + (idx + 1) + '">' + esc(c.title || title) + "</h1>";
      if (c.summary.length) h += '<section class="chapter-notes"><p class="label">Chapter Summary</p><blockquote>' + blocksToHtml(c.summary, true) + "</blockquote></section>";
      if (c.notes.length) h += '<section class="chapter-notes"><p class="label">Chapter Notes</p><blockquote>' + blocksToHtml(c.notes, true) + "</blockquote></section>";
      h += '<section class="chapter-body"><div class="story"><div class="userstuff module">' + blocksToHtml(c.body, false) + "</div></div></section>";
      if (c.endNotes.length) h += '<section class="chapter-endnotes"><p class="label">Notes</p><blockquote>' + blocksToHtml(c.endNotes, true) + "</blockquote></section>";
      h += "</body></html>";
      zip.file("EPUB/" + file, h);
      chFiles.push({ file, title: c.title || title, id: "chapter_" + (idx + 1) });
    });

    // --- sumário
    const tocItems = [{ file: "preface.xhtml", title: "Preface" }].concat(chFiles);
    zip.file("EPUB/nav.xhtml",
      '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="' + lang + '" xml:lang="' + lang + '"><head><title>Table of Contents</title></head><body><nav epub:type="toc" id="toc" role="doc-toc"><h1>Table of Contents</h1><ol>' +
      tocItems.map((t) => '<li><a href="' + t.file + '">' + esc(t.title) + "</a></li>").join("") + "</ol></nav></body></html>");
    zip.file("EPUB/toc.ncx",
      '<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="' + esc(id) + '"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>' + esc(title) + "</text></docTitle><navMap>" +
      tocItems.map((t, i) => '<navPoint id="np' + (i + 1) + '" playOrder="' + (i + 1) + '"><navLabel><text>' + esc(t.title) + '</text></navLabel><content src="' + t.file + '"/></navPoint>').join("") + "</navMap></ncx>");

    // --- OPF (mesmo vocabulário dos EPUBs do AO3)
    const meta = [];
    meta.push('<dc:identifier id="pub-id">' + esc(id) + "</dc:identifier>");
    meta.push("<dc:title>" + esc(title) + "</dc:title>");
    meta.push("<dc:language>" + lang + "</dc:language>");
    meta.push("<dc:creator>" + esc(author) + "</dc:creator>");
    if (summaryText) meta.push("<dc:description>" + esc(summaryText) + "</dc:description>");
    if (published) meta.push("<dc:date>" + published + "T00:00:00Z</dc:date>");
    for (const t of splitTags(m["Additional Tags"])) meta.push("<dc:subject>" + esc(t) + "</dc:subject>");
    meta.push('<meta name="completed" content="' + (completed ? 1 : 0) + '"/>');
    meta.push('<meta name="generator" content="send2kobo-pdf"/>');
    meta.push('<meta property="dcterms:modified">' + (updated ? updated + "T00:00:00Z" : new Date().toISOString().replace(/\.\d+Z$/, "Z")) + "</meta>");
    if (m.Fandom) for (const t of splitTags(m.Fandom)) meta.push('<meta name="ao3:fandom" content="' + esc(t) + '"/>');
    if (m.Relationship) for (const t of splitTags(m.Relationship)) meta.push('<meta name="ao3:relationship" content="' + esc(t) + '"/>');
    if (m.Characters) for (const t of splitTags(m.Characters)) meta.push('<meta name="ao3:character" content="' + esc(t) + '"/>');
    if (m["Archive Warning"]) meta.push('<meta name="ao3:warning" content="' + esc(m["Archive Warning"]) + '"/>');
    if (m.Rating) meta.push('<meta name="ao3:rating" content="' + esc(m.Rating) + '"/>');
    if (m.Category) meta.push('<meta name="ao3:category" content="' + esc(m.Category) + '"/>');
    if (words) meta.push('<meta name="ao3:words" content="' + words.replace(/[,.]/g, "") + '"/>');
    if (book.sourceUrl) meta.push('<meta name="ao3:source_url" content="' + esc(book.sourceUrl) + '"/>');

    const manifest = ['<item href="nav.xhtml" id="nav" media-type="application/xhtml+xml" properties="nav"/>',
      '<item href="style.css" id="css" media-type="text/css"/>',
      '<item href="preface.xhtml" id="preface" media-type="application/xhtml+xml"/>']
      .concat(chFiles.map((c) => '<item href="' + c.file + '" id="' + c.id + '" media-type="application/xhtml+xml"/>'))
      .concat(['<item href="toc.ncx" id="ncx" media-type="application/x-dtbncx+xml"/>']);
    const spine = ['<itemref idref="preface"/>'].concat(chFiles.map((c) => '<itemref idref="' + c.id + '"/>'));
    zip.file("EPUB/content.opf",
      '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="pub-id" xml:lang="' + lang + '"><metadata>' +
      meta.join("\n") + "</metadata><manifest>" + manifest.join("\n") + '</manifest><spine toc="ncx">' + spine.join("\n") + "</spine></package>");

    const data = await zip.generateAsync({ type: "uint8array", mimeType: "application/epub+zip", compression: "DEFLATE" });
    return { data, title, author, chapters: book.chapters.length, words: countWords(book) };
  }

  function countWords(book) {
    let n = 0;
    for (const c of book.chapters) for (const b of c.body) if (b.type === "para") n += plain(b).split(/\s+/).filter(Boolean).length;
    return n;
  }

  function uuid() {
    const c = root.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0; return (ch === "x" ? r : (r & 3) | 8).toString(16);
    });
  }

  // ------------------------------------------------------------------- entrada

  async function convert(arrayBuffer, opts) {
    opts = opts || {};
    const pdfjs = opts.pdfjs || root.pdfjsLib;
    const JSZip = opts.JSZip || root.JSZip;
    if (!pdfjs) throw new Error("pdf.js not loaded");
    const doc = await pdfjs.getDocument({ data: arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
    const pages = await extractPages(doc, opts.onProgress);
    const lines = buildLines(pages);
    if (!lines.length) throw new Error("NO_TEXT"); // PDF escaneado / só imagens
    const g = geometry(lines);
    // tabela de tags da capa (página 1 do PDF do AO3): vai de "Posted originally"
    // até a linha "Stats:" (+ continuação), e sai do fluxo do texto
    let frontEnd = -1;
    for (let k = 0; k < Math.min(lines.length, 60); k++) if (/^Stats:/.test(lines[k].text)) { frontEnd = k; break; }
    if (frontEnd >= 0) while (frontEnd + 1 < lines.length && lines[frontEnd + 1].page === lines[frontEnd].page && lines[frontEnd + 1].x0 > 120) frontEnd++;
    const frontLines = frontEnd >= 0 ? lines.slice(0, frontEnd + 1) : [];
    const blocks = parseBlocks(lines.slice(frontEnd + 1), g);
    const book = buildBook(blocks, frontLines, g);
    if (!book.title) {
      try { const md = await doc.getMetadata(); book.title = (md.info && md.info.Title) || ""; if (!book.author) book.author = (md.info && md.info.Author) || ""; } catch (e) { /* ok */ }
    }
    if (!book.chapters.length) throw new Error("NO_TEXT");
    const fileTitle = (opts.fileName || "").replace(/\.pdf$/i, "").replace(/[_]+/g, " ");
    const res = await buildEpub(book, JSZip, fileTitle);
    res.book = book; res.geometry = g;
    return res;
  }

  const api = { convert, _internals: { extractPages, buildLines, geometry, parseBlocks, buildBook } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PdfConvert = api;
})(typeof window !== "undefined" ? window : globalThis);
