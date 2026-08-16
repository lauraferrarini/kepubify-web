"use strict";

// Reuses `queue`, `nextId`, `renderQueue`, `updateButtons`, `wasmReady`,
// `baseName` and `escapeHtml` declared in app.js (same page, classic
// scripts share the global lexical scope, loaded in order after app.js).

const OPF_NS = "http://www.idpf.org/2007/opf";
const DC_NS = "http://purl.org/dc/elements/1.1/";

const editDropzone = document.getElementById("edit-dropzone");
const editFileInput = document.getElementById("edit-file-input");
const editMetaList = document.getElementById("edit-meta-list");
const editEmptyHint = document.getElementById("edit-empty-hint");
const editDownloadAllBtn = document.getElementById("edit-download-all");
const editSendDeviceBtn = document.getElementById("edit-send-device");

/** @type {{id:number, file:File, status:string, error?:string, parsed?:object, convertToKobo:boolean}[]} */
const metaQueue = [];
let metaNextId = 1;


// ---- intake -----------------------------------------------------------

editDropzone.addEventListener("click", () => editFileInput.click());
editDropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    editFileInput.click();
  }
});
editFileInput.addEventListener("change", (e) => {
  addEditFiles(e.target.files);
  editFileInput.value = "";
});
["dragenter", "dragover"].forEach((evt) =>
  editDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    editDropzone.classList.add("drag-over");
  })
);
["dragleave", "drop"].forEach((evt) =>
  editDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    editDropzone.classList.remove("drag-over");
  })
);
editDropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer?.files?.length) addEditFiles(e.dataTransfer.files);
});

function addEditFiles(fileListLike) {
  const all = Array.from(fileListLike);
  const files = all.filter((f) => f.name.toLowerCase().endsWith(".epub"));
  for (const file of files) {
    metaQueue.push({ id: metaNextId++, file, status: "loading", convertToKobo: true });
  }
  if (all.length && !files.length) {
    editEmptyHint.textContent = `${all.length} arquivo(s) selecionado(s), mas nenhum termina em ".epub" — nome recebido: ${all.map((f) => f.name).join(", ")}`;
  } else {
    editEmptyHint.textContent = "Nenhum livro carregado ainda.";
  }
  renderMetaList();
  for (const item of metaQueue.filter((q) => q.status === "loading")) {
    loadMetadata(item);
  }
}

// ---- EPUB parsing -------------------------------------------------------

async function loadMetadata(item) {
  try {
    const zip = await JSZip.loadAsync(item.file);

    const containerXml = await zip.file("META-INF/container.xml").async("string");
    const containerDoc = new DOMParser().parseFromString(containerXml, "application/xml");
    const rootfile = containerDoc.getElementsByTagName("rootfile")[0];
    const opfPath = rootfile.getAttribute("full-path");
    const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

    const opfText = await zip.file(opfPath).async("string");
    const opfDoc = new DOMParser().parseFromString(opfText, "application/xml");

    const titleEl = opfDoc.getElementsByTagNameNS(DC_NS, "title")[0];
    const creatorEls = Array.from(opfDoc.getElementsByTagNameNS(DC_NS, "creator"));

    const coverHref = findCoverHref(opfDoc);
    const coverPath = coverHref ? resolvePath(opfDir, coverHref) : null;
    const coverFile = coverPath ? zip.file(coverPath) : null;

    let coverUrl = null;
    if (coverFile) {
      const blob = await coverFile.async("blob");
      coverUrl = URL.createObjectURL(blob);
    }

    item.parsed = {
      zip, opfPath, opfDir, opfDoc, titleEl, creatorEls, coverPath, coverUrl,
      title: titleEl ? titleEl.textContent : "",
      author: creatorEls.map((e) => e.textContent).join(", "),
    };
    item.status = "ready";
  } catch (err) {
    console.error(err);
    item.status = "error";
    item.error = "não consegui ler este epub: " + (err.message || err);
  }
  renderMetaList();
  updateEditButtons();
}

