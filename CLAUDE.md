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
  escritorio.js        # lê/salva o .md da instituição em campos (áreas + descrição)
  advogados.js         # roteamento de escalonamento por área (advogados.json)
  whitelist.js         # controle de quem é respondido (whitelist.json)
  mensagens.js         # textos de encaminhamento editáveis (mensagens.json + defaults)
  triagem.js           # o que o bot anota / o que a triagem pergunta (triagem.json + defaults)
  avisos.js            # buffer em memória de erros/avisos amigáveis (mostrados no painel)
  datajud.js           # consulta de andamento processual (DataJud/CNJ) via HTTP
  crm.js               # API pública do escritório: resolve CPF/nome → nº(s) CNJ
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
3. **Whitelist** ([whitelist.js](sistema/whitelist.js)): **ativa por padrão** — só responde
   números da lista (tolera o "9" inicial do celular). Lista vazia = não responde ninguém.
   Exceção: o flag **`liberarTodos`** em `whitelist.json` (ligado pela aba "Responder todo
   mundo" do painel) **desliga a whitelist** e faz o bot responder **qualquer número**;
   `numeroPermitido` retorna `true` para todos. Uso perigoso — a aba trava o acionamento
   atrás de vários avisos + dupla confirmação (ver painel).
   Acima de tudo isso vem a **blacklist** (`bloqueados` em `whitelist.json`): checada
   **primeiro** em `numeroPermitido`, ela silencia o número **mesmo com `liberarTodos`
   ligado** — é o único jeito de calar alguém no modo liberado. "Remover autorização
   deste cliente" (aba Clientes) chama `bloquearNumero`, que tira da whitelist **e**
   bloqueia; sem isso o botão não teria efeito nenhum com o modo liberado ativo.
   Cadastrar o número pela aba "Criar cliente" o desbloqueia (senão o cadastro seria
   inócuo). `desbloquearNumero` **não** reautoriza: só devolve o número à regra normal.
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
   `tratarMidiaComIA` trata as duas etapas **separadamente** — baixar do WhatsApp
   (`baixarMidia`, com 3 tentativas) e entender no Gemini —, com log e aviso próprios
   para cada uma. Não junte: são causas diferentes, e o aviso genérico anterior culpava
   a chave do Google por falha de download. O `downloadMedia` da `whatsapp-web.js` roda
   dentro da página do WhatsApp via Puppeteer e repassa o erro **minificado** de lá
   (aparecia no log como `r`); por isso `detalharErro` loga nome/stack/campos extras, e
   não só o `e.message`.

   ⚠️ **`corrigirIdSerializado` — não remova.** O WhatsApp Web tirou a propriedade
   `_serialized` da classe do id da mensagem (MsgKey). O id chega no Node como objeto
   simples `{ fromMe, remote, id, participant, $1 }` — o valor serializado existe, mas
   virou **`$1`**. A `whatsapp-web.js` ainda lê `this.id._serialized` (~130 lugares); no
   `downloadMedia` isso vira `Msg.get(undefined)` → `getMessagesById([undefined])` →
   `bulkGet` no IndexedDB sem chave → `DataError`, que atravessa o Puppeteer e chega
   como `r: r`. Era a causa de **toda** falha de áudio/imagem (o Gemini nunca teve
   culpa). Corrigimos no nosso lado (não em `node_modules`, que um `npm install` apaga),
   preenchendo `_serialized` só quando ausente — quando a lib corrigir, vira no-op.
   Para investigar erros minificados assim: conecte no Chromium do bot pelo
   `DevToolsActivePort` (`puppeteer.connect`) e capture o erro **dentro** da página, onde
   ele ainda está inteiro.
5. **Debounce** (`DEBOUNCE_MS`, ~5s): mensagens em sequência são agrupadas num único
   atendimento (`enfileirarMensagem`/`pendentes`) e viram uma só resposta.
6. `processarMensagens`: monta o array `[system, ...histórico, user]`, chama
   `chamarDeepSeek` (`deepseek-v4-flash`, `temperature 0.7`, `max_tokens 1000`, 3
   tentativas — o antigo `deepseek-chat` foi descontinuado pela DeepSeek em 24/07/2026).
   Se o modelo pedir `consultar_processo`, consulta o DataJud e repergunta (máx. 2
   iterações). Se pedir `consultar_cliente` (CPF ou nome, quando o cliente não tem o
   CNJ), [crm.js](sistema/crm.js) resolve na API pública do escritório (`clientes.php` +
   `processos.php`) para o(s) número(s) CNJ do cliente e o andamento vem **sempre do
   DataJud** — a base do escritório serve só para achar o número, não como fonte do
   andamento (a rotina de atualização de lá já deu problema).
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
   o novo vem vazio e preserva as "Anotações do escritório" (abaixo do marcador).
   ⚠️ `Área de interesse:` e `Observações:` vivem em **uma linha cada** no `.md` e são
   relidos por regex de linha única — por isso `atualizarMdCliente` **achata quebras de
   linha** antes de gravar. Sem isso, um texto com parágrafos seria truncado na releitura
   seguinte (só a 1ª linha voltaria) e o resto sumiria no próximo turno.
   A **régua do que registrar é baixa de propósito** ([prompt.js](sistema/prompt.js)): o
   modelo tende a deixar `observacoes` vazio, e como vazio preserva o valor antigo, a ficha
   simplesmente parava de crescer. O campo **substitui** o anterior, então o prompt manda
   reescrever a ficha inteira a cada turno — omitir um fato o apaga. Ao
   cadastrar pelo painel, `criarFichaCliente` já cria a ficha com o briefing da secretária
   **abaixo do marcador** (o bot nunca o altera; só edita a seção "Atendimento" acima).

Custo: com os preços da DeepSeek, o **output** domina (≈100× o input) e é ~constante entre
estratégias; ampliar a janela tem custo desprezível. Por isso a decisão de contexto é por
**qualidade**, não por economia — e é seguro ter janela ampla + resumo `.md`.

## Contrato JSON do modelo

O system prompt exige **um único objeto JSON**, sem cercas de código. Campos:
`resposta`, `escalar` (bool), `area`, `motivo` (preenchido quando escala),
`consultar_processo` (nº CNJ ou null), `consultar_cliente` (CPF ou nome do cliente, ou
null — quando ele quer o andamento mas não tem o CNJ), `perfil: { area_interesse,
observacoes }`. `consultar_processo` tem precedência sobre `consultar_cliente` (o modelo
nunca deve preencher os dois). Nenhum dos dois é persistido no histórico (são só gatilhos
de ferramenta; salvá-los faria o modelo reexecutar a consulta a partir do histórico).
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
- `CRM_API_URL` (padrão `https://ferreiraramos.adv.br/api`) — base da API do escritório
  usada por [crm.js](sistema/crm.js) para resolver CPF/nome → CNJ; `CRM_CACHE_MS` (60000)
  = TTL do cache em memória das listas de clientes/processos.
- ⚠️ **PENDENTE — token da API do escritório**: hoje `clientes.php`/`processos.php` estão
  **abertos só por causa desta automação** e vão **voltar a exigir token** (o Marcelo
  confirma o formato depois). Quando isso ocorrer: definir `CRM_API_TOKEN` no `.env` e
  ligar o envio do cabeçalho no ponto marcado `TODO(token)` em [crm.js](sistema/crm.js)
  (`getJson`). Sem o token, o servidor responde 401/403 e a busca por CPF/nome deixa de
  funcionar (o bot degrada pedindo o CNJ). O **DataJud** (`datajud_autocomplete.php`) é
  **API pública** e **não** usa token — não mexer no [datajud.js](sistema/datajud.js).

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
- **Escritório** — edita o `.md` da instituição em **dois campos**
  ([escritorio.js](sistema/escritorio.js)): as **áreas atendidas** (viram a linha
  `Especialidades (áreas que o escritório atende): ...` — é dela que o bot conclui se
  atende ou não um assunto) e a **descrição** (todo o resto: horário, endereço, FAQ,
  orientações). O arquivo real é `instituicoes/escritorio.md` (**git-ignored**; criado no
  boot copiando `exemplo_instituicao.md`, que é só o modelo versionado — `initDb` migra o
  `arquivo_md` antigo no banco). O título `# Nome` é regenerado a partir de
  `instituicoes.nome` no banco.
- **Criar cliente** — só um formulário: autoriza o número na whitelist **e** cria a ficha
  `.md` do cliente (`criarFichaCliente`), com nome/área/observações preenchidos pela
  secretária. Não lista clientes (há muitos).
- **Clientes** — editor do contexto `.md` por cliente (dropdown) + botão **Remover
  autorização** (tira o número da whitelist **e o põe na blacklist**; mantém
  histórico/contexto).
- **Atendimento (pausar)** — lista os clientes com Pausar/Reativar (coluna `pausado`). Ao
  reativar, orienta o advogado a atualizar o contexto.
- **Personalidade** — `personalidade.txt` (tom/estilo do bot).
- **O que anotar e perguntar** — as duas listas de [triagem.js](sistema/triagem.js), um item
  por linha. Elas têm **riscos diferentes** e por isso são campos separados: "anotar" é
  **passivo** (só registra o que o cliente falar espontaneamente — lista longa não faz mal)
  e "tentar descobrir" é **ativo** (vira pergunta na conversa). A ativa tem teto
  (`MAX_DESCOBRIR`, 6), aplicado no `salvarTriagem` (e não só na tela, para valer também se
  editarem o `.json` na mão); ao cortar, o painel avisa em vez de fingir que salvou tudo.
- **Mensagens de encaminhamento** — os dois templates de [mensagens.js](sistema/mensagens.js).
- **Advogados** — formulário de criar no topo + lista editável abaixo; **salva
  automaticamente** a cada mudança (não há botão "Salvar").
- **Responder todo mundo** — aba própria, separada por um divisor no rodapé da sidebar
  (item em vermelho, com "dot" pulsante quando ligado). Liga/desliga o flag `liberarTodos`
  ([whitelist.js](sistema/whitelist.js)) via `/api/liberar`. **Perigosa**: para *ligar* exige
  marcar a caixa de ciência (destrava o botão) + `confirm()` + digitar `LIBERAR`; ao ligar,
  registra um aviso ([avisos.js](sistema/avisos.js)). Para *desligar* (voltar a responder só
  a lista) é um clique só. Estado exibido em banner. No rodapé da aba fica a lista de
  **Números bloqueados** (blacklist), com nome do cliente quando há cadastro e botão
  **Desbloquear** (`/api/bloqueados`, `/api/bloqueados/remover`) — fica aqui porque é a
  única exceção que continua valendo com o modo liberado ligado.

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
  `advogados.json`, `personalidade.txt`, `mensagens.json`, `triagem.json`,
  `instituicoes/escritorio.md`,
  sessões e logs são **git-ignored**. No repositório só entram os modelos `*.exemplo`.
  **Nunca commite dados de cliente nem segredos.**
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
