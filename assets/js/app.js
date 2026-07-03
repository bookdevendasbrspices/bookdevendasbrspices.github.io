/* Book de Vendas BR Spices — app v1 (Fase 2/3)
   Login: senha → SHA-256 → data/<hash16>.enc.json → PBKDF2-SHA256 + AES-GCM (WebCrypto).
   Nenhum dado aberto sai do navegador; a senha nunca é enviada a lugar algum. */
"use strict";

const S = { data: null, fGer: "", fVend: "", nPos: 100, nCli: 50, fStatus: "", busca: "", buscaMeta: "" };
const $ = (id) => document.getElementById(id);
const MESES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

/* ---------------- formatação ---------------- */
const fmtBR = (v, d = 0) => (v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
function fmtM(v) {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return "R$ " + fmtBR(v / 1e6, 1) + "M";
  if (a >= 1e3) return "R$ " + fmtBR(v / 1e3, 0) + "K";
  return "R$ " + fmtBR(v, 0);
}
function fmtK(v) {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return fmtBR(v / 1e6, 1) + "M";
  if (a >= 1e3) return fmtBR(v / 1e3, 1) + "K";
  return fmtBR(v, 0);
}
const fmtPct = (x, d = 1) => x == null ? "—" : fmtBR(x * 100, d) + "%";
function fmtData(iso) {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* nome do vendedor sem o prefixo numérico ("042 - WAGNER TORTELLI" → "WAGNER TORTELLI") */
const nomeVend = (v) => String(v ?? "").replace(/^\s*\d+\s*-\s*/, "");

/* ---------------- criptografia ---------------- */
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function sha256hex(txt) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function decriptar(payload, senha) {
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64d(payload.salt), iterations: payload.iter, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(payload.iv) }, key, b64d(payload.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function entrar() {
  const senha = $("pw").value.trim();
  const err = $("lerr"), btn = $("lbtn");
  err.style.display = "none";
  if (!senha) return;
  btn.disabled = true; btn.textContent = "Abrindo…";
  try {
    if (!crypto.subtle) throw new Error("Este navegador não suporta criptografia (use HTTPS).");
    const hash = await sha256hex(senha);
    const res = await fetch("data/" + hash.slice(0, 16) + ".enc.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Senha não encontrada. Confira e tente de novo.");
    const payload = await res.json();
    S.data = await decriptar(payload, senha);
    sessionStorage.setItem("bv_dados", JSON.stringify(S.data));
    boot();
  } catch (e) {
    err.textContent = e.name === "OperationError" ? "Senha incorreta." : (e.message || "Falha ao abrir os dados.");
    err.style.display = "block";
  } finally {
    btn.disabled = false; btn.textContent = "Entrar no Book de Vendas";
  }
}

function sair() {
  sessionStorage.removeItem("bv_dados");
  location.reload();
}

/* ---------------- boot ---------------- */
function boot() {
  const d = S.data;
  $("login").style.display = "none";
  $("app").classList.add("on");

  const perfilTxt = d.escopo.cargo ||
    ({ gestor: "GESTÃO — VÊ TUDO", gerente: "GERENTE — SUA EQUIPE", vendedor: "VENDEDOR — SUA CARTEIRA" }[d.escopo.perfil] || d.escopo.perfil);
  $("who-nome").textContent = d.escopo.nome;
  $("who-email").textContent = d.escopo.email || "";
  $("who-pill").textContent = "PERFIL: " + perfilTxt;
  const mesNome = MESES[d.periodo.mes_atual - 1];
  $("hchip").innerHTML = `📅 <b>${d.periodo.ano} · YTD (jan–${mesNome})</b> · atualizado <b>${fmtData(d.atualizado_ate)}</b>`;
  $("chip-periodo").textContent = `${d.periodo.ano} · YTD (jan–${mesNome}) · dados até ${fmtData(d.atualizado_ate)}`;

  // filtros por perfil
  const gers = [...new Set(d.positivados.map((p) => p.ger))].filter(Boolean).sort();
  if (d.escopo.perfil === "gestor") preencherSelect("f-ger", gers);
  else $("f-ger-wrap").style.display = "none";
  if (d.escopo.perfil === "vendedor") $("f-vend-wrap").style.display = "none";
  else atualizarVendSelect();

  renderAll();
}

function preencherSelect(id, itens, labelFn) {
  const el = $(id);
  el.innerHTML = '<option value="">Todos</option>' +
    itens.map((x) => `<option value="${esc(x)}">${esc(labelFn ? labelFn(x) : x)}</option>`).join("");
}

/* o combo de vendedores mostra só quem pertence ao gerente filtrado */
function atualizarVendSelect() {
  if ($("f-vend-wrap").style.display === "none") return;
  const base = S.fGer ? S.data.positivados.filter((p) => p.ger === S.fGer) : S.data.positivados;
  const vends = [...new Set(base.map((p) => p.vend))].filter(Boolean)
    .sort((a, b) => nomeVend(a).localeCompare(nomeVend(b), "pt-BR"));
  preencherSelect("f-vend", vends, nomeVend);
  $("f-vend").value = vends.includes(S.fVend) ? S.fVend : "";
  S.fVend = $("f-vend").value;
}

function onFiltro() {
  S.fGer = $("f-ger-wrap").style.display === "none" ? "" : $("f-ger").value;
  S.fVend = $("f-vend-wrap").style.display === "none" ? "" : $("f-vend").value;
  atualizarVendSelect();
  S.nPos = 100; S.nCli = 50;
  renderAll();
}

function resetar() {
  if ($("f-ger")) $("f-ger").value = "";
  if ($("f-vend")) $("f-vend").value = "";
  S.fStatus = ""; S.busca = ""; S.buscaMeta = "";
  $("busca-pos").value = ""; $("busca-meta").value = "";
  onFiltro();
}

/* ---------------- dados filtrados ---------------- */
function linhas() {
  let r = S.data.positivados;
  if (S.fGer) r = r.filter((p) => p.ger === S.fGer);
  if (S.fVend) r = r.filter((p) => p.vend === S.fVend);
  return r;
}
const filtrado = () => !!(S.fGer || S.fVend);

function agrupar(rows, campo) {
  const g = {};
  for (const p of rows) {
    const k = p[campo] || "SEM CADASTRO";
    const o = (g[k] ??= { nome: k, meta_ytd: 0, meta_ano: 0, realizado: 0, realizado_ly: 0, clientes: 0, positivados: 0 });
    o.meta_ytd += p.meta_ytd; o.meta_ano += p.meta_ano;
    o.realizado += p.fat_ytd; o.realizado_ly += p.fat_ly;
    o.clientes++; if (p.status === "ok") o.positivados++;
  }
  return Object.values(g).map((o) => (o.ating = o.meta_ytd ? o.realizado / o.meta_ytd : null, o))
    .sort((a, b) => b.realizado - a.realizado);
}

/* ---------------- render ---------------- */
function renderAll() {
  const rows = linhas();
  renderChipFiltro();
  renderKpis(rows);
  renderEvolucao(rows);
  renderSemaforo(rows);
  renderFamilias();
  renderMetas(rows);
  renderPositivados(rows);
  renderRankings(rows);
}

function renderChipFiltro() {
  const f = [];
  if (S.fGer) f.push("Gerente: " + S.fGer);
  if (S.fVend) f.push("Vendedor: " + nomeVend(S.fVend));
  $("chip-filtro").textContent = f.length ? f.join(" · ") : "";
  $("chip-filtro").style.display = f.length ? "" : "none";
}

function kpiCard(icone, cor, titulo, valor, detalhe) {
  return `<div class="kpi"><div class="hd"><div class="ic" style="background:${cor}22">${icone}</div>
    <div class="t">${titulo}</div></div><div class="v">${valor}</div><div class="d">${detalhe}</div></div>`;
}

const IC = {
  fat: '<svg viewBox="0 0 24 24" fill="none" stroke="#2f7d7c" stroke-width="2"><path d="M3 17l5-5 4 4 8-8"/><path d="M14 8h6v6"/></svg>',
  meta: '<svg viewBox="0 0 24 24" fill="none" stroke="#b57f22" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
  vol: '<svg viewBox="0 0 24 24" fill="none" stroke="#7d7a2e" stroke-width="2"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="#4f9aa0" stroke-width="2"><path d="M4 7h16v13H4zM8 7V4h8v3"/></svg>',
  dev: '<svg viewBox="0 0 24 24" fill="none" stroke="#C96643" stroke-width="2"><path d="M9 14l-4-4 4-4"/><path d="M5 10h11a4 4 0 010 8h-2"/></svg>',
  pos: '<svg viewBox="0 0 24 24" fill="none" stroke="#5d8756" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 11l2 2 4-4"/></svg>',
};

function renderKpis(rows) {
  const d = S.data, k = d.kpis;
  let fat, ly, lyLabel, meta, base, posit, cresc;
  if (!filtrado()) {
    fat = k.fat_liq_ytd; ly = k.fat_liq_ly_mp; lyLabel = "vs 2025 (mesmo período)";
    meta = k.meta_ytd; base = k.clientes_base; posit = k.positivados_mes;
    cresc = k.cresc_ytd;
  } else {
    fat = rows.reduce((s, p) => s + p.fat_ytd, 0);
    ly = rows.reduce((s, p) => s + p.fat_ly, 0); lyLabel = "vs 2025 (ano cheio)";
    meta = rows.reduce((s, p) => s + p.meta_ytd, 0);
    base = rows.filter((p) => p.meta_ano > 0 || p.fat_ytd !== 0).length;
    posit = rows.filter((p) => p.status === "ok").length;
    cresc = ly > 0 ? (fat - ly) / ly : null;
  }
  const ating = meta ? fat / meta : null;
  const crescPill = cresc == null ? "" :
    `<span class="dl ${cresc >= 0 ? "up" : "dn"}">${cresc >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(cresc))}</span> `;
  const atingCor = ating == null ? "" : ating >= 1 ? "var(--ok)" : ating >= 0.9 ? "var(--warn)" : "var(--bad)";
  const gap = meta ? fat - meta : null;
  const esc0 = filtrado() ? '<span style="color:var(--soft)">escopo total (sem filtro)</span>' : "";

  $("kpis").innerHTML =
    kpiCard(IC.fat, "#2f7d7c", "Faturamento<br>líquido YTD", fmtM(fat), crescPill + lyLabel + ` (${fmtM(ly)})`) +
    kpiCard(IC.meta, "#E0A339", "Atingimento<br>da meta YTD",
      `<span style="color:${atingCor}">${fmtPct(ating)}</span>`,
      meta ? `meta ${fmtM(meta)} · ${gap >= 0 ? "sobra" : "gap"} <b style="color:${gap >= 0 ? "var(--ok)" : "var(--bad)"}">${fmtM(Math.abs(gap))}</b>` : "sem meta cadastrada") +
    (filtrado()
      ? kpiCard(IC.vol, "#9B9741", "Clientes<br>na seleção", fmtBR(rows.length), "clientes no filtro atual")
      : kpiCard(IC.vol, "#9B9741", "Volume<br>(caixas)", fmtK(k.qtd_liq_ytd), "caixas líquidas no ano")) +
    kpiCard(IC.cart, "#4f9aa0", "Pedidos<br>em carteira", filtrado() ? "—" : fmtM(k.carteira), filtrado() ? esc0 : "snapshot " + fmtData(d.atualizado_ate)) +
    kpiCard(IC.dev, "#C96643", "Devolução<br>" + d.periodo.ano, filtrado() ? "—" : fmtM(k.devolucao),
      filtrado() ? esc0 : (k.fat_liq_ytd ? fmtPct(k.devolucao / (k.fat_liq_ytd + k.devolucao)) + " do faturamento bruto" : "")) +
    kpiCard(IC.pos, "#8AAB83", "Positivados<br>no mês", `${fmtBR(posit)}<small>/${fmtBR(base)}</small>`,
      base ? `<b style="color:var(--teal-d)">${fmtPct(posit / base)}</b> da base ativa` : "");
}

function renderEvolucao(rows) {
  const d = S.data;
  let itens, temMeta, temLy, titulo;
  if (!filtrado()) {
    itens = d.evolucao.map((e) => ({ label: e.mes, fat: e.fat, ly: e.fat_ly, meta: e.meta }));
    temMeta = itens.some((i) => i.meta > 0); temLy = true;
    titulo = "Evolução mensal — Realizado × Meta × " + (d.periodo.ano - 1);
  } else {
    // com filtro: soma o histórico de 7 meses por cliente
    const n = 7, mAtual = d.periodo.mes_atual, ano = d.periodo.ano;
    itens = [];
    for (let kIdx = n - 1; kIdx >= 0; kIdx--) {
      const idx = ano * 12 + mAtual - kIdx - 1;
      const mes = idx % 12, a = Math.floor(idx / 12);
      itens.push({ label: MESES[mes] + (a !== ano ? "/" + String(a).slice(2) : ""), fat: 0 });
    }
    for (const p of rows) for (let i = 0; i < n; i++) itens[i].fat += p.hist[i] || 0;
    temMeta = false; temLy = false;
    titulo = "Evolução — últimos 7 meses (filtro aplicado)";
  }
  $("evo-titulo").innerHTML = titulo + ' <span class="rg">R$</span>';
  $("evo-chart").innerHTML = svgBarras(itens, temLy, temMeta);
  $("evo-leg").innerHTML =
    `<span><i style="background:linear-gradient(180deg,#74AFAE,#2f7d7c)"></i>Realizado ${d.periodo.ano}</span>` +
    (temLy ? `<span><i style="background:#dde3e5"></i>${d.periodo.ano - 1}</span>` : "") +
    (temMeta ? `<span><i style="background:#C96643"></i>Meta (linha)</span>` : "") +
    `<span style="margin-left:auto">${MESES[d.periodo.mes_atual - 1]} = parcial</span>`;
}

function svgBarras(itens, temLy, temMeta) {
  const W = 640, H = 216, base = 190, topo = 16;
  const n = itens.length, passo = W / n;
  const max = Math.max(1, ...itens.map((i) => Math.max(i.fat || 0, i.ly || 0, i.meta || 0)));
  const y = (v) => base - (v / max) * (base - topo);
  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%">`;
  s += '<g stroke="#eef1f2" stroke-width="1">';
  for (let i = 1; i <= 4; i++) s += `<line x1="0" y1="${topo + (base - topo) * i / 4}" x2="${W}" y2="${topo + (base - topo) * i / 4}"/>`;
  s += "</g>";
  // rótulo do teto da escala
  s += `<text x="4" y="${topo - 3}" font-size="9.5" fill="#8a979d">${fmtK(max)}</text>`;
  s += '<g font-size="10" fill="#8a979d" text-anchor="middle">';
  itens.forEach((it, i) => { s += `<text x="${passo * i + passo / 2}" y="${H - 6}">${esc(it.label)}</text>`; });
  s += "</g>";
  if (temLy) {
    s += '<g fill="#dde3e5">';
    itens.forEach((it, i) => {
      const h = base - y(it.ly || 0);
      s += `<rect x="${passo * i + passo * 0.14}" y="${y(it.ly || 0)}" width="${passo * 0.26}" height="${h}" rx="2"/>`;
    });
    s += "</g>";
  }
  s += '<defs><linearGradient id="gt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#74AFAE"/><stop offset="1" stop-color="#2f7d7c"/></linearGradient></defs>';
  s += '<g fill="url(#gt)">';
  itens.forEach((it, i) => {
    if (!(it.fat > 0)) return;
    const x0 = temLy ? passo * i + passo * 0.44 : passo * i + passo * 0.22;
    const wB = temLy ? passo * 0.3 : passo * 0.56;
    s += `<rect x="${x0}" y="${y(it.fat)}" width="${wB}" height="${base - y(it.fat)}" rx="3"><title>${esc(it.label)}: ${fmtM(it.fat)}</title></rect>`;
  });
  s += "</g>";
  if (temMeta) {
    const pts = itens.map((it, i) => it.meta > 0 ? `${passo * i + passo / 2},${y(it.meta)}` : null);
    let seg = [];
    const segs = [];
    pts.forEach((p) => { if (p) seg.push(p); else if (seg.length) { segs.push(seg); seg = []; } });
    if (seg.length) segs.push(seg);
    for (const sg of segs)
      s += `<polyline points="${sg.join(" ")}" fill="none" stroke="#C96643" stroke-width="2.2" stroke-dasharray="6 5" stroke-linecap="round"/>`;
  }
  return s + "</svg>";
}

const ST = {
  ok: { pill: "p-ok", nome: "Comprou no mês" },
  atencao: { pill: "p-warn", nome: "Atenção · 1 mês" },
  validar: { pill: "p-val", nome: "Validar · 2 meses" },
  acionar: { pill: "p-bad", nome: "Acionar agora" },
};

function renderSemaforo(rows) {
  const c = { ok: 0, atencao: 0, validar: 0, acionar: 0 };
  let risco = 0;
  for (const p of rows) { c[p.status] = (c[p.status] || 0) + 1; risco += p.perdido_estim || 0; }
  const tot = rows.length || 1;
  $("semaforo").innerHTML = ["ok", "atencao", "validar", "acionar"].map((st) =>
    `<tr><td><span class="pill ${ST[st].pill}">${ST[st].nome}</span></td>
     <td class="r"><b>${fmtBR(c[st])}</b></td>
     <td class="r" style="color:var(--soft)">${fmtPct(c[st] / tot, 0)}</td></tr>`).join("");
  $("nota-risco").innerHTML = risco > 0
    ? `💡 <b>${fmtM(risco)}</b> estimados em risco nos clientes parados — priorize a página <b>Positivados</b>.`
    : "✅ Sem valor relevante em risco no momento.";
}

function renderFamilias() {
  const fams = (S.data.rankings.familias || []).slice(0, 3);
  $("familias-mini").innerHTML = fams.map((f, i) =>
    `<li><span class="n">${i + 1}</span><span class="nm">${esc(f.nome)}</span><span class="vl">${fmtM(f.fat)}</span></li>`).join("");
}

/* ---------- Metas ---------- */
function linhaMetaTabela(o) {
  const at = o.ating;
  const pct = at == null ? "—" : fmtPct(at, 0);
  const cor = at == null ? "var(--soft)" : at >= 1 ? "var(--ok)" : at >= 0.9 ? "var(--txt)" : at >= 0.8 ? "var(--warn)" : "var(--bad)";
  const cls = at == null ? "" : at >= 0.9 ? "" : at >= 0.8 ? "gold" : "red";
  const w = at == null ? 0 : Math.min(100, at * 100);
  const gap = o.meta_ytd ? o.realizado - o.meta_ytd : null;
  return `<tr><td><b>${esc(nomeVend(o.nome))}</b></td>
    <td class="r">${fmtM(o.meta_ytd)}</td><td class="r">${fmtM(o.realizado)}</td>
    <td><div class="bar"><i class="${cls}" style="width:${w}%"></i></div></td>
    <td class="r" style="color:${cor}"><b>${pct}</b></td>
    <td class="r" style="color:${gap == null ? "var(--soft)" : gap >= 0 ? "var(--ok)" : "var(--bad)"}">${gap == null ? "—" : (gap >= 0 ? "+" : "−") + fmtM(Math.abs(gap))}</td></tr>`;
}

function renderMetas(rows) {
  const d = S.data;
  // nível 1: gerentes (gestor sem filtro) ou vendedores
  let titulo, grupos;
  if (d.escopo.perfil === "gestor" && !S.fGer && !S.fVend) {
    titulo = "Por gerente — YTD " + d.periodo.ano; grupos = agrupar(rows, "ger");
  } else if (d.escopo.perfil !== "vendedor" && !S.fVend) {
    titulo = "Por vendedor — YTD " + d.periodo.ano; grupos = agrupar(rows, "vend");
  } else {
    titulo = "Por cliente — YTD " + d.periodo.ano;
    grupos = rows.filter((p) => p.meta_ano > 0 || p.fat_ytd !== 0)
      .map((p) => ({ nome: p.cliente, meta_ytd: p.meta_ytd, realizado: p.fat_ytd, ating: p.meta_ytd ? p.fat_ytd / p.meta_ytd : null }))
      .sort((a, b) => b.realizado - a.realizado).slice(0, 60);
  }
  $("metas-n1-titulo").textContent = titulo;
  $("metas-n1").innerHTML = grupos.map(linhaMetaTabela).join("") || '<tr><td colspan="6" class="empty">Sem dados.</td></tr>';

  // maiores gaps por cliente
  const busca = S.buscaMeta.toLowerCase();
  let cli = rows.filter((p) => p.meta_ytd > 0);
  if (busca) cli = cli.filter((p) => p.cliente.toLowerCase().includes(busca));
  const gaps = cli.map((p) => ({ ...p, gap: p.fat_ytd - p.meta_ytd })).sort((a, b) => a.gap - b.gap);
  $("metas-gaps").innerHTML = gaps.slice(0, S.nCli).map((p) => {
    const at = p.meta_ytd ? p.fat_ytd / p.meta_ytd : null;
    return `<tr><td><b>${esc(p.cliente)}</b></td><td>${esc(nomeVend(p.vend))}</td>
      <td class="r">${fmtM(p.meta_ytd)}</td><td class="r">${fmtM(p.fat_ytd)}</td>
      <td class="r" style="color:${at >= 1 ? "var(--ok)" : at >= 0.8 ? "var(--warn)" : "var(--bad)"}"><b>${fmtPct(at, 0)}</b></td>
      <td class="r" style="color:${p.gap >= 0 ? "var(--ok)" : "var(--bad)"}">${(p.gap >= 0 ? "+" : "−") + fmtM(Math.abs(p.gap))}</td></tr>`;
  }).join("") || '<tr><td colspan="6" class="empty">Nenhum cliente com meta no filtro atual.</td></tr>';
  $("metas-mais").style.display = gaps.length > S.nCli ? "" : "none";
}

/* ---------- Positivados ---------- */
function sparkHtml(hist) {
  const max = Math.max(1, ...hist);
  return '<div class="spark">' + hist.map((v) =>
    v > 0 ? `<i style="height:${Math.max(4, Math.round((v / max) * 26))}px"></i>` : '<i class="z"></i>').join("") + "</div>";
}

function renderPositivados(rows) {
  const d = S.data;
  const busca = S.busca.toLowerCase();
  let r = rows;
  if (S.fStatus) r = r.filter((p) => p.status === S.fStatus);
  if (busca) r = r.filter((p) => p.cliente.toLowerCase().includes(busca) || (p.cnpj || "").includes(busca));
  r = [...r].sort((a, b) => (b.perdido_estim || 0) - (a.perdido_estim || 0) || b.fat_ytd - a.fat_ytd);

  const mostraVend = d.escopo.perfil !== "vendedor";
  $("pos-head").innerHTML = `<tr><th>Cliente</th>${mostraVend ? "<th>Vendedor</th>" : ""}<th>Últ. compra</th>
    <th>Últimos 7 meses</th><th class="r">Média/mês</th><th class="r">Em risco</th><th>Status / Ação</th></tr>`;
  $("pos-body").innerHTML = r.slice(0, S.nPos).map((p) => {
    const st = ST[p.status] || ST.acionar;
    const stTxt = p.status === "acionar" && p.meses_sem < 99 ? `Acionar agora · ${p.meses_sem} meses` : st.nome;
    return `<tr><td><b>${esc(p.cliente)}</b><span style="display:block;font-size:10.5px;color:var(--soft)">${esc(p.uf)}</span></td>
      ${mostraVend ? `<td>${esc(nomeVend(p.vend))}</td>` : ""}
      <td>${fmtData(p.ult_compra)}</td><td>${sparkHtml(p.hist)}</td>
      <td class="r">${fmtM(p.media_mensal)}</td>
      <td class="r">${p.perdido_estim > 0 ? `<b style="color:var(--bad)">${fmtM(p.perdido_estim)}</b>` : '<span style="color:var(--soft)">—</span>'}</td>
      <td><span class="pill ${st.pill}">${stTxt}</span></td></tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">Nenhum cliente encontrado.</td></tr>`;
  $("pos-mais").style.display = r.length > S.nPos ? "" : "none";
  $("pos-info").textContent = `${fmtBR(Math.min(S.nPos, r.length))} de ${fmtBR(r.length)} clientes`;
}

/* ---------- Rankings ---------- */
function liRank(i, nome, sub, valor) {
  return `<li><span class="n">${i + 1}</span><span class="nm">${esc(nome)}${sub ? `<span class="sb">${esc(sub)}</span>` : ""}</span><span class="vl">${valor}</span></li>`;
}

function renderRankings(rows) {
  const d = S.data;
  // vendedores
  if (d.escopo.perfil !== "vendedor") {
    const v = agrupar(rows, "vend").slice(0, 10);
    $("rk-vend").innerHTML = v.map((o, i) => liRank(i, nomeVend(o.nome), null, fmtM(o.realizado))).join("") || '<li class="empty">—</li>';
    $("rk-vend-card").style.display = "";
  } else $("rk-vend-card").style.display = "none";
  // gerentes (só gestor, sem filtro de gerente)
  if (d.escopo.perfil === "gestor" && !S.fGer) {
    const g = agrupar(rows, "ger").slice(0, 10);
    $("rk-ger").innerHTML = g.map((o, i) => liRank(i, o.nome, null, fmtM(o.realizado))).join("");
    $("rk-ger-card").style.display = "";
  } else $("rk-ger-card").style.display = "none";
  // clientes
  const c = [...rows].sort((a, b) => b.fat_ytd - a.fat_ytd).slice(0, 10);
  $("rk-cli").innerHTML = c.map((p, i) => liRank(i, p.cliente, `${nomeVend(p.vend)} · ${p.uf}`, fmtM(p.fat_ytd))).join("");
  // famílias (escopo total)
  const f = (d.rankings.familias || []).slice(0, 10);
  $("rk-fam").innerHTML = f.map((o, i) => liRank(i, o.nome, null, fmtM(o.fat))).join("");
  $("rk-fam-nota").style.display = filtrado() ? "" : "none";
}

/* ---------------- navegação e eventos ---------------- */
function trocarView(v) {
  document.querySelectorAll(".nav-i[data-v]").forEach((x) => x.classList.toggle("act", x.dataset.v === v));
  document.querySelectorAll(".view").forEach((x) => x.classList.toggle("on", x.id === "v-" + v));
  window.scrollTo({ top: 0 });
}

document.addEventListener("DOMContentLoaded", () => {
  $("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });
  $("lbtn").addEventListener("click", entrar);
  document.querySelectorAll(".nav-i[data-v]").forEach((el) => el.addEventListener("click", () => trocarView(el.dataset.v)));
  $("f-ger")?.addEventListener("change", onFiltro);
  $("f-vend")?.addEventListener("change", onFiltro);
  $("btn-reset").addEventListener("click", resetar);
  $("who-sair").addEventListener("click", sair);
  $("btn-atualizar").addEventListener("click", () =>
    alert("Atualização automática entra na próxima fase.\nPor enquanto os dados são republicados pelo gestor."));
  $("busca-pos").addEventListener("input", (e) => { S.busca = e.target.value; S.nPos = 100; renderPositivados(linhas()); });
  $("busca-meta").addEventListener("input", (e) => { S.buscaMeta = e.target.value; S.nCli = 50; renderMetas(linhas()); });
  $("pos-mais").addEventListener("click", () => { S.nPos += 200; renderPositivados(linhas()); });
  $("metas-mais").addEventListener("click", () => { S.nCli += 100; renderMetas(linhas()); });
  document.querySelectorAll(".fchip[data-st]").forEach((el) => el.addEventListener("click", () => {
    S.fStatus = S.fStatus === el.dataset.st ? "" : el.dataset.st;
    document.querySelectorAll(".fchip[data-st]").forEach((x) => x.classList.toggle("on", x.dataset.st === S.fStatus));
    S.nPos = 100; renderPositivados(linhas());
  }));

  // sessão anterior nesta aba
  const salvo = sessionStorage.getItem("bv_dados");
  if (salvo) { try { S.data = JSON.parse(salvo); boot(); } catch { sessionStorage.removeItem("bv_dados"); } }
});
