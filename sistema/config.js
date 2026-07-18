// config.js
// Opcoes de funcionamento do bot que antes so existiam no codigo/.env e agora
// sao editaveis pela aba "Outras opcoes" do painel.
//
// Mesmo padrao dos outros modulos de config (mensagens.js, triagem.js): o
// DEFAULT mora no codigo, o config.json e OPCIONAL (so existe se alguem editou
// pelo painel) e o arquivo e lido A CADA USO — ou seja, mudar uma opcao vale na
// hora, sem reiniciar o bot.
//
// Precedencia: config.json > .env > default do codigo. Assim quem ja tinha
// DEBOUNCE_MS/HISTORICO_LIMIT/MIDIA_COOLDOWN_MS no .env nao ve mudanca de
// comportamento ate mexer no painel.

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

// Piso do intervalo entre mensagens: o bot NUNCA responde com menos de 5s de
// silencio do cliente, mesmo no modo "primeira mensagem" (ver bot.js). Nao e
// editavel — e o que impede o bot de cortar a pessoa no meio do raciocinio.
const MIN_SILENCIO_MS = 5000;

// Definicao de cada opcao: default (com o .env como fallback) e limites usados
// tanto no painel quanto ao salvar (para valer mesmo se editarem o .json na mao).
const OPCOES = {
  esperaMs: {
    padrao: Number(process.env.DEBOUNCE_MS) || 5000,
    min: MIN_SILENCIO_MS,      // nunca menos que o piso de silencio
    max: 10 * 60 * 1000,       // 10 minutos
  },
  historicoLimite: {
    padrao: Number(process.env.HISTORICO_LIMIT) || 30,
    min: 5,
    max: 200,
  },
  midiaCooldownMs: {
    padrao: Number(process.env.MIDIA_COOLDOWN_MS) || 60000,
    min: 0,
    max: 60 * 60 * 1000,       // 1 hora
  },
};

// Modos de contagem da espera (ver bot.js):
//  'ultima'  -> conta a partir da ULTIMA mensagem; cada nova mensagem reinicia.
//  'primeira'-> conta a partir da PRIMEIRA mensagem do lote, respeitando o piso
//               de MIN_SILENCIO_MS apos a ultima.
const MODOS_ESPERA = ['ultima', 'primeira'];

// Prende um numero entre min e max; valor invalido cai no padrao.
function limitar(valor, { padrao, min, max }) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Le as opcoes efetivas. Arquivo ausente/invalido ou campo faltando cai no
 * padrao — o bot nunca deixa de funcionar por causa do config.json.
 */
function lerConfig() {
  let dados = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      dados = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
    }
  } catch (e) {
    console.error('Erro ao ler config.json (usando os padroes):', e.message);
    dados = {};
  }
  return {
    esperaMs: dados.esperaMs === undefined
      ? OPCOES.esperaMs.padrao : limitar(dados.esperaMs, OPCOES.esperaMs),
    esperaModo: MODOS_ESPERA.includes(dados.esperaModo) ? dados.esperaModo : 'ultima',
    historicoLimite: dados.historicoLimite === undefined
      ? OPCOES.historicoLimite.padrao : limitar(dados.historicoLimite, OPCOES.historicoLimite),
    midiaCooldownMs: dados.midiaCooldownMs === undefined
      ? OPCOES.midiaCooldownMs.padrao : limitar(dados.midiaCooldownMs, OPCOES.midiaCooldownMs),
  };
}

/**
 * Grava as opcoes (painel). Aplica os limites antes de salvar e preserva o que
 * nao veio no payload. Retorna o que ficou efetivamente valendo.
 */
function salvarConfig(payload = {}) {
  const atual = lerConfig();
  const conteudo = {
    esperaMs: payload.esperaMs === undefined
      ? atual.esperaMs : limitar(payload.esperaMs, OPCOES.esperaMs),
    esperaModo: MODOS_ESPERA.includes(payload.esperaModo) ? payload.esperaModo : atual.esperaModo,
    historicoLimite: payload.historicoLimite === undefined
      ? atual.historicoLimite : limitar(payload.historicoLimite, OPCOES.historicoLimite),
    midiaCooldownMs: payload.midiaCooldownMs === undefined
      ? atual.midiaCooldownMs : limitar(payload.midiaCooldownMs, OPCOES.midiaCooldownMs),
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(conteudo, null, 2), 'utf8');
  return conteudo;
}

module.exports = { lerConfig, salvarConfig, MIN_SILENCIO_MS, MODOS_ESPERA, OPCOES };
