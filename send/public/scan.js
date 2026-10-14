"use strict";

// Botão "Ler QR code": abre a câmera DENTRO da página, lê o QR que o e-reader
// mostra na tela (é o "RG" dele — ver send/functions/_lib/pairing.ts), e então
// prepara o que ainda estiver pendente e envia tudo já vinculado àquele
// e-reader. O e-reader percebe sozinho e abre a lista de arquivos.
//
// Usa, de app.js (mesmo escopo global de scripts clássicos): queue,
// prepareOne, sendReady, updateButtons, wasmStatus e t(). A decodificação do
// QR é da biblioteca jsQR (carregada em app.html).

const scanOverlay = document.getElementById("scan-overlay");
const scanVideo = document.getElementById("scan-video");
const scanCanvas = document.getElementById("scan-canvas");
const scanStatusEl = document.getElementById("scan-status");
const scanCancelBtn = document.getElementById("scan-cancel");

let scanStream = null;
let scanFrame = 0;
let scanActive = false; // câmera ligada e procurando QR
let scanBusy = false; // já achou o QR e está preparando/enviando

// O QR do e-reader carrega "https://<site>/app?pair=<16 hex>". Aceita também
// o id puro, por garantia.
function extractPairId(text) {
  const raw = String(text || "").trim();
  if (/^[a-f0-9]{16}$/i.test(raw)) return raw.toLowerCase();
  try {
    const p = new URL(raw).searchParams.get("pair");
    if (p && /^[a-f0-9]{16}$/i.test(p)) return p.toLowerCase();
  } catch (e) {
    /* não é uma URL */
  }
  return null;
}

function setScanStatus(text, isError) {
  scanStatusEl.textContent = text;
  scanStatusEl.classList.toggle("error", !!isError);
}

function stopCamera() {
  scanActive = false;
  if (scanFrame) cancelAnimationFrame(scanFrame);
  scanFrame = 0;
  if (scanStream) {
    for (const track of scanStream.getTracks()) track.stop();
    scanStream = null;
  }
  scanVideo.srcObject = null;
}

function closeScanner() {
  stopCamera();
  scanBusy = false;
  scanOverlay.hidden = true;
}

async function openScanner() {
  if (scanBusy || scanActive) return;
  scanOverlay.hidden = false;
  setScanStatus(t("scan.starting"));

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setScanStatus(t("scan.cameraError"), true);
    return;
  }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    scanVideo.srcObject = scanStream;
    await scanVideo.play();
  } catch (err) {
    console.error(err);
    stopCamera();
    setScanStatus(t("scan.cameraError"), true);
    return;
  }

  setScanStatus(t("scan.hint"));
  scanActive = true;
  scanLoop();
}

function scanLoop() {
  if (!scanActive) return;

  if (scanVideo.readyState === scanVideo.HAVE_ENOUGH_DATA && scanVideo.videoWidth) {
    // Reduz um pouco o quadro: acelera a leitura sem perder o QR.
    const scale = Math.min(1, 960 / Math.max(scanVideo.videoWidth, scanVideo.videoHeight));
    const w = Math.round(scanVideo.videoWidth * scale);
    const h = Math.round(scanVideo.videoHeight * scale);
    scanCanvas.width = w;
    scanCanvas.height = h;
    const ctx = scanCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(scanVideo, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const code = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });

    if (code && code.data) {
      const pairId = extractPairId(code.data);
      if (pairId) {
        onScanned(pairId);
        return;
      }
      setScanStatus(t("scan.notRecognized"), true);
    }
  }
  scanFrame = requestAnimationFrame(scanLoop);
}

async function onScanned(pairId) {
  scanBusy = true;
  stopCamera();

  // Prepara (converte) o que ainda não foi — assim "Ler QR code" resolve tudo
  // de uma vez, sem precisar clicar em Preparar antes.
  const todo = queue.filter((q) => q.status === "pending" || q.status === "error");
  if (todo.length) {
    setScanStatus(t("scan.preparing"));
    for (const item of todo) await prepareOne(item);
  }

  setScanStatus(t("scan.linking"));
  const ok = await sendReady(pairId);
  closeScanner();

  if (!ok && !queue.some((q) => q.status === "ready")) {
    wasmStatus.textContent = t("scan.nothingReady");
    wasmStatus.classList.add("failed");
  }
}

scanQrBtn.addEventListener("click", openScanner);
scanCancelBtn.addEventListener("click", () => {
  if (!scanBusy) closeScanner();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !scanOverlay.hidden && !scanBusy) closeScanner();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && scanActive) closeScanner();
});
