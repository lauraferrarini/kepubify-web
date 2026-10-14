// GET /
// A raiz do site é "inteligente": se o navegador que está pedindo parece
// ser o de um Kobo ou Kindle, mostra direto a tela de "digite o código" (com
// QR de pareamento — ver _lib/pairing.ts). Qualquer outro navegador
// (computador, celular) recebe a página normal de enviar/converter, mas
// mantendo a URL "/" limpa (busca o conteúdo de app.html via o binding
// automático de assets do Pages).

import { receivePage } from "./_lib/receivePage";
import { getOrCreatePairing, clearPairingCookieHeader } from "./_lib/pairing";

export interface Env {
  ASSETS: Fetcher;
  SESSIONS: KVNamespace;
}

const EREADER_UA = /kobo|kindle/i;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const ua = context.request.headers.get("user-agent") || "";

  if (EREADER_UA.test(ua)) {
    const origin = new URL(context.request.url).origin;
    const pairing = await getOrCreatePairing(context.env, context.request);

    // O celular já vinculou uma sessão a este pareamento — pula direto pra
    // lista de arquivos, sem mostrar a tela de código/QR de novo.
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
  }

  // "/app" (sem extensão) é a URL "limpa" que o Pages resolve pra
  // app.html; pedir "/app.html" direto faz o ASSETS.fetch devolver um
  // redirect 308 em vez do conteúdo.
  const url = new URL(context.request.url);
  url.pathname = "/app";
  return context.env.ASSETS.fetch(new Request(url.toString(), context.request));
};
