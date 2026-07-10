// crm.js
// Consulta a API administrativa do proprio escritorio (o mesmo backend do painel
// web em /app/clientes e /app/processos) para resolver CPF ou NOME de cliente
// para o(s) numero(s) CNJ de processo dele:
//
//   GET https://ferreiraramos.adv.br/api/clientes.php   -> [{ id, nome, cpf, ... }]
//   GET https://ferreiraramos.adv.br/api/processos.php  -> [{ num_processo, cliente_id, ... }]
//
// IMPORTANTE (decisao de projeto): usamos esta API SO para descobrir o numero do
// processo a partir do cliente. O ANDAMENTO em si vem sempre do DataJud
// (datajud.js), que e a fonte autoritativa — a base do escritorio pode estar
// desatualizada (a rotina de atualizacao de la ja deu problema). Ver bot.js.
//
// HTTP direto via fetch nativo do Node (v18+), no mesmo padrao do datajud.js.

// Base configuravel pelo .env (CRM_API_URL). Mesma origem do datajud.
const CRM_API_BASE = process.env.CRM_API_URL || 'https://ferreiraramos.adv.br/api';

// Cache em memoria (evita rebaixar a API durante uma mesma conversa/debounce).
const CACHE_TTL_MS = Number(process.env.CRM_CACHE_MS) || 60000;
const cache = { clientes: null, processos: null, ts: 0 };

/** GET num endpoint da API do escritorio; retorna o JSON ou null em falha. */
async function getJson(endpoint) {
  const url = `${CRM_API_BASE}/${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    // TODO(token): a API do escritorio (clientes.php/processos.php) vai VOLTAR a
    // exigir autenticacao por token — hoje esta aberta so por causa desta
    // automacao. Quando o token voltar, e AQUI que ele entra: montar os headers
    // a partir do .env e passar no fetch. Ex. (formato exato a confirmar com o
    // Marcelo — Bearer ou header custom):
    //   const headers = process.env.CRM_API_TOKEN
    //     ? { Authorization: `Bearer ${process.env.CRM_API_TOKEN}` }
    //     : {};
    //   const resp = await fetch(url, { signal: controller.signal, headers });
    // Sem o token, o servidor respondera 401/403 -> getJson retorna null ->
    // buscarProcessosPorCliente devolve { erro:'api_indisponivel' } -> o bot
    // pede o CNJ ao cliente (degrada com gentileza, mas a busca por CPF/nome
    // para de funcionar). NAO mexer no datajud.js: o DataJud e API PUBLICA.
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      console.error(`API do escritorio respondeu HTTP ${resp.status} em ${endpoint}`);
      return null;
    }
    return await resp.json();
  } catch (e) {
    console.error(`Erro ao consultar ${endpoint} da API do escritorio:`, e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Carrega clientes + processos (com cache curto). Nunca rejeita. */
async function carregar() {
  const agora = Date.now();
  if (cache.clientes && cache.processos && (agora - cache.ts) < CACHE_TTL_MS) {
    return { clientes: cache.clientes, processos: cache.processos };
  }
  const [clientes, processos] = await Promise.all([
    getJson('clientes.php'),
    getJson('processos.php'),
  ]);
  if (clientes && processos) {
    cache.clientes = clientes;
    cache.processos = processos;
    cache.ts = agora;
  }
  // Em falha parcial, cai no que houver em cache (pode ser null).
  return { clientes: clientes || cache.clientes, processos: processos || cache.processos };
}

/** So os digitos (para comparar CPF sem mascara). */
function soDigitos(s) {
  return String(s || '').replace(/\D/g, '');
}

/** Nome normalizado: sem acento, minusculo, espacos colapsados. */
function normalizarNome(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Resolve um CPF ou nome de cliente para os processos dele.
 * Sempre resolve (nunca rejeita). Formatos de retorno:
 *   { erro: 'api_indisponivel' }
 *   { encontrado: false, motivo: 'sem_termo' | 'cpf_nao_encontrado' | 'nome_nao_encontrado' }
 *   { encontrado: false, motivo: 'nome_ambiguo', quantidade }
 *   { encontrado: true, cliente: { nome }, processos: [{ num_processo, classificacao_nome, nome_partes }] }
 *
 * @param {string} termo  CPF (com ou sem mascara) ou nome do cliente
 */
async function buscarProcessosPorCliente(termo) {
  const bruto = String(termo || '').trim();
  if (!bruto) return { encontrado: false, motivo: 'sem_termo' };

  const { clientes, processos } = await carregar();
  if (!clientes || !processos) return { erro: 'api_indisponivel' };

  const digitos = soDigitos(bruto);
  let cliente = null;

  if (digitos.length === 11) {
    // Parece um CPF: match exato pelos digitos.
    cliente = clientes.find((c) => soDigitos(c.cpf) === digitos);
    if (!cliente) return { encontrado: false, motivo: 'cpf_nao_encontrado' };
  } else {
    // Nome: match por conteudo, sem acento/caixa.
    const alvo = normalizarNome(bruto);
    const candidatos = clientes.filter((c) => {
      const n = normalizarNome(c.nome);
      return n === alvo || n.includes(alvo) || alvo.includes(n);
    });
    if (candidatos.length === 0) return { encontrado: false, motivo: 'nome_nao_encontrado' };
    if (candidatos.length > 1) {
      return { encontrado: false, motivo: 'nome_ambiguo', quantidade: candidatos.length };
    }
    cliente = candidatos[0];
  }

  const doCliente = processos.filter((p) => Number(p.cliente_id) === Number(cliente.id));
  return {
    encontrado: true,
    cliente: { nome: cliente.nome },
    processos: doCliente.map((p) => ({
      num_processo: p.num_processo,
      classificacao_nome: p.classificacao_nome,
      nome_partes: p.nome_partes,
    })),
  };
}

module.exports = { buscarProcessosPorCliente };
