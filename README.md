# Book de Vendas BR Spices — Painel Comercial Web

Dashboard comercial em HTML/JS para gestão, gerentes e vendedores, com acesso controlado por perfil.

## Como funciona
```
BASE PROTHEUS (xlsx) → tools/export_radar.py → JSONs criptografados por perfil → git push → site atualiza
```

## Login
A senha digitada gera um hash (SHA-256) que localiza o arquivo do perfil em `data/`,
e a mesma senha deriva a chave (PBKDF2 310k + AES-GCM) que descriptografa os dados
**no navegador** (WebCrypto). Nenhuma senha ou dado aberto trafega ou fica em servidor.
Senhas: `tools/senhas.local.txt` (somente local, nunca commitado).

## Atualizar os dados
```
%LOCALAPPDATA%\Programs\Python\Python312\python.exe tools\export_radar.py
git add data/ && git commit -m "dados" && git push
```

- **Perfis:** gestor (tudo) · gerente (sua equipe) · vendedor (sua carteira)
- **Proteção v1:** dados criptografados no navegador com senha por pessoa (AES). Nenhum dado aberto é commitado.
- **Backlog:** migrar autenticação para Cloudflare Pages + Access.

## Estrutura
```
index.html          página principal (SPA)
assets/css, js      estilos e lógica
data/               SOMENTE JSONs criptografados (nunca dados abertos)
tools/              scripts de exportação/publicação (não publicados no site)
```

## Regra de ouro
**Nunca** commitar dados abertos (CNPJ, faturamento). O `.gitignore` bloqueia `*.xlsx` e `data/*.json` não criptografados.

## Páginas v1
1. Visão Geral (KPIs mês/YTD)
2. Metas vs Realizado
3. Positivados (semáforo de recência)
4. Rankings (vendedores/clientes)
