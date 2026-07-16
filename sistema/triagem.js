// triagem.js
// O que o bot deve ANOTAR sobre os clientes e o que a triagem deve TENTAR
// descobrir — editavel pelo painel web sem mexer no codigo (mesmo padrao da
// personalidade e das mensagens):
//   - defaults ficam aqui no codigo (o bot funciona mesmo sem o arquivo);
//   - o que for configurado fica em triagem.json, lido a cada uso (alteracoes
//     pelo painel valem sem reiniciar o bot).
//
// Sao duas listas, com riscos BEM diferentes:
//   1) "anotar"    — PASSIVO: o que registrar quando o cliente falar espontaneamente.
//                    Lista longa aqui nao machuca: no pior caso a ficha fica com um
//                    campo a mais que ninguem le.
//   2) "descobrir" — ATIVO: o que a triagem tenta levantar ao longo da conversa.
//                    Entra no prompt como PRIORIDADE, nunca como requisito: as regras
//                    de nao interrogar e de escalar na hora quando o cliente pede
//                    continuam ACIMA desta lista (ver prompt.js). Lista longa aqui
//                    transforma o atendimento em formulario e afasta cliente — por
//                    isso o painel avisa e o prompt reforca o limite.
//
// Cada lista e um texto livre com UM ITEM POR LINHA (foi o que o escritorio
// entende; vira lista com marcadores dentro do prompt).

const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(__dirname, 'triagem.json');

// Teto de itens da lista ATIVA. Nao e birra: cada item vira uma pergunta que a
// secretaria tenta encaixar na conversa. Passando disso, o bot vira formulario.
const MAX_DESCOBRIR = 6;

// Padrao do que ANOTAR. Serve tambem como "valor de fabrica" exibido no painel.
const ANOTAR_PADRAO = `Como prefere ser chamado
Cidade onde mora
Profissão
Estado civil e se tem filhos
Se já é cliente do escritório
Empresa ou pessoa envolvida no caso
Número de processo que ele citar
Datas e valores mencionados
Documentos que ele disse ter
Prazos ou audiências mencionados
Como chegou até o escritório`;

// Padrao do que a triagem deve TENTAR descobrir.
const DESCOBRIR_PADRAO = `O que aconteceu
Desde quando (datas)
O que o cliente deseja
Se já procurou outro advogado ou já existe processo`;

/** Quebra o texto livre do painel em itens (uma linha = um item, sem vazias). */
function emItens(texto) {
  return String(texto == null ? '' : texto)
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()) // tolera quem digitar com "-"
    .filter(Boolean);
}

/**
 * Le a configuracao da triagem (triagem.json). Campo ausente ou vazio cai para o
 * default. Lido a cada uso (alteracoes valem sem reiniciar).
 * @returns {{ anotar: string, descobrir: string }} textos (um item por linha).
 */
function getTriagem() {
  let dados = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      dados = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
    }
  } catch (err) {
    console.error('Erro ao ler triagem.json:', err.message);
  }
  const anotar = (dados.anotar && String(dados.anotar).trim()) || ANOTAR_PADRAO;
  const descobrir = (dados.descobrir && String(dados.descobrir).trim()) || DESCOBRIR_PADRAO;
  return { anotar, descobrir };
}

/**
 * Salva a configuracao. Campo vazio nao e gravado (volta ao default na proxima
 * leitura). A lista ATIVA e cortada em MAX_DESCOBRIR itens — o teto e aplicado
 * aqui, e nao so no aviso do painel, para valer tambem se editarem o arquivo na mao.
 * Retorna { anotar, descobrir, cortados } (cortados = itens descartados pelo teto).
 */
function salvarTriagem({ anotar, descobrir } = {}) {
  const conteudo = {};
  const a = String(anotar == null ? '' : anotar).trim();
  if (a) conteudo.anotar = a;

  const itens = emItens(descobrir);
  const cortados = Math.max(0, itens.length - MAX_DESCOBRIR);
  const d = itens.slice(0, MAX_DESCOBRIR).join('\n');
  if (d) conteudo.descobrir = d;

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(conteudo, null, 2), 'utf8');
  return { ...getTriagem(), cortados };
}

/**
 * Devolve as duas listas ja formatadas como marcadores para injetar no system
 * prompt, ou '' quando a lista estiver vazia (o prompt omite o bloco).
 *
 * As duas listas entram em niveis diferentes do prompt, entao cada uma leva o
 * recuo do bloco onde e injetada (senao a hierarquia da lista fica torta).
 * @returns {{ anotar: string, descobrir: string }}
 */
function getTriagemParaPrompt() {
  const { anotar, descobrir } = getTriagem();
  const bullets = (texto, recuo, max) => {
    const itens = emItens(texto);
    const usar = max ? itens.slice(0, max) : itens;
    return usar.map((i) => `${recuo}• ${i}`).join('\n');
  };
  return {
    anotar: bullets(anotar, ' '.repeat(12)),
    descobrir: bullets(descobrir, ' '.repeat(4), MAX_DESCOBRIR),
  };
}

module.exports = {
  getTriagem,
  salvarTriagem,
  getTriagemParaPrompt,
  ANOTAR_PADRAO,
  DESCOBRIR_PADRAO,
  MAX_DESCOBRIR,
};
