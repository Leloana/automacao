// mensagens.js
// Mensagens de ENCAMINHAMENTO (quando o bot escala para um advogado), editaveis
// pelo painel web sem mexer no codigo — mesmo padrao da personalidade:
//   - defaults ficam aqui no codigo (o bot funciona mesmo sem o arquivo);
//   - o texto configurado fica em mensagens.json, lido a cada uso (alteracoes
//     pelo painel valem sem reiniciar o bot).
//
// Sao dois textos:
//   1) "cliente"  — enviado ao cliente avisando que um advogado vai contata-lo;
//   2) "advogado" — alerta enviado ao advogado com o resumo do atendimento.
//
// Ambos aceitam placeholders no formato {campo}, substituidos em tempo de envio.

const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(__dirname, 'mensagens.json');

// Mensagem padrao ao CLIENTE. Placeholders: {nome}, {instituicao}.
const MSG_CLIENTE_PADRAO =
  'Obrigada por compartilhar tudo isso comigo! 😊 Nossa equipe já foi avisada e está a par do seu caso. ' +
  'Um de nossos advogados vai entrar em contato com você por aqui em breve para dar continuidade ao atendimento, combinado?';

// Mensagem padrao ao ADVOGADO. Placeholders: {nome}, {numero}, {area}, {motivo},
// {ultimaMensagem}, {nomeAdvogado}, {instituicao}.
const MSG_ADVOGADO_PADRAO =
  '🔔 *Novo atendimento encaminhado pelo assistente virtual*\n\n' +
  'Cliente: {nome}\n' +
  'Número: {numero}\n' +
  'Área: {area}\n' +
  'Motivo: {motivo}\n\n' +
  'Última mensagem do cliente:\n"{ultimaMensagem}"\n\n' +
  'O cliente NÃO recebeu nenhum contato — avisamos que um advogado o chamaria. ' +
  'Por favor, entre em contato com o cliente para dar continuidade ao atendimento.';

/**
 * Le as mensagens configuradas (mensagens.json). Cada campo ausente ou vazio cai
 * para o default correspondente. Lido a cada uso (alteracoes valem sem reiniciar).
 * @returns {{ cliente: string, advogado: string }}
 */
function getMensagens() {
  let dados = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      dados = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
    }
  } catch (err) {
    console.error('Erro ao ler mensagens.json:', err.message);
  }
  const cliente = (dados.cliente && String(dados.cliente).trim()) || MSG_CLIENTE_PADRAO;
  const advogado = (dados.advogado && String(dados.advogado).trim()) || MSG_ADVOGADO_PADRAO;
  return { cliente, advogado };
}

/**
 * Salva as mensagens no arquivo. Campo vazio nao e gravado (volta ao default na
 * proxima leitura). Retorna as mensagens efetivas (ja com defaults aplicados).
 */
function salvarMensagens({ cliente, advogado } = {}) {
  const conteudo = {};
  const c = String(cliente == null ? '' : cliente).trim();
  const a = String(advogado == null ? '' : advogado).trim();
  if (c) conteudo.cliente = c;
  if (a) conteudo.advogado = a;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(conteudo, null, 2), 'utf8');
  return getMensagens();
}

/**
 * Substitui os placeholders {campo} de um template pelos valores informados.
 * Placeholders sem valor viram string vazia; valores extras sao ignorados.
 */
function aplicar(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, chave) =>
    vars[chave] == null ? '' : String(vars[chave])
  );
}

/** Renderiza a mensagem ao cliente. vars: { nome, instituicao }. */
function renderMensagemCliente(vars) {
  return aplicar(getMensagens().cliente, vars);
}

/**
 * Renderiza o alerta ao advogado.
 * vars: { nome, numero, area, motivo, ultimaMensagem, nomeAdvogado, instituicao }.
 */
function renderMensagemAdvogado(vars) {
  return aplicar(getMensagens().advogado, vars);
}

module.exports = {
  getMensagens,
  salvarMensagens,
  renderMensagemCliente,
  renderMensagemAdvogado,
  MSG_CLIENTE_PADRAO,
  MSG_ADVOGADO_PADRAO,
};
