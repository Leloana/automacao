// index.js
// Ponto de entrada: inicializa o banco, o painel web e o cliente do WhatsApp.

// Ativa o registro em log.txt antes de tudo (captura mensagens e erros).
require('./logger');

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const db = require('./db');
const { handleMessage } = require('./bot');
const painel = require('./painel');

// Garante que as pastas necessarias existam.
const SESSIONS_DIR = path.join(__dirname, 'data', 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// 1) Inicializa o SQLite (cria tabelas e seed da instituicao padrao).
db.initDb();

// Aviso util se a chave da API nao estiver configurada.
if (!process.env.DEEPSEEK_API_KEY) {
  console.warn('Aviso: DEEPSEEK_API_KEY nao definida no .env — as respostas vao falhar.');
}

// 2) Sobe o painel web (status da conexao + QR code + whitelist).
const PORTA_PAINEL = Number(process.env.PAINEL_PORTA || 3000);
painel.iniciarPainel(PORTA_PAINEL);

// 3) Cliente do WhatsApp. Fica em uma variavel mutavel porque, ao "trocar de
// WhatsApp", destruimos o cliente atual e criamos um novo (com sessao limpa).
let client;

/**
 * Cria um novo cliente do WhatsApp, religa todos os eventos no painel e inicia.
 * A sessao e persistida em data/sessions (LocalAuth).
 */
function iniciarClienteWhatsapp() {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSIONS_DIR }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  // QR code: mostra no terminal E envia para o painel web.
  client.on('qr', (qr) => {
    console.log(`Escaneie o QR code no painel (http://localhost:${PORTA_PAINEL}) ou abaixo:`);
    qrcode.generate(qr, { small: true });
    painel.setQR(qr);
  });

  // Eventos de conexao -> refletem no painel.
  client.on('authenticated', () => {
    console.log('Autenticado, conectando...');
  });

  client.on('ready', () => {
    console.log('Bot conectado!');
    painel.setStatus('conectado');
  });

  client.on('auth_failure', (msg) => {
    console.error('Falha de autenticacao:', msg);
    painel.setStatus('falha');
  });

  client.on('disconnected', (reason) => {
    console.warn('Cliente desconectado:', reason);
    painel.setStatus('desconectado');
  });

  // Escuta todas as mensagens (message_create cobre enviadas e recebidas;
  // os filtros ficam no proprio handler).
  client.on('message_create', (message) => {
    handleMessage(client, message).catch((err) => {
      console.error('Erro nao tratado no handler:', err);
    });
  });

  client.initialize();
}

/**
 * Apaga a pasta de sessao de forma resiliente. No Windows, o puppeteer pode
 * segurar arquivos por um instante apos fechar; por isso tentamos algumas vezes.
 */
function apagarSessao() {
  for (let i = 0; i < 5; i++) {
    try {
      if (fs.existsSync(SESSIONS_DIR)) {
        fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
      }
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      return;
    } catch (e) {
      console.warn(`Tentativa ${i + 1} de apagar a sessao falhou: ${e.message}`);
      // Pequena espera sincrona entre tentativas (libera o lock no Windows).
      const ate = Date.now() + 400;
      while (Date.now() < ate) { /* espera ativa curta */ }
    }
  }
  console.error('Nao foi possivel apagar a pasta de sessao por completo.');
}

/**
 * "Trocar de WhatsApp": desconecta a conta atual, apaga a sessao salva e cria
 * um cliente novo, que gera um QR code para a proxima conta escanear.
 */
async function trocarWhatsapp() {
  console.log('Trocando de WhatsApp: encerrando a sessao atual...');
  painel.setStatus('carregando');

  // logout() desvincula a conta (quando conectada); destroy() fecha o navegador.
  // Ambos podem falhar se o cliente nao estiver pronto — seguimos mesmo assim.
  try { await client.logout(); } catch (e) { console.warn('logout falhou (ok):', e.message); }
  try { await client.destroy(); } catch (e) { console.warn('destroy falhou (ok):', e.message); }

  apagarSessao();

  console.log('Sessao apagada. Gerando novo QR code...');
  iniciarClienteWhatsapp();
}

// Disponibiliza a troca de WhatsApp para o botao do painel.
painel.setTrocarHandler(trocarWhatsapp);

// 4) Inicia o cliente do WhatsApp.
iniciarClienteWhatsapp();
