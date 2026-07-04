/* Utilidades das Functions: sessão (cookie assinado), senha (PBKDF2) e KV. */

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};

/* ---------------- senha (PBKDF2-SHA256, 100k) ---------------- */
export async function hashSenha(senha, saltB64) {
  const salt = saltB64 ? fromB64url(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return { salt: b64url(salt), hash: b64url(bits) };
}
export async function verificaSenha(senha, saltB64, hashB64) {
  if (!saltB64 || !hashB64) return false;
  const { hash } = await hashSenha(senha, saltB64);
  // comparação de tempo ~constante
  if (hash.length !== hashB64.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ hashB64.charCodeAt(i);
  return diff === 0;
}

/* ---------------- sessão (cookie assinado HMAC-SHA256) ---------------- */
const DIAS_SESSAO = 180;
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function criarSessao(email, secret) {
  const payload = { e: email, exp: Date.now() + DIAS_SESSAO * 864e5 };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return body + "." + b64url(sig);
}
export async function lerSessao(token, secret) {
  if (!token || token.indexOf(".") < 0) return null;
  const [body, sig] = token.split(".");
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(dec.decode(fromB64url(body)));
    return p.exp > Date.now() ? p.e : null;
  } catch { return null; }
}
export const cookieSessao = (token) =>
  `bv_sess=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DIAS_SESSAO * 86400}`;
export const cookieLimpar = () =>
  "bv_sess=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";

function getCookie(request, nome) {
  const c = request.headers.get("cookie") || "";
  const m = c.match(new RegExp("(?:^|; )" + nome + "=([^;]+)"));
  return m ? m[1] : null;
}
export async function emailSessao(request, env) {
  const token = getCookie(request, "bv_sess");
  return token ? lerSessao(token, env.SESSION_SECRET) : null;
}

/* ---------------- KV + resposta ---------------- */
export async function registroUsuarios(env) {
  const raw = await env.BOOK_DATA.get("usuarios");
  return raw ? JSON.parse(raw) : {};
}
export const salvarUsuarios = (env, us) => env.BOOK_DATA.put("usuarios", JSON.stringify(us));

export const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
