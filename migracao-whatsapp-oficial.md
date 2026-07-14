# Migração para o WhatsApp oficial — o que foi feito e como concluir

Documento de entrega da migração do bot do **`whatsapp-web.js`** (não-oficial) para a
**WhatsApp Cloud API oficial da Meta**. Serve para retomar o trabalho sem reexplorar tudo.

- **Status:** código **pronto**; falta só a **configuração** (conta na Meta, número,
  tokens e túnel) — nada disso é código.
- **Plano completo** (fases, custos, decisões): [plano-migracao.md](plano-migracao.md).
- ⚠️ **Ainda não foi testado em runtime** (o ambiente de desenvolvimento não tem Node).
  O primeiro boot deve ser na máquina Windows do escritório, acompanhado.

---

## 1. Por que migramos

O sistema usava `whatsapp-web.js`, que **automatiza o WhatsApp Web por um navegador**
(Puppeteer). Isso é **contra os termos da Meta** e leva ao **bloqueio do número** — foi o
que aconteceu com o WhatsApp pessoal. A **Cloud API oficial** é a forma suportada: sem
risco de ban por automação, mensagens por **webhook** (recebe) e **HTTP/Graph API** (envia).

**Decisão de projeto:** o aviso ao advogado saiu do WhatsApp e passou para o **Telegram**.
Motivo: na API oficial, mandar mensagem para quem **não** iniciou conversa (o advogado não
escreve para o bot) exigiria um **template aprovado pela Meta**. O Telegram é gratuito,
instantâneo e sem aprovação. Com isso, a integração com o WhatsApp fica **100% reativa**
(só responde quem escreve) e **nenhum template é necessário**.

---

## 2. O que foi feito (no código)

O "cérebro" (triagem DeepSeek, prompt, DataJud, CRM, contexto `.md`, histórico, whitelist,
pausa) **não mudou**. Só trocou a camada de transporte do WhatsApp.

**Arquivos novos**
- [sistema/whatsapp.js](sistema/whatsapp.js) — transporte da Cloud API: enviar texto,
  baixar mídia (por `media_id`), converter o payload do webhook em "mensagens" com a mesma
  interface de antes (por isso o `bot.js` quase não mudou), validar a assinatura do webhook
  e checar o status do token.
- [sistema/telegram.js](sistema/telegram.js) — envia o aviso ao advogado pelo Telegram.

**Arquivos alterados**
- [sistema/index.js](sistema/index.js) — removido o `whatsapp-web.js` (Puppeteer/QR/sessão);
  liga o `/webhook` ao `handleMessage`.
- [sistema/bot.js](sistema/bot.js) — escalonamento e alerta de mídia agora vão por Telegram
  (sem `client.sendMessage`).
- [sistema/painel.js](sistema/painel.js) — rotas `GET`/`POST /webhook` (com validação de
  assinatura, resposta 200 imediata e deduplicação); aba Conexão sem QR; campos para o
  **token + ID do WhatsApp** e o **token do Telegram**; campo **Chat do Telegram** por
  advogado.
- [sistema/apikey.js](sistema/apikey.js) — grava/aplica os tokens do WhatsApp e do Telegram.
- [sistema/advogados.js](sistema/advogados.js) — novo campo `telegram_chat_id`.
- [sistema/package.json](sistema/package.json) — removidas as dependências `whatsapp-web.js`,
  `qrcode` e `qrcode-terminal` (não há mais navegador embutido).
- [sistema/.env.example](sistema/.env.example) e
  [sistema/advogados.json.exemplo](sistema/advogados.json.exemplo) — novos campos.
- [iniciar.bat](iniciar.bat) — sem download do Chrome/Puppeteer; confere se o `cloudflared`
  (túnel) está instalado.
- [CLAUDE.md](CLAUDE.md) e [plano-migracao.md](plano-migracao.md) — documentação atualizada.

---

## 3. O que falta (só configuração)

1. Conta na Meta + **número dedicado** ao bot e os dados da API.
2. **Bot do Telegram** + `chat_id` de cada advogado.
3. **Túnel** (`cloudflared`) para o webhook alcançar o PC do escritório.
4. **Apontar o webhook** no painel da Meta e **testar**.

