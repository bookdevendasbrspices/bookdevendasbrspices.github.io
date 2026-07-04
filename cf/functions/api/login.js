/* POST /api/login {email, senha} → valida e cria a sessão (cookie persistente). */
import { registroUsuarios, verificaSenha, criarSessao, cookieSessao, json } from "./_lib.js";

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return json({ erro: "json_invalido" }, 400); }
  const email = String(b.email || "").trim().toLowerCase();
  const senha = String(b.senha || "");
  if (!email || !senha) return json({ erro: "faltam_campos" }, 400);

  // trava simples contra força bruta: 6 erros por e-mail em 15 min
  const chaveTent = "tent:" + email;
  const tent = parseInt(await env.BOOK_DATA.get(chaveTent) || "0", 10);
  if (tent >= 6) return json({ erro: "muitas_tentativas" }, 429);

  const us = await registroUsuarios(env);
  const u = us[email];
  const ok = u && u.hash && await verificaSenha(senha, u.salt, u.hash);
  if (!ok) {
    await env.BOOK_DATA.put(chaveTent, String(tent + 1), { expirationTtl: 900 });
    return json({ erro: "credenciais" }, 401);
  }
  await env.BOOK_DATA.delete(chaveTent);
  const token = await criarSessao(email, env.SESSION_SECRET);
  return json({ ok: true, nome: u.nome }, 200, { "set-cookie": cookieSessao(token) });
}
