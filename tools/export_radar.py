# -*- coding: utf-8 -*-
"""
Radar BR Spices — ETL de exportação (Fase 1)
=============================================
Lê as fontes da BASE PROTHEUS (xlsx), aplica as regras de negócio do Book de
Vendas e gera JSONs agregados POR PERFIL (gestor / gerente / vendedor),
criptografados com AES-GCM (compatível com WebCrypto do navegador).

Regras de negócio (validadas contra o Book de Vendas / PBI em 02/07/2026):
  - Venda = linhas TIPO "1-Venda" (bonificação/doação/outros ficam de fora)
  - Excluir funcionários: ID_CLIENTE começando com "4" ou "5" (texto)
  - Excluir famílias: MAQUINA, SACOS, USO E CONSUMO
  - Fat líquido = venda - devolução (devolução vem positiva no arquivo)
  - Carteira = pedidos com Atendido = 0 (snapshot)
  - Metas por CNPJ: Ajustes_Metas_CNPJ.xlsx, aba CNPJ_METAS, cabeçalho na linha 3
  - Hierarquia: GR_BRS (gerente) > VEND_BRS (vendedor), via CNPJ

Saída:
  - data/<hash>.enc.json  (um por perfil; nome do arquivo = sha256(senha)[:16],
    então o site acha o arquivo a partir da senha, sem manifest aberto)
  - tools/senhas.local.json + tools/senhas.local.txt  (NUNCA commitados)

Uso:  python tools/export_radar.py
"""
import base64
import hashlib
import json
import os
import re
import secrets
import sys
from datetime import datetime

import pandas as pd
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

# ---------------------------------------------------------------- configuração
BASE = r"C:\Users\Fernando\Desktop\BASE PROTHEUS"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(REPO, "data")
TOOLS_DIR = os.path.join(REPO, "tools")
SENHAS_JSON = os.path.join(TOOLS_DIR, "senhas.local.json")
SENHAS_TXT = os.path.join(TOOLS_DIR, "senhas.local.txt")

FAM_EXCLUIDAS = {"MAQUINA", "SACOS", "USO E CONSUMO"}

# Acessos de visão completa (nome, cargo exibido, e-mail de referência)
ACESSO_TOTAL = [
    ("FERNANDO OLIVEIRA", "ADMINISTRADOR", "fernando.oliveira.fer85@gmail.com"),
    ("RICARDO GOBATTO", "DIRETOR COMERCIAL", "rgobatto@brspices.com.br"),
    ("GABRIEL DANIEL", "CEO", "gabriel@brspices.com.br"),
]
ANOS_MINIMO = 2025          # v1 usa 2025 (comparativo) + 2026
PBKDF2_ITER = 310_000
MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun",
            "jul", "ago", "set", "out", "nov", "dez"]
COLS_MES_META = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN",
                 "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"]

norm_cnpj = lambda s: re.sub(r"\D", "", str(s or ""))


def eh_funcionario(df):
    """Funcionários: ID_CLIENTE (texto, com zeros à esquerda) começa com 4 ou 5."""
    return df["ID_CLIENTE"].fillna("").astype(str).str.strip().str.startswith(("4", "5"))


