// HTML da tela "digite o código" — usada tanto quando a raiz "/" detecta um
// Kobo/Kindle quanto na rota fixa /receber (fallback manual, pra quando a
// detecção por User-Agent falhar ou pra testar no navegador do computador).
//
// Precisa funcionar em navegadores muito antigos: HTML puro. O código
// digitado manualmente vai por um <form> GET comum pra /goto, que
// redireciona pra /s/<CODIGO> — sem depender de JS.
//
// O QR code É o pareamento automático: aponta pra "/app?pair=<pairId>" (ver
// _lib/pairing.ts). Essa mesma tela também fica se recarregando sozinha a
// cada poucos segundos via <meta http-equiv="refresh">, de novo sem precisar
// de JS — cada recarregada é quem confere, no servidor, se o celular já
// vinculou uma sessão a esse pairId; se sim, index.ts/receber.ts redirecionam
// direto pra /s/<chave> antes mesmo de chegar a renderizar esta página de
// novo. Ou seja: ler o QR com o celular, preparar e enviar por lá é
// suficiente — nada pra digitar aqui quando esse caminho é usado.

export function receivePage(origin: string, pairId: string): Response {
  const qrTarget = `${origin}/app?pair=${encodeURIComponent(pairId)}`;
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(qrTarget)}`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="4">
<title>send2kobo — digite o código</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; margin: 0; padding: 24px; background:#fff; color:#111; text-align: center; }
  h1 { font-size: 1.4em; margin: 0 0 8px; }
  p.hint { color:#444; margin: 0 0 28px; font-size: 0.95em; }
  input[type="text"] {
    font-size: 2em;
    letter-spacing: 0.15em;
    text-align: center;
    text-transform: uppercase;
    width: 8em;
    padding: 0.35em 0.2em;
    border: 2px solid #333;
    margin-bottom: 20px;
  }
  button {
    display: block;
    width: 100%;
    max-width: 20em;
    margin: 0 auto;
    font-size: 1.25em;
    padding: 0.6em;
    border: 2px solid #333;
    background: #111;
    color: #fff;
  }
  button:active { background: #333; }
  .or { margin: 32px 0 20px; font-size: 0.85em; color: #777; }
  .qr-block { margin-bottom: 8px; }
  .qr-block img { border: 2px solid #333; padding: 6px; background: #fff; }
  .qr-caption { color:#444; font-size: 0.8em; max-width: 22em; margin: 10px auto 0; }
  .fallback { margin-top: 40px; font-size: 0.8em; }
  .fallback a { color: #555; }
</style>
</head>
<body>
<h1>send2kobo</h1>
<p class="hint">Aponte a câmera do celular pra essa imagem:</p>
<div class="qr-block">
  <img src="${qrImgUrl}" width="180" height="180" alt="QR code para conectar o celular a esta tela">
</div>
<p class="qr-caption">Isso abre o send2kobo no celular já conectado a esta tela. Prepare e envie os livros por lá — eles aparecem aqui sozinhos, sem precisar digitar nada. Esta página se atualiza sozinha a cada poucos segundos.</p>
<p class="or">— ou, se já tem um código —</p>
<form method="get" action="/goto">
  <div>
    <input type="text" name="k" maxlength="8" autocapitalize="characters" autocomplete="off">
  </div>
  <button type="submit">Buscar arquivos</button>
</form>
<p class="fallback">Não é um Kobo/Kindle? <a href="/app">abrir a página de envio</a>.</p>
</body>
</html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
