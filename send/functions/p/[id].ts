// GET /p/<pairId>
// É o endereço que o QR do e-reader carrega. Quem lê com a câmera comum do
// celular cai aqui; se o pareamento ainda vale, segue direto pro send2kobo
// (/app) já pareado. Se já expirou (ou já foi usado), mostra um aviso claro
// em vez de deixar a pessoa preparar os arquivos pra descobrir só no fim.
//
// O endereço curto também deixa o QR menos denso, o que ajuda a lê-lo numa
// tela de e-ink.

import { getPairingStatus } from "../_lib/pairing";

export interface Env {
  SESSIONS: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = String(context.params.id || "");
  if (!/^[a-f0-9]{16}$/.test(id)) {
    return new Response("Not found", { status: 404 });
  }

  const status = await getPairingStatus(context.env, id);
  if (status.exists && !status.sessionKey) {
    return new Response(null, {
      status: 302,
      headers: {
        location: `/app?pair=${id}`,
        "cache-control": "no-store",
      },
    });
  }
  return expiredPage();
};

function expiredPage(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>send2kobo</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; margin: 0; padding: 32px 24px; background:#eae7dd; color:#1b1e1c; text-align:center; }
  h1 { font-size: 1.3em; margin: 0 0 12px; }
  p { max-width: 26em; margin: 0 auto 14px; line-height: 1.45; }
  a { color:#1d423d; font-weight: bold; }
  .en { color:#4a4d47; font-size:0.92em; }
</style>
</head>
<body>
<h1>Esse QR code expirou</h1>
<p>Recarregue a tela do send2kobo no e-reader pra gerar um QR novo e leia de novo.</p>
<p class="en">This QR code has expired. Reload the send2kobo screen on your e-reader to get a new one, then scan again.</p>
<p><a href="/app">Abrir o send2kobo / Open send2kobo</a></p>
</body>
</html>`;
  return new Response(html, {
    status: 410,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
