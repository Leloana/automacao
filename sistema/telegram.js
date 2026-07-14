// telegram.js
// Aviso ao ADVOGADO via Telegram (Bot API). Substitui o alerta que antes ia pelo
// WhatsApp: no WhatsApp oficial, mandar mensagem para quem NAO abriu conversa (o
// advogado nao escreve para o bot) exigiria um template aprovado pela Meta. O
// Telegram e gratuito, instantaneo e nao precisa de aprovacao.
//
// Cada advogado guarda o seu "chat_id" em advogados.json (campo telegram_chat_id).
// Como obter o chat_id: o advogado abre o bot no Telegram, envia qualquer
// mensagem e o chat_id aparece em https://api.telegram.org/bot<TOKEN>/getUpdates
// (ou por um bot utilitario como @userinfobot). Pode-se tambem usar o id de um
// GRUPO onde o bot foi adicionado (todos os advogados recebem no mesmo lugar).
//
// A chave (TELEGRAM_BOT_TOKEN) e opcional para o bot subir, mas necessaria para o
// aviso funcionar. Tambem pode ser gravada pelo painel.

const TELEGRAM_URL = 'https://api.telegram.org';

function tokenAtual() { return (process.env.TELEGRAM_BOT_TOKEN || '').trim(); }
// Destino padrao quando o advogado escolhido nao tem chat_id proprio.
function chatPadrao() { return (process.env.TELEGRAM_CHAT_ID_PADRAO || '').trim(); }

function temTelegramConfig() { return !!tokenAtual(); }
function setTelegramToken(chave) { process.env.TELEGRAM_BOT_TOKEN = String(chave || '').trim(); }

/**
 * Envia um aviso de texto para um chat do Telegram. Usa o chat_id informado ou,
 * se vazio, o TELEGRAM_CHAT_ID_PADRAO. Enviamos em TEXTO PURO (sem parse_mode)
 * de proposito: a ultima mensagem do cliente pode conter *, _, [, etc., que
 * quebrariam a formatacao Markdown e derrubariam o envio (HTTP 400).
 */
async function enviarAviso(chatId, texto) {
  const token = tokenAtual();
  if (!token) throw new Error('Telegram nao configurado (TELEGRAM_BOT_TOKEN).');
  const chat = String(chatId || chatPadrao() || '').trim();
  if (!chat) throw new Error('Sem chat_id do advogado e sem TELEGRAM_CHAT_ID_PADRAO.');

  const resp = await fetch(`${TELEGRAM_URL}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat,
      text: String(texto || ''),
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(20000),
  });

  let data = null;
  try { data = await resp.json(); } catch (_) { /* corpo nao-JSON */ }
  if (!resp.ok || !data || data.ok === false) {
    const msg = (data && data.description) || `HTTP ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return data;
}

/**
 * "Ping" no bot (getMe) para o painel indicar se o token e valido. Nao lanca:
 * devolve um objeto de status.
 */
async function statusConexao() {
  const token = tokenAtual();
  if (!token) return { ok: false, motivo: 'nao_configurado' };
  try {
    const resp = await fetch(`${TELEGRAM_URL}/bot${token}/getMe`, { signal: AbortSignal.timeout(15000) });
    let data = null;
    try { data = await resp.json(); } catch (_) { /* ignora */ }
    if (!resp.ok || !data || !data.ok) return { ok: false, motivo: 'token_invalido' };
    return { ok: true, nome: data.result && (data.result.username || data.result.first_name) };
  } catch (e) {
    return { ok: false, motivo: 'erro_rede', erro: e.message };
  }
}

module.exports = {
  temTelegramConfig,
  setTelegramToken,
  chatPadrao,
  enviarAviso,
  statusConexao,
};
</content>
</invoke>
