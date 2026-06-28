// logger.js
// Registra tudo que acontece no bot (mensagens, avisos e erros) em um arquivo
// log.txt, com data e hora. Tambem captura erros nao tratados, para nada se perder.
//
// IMPORTANTE: deve ser o PRIMEIRO require do index.js, para passar a registrar
// antes de qualquer outra coisa.

const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, 'log.txt');
const BACKUP_PATH = path.join(__dirname, 'log-anterior.txt');
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — acima disso, rotaciona.

// Se o log ficar grande demais, guarda um backup e recomeca um novo.
function rotacionarSeNecessario() {
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > MAX_BYTES) {
      fs.rmSync(BACKUP_PATH, { force: true });
      fs.renameSync(LOG_PATH, BACKUP_PATH);
    }
  } catch (_) {
    // Falha ao rotacionar nao deve derrubar o bot.
  }
}

// Data/hora local no formato YYYY-MM-DD HH:MM:SS.
function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function paraTexto(a) {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack || a.message;
  try {
    return JSON.stringify(a);
  } catch (_) {
    return String(a);
  }
}

function escrever(nivel, args) {
  rotacionarSeNecessario();
  const texto = args.map(paraTexto).join(' ');
  const linha = `[${timestamp()}] [${nivel}] ${texto}\n`;
  try {
    fs.appendFileSync(LOG_PATH, linha, 'utf8');
  } catch (_) {
    // Se nao conseguir escrever no arquivo, ao menos nao quebra a execucao.
  }
}

// Mantem o comportamento original do console e adiciona a gravacao em arquivo.
const original = { log: console.log, warn: console.warn, error: console.error };
console.log = (...a) => { original.log(...a); escrever('INFO', a); };
console.warn = (...a) => { original.warn(...a); escrever('AVISO', a); };
console.error = (...a) => { original.error(...a); escrever('ERRO', a); };

// Captura erros que escapariam e derrubariam o processo silenciosamente.
process.on('uncaughtException', (err) => {
  escrever('FATAL', ['Excecao nao tratada:', err]);
  original.error(err);
});
process.on('unhandledRejection', (motivo) => {
  escrever('FATAL', ['Promise rejeitada sem tratamento:', motivo]);
  original.error(motivo);
});

console.log('===== Log iniciado =====');

module.exports = { LOG_PATH };
