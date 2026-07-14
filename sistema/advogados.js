// advogados.js
// Roteamento do escalonamento para advogados, por area do direito.
// A configuracao fica em advogados.json — para adicionar um novo advogado,
// basta editar aquele arquivo (nenhuma mudanca de codigo e necessaria).

const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(__dirname, 'advogados.json');

/**
 * Le a lista de advogados do arquivo de configuracao.
 * Retorna [] (com aviso no console) se o arquivo nao existir ou estiver invalido.
 * E lido a cada uso, entao alteracoes no JSON valem sem reiniciar o bot.
 */
function getAdvogados() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      console.warn('Aviso: advogados.json nao encontrado.');
      return [];
    }
    const dados = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    // Aceita tanto { "advogados": [...] } quanto um array direto [...].
    const lista = Array.isArray(dados) ? dados : dados.advogados;
    // Mantem quem tem numero OU chat do Telegram (o aviso vai pelo Telegram).
    return Array.isArray(lista) ? lista.filter((a) => a && (a.numero || a.telegram_chat_id)) : [];
  } catch (err) {
    console.error('Erro ao ler advogados.json:', err.message);
    return [];
  }
}

/**
 * Lista unica das areas cobertas pelos advogados ativos.
 * Serve para orientar o modelo na hora de classificar o assunto.
 */
function getAreasDisponiveis() {
  const areas = new Set();
  for (const adv of getAdvogados()) {
    if (adv.ativo === false) continue;
    (adv.areas || []).forEach((a) => areas.add(String(a).toLowerCase().trim()));
  }
  return [...areas].filter(Boolean);
}

/**
 * Escolhe o advogado responsavel por uma area, na seguinte ordem:
 *   1) advogado cuja lista de areas contem a area informada;
 *   2) advogado marcado como "padrao": true;
 *   3) primeiro advogado ativo da lista.
 * Retorna undefined se nao houver nenhum advogado ativo configurado.
 */
function escolherAdvogado(area) {
  const lista = getAdvogados().filter((a) => a.ativo !== false);
  if (lista.length === 0) return undefined;

  const alvo = String(area || '').toLowerCase().trim();
  const porArea = lista.find((a) =>
    (a.areas || []).map((x) => String(x).toLowerCase().trim()).includes(alvo)
  );
  if (porArea) return porArea;

  const padrao = lista.find((a) => a.padrao);
  return padrao || lista[0];
}

/**
 * Salva a lista de advogados no arquivo de configuracao (advogados.json).
 * Normaliza cada registro e descarta os que nao tiverem numero. Lanca erro se
 * a entrada nao for um array. Como o arquivo e lido a cada uso, as alteracoes
 * valem sem reiniciar o bot. Retorna a lista normalizada que foi gravada.
 */
function salvarAdvogados(lista) {
  if (!Array.isArray(lista)) {
    throw new Error('A lista de advogados precisa ser um array.');
  }

  const normalizada = lista
    .map((a) => ({
      nome: String((a && a.nome) || '').trim(),
      numero: String((a && a.numero) || '').replace(/\D/g, ''),
      // Chat do Telegram (id numerico ou @usuario) para onde o aviso e enviado.
      // Aceita numero negativo (grupos) e o prefixo @; guarda como string.
      telegram_chat_id: String((a && a.telegram_chat_id) || '').trim(),
      // areas pode vir como array ou string separada por virgulas.
      areas: (Array.isArray(a && a.areas)
        ? a.areas
        : String((a && a.areas) || '').split(','))
        .map((x) => String(x).toLowerCase().trim())
        .filter(Boolean),
      padrao: !!(a && a.padrao),
      ativo: !(a && a.ativo === false),
    }))
    .filter((a) => a.numero || a.telegram_chat_id); // precisa de ao menos um destino

  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ advogados: normalizada }, null, 2) + '\n', 'utf8');
  return normalizada;
}

module.exports = { getAdvogados, getAreasDisponiveis, escolherAdvogado, salvarAdvogados };
