// HTML da tela do e-reader — usada tanto quando a raiz "/" detecta um
// Kobo/Kindle quanto na rota fixa /receber (fallback manual, pra quando a
// detecção por User-Agent falhar ou pra testar no navegador do computador).
//
// Tem duas formas de receber os livros:
//  1) digitar a chave que apareceu no celular/computador — um <form> GET
//     comum (sem depender de JS) que manda pra /goto, que redireciona pra
//     /s/<CODIGO>;
//  2) o QR code: é o "RG" deste e-reader (o pairId de _lib/pairing.ts). No
//     celular, o botão "Ler QR code" do send2kobo lê esta imagem, vincula os
//     dois aparelhos e já envia os arquivos. Aqui, um scriptzinho pergunta a
//     /pair-status a cada poucos segundos se já chegou algo e, quando chega,
//     abre a lista de arquivos sozinho. É feito em segundo plano (XHR) de
//     propósito: recarregar a página inteira apagaria a chave que a pessoa
//     estivesse digitando. Sem JS, o <noscript> recarrega a página a cada
//     poucos segundos e index.ts/receber.ts fazem o redirecionamento.
//
// O QR também carrega a URL "/app?pair=<pairId>", então a câmera comum do
// celular continua funcionando como atalho (abre o send2kobo já pareado).

export function receivePage(origin: string, pairId: string): Response {
  const qrTarget = `${origin}/app?pair=${encodeURIComponent(pairId)}`;
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(qrTarget)}`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<noscript><meta http-equiv="refresh" content="4"></noscript>
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
<p class="hint">Digite a chave que apareceu no celular ou computador:</p>
<form method="get" action="/goto">
  <div>
    <input type="text" name="k" maxlength="8" autocapitalize="characters" autocomplete="off">
  </div>
  <button type="submit">Buscar arquivos</button>
</form>
<p class="or">— ou, pelo QR code —</p>
<div class="qr-block">
  <img src="${qrImgUrl}" width="240" height="240" alt="QR code deste e-reader">
</div>
<p class="qr-caption">No celular, abra o send2kobo, prepare os arquivos e toque em <b>Ler QR code</b>, apontando a câmera pra essa imagem. Os livros aparecem aqui sozinhos.</p>
<p class="fallback">Não é um Kobo/Kindle? <a href="/app">abrir a página de envio</a>.</p>
<script>
(function () {
  var pairId = "${pairId}";
  function poll() {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "/pair-status?id=" + pairId, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200 && xhr.responseText) {
        window.location.href = "/s/" + xhr.responseText;
        return;
      }
      if (xhr.status === 410) {
        window.location.reload();
        return;
      }
      setTimeout(poll, 3000);
    };
    xhr.onerror = function () { setTimeout(poll, 5000); };
    xhr.send();
  }
  setTimeout(poll, 3000);
})();
</script>
</body>
</html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
