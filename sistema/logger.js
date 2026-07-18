// logger.js
// Registra tudo que acontece no bot (mensagens, avisos e erros) em um arquivo
// log.txt, com data e hora. Tambem captura erros nao tratados, para nada se perder.
//
// IMPORTANTE: deve ser o PRIMEIRO require do index.js, para passar a registrar
// antes de qualquer outra coisa.

const fs = require('fs');
const path = require('path');
const avisos = require('./avisos');

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
//
// ⚠️ A ORDEM IMPORTA: grava no ARQUIVO primeiro, no console depois. Escrever no
// console do Windows pode BLOQUEAR (ver watchdog.ps1: o "Modo de Edicao Rapida"
// congela o processo enquanto ha texto selecionado na janela). Com o console
// primeiro, a linha travava antes de chegar no arquivo e o log simplesmente
// parava, sem deixar pista da hora nem do ponto em que travou — foi assim que
// perdemos 5h de atendimento em 18/07/2026 sem nenhum erro registrado.
// Invertida, a ultima linha do log.txt passa a ser exatamente onde o bot parou.
const original = { log: console.log, warn: console.warn, error: console.error };
console.log = (...a) => { escrever('INFO', a); original.log(...a); };
console.warn = (...a) => { escrever('AVISO', a); original.warn(...a); };
console.error = (...a) => { escrever('ERRO', a); original.error(...a); };

// Captura erros que escapariam e derrubariam o processo silenciosamente.
process.on('uncaughtException', (err) => {
  escrever('FATAL', ['Excecao nao tratada:', err]);
  original.error(err);
  try {
    avisos.registrar('erro', 'Ocorreu um erro inesperado no sistema.',
      'O bot pode ter ficado instável. Se algo parar de funcionar, feche esta janela e abra o programa novamente.');
  } catch (_) { /* nunca deixar o registro do aviso derrubar o processo */ }
});
process.on('unhandledRejection', (motivo) => {
  escrever('FATAL', ['Promise rejeitada sem tratamento:', motivo]);
  original.error(motivo);
  try {
    avisos.registrar('erro', 'Ocorreu um erro inesperado no sistema.',
      'O bot pode ter ficado instável. Se algo parar de funcionar, feche esta janela e abra o programa novamente.');
  } catch (_) { /* idem */ }
});

console.log('===== Log iniciado =====');

// Batimento de vida: a cada 5 minutos registra que o bot ainda esta processando.
// Usa escrever() DIRETO, sem passar pelo console — o objetivo e justamente
// sobreviver a um console travado (ver comentario acima). E como o setInterval
// depende do event loop, um bot congelado para de bater: a hora do ultimo
// "[VIVO]" no log.txt e a hora em que ele travou. Sem isso, um travamento fica
// indistinguivel de "nao chegou mensagem nenhuma nesse periodo".
const INTERVALO_VIVO_MS = 5 * 60 * 1000;
const batimento = setInterval(() => {
  const min = Math.round(process.uptime() / 60);
  escrever('INFO', [`[VIVO] bot ativo ha ${min} min`]);
}, INTERVALO_VIVO_MS);
// Nao segura o processo aberto so por causa do timer.
batimento.unref();

module.exports = { LOG_PATH };
