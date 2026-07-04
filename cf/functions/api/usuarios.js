/* /api/usuarios — gestão de usuários (somente administradores).
   GET: lista · POST: cria/atualiza {email, nome, cargo?, chave, admin?, senha?} · DELETE: {email}
   No POST, "senha" define/redefine a senha (opcional ao editar; obrigatória ao criar). */
import { emailSessao, registroUsuarios, salvarUsuarios, hashSenha, json } from "./_lib.js";

async function exigirAdmin(request, env) {
  const email = await emailSessao(request, env);
  if (!email) return { erro: json({ erro: "nao_autenticado" }, 401) };
  const usuarios = await registroUsuarios(env);
  const eu = usuarios[email];
  if (!eu || !eu.admin) return { erro: json({ erro: "sem_permissao" }, 403) };
  return { email, usuarios };
}

export async function onRequestGet({ request, env }) {
  const ctx = await exigirAdmin(request, env);
  if (ctx.erro) return ctx.erro;
  // não devolve hash/salt das senhas
  const publico = {};
  for (const [em, u] of Object.entries(ctx.usuarios))
    publico[em] = { nome: u.nome, cargo: u.cargo, chave: u.chave, admin: !!u.admin,
                    criado_por: u.criado_por, tem_senha: !!u.hash };
  return json({ usuarios: publico });
}

export async function onRequestPost({ request, env }) {
  const ctx = await exigirAdmin(request, env);
  if (ctx.erro) return ctx.erro;
  let corpo;
  try { corpo = await request.json(); } catch { return json({ erro: "json_invalido" }, 400); }
  const email = String(corpo.email || "").trim().toLowerCase();
  const nome = String(corpo.nome || "").trim();
  const chave = String(corpo.chave || "").trim();
  const senha = corpo.senha != null ? String(corpo.senha) : null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ erro: "email_invalido" }, 400);
  if (!nome) return json({ erro: "nome_obrigatorio" }, 400);
  if (!(await env.BOOK_DATA.get("dados:" + chave, { type: "stream" })))
    return json({ erro: "escopo_inexistente", chave }, 400);

  const existente = ctx.usuarios[email];
  if (!existente && !senha) return json({ erro: "senha_obrigatoria" }, 400);
  if (senha != null && senha.length < 6) return json({ erro: "senha_curta" }, 400);

  const u = existente || { criado_por: ctx.email, criado_em: new Date().toISOString().slice(0, 16) };
  u.nome = nome; u.chave = chave;
  u.cargo = corpo.cargo ? String(corpo.cargo).trim() : undefined;
  u.admin = !!corpo.admin;
  if (senha != null) { const h = await hashSenha(senha); u.salt = h.salt; u.hash = h.hash; }
  ctx.usuarios[email] = u;
  await salvarUsuarios(env, ctx.usuarios);
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
  await salvarUsuarios(env, ctx.usuarios);
  return json({ ok: true });
}
