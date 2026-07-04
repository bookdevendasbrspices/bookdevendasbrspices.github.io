/* POST /api/senha {senhaAtual, senhaNova} → o próprio usuário troca a senha. */
import { emailSessao, registroUsuarios, salvarUsuarios, verificaSenha, hashSenha, json } from "./_lib.js";

export async function onRequestPost({ request, env }) {
  const email = await emailSessao(request, env);
  if (!email) return json({ erro: "nao_autenticado" }, 401);
  let b;
  try { b = await request.json(); } catch { return json({ erro: "json_invalido" }, 400); }
  const atual = String(b.senhaAtual || "");
  const nova = String(b.senhaNova || "");
  if (nova.length < 6) return json({ erro: "senha_curta" }, 400);

  const us = await registroUsuarios(env);
  const u = us[email];
  if (!u) return json({ erro: "nao_cadastrado" }, 403);
  if (!await verificaSenha(atual, u.salt, u.hash)) return json({ erro: "senha_atual_incorreta" }, 401);

  const { salt, hash } = await hashSenha(nova);
  u.salt = salt; u.hash = hash;
  await salvarUsuarios(env, us);
  return json({ ok: true });
}