function findCoverHref(opfDoc) {
  const items = Array.from(opfDoc.getElementsByTagNameNS(OPF_NS, "item"));
  let item = items.find((it) => (it.getAttribute("properties") || "").split(/\s+/).includes("cover-image"));
  if (item) return item.getAttribute("href");

  const metas = Array.from(opfDoc.getElementsByTagNameNS(OPF_NS, "meta"));
  const coverMeta = metas.find((m) => m.getAttribute("name") === "cover");
  if (coverMeta) {
    const id = coverMeta.getAttribute("content");
    item = items.find((it) => it.getAttribute("id") === id);
    if (item) return item.getAttribute("href");
  }
  item = items.find((it) => /cover/i.test(it.getAttribute("id") || "") || /cover/i.test(it.getAttribute("href") || ""));
  return item ? item.getAttribute("href") : null;
}

function resolvePath(baseDir, href) {
  const stack = baseDir.split("/").filter(Boolean);
  for (const seg of href.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return stack.join("/");
}

// ---- rendering ----------------------------------------------------------

function renderMetaList() {
  editMetaList.innerHTML = "";
  editEmptyHint.style.display = metaQueue.length ? "none" : "";

  for (const item of metaQueue) {
    const li = document.createElement("li");
    li.className = "meta-card";
    li.dataset.id = String(item.id);

    if (item.status === "loading") {
      li.innerHTML = `<div class="meta-card-head"><span class="file-name">${escapeHtml(item.file.name)}</span><span class="file-status">lendo…</span></div>`;
    } else if (item.status === "error") {
      li.innerHTML = `<div class="meta-card-head"><span class="file-name">${escapeHtml(item.file.name)}</span><span class="file-status error">${escapeHtml(item.error)}</span></div>`;
    } else {
      const p = item.parsed;
      li.innerHTML = `
        <div class="meta-card-head">
          <span class="file-name">${escapeHtml(item.file.name)}</span>
          <label class="device-toggle">
            <input type="checkbox" class="kobo-toggle-edit" ${item.convertToKobo ? "checked" : ""}>
            converter pra Kobo
          </label>
        </div>
        <div class="meta-card-body">
          <div class="cover-preview">
            ${p.newCoverUrl || p.coverUrl ? `<img src="${p.newCoverUrl || p.coverUrl}" alt="Capa de ${escapeHtml(p.title)}">` : `<div class="cover-placeholder">sem capa</div>`}
            <label class="btn btn-ghost btn-small">
              Trocar capa
              <input type="file" accept="image/*" class="cover-input" hidden>
            </label>
          </div>
          <div class="meta-fields">
            <label class="field">
              <span>Título</span>
              <input type="text" class="title-input" value="${escapeHtml(p.editedTitle ?? p.title)}">
            </label>
            <label class="field">
              <span>Autor(a)</span>
              <input type="text" class="author-input" value="${escapeHtml(p.editedAuthor ?? p.author)}">
            </label>
          </div>
        </div>
      `;

      li.querySelector(".kobo-toggle-edit").addEventListener("change", (e) => {
        item.convertToKobo = e.target.checked;
      });

      const coverInput = li.querySelector(".cover-input");
      coverInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        p.newCoverFile = file;
        p.newCoverUrl = URL.createObjectURL(file);
        li.querySelector(".cover-preview img, .cover-preview .cover-placeholder")?.replaceWith(
          Object.assign(document.createElement("img"), { src: p.newCoverUrl, alt: "Nova capa" })
        );
      });

      li.querySelector(".title-input").addEventListener("input", (e) => (p.editedTitle = e.target.value));
      li.querySelector(".author-input").addEventListener("input", (e) => (p.editedAuthor = e.target.value));
    }

    editMetaList.appendChild(li);
  }

  updateEditButtons();
}

function updateEditButtons() {
  const hasReady = metaQueue.some((q) => q.status === "ready");
  editDownloadAllBtn.disabled = !hasReady;
  editSendDeviceBtn.disabled = !hasReady;
}

// ---- apply edits, produce output bytes for each ready item ---------------

