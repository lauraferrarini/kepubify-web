"use strict";
/*
 * Tira os parágrafos vazios que alguns EPUBs (ex.: de fics do AO3) colocam
 * entre TODOS os parágrafos de texto. Somados à margem normal de cada
 * parágrafo, eles dobram o espaço entre as linhas. Só mexe quando esse padrão
 * é claro (muitos vazios entre parágrafos); o texto em si nunca é alterado.
 *   - 1 parágrafo vazio entre dois parágrafos de texto -> removido
 *   - 2 ou mais seguidos (pausa de cena de propósito)    -> fica só 1
 *   - em qualquer outra posição (início, depois de título…) -> intacto
 */
(function (root) {
  const BLANK = "<p\\b[^>]*>(?:\\s|&nbsp;|&#160;|&#xA0;|\\u00a0|<br\\s*\\/?>)*<\\/p>|<p\\b[^>]*\\/>";
  const RUN_RE = new RegExp("(?:(?:" + BLANK + ")\\s*)+", "gi");
  const BLANK_ONE_RE = new RegExp(BLANK, "gi");
  const TEXT_P_RE = /<p\b[^>]*>/gi;

  function stats(html) {
    const total = (html.match(TEXT_P_RE) || []).length;
    let between = 0;
    html.replace(RUN_RE, (m, off) => {
      const before = html.slice(0, off).trimEnd();
      const after = html.slice(off + m.length).trimStart();
      if (/<\/p>$/i.test(before) && /^<p\b/i.test(after)) between += 1;
      return m;
    });
    return { total, between };
  }

  function tidyHtml(html) {
    let removed = 0;
    const out = html.replace(RUN_RE, (m, off, whole) => {
      const before = whole.slice(0, off).trimEnd();
      const after = whole.slice(off + m.length).trimStart();
      if (!(/<\/p>$/i.test(before) && /^<p\b/i.test(after))) return m;
      const n = (m.match(BLANK_ONE_RE) || []).length;
      if (n === 1) { removed += 1; return ""; }
      removed += n - 1;
      return (m.match(BLANK_ONE_RE) || [""])[0] + "\n";
    });
    return { html: out, removed };
  }

  // Devolve { data, removed } com o EPUB ajustado, ou null se não houver o que ajustar.
  async function tidyEpub(bytes, JSZip) {
    try {
      const zip = await JSZip.loadAsync(bytes);
      const names = Object.keys(zip.files).filter((n) => /\.(x?html?)$/i.test(n) && !zip.files[n].dir);
      const texts = {};
      let total = 0, between = 0;
      for (const n of names) {
        const t = await zip.file(n).async("string");
        texts[n] = t;
        const s = stats(t);
        total += s.total; between += s.between;
      }
      // padrão claro: pelo menos 1 vazio a cada 4 parágrafos, e não é coisa isolada
      if (between < 10 || total === 0 || between / total < 0.25) return null;
      let removed = 0;
      for (const n of names) {
        const r = tidyHtml(texts[n]);
        if (r.removed) { zip.file(n, r.html); removed += r.removed; }
      }
      if (!removed) return null;
      if (zip.file("mimetype")) zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
      const data = await zip.generateAsync({ type: "uint8array", mimeType: "application/epub+zip", compression: "DEFLATE" });
      return { data, removed };
    } catch (e) {
      return null;
    }
  }

  const api = { tidyEpub, tidyHtml, stats };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TidyEpub = api;
})(typeof window !== "undefined" ? window : globalThis);
