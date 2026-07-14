# Plano de migração — WhatsApp oficial (Cloud API da Meta)

Migração do bot de triagem do **`whatsapp-web.js`** (não-oficial, via navegador —
causa dos bloqueios de número) para a **WhatsApp Cloud API oficial da Meta**.

> **Decisões tomadas:**
> - **Rota:** direto com a Meta (sem BSP) — comparação Meta × BSP registrada no fim.
> - **Aviso ao advogado:** **mantido no WhatsApp via template aprovado** (opção A) — é
>   essencial: é o gatilho que passa a conversa da LLM para a pessoa. Ver Fase 4.
> - **Hospedagem:** **PC do escritório + túnel** (mais controle). Ver Fase 6.
> - **Validação:** ~**1 semana** com o número de teste da Meta antes do cutover. Ver Fase 7.

---

## 1. Ideia central: o que muda e o que NÃO muda

A migração troca **apenas a camada de transporte do WhatsApp**. O "cérebro" do
sistema permanece intacto.

| Camada | Situação |
|---|---|
| Recepção de mensagens | **MUDA** — de evento Puppeteer (`message_create`) para **webhook HTTP** |
| Envio de mensagens | **MUDA** — de `client.sendMessage()` para **POST na Graph API** |
| Download de mídia | **MUDA** — de `message.downloadMedia()` para busca por **media ID** |
| Conexão / sessão | **MUDA** — some o QR code; passa a usar **token + phone number ID** |
| Triagem DeepSeek ([bot.js](sistema/bot.js) `processarMensagens`) | **não muda** |
| Prompt, contrato JSON, DataJud, CRM, contexto `.md` | **não muda** |
| Transcrição/descrição de mídia ([midia.js](sistema/midia.js) — Gemini) | **não muda** (só a origem do binário) |
| Debounce, histórico, whitelist, pausa por cliente | **não muda** |
| Painel (aba Conexão) | **muda** — sem QR; passa a mostrar status do token/número |

**Estratégia de menor risco:** criar uma **camada adaptadora** (`whatsapp.js`) que
apresenta ao restante do código a *mesma interface* que o `whatsapp-web.js` expõe
hoje (um objeto "mensagem" com `from`, `type`, `body`, `reply()`, etc. e uma função
de envio). Assim, [bot.js](sistema/bot.js) muda **muito pouco**.

---

## 2. Pré-requisitos (fora do código)

1. **Conta no Meta for Developers** (developers.facebook.com) — gratuita.
2. **Meta Business Portfolio** (Business Manager) da Ferreira Ramos Advocacia.
3. **App do tipo "WhatsApp"** dentro do Business Portfolio.
4. **Número de telefone dedicado** ao bot (não pode estar ativo no app comum do
   WhatsApp ao mesmo tempo). Para começar, a Meta fornece um **número de teste
   grátis** que envia para poucos números — dá para validar todo o código antes de
   formalizar.
5. **Verificação do negócio** (CNPJ/documentos) — necessária para sair dos limites
   de teste e liberar produção.
6. **Token de acesso permanente** — criado via *System User* no Business Manager (o
   token que a Meta mostra na tela inicial expira em 24h; **não usar em produção**).
7. **Endpoint HTTPS público** para o webhook (ver Fase 6).

---

## 3. Novas variáveis de ambiente (`sistema/.env`)

Adicionar (e documentar em `.env.example`):

```
# WhatsApp Cloud API (oficial)
WHATSAPP_TOKEN=            # token permanente do System User (Bearer)
WHATSAPP_PHONE_NUMBER_ID=  # ID do número (não é o telefone; vem do painel da Meta)
WHATSAPP_WABA_ID=          # ID da WhatsApp Business Account (opcional, p/ templates)
WHATSAPP_VERIFY_TOKEN=     # string secreta escolhida por você (validação do webhook)
WHATSAPP_APP_SECRET=       # segredo do app (validar assinatura X-Hub-Signature-256)
GRAPH_API_VERSION=v21.0    # versão da Graph API
# Aviso ao advogado (se optar por canal alternativo — Fase 4)
AVISO_ADVOGADO_TEMPLATE=   # nome do template aprovado (se for por WhatsApp)
```