async function applyEditsAndBuild(item) {
  const p = item.parsed;
  const newTitle = p.editedTitle ?? p.title;
  const newAuthor = p.editedAuthor ?? p.author;

  if (p.titleEl) p.titleEl.textContent = newTitle;
  for (const el of p.creatorEls) el.remove();
  const metadataEl = p.opfDoc.getElementsByTagNameNS(OPF_NS, "metadata")[0];
  if (metadataEl && newAuthor.trim()) {
    const newCreator = p.opfDoc.createElementNS(DC_NS, "dc:creator");
    newCreator.textContent = newAuthor.trim();
    metadataEl.appendChild(newCreator);
  }
  p.zip.file(p.opfPath, new XMLSerializer().serializeToString(p.opfDoc));

  if (p.newCoverFile && p.coverPath) {
    const bytes = new Uint8Array(await p.newCoverFile.arrayBuffer());
    p.zip.file(p.coverPath, bytes);
    const items = Array.from(p.opfDoc.getElementsByTagNameNS(OPF_NS, "item"));
    const coverItem = items.find((it) => resolvePath(p.opfDir, it.getAttribute("href")) === p.coverPath);
    if (coverItem) {
      coverItem.setAttribute("media-type", p.newCoverFile.type || coverItem.getAttribute("media-type"));
      p.zip.file(p.opfPath, new XMLSerializer().serializeToString(p.opfDoc));
    }
  }

  const editedBytes = await p.zip.generateAsync({ type: "uint8array" });
  const baseOutName = item.file.name.replace(/\.epub$/i, "");

  if (item.convertToKobo) {
    if (!wasmReady) throw new Error("conversor ainda não carregou");
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const result = window.kepubifyConvert(editedBytes);
    if (!result.ok) throw new Error(result.error);
    const outBytes = new Uint8Array(result.data.length);
    outBytes.set(result.data);
    return {
      name: baseOutName + ".kepub.epub",
      blob: new Blob([outBytes], { type: "application/epub+zip" }),
      converted: true,
    };
  }

  return {
    name: baseOutName + ".epub",
    blob: new Blob([editedBytes], { type: "application/epub+zip" }),
    converted: false,
  };
}

async function buildAllOutputs() {
  const ready = metaQueue.filter((q) => q.status === "ready");
  const outputs = [];
  for (const item of ready) {
    try {
      outputs.push(await applyEditsAndBuild(item));
    } catch (err) {
      console.error(err);
      item.status = "error";
      item.error = "falha ao processar: " + (err.message || err);
    }
  }
  renderMetaList();
  return outputs;
}

// ---- bottom actions -------------------------------------------------------

editDownloadAllBtn.addEventListener("click", async () => {
  editDownloadAllBtn.disabled = true;
  editDownloadAllBtn.textContent = "processando…";
  try {
    const outputs = await buildAllOutputs();
    if (!outputs.length) return;

    if (outputs.length === 1) {
      const url = URL.createObjectURL(outputs[0].blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = outputs[0].name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } else {
      const zip = new JSZip();
      for (const out of outputs) zip.file(out.name, out.blob);
      const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "livros-editados.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  } finally {
    editDownloadAllBtn.textContent = "Baixar arquivos";
    updateEditButtons();
  }
});

editSendDeviceBtn.addEventListener("click", async () => {
  editSendDeviceBtn.disabled = true;
  editSendDeviceBtn.textContent = "preparando…";
  try {
    const outputs = await buildAllOutputs();
    if (!outputs.length) return;

    for (const out of outputs) {
      queue.push({
        id: nextId++,
        file: new File([out.blob], out.name, { type: out.blob.type }),
        isEpub: false,
        convertToKobo: false,
        status: "ready",
        outBlob: out.blob,
        outName: out.name,
        fromEdit: true,
        wasConverted: out.converted,
      });
    }
    renderQueue();
    window.activateSendTab();
    document.getElementById("send-all")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } finally {
    editSendDeviceBtn.textContent = "Enviar para dispositivo";
    updateEditButtons();
  }
});
