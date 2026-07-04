/* Gestão de usuários — consome /api/usuarios e /api/escopos (restrito a admins). */
"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nomeVend = (v) => String(v ?? "").replace(/^\s*\d+\s*-\s*/, "");

function rotuloEscopo(chave) {
  if (chave === "gestor") return "VISÃO COMPLETA (empresa toda)";
  const [tipo, nome] = chave.split("|");
  return (tipo === "gerente" ? "Equipe do gerente " : "Carteira de ") + nomeVend(nome);
}

function erro(msg) {
  const el = $("adm-err");
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}

async function api(caminho, opcoes) {
  const res = await fetch(caminho, { cache: "no-store", ...opcoes });
  const corpo = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("Sessão expirada — recarregue a página.");
  if (res.status === 403) throw new Error("Seu e-mail não tem permissão de administração.");
  if (!res.ok) throw new Error(corpo.erro || ("Falha (" + res.status + ")"));
  return corpo;
}

async function carregar() {
  erro("");
  try {
    const [{ usuarios }, { escopos }] = await Promise.all([api("/api/usuarios"), api("/api/escopos")]);
    $("n-escopo").innerHTML =
      '<option value="gestor">VISÃO COMPLETA (empresa toda)</option>' +
      escopos.filter((e) => e.startsWith("gerente|")).map((e) => `<option value="${esc(e)}">Gerente — ${esc(nomeVend(e.split("|")[1]))}</option>`).join("") +
      escopos.filter((e) => e.startsWith("vendedor|")).map((e) => `<option value="${esc(e)}">Vendedor — ${esc(nomeVend(e.split("|")[1]))}</option>`).join("");
    const emails = Object.keys(usuarios).sort((a, b) => (usuarios[a].nome || "").localeCompare(usuarios[b].nome || "", "pt-BR"));
    $("adm-total").textContent = emails.length + " cadastrados";
    $("adm-lista").innerHTML = emails.map((em) => {
      const u = usuarios[em];
      return `<tr><td><b>${esc(u.nome)}</b></td><td>${esc(em)}</td>
        <td>${esc(rotuloEscopo(u.chave))}</td><td>${esc(u.cargo || "—")}</td>
        <td>${u.admin ? '<span class="pill p-warn">ADMIN</span>' : "—"}</td>
        <td style="color:var(--soft);font-size:11px">${esc(u.criado_por || "—")}</td>
        <td class="r" style="white-space:nowrap">
          <button class="reset" data-nova="${esc(em)}" style="color:var(--teal-d)">Nova senha</button>
          <button class="reset" data-del="${esc(em)}" style="color:var(--bad)">Remover</button></td></tr>`;
    }).join("") || '<tr><td colspan="7" class="empty">Nenhum usuário cadastrado.</td></tr>';
    document.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => remover(b.dataset.del)));
    document.querySelectorAll("[data-nova]").forEach((b) => b.addEventListener("click", () => novaSenha(b.dataset.nova, usuarios[b.dataset.nova])));
  } catch (e) { erro(e.message); }
}

async function incluir() {
  erro("");
  const corpo = {
    nome: $("n-nome").value.trim(),
    email: $("n-email").value.trim().toLowerCase(),
    senha: $("n-senha").value,
    chave: $("n-escopo").value,
    cargo: $("n-cargo").value.trim() || undefined,
    admin: $("n-admin").checked,
  };
  if (!corpo.nome) return erro("Informe o nome.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(corpo.email)) return erro("E-mail inválido.");
  if (!corpo.senha || corpo.senha.length < 6) return erro("Defina uma senha inicial (mínimo 6 caracteres).");
  const btn = $("btn-incluir");
  btn.disabled = true; btn.textContent = "Incluindo…";
  try {
    await api("/api/usuarios", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    $("n-nome").value = ""; $("n-email").value = ""; $("n-senha").value = ""; $("n-cargo").value = ""; $("n-admin").checked = false;
    await carregar();
  } catch (e) { erro(e.message); }
  finally { btn.disabled = false; btn.textContent = "+ Incluir"; }
}

async function novaSenha(email, u) {
  const senha = prompt(`Nova senha para ${u ? u.nome : email} (mínimo 6 caracteres):`);
  if (senha == null) return;
  if (senha.length < 6) return erro("A senha precisa ter ao menos 6 caracteres.");
  erro("");
  try {
    // reenvia o cadastro atual só trocando a senha
    await api("/api/usuarios", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, nome: u.nome, chave: u.chave, cargo: u.cargo, admin: u.admin, senha }) });
    alert(`Senha redefinida. Passe a nova senha para ${u.nome}.`);
  } catch (e) { erro(e.message); }
}

async function remover(email) {
  if (!confirm(`Remover o acesso de ${email}?\nA pessoa deixa de conseguir entrar no painel.`)) return;
  erro("");
  try {
    await api("/api/usuarios", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    await carregar();
  } catch (e) { erro(e.message); }
}

document.addEventListener("DOMContentLoaded", () => {
  $("btn-incluir").addEventListener("click", incluir);
  carregar();
});
