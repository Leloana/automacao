// whitelist.js
// Controla quais numeros sao respondidos automaticamente pelo bot.
// Por padrao a whitelist esta SEMPRE ativa: o bot responde apenas os numeros
// da lista. Existe uma excecao PERIGOSA: o modo "liberarTodos" (responder todo
// mundo), que desliga a whitelist e faz o bot responder QUALQUER numero. Esse
// modo so deve ser ligado de proposito pelo painel (com varios avisos).
// Existe ainda a BLACKLIST (bloqueados): numeros que NUNCA sao respondidos,
// nem com "responder todo mundo" ligado. E o unico jeito de silenciar alguem
// enquanto o modo liberado esta ativo (ex.: "remover autorizacao" no painel).
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
      return { habilitada: true, liberarTodos: false, numeros: [], bloqueados: [] };
    }
    const dados = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      habilitada: true, // whitelist sempre ativa (salvo liberarTodos)
      // Modo "responder todo mundo": quando true, a whitelist e IGNORADA e o
      // bot responde QUALQUER numero. So fica true se ligado de proposito.
      liberarTodos: dados.liberarTodos === true,
      numeros: Array.isArray(dados.numeros)
        ? dados.numeros.map(soDigitos).filter(Boolean)
        : [],
      // Blacklist: nunca respondidos, nem com liberarTodos ligado.
      bloqueados: Array.isArray(dados.bloqueados)
        ? dados.bloqueados.map(soDigitos).filter(Boolean)
        : [],
    };
  } catch (e) {
    console.error('Erro ao ler whitelist.json:', e.message);
    return { habilitada: true, liberarTodos: false, numeros: [], bloqueados: [] };
  }
}

/**
 * Grava a configuracao (usado pelo painel). Normaliza os numeros e remove
 * duplicados. Retorna o objeto efetivamente salvo.
 */
function salvarConfig({ numeros, liberarTodos, bloqueados } = {}) {
  const atual = lerConfig();
  // Numero brasileiro: pais(55) + DDD(2) + numero(8 ou 9) = 12 ou 13 digitos.
  const normalizar = (lista) => [...new Set(
    lista.map(soDigitos).filter((n) => n.length >= 12 && n.length <= 13)
  )];
  // Sem a lista no payload: preserva a atual (ex.: ao so alternar o modo
  // "responder todo mundo", nao se mexe nos numeros cadastrados).
  const limpos = Array.isArray(numeros) ? normalizar(numeros) : atual.numeros;
  const bloqs = Array.isArray(bloqueados) ? normalizar(bloqueados) : atual.bloqueados;
  const conteudo = {
    habilitada: true,
    // Preserva o flag atual quando 'liberarTodos' nao vem no payload.
    liberarTodos: liberarTodos === undefined ? atual.liberarTodos : liberarTodos === true,
    numeros: limpos,
    bloqueados: bloqs,
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(conteudo, null, 2), 'utf8');
  return conteudo;
}

/**
 * Liga/desliga o modo "responder todo mundo" (desativa/reativa a whitelist),
 * sem mexer nos numeros cadastrados. Retorna a config efetivamente salva.
 */
function setLiberarTodos(valor) {
  return salvarConfig({ liberarTodos: valor === true });
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
 * Por padrao a whitelist esta ativa: responde apenas os numeros da lista
 * (tolerando o "9" inicial do celular). Se o modo "responder todo mundo"
 * (liberarTodos) estiver ligado, responde QUALQUER numero.
 */
function numeroPermitido(numero) {
  const cfg = lerConfig();
  const vars = variantes(soDigitos(numero));
  // A blacklist vem PRIMEIRO: bloqueado nunca e respondido, nem com o modo
  // "responder todo mundo" ligado.
  if (vars.some((v) => cfg.bloqueados.includes(v))) return false;
  if (cfg.liberarTodos) return true; // modo "responder todo mundo" ligado
  return vars.some((v) => cfg.numeros.includes(v));
}

/**
 * Bloqueia um numero (blacklist): o bot para de responder mesmo com o modo
 * "responder todo mundo" ligado. Tambem tira o numero da lista de autorizados,
 * senao ele voltaria a ser respondido ao desligar o modo liberado.
 */
function bloquearNumero(numero) {
  const cfg = lerConfig();
  const vars = variantes(soDigitos(numero));
  return salvarConfig({
    numeros: cfg.numeros.filter((n) => !vars.includes(n)),
    bloqueados: [...cfg.bloqueados, soDigitos(numero)],
  });
}

/**
 * Tira um numero da blacklist. Ele NAO volta a ser autorizado: passa a valer a
 * regra normal (whitelist, ou o modo "responder todo mundo" se estiver ligado).
 */
function desbloquearNumero(numero) {
  const cfg = lerConfig();
  const vars = variantes(soDigitos(numero));
  return salvarConfig({ bloqueados: cfg.bloqueados.filter((n) => !vars.includes(n)) });
}

module.exports = {
  numeroPermitido, lerConfig, salvarConfig, setLiberarTodos,
  bloquearNumero, desbloquearNumero, soDigitos, variantes,
};
