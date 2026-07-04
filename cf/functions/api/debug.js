/* TEMPORÁRIO: diagnóstico de bindings — remover antes do corte final. */
export async function onRequestGet({ env }) {
  const info = { bindings: Object.keys(env), temKV: !!env.BOOK_DATA, debugVar: env.DEBUG_EMAIL || null };
  if (env.BOOK_DATA) {
    try {
      const u = await env.BOOK_DATA.get("usuarios");
      info.usuarios = u ? "existe (" + u.length + " chars)" : "NULL";
      const lista = await env.BOOK_DATA.list({ limit: 10 });
      info.chaves = lista.keys.map((k) => k.name);
      await env.BOOK_DATA.put("teste-function", new Date().toISOString());
      info.escreveu = "teste-function gravado";
    } catch (e) { info.kvErro = String(e); }
  }
  return new Response(JSON.stringify(info), { headers: { "content-type": "application/json" } });
}
