// GET /s/:key/f/:idx
// Baixa (do Workers KV) um arquivo específico da sessão. Também marca esse
// arquivo como "já baixado" nos metadados da sessão, em segundo plano, pra
// a página de listagem (s/[key]/index.ts) conseguir mostrar isso — sem
// precisar de JavaScript nem cookies no navegador do e-reader.

export interface Env {
  SESSIONS: KVNamespace;
}

interface FileMeta {
  name: string;
  kvKey: string;
  size: number;
  type: string;
  downloaded?: boolean;
}

interface SessionRecord {
  expiresAt: number;
  files: FileMeta[];
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const key = String(context.params.key || "").toUpperCase();
  const idx = Number(context.params.idx);

  const raw = await context.env.SESSIONS.get(`sess:${key}`);
  if (!raw) return new Response("link expirado", { status: 404 });

  const session = JSON.parse(raw) as SessionRecord;
  const meta = session.files[idx];
  if (!meta) return new Response("arquivo não encontrado", { status: 404 });

  const bytes = await context.env.SESSIONS.get(meta.kvKey, { type: "arrayBuffer" });
  if (!bytes) return new Response("arquivo não encontrado no armazenamento (pode ter expirado)", { status: 404 });

  if (!meta.downloaded) {
    context.waitUntil(markDownloaded(context.env, key, idx, session));
  }

  const headers = new Headers();
  headers.set("content-type", meta.type || "application/octet-stream");
  headers.set("content-disposition", `attachment; filename="${meta.name.replace(/"/g, "")}"`);
  headers.set("content-length", String(meta.size));
  headers.set("cache-control", "no-store");

  return new Response(bytes, { status: 200, headers });
};

async function markDownloaded(env: Env, key: string, idx: number, session: SessionRecord): Promise<void> {
  session.files[idx].downloaded = true;
  // mantém o mesmo prazo de expiração original da sessão, só reescrevendo o
  // TTL restante (o KV exige pelo menos 60s de expirationTtl por chamada)
  const remaining = Math.max(60, Math.round((session.expiresAt - Date.now()) / 1000));
  await env.SESSIONS.put(`sess:${key}`, JSON.stringify(session), { expirationTtl: remaining });
}
