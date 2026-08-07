// GET /s/:key
// Página que o e-reader abre no próprio navegador dele. Precisa funcionar
// no WebKit antigo do Kobo: HTML puro, sem depender de JS, sem fontes
// externas, botões/links grandes.

export interface Env {
  SESSIONS: KVNamespace;
  FILES: R2Bucket;
}

interface FileMeta {
  name: string;
  r2key: string;
  size: number;
  type: string;
}

interface SessionRecord {
  createdAt: number;
  expiresAt: number;
  files: FileMeta[];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function page(title: string, body: string): Response {
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; margin: 0; padding: 20px; background:#fff; color:#111; }
  h1 { font-size: 1.35em; margin: 0 0 6px; }
  .hint { color:#444; margin: 0 0 20px; font-size: 0.95em; }
  ul { list-style:none; margin:0; padding:0; }
  li { border: 2px solid #333; margin-bottom: 14px; }
  a.dl { display:block; padding: 18px 14px; font-size: 1.15em; text-decoration:none; color:#000; }
  a.dl:active { background:#eee; }
  .sz { display:block; color:#555; font-size: 0.7em; margin-top:4px; }
</style>
</head>
<body>${body}</body>
</html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const key = String(context.params.key || "").toUpperCase();
  const raw = await context.env.SESSIONS.get(`sess:${key}`);

  if (!raw) {
    return page(
      "Link expirado",
      `<h1>Este link expirou ou não existe</h1>
       <p class="hint">As chaves valem só por alguns minutos. Gere uma nova no computador e digite-a aqui de novo.</p>`
    );
  }

  const session = JSON.parse(raw) as SessionRecord;
  const secondsLeft = Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000));

  const items = session.files
    .map(
      (f, i) =>
        `<li><a class="dl" href="/s/${key}/f/${i}">${escapeHtml(f.name)}<span class="sz">${formatSize(f.size)}</span></a></li>`
    )
    .join("\n");

  return page(
    "Arquivos para baixar",
    `<h1>Arquivos disponíveis</h1>
     <p class="hint">Toque em cada arquivo para baixar. Este link expira em cerca de ${secondsLeft}s.</p>
     <ul>${items}</ul>`
  );
};
