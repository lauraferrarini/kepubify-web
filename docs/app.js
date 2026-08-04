"use strict";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const fileList = document.getElementById("file-list");
const queueSection = document.querySelector(".queue-section");
const convertAllBtn = document.getElementById("convert-all");
const downloadAllBtn = document.getElementById("download-all");
const clearAllBtn = document.getElementById("clear-all");
const wasmStatus = document.getElementById("wasm-status");

/** @type {{id:number, file:File, status:string, error?:string, outBlob?:Blob, outName?:string}[]} */
const queue = [];
let nextId = 1;
let wasmReady = false;

// ---- WASM bootstrap ------------------------------------------------------

async function loadWasm() {
  try {
    const go = new Go();
    const resp = await fetch("kepubify.wasm");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const { instance } = await WebAssembly.instantiateStreaming(resp, go.importObject);
    go.run(instance); // resolves only when the program exits; run in background
    // wait a tick for kepubifyReady to be set by the Go program's init
    await waitFor(() => window.kepubifyReady === true, 5000);
    wasmReady = true;
    wasmStatus.textContent = "conversor pronto — tudo roda localmente, nada é enviado a servidor";
    wasmStatus.classList.add("ready");
    updateButtons();
  } catch (err) {
    console.error(err);
    wasmStatus.textContent = "falha ao carregar o conversor: " + err.message;
    wasmStatus.classList.add("failed");
  }
}

function waitFor(cond, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    (function poll() {
      if (cond()) return resolve();
      if (performance.now() - start > timeoutMs) return reject(new Error("timeout"));
      setTimeout(poll, 25);
    })();
  });
}

loadWasm();

// ---- File intake ----------------------------------------------------------

function addFiles(fileListLike) {
  const files = Array.from(fileListLike).filter((f) =>
    f.name.toLowerCase().endsWith(".epub")
  );
  for (const file of files) {
    queue.push({ id: nextId++, file, status: "pending" });
  }
  renderQueue();
}

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener("change", (e) => {
  addFiles(e.target.files);
  fileInput.value = "";
});

["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
  })
);
dropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

// ---- Rendering --------------------------------------------------------

function renderQueue() {
  fileList.innerHTML = "";
  queueSection.classList.toggle("has-files", queue.length > 0);

  for (const item of queue) {
    const li = document.createElement("li");
    li.className = "file-row";
    li.dataset.status = item.status;
    li.dataset.id = String(item.id);

    const statusText = {
      pending: "na fila",
      converting: "convertendo…",
      done: "concluído",
      error: item.error || "erro",
    }[item.status];

    li.innerHTML = `
      <div class="spine" aria-hidden="true"></div>
      <div class="file-meta">
        <div class="file-name" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</div>
        <div class="file-status ${item.status === "error" ? "error" : item.status === "done" ? "done" : ""}">${escapeHtml(statusText)}</div>
      </div>
      <div class="page-flip" aria-hidden="true"></div>
      <a class="file-download" ${item.outBlob ? `href="${downloadUrlFor(item)}" download="${escapeHtml(item.outName)}"` : "href=\"#\" tabindex=\"-1\""}>baixar</a>
    `;
    fileList.appendChild(li);
  }

  updateButtons();
}

function downloadUrlFor(item) {
  if (!item._url) item._url = URL.createObjectURL(item.outBlob);
  return item._url;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function updateButtons() {
  const hasPending = queue.some((q) => q.status === "pending" || q.status === "error");
  const hasDone = queue.some((q) => q.status === "done");
  convertAllBtn.disabled = !wasmReady || !hasPending;
  downloadAllBtn.disabled = !hasDone;
  clearAllBtn.disabled = queue.length === 0;
}

// ---- Conversion ---------------------------------------------------------

async function convertOne(item) {
  item.status = "converting";
  item.error = undefined;
  renderQueue();
  await nextFrame(); // let the "converting" state paint before the blocking call

  try {
    const buf = new Uint8Array(await item.file.arrayBuffer());
    const result = window.kepubifyConvert(buf);
    if (!result.ok) throw new Error(result.error);

    const bytes = new Uint8Array(result.data.length);
    bytes.set(result.data); // copy out of the wasm-managed array
    item.outBlob = new Blob([bytes], { type: "application/epub+zip" });
    item.outName = baseName(item.file.name) + ".kepub.epub";
    item.status = "done";
  } catch (err) {
    item.status = "error";
    item.error = err.message || String(err);
  }
  renderQueue();
}

function baseName(name) {
  return name.replace(/\.epub$/i, "");
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

convertAllBtn.addEventListener("click", async () => {
  convertAllBtn.disabled = true;
  const pending = queue.filter((q) => q.status === "pending" || q.status === "error");
  for (const item of pending) {
    await convertOne(item);
  }
  updateButtons();
});

clearAllBtn.addEventListener("click", () => {
  for (const item of queue) {
    if (item._url) URL.revokeObjectURL(item._url);
  }
  queue.length = 0;
  renderQueue();
});

// ---- Tabs -----------------------------------------------------------------

const tabBtnBatch = document.getElementById("tab-btn-batch");
const tabBtnMeta = document.getElementById("tab-btn-meta");
const tabBatch = document.getElementById("tab-batch");
const tabMeta = document.getElementById("tab-meta");

function activateTab(which) {
  const onBatch = which === "batch";
  tabBtnBatch.classList.toggle("active", onBatch);
  tabBtnMeta.classList.toggle("active", !onBatch);
  tabBtnBatch.setAttribute("aria-selected", String(onBatch));
  tabBtnMeta.setAttribute("aria-selected", String(!onBatch));
  tabBatch.hidden = !onBatch;
  tabMeta.hidden = onBatch;
}
tabBtnBatch.addEventListener("click", () => activateTab("batch"));
tabBtnMeta.addEventListener("click", () => activateTab("meta"));

downloadAllBtn.addEventListener("click", async () => {
  const done = queue.filter((q) => q.status === "done" && q.outBlob);
  if (!done.length) return;

  downloadAllBtn.disabled = true;
  downloadAllBtn.textContent = "compactando…";
  try {
    const zip = new JSZip();
    for (const item of done) {
      zip.file(item.outName, item.outBlob);
    }
    const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kepubs.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } finally {
    downloadAllBtn.textContent = "Baixar tudo (.zip)";
    updateButtons();
  }
});
