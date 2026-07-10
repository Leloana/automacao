# CLAUDE.md

Guia do projeto para o Claude Code. Objetivo: entender o sistema sem ter que
reexplorar tudo a cada sessão.

## O que é

Bot de WhatsApp para **atendimento jurídico inicial** do escritório *Ferreira Ramos
Advocacia*. Uma "secretária virtual" que acolhe o cliente, faz a **triagem** do caso e,
quando necessário, **escala** para um advogado humano. Usa a **API DeepSeek** (via SDK da
OpenAI) para gerar as respostas, a **API Google Gemini** (opcional) para transcrever
áudios e descrever imagens, e **SQLite** para persistência.

- Roda **no Windows**, na máquina do escritório, iniciado por `iniciar.bat` (na raiz).
- Stack: Node.js (CommonJS), `whatsapp-web.js` (Puppeteer/Chromium headless), `openai`,
  `better-sqlite3` (síncrono), servidor HTTP nativo para o painel.
- Todo o código, comentários e mensagens ao usuário estão **em português**. Mantenha esse
  padrão ao editar.

## Como rodar / desenvolver

- Produção (Windows): duplo-clique em `iniciar.bat` — faz `git pull`, reinstala deps se
  necessário, garante Node 22, encerra instância anterior se houver e sobe `node index.js`
  (é o único `.bat` do projeto).
- Manual: `cd sistema && npm install && npm start` (script `start` = `node index.js`).
- **Requer Node 22** (há `.node` nativo do `better-sqlite3` atrelado ao
  `NODE_MODULE_VERSION`; misturar versões quebra o boot — ver histórico do git).
- ⚠️ **Não há Node instalado no ambiente Linux deste agente.** Não dá para executar/testar
  o bot aqui; verificação em runtime só na máquina Windows do escritório. Valide mudanças
  por inspeção estática e testes de lógica pura.
- Não há suíte de testes automatizados no repositório.

## Layout

```
iniciar.bat            # entrada no Windows: auto-update (git pull) + deps + start
sistema/
  index.js             # boot: initDb, sobe painel, cria cliente WhatsApp, eventos/QR
  bot.js               # NÚCLEO: handler de msg, debounce, contexto, chamada DeepSeek
  prompt.js            # monta o system prompt (personalidade editável + regras JSON)
  db.js                # SQLite (better-sqlite3): instituicoes, clientes, historico
  context.js           # arquivos .md de instituição e de cliente (perfil durável)
  advogados.js         # roteamento de escalonamento por área (advogados.json)
  whitelist.js         # controle de quem é respondido (whitelist.json)
  mensagens.js         # textos de encaminhamento editáveis (mensagens.json + defaults)
  avisos.js            # buffer em memória de erros/avisos amigáveis (mostrados no painel)
  datajud.js           # consulta de andamento processual (DataJud/CNJ) via HTTP
  midia.js             # transcreve áudio / descreve imagem via Gemini (fetch nativo)
  apikey.js            # grava/aplica as chaves DeepSeek e Gemini no .env (painel)
  painel.js            # servidor HTTP: SPA com navegação lateral + endpoints JSON
  logger.js            # espelha console.* em log.txt (com rotação) + erros não tratados
  prompt/context .md   # instituicoes/*.md e clientes/*.md (contexto injetado no prompt)
  db/bot.db            # banco em runtime (ignorado no git)
```

`iniciar.bat` tem um **guard de instância única**: se a porta 3000 já estiver em uso por
um `node.exe`, encerra a instância anterior (`taskkill /F /T`, mata node + Chrome filho),
apaga as travas `Singleton*` da sessão e sobe de novo. Abre o navegador só quando o painel
responde de fato (evita F5 em PCs lentos).

## Fluxo de uma mensagem (bot.js)