# ---------------------------------------------------------------- leitura
def ler_faturamento():
    """Lê todos os xlsx da pasta @faturamento (exceto anos antigos e temporários)."""
    pasta = os.path.join(BASE, "@faturamento")
    frames = []
    for nome in sorted(os.listdir(pasta)):
        if not nome.lower().endswith(".xlsx") or nome.startswith("~$"):
            continue
        m = re.search(r"@fat_(\d{4})", nome)
        if m and int(m.group(1)) < ANOS_MINIMO:
            continue  # 2022-2024 não entram na v1
        caminho = os.path.join(pasta, nome)
        print(f"  lendo {nome} ...")
        df = pd.read_excel(caminho, sheet_name=0,
                           dtype={"ID_CLIENTE": str, "CNPJ": str,
                                  "ID_VENDEDOR": str, "ID_GERENTE": str})
        df = df[["NF", "CNPJ", "EMISSAO", "TIPO", "ID_CLIENTE", "NOME CLIENTE",
                 "ESTADO", "CIDADE", "ID_VENDEDOR", "NOME VENDEDOR",
                 "NOME GERENTE", "ID_PRODUTO", "NOME PRODUTO", "NOME FAMILIA",
                 "QUANTIDADE", "TOTAL"]].copy()
        df["ARQUIVO"] = nome
        frames.append(df)
    fat = pd.concat(frames, ignore_index=True)
    fat["EMISSAO"] = pd.to_datetime(fat["EMISSAO"], errors="coerce")
    fat = fat[fat["EMISSAO"].dt.year >= ANOS_MINIMO]
    # regras do Book
    fat = fat[fat["TIPO"] == "1-Venda"]
    fat = fat[~eh_funcionario(fat)]
    fat = fat[~fat["NOME FAMILIA"].isin(FAM_EXCLUIDAS)]
    fat["CNPJ_N"] = fat["CNPJ"].map(norm_cnpj)
    fat["TOTAL"] = pd.to_numeric(fat["TOTAL"], errors="coerce").fillna(0.0)
    fat["QUANTIDADE"] = pd.to_numeric(fat["QUANTIDADE"], errors="coerce").fillna(0.0)
    return fat


def ler_devolucao():
    df = pd.read_excel(os.path.join(BASE, "@devolução", "@devolução.xlsx"),
                       sheet_name=0, dtype={"ID_CLIENTE": str, "CNPJ": str})
    df["EMISSAO"] = pd.to_datetime(df["EMISSAO"], errors="coerce")
    df = df[df["EMISSAO"].dt.year >= ANOS_MINIMO]
    df = df[~eh_funcionario(df)]
    df["CNPJ_N"] = df["CNPJ"].map(norm_cnpj)
    df["TOTAL"] = pd.to_numeric(df["TOTAL"], errors="coerce").fillna(0.0)
    df["QUANTIDADE"] = pd.to_numeric(df["QUANTIDADE"], errors="coerce").fillna(0.0)
    return df


def ler_carteira():
    df = pd.read_excel(os.path.join(BASE, "@carteira", "@carteira.xlsx"),
                       sheet_name=0, dtype={"CNPJ": str})
    df = df[pd.to_numeric(df["Atendido"], errors="coerce").fillna(0) == 0]
    df["CNPJ_N"] = df["CNPJ"].map(norm_cnpj)
    df["TOTAL"] = pd.to_numeric(df["TOTAL"], errors="coerce").fillna(0.0)
    return df


def ler_metas():
    df = pd.read_excel(os.path.join(BASE, "Ajustes_Metas_CNPJ.xlsx"),
                       sheet_name="CNPJ_METAS", header=2)
    df = df[df["CNPJ"].notna()].copy()
    df["CNPJ_N"] = df["CNPJ"].map(norm_cnpj)
    df = df[df["CNPJ_N"] != ""]
    df = df.drop_duplicates(subset="CNPJ_N", keep="first")
    for c in COLS_MES_META + [2026, "2026"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)
    col_total = 2026 if 2026 in df.columns else "2026"
    df = df.rename(columns={col_total: "META_ANO"})
    for col in ["CLIENTE - BANDEIRA", "NOME CLIENTE PROTHEUS", "VEND_BRS", "GR_BRS", "ESTADO"]:
        df[col] = df[col].fillna("").astype(str).str.strip()
    return df


# ---------------------------------------------------------------- criptografia
def criptografar(obj, senha):
    """AES-GCM 256 + PBKDF2-SHA256 — decriptável com WebCrypto no navegador."""
    salt = secrets.token_bytes(16)
    iv = secrets.token_bytes(12)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt,
                     iterations=PBKDF2_ITER)
    chave = kdf.derive(senha.encode("utf-8"))
    dados = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    cifrado = AESGCM(chave).encrypt(iv, dados, None)
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    return {"v": 1, "alg": "AES-GCM", "kdf": "PBKDF2-SHA256",
            "iter": PBKDF2_ITER, "salt": b64(salt), "iv": b64(iv),
            "data": b64(cifrado)}


def nome_arquivo(senha):
    return hashlib.sha256(senha.encode("utf-8")).hexdigest()[:16] + ".enc.json"


