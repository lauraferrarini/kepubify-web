// Pareamento Kobo <-> celular via QR code, sem precisar digitar código.
//
// Quando o Kobo/Kindle abre a raiz do site, ganha um "pairId" aleatório
// (guardado num cookie, e também no KV com TTL curto). O QR mostrado nessa
// tela codifica "/app?pair=<pairId>". Ao escanear com o celular, a página de
// preparar/enviar carrega já sabendo desse pairId; quando a pessoa clica em
// "Gerar chave de envio" por lá, o pairId viaja junto pro /api/create-session,
// que grava a ligação pair:<pairId> -> sessionKey no mesmo KV.
//
// O Kobo, enquanto isso, fica recarregando a própria tela sozinho a cada
// poucos segundos (via <meta http-equiv="refresh">, sem JS nenhum). A cada
// recarregada, confere se a ligação já existe — se sim, redireciona direto
// pra /s/<sessionKey>, sem o usuário precisar digitar nada.

const COOKIE_NAME = "s2k_pair";
const PAIR_TTL_SECONDS = 600; // 10 min — tempo de sobra pra editar/converter no celular

export interface PairEnv {
  SESSIONS: KVNamespace;
}

interface PairRecord {
  sessionKey: string | null;
  createdAt: number;
}

function randomPairId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([a-zA-Z0-9]+)`));
  return match ? match[1] : null;
}

export interface PairingState {
  pairId: string;
  sessionKey: string | null;
  setCookieHeader: string | null; // null = cookie from the request is still valid, nothing to set
}

// Reads the pairing cookie off the request; if missing/expired, mints a new
// pairId and reserves it in KV. Always returns a usable pairId.
export async function getOrCreatePairing(env: PairEnv, request: Request): Promise<PairingState> {
  const existingId = readCookie(request, COOKIE_NAME);

  if (existingId) {
    const raw = await env.SESSIONS.get(`pair:${existingId}`);
    if (raw) {
      const record = JSON.parse(raw) as PairRecord;
      return { pairId: existingId, sessionKey: record.sessionKey, setCookieHeader: null };
    }
    // cookie present but the KV record expired/vanished — fall through and mint a new one
  }

  const pairId = randomPairId();
  const record: PairRecord = { sessionKey: null, createdAt: Date.now() };
  await env.SESSIONS.put(`pair:${pairId}`, JSON.stringify(record), { expirationTtl: PAIR_TTL_SECONDS });

  return {
    pairId,
    sessionKey: null,
    setCookieHeader: `${COOKIE_NAME}=${pairId}; Max-Age=${PAIR_TTL_SECONDS}; Path=/; SameSite=Lax`,
  };
}

// Called from /api/create-session once a session key exists, only when the
// request came in with a `pair` field. Links the two. Returns whether the
// pairing record still existed to link — the caller uses this to decide if
// it's honest to tell the phone "linked automatically", instead of claiming
// so when the pairing had already expired (e.g. the person took more than
// PAIR_TTL_SECONDS between scanning the QR and hitting send).
export async function linkPairing(env: PairEnv, pairId: string, sessionKey: string): Promise<boolean> {
  const raw = await env.SESSIONS.get(`pair:${pairId}`);
  if (!raw) return false; // pairing expired or never existed — the phone just shows the key as usual
  const record = JSON.parse(raw) as PairRecord;
  record.sessionKey = sessionKey;
  await env.SESSIONS.put(`pair:${pairId}`, JSON.stringify(record), { expirationTtl: PAIR_TTL_SECONDS });
  return true;
}

// Used by /pair-status, which the e-reader's page polls in the background.
// exists=false means the pairing record is gone (expired) — the page reloads
// itself to mint a fresh pairing and a fresh QR.
export async function getPairingStatus(
  env: PairEnv,
  pairId: string
): Promise<{ exists: boolean; sessionKey: string | null }> {
  const raw = await env.SESSIONS.get(`pair:${pairId}`);
  if (!raw) return { exists: false, sessionKey: null };
  const record = JSON.parse(raw) as PairRecord;
  return { exists: true, sessionKey: record.sessionKey };
}

// Clears the pairing cookie — used once we've redirected the Kobo to its
// linked session, so the next time it loads "/" it starts a fresh pairing
// instead of immediately re-redirecting to a session that's about to expire.
export function clearPairingCookieHeader(): string {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/`;
}
