"use strict";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const fileList = document.getElementById("file-list");
const queueSection = document.querySelector(".queue-section");
const prepareAllBtn = document.getElementById("prepare-all");
const downloadAllBtn = document.getElementById("download-all");
const sendAllBtn = document.getElementById("send-all");
const clearAllBtn = document.getElementById("clear-all");
const wasmStatus = document.getElementById("wasm-status");

const sessionPanel = document.getElementById("session-panel");
const sessionKeyEl = document.getElementById("session-key");
const sessionHostUrlEl = document.getElementById("session-host-url");
const sessionCountdownEl = document.getElementById("session-countdown");
const sessionFilesEl = document.getElementById("session-files");
const deleteSessionBtn = document.getElementById("delete-session");

/**
 * @typedef {{
 *   id: number,
 *   file: File,
 *   isEpub: boolean,
 *   convertToKobo: boolean,
 *   status: "pending"|"preparing"|"ready"|"error",
 *   error?: string,
 *   outBlob?: Blob,
 *   outName?: string,
 *   _url?: string,
 * }} QueueItem
 */

/** @type {QueueItem[]} */
const queue = [];
let nextId = 1;
let wasmReady = false;
let currentSessionKey = null;
let countdownTimer = null;

// ---- WASM bootstrap (conversão EPUB -> KEPUB, local, igual ao kepubify-web) ----

let wasmState = "loading"; // "loading" | "ready" | "failed"
let wasmErrorMsg = "";

function refreshWasmStatus() {
  if (wasmState === "ready") {
    wasmStatus.textContent = t("send.wasmReady");
    wasmStatus.classList.remove("failed");
    wasmStatus.classList.add("ready");
  } else if (wasmState === "failed") {
    wasmStatus.textContent = t("send.wasmFailedPrefix") + wasmErrorMsg + t("send.wasmFailedSuffix");
    wasmStatus.classList.remove("ready");
    wasmStatus.classList.add("failed");
  } else {
    wasmStatus.textContent = t("send.wasmLoading");
    wasmStatus.classList.remove("ready", "failed");
  }
}

