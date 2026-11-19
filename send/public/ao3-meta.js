"use strict";
/*
 * Coloca pairings, tags e contagem de palavras dentro da DESCRIÇÃO do livro
 * (dc:description). É o campo que o Kobo mostra na tela de detalhes, então é o
 * jeito de fazer essas informações aparecerem lá junto com a sinopse.
 * Idempotente: um bloco já inserido é substituído, não duplicado.
 */
(function (root) {
  const MARK = "s2k-meta";

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // info: { summary: "texto", pairings: [], tags: [], words: "9677" }
  // Devolve HTML simples (o Kobo renderiza <p>, <b>, <br>).
  function buildDescription(info) {
    const out = [];
    const sum = (info.summary || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
    for (const p of sum) out.push("<p>" + esc(p) + "</p>");
    const bits = [];
    if (info.pairings && info.pairings.length) bits.push("<b>Pairings:</b> " + esc(info.pairings.join(", ")));
    if (info.words) bits.push("<b>Words:</b> " + esc(Number(String(info.words).replace(/\D/g, "")).toLocaleString("en-US")));
    if (info.tags && info.tags.length) bits.push("<b>Tags:</b> " + esc(info.tags.join(", ")));
    if (bits.length) out.push('<p class="' + MARK + '">' + bits.join("<br/>") + "</p>");
    return out.join("");
  }

  const OPF_NS = "http://www.idpf.org/2007/opf";
  const DC_NS = "http://purl.org/dc/elements/1.1/";

  function readInfo(opf) {
    const metaAll = Array.from(opf.getElementsByTagNameNS(OPF_NS, "meta"));
    const named = (n) => metaAll.filter((m) => m.getAttribute("name") === n).map((m) => m.getAttribute("content")).filter(Boolean);
    const rel = named("ao3:relationship");
    const words = named("ao3:words")[0];
    const tags = Array.from(opf.getElementsByTagNameNS(DC_NS, "subject")).map((e) => e.textContent.trim()).filter(Boolean);
    const isAo3 = !!(rel.length || words || named("ao3:source_url").length || named("ao3:fandom").length);
    return { isAo3, pairings: rel, words, tags };
  }

  // Recebe os bytes de um EPUB; devolve os bytes novos, ou null se não for do
  // AO3 / não houver nada a acrescentar / algo falhar (aí o arquivo segue igual).
  async function enrichEpub(bytes, JSZip) {
    try {
      const zip = await JSZip.loadAsync(bytes);
      const container = await zip.file("META-INF/container.xml").async("string");
      const opfPath = /full-path="([^"]+)"/.exec(container)[1];
      const opfText = await zip.file(opfPath).async("string");
      const doc = new DOMParser().parseFromString(opfText, "application/xml");
      if (doc.getElementsByTagName("parsererror").length) return null;
      const info = readInfo(doc);
      if (!info.isAo3 || !(info.pairings.length || info.words || info.tags.length)) return null;

      let desc = doc.getElementsByTagNameNS(DC_NS, "description")[0];
      let current = "";
      if (desc) current = desc.textContent;
      // sinopse original, sem um bloco nosso de antes
      const cut = current.indexOf('<p class="' + MARK + '"');
      if (cut >= 0) current = current.slice(0, cut);
      let summary = current;
      if (/<p[\s>]/i.test(current)) {
        summary = current.replace(/<\/p>\s*/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      }
      const html = buildDescription({ summary, pairings: info.pairings, tags: info.tags, words: info.words });

      if (!desc) {
        desc = doc.createElementNS(DC_NS, "dc:description");
        const md = doc.getElementsByTagNameNS(OPF_NS, "metadata")[0];
        md.appendChild(desc);
      }
      desc.textContent = html;
      const mt = zip.file("mimetype");
      if (mt) zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
      zip.file(opfPath, new XMLSerializer().serializeToString(doc));
      return await zip.generateAsync({ type: "uint8array", mimeType: "application/epub+zip", compression: "DEFLATE" });
    } catch (e) {
      return null;
    }
  }

  const api = { buildDescription, enrichEpub, MARK };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Ao3Meta = api;
})(typeof window !== "undefined" ? window : globalThis);
