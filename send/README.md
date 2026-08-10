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
[Cloudflare Pages](https://pages.cloudflare.com/) (Functions + Workers KV),
que tem um plano gratuito confortável pra esse uso e te dá de graça um
endereço `https://send2kobo.pages.dev` — sem precisar de domínio próprio e
**sem precisar cadastrar cartão** (o Workers KV, diferente do R2, não exige
isso).

## Como funciona, por dentro

```
public/            → frontend estático (o que o Pages publica)
  app.html          → tela de enviar/converter (fica em /app, veja abaixo)
  style.css, send.css
  app.js            → fila de arquivos, conversão via wasm, upload, chave/contagem
  kepubify.wasm, wasm_exec.js   → copiados de ../docs (conversor do kepubify)

functions/          → Pages Functions (back-end, roda como Worker)
  index.ts                   → GET /: detecta o navegador do Kobo/Kindle pelo
                                User-Agent e mostra a tela de código direto;
                                qualquer outro navegador recebe a tela de envio
  receber.ts                 → GET /receber: mesma tela de código, sem depender
                                da detecção (atalho manual/teste)
  goto.ts                    → GET /goto?k=CODIGO: redireciona pra /s/CODIGO
  _lib/receivePage.ts         → HTML compartilhado da tela "digite o código"
  api/create-session.ts      → POST: recebe os arquivos, grava no KV, gera a chave
  api/session/[key].ts       → DELETE: apaga uma sessão antes do prazo
  s/[key]/index.ts           → GET: lista os arquivos da sessão (HTML puro, sem JS)
  s/[key]/f/[idx].ts         → GET: baixa um arquivo específico da sessão
```

Fluxo de quem envia: arrasta os arquivos em `https://send2kobo.pages.dev` →
EPUBs marcados "converter pra Kobo" passam pelo mesmo `kepubify.wasm`, no
navegador, exatamente como no kepubify-web → ao clicar em "Gerar chave de
envio", tudo sobe de uma vez pro Workers KV → a Function devolve uma chave de
4 caracteres.

Fluxo de quem recebe: no navegador do Kobo ou Kindle, basta abrir a raiz do
site — a Function em `functions/index.ts` reconhece esses dois navegadores
pelo cabeçalho `User-Agent` (procura por "Kobo" ou "Kindle") e já mostra
direto a tela de digitar o código, sem precisar navegar por menu nenhum. Sem
câmera, sem QR code — só o teclado do dispositivo. Se algum firmware não for
reconhecido (ou pra testar no navegador comum), `https://send2kobo.pages.dev/receber`
mostra a mesma tela manualmente.

Tanto os metadados da sessão quanto os bytes de cada arquivo ficam gravados
no **mesmo namespace KV**, cada entrada com `expirationTtl` de 5 minutos — o
próprio Cloudflare apaga tudo sozinho depois desse prazo, sem precisar de
nenhum worker de limpeza adicional (diferente de uma versão baseada em R2,
onde isso teria que ser feito manualmente).

**Trade-off dessa escolha:** o Workers KV tem um limite de ~25MB por valor
gravado, então cada arquivo enviado precisa ter no máximo 24MB (constante
`MAX_FILE_BYTES` em `functions/api/create-session.ts`). Isso cobre a grande
maioria dos EPUBs/KEPUBs tranquilamente; PDFs muito grandes (escaneados, por
exemplo) podem passar desse limite.

**Trade-off geral do projeto:** diferente do kepubify-web, aqui os arquivos
passam (por poucos minutos) por um servidor da Cloudflare antes do Kobo
baixar — isso é inerente a como qualquer ferramenta desse tipo funciona (o
send2ereader.net faz a mesma coisa). Não há login, não há logs de conteúdo,
e a expiração é rápida.

## Pré-requisitos

- Uma conta gratuita na [Cloudflare](https://dash.cloudflare.com/sign-up)
  (não precisa de cartão pra esse uso).
- Node.js instalado (você já tem, se conseguiu ler este README rodando algo
  aqui).

## Passo a passo do primeiro deploy

Tudo abaixo é rodado dentro desta pasta (`send/`), no terminal.

### 1. Instalar dependências e autenticar

```bash
npm install
```

Se `npx wrangler login` não funcionar no seu ambiente (por exemplo, em um
Codespaces ou outro terminal remoto sem navegador local), use um token de
API em vez do login interativo:

1. Na Cloudflare: ícone de perfil → **My Profile** → **API Tokens** →
   **Create Token** → **Custom token**, com permissões em "Account":
   **Cloudflare Pages: Edit**, **Workers KV Storage: Edit**,
   **Account Settings: Read** (ou Edit).
2. Pegue também o **Account ID** (painel → "Workers & Pages" → barra lateral
   direita).
3. No terminal:
   ```bash
   export CLOUDFLARE_API_TOKEN=SEU_TOKEN_AQUI
   export CLOUDFLARE_ACCOUNT_ID=SEU_ACCOUNT_ID_AQUI
   ```
   (o `CLOUDFLARE_ACCOUNT_ID` evita uma chamada de descoberta de conta que
   alguns tokens customizados não conseguem fazer.)

### 2. Criar o namespace KV

```bash
npx wrangler kv namespace create send2kobo-sessions
```

Isso imprime algo como:

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

Se depois de publicado a página der erro ao gerar a chave (em vez de
funcionar), é sinal de que o binding do KV não foi aplicado automaticamente
nessa versão do Wrangler — nesse caso, entre no [painel da
Cloudflare](https://dash.cloudflare.com/) → **Workers & Pages** →
`send2kobo` → **Settings → Functions**, e adicione manualmente o **KV
namespace binding**: nome `SESSIONS` → namespace `send2kobo-sessions`. Depois
faça o redeploy (`npx wrangler pages deploy public` de novo).

### 4. Testar

1. Abra `https://send2kobo.pages.dev` no computador — cai na tela de enviar.
2. Arraste um `.epub` de teste, clique em **Preparar tudo** e depois em
   **Gerar chave de envio**.
3. No navegador do seu Kobo ou Kindle, abra `https://send2kobo.pages.dev` — a
   detecção por User-Agent deve mostrar direto a tela de código. Se não
   mostrar (algum firmware não reconhecido), acesse
   `https://send2kobo.pages.dev/receber` manualmente.
4. Digite a chave de 4 caracteres e toque em "Buscar arquivos".
5. Toque no arquivo listado pra baixar.

## Rodando localmente antes de publicar

```bash
npm run dev
```

Isso levanta tudo em `http://localhost:8788` com o KV simulado localmente
pelo Miniflare (não toca nada na sua conta real da Cloudflare).

## Ajustes que você pode querer fazer

Tudo isso está em `functions/api/create-session.ts`:

- `TTL_SECONDS` — tempo de expiração da sessão (hoje 300s = 5 minutos).
- `MAX_FILES` — quantos arquivos por envio (hoje 15).
- `MAX_FILE_BYTES` — tamanho máximo por arquivo (hoje 24MB — não passe disso,
  é o limite do Workers KV).
- `MAX_TOTAL_BYTES` — tamanho total máximo por envio (hoje 100MB).
- `KEY_LENGTH` — tamanho da chave (hoje 4 caracteres — curto de propósito,
  pra digitar fácil no e-reader; o TTL de 5 minutos limita a janela de
  alguém tentar adivinhar uma chave à toa).

A lista de navegadores reconhecidos como e-reader está em
`functions/index.ts` (constante `EREADER_UA`, hoje `/kobo|kindle/i`) — se um
dia você quiser reconhecer outro dispositivo, é só adicionar o termo ali.

## Licença

Mesma licença do repositório principal (MIT). Conversão EPUB → KEPUB baseada
em [pgaskin/kepubify](https://github.com/pgaskin/kepubify).
