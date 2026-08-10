// GET /goto?k=CODIGO
// Recebe o código digitado no <form> (GET puro, sem depender de JS — precisa
// funcionar no navegador antigo do Kobo/Kindle) e redireciona pra /s/CODIGO.

export const onRequestGet: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const code = (url.searchParams.get("k") || "").trim().toUpperCase();

  if (!/^[A-Z0-9]{3,10}$/.test(code)) {
    return new Response("Código inválido. Volte e confira os caracteres digitados.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return Response.redirect(new URL(`/s/${code}`, url.origin).toString(), 302);
};
