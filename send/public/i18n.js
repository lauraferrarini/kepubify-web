"use strict";

const I18N = {
  en: {
    "page.title": "send2kobo — send several books to your e-reader at once",
    "page.description": "Convert and send several EPUBs/PDFs at once to your Kobo (or other e-reader), no cable, by typing a short key in the device's browser.",
    "eyebrow": "cable-free sending · expires in 5 minutes",
    "tagline": "Drop several books here, generate a key, and type it into your e-reader's browser — all the files arrive at once.",
    "tab.edit": "Edit",
    "tab.send": "Convert/send",

    "edit.dropTitle": "Drag .epub files here to edit",
    "edit.dropHint": "title, author and cover — then download or send to device",
    "edit.metadataHeading": "Metadata",
    "edit.downloadAll": "Download files",
    "edit.downloadAll.processing": "processing…",
    "edit.sendDevice": "Send to device",
    "edit.sendDevice.preparing": "preparing…",
    "edit.emptyHint": "No books loaded yet.",
    "edit.reading": "reading…",
    "edit.readErrorPrefix": "couldn't read this epub: ",
    "edit.processErrorPrefix": "failed to process: ",
    "edit.coverAltPrefix": "Cover of ",
    "edit.coverPlaceholder": "no cover",
    "edit.changeCover": "Change cover",
    "edit.enhanceCover": "Boost colour",
    "edit.enhanceCoverHint": "More saturation and contrast, to counter the washed-out look of colour e-ink screens",
    "edit.newCoverAlt": "New cover",
    "edit.fieldTitle": "Title",
    "edit.fieldAuthor": "Author",
    "edit.mismatchPrefix": "selected {count} file(s), but none end in \".epub\" — received name(s): {names}",
    "edit.zipName": "edited-books.zip",

    "send.dropTitle": "Drag files here",
    "send.dropHint": "EPUB, PDF, CBZ… you can select several at once",
    "send.wasmLoading": "loading the kepub converter…",
    "send.wasmReady": "converter ready — conversion to Kobo runs locally, in your browser",
    "send.wasmFailedPrefix": "converter unavailable (",
    "send.wasmFailedSuffix": ") — .epub files will be sent unconverted",
    "send.queueHeading": "Send queue",
    "send.download": "Download",
    "send.downloadZipping": "zipping…",
    "send.prepare": "Prepare",
    "send.generateKey": "Generate send key",
    "send.sending": "sending…",
    "send.clear": "Clear",
    "send.emptyHint": "No files in the queue yet.",
    "send.mismatchPrefix": "selected {count} file(s), but none end in \".epub\" — received name(s): {names}",
    "send.rowRemoveAria": "Remove {name} from the queue",
    "send.rowRemoveTitle": "Remove from queue",
    "send.zipName": "books.zip",
    "send.sendErrorPrefix": "failed to send: ",

    "status.pending": "in queue",
    "status.preparing": "preparing…",
    "status.ready": "ready to send",
    "status.error": "error",

    "badge.converted": "converted ✓",
    "badge.notConverted": "not converted",
    "badge.convertToKobo": "convert for Kobo",
    "badge.noConversion": "no conversion",

    "session.heading": "Send key generated",
    "session.hintPart1": "On your Kobo or Kindle's browser, open ",
    "session.hintPart2": " — it recognizes the device automatically and already shows the screen to type the code. Just type this key.",
    "session.countdownPrefix": "expires in ",
    "session.expired": "expired",
    "session.deleteNow": "Delete now",

    "about.heading": "How it works",
    "about.body": `<code>.epub</code> files marked for "Kobo" are converted to <code>.kepub.epub</code> right in your own browser (the same WebAssembly converter from <a href="../">kepubify-web</a>) before anything is sent. Then, the prepared files are uploaded all at once to temporary storage, which generates a short key. When the Kobo/Kindle opens the site's root URL, it already recognizes the device's browser and shows the code-entry screen directly, no menu digging required. Everything is automatically deleted a few minutes later, even if you don't delete it manually.`,

    "footer.body": `Part of <a href="https://github.com/lauraferrarini/kepubify-web" target="_blank" rel="noopener">kepubify-web</a>. Conversion based on <a href="https://github.com/pgaskin/kepubify" target="_blank" rel="noopener">pgaskin/kepubify</a> (MIT).`,
  },

  pt: {
    "page.title": "send2kobo — envie vários livros pro seu e-reader de uma vez",
    "page.description": "Converta e envie vários EPUBs/PDFs de uma vez pro seu Kobo (ou outro e-reader), sem cabo, digitando uma chave curta no navegador do dispositivo.",
    "eyebrow": "envio sem cabo · expira em 5 minutos",
    "tagline": "Solte vários livros aqui, gere uma chave e digite ela no navegador do seu e-reader — todos os arquivos chegam de uma vez.",
    "tab.edit": "Editar",
    "tab.send": "Converter/enviar",

    "edit.dropTitle": "Arraste .epub aqui pra editar",
    "edit.dropHint": "título, autor(a) e capa — depois baixe ou envie pro dispositivo",
    "edit.metadataHeading": "Metadados",
    "edit.downloadAll": "Baixar arquivos",
    "edit.downloadAll.processing": "processando…",
    "edit.sendDevice": "Enviar para dispositivo",
    "edit.sendDevice.preparing": "preparando…",
    "edit.emptyHint": "Nenhum livro carregado ainda.",
    "edit.reading": "lendo…",
    "edit.readErrorPrefix": "não consegui ler este epub: ",
    "edit.processErrorPrefix": "falha ao processar: ",
    "edit.coverAltPrefix": "Capa de ",
    "edit.coverPlaceholder": "sem capa",
    "edit.changeCover": "Trocar capa",
    "edit.enhanceCover": "Realçar cor",
    "edit.enhanceCoverHint": "Mais saturação e contraste, pra compensar o aspecto lavado das telas de e-ink colorido",
    "edit.newCoverAlt": "Nova capa",
    "edit.fieldTitle": "Título",
    "edit.fieldAuthor": "Autor(a)",
    "edit.mismatchPrefix": "{count} arquivo(s) selecionado(s), mas nenhum termina em \".epub\" — nome recebido: {names}",
    "edit.zipName": "livros-editados.zip",

    "send.dropTitle": "Arraste arquivos aqui",
    "send.dropHint": "EPUB, PDF, CBZ… pode selecionar vários de uma vez",
    "send.wasmLoading": "carregando o conversor de kepub…",
    "send.wasmReady": "conversor pronto — a conversão pra Kobo roda localmente, no seu navegador",
    "send.wasmFailedPrefix": "conversor indisponível (",
    "send.wasmFailedSuffix": ") — arquivos .epub serão enviados sem converter",
    "send.queueHeading": "Fila de envio",
    "send.download": "Baixar",
    "send.downloadZipping": "compactando…",
    "send.prepare": "Preparar",
    "send.generateKey": "Gerar chave de envio",
    "send.sending": "enviando…",
    "send.clear": "Limpar",
    "send.emptyHint": "Nenhum arquivo na fila ainda.",
    "send.mismatchPrefix": "{count} arquivo(s) selecionado(s), mas nenhum termina em \".epub\" — nome recebido: {names}",
    "send.rowRemoveAria": "Remover {name} da fila",
    "send.rowRemoveTitle": "Remover da fila",
    "send.zipName": "livros.zip",
    "send.sendErrorPrefix": "falha ao enviar: ",

    "status.pending": "na fila",
    "status.preparing": "preparando…",
    "status.ready": "pronto pra enviar",
    "status.error": "erro",

    "badge.converted": "convertido ✓",
    "badge.notConverted": "não convertido",
    "badge.convertToKobo": "converter pra Kobo",
    "badge.noConversion": "sem conversão",

    "session.heading": "Chave de envio gerada",
    "session.hintPart1": "No navegador do seu Kobo ou Kindle, abra ",
    "session.hintPart2": " — ele reconhece o dispositivo automaticamente e já mostra a tela pra digitar o código. É só digitar essa chave.",
    "session.countdownPrefix": "expira em ",
    "session.expired": "expirado",
    "session.deleteNow": "Apagar agora",

    "about.heading": "Como funciona",
    "about.body": `Arquivos <code>.epub</code> marcados para "Kobo" são convertidos pra <code>.kepub.epub</code> no seu próprio navegador (mesmo conversor WebAssembly do <a href="../">kepubify-web</a>) antes de qualquer envio. Depois, os arquivos preparados sobem de uma vez pra um armazenamento temporário, que gera uma chave curta. Quando o Kobo/Kindle abre a raiz do site, ele já reconhece o navegador do dispositivo e mostra direto a tela de digitar o código, sem precisar navegar por menus. Tudo é apagado automaticamente poucos minutos depois, mesmo que você não apague manualmente.`,

    "footer.body": `Parte do <a href="https://github.com/lauraferrarini/kepubify-web" target="_blank" rel="noopener">kepubify-web</a>. Conversão baseada em <a href="https://github.com/pgaskin/kepubify" target="_blank" rel="noopener">pgaskin/kepubify</a> (MIT).`,
  },
};

