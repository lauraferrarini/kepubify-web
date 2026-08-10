// HTML da tela "digite o código" — usada tanto quando a raiz "/" detecta um
// Kobo/Kindle quanto na rota fixa /receber (fallback manual, pra quando a
// detecção por User-Agent falhar ou pra testar no navegador do computador).
//
// Precisa funcionar em navegadores muito antigos: HTML puro, um <form> GET
// comum (sem depender de JS) que manda o código pra /goto, que redireciona
// pra /s/<CODIGO>.

export function receivePage(): Response {
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
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
  .fallback { margin-top: 40px; font-size: 0.8em; }
  .fallback a { color: #555; }
</style>
</head>
<body>
<h1>send2kobo</h1>
<p class="hint">Digite o código que apareceu no computador pra baixar os livros.</p>
<form method="get" action="/goto">
  <div>
    <input type="text" name="k" maxlength="8" autocapitalize="characters" autocomplete="off" autofocus>
  </div>
  <button type="submit">Buscar arquivos</button>
</form>
<p class="fallback">Não é um Kobo/Kindle? <a href="/app.html">abrir a página de envio</a>.</p>
</body>
</html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