1. `client.on('message_create')` → `handleMessage` ([bot.js:156](sistema/bot.js#L156)).
   Filtra: ignora self, grupos (`@g.us`), status; aceita `@c.us` e `@lid`.
2. Resolve o **número real** e o nome (`@lid` não traz telefone → usa
   `contact.id.user`/`contact.number`, 12–13 dígitos).
3. **Whitelist** ([whitelist.js](sistema/whitelist.js)): **sempre ativa** — só responde
   números da lista (tolera o "9" inicial do celular). Lista vazia = não responde ninguém.
3b. **Pausa por cliente**: se o cliente está com `pausado = 1` (coluna na tabela
   `clientes`), o bot fica em **silêncio total** — não responde, não trata mídia, não
   enfileira nem registra. Serve para o advogado assumir o atendimento humano. Checado em
   `handleMessage` via `db.getClienteByNumero` logo após a whitelist.
4. **Mídia**: com `GEMINI_API_KEY` configurada, áudio (`ptt`/`audio`) é **transcrito** e
   imagem **descrita** ([midia.js](sistema/midia.js)); o texto rotulado ("[Áudio enviado
   pelo cliente — transcrição automática]...") entra no fluxo normal via
   `enfileirarMensagem` — a DeepSeek segue fazendo a triagem. Sem chave, ou para
   vídeo/documento, ou em falha/arquivo grande (`MIDIA_MAX_MB`), cai no comportamento
   antigo (`tratarMidia`): avisa o cliente e alerta o número padrão, com cooldown por
   número (`MIDIA_COOLDOWN_MS`).
5. **Debounce** (`DEBOUNCE_MS`, ~5s): mensagens em sequência são agrupadas num único
   atendimento (`enfileirarMensagem`/`pendentes`) e viram uma só resposta.
6. `processarMensagens`: monta o array `[system, ...histórico, user]`, chama
   `chamarDeepSeek` (`deepseek-v4-flash`, `temperature 0.7`, `max_tokens 600`, 3
   tentativas — o antigo `deepseek-chat` foi descontinuado pela DeepSeek em 24/07/2026).
   Se o modelo pedir `consultar_processo`, consulta o DataJud e repergunta (máx. 2
   iterações).
7. Se `escalar: true` → escolhe advogado por área ([advogados.js](sistema/advogados.js)),
   responde ao cliente e **avisa o advogado** por WhatsApp com o resumo da triagem — ambas
   as mensagens vêm de templates editáveis ([mensagens.js](sistema/mensagens.js), com
   placeholders `{nome}`, `{area}`, `{motivo}` etc.). Em seguida **pausa automaticamente**
   o cliente (`db.setPausado(id, 1)`) para o advogado assumir.
8. Salva histórico e atualiza o `.md` do cliente.

Erros relevantes para o usuário são registrados em [avisos.js](sistema/avisos.js) (falha/
ausência de chave da API, WhatsApp desconectado, falha ao avisar advogado, etc.) e
aparecem no painel em português simples — o usuário **não usa o terminal**.

## Memória e contexto (importante)

Duas camadas, ambas montadas em `processarMensagens`:

1. **Janela de histórico recente** — SQLite (tabela `historico`), últimas
   **`HISTORICO_LIMIT`** mensagens por cliente (padrão **30**, ~15 trocas; env
   `HISTORICO_LIMIT`). Definido em [db.js](sistema/db.js) (constante no topo, usada por
   `getHistorico` e `pruneHistorico`, que poda a cada `saveMessage`). O assistente é salvo
   como **JSON** (não o texto formatado) de propósito: assim o modelo vê o padrão e
   continua devolvendo JSON.
2. **Resumo durável (perfil `.md`)** — um arquivo por cliente em `clientes/` com
   `area_interesse` + `observacoes`, gerado pelo modelo a cada turno e injetado no system
   prompt como "Contexto do cliente" ([prompt.js](sistema/prompt.js)). É a memória de
   **longo prazo** que preserva o essencial do caso além da janela recente.
   `atualizarMdCliente` ([context.js](sistema/context.js)) nunca apaga valor antigo quando
   o novo vem vazio e preserva as "Anotações do escritório" (abaixo do marcador). Ao
   cadastrar pelo painel, `criarFichaCliente` já cria a ficha com o briefing da secretária
   **abaixo do marcador** (o bot nunca o altera; só edita a seção "Atendimento" acima).

Custo: com os preços da DeepSeek, o **output** domina (≈100× o input) e é ~constante entre
estratégias; ampliar a janela tem custo desprezível. Por isso a decisão de contexto é por
**qualidade**, não por economia — e é seguro ter janela ampla + resumo `.md`.

## Contrato JSON do modelo

O system prompt exige **um único objeto JSON**, sem cercas de código. Campos:
`resposta`, `escalar` (bool), `area`, `motivo` (preenchido quando escala),
`consultar_processo` (nº CNJ ou null), `perfil: { area_interesse, observacoes }`.
A leitura é tolerante (`extrairDados` em [bot.js:24](sistema/bot.js#L24)): tenta JSON puro,
remove ```` ``` ````, extrai o primeiro `{...}`. **Não use `response_format: json_object`**
— nos testes a DeepSeek ficou instável nesse modo; usamos texto normal.

## Configuração (`sistema/.env`, ver `.env.example`)

- `DEEPSEEK_API_KEY` — chave da API (também gravável pelo painel via
  [apikey.js](sistema/apikey.js); o bot sobe sem ela e falha só nas respostas).
- `DEEPSEEK_MODEL` (padrão `deepseek-v4-flash`), `INSTITUICAO_PADRAO_ID` (1).
- `GEMINI_API_KEY` — chave do Google para áudio/imagem (opcional; também gravável pelo
  painel). `GEMINI_MODEL` (padrão `gemini-flash-lite-latest` — alias que segue o
  flash-lite estável mais recente; versões fixas somem para contas novas), `MIDIA_MAX_MB` (15).
- `HISTORICO_LIMIT` (30) — tamanho da janela de histórico.
- `DEBOUNCE_MS` (5000), `MIDIA_COOLDOWN_MS` (60000), `DATAJUD_API_URL`,
  `PAINEL_PORTA` (3000).

## Painel web ([painel.js](sistema/painel.js), porta 3000)

Servidor HTTP nativo (sem framework) que serve uma SPA embutida (HTML/CSS/JS num único
template string) com **navegação lateral** (sidebar): uma seção visível por vez, botão por
área. Cada card tem um ícone de ajuda ⓘ com tooltip. Seções:

- **Conexão** — status + QR code + "trocar de WhatsApp" (apaga sessão e gera novo QR). O
  botão na sidebar tem um "dot" que reflete o status.
- **Avisos** — lista os erros/avisos amigáveis ([avisos.js](sistema/avisos.js)); badge com
  contador. Poll a cada 5s.
- **Chave da API** — grava/aplica a chave DeepSeek e a chave do Google/Gemini para
  áudio/imagem ([apikey.js](sistema/apikey.js)); a do Google é opcional (banner amarelo
  quando ausente, não vermelho).
- **Criar cliente** — só um formulário: autoriza o número na whitelist **e** cria a ficha
  `.md` do cliente (`criarFichaCliente`), com nome/área/observações preenchidos pela
  secretária. Não lista clientes (há muitos).
- **Clientes** — editor do contexto `.md` por cliente (dropdown) + botão **Remover
  autorização** (tira o número da whitelist; mantém histórico/contexto).
- **Atendimento (pausar)** — lista os clientes com Pausar/Reativar (coluna `pausado`). Ao
  reativar, orienta o advogado a atualizar o contexto.
- **Personalidade** — `personalidade.txt` (tom/estilo do bot).
- **Mensagens de encaminhamento** — os dois templates de [mensagens.js](sistema/mensagens.js).
- **Advogados** — formulário de criar no topo + lista editável abaixo; **salva
  automaticamente** a cada mudança (não há botão "Salvar").

Tudo é editável sem reiniciar o bot (os arquivos são lidos a cada uso). Em `EADDRINUSE`
(porta já em uso) o painel encerra com mensagem clara.

Para pré-visualizar o front no Linux deste agente (sem backend): extrair o template `HTML`
de [painel.js](sistema/painel.js) para um `.html` (trocando `\\` por `\`) e abrir no
navegador — a navegação/tooltips funcionam; chamadas `/api/*` falham em silêncio.

## Convenções e armadilhas

- **Arquivos de config são lidos a cada uso** (`whitelist.json`, `advogados.json`,
  `personalidade.txt`, `mensagens.json`, `.md`) → alterações valem sem reiniciar. Mantenha
  esse padrão. Módulos como `mensagens.js` trazem o **default no código** e o arquivo é
  opcional (só existe se editado pelo painel).
- **Privacidade/LGPD**: `clientes/*`, `.env`, `db/*.db`, `whitelist.json`,
  `advogados.json`, `personalidade.txt`, `mensagens.json`, sessões e logs são
  **git-ignored**. No repositório só entram os modelos `*.exemplo`. **Nunca commite dados
  de cliente nem segredos.**
- **Migrações de schema**: `initDb` ([db.js](sistema/db.js)) usa `CREATE TABLE IF NOT
  EXISTS` (não altera tabela existente); colunas novas entram via `ALTER TABLE ... ADD
  COLUMN` condicionado a `PRAGMA table_info` (ex.: a coluna `pausado`).
- **Avisos** ([avisos.js](sistema/avisos.js)) ficam **só em memória** (some ao reiniciar);
  também ecoam no `console` → `log.txt`.
- `better-sqlite3` é **síncrono** — nada de `await` no acesso ao banco.
- Puppeteer roda headless com `--no-sandbox`; a sessão fica em `data/sessions` (LocalAuth).
- Falhas ao avisar advogado / atualizar `.md` nunca devem quebrar a resposta ao cliente
  (são try/catch isolados) — preserve isso.
- Git: branch principal `main`. Autor: Marcelo. Commits e mensagens de usuário em
  português.
