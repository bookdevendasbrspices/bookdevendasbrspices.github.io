/* /api/curva — base OFICIAL do RKG Itens (definição manual do Fernando).
   GET devolve a base vigente; POST grava uma nova (só o dono). */
import { emailSessao, json } from "./_lib.js";

const DONO = "fernando.oliveira.fer85@gmail.com";

export async function onRequestGet({ request, env }) {
  const email = await emailSessao(request, env);
  if (!email) return json({ erro: "nao_autenticado" }, 401);
  if (email.toLowerCase() !== DONO) return json({ erro: "restrito" }, 403);
  const raw = await env.BOOK_DATA.get("curva_oficial");
  return new Response(raw || "null",
    { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

export async function onRequestPost({ request, env }) {
  const email = await emailSessao(request, env);
  if (!email) return json({ erro: "nao_autenticado" }, 401);
  if (email.toLowerCase() !== DONO) return json({ erro: "restrito" }, 403);
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.itens) || !body.itens.length || body.itens.length > 2000)
    return json({ erro: "formato_invalido" }, 400);
  const reg = { itens: body.itens.slice(0, 1000), ts: new Date().toISOString(), por: email };
  await env.BOOK_DATA.put("curva_oficial", JSON.stringify(reg));
  return json({ ok: true, ts: reg.ts, itens: reg.itens.length });
}