let locale = localStorage.getItem("s2k-lang") || "en";

function t(key, vars) {
  let str = (I18N[locale] && I18N[locale][key]) ?? (I18N.en[key] ?? key);
  if (vars) {
    for (const k in vars) str = str.replace(`{${k}}`, vars[k]);
  }
  return str;
}

function applyI18n() {
  document.documentElement.lang = locale === "pt" ? "pt-BR" : "en";

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });

  document.title = t("page.title");
  const descMeta = document.querySelector('meta[name="description"]');
  if (descMeta) descMeta.content = t("page.description");

  document.querySelectorAll(".lang-btn").forEach((el) => {
    el.classList.toggle("active", el.dataset.lang === locale);
  });

  // Re-render any dynamic lists so their generated text picks up the new locale.
  if (typeof renderQueue === "function") renderQueue();
  if (typeof renderMetaList === "function") renderMetaList();
  if (typeof refreshWasmStatus === "function") refreshWasmStatus();
}

function setLocale(loc) {
  if (loc !== "en" && loc !== "pt") return;
  locale = loc;
  localStorage.setItem("s2k-lang", loc);
  applyI18n();
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".lang-btn").forEach((el) => {
    el.addEventListener("click", () => setLocale(el.dataset.lang));
  });
  applyI18n();
});
