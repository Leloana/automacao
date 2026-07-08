# CLAUDE.md

Guia do projeto para o Claude Code. Objetivo: entender o sistema sem ter que
reexplorar tudo a cada sessão.

## O que é

Bot de WhatsApp para **atendimento jurídico inicial** do escritório *Ferreira Ramos
Advocacia*. Uma "secretária virtual" que acolhe o cliente, faz a **triagem** do caso e,
quando necessário, **escala** para um advogado humano. Usa a **API DeepSeek** (via SDK da
OpenAI) para gerar as respostas e **SQLite** para persistência.

- Roda **no Windows**, na máquina do escritório, iniciado por `iniciar.bat` (na raiz).
- Stack: Node.js (CommonJS), `whatsapp-web.js` (Puppeteer/Chromium headless), `openai`,
  `better-sqlite3` (síncrono), servidor HTTP nativo para o painel.
- Todo o código, comentários e mensagens ao usuário estão **em português**. Mantenha esse
  padrão ao editar.

## Como rodar / desenvolver

- Produção (Windows): duplo-clique em `iniciar.bat` — faz `git pull`, reinstala deps se
  necessário, garante Node 22 e sobe `node index.js`. `painel.bat` e `configurar.bat` são
  atalhos auxiliares.
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
  datajud.js           # consulta de andamento processual (DataJud/CNJ) via HTTP
  apikey.js            # grava/aplica a chave DeepSeek no .env (usado pelo painel)
  painel.js            # servidor HTTP: status/QR, whitelist, advogados, clientes, chave
  logger.js            # espelha console.* em log.txt (com rotação) + erros não tratados
  prompt/context .md   # instituicoes/*.md e clientes/*.md (contexto injetado no prompt)
  db/bot.db            # banco em runtime (ignorado no git)
```

## Fluxo de uma mensagem (bot.js)

1. `client.on('message_create')` → `handleMessage` ([bot.js:156](sistema/bot.js#L156)).
   Filtra: ignora self, grupos (`@g.us`), status; aceita `@c.us` e `@lid`.
2. Resolve o **número real** e o nome (`@lid` não traz telefone → usa
   `contact.id.user`/`contact.number`, 12–13 dígitos).
3. **Whitelist** ([whitelist.js](sistema/whitelist.js)): **sempre ativa** — só responde
   números da lista (tolera o "9" inicial do celular). Lista vazia = não responde ninguém.
4. **Mídia** (áudio/imagem/vídeo/documento): o bot não processa; avisa o cliente e alerta
   o número padrão, com cooldown por número (`MIDIA_COOLDOWN_MS`).
5. **Debounce** (`DEBOUNCE_MS`, ~5s): mensagens em sequência são agrupadas num único
   atendimento (`enfileirarMensagem`/`pendentes`) e viram uma só resposta.
6. `processarMensagens` ([bot.js:313](sistema/bot.js#L313)): monta o array
   `[system, ...histórico, user]`, chama `chamarDeepSeek` (`deepseek-chat`,
   `temperature 0.7`, `max_tokens 600`, 3 tentativas). Se o modelo pedir
   `consultar_processo`, consulta o DataJud e repergunta (máx. 2 iterações).
7. Se `escalar: true` → escolhe advogado por área ([advogados.js](sistema/advogados.js)),
   responde com o contato e **avisa o advogado** por WhatsApp com o resumo da triagem.
8. Salva histórico e atualiza o `.md` do cliente.

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
   o novo vem vazio e preserva as "Anotações do escritório" (abaixo do marcador).

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
- `DEEPSEEK_MODEL` (padrão `deepseek-chat`), `INSTITUICAO_PADRAO_ID` (1).
- `HISTORICO_LIMIT` (30) — tamanho da janela de histórico.
- `DEBOUNCE_MS` (5000), `MIDIA_COOLDOWN_MS` (60000), `DATAJUD_API_URL`,
  `PAINEL_PORTA` (3000).

## Painel web ([painel.js](sistema/painel.js), porta 3000)

Servidor HTTP nativo (sem framework) que serve uma SPA embutida e endpoints JSON para:
status da conexão + QR code, "trocar de WhatsApp" (apaga sessão e gera novo QR),
whitelist, advogados, contexto `.md` por cliente, personalidade e chave da API. Tudo
editável sem reiniciar o bot (os arquivos são lidos a cada uso).

## Convenções e armadilhas

- **Arquivos de config são lidos a cada uso** (`whitelist.json`, `advogados.json`,
  `personalidade.txt`, `.md`) → alterações valem sem reiniciar. Mantenha esse padrão.
- **Privacidade/LGPD**: `clientes/*`, `.env`, `db/*.db`, `whitelist.json`,
  `advogados.json`, `personalidade.txt`, sessões e logs são **git-ignored**. No repositório
  só entram os modelos `*.exemplo`. **Nunca commite dados de cliente nem segredos.**
- `better-sqlite3` é **síncrono** — nada de `await` no acesso ao banco.
- Puppeteer roda headless com `--no-sandbox`; a sessão fica em `data/sessions` (LocalAuth).
- Falhas ao avisar advogado / atualizar `.md` nunca devem quebrar a resposta ao cliente
  (são try/catch isolados) — preserve isso.
- Git: branch principal `main`. Autor: Marcelo. Commits e mensagens de usuário em
  português.
