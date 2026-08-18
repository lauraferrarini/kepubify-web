"use strict";

// Reuses `queue`, `nextId`, `renderQueue`, `updateButtons`, `wasmReady`,
// `baseName` and `escapeHtml` declared in app.js (same page, classic
// scripts share the global lexical scope, loaded in order after app.js).

const OPF_NS = "http://www.idpf.org/2007/opf";
const DC_NS = "http://purl.org/dc/elements/1.1/";

// Default strength for cover enhancement. Tuned for Kaleido 3 panels (Kobo
// Clara/Libra Colour), where the colour filter array eats saturation and
// compresses the tonal range. Covers render small, so crushed shadow detail
// costs little — hence a heavier hand here than would suit full-page art.
const COVER_PRESET = { saturation: 1.45, contrast: 0.3, sharpen: 0.2 };

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
    editEmptyHint.textContent = t("edit.mismatchPrefix", { count: all.length, names: all.map((f) => f.name).join(", ") });
  } else {
    editEmptyHint.textContent = t("edit.emptyHint");
  }
  renderMetaList();
  for (const item of metaQueue.filter((q) => q.status === "loading")) {
    loadMetadata(item);
  }
}

// ---- cover enhancement ---------------------------------------------------

/**
 * Boosts saturation and contrast, then sharpens luminance only.
 *
 * Pure function over pixel data — no DOM, no canvas — so it can be unit
 * tested in Node and reused elsewhere.
 *
 * Sharpening the luma channel alone (leaving chroma untouched) matches how
 * Kaleido panels work: monochrome resolves at 300 PPI, colour at 150. Sharp
 * edges land on the channel that can actually show them, with no colour
 * fringing.
 *
 * @param {ImageData} src
 * @param {{saturation?:number, contrast?:number, sharpen?:number}} opts
 * @returns {ImageData}
 */
function enhance(src, opts) {
  const o = opts || {};
  const sat = o.saturation != null ? o.saturation : COVER_PRESET.saturation;
  const con = o.contrast != null ? o.contrast : COVER_PRESET.contrast;
  const sharp = o.sharpen != null ? o.sharpen : COVER_PRESET.sharpen;

  const w = src.width;
  const h = src.height;
  const n = w * h;
  const d = new Uint8ClampedArray(src.data);

  // Pass 1 — saturate around luma, then an S-curve that steepens midtones
  // while leaving both endpoints fixed (so nothing clips to black or white).
  const luma = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

    for (let c = 0; c < 3; c++) {
      let v = L + (d[i + c] - L) * sat;
      const t = v / 255 - 0.5;
      d[i + c] = (0.5 + t * (1 + con * (1 - 4 * t * t))) * 255;
    }

    luma[p] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  }

  // Pass 2 — unsharp mask on luma, applied back as a per-pixel gain so hue
  // and saturation survive untouched.
  if (sharp > 0) {
    const blur = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            sum += luma[yy * w + xx];
            count++;
          }
        }
        blur[y * w + x] = sum / count;
      }
    }
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const L = luma[p];
      if (L < 1) continue;

      let gain = (L + sharp * (L - blur[p])) / L;

      // Cap the gain at whatever the brightest channel can absorb. Without
      // this, a bright saturated pixel clips its strongest channel at 255
      // while the others keep climbing, which shifts the hue — the sharpener
      // would quietly recolour the image.
      const peak = Math.max(d[i], d[i + 1], d[i + 2]);
      if (peak > 0 && gain * peak > 255) gain = 255 / peak;

      d[i] *= gain;
      d[i + 1] *= gain;
      d[i + 2] *= gain;
    }
  }

  return new ImageData(d, w, h);
}

/** True if any pixel is not fully opaque. */
function hasTransparency(imageData) {
  const d = imageData.data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 255) return true;
  }
  return false;
}

/**
 * Runs an image blob through `enhance` and re-encodes it.
 *
 * Transparent images stay PNG — flattening them to JPEG would paint the
 * transparent areas black. Everything else becomes JPEG, which keeps the
 * file from ballooning after the re-encode.
 *
 * @param {Blob} blob
 * @param {object} [opts]
 * @returns {Promise<Blob>}
 */
async function enhanceCover(blob, opts) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const keepPng = hasTransparency(src);
  ctx.putImageData(enhance(src, opts), 0, 0);

  const out = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))),
      keepPng ? "image/png" : "image/jpeg",
      keepPng ? undefined : 0.9
    );
  });

  canvas.width = canvas.height = 0; // release the backing store early
  return out;
}

