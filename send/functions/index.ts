// GET /
// A raiz do site é "inteligente": se o navegador que está pedindo parece
// ser o de um Kobo ou Kindle, mostra direto a tela de "digite o código"
// (é o que interessa pra quem está no e-reader). Qualquer outro navegador
// (computador, celular) recebe a página normal de enviar/converter, mas
// mantendo a URL "/" limpa (busca o conteúdo de app.html via o binding
// automático de assets do Pages).

import { receivePage } from "./_lib/receivePage";

export interface Env {
  ASSETS: Fetcher;
}

const EREADER_UA = /kobo|kindle/i;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const ua = context.request.headers.get("user-agent") || "";

  if (EREADER_UA.test(ua)) {
    return receivePage();
  }

  // "/app" (sem extensão) é a URL "limpa" que o Pages resolve pra
  // app.html; pedir "/app.html" direto faz o ASSETS.fetch devolver um
  // redirect 308 em vez do conteúdo.
  const url = new URL(context.request.url);
  url.pathname = "/app";
  return context.env.ASSETS.fetch(new Request(url.toString(), context.request));
};
