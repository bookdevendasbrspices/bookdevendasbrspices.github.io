/* /api/usuarios — gestão de usuários (somente administradores).
   GET: lista usuários · POST: cria/atualiza {email, nome, cargo?, chave, admin?} · DELETE: {email} */
import { emailAutenticado, registroUsuarios, json } from "./_lib.js";

async function exigirAdmin(request, env) {
  const email = emailAutenticado(request, env);
  if (!email) return { erro: json({ erro: "nao_autenticado" }, 401) };
  const usuarios = await registroUsuarios(env);
  const eu = usuarios[email];
  if (!eu || !eu.admin) return { erro: json({ erro: "sem_permissao" }, 403) };
  return { email, usuarios };
}

export async function onRequestGet({ request, env }) {
  const ctx = await exigirAdmin(request, env);
  if (ctx.erro) return ctx.erro;
  return json({ usuarios: ctx.usuarios });
}

export async function onRequestPost({ request, env }) {
  const ctx = await exigirAdmin(request, env);
  if (ctx.erro) return ctx.erro;
  let corpo;
  try { corpo = await request.json(); } catch { return json({ erro: "json_invalido" }, 400); }
  const email = String(corpo.email || "").trim().toLowerCase();
  const nome = String(corpo.nome || "").trim();
  const chave = String(corpo.chave || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ erro: "email_invalido" }, 400);
  if (!nome) return json({ erro: "nome_obrigatorio" }, 400);
  // a chave de escopo precisa existir no cofre de dados
  if (!(await env.BOOK_DATA.get("dados:" + chave, { type: "stream" })))
    return json({ erro: "escopo_inexistente", chave }, 400);

  ctx.usuarios[email] = {
    nome, chave,
    cargo: corpo.cargo ? String(corpo.cargo).trim() : undefined,
    admin: !!corpo.admin,
    criado_por: ctx.email,
    criado_em: new Date().toISOString().slice(0, 16),
  };
  await env.BOOK_DATA.put("usuarios", JSON.stringify(ctx.usuarios));
  return json({ ok: true, email });
}

export async function onRequestDelete({ request, env }) {
  const ctx = await exigirAdmin(request, env);
  if (ctx.erro) return ctx.erro;
  let corpo;
  try { corpo = await request.json(); } catch { return json({ erro: "json_invalido" }, 400); }
  const email = String(corpo.email || "").trim().toLowerCase();
  if (!ctx.usuarios[email]) return json({ erro: "nao_encontrado" }, 404);
  if (email === ctx.email) return json({ erro: "nao_pode_excluir_a_si_mesmo" }, 400);
  delete ctx.usuarios[email];
  await env.BOOK_DATA.put("usuarios", JSON.stringify(ctx.usuarios));
  return json({ ok: true });
}
