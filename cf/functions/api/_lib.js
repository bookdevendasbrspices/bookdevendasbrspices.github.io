/* Utilidades compartilhadas das funções da API. */

export function emailAutenticado(request) {
  // O Cloudflare Access injeta o e-mail autenticado neste cabeçalho.
  const email = request.headers.get("cf-access-authenticated-user-email");
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
