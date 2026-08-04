"use strict";

const OPF_NS = "http://www.idpf.org/2007/opf";
const DC_NS = "http://purl.org/dc/elements/1.1/";

const metaDropzone = document.getElementById("meta-dropzone");
const metaFileInput = document.getElementById("meta-file-input");
const metaList = document.getElementById("meta-list");
const metaEmptyHint = document.getElementById("meta-empty-hint");

/** @type {{id:number, file:File, status:string, error?:string, parsed?:object}[]} */
const metaQueue = [];
let metaNextId = 1;

// ---- intake ---------------------------------------------------------------

metaDropzone.addEventListener("click", () => metaFileInput.click());
metaDropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    metaFileInput.click();
  }
});
metaFileInput.addEventListener("change", (e) => {
  addMetaFiles(e.target.files);
  metaFileInput.value = "";
});
["dragenter", "dragover"].forEach((evt) =>
  metaDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    metaDropzone.classList.add("drag-over");
  })
);
["dragleave", "drop"].forEach((evt) =>
  metaDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    metaDropzone.classList.remove("drag-over");
  })
);
metaDropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer?.files?.length) addMetaFiles(e.dataTransfer.files);
});

function addMetaFiles(fileListLike) {
  const all = Array.from(fileListLike);
  const files = all.filter((f) => f.name.toLowerCase().endsWith(".epub"));
  for (const file of files) {
    metaQueue.push({ id: metaNextId++, file, status: "loading" });
  }
  if (all.length && !files.length) {
    metaEmptyHint.textContent = `${all.length} arquivo(s) selecionado(s), mas nenhum termina em ".epub" — nome recebido: ${all.map((f) => f.name).join(", ")}`;
  } else {
    metaEmptyHint.textContent = "Nenhum livro carregado ainda.";
  }
  renderMetaList();
  for (const item of metaQueue.filter((q) => q.status === "loading")) {
    loadMetadata(item);
  }
}

// ---- EPUB parsing -----------------------------------------------------------

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
      zip,
      opfPath,
      opfDir,
      opfDoc,
      titleEl,
      creatorEls,
      coverPath,
      coverUrl,
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
}

function findCoverHref(opfDoc) {
  // EPUB3: manifest item with properties="cover-image"
  const items = Array.from(opfDoc.getElementsByTagNameNS(OPF_NS, "item"));
  let item = items.find((it) => (it.getAttribute("properties") || "").split(/\s+/).includes("cover-image"));
  if (item) return item.getAttribute("href");

  // EPUB2: <meta name="cover" content="ID"/> -> manifest item id=ID
  const metas = Array.from(opfDoc.getElementsByTagNameNS(OPF_NS, "meta"));
  const coverMeta = metas.find((m) => m.getAttribute("name") === "cover");
  if (coverMeta) {
    const id = coverMeta.getAttribute("content");
    item = items.find((it) => it.getAttribute("id") === id);
    if (item) return item.getAttribute("href");
  }

  // fallback: item whose id or href mentions "cover"
  item = items.find((it) => /cover/i.test(it.getAttribute("id") || "") || /cover/i.test(it.getAttribute("href") || ""));
  return item ? item.getAttribute("href") : null;
}

function resolvePath(baseDir, href) {
  // href may include ../ segments; resolve against baseDir manually.
  const stack = baseDir.split("/").filter(Boolean);
  for (const seg of href.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return stack.join("/");
}

// ---- rendering --------------------------------------------------------------

function renderMetaList() {
  metaList.innerHTML = "";
  metaEmptyHint.style.display = metaQueue.length ? "none" : "";

  for (const item of metaQueue) {
    const li = document.createElement("li");
    li.className = "meta-card";
    li.dataset.id = String(item.id);

    if (item.status === "loading") {
      li.innerHTML = `<div class="meta-card-head"><span class="file-name">${escapeHtmlM(item.file.name)}</span><span class="file-status">lendo…</span></div>`;
    } else if (item.status === "error") {
      li.innerHTML = `<div class="meta-card-head"><span class="file-name">${escapeHtmlM(item.file.name)}</span><span class="file-status error">${escapeHtmlM(item.error)}</span></div>`;
    } else {
      const p = item.parsed;
      li.innerHTML = `
        <div class="meta-card-head">
          <span class="file-name">${escapeHtmlM(item.file.name)}</span>
          <span class="file-status ${item.status === "done" ? "done" : ""}">${item.status === "converting" ? "convertendo…" : item.status === "done" ? "convertido ✓" : ""}</span>
        </div>
        <div class="meta-card-body">
          <div class="cover-preview">
            ${p.newCoverUrl || p.coverUrl ? `<img src="${p.newCoverUrl || p.coverUrl}" alt="Capa de ${escapeHtmlM(p.title)}">` : `<div class="cover-placeholder">sem capa</div>`}
            <label class="btn btn-ghost btn-small">
              Trocar capa
              <input type="file" accept="image/*" class="cover-input" hidden>
            </label>
          </div>
          <div class="meta-fields">
            <label class="field">
              <span>Título</span>
              <input type="text" class="title-input" value="${escapeHtmlM(p.editedTitle ?? p.title)}">
            </label>
            <label class="field">
              <span>Autor(a)</span>
              <input type="text" class="author-input" value="${escapeHtmlM(p.editedAuthor ?? p.author)}">
            </label>
            <button class="btn btn-accent convert-btn" ${!window.kepubifyReady ? "disabled" : ""}>Converter para KEPUB</button>
          </div>
        </div>
      `;

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
      li.querySelector(".convert-btn").addEventListener("click", () => convertWithMetadata(item, li));
    }

    metaList.appendChild(li);
  }
}

function escapeHtmlM(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---- apply edits + convert --------------------------------------------------

async function convertWithMetadata(item, li) {
  const p = item.parsed;
  item.status = "converting";
  renderMetaList();

  try {
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

    const newOpfXml = new XMLSerializer().serializeToString(p.opfDoc);
    p.zip.file(p.opfPath, newOpfXml);

    if (p.newCoverFile && p.coverPath) {
      const bytes = new Uint8Array(await p.newCoverFile.arrayBuffer());
      p.zip.file(p.coverPath, bytes);
      // update declared media-type so readers trust the actual bytes
      const items = Array.from(p.opfDoc.getElementsByTagNameNS(OPF_NS, "item"));
      const coverItem = items.find((it) => resolvePath(p.opfDir, it.getAttribute("href")) === p.coverPath);
      if (coverItem) {
        coverItem.setAttribute("media-type", p.newCoverFile.type || coverItem.getAttribute("media-type"));
        p.zip.file(p.opfPath, new XMLSerializer().serializeToString(p.opfDoc));
      }
    }

    const editedBytes = await p.zip.generateAsync({ type: "uint8array" });

    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

    const result = window.kepubifyConvert(editedBytes);
    if (!result.ok) throw new Error(result.error);

    const outBytes = new Uint8Array(result.data.length);
    outBytes.set(result.data);
    const blob = new Blob([outBytes], { type: "application/epub+zip" });
    const outName = item.file.name.replace(/\.epub$/i, "") + ".kepub.epub";

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = outName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    item.status = "done";
  } catch (err) {
    console.error(err);
    item.status = "error";
    item.error = "falha ao converter: " + (err.message || err);
  }
  renderMetaList();
}
