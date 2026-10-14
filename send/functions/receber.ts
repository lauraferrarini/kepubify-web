// GET /receber
// Atalho manual pra tela de "digite o código", independente do
// User-Agent — útil pra testar no computador, ou como retrocesso se a
// detecção automática em "/" não reconhecer algum modelo de e-reader.

import { receivePage } from "./_lib/receivePage";
import { getOrCreatePairing, clearPairingCookieHeader } from "./_lib/pairing";

export interface Env {
  SESSIONS: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const origin = new URL(context.request.url).origin;
  const pairing = await getOrCreatePairing(context.env, context.request);

  if (pairing.sessionKey) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/s/${pairing.sessionKey}`, "Set-Cookie": clearPairingCookieHeader() },
    });
  }

  const page = receivePage(origin, pairing.pairId);
  if (pairing.setCookieHeader) {
    const headers = new Headers(page.headers);
    headers.append("Set-Cookie", pairing.setCookieHeader);
    return new Response(page.body, { status: page.status, headers });
  }
  return page;
};
