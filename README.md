# kepubify-web

Uma página estática que converte vários EPUBs para o formato **KEPUB** do Kobo
de uma vez, inteiramente no navegador — nenhum arquivo é enviado a um
servidor.

Isso é possível porque a biblioteca de conversão do
[pgaskin/kepubify](https://github.com/pgaskin/kepubify) é compilada para
**WebAssembly** e roda localmente, no seu próprio dispositivo.

▶ **Demo:** `https://OWNER.github.io/kepubify-web/` (depois de habilitar o
GitHub Pages — veja abaixo).

## Como usar

1. Abra a página.
2. Arraste um ou vários arquivos `.epub` para a caixa (ou toque para escolher).
3. Clique em **Converter tudo**.
4. Baixe cada `.kepub.epub` individualmente, ou clique em **Baixar tudo
   (.zip)** para receber todos de uma vez em um único arquivo.

## Estrutura do repositório

```
docs/            # o site em si — é o que o GitHub Pages publica
  index.html
  style.css
  app.js         # UI: fila de arquivos, chamadas ao wasm, geração do .zip
  kepubify.wasm  # binário compilado (gerado pelo workflow de CI)
  wasm_exec.js   # cola do runtime Go/wasm (copiada do próprio Go)
wasmsrc/         # o wrapper Go que expõe kepub.Converter ao JavaScript
  main.go
  go.mod
.github/workflows/deploy.yml   # compila o wasm e publica em Pages a cada push
```

`docs/kepubify.wasm` é gerado automaticamente pelo GitHub Actions a cada push
em `main` — você não precisa ter Go instalado localmente para publicar
atualizações de HTML/CSS/JS.

## Rodando localmente

Como o app carrega um arquivo `.wasm` via `fetch`, ele precisa ser servido por
HTTP (abrir o `index.html` direto do disco não funciona por causa da política
de CORS do navegador para `file://`).

```bash
cd docs
python3 -m http.server 8000
# abra http://localhost:8000
```

## Compilando o `.wasm` manualmente

Só é necessário se você alterar `wasmsrc/main.go`:

```bash
cd wasmsrc
go mod tidy
GOOS=js GOARCH=wasm go build -tags zip117 -o ../docs/kepubify.wasm .
cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" ../docs/wasm_exec.js
```

## Publicando no GitHub Pages

1. Faça push deste repositório para `github.com/OWNER/kepubify-web`.
2. Em **Settings → Pages**, em "Build and deployment", escolha a fonte
   **GitHub Actions** (o workflow em `.github/workflows/deploy.yml` já cuida
   do resto).
3. A cada push em `main`, o site é recompilado e publicado automaticamente.

## Detalhes técnicos

- A conversão roda de forma síncrona dentro do wasm por arquivo; entre um
  arquivo e outro a UI é liberada para repintar (por isso a fila mostra o
  progresso item a item, não um progresso interno de cada arquivo).
- O agrupamento em `.zip` usa [JSZip](https://stuk.github.io/jszip/) via CDN,
  no navegador — os arquivos convertidos nunca saem da máquina do usuário
  para chegar até o JSZip.
- Arquivos maiores (dezenas de MB) podem travar a aba por alguns instantes
  durante a conversão de cada um, já que o wasm roda na thread principal. Para
  bibliotecas muito grandes, considere mover a chamada a
  `kepubifyConvert` para um Web Worker.

## Licença

Este repositório e o [kepubify](https://github.com/pgaskin/kepubify) original
são licenciados sob **MIT** — veja [`LICENSE`](LICENSE). Crédito integral da
lógica de conversão a Patrick Gaskin ([@pgaskin](https://github.com/pgaskin)).