def gerar_senha():
    alfa = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sem 0/O/1/I (legibilidade)
    blocos = ["".join(secrets.choice(alfa) for _ in range(4)) for _ in range(3)]
    return "RADAR-" + "-".join(blocos)


# ---------------------------------------------------------------- agregação
def _round(d, nd=2):
    return {k: (round(v, nd) if isinstance(v, float) else v) for k, v in d.items()}


def montar_json(escopo_perfil, escopo_nome, cnpjs, ctx, extra=None):
    """Monta o JSON de dados para um escopo (conjunto de CNPJs visíveis)."""
    fat, dev, cart, metas = ctx["fat"], ctx["dev"], ctx["cart"], ctx["metas"]
    hoje = ctx["hoje"]
    ano, mes_atual = ctx["ano_atual"], ctx["mes_atual"]
    corte_ly = ctx["corte_ly"]

    f = fat[fat["CNPJ_N"].isin(cnpjs)]
    d = dev[dev["CNPJ_N"].isin(cnpjs)]
    c = cart[cart["CNPJ_N"].isin(cnpjs)]
    m = metas[metas["CNPJ_N"].isin(cnpjs)]

    f_ano = f[f["EMISSAO"].dt.year == ano]
    d_ano = d[d["EMISSAO"].dt.year == ano]
    f_ly = f[f["EMISSAO"].dt.year == ano - 1]
    d_ly = d[d["EMISSAO"].dt.year == ano - 1]
    f_ly_mp = f_ly[f_ly["EMISSAO"] <= corte_ly]
    d_ly_mp = d_ly[d_ly["EMISSAO"] <= corte_ly]

    fat_liq = f_ano["TOTAL"].sum() - d_ano["TOTAL"].sum()
    fat_liq_ly_mp = f_ly_mp["TOTAL"].sum() - d_ly_mp["TOTAL"].sum()
    qtd_liq = f_ano["QUANTIDADE"].sum() - d_ano["QUANTIDADE"].sum()
    meta_ano = m["META_ANO"].sum()
    meta_ytd = sum(m[COLS_MES_META[i]].sum() for i in range(mes_atual))
    carteira = c["TOTAL"].sum()
    devolucao = d_ano["TOTAL"].sum()

    # por cliente/mês (base p/ positivados, metas e rankings)
    f_ano_g = f_ano.groupby(["CNPJ_N", f_ano["EMISSAO"].dt.month])["TOTAL"].sum()
    d_ano_g = d_ano.groupby(["CNPJ_N", d_ano["EMISSAO"].dt.month])["TOTAL"].sum()
    liq_cli_mes = f_ano_g.sub(d_ano_g, fill_value=0.0)  # (cnpj, mes) -> líquido
    liq_cli = liq_cli_mes.groupby(level=0).sum()
    liq_cli_ly = (f_ly.groupby("CNPJ_N")["TOTAL"].sum()
                  .sub(d_ly.groupby("CNPJ_N")["TOTAL"].sum(), fill_value=0.0))

    # dimensão de cliente: metas + clientes sem cadastro que faturaram
    dim = m.set_index("CNPJ_N")
    nomes_fat = (f.sort_values("EMISSAO").groupby("CNPJ_N")
                 [["NOME CLIENTE", "NOME VENDEDOR", "NOME GERENTE", "ESTADO"]].last())

    def info_cliente(cnpj):
        if cnpj in dim.index:
            r = dim.loc[cnpj]
            return (r["CLIENTE - BANDEIRA"] or r["NOME CLIENTE PROTHEUS"],
                    r["VEND_BRS"], r["GR_BRS"], r["ESTADO"], float(r["META_ANO"]),
                    float(sum(r[COLS_MES_META[i]] for i in range(mes_atual))))
        if cnpj in nomes_fat.index:
            r = nomes_fat.loc[cnpj]
            return (str(r["NOME CLIENTE"]), "SEM CADASTRO", "SEM CADASTRO",
                    str(r["ESTADO"]), 0.0, 0.0)
        return ("(desconhecido)", "SEM CADASTRO", "SEM CADASTRO", "", 0.0, 0.0)

    ult_compra = f.groupby("CNPJ_N")["EMISSAO"].max()

    # ---- positivados / semáforo de recência
    positivados = []
    universo = set(m["CNPJ_N"]) | set(liq_cli.index)
    idx_atual = ano * 12 + mes_atual
    for cnpj in universo:
        nome, vend, ger, uf, meta_a, meta_y = info_cliente(cnpj)
        fat_ytd_c = float(liq_cli.get(cnpj, 0.0))
        uc = ult_compra.get(cnpj)
        if pd.isna(uc) if uc is not None else True:
            uc = None
        if uc is None and fat_ytd_c == 0 and meta_a == 0:
            continue  # sem venda 25/26 e sem meta: fora do radar
        if uc is not None:
            meses_sem = idx_atual - (uc.year * 12 + uc.month)
        else:
            meses_sem = 99
        status = ("ok" if meses_sem <= 0 else
                  "atencao" if meses_sem == 1 else
                  "validar" if meses_sem == 2 else "acionar")
        # histórico dos últimos 7 meses (mês atual incluso)
        hist = []
        for k in range(6, -1, -1):
            idx = idx_atual - k
            a, mm = divmod(idx - 1, 12)
            hist.append(round(float(liq_cli_mes.get((cnpj, mm + 1), 0.0))
                              if a == ano else 0.0, 2))
        meses_ativos = int((liq_cli_mes.loc[cnpj] != 0).sum()) if cnpj in liq_cli.index else 0
        media = fat_ytd_c / meses_ativos if meses_ativos else 0.0
        positivados.append(_round({
            "cliente": nome, "cnpj": cnpj, "uf": uf, "vend": vend, "ger": ger,
            "ult_compra": uc.strftime("%Y-%m-%d") if uc is not None else None,
            "meses_sem": int(meses_sem), "status": status, "hist": hist,
            "fat_ytd": fat_ytd_c, "fat_ly": float(liq_cli_ly.get(cnpj, 0.0)),
            "media_mensal": media,
            "perdido_estim": media * meses_sem if meses_sem >= 1 and media > 0 else 0.0,
            "meta_ano": meta_a, "meta_ytd": meta_y,
        }))
    positivados.sort(key=lambda x: -(x["perdido_estim"] or 0))

    positivados_mes = sum(1 for p in positivados if p["status"] == "ok")
    clientes_base = sum(1 for p in positivados if p["meta_ano"] > 0 or p["fat_ytd"] != 0)

    # ---- evolução mensal (ano atual + ano anterior + meta)
    liq_mes = (f_ano.groupby(f_ano["EMISSAO"].dt.month)["TOTAL"].sum()
               .sub(d_ano.groupby(d_ano["EMISSAO"].dt.month)["TOTAL"].sum(), fill_value=0.0))
    liq_mes_ly = (f_ly.groupby(f_ly["EMISSAO"].dt.month)["TOTAL"].sum()
                  .sub(d_ly.groupby(d_ly["EMISSAO"].dt.month)["TOTAL"].sum(), fill_value=0.0))
    evolucao = [_round({"mes": MESES_PT[i], "num": i + 1,
                        "fat": float(liq_mes.get(i + 1, 0.0)),
                        "fat_ly": float(liq_mes_ly.get(i + 1, 0.0)),
                        "meta": float(m[COLS_MES_META[i]].sum())})
                for i in range(12)]

    # ---- metas vs realizado e rankings por dimensão
    def agrupar(nivel):
        grupos = {}
        for p in positivados:
            chave = p[nivel] or "SEM CADASTRO"
            g = grupos.setdefault(chave, {"nome": chave, "meta_ytd": 0.0,
                                          "meta_ano": 0.0, "realizado": 0.0,
                                          "realizado_ly": 0.0, "clientes": 0,
                                          "positivados": 0})
            g["meta_ytd"] += p["meta_ytd"]; g["meta_ano"] += p["meta_ano"]
            g["realizado"] += p["fat_ytd"]; g["realizado_ly"] += p["fat_ly"]
            g["clientes"] += 1
            g["positivados"] += 1 if p["status"] == "ok" else 0
        out = []
        for g in grupos.values():
            g["ating"] = round(g["realizado"] / g["meta_ytd"], 4) if g["meta_ytd"] else None
            out.append(_round(g))
        out.sort(key=lambda x: -x["realizado"])
        return out

    metas_bloco = {"por_cliente": [
        _round({"cliente": p["cliente"], "cnpj": p["cnpj"], "vend": p["vend"],
                "ger": p["ger"], "meta_ytd": p["meta_ytd"], "meta_ano": p["meta_ano"],
                "realizado": p["fat_ytd"],
                "ating": round(p["fat_ytd"] / p["meta_ytd"], 4) if p["meta_ytd"] else None})
        for p in sorted(positivados, key=lambda x: -x["meta_ano"])]}
    rankings = {"clientes": [
        _round({"nome": p["cliente"], "vend": p["vend"], "ger": p["ger"],
                "fat": p["fat_ytd"], "fat_ly": p["fat_ly"]})
        for p in sorted(positivados, key=lambda x: -x["fat_ytd"])[:100]]}
    if escopo_perfil in ("gestor", "gerente"):
        metas_bloco["por_vendedor"] = agrupar("vend")
        rankings["vendedores"] = agrupar("vend")
    if escopo_perfil == "gestor":
        metas_bloco["por_gerente"] = agrupar("ger")
        rankings["gerentes"] = agrupar("ger")

    fam = (f_ano.groupby("NOME FAMILIA")["TOTAL"].sum().sort_values(ascending=False))
    rankings["familias"] = [_round({"nome": k, "fat": float(v)})
                            for k, v in fam.head(20).items()]

    return {
        "gerado_em": hoje.strftime("%Y-%m-%d %H:%M"),
        "atualizado_ate": ctx["max_emissao"].strftime("%Y-%m-%d"),
        "escopo": {"perfil": escopo_perfil, "nome": escopo_nome, **(extra or {})},
        "periodo": {"ano": ano, "mes_atual": mes_atual,
                    "mes_atual_nome": MESES_PT[mes_atual - 1]},
        "kpis": _round({
            "fat_liq_ytd": float(fat_liq), "fat_liq_ly_mp": float(fat_liq_ly_mp),
            "cresc_ytd": round((fat_liq - fat_liq_ly_mp) / fat_liq_ly_mp, 4)
                         if fat_liq_ly_mp > 0 else None,
            "qtd_liq_ytd": float(qtd_liq), "meta_ytd": float(meta_ytd),
            "meta_ano": float(meta_ano),
            "ating_ytd": round(fat_liq / meta_ytd, 4) if meta_ytd else None,
            "carteira": float(carteira), "devolucao": float(devolucao),
            "clientes_base": clientes_base, "positivados_mes": positivados_mes,
            "taxa_positivacao": round(positivados_mes / clientes_base, 4)
                                if clientes_base else None,
            "ticket": round(fat_liq / clientes_base, 2) if clientes_base else None,
        }),
        "evolucao": evolucao,
        "metas": metas_bloco,
        "positivados": positivados,
        "rankings": rankings,
    }


