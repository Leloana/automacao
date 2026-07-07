// whitelist.js
// Controla quais numeros sao respondidos automaticamente pelo bot.
// A whitelist esta SEMPRE ativa: o bot responde apenas os numeros da lista.
// A configuracao fica em whitelist.json (gerenciavel pelo painel web).

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'whitelist.json');

// Mantem apenas os digitos de um numero (remove +, espacos, mascara, etc.).
function soDigitos(s) {
  return String(s || '').replace(/\D/g, '');
}

/**
 * Le a configuracao da whitelist. Em caso de arquivo ausente ou invalido,
 * retorna a lista VAZIA (nao responde ninguem) para nunca responder numero
 * nao autorizado por engano.
 */
function lerConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return { habilitada: true, numeros: [] };
    }
    const dados = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      habilitada: true, // whitelist sempre ativa
      numeros: Array.isArray(dados.numeros)
        ? dados.numeros.map(soDigitos).filter(Boolean)
        : [],
    };
  } catch (e) {
    console.error('Erro ao ler whitelist.json:', e.message);
    return { habilitada: true, numeros: [] };
  }
}

/**
 * Grava a configuracao (usado pelo painel). Normaliza os numeros e remove
 * duplicados. Retorna o objeto efetivamente salvo.
 */
function salvarConfig({ numeros }) {
  const limpos = Array.isArray(numeros)
    ? [...new Set(
        numeros
          .map(soDigitos)
          // Numero brasileiro: pais(55) + DDD(2) + numero(8 ou 9) = 12 ou 13 digitos.
          .filter((n) => n.length >= 12 && n.length <= 13)
      )]
    : [];
  const conteudo = { habilitada: true, numeros: limpos };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(conteudo, null, 2), 'utf8');
  return conteudo;
}

/**
 * Gera as variantes de um numero brasileiro com e sem o "9" inicial do celular,
 * para a whitelist casar independentemente de como o numero foi cadastrado.
 * Ex: 5511999999999 (com 9) <-> 551199999999 (sem 9).
 */
function variantes(n) {
  const set = new Set([n]);
  if (n.startsWith('55')) {
    const ddd = n.slice(2, 4);
    const resto = n.slice(4);
    if (resto.length === 9 && resto[0] === '9') set.add('55' + ddd + resto.slice(1)); // remove o 9
    if (resto.length === 8) set.add('55' + ddd + '9' + resto);                          // adiciona o 9
  }
  return [...set];
}

/**
 * Indica se um numero pode ser respondido automaticamente.
 * A whitelist esta sempre ativa: responde apenas os numeros da lista
 * (tolerando o "9" inicial do celular).
 */
function numeroPermitido(numero) {
  const cfg = lerConfig();
  const vars = variantes(soDigitos(numero));
  return vars.some((v) => cfg.numeros.includes(v));
}

module.exports = { numeroPermitido, lerConfig, salvarConfig, soDigitos };
