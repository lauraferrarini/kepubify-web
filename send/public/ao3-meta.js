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

  // EPUBs baixados direto do AO3 (feitos pelo Calibre) não têm os metadados
  // "ao3:*"; as tags ficam na página de abertura do livro (tabela dl.tags).
  async function infoFromPreface(zip) {
    const names = Object.keys(zip.files).filter((n) => /\.x?html?$/i.test(n) && !zip.files[n].dir).sort().slice(0, 8);
    for (const n of names) {
      const text = await zip.file(n).async("string");
      if (!/<dl[^>]*class="[^"]*\btags\b/i.test(text)) continue;
      const doc = new DOMParser().parseFromString(text, "text/html");
      const dl = doc.querySelector("dl.tags");
      if (!dl) continue;
      const rows = {};
      for (const dt of Array.from(dl.querySelectorAll("dt"))) {
        let dd = dt.nextElementSibling;
        while (dd && dd.tagName.toLowerCase() !== "dd") dd = dd.nextElementSibling;
        if (!dd) continue;
        const label = dt.textContent.replace(/:\s*$/, "").trim().toLowerCase();
        const links = Array.from(dd.querySelectorAll("a")).map((a) => a.textContent.trim()).filter(Boolean);
        rows[label] = { links, text: dd.textContent.replace(/\s+/g, " ").trim() };
      }
      const pick = (...keys) => { for (const k of keys) if (rows[k]) return rows[k]; return null; };
      const rel = pick("relationships", "relationship");
      const add = pick("additional tags");
      const stats = pick("stats");
      const w = stats && /Words:\s*([\d,.]+)/.exec(stats.text);
      return {
        pairings: rel ? (rel.links.length ? rel.links : rel.text.split(/,\s+/)) : [],
        tags: add ? (add.links.length ? add.links : add.text.split(/,\s+/)) : [],
        words: w ? w[1].replace(/\D/g, "") : "",
      };
    }
    return null;
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
      if (!info.pairings.length || !info.words || !info.tags.length) {
        const pre = await infoFromPreface(zip);
        if (pre) {
          info.isAo3 = true;
          if (!info.pairings.length) info.pairings = pre.pairings;
          if (!info.words) info.words = pre.words;
          // nos EPUBs do Calibre os dc:subject misturam fandom/personagens/tags; a tabela é mais fiel
          if (pre.tags.length) info.tags = pre.tags;
        }
      }
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
