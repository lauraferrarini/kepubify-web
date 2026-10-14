// GET /pair-status?id=<pairId>
// A tela do e-reader (ver _lib/receivePage.ts) pergunta aqui, em segundo
// plano, se o celular já vinculou uma sessão ao pareamento dela. Isso evita
// recarregar a página inteira — o que apagaria a chave que a pessoa estiver
// digitando no campo.
//
// Resposta (text/plain, simples de ler até em navegador antigo):
//   200 + ""        → ainda esperando o celular
//   200 + "AB3D"    → vinculado; é a chave da sessão (e o cookie de
//                     pareamento é limpo, pra próxima visita começar do zero)
//   410             → o pareamento expirou; a página recarrega sozinha

import { getPairingStatus, clearPairingCookieHeader } from "./_lib/pairing";

export interface Env {
  SESSIONS: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = new URL(context.request.url).searchParams.get("id") || "";
  const headers: Record<string, string> = {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  };

  if (!/^[a-f0-9]{16}$/.test(id)) {
    return new Response("", { status: 400, headers });
  }

  const status = await getPairingStatus(context.env, id);
  if (!status.exists) return new Response("", { status: 410, headers });

  if (status.sessionKey) {
    headers["set-cookie"] = clearPairingCookieHeader();
    return new Response(status.sessionKey, { status: 200, headers });
  }
  return new Response("", { status: 200, headers });
};
