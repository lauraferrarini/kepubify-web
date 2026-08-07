// DELETE /api/session/:key
// Apaga uma sessão antes do prazo — usado pelo botão "apagar agora"
// no navegador de quem enviou, e também pelo Kobo depois de baixar tudo.

export interface Env {
  SESSIONS: KVNamespace;
  FILES: R2Bucket;
}

interface FileMeta {
  r2key: string;
}

interface SessionRecord {
  files: FileMeta[];
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const key = String(context.params.key || "").toUpperCase();
  const raw = await context.env.SESSIONS.get(`sess:${key}`);
  if (raw) {
    const session = JSON.parse(raw) as SessionRecord;
    await Promise.all(session.files.map((f) => context.env.FILES.delete(f.r2key)));
    await context.env.SESSIONS.delete(`sess:${key}`);
  }
  return new Response(null, { status: 204 });
};
