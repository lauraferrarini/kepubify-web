# send2kobo

Envie vários livros de uma vez pro seu Kobo (ou outro e-reader com navegador),
sem cabo: você gera uma chave curta no computador, digita ela no navegador do
dispositivo, e todos os arquivos ficam disponíveis pra baixar ali. Cada chave
expira automaticamente em **5 minutos**.

É a pasta `send/` dentro do repositório
[`kepubify-web`](https://github.com/lauraferrarini/kepubify-web) — reaproveita
o mesmo conversor EPUB → KEPUB em WebAssembly que já existe em `../docs`, mas,
diferente daquele site (100% estático, nada sai do seu aparelho), este aqui
**precisa de um back-end** pra guardar os arquivos por alguns minutos e gerar
o link que o e-reader acessa. Por isso ele roda em
[Cloudflare Pages](https://pages.cloudflare.com/) (Functions + R2 + KV), que
tem um plano gratuito confortável pra esse uso e te dá de graça um endereço
`https://send2kobo.pages.dev` — sem precisar de domínio próprio.

## Como funciona, por dentro

```
public/            → frontend estático (o que o Pages publica)
  index.html
  style.css, send.css
  app.js            → fila de arquivos, conversão via wasm, upload, chave/QR/contagem
  kepubify.wasm, wasm_exec.js   → copiados de ../docs (conversor do kepubify)

functions/          → Pages Functions (back-end, roda como Worker)
  api/create-session.ts     → POST: recebe os arquivos, grava no R2, gera a chave
  api/session/[key].ts      → DELETE: apaga uma sessão antes do prazo
  s/[key]/index.ts          → GET: página que o e-reader abre (HTML puro, sem JS)
  s/[key]/f/[idx].ts        → GET: baixa um arquivo específico da sessão

cron-cleanup/       → Worker separado, com Cron Trigger a cada 5 minutos
  src/index.ts             → apaga do R2 qualquer arquivo de sessão já expirada
```

Fluxo: você arrasta os arquivos → EPUBs marcados "converter pra Kobo" passam
pelo mesmo `kepubify.wasm`, no seu navegador, exatamente como no
kepubify-web → ao clicar em "Gerar chave de envio", tudo sobe de uma vez pro
R2 → a Function devolve uma chave de 6 caracteres + QR code → no navegador do
Kobo, `https://send2kobo.pages.dev/s/CHAVE` lista cada arquivo com um link
grande pra baixar.

A sessão em si expira sozinha (o registro no KV tem TTL de 5 minutos), mas o
KV expirar não apaga os arquivos no R2 — o `cron-cleanup` é a rede de
segurança que limpa isso a cada 5 minutos, então nada fica ali por mais que
uns 10 minutos no pior caso.

**Trade-off importante:** diferente do kepubify-web, aqui os arquivos passam
(por poucos minutos) por um servidor da Cloudflare antes do Kobo baixar —
isso é inerente a como qualquer ferramenta desse tipo funciona (o
send2ereader.net faz a mesma coisa). Não há login, não há logs de conteúdo, e
a expiração é rápida.

## Pré-requisitos

- Uma conta gratuita na [Cloudflare](https://dash.cloudflare.com/sign-up)
  (não precisa de cartão pra esse uso).
- Node.js instalado (você já tem, se conseguiu ler este README rodando algo
  aqui).

## Passo a passo do primeiro deploy

Tudo abaixo é rodado dentro desta pasta (`send/`), no terminal.

### 1. Instalar dependências e logar na Cloudflare

```bash
npm install
npx wrangler login
```

Isso abre o navegador pra você autorizar o Wrangler (a CLI da Cloudflare) na
sua conta.

### 2. Criar o bucket R2 e o namespace KV

```bash
npx wrangler r2 bucket create send2kobo-files
npx wrangler kv namespace create send2kobo-sessions
```

O segundo comando imprime algo como:

```
{ binding = "SESSIONS", id = "a1b2c3d4e5f6..." }
```

Copie esse `id` e cole em `wrangler.toml`, substituindo
`COLOQUE_AQUI_O_ID_DO_NAMESPACE_KV`.

### 3. Publicar o site (Pages)

```bash
npx wrangler pages deploy public
```

Na primeira vez, o Wrangler pergunta o nome do projeto — use `send2kobo`
(mesmo nome do `wrangler.toml`) pra ficar consistente. Ao final ele imprime a
URL pública, algo como `https://send2kobo.pages.dev`.

Se depois de publicado a página dar erro 500 ao gerar a chave (em vez de
funcionar), é sinal de que os bindings do R2/KV não foram aplicados
automaticamente nessa versão do Wrangler — nesse caso, entre no [painel da
Cloudflare](https://dash.cloudflare.com/) → **Workers & Pages** →
`send2kobo` → **Settings → Functions**, e adicione manualmente:
- **KV namespace binding**: nome `SESSIONS` → namespace `send2kobo-sessions`
- **R2 bucket binding**: nome `FILES` → bucket `send2kobo-files`

e faça o redeploy (`npx wrangler pages deploy public` de novo).

### 4. Publicar o worker de limpeza (cron-cleanup)

```bash
cd cron-cleanup
npm install
npx wrangler deploy
cd ..
```

Esse é um Worker separado (não é Pages), então não precisa de mais nenhuma
configuração — o `wrangler.toml` dele já define o cron de 5 em 5 minutos e o
bucket R2 a limpar.

### 5. Testar

1. Abra `https://send2kobo.pages.dev` no computador.
2. Arraste um `.epub` de teste, clique em **Preparar tudo** e depois em
   **Gerar chave de envio**.
3. No navegador do seu Kobo (ou em outro celular/computador, pra testar),
   acesse `https://send2kobo.pages.dev/s/CHAVE` com a chave que apareceu — ou
   leia o QR code.
4. Toque no arquivo listado pra baixar.

## Rodando localmente antes de publicar

```bash
npm run dev
```

Isso levanta tudo em `http://localhost:8788` com R2/KV simulados localmente
pelo Miniflare (não toca nada na sua conta real da Cloudflare). Pra testar o
worker de limpeza localmente: `npm run cron:dev` (dentro de `cron-cleanup/`).

## Ajustes que você pode querer fazer

Tudo isso está em `functions/api/create-session.ts`:

- `TTL_SECONDS` — tempo de expiração da sessão (hoje 300s = 5 minutos).
- `MAX_FILES` — quantos arquivos por envio (hoje 20).
- `MAX_TOTAL_BYTES` — tamanho total máximo por envio (hoje 200MB).
- `KEY_LENGTH` — tamanho da chave (hoje 6 caracteres).

Se mudar `TTL_SECONDS`, ajuste também `MAX_AGE_MS` em
`cron-cleanup/src/index.ts` pra manter uma margem de segurança acima do novo
TTL.

## Licença

Mesma licença do repositório principal (MIT). Conversão EPUB → KEPUB baseada
em [pgaskin/kepubify](https://github.com/pgaskin/kepubify).
