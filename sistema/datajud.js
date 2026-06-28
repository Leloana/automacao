// datajud.js
// Consulta o andamento de processos chamando o endpoint do proprio escritorio,
// que ja devolve o JSON tratado a partir do DataJud/CNJ.
//   GET https://ferreiraramos.adv.br/api/datajud_autocomplete.php?num_processo=...
//
// Vantagem sobre o script Python: HTTP direto (sem subprocess, sem dependencia de
// Python) e resposta ja formatada. Usa o fetch nativo do Node (v18+).

// Endpoint configuravel pelo .env (DATAJUD_API_URL).
const API_URL = process.env.DATAJUD_API_URL ||
  'https://ferreiraramos.adv.br/api/datajud_autocomplete.php';

/**
 * Consulta um processo pelo numero CNJ (com ou sem mascara — o servidor limpa).
 * Sempre resolve (nunca rejeita); em caso de falha retorna { erro } ou
 * { encontrado:false, motivo }, para o bot responder ao cliente com gentileza.
 *
 * @param {string} numeroProcesso
 * @returns {Promise<object>}
 */
async function consultarProcesso(numeroProcesso) {
  const numero = String(numeroProcesso || '').trim();
  if (!numero) return { encontrado: false, motivo: 'sem_numero' };

  const url = `${API_URL}?num_processo=${encodeURIComponent(numero)}`;

  // Timeout de 20s para nao travar o atendimento.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const resp = await fetch(url, { signal: controller.signal });

    // Mapeia os codigos de erro conhecidos do endpoint.
    if (resp.status === 404) return { encontrado: false, motivo: 'nao_encontrado' };
    if (resp.status === 422 || resp.status === 400) {
      return { encontrado: false, motivo: 'numero_invalido' };
    }
    if (!resp.ok) {
      console.error(`Endpoint DataJud respondeu HTTP ${resp.status}`);
      return { erro: 'http', status: resp.status };
    }

    const dados = await resp.json();
    return { encontrado: true, ...dados };
  } catch (e) {
    console.error('Erro ao consultar o endpoint DataJud:', e.message);
    return { erro: 'execucao', detalhe: e.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { consultarProcesso };
