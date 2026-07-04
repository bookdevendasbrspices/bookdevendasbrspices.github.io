/* GET /api/dados — devolve o recorte de dados do e-mail autenticado. */
import { emailAutenticado, registroUsuarios, json } from "./_lib.js";

export async function onRequestGet({ request, env }) {
  const email = emailAutenticado(request, env);
  if (!email) return json({ erro: "nao_autenticado" }, 401);

  const usuarios = await registroUsuarios(env);
  const u = usuarios[email];
  if (!u) return json({ erro: "nao_cadastrado", email }, 403);

  const raw = await env.BOOK_DATA.get("dados:" + u.chave);
  if (!raw) return json({ erro: "dados_indisponiveis", chave: u.chave }, 503);

  const dados = JSON.parse(raw);
  // identidade exibida vem do cadastro (não do arquivo de escopo)
  dados.escopo = {
    ...dados.escopo,
    nome: u.nome || dados.escopo.nome,
    cargo: u.cargo || dados.escopo.cargo,
    email,
    admin: !!u.admin,
  };
  return json(dados);
}