async function loadWasm() {
  try {
    const go = new Go();
    const resp = await fetch("kepubify.wasm");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const { instance } = await WebAssembly.instantiateStreaming(resp, go.importObject);
    go.run(instance);
    await waitFor(() => window.kepubifyReady === true, 5000);
    wasmReady = true;
    wasmState = "ready";
    refreshWasmStatus();
    updateButtons();
  } catch (err) {
    console.error(err);
    wasmState = "failed";
    wasmErrorMsg = err.message;
    refreshWasmStatus();
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
  const all = Array.from(fileListLike);
  for (const file of all) {
    const isEpub = file.name.toLowerCase().endsWith(".epub") && !file.name.toLowerCase().endsWith(".kepub.epub");
    queue.push({ id: nextId++, file, isEpub, convertToKobo: isEpub, status: "pending" });
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
      pending: t("status.pending"),
      preparing: t("status.preparing"),
      ready: t("status.ready"),
      error: item.error || t("status.error"),
    }[item.status];

    let toggleHtml;
    if (item.status === "ready") {
      const converted = item.fromEdit ? !!item.wasConverted : (item.isEpub && item.convertToKobo);
      toggleHtml = converted
        ? `<span class="device-toggle disabled convertido">${t("badge.converted")}</span>`
        : `<span class="device-toggle disabled">${t("badge.notConverted")}</span>`;
    } else if (item.isEpub) {
      toggleHtml = `<label class="device-toggle ${item.status !== "pending" ? "disabled" : ""}">
           <input type="checkbox" data-id="${item.id}" class="kobo-toggle" ${item.convertToKobo ? "checked" : ""} ${item.status !== "pending" ? "disabled" : ""}>
           ${t("badge.convertToKobo")}
         </label>`;
    } else {
      toggleHtml = `<span class="device-toggle disabled">${t("badge.noConversion")}</span>`;
    }

    li.innerHTML = `
      <div class="spine" aria-hidden="true"></div>
      <div class="file-meta">
        <div class="file-name" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</div>
        <div class="file-status ${item.status === "error" ? "error" : item.status === "ready" ? "done" : ""}">${escapeHtml(statusText)}</div>
      </div>
      <div class="page-flip" aria-hidden="true"></div>
      ${toggleHtml}
      <button type="button" class="row-remove" data-id="${item.id}" aria-label="${escapeHtml(t("send.rowRemoveAria", { name: item.file.name }))}" title="${escapeHtml(t("send.rowRemoveTitle"))}">×</button>
    `;
    fileList.appendChild(li);
  }

  fileList.querySelectorAll(".kobo-toggle").forEach((el) => {
    el.addEventListener("change", (e) => {
      const id = Number(e.target.dataset.id);
      const item = queue.find((q) => q.id === id);
      if (item) item.convertToKobo = e.target.checked;
    });
  });

  fileList.querySelectorAll(".row-remove").forEach((el) => {
    el.addEventListener("click", (e) => {
      const id = Number(e.currentTarget.dataset.id);
      const idx = queue.findIndex((q) => q.id === id);
      if (idx === -1) return;
      if (queue[idx]._url) URL.revokeObjectURL(queue[idx]._url);
      queue.splice(idx, 1);
      renderQueue();
    });
  });

  updateButtons();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function updateButtons() {
  const hasPending = queue.some((q) => q.status === "pending" || q.status === "error");
  const hasReady = queue.some((q) => q.status === "ready");
  prepareAllBtn.disabled = !hasPending;
  downloadAllBtn.disabled = !hasReady;
  sendAllBtn.disabled = !hasReady;
  clearAllBtn.disabled = queue.length === 0;
}

// ---- Preparação (conversão local quando marcado, senão passa direto) ------

async function prepareOne(item) {
  item.status = "preparing";
  item.error = undefined;
  renderQueue();
  await nextFrame();

  try {
    if (item.isEpub && item.convertToKobo) {
      if (!wasmReady) throw new Error("converter not loaded yet");
      const buf = new Uint8Array(await item.file.arrayBuffer());
      const result = window.kepubifyConvert(buf);
      if (!result.ok) throw new Error(result.error);
      const bytes = new Uint8Array(result.data.length);
      bytes.set(result.data);
      item.outBlob = new Blob([bytes], { type: "application/epub+zip" });
      item.outName = baseName(item.file.name) + ".kepub.epub";
    } else {
      item.outBlob = item.file;
      item.outName = item.file.name;
    }
    item.status = "ready";
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

prepareAllBtn.addEventListener("click", async () => {
  prepareAllBtn.disabled = true;
  const pending = queue.filter((q) => q.status === "pending" || q.status === "error");
  for (const item of pending) {
    await prepareOne(item);
  }
  updateButtons();
});

downloadAllBtn.addEventListener("click", async () => {
  const ready = queue.filter((q) => q.status === "ready" && q.outBlob);
  if (!ready.length) return;

  downloadAllBtn.disabled = true;
  downloadAllBtn.textContent = t("send.downloadZipping");
  try {
    if (ready.length === 1) {
      const item = ready[0];
      const url = URL.createObjectURL(item.outBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.outName || item.file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } else {
      const zip = new JSZip();
      for (const item of ready) zip.file(item.outName || item.file.name, item.outBlob);
      const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = t("send.zipName");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  } finally {
    downloadAllBtn.textContent = t("send.download");
    updateButtons();
  }
});

clearAllBtn.addEventListener("click", () => {
  for (const item of queue) {
    if (item._url) URL.revokeObjectURL(item._url);
  }
  queue.length = 0;
  renderQueue();
  hideSessionPanel();
});

// ---- Envio: sobe tudo de uma vez e gera a chave ---------------------------

sendAllBtn.addEventListener("click", async () => {
  const ready = queue.filter((q) => q.status === "ready" && q.outBlob);
  if (!ready.length) return;

  sendAllBtn.disabled = true;
  sendAllBtn.textContent = t("send.sending");
  try {
    const form = new FormData();
    for (const item of ready) {
      form.append("files", item.outBlob, item.outName);
    }
    const resp = await fetch("/api/create-session", { method: "POST", body: form });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    showSessionPanel(data, ready);
  } catch (err) {
    console.error(err);
    wasmStatus.textContent = t("send.sendErrorPrefix") + (err.message || String(err));
    wasmStatus.classList.add("failed");
  } finally {
    sendAllBtn.disabled = false;
    sendAllBtn.textContent = t("send.generateKey");
  }
});

function showSessionPanel(data, sentItems) {
  currentSessionKey = data.key;
  sessionPanel.hidden = false;
  sessionKeyEl.textContent = data.key;
  sessionHostUrlEl.textContent = location.origin;

  sessionFilesEl.innerHTML = sentItems.map((i) => `<li>${escapeHtml(i.outName)}</li>`).join("");

  startCountdown(data.expiresAt);
  sessionPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideSessionPanel() {
  sessionPanel.hidden = true;
  currentSessionKey = null;
  if (countdownTimer) clearInterval(countdownTimer);
}

function startCountdown(expiresAt) {
  if (countdownTimer) clearInterval(countdownTimer);
  function tick() {
    const secondsLeft = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    sessionCountdownEl.textContent = `${m}:${String(s).padStart(2, "0")}`;
    if (secondsLeft <= 0) {
      clearInterval(countdownTimer);
      sessionCountdownEl.textContent = t("session.expired");
    }
  }
  tick();
  countdownTimer = setInterval(tick, 1000);
}

deleteSessionBtn.addEventListener("click", async () => {
  if (!currentSessionKey) return;
  deleteSessionBtn.disabled = true;
  try {
    await fetch(`/api/session/${currentSessionKey}`, { method: "DELETE" });
  } catch (err) {
    console.error(err);
  } finally {
    hideSessionPanel();
    deleteSessionBtn.disabled = false;
  }
});
