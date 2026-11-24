"use strict";
/*
 * HTML -> EPUB. Feito para o "Download > HTML" do Archive of Our Own (mesma
 * estrutura do PDF: tabela de tags, resumo, notas, capítulos), mas também
 * aceita HTML comum: títulos (h1–h6) viram capítulos. Reaproveita o mesmo
 * montador de EPUB do conversor de PDF (pdf-convert.js).
 *
 * API: HtmlConvert.convert(arrayBuffer, { JSZip?, fileName? })
 *      -> Promise<{ data: Uint8Array, title, author, chapters, words }>
 */
(function (root) {
  const FOOTER_RE = /^Please drop by the Archive and comment/i;
  const LABEL_RE = /^(Summary|Notes|Chapter Summary|Chapter Notes|Chapter End Notes|End Notes)$/;
  const SCENE_RE = /^[\s*~—–\-_#•·⁂=]{1,15}$/;
  const SYMBOL_ONLY_RE = /^[^\p{L}\p{N}]{1,6}$/u;
  const SKIP_TAGS = new Set(["script", "style", "head", "noscript", "svg", "nav", "iframe", "template", "title"]);
  const BLOCK_TAGS = new Set(["p", "div", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "hr", "section", "article", "pre", "center", "table", "tr", "dl", "dt", "dd", "header", "footer", "main", "body", "figure"]);

  function decodeText(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); }
    catch (e) { return new TextDecoder("windows-1252").decode(u8); }
  }

  function pushRun(out, t, st) {
    if (!t) return;
    const last = out[out.length - 1];
    if (/^[ \n]/.test(t) && last && /[ \n]$/.test(last.t)) t = t.replace(/^ /, "");
    if (!out.length) t = t.replace(/^ +/, "");
    if (!t) return;
    if (last && last.i === st.i && last.b === st.b && last.href === st.href) last.t += t;
    else out.push({ t, i: st.i, b: st.b, href: st.href });
  }

  function inlineRuns(node, st, out) {
    for (const ch of Array.from(node.childNodes)) {
      if (ch.nodeType === 3) { pushRun(out, ch.nodeValue.replace(/\s+/g, " "), st); continue; }
      if (ch.nodeType !== 1) continue;
      const tag = ch.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      if (tag === "br") { pushRun(out, "\n", st); continue; }
      const next = { i: st.i, b: st.b, href: st.href };
      if (tag === "em" || tag === "i" || tag === "cite") next.i = true;
      if (tag === "strong" || tag === "b") next.b = true;
      const style = (ch.getAttribute("style") || "").toLowerCase();
      if (/font-style:\s*italic/.test(style)) next.i = true;
      if (/font-weight:\s*(bold|[6-9]00)/.test(style)) next.b = true;
      if (tag === "a") { const h = ch.getAttribute("href"); if (h && /^https?:/i.test(h)) next.href = h; }
      inlineRuns(ch, next, out);
    }
  }

  function trimRuns(runs) {
    while (runs.length && !runs[runs.length - 1].t.replace(/[ \n]+$/, "")) runs.pop();
    if (runs.length) runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/[ \n]+$/, "");
    while (runs.length && !runs[0].t.replace(/^[ \n]+/, "")) runs.shift();
    if (runs.length) runs[0].t = runs[0].t.replace(/^[ \n]+/, "");
    return runs;
  }
  const textOf = (runs) => runs.map((r) => r.t).join("").replace(/\s+/g, " ").trim();
  const POS = { page: 0, y: 0 };

  function isCentered(el) {
    const s = ((el.getAttribute("style") || "") + " " + (el.getAttribute("align") || "") + " " + (el.className || "")).toLowerCase();
    return /text-align:\s*center|\bcenter\b/.test(s);
  }

  function hasBlockChild(el) {
    return Array.from(el.children).some((c) => BLOCK_TAGS.has(c.tagName.toLowerCase()) || /^h[1-6]$/.test(c.tagName.toLowerCase()));
  }

  function emitInline(nodes, tokens, ctx, centered) {
    const runs = [];
    for (const n of nodes) {
      if (n.nodeType === 3) pushRun(runs, n.nodeValue.replace(/\s+/g, " "), { i: false, b: false, href: null });
      else if (n.nodeType === 1) {
        const holder = { childNodes: [n] };
        inlineRuns(holder, { i: false, b: false, href: null }, runs);
      }
    }
    trimRuns(runs);
    const text = textOf(runs);
    if (!text || FOOTER_RE.test(text)) return;
    if (LABEL_RE.test(text) && text.length < 24) { tokens.push({ type: "label", text }); return; }
    if (SCENE_RE.test(text) || SYMBOL_ONLY_RE.test(text)) { tokens.push({ type: "scene", text }); return; }
    tokens.push({ type: "para", kind: ctx.quote ? "quote" : centered ? "center" : "body", runs, firstLine: POS, lastLine: POS });
  }

  function walk(el, ctx, tokens, skipFn) {
    let buf = [];
    const flush = () => { if (buf.length) { emitInline(buf, tokens, ctx, ctx.center); buf = []; } };
    for (const ch of Array.from(el.childNodes)) {
      if (ch.nodeType !== 1) { if (ch.nodeType === 3) buf.push(ch); continue; }
      const tag = ch.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag) || skipFn(ch)) continue;
      if (!BLOCK_TAGS.has(tag)) { buf.push(ch); continue; }
      flush();
      if (/^h[1-6]$/.test(tag)) {
        const runs = []; inlineRuns(ch, { i: false, b: false, href: null }, runs); trimRuns(runs);
        const text = textOf(runs);
        if (!text) continue;
        if (LABEL_RE.test(text)) tokens.push({ type: "label", text });
        else if (/^(preface|chapter index|contents?|table of contents)$/i.test(text)) continue;
        else {
          const prev = tokens[tokens.length - 1];
          if (prev && prev.type === "heading" && /^chapter\s+\d+$/i.test(prev.text)) prev.text += (/^chapter\s+\d+$/i.test(prev.text) ? ": " : " ") + text;
          else tokens.push({ type: "heading", text, lastLine: POS });
        }
        continue;
      }
      if (tag === "hr") { tokens.push({ type: "scene", text: "* * *" }); continue; }
      const sub = { quote: ctx.quote || tag === "blockquote", center: ctx.center || isCentered(ch) };
      if (tag === "p" || tag === "li" || tag === "pre" || tag === "dt" || tag === "dd" || !hasBlockChild(ch)) {
        emitInline([ch], tokens, sub, sub.center);
      } else walk(ch, sub, tokens, skipFn);
    }
    flush();
  }

  async function convert(arrayBuffer, opts) {
    opts = opts || {};
    const JSZip = opts.JSZip || root.JSZip;
    const PC = root.PdfConvert || (typeof require !== "undefined" ? require("./pdf-convert.js") : null);
    if (!PC) throw new Error("pdf-convert.js not loaded");
    const html = decodeText(arrayBuffer);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const body = doc.body;
    if (!body || !body.textContent.trim()) throw new Error("NO_TEXT");

    // --- tabela de tags do AO3 (dl.tags) e link da obra
    const frontLines = [];
    const tagsDl = doc.querySelector("dl.tags");
    if (tagsDl) {
      const dts = Array.from(tagsDl.querySelectorAll("dt"));
      for (const dt of dts) {
        let dd = dt.nextElementSibling;
        while (dd && dd.tagName.toLowerCase() !== "dd") dd = dd.nextElementSibling;
        const label = dt.textContent.replace(/:\s*$/, "").trim();
        const value = dd ? dd.textContent.replace(/\s+/g, " ").trim() : "";
        if (label) frontLines.push({ text: label + ": " + value, x0: 0 });
      }
    }
    const link = Array.from(doc.querySelectorAll("a[href]")).map((a) => a.getAttribute("href")).find((h) => /archiveofourown\.org\/works\/\d+/i.test(h));
    if (link) frontLines.unshift({ text: link, x0: 0 });

    // "Preface"/"Chapter Index" (h2.toc-heading) são títulos escondidos só para o
    // sumário do AO3; se entrarem, viram "Preface Nome da Fic" no título.
    const skip = (el) => (tagsDl && el === tagsDl) || (el.matches && el.matches("p.message, .message, .toc-heading, [hidden], [style*='display:none'], [style*='display: none']"));
    const tokens = [];
    walk(body, { quote: false, center: false }, tokens, skip);

    const book = PC.buildBook(tokens, frontLines, { html: true });
    const dtitle = (doc.title || "").trim();
    if (!book.title) {
      const mb = doc.querySelector(".message b");
      book.title = (mb && mb.textContent.trim()) || dtitle;
    }
    if (!book.author) { const m = doc.querySelector('meta[name="author"]'); if (m) book.author = (m.getAttribute("content") || "").trim(); }
    if (!book.chapters.length) throw new Error("NO_TEXT");
    const fileTitle = (opts.fileName || "").replace(/\.x?html?$/i, "").replace(/_+/g, " ");
    const res = await PC.buildEpub(book, JSZip, fileTitle);
    res.book = book;
    return res;
  }

  const api = { convert };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HtmlConvert = api;
})(typeof window !== "undefined" ? window : globalThis);