Nada disso exige mexer no código. Os tokens podem ser colados no **painel**
(aba "Chave da API").

---

## 4. Como fazer o que falta (passo a passo)

### Passo A — WhatsApp oficial (Meta)
1. Acesse **[developers.facebook.com](https://developers.facebook.com/)** e crie/entre no
   **[Meta Business Portfolio](https://business.facebook.com/)** do escritório.
   (Guia oficial: [Cloud API — Começar](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started).)
2. Crie um **App** do tipo **WhatsApp**. No produto WhatsApp, você verá um **número de
   teste** grátis e o **Phone Number ID** — anote o ID.
3. Em *WhatsApp > Configuração da API*, gere um **token**. Para produção, crie um
   **Usuário do sistema** em
   **[business.facebook.com/settings/system-users](https://business.facebook.com/settings/system-users)**
   e gere um **token permanente** (o token que aparece na tela inicial **expira em 24h** —
   não usar). Guia:
   [token permanente](https://developers.facebook.com/docs/whatsapp/business-management-api/get-started).
4. Em *Configurações do app > Básico*, copie o **App Secret** (segredo do app).
5. Escolha uma frase secreta qualquer para o **Verify Token** (você define; será usada na
   verificação do webhook no Passo D).
6. Verifique o negócio (CNPJ) quando for sair do modo de teste.

No **painel do bot** (aba "Chave da API"), cole o **token** e o **ID do número**. O
**Verify Token**, o **App Secret** e a **versão da Graph API** ficam no `.env`
(ver [sistema/.env.example](sistema/.env.example)): `WHATSAPP_VERIFY_TOKEN`,
`WHATSAPP_APP_SECRET`, `GRAPH_API_VERSION`.

### Passo B — Telegram (aviso ao advogado)
1. No Telegram, fale com o **[@BotFather](https://t.me/BotFather)** → `/newbot` → siga as
   instruções → copie o **token** do bot.
2. Cole o token no **painel** (aba "Chave da API", seção Telegram).
3. Para cada advogado, obtenha o **chat_id**: peça para ele abrir o seu bot e enviar
   qualquer mensagem; então acesse
   `https://api.telegram.org/bot<SEU_TOKEN>/getUpdates` (troque `<SEU_TOKEN>` pelo token do
   bot) e veja o `chat.id`. Alternativa mais fácil: peça para ele falar com o
   **[@userinfobot](https://t.me/userinfobot)**, que responde o próprio id. (Ou use um
   **grupo** com o bot dentro — o `chat.id` do grupo é negativo, ex. `-1001234567890`, e
   todos os advogados recebem no mesmo lugar.)
4. No painel (aba "Advogados"), preencha o **Chat do Telegram** de cada advogado. Opcional:
   defina `TELEGRAM_CHAT_ID_PADRAO` no `.env` como destino de reserva.

### Passo C — Túnel do webhook (`cloudflared`)
O webhook da Meta precisa alcançar o PC do escritório por HTTPS.
1. Instale o **cloudflared** no Windows (Cloudflare Tunnel) —
   [download](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. Configure um túnel apontando para `http://localhost:3000` e instale-o como **serviço**
   (`cloudflared service install`), para subir sozinho com o Windows. Guia:
   [criar um túnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/).
3. Anote a **URL pública** do túnel (ex.: `https://algo.trycloudflare.com` ou o seu
   domínio). O endpoint do webhook será `https://<sua-URL>/webhook`.
4. O [iniciar.bat](iniciar.bat) apenas **avisa** se o `cloudflared` não estiver instalado;
   ele não sobe o túnel (o serviço faz isso).

> Exponha **só** a rota `/webhook`. O painel (porta 3000) deve continuar acessível apenas na
> rede local.

### Passo D — Apontar e verificar o webhook (Meta)
1. No app da Meta, em *WhatsApp > Configuração*, seção **Webhook**, clique em **Editar**.
2. **Callback URL:** `https://<sua-URL-do-túnel>/webhook`.
3. **Verify token:** exatamente o mesmo `WHATSAPP_VERIFY_TOKEN` do `.env`.
4. Ao salvar, a Meta faz um `GET` de verificação; o bot responde o desafio automaticamente.
5. Em **Campos do webhook**, assine o campo **messages**.

### Passo E — Testar (validação de ~1 semana)
1. Com o bot rodando (`iniciar.bat`) e o túnel ativo, mande uma mensagem do **número de
   teste** para o número do bot e confira a resposta.
2. Teste: texto, **áudio**, **imagem**, **escalonamento** (deve chegar o aviso no
   **Telegram** e o cliente ser **pausado**), e as consultas **DataJud/CRM**.
3. Acompanhe a aba **Avisos** do painel e o `log.txt`.
4. Rode em paralelo à versão atual (no número real) por ~1 semana para pegar casos de borda.

### Passo F — Cutover (virada)
1. Migre o **número definitivo** para a Cloud API (ele deixa de funcionar no app comum).
2. Verifique o negócio na Meta (se ainda não).
3. Pare a versão antiga e suba a nova. Guarde o commit anterior para rollback.

---

## 5. Referência das variáveis (`sistema/.env`)

| Variável | Para quê | Onde configurar |
|---|---|---|
| `WHATSAPP_TOKEN` | Token de acesso (permanente) | Painel ou `.env` |
| `WHATSAPP_PHONE_NUMBER_ID` | ID do número (não é o telefone) | Painel ou `.env` |
| `WHATSAPP_VERIFY_TOKEN` | Verificação do webhook (você escolhe) | `.env` |
| `WHATSAPP_APP_SECRET` | Valida a assinatura do webhook | `.env` |
| `GRAPH_API_VERSION` | Versão da Graph API (padrão `v21.0`) | `.env` |
| `TELEGRAM_BOT_TOKEN` | Bot do Telegram (aviso ao advogado) | Painel ou `.env` |
| `TELEGRAM_CHAT_ID_PADRAO` | Destino de reserva do aviso (opcional) | `.env` |

`telegram_chat_id` de cada advogado fica em `advogados.json` (editável pelo painel).

---

## 6. Observações importantes

- **Janela de 24h:** o bot só responde livremente dentro de 24h da última mensagem do
  cliente. No uso reativo isso é o normal; o único risco é o bot ficar **fora do ar > 24h**
  e só então responder. Mantenha o PC ligado e o túnel de pé.
- **Sem `WHATSAPP_APP_SECRET`** o webhook funciona, mas **não valida a assinatura** (há um
  aviso no boot). Configure-o para produção.
- **Assinatura inválida** → o webhook recusa o POST (403). Se as mensagens não chegarem,
  confira o App Secret e o Verify Token.
- **Node 22** continua obrigatório (por causa do `better-sqlite3`), como antes.

---

## 7. Links úteis

**Meta / WhatsApp Cloud API**
- Meta for Developers: https://developers.facebook.com/
- Meta Business (Business Manager): https://business.facebook.com/
- Usuários do sistema (token permanente): https://business.facebook.com/settings/system-users
- Cloud API — Começar: https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
- Token permanente (guia): https://developers.facebook.com/docs/whatsapp/business-management-api/get-started
- Configurar webhooks: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks
- Enviar mensagens: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
- Preços do WhatsApp: https://developers.facebook.com/docs/whatsapp/pricing
- Versões da Graph API (changelog): https://developers.facebook.com/docs/graph-api/changelog

**Telegram**
- BotFather (criar o bot): https://t.me/BotFather
- Descobrir o chat_id: https://t.me/userinfobot
- API getUpdates (ver o chat.id): `https://api.telegram.org/bot<SEU_TOKEN>/getUpdates`
- Bot API (docs): https://core.telegram.org/bots/api

**Cloudflare Tunnel (webhook)**
- Download do cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
- Criar um túnel (guia): https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/
- Rodar como serviço no Windows: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/as-a-service/

**DeepSeek / Gemini (já usados, referência)**
- DeepSeek (chave da API): https://platform.deepseek.com/
- Google AI Studio (chave do Gemini): https://aistudio.google.com/api-keys

**Deste projeto**
- Plano completo da migração: [plano-migracao.md](plano-migracao.md)
- Guia do projeto: [CLAUDE.md](CLAUDE.md)
</content>
</invoke>