# ---------------------------------------------------------------- main
def main():
    inicio = datetime.now()
    print("== Radar BR Spices — exportação ==")
    print("Lendo fontes...")
    fat = ler_faturamento()
    dev = ler_devolucao()
    cart = ler_carteira()
    metas = ler_metas()

    max_emissao = fat["EMISSAO"].max()
    ano_atual, mes_atual = max_emissao.year, max_emissao.month
    corte_ly = max_emissao.replace(year=ano_atual - 1)
    ctx = {"fat": fat, "dev": dev, "cart": cart, "metas": metas,
           "hoje": inicio, "ano_atual": ano_atual, "mes_atual": mes_atual,
           "corte_ly": corte_ly, "max_emissao": max_emissao}

    print(f"Faturamento: {len(fat)} linhas úteis | última emissão {max_emissao:%d/%m/%Y}")
    print(f"Metas: {len(metas)} CNPJs | Devolução: {len(dev)} | Carteira: {len(cart)}")

    # escopos: visão completa (admin/diretoria) + cada gerente + cada vendedor
    cnpjs_todos = set(metas["CNPJ_N"]) | set(fat["CNPJ_N"])
    escopos = [("gestor", nome, cnpjs_todos, {"cargo": cargo, "email": email})
               for nome, cargo, email in ACESSO_TOTAL]
    for g in sorted(x for x in metas["GR_BRS"].unique() if x):
        cnpjs = set(metas.loc[metas["GR_BRS"] == g, "CNPJ_N"])
        if cnpjs:
            escopos.append(("gerente", g, cnpjs, None))
    for v in sorted(x for x in metas["VEND_BRS"].unique() if x):
        cnpjs = set(metas.loc[metas["VEND_BRS"] == v, "CNPJ_N"])
        if cnpjs:
            escopos.append(("vendedor", v, cnpjs, None))

    # senhas persistentes entre execuções
    senhas = {}
    if os.path.exists(SENHAS_JSON):
        with open(SENHAS_JSON, encoding="utf-8") as fh:
            senhas = json.load(fh)

    # remove senhas de escopos que deixaram de existir (ex.: antigo "gestor|GESTOR")
    chaves_atuais = {f"{p}|{n}" for p, n, _, _ in escopos}
    for chave in [k for k in senhas if k not in chaves_atuais]:
        print(f"  senha descartada (escopo extinto): {chave}")
        del senhas[chave]

    os.makedirs(DATA_DIR, exist_ok=True)
    arquivos_gerados = set()
    print(f"\nGerando {len(escopos)} arquivos por perfil...")
    for perfil, nome, cnpjs, extra in escopos:
        chave = f"{perfil}|{nome}"
        if chave not in senhas:
            senhas[chave] = {"senha": gerar_senha(), "perfil": perfil, "nome": nome}
        if extra:
            senhas[chave].update(extra)
        senha = senhas[chave]["senha"]
        arq = nome_arquivo(senha)
        senhas[chave]["arquivo"] = arq
        payload = montar_json(perfil, nome, cnpjs, ctx, extra)
        with open(os.path.join(DATA_DIR, arq), "w", encoding="utf-8") as fh:
            json.dump(criptografar(payload, senha), fh)
        arquivos_gerados.add(arq)
        if perfil == "gestor":
            k = payload["kpis"]
            print(f"  [VALIDAÇÃO gestor] fat_liq_ytd={k['fat_liq_ytd']:,.2f} "
                  f"ly_mp={k['fat_liq_ly_mp']:,.2f} cresc={k['cresc_ytd']} "
                  f"meta_ytd={k['meta_ytd']:,.2f} ating={k['ating_ytd']} "
                  f"carteira={k['carteira']:,.2f} dev={k['devolucao']:,.2f} "
                  f"base={k['clientes_base']} posit={k['positivados_mes']}")
        print(f"  {perfil:9s} {nome:32s} -> data/{arq}")

    # remove .enc.json órfãos (senha trocada/escopo extinto)
    for f in os.listdir(DATA_DIR):
        if f.endswith(".enc.json") and f not in arquivos_gerados:
            os.remove(os.path.join(DATA_DIR, f))
            print(f"  removido órfão: data/{f}")

    with open(SENHAS_JSON, "w", encoding="utf-8") as fh:
        json.dump(senhas, fh, ensure_ascii=False, indent=1)
    with open(SENHAS_TXT, "w", encoding="utf-8") as fh:
        fh.write("RADAR BR SPICES — SENHAS DE ACESSO (CONFIDENCIAL — não commitar)\n")
        fh.write(f"Gerado em {inicio:%d/%m/%Y %H:%M}\n\n")
        ordem = {"gestor": 0, "gerente": 1, "vendedor": 2}
        for chave in sorted(senhas, key=lambda k: (ordem.get(senhas[k]["perfil"], 9), senhas[k]["nome"])):
            s = senhas[chave]
            rotulo = s.get("cargo", s["perfil"].upper())
            extra = f"  ({s['email']})" if s.get("email") else ""
            fh.write(f"{rotulo:18s} {s['nome']:32s} senha: {s['senha']}{extra}\n")
    print(f"\nSenhas em: {SENHAS_TXT}")
    print(f"Concluído em {(datetime.now() - inicio).total_seconds():.0f}s")


if __name__ == "__main__":
    sys.exit(main())
