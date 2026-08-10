// GET /receber
// Atalho manual pra tela de "digite o código", independente do
// User-Agent — útil pra testar no computador, ou como retrocesso se a
// detecção automática em "/" não reconhecer algum modelo de e-reader.

import { receivePage } from "./_lib/receivePage";

export const onRequestGet: PagesFunction = async () => {
  return receivePage();
};
