// Worker separado, com Cron Trigger, que roda a cada 5 minutos.
// A sessão em si já expira sozinha no KV (expirationTtl), mas o KV
// expirando não apaga os objetos correspondentes no R2 — este worker é
// a rede de segurança que faz essa limpeza, listando o prefixo
// "sessions/" e apagando qualquer objeto além da margem de idade.

export interface Env {
  FILES: R2Bucket;
}

// margem de segurança acima do TTL de 5 minutos das sessões
const MAX_AGE_MS = 6 * 60 * 1000;

export default {
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const now = Date.now();
    let cursor: string | undefined;
    let deleted = 0;

    do {
      const listing = await env.FILES.list({ prefix: "sessions/", cursor });
      const stale = listing.objects.filter((o) => now - o.uploaded.getTime() > MAX_AGE_MS);
      await Promise.all(stale.map((o) => env.FILES.delete(o.key)));
      deleted += stale.length;
      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor);

    console.log(`cron-cleanup: removidos ${deleted} objeto(s) expirado(s) do R2`);
  },
};