Manter todas as chaves existentes (`DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, etc.).
Como hoje, o `WHATSAPP_TOKEN` deve poder ser **gravado pelo painel** (espelhar o
padrão do [apikey.js](sistema/apikey.js)).

---

## 4. Fases da migração

### Fase 0 — Conta e número de teste (sem código)
- Criar app WhatsApp no Meta for Developers.
- Pegar `phone_number_id` e o token temporário; enviar um "hello world" de teste
  pelo painel da Meta para confirmar que o número funciona.
- Escolher e anotar o `WHATSAPP_VERIFY_TOKEN`.
- **Critério de pronto:** consegue mandar/receber mensagem manualmente pelo painel
  da Meta.

### Fase 1 — Nova camada de transporte: `sistema/whatsapp.js` (arquivo novo)
Módulo que concentra toda a conversa com a Graph API. Funções:

- `enviarTexto(numero, texto)` → `POST /{phone_number_id}/messages` com
  `{ type: "text", text: { body } }`. Substitui `client.sendMessage(...)`.
- `enviarTemplate(numero, nomeTemplate, variaveis)` → para o aviso ao advogado
  (Fase 4), se for por WhatsApp.
- `baixarMidia(mediaId)` → `GET /{media-id}` (pega a URL) e depois `GET` no binário
  com o Bearer token; devolve `{ base64, mimetype }` — mesmo formato que o
  [midia.js](sistema/midia.js) já consome.
- `parseWebhook(body)` → normaliza o payload do webhook em objetos "mensagem" com a
  **mesma cara** que o [bot.js](sistema/bot.js) espera hoje (ver tabela de
  mapeamento na seção 5). Retorna `[]` para eventos de status
  (`statuses`) — que devem ser ignorados.
- `validarAssinatura(rawBody, header)` → confere `X-Hub-Signature-256` com o
  `WHATSAPP_APP_SECRET` (segurança: garante que o POST veio mesmo da Meta).
- `setWhatsappToken(chave)` → troca o token em runtime (padrão do
  [apikey.js](sistema/apikey.js)).

Usar `fetch` nativo (Node 22), como já se faz em [midia.js](sistema/midia.js) e
[crm.js](sistema/crm.js).

### Fase 2 — Webhook no painel ([painel.js](sistema/painel.js))
O painel já é um servidor HTTP nativo com roteamento por `req.url`
([painel.js:891](sistema/painel.js#L891)). Adicionar duas rotas:

- **`GET /webhook`** — verificação inicial da Meta: comparar
  `hub.verify_token` com `WHATSAPP_VERIFY_TOKEN` e devolver `hub.challenge` como
  texto puro (status 200).
- **`POST /webhook`** — recebe as mensagens:
  1. Ler o corpo **cru** (necessário para validar a assinatura).
  2. `whatsapp.validarAssinatura(...)` — se falhar, responder 403.
  3. **Responder 200 imediatamente** (a Meta reentrega se demorar/der erro).
  4. Processar em segundo plano: `whatsapp.parseWebhook(body)` → para cada mensagem,
     chamar `handleMessage(...)`.

> Alternativa: subir o webhook numa **porta/servidor separado** do painel. Recomendo
> reaproveitar o painel para simplificar o deploy (um processo só), mas o webhook
> **precisa ficar exposto na internet** e o painel **não** — ver Fase 6.

### Fase 3 — Adaptar o boot ([index.js](sistema/index.js))
Remover todo o ciclo do `whatsapp-web.js`:
- Sai: `Client`, `LocalAuth`, `qrcode-terminal`, eventos `qr`/`ready`/
  `auth_failure`/`disconnected`, `iniciarClienteWhatsapp`, `apagarSessao`,
  `trocarWhatsapp`, pasta `data/sessions`.
- Entra: validação das variáveis do WhatsApp no boot (avisar via
  [avisos.js](sistema/avisos.js) se faltar token/phone id, como já se faz com a
  `DEEPSEEK_API_KEY` em [index.js:29](sistema/index.js#L29)).
- O "cliente" que hoje é passado a `handleMessage(client, message)` passa a ser o
  módulo `whatsapp.js` (ou nada — ver Fase 4).

### Fase 4 — Adaptar o handler ([bot.js](sistema/bot.js))
Mudanças **cirúrgicas**, graças ao adaptador:

- **Filtros** ([bot.js:240-247](sistema/bot.js#L240)): simplificam muito. A Cloud API
  **não entrega mensagens do próprio bot** nem **grupos** — o filtro `fromMe`/`@g.us`
  fica redundante (manter defensivo não custa). `parseWebhook` já descarta `statuses`.
- **Resolução de número/nome** ([bot.js:249-266](sistema/bot.js#L249)): **simplifica
  muito**. A Cloud API entrega sempre o **telefone real** em formato internacional
  (`messages[].from`) e o nome em `contacts[].profile.name`. Some toda a gambiarra de
  `@lid` / `contact.id.user`.
- **Envio de resposta**: trocar `message.reply(texto)` por
  `whatsapp.enviarTexto(numero, texto)`. (O adaptador pode expor `message.reply` como
  um atalho para isso, minimizando mudanças.)
- **Mídia** ([bot.js:332-347](sistema/bot.js#L332)): trocar `message.downloadMedia()`
  por `whatsapp.baixarMidia(mediaId)`. O resto (`transcreverAudio`/`descreverImagem`
  do [midia.js](sistema/midia.js)) **não muda** — já recebe base64 + mimetype.
- **Aviso ao advogado** ([bot.js:570-593](sistema/bot.js#L570)) e **alerta de mídia**
  ([bot.js:392-409](sistema/bot.js#L392)) — **decidido: template no WhatsApp (opção A)**,
  por ser o gatilho essencial que passa a conversa da LLM para a pessoa. É uma mensagem
  *iniciada pelo negócio* (o advogado não abriu janela de 24h), então **exige um template
  aprovado**:
  - Criar um template de **utilidade** na Meta com variáveis
    (`{{1}}` nome do cliente, `{{2}}` área, `{{3}}` motivo/resumo — e opcionalmente
    número/última mensagem). O campo `motivo` que a DeepSeek já gera entra na variável
    do resumo; ou seja, a **LLM segue produzindo o conteúdo**, só preenche as variáveis.
  - No código, trocar as duas chamadas `client.sendMessage(numeroHumano@c.us, aviso)`
    por `whatsapp.enviarTemplate(numeroHumano, AVISO_ADVOGADO_TEMPLATE, [nome, area, motivo])`.
  - Os templates de [mensagens.js](sistema/mensagens.js) hoje montam **texto livre**;
    para o advogado, o texto passa a ser o **layout submetido à Meta** (as variáveis
    substituem os placeholders `{nome}`/`{area}`/`{motivo}` atuais). A mensagem ao
    **cliente** continua texto livre (está na janela de 24h) — só a do advogado vira template.
  - **Dependência de cronograma:** o template precisa ser **aprovado pela Meta** antes
    do cutover (aprovação de utilidade costuma ser rápida). Enquanto não aprovado, dá para
    validar o resto do fluxo com o número de teste.
  - **Fallback operacional** (não é o plano, só rede de segurança): se um disparo de
    template falhar, registrar em [avisos.js](sistema/avisos.js) como já é feito hoje —
    o escritório vê o escalonamento no painel mesmo se o WhatsApp do advogado falhar.
- **Preservar as garantias existentes**: falha ao avisar advogado / atualizar `.md`
  **nunca** deve quebrar a resposta ao cliente (try/catch isolados — já é assim).
- A **pausa automática** após escalonar ([bot.js:598-603](sistema/bot.js#L598))
  continua igual.

### Fase 5 — Painel: aba "Conexão" ([painel.js](sistema/painel.js))
- Remover QR code, `setQR`, `setTrocarHandler`, botão "Trocar de WhatsApp" e a rota
  `POST /api/trocar` ([painel.js:1077](sistema/painel.js#L1077)).
- A aba passa a mostrar: número conectado, `phone_number_id`, e **status do token**
  (válido / ausente / expirado — um "ping" na Graph API resolve).
- Adicionar campo para **gravar o `WHATSAPP_TOKEN`** (espelhar
  [apikey.js](sistema/apikey.js) e as rotas `/api/apikey`).

### Fase 6 — Hospedagem e webhook público — **PC do escritório + túnel**
A Meta precisa **alcançar o webhook** por HTTPS com certificado válido. Como o bot
fica no **PC do escritório** (decisão tomada — mais controle), a exposição é via
**túnel**:
- **Cloudflare Tunnel** (recomendado): gratuito, TLS automático, URL estável se
  associada a um domínio; roda como serviço no Windows e sobe junto com a máquina.
  Alternativa: **ngrok** (mais simples de testar, mas a URL gratuita muda a cada
  reinício — ruim para produção, ok para a validação da Fase 7).
- **Expor apenas a rota `/webhook`** pelo túnel; manter o **painel** (porta 3000)
  acessível só na rede local.
- **Integrar ao [iniciar.bat](iniciar.bat):** o túnel precisa subir junto com o bot
  (e o guard de instância única deve considerar o processo do túnel).
- **Atenção (risco assumido):** dependemos do **PC ligado e do túnel de pé**. Se a
  máquina cair por > 24h, mensagens acumuladas exigiriam template para responder
  (janela de 24h). Mitigar com o PC sempre ligado / reinício automático do túnel.

### Fase 7 — Testes e cutover — **validação de ~1 semana**
1. Testar com o **número de teste** da Meta ponta a ponta: texto, áudio, imagem,
   fluxo de escalonamento (incl. **template do advogado**), pausa, DataJud/CRM.
2. Validar assinatura do webhook e reentrega (responder 200 rápido); conferir a
   deduplicação por `message.id`.
3. **Rodar em paralelo por ~1 semana:** manter a versão atual (`whatsapp-web.js`) no
   ar no número real enquanto a nova versão atende o número de teste. Acompanhar os
   [avisos.js](sistema/avisos.js)/`log.txt` para pegar casos de borda antes do corte.
4. Em paralelo à semana: verificar o negócio na Meta e **submeter o template do
   advogado** para aprovação (fazer cedo — é dependência do cutover).
5. **Cutover** (após a semana): migrar o número definitivo para a Cloud API, parar o
   processo `whatsapp-web.js` e subir a nova versão. Manter o commit antigo à mão
   para rollback rápido.

---

## 5. Mapa de conversão do payload (referência para `parseWebhook`)

| Hoje (`whatsapp-web.js`) | Cloud API (webhook) |
|---|---|
| `message.from` (`5511...@c.us`) | `entry[].changes[].value.messages[].from` (só dígitos, ex. `5511...`) |
| `message.fromMe` | (não existe — webhook só traz mensagens do cliente) |
| grupos `@g.us` | (não existe — Cloud API é 1:1) |
| `@lid` + `contact.id.user` | (desnecessário — sempre vem o telefone real) |
| `message.type` | `messages[].type` (`text`, `image`, `audio`, `document`, `video`…) |
| `message.body` | `messages[].text.body` (texto) / `messages[].image.caption` (legenda) |
| `message.getContact()` → nome | `value.contacts[].profile.name` (síncrono, já no payload) |
| `message.reply(txt)` | `enviarTexto(from, txt)` (POST na Graph API) |
| `message.downloadMedia()` → base64 | `baixarMidia(messages[].<tipo>.id)` → base64 |
| `client.sendMessage(n@c.us, txt)` | `enviarTexto(n, txt)` |
| eventos de status/entrega | `value.statuses[]` → **ignorar** |

Observação sobre números: a whitelist ([whitelist.js](sistema/whitelist.js)) já
tolera o "9" inicial — o formato internacional da Cloud API deve encaixar, mas
**revalidar** a normalização com um número real nos testes.

---

## 6. Riscos e pontos de atenção

- **Token permanente:** não usar o token de 24h da tela inicial; criar System User.
- **Janela de 24h:** o bot só responde dentro dela. No uso reativo isso é natural;
  o **único** caso de borda é o bot ficar **fora do ar > 24h** e só então responder —
  aí a resposta precisaria de template. Manter o bot online (VPS) elimina o risco.
- **Assinatura do webhook:** validar `X-Hub-Signature-256` — sem isso, qualquer um
  poderia postar mensagens forjadas no endpoint.
- **Responder 200 rápido:** processar a triagem em segundo plano; a Meta reentrega
  (e pode duplicar) se o webhook demorar. Considerar **deduplicação por `message.id`**.
- **Versão da Graph API:** fixar em `.env` (`GRAPH_API_VERSION`) — a Meta descontinua
  versões antigas periodicamente (mesma lógica do alias do Gemini em
  [midia.js:14](sistema/midia.js#L14)).
- **LGPD:** o webhook trafega dados de cliente — manter HTTPS, não logar corpo de
  mensagem em texto claro, seguir o padrão de git-ignore já adotado.
- **Sem testes automatizados:** validar por número de teste da Meta antes do cutover.

---

## 7. Resumo de custo (rota direta com a Meta)

| Item | Custo |
|---|---|
| Acesso à Cloud API | R$ 0 (hospedada pela Meta, sem BSP) |
| Conversas de serviço (cliente inicia, resposta em 24h) | **Grátis** — é todo o fluxo do cliente |
| Template do aviso ao advogado (opção A) | Pago por mensagem (utilidade, barato); **R$ 0** se optar pela opção B |
| VPS (se sair do PC do escritório) | ~R$ 25–50/mês |
| DeepSeek / Gemini | **Inalterado** (mesmo custo de hoje) |

> Preços da Meta mudam com frequência e variam por país/categoria — confirmar a
> tabela vigente ao configurar.

---

## 8. Meta direto × BSP (registro da decisão)

- **Direto (escolhido):** sem taxa de intermediário; você configura webhook,
  verificação e template. Mais barato, mais trabalho de setup.
- **BSP (Twilio/360dialog):** taxa por cima, mas cuida do webhook e ajuda na
  aprovação de templates e no suporte (em português). Vale reconsiderar se a
  configuração direta travar ou se for comercializar para vários escritórios.

---

## 9. Checklist de execução

Código já implementado (aguarda a conta na Meta + o número para testar):

- [ ] Fase 0 — App WhatsApp criado, número de teste enviando/recebendo *(fora do código — depende da conta Meta)*
- [x] Fase 1 — `whatsapp.js` (enviar, baixar mídia, parse, assinatura, status)
- [x] Fase 2 — rotas `GET`/`POST /webhook` no painel (com validação de assinatura e dedupe)
- [x] Fase 3 — `index.js` sem `whatsapp-web.js` (liga o webhook ao `handleMessage`)
- [x] Fase 4 — `bot.js` adaptado; **aviso ao advogado por Telegram** (`telegram.js`) — decisão
      revista de template para Telegram, a pedido; dispensa aprovação da Meta
- [x] Fase 5 — aba "Conexão" do painel sem QR; token/ID do WhatsApp e token do Telegram
      graváveis pelo painel (aba "Chave da API")
- [ ] Fase 6 — webhook público via túnel (Cloudflare Tunnel) no PC do escritório *(instalar o
      `cloudflared` como serviço; o `iniciar.bat` já avisa se faltar)*
- [ ] Fase 7 — testes ponta a ponta + ~1 semana em paralelo + verificação do negócio + cutover

**Decisão revista:** o aviso ao advogado passou de *template no WhatsApp* para **Telegram**
(a pedido, por ser gratuito, instantâneo e sem aprovação da Meta). Com isso, **nenhum
template é necessário** e a integração com o WhatsApp fica 100% reativa. Cada advogado guarda
seu `telegram_chat_id` em `advogados.json`; há fallback `TELEGRAM_CHAT_ID_PADRAO`.

### Arquivos alterados nesta implementação
- **Novos:** `sistema/whatsapp.js`, `sistema/telegram.js`
- **Alterados:** `sistema/index.js`, `sistema/bot.js`, `sistema/painel.js`, `sistema/apikey.js`,
  `sistema/advogados.js`, `sistema/package.json` (removidas deps `whatsapp-web.js`, `qrcode`,
  `qrcode-terminal`), `sistema/.env.example`, `iniciar.bat` (sem download do Chrome; checa o túnel)
- **Pendências de configuração (não-código):** criar app/numero na Meta, preencher
  `WHATSAPP_*` e `TELEGRAM_BOT_TOKEN` (pelo painel ou `.env`), instalar o `cloudflared`.
- [ ] Atualizar `CLAUDE.md`, `.env.example` e `iniciar.bat` (se mudar o boot)

---

## 10. Decisões tomadas

1. ✅ **Aviso ao advogado:** template no WhatsApp (opção A) — essencial para o handoff
   LLM → pessoa.
2. ✅ **Hospedagem:** PC do escritório + túnel (Cloudflare Tunnel recomendado).
3. ✅ **Validação:** ~1 semana com o número de teste, em paralelo à versão atual, antes
   do cutover.

**Próximo passo:** iniciar a Fase 0 (criar o app WhatsApp na Meta e obter o número de
teste) em paralelo à Fase 1 (escrever `sistema/whatsapp.js`), que não depende da conta.
</content>
</invoke>
