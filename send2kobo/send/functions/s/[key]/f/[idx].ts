// GET /s/:key/f/:idx
// Baixa (do Workers KV) um arquivo específico da sessão.

export interface Env {
  SESSIONS: KVNamespace;
}

interface FileMeta {
  name: string;
  kvKey: string;
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

  const bytes = await context.env.SESSIONS.get(meta.kvKey, { type: "arrayBuffer" });
  if (!bytes) return new Response("arquivo não encontrado no armazenamento (pode ter expirado)", { status: 404 });

  const headers = new Headers();
  headers.set("content-type", meta.type || "application/octet-stream");
  headers.set("content-disposition", `attachment; filename="${meta.name.replace(/"/g, "")}"`);
  headers.set("content-length", String(meta.size));
  headers.set("cache-control", "no-store");

  return new Response(bytes, { status: 200, headers });
};
