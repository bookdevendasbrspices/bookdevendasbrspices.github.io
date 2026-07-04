/* GET /api/escopos — lista as visões disponíveis p/ o formulário do admin. */
import { emailAutenticado, registroUsuarios, json } from "./_lib.js";

export async function onRequestGet({ request, env }) {
  const email = emailAutenticado(request, env);
  if (!email) return json({ erro: "nao_autenticado" }, 401);
  const usuarios = await registroUsuarios(env);
  if (!usuarios[email] || !usuarios[email].admin) return json({ erro: "sem_permissao" }, 403);

  const escopos = [];
  let cursor;
  do {
    const pagina = await env.BOOK_DATA.list({ prefix: "dados:", cursor });
    for (const k of pagina.keys) escopos.push(k.name.slice(6));
    cursor = pagina.list_complete ? null : pagina.cursor;
  } while (cursor);
  escopos.sort();
  return json({ escopos });
}
