// index.js
// Ponto de entrada: inicializa o banco, o painel web e liga o webhook do
// WhatsApp oficial (Cloud API da Meta). As mensagens NAO chegam mais por um
// cliente Puppeteer (whatsapp-web.js) — elas chegam por HTTP no /webhook do
// painel (ver painel.js) e sao entregues ao handleMessage por aqui.

// Ativa o registro em log.txt antes de tudo (captura mensagens e erros).
require('./logger');

require('dotenv').config();

const db = require('./db');
const { handleMessage } = require('./bot');
const painel = require('./painel');
const avisos = require('./avisos');
const whatsapp = require('./whatsapp');

// 1) Inicializa o SQLite (cria tabelas e seed da instituicao padrao).
db.initDb();

// Aviso util se a chave da API da IA nao estiver configurada.
if (!process.env.DEEPSEEK_API_KEY) {
  console.warn('Aviso: DEEPSEEK_API_KEY nao definida no .env — as respostas vao falhar.');
  avisos.registrar('aviso', 'A chave da API ainda não foi configurada.',
    'O bot conecta ao WhatsApp, mas não vai responder até você colar a chave na aba "Chave da API".');
}

// Aviso se o WhatsApp oficial ainda nao estiver configurado.
if (!whatsapp.temWhatsappConfig()) {
  console.warn('Aviso: WhatsApp Cloud API nao configurada (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID).');
  avisos.registrar('aviso', 'A conexão com o WhatsApp oficial ainda não foi configurada.',
    'Configure o token e o ID do número (aba "Chave da API"). Sem isso o bot não recebe nem responde mensagens.');
}

// Aviso de seguranca: sem o segredo do app, a assinatura do webhook nao e validada.
if (!(process.env.WHATSAPP_APP_SECRET || '').trim()) {
  console.warn('Aviso: WHATSAPP_APP_SECRET nao definido — a assinatura do webhook NAO sera validada.');
}

// 2) Sobe o painel web (status, chaves e — importante — o endpoint /webhook).
const PORTA_PAINEL = Number(process.env.PAINEL_PORTA || 3000);
painel.iniciarPainel(PORTA_PAINEL);

// 3) Liga o webhook ao handler de mensagens. Cada mensagem recebida (ja
// convertida por whatsapp.parseWebhook dentro do painel) chega aqui.
painel.setWebhookHandler((message) => {
  handleMessage(whatsapp, message).catch((err) => {
    console.error('Erro nao tratado no handler:', err);
    avisos.registrar('erro', 'Não consegui processar uma mensagem recebida.',
      'Ocorreu um erro inesperado ao atender um cliente. Se acontecer com frequência, reinicie o programa.');
  });
});

// 4) Status inicial da "conexao" mostrado no painel. Como o WhatsApp oficial nao
// tem um evento de "conectado" (e stateless por HTTP), consideramos conectado
// quando ha token + numero configurados; o painel refina com um ping ao token.
painel.setStatus(whatsapp.temWhatsappConfig() ? 'conectado' : 'desconectado');

console.log('Bot pronto. Aguardando mensagens no webhook do WhatsApp oficial.');
</content>
</invoke>
