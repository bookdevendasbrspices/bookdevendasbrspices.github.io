/* POST /api/logout → encerra a sessão. */
import { cookieLimpar, json } from "./_lib.js";

export async function onRequestPost() {
  return json({ ok: true }, 200, { "set-cookie": cookieLimpar() });
}