/** The cover a book will ship with, before enhancement: replacement or original. */
function sourceCoverBlob(p) {
  return p.newCoverFile || p.coverBlob || null;
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
    let coverBlob = null;
    if (coverFile) {
      coverBlob = await coverFile.async("blob");
      coverUrl = URL.createObjectURL(coverBlob);
    }

    item.parsed = {
      zip, opfPath, opfDir, opfDoc, titleEl, creatorEls, coverPath, coverUrl, coverBlob,
      enhanceCover: false,
      title: titleEl ? titleEl.textContent : "",
      author: creatorEls.map((e) => e.textContent).join(", "),
    };
    item.status = "ready";
  } catch (err) {
    console.error(err);
    item.status = "error";
    item.error = t("edit.readErrorPrefix") + (err.message || err);
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
      li.innerHTML = `<div class="meta-card-head"><span class="file-name">${escapeHtml(item.file.name)}</span><span class="file-status">${t("edit.reading")}</span></div>`;
    } else if (item.status === "error") {
      li.innerHTML = `<div class="meta-card-head"><span class="file-name">${escapeHtml(item.file.name)}</span><span class="file-status error">${escapeHtml(item.error)}</span></div>`;
    } else {
      const p = item.parsed;
      li.innerHTML = `
        <div class="meta-card-head">
          <span class="file-name">${escapeHtml(item.file.name)}</span>
          <label class="device-toggle">
            <input type="checkbox" class="kobo-toggle-edit" ${item.convertToKobo ? "checked" : ""}>
            ${t("badge.convertToKobo")}
          </label>
        </div>
        <div class="meta-card-body">
          <div class="cover-preview">
            ${p.newCoverUrl || p.coverUrl ? `<img src="${p.newCoverUrl || p.coverUrl}" alt="${escapeHtml(t("edit.coverAltPrefix") + p.title)}">` : `<div class="cover-placeholder">${t("edit.coverPlaceholder")}</div>`}
            <label class="btn btn-ghost btn-small">
              ${t("edit.changeCover")}
              <input type="file" accept="image/*" class="cover-input" hidden>
            </label>
            <label class="enhance-toggle" title="${escapeHtml(t("edit.enhanceCoverHint"))}">
              <input type="checkbox" class="enhance-input" ${p.enhanceCover ? "checked" : ""}>
              ${t("edit.enhanceCover")}
            </label>
          </div>
          <div class="meta-fields">
            <label class="field">
              <span>${t("edit.fieldTitle")}</span>
              <input type="text" class="title-input" value="${escapeHtml(p.editedTitle ?? p.title)}">
            </label>
            <label class="field">
              <span>${t("edit.fieldAuthor")}</span>
              <input type="text" class="author-input" value="${escapeHtml(p.editedAuthor ?? p.author)}">
            </label>
          </div>
        </div>
      `;

      li.querySelector(".kobo-toggle-edit").addEventListener("change", (e) => {
        item.convertToKobo = e.target.checked;
      });

      const refreshCoverPreview = async () => {
        const source = sourceCoverBlob(p);
        if (!source) return;

        if (p.previewUrl) {
          URL.revokeObjectURL(p.previewUrl);
          p.previewUrl = null;
        }

        let shown;
        if (p.enhanceCover) {
          try {
            shown = await enhanceCover(source, COVER_PRESET);
          } catch (err) {
            console.error(err);
            shown = source; // fall back to the untouched cover
          }
        } else {
          shown = source;
        }

        p.previewUrl = URL.createObjectURL(shown);
        const current = li.querySelector(".cover-preview img, .cover-preview .cover-placeholder");
        if (current) {
          current.replaceWith(
            Object.assign(document.createElement("img"), {
              src: p.previewUrl,
              alt: t("edit.newCoverAlt"),
            })
          );
        }
      };

      const coverInput = li.querySelector(".cover-input");
      coverInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        p.newCoverFile = file;
        refreshCoverPreview();
      });

      li.querySelector(".enhance-input").addEventListener("change", (e) => {
        p.enhanceCover = e.target.checked;
        refreshCoverPreview();
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

  // Rewrite the cover when it was replaced, enhanced, or both. With
  // enhancement on and no replacement picked, the book's own cover is the
  // source — so the option works on every book, not only re-covered ones.
  const coverSource = sourceCoverBlob(p);
  if (p.coverPath && coverSource && (p.newCoverFile || p.enhanceCover)) {
    const finalBlob = p.enhanceCover ? await enhanceCover(coverSource, COVER_PRESET) : coverSource;
    p.zip.file(p.coverPath, new Uint8Array(await finalBlob.arrayBuffer()));

    const items = Array.from(p.opfDoc.getElementsByTagNameNS(OPF_NS, "item"));
    const coverItem = items.find((it) => resolvePath(p.opfDir, it.getAttribute("href")) === p.coverPath);
    if (coverItem) {
      // Must track the actual encoding: enhancement re-encodes to JPEG (or
      // PNG when the source had transparency), and a stale media-type breaks
      // the cover in strict readers.
      coverItem.setAttribute("media-type", finalBlob.type || coverItem.getAttribute("media-type"));
      p.zip.file(p.opfPath, new XMLSerializer().serializeToString(p.opfDoc));
    }
  }

  const editedBytes = await p.zip.generateAsync({ type: "uint8array" });
  const baseOutName = item.file.name.replace(/\.epub$/i, "");

  if (item.convertToKobo) {
    if (!wasmReady) throw new Error("converter not loaded yet");
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
      item.error = t("edit.processErrorPrefix") + (err.message || err);
    }
  }
  renderMetaList();
  return outputs;
}

// ---- bottom actions -------------------------------------------------------

editDownloadAllBtn.addEventListener("click", async () => {
  editDownloadAllBtn.disabled = true;
  editDownloadAllBtn.textContent = t("edit.downloadAll.processing");
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
      a.download = t("edit.zipName");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  } finally {
    editDownloadAllBtn.textContent = t("edit.downloadAll");
    updateEditButtons();
  }
});

editSendDeviceBtn.addEventListener("click", async () => {
  editSendDeviceBtn.disabled = true;
  editSendDeviceBtn.textContent = t("edit.sendDevice.preparing");
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
    editSendDeviceBtn.textContent = t("edit.sendDevice");
    updateEditButtons();
  }
});
