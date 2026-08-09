// POST /api/create-session
// Recebe vários arquivos de uma vez (multipart/form-data, campo "files"),
// grava cada um no Workers KV (mesmo namespace das sessões) e devolve uma
// chave curta + prazo de expiração. Tudo (metadados e bytes dos arquivos)
// usa expirationTtl — o próprio KV apaga tudo sozinho depois do prazo, sem
// precisar de nenhum worker de limpeza adicional.
//
// Por não depender de R2, não é preciso ativar/pagar nada além do KV
// (que já vem liberado em qualquer conta Cloudflare). A troca é um limite
// de tamanho por arquivo: o KV aceita no máximo ~25MB por valor.

export interface Env {
  SESSIONS: KVNamespace;
}

// alfabeto sem 0/O, 1/I/L — pra não confundir no teclado do e-reader
const KEY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const KEY_LENGTH = 6;
export const TTL_SECONDS = 300; // 5 minutos
const MAX_FILES = 15;
const MAX_FILE_BYTES = 24 * 1024 * 1024; // 24MB — limite de valor do Workers KV é 25MB
const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // 100MB por sessão

interface FileMeta {
  name: string;
  kvKey: string;
  size: number;
  type: string;
}

interface SessionRecord {
  createdAt: number;
  expiresAt: number;
  files: FileMeta[];
}

function randomKey(): string {
  const bytes = new Uint8Array(KEY_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < KEY_LENGTH; i++) out += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return out;
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[/\\?%*:|"<>]/g, "_").trim();
  return cleaned.slice(0, 200) || "arquivo";
}

function contentTypeFor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".kepub.epub") || lower.endsWith(".epub")) return "application/epub+zip";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".cbz")) return "application/vnd.comicbook+zip";
  if (lower.endsWith(".cbr")) return "application/vnd.comicbook-rar";
  if (lower.endsWith(".mobi")) return "application/x-mobipocket-ebook";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "corpo inválido — esperado multipart/form-data" }, 400);
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return json({ error: "nenhum arquivo enviado" }, 400);
  if (files.length > MAX_FILES) {
    return json({ error: `máximo de ${MAX_FILES} arquivos por envio` }, 400);
  }

  const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
  if (tooBig) {
    return json(
      { error: `"${tooBig.name}" tem ${(tooBig.size / 1024 / 1024).toFixed(1)}MB — o limite por arquivo é ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB` },
      400
    );
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return json({ error: `o total dos arquivos excede ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB` }, 400);
  }

  // gera uma chave e confirma que não está em uso (tentativa simples, colisão é raríssima)
  let key = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = randomKey();
    const existing = await env.SESSIONS.get(`sess:${candidate}`);
    if (!existing) {
      key = candidate;
      break;
    }
  }
  if (!key) return json({ error: "não foi possível gerar uma chave livre, tente novamente" }, 500);

  const now = Date.now();
  const expiresAt = now + TTL_SECONDS * 1000;

  const fileMetas: FileMeta[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const safeName = sanitizeFilename(file.name);
    const type = contentTypeFor(safeName);
    const kvKey = `file:${key}:${i}`;
    await env.SESSIONS.put(kvKey, await file.arrayBuffer(), { expirationTtl: TTL_SECONDS });
    fileMetas.push({ name: safeName, kvKey, size: file.size, type });
  }

  const record: SessionRecord = { createdAt: now, expiresAt, files: fileMetas };
  await env.SESSIONS.put(`sess:${key}`, JSON.stringify(record), { expirationTtl: TTL_SECONDS });

  return json({ key, expiresAt, deviceUrl: `/s/${key}` });
};
