/* Utilidades compartilhadas das funções da API. */

export function emailAutenticado(request, env) {
  // O Cloudflare Access injeta o e-mail autenticado neste cabeçalho.
  let email = request.headers.get("cf-access-authenticated-user-email");
  // Modo de teste (removido no corte final): exige o segredo correto p/ simular e-mail.
  if (!email && env.DEBUG_EMAIL && env.DEBUG_EMAIL.length > 20 &&
      request.headers.get("x-debug-secret") === env.DEBUG_EMAIL)
    email = request.headers.get("x-debug-email");
  return email ? email.trim().toLowerCase() : null;
}

export async function registroUsuarios(env) {
  const raw = await env.BOOK_DATA.get("usuarios");
  return raw ? JSON.parse(raw) : {};
}

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
