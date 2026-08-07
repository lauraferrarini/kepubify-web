// GET /s/:key/f/:idx
// Baixa (via streaming direto do R2) um arquivo específico da sessão.

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

  const obj = await context.env.FILES.get(meta.r2key);
  if (!obj) return new Response("arquivo não encontrado no armazenamento (pode ter expirado)", { status: 404 });

  const headers = new Headers();
  headers.set("content-type", meta.type || "application/octet-stream");
  headers.set("content-disposition", `attachment; filename="${meta.name.replace(/"/g, "")}"`);
  headers.set("content-length", String(meta.size));
  headers.set("cache-control", "no-store");

  return new Response(obj.body, { status: 200, headers });
};
