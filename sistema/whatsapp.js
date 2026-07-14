// whatsapp.js
// Camada de transporte da WhatsApp Cloud API (oficial da Meta). Substitui o
// whatsapp-web.js (nao-oficial, via navegador — causa dos bloqueios de numero):
//   - RECEBER: as mensagens chegam por webhook (ver rota /webhook em painel.js);
//     parseWebhook converte o payload da Meta em objetos "mensagem" com a MESMA
//     interface que o bot ja consumia (from, type, body, getContact, reply,
//     downloadMedia), de modo que bot.js quase nao muda.
//   - ENVIAR: por HTTP na Graph API (fetch nativo do Node 22, como midia.js/crm.js).
// A triagem da DeepSeek nao muda — esta camada so troca o "cano" do WhatsApp.

const crypto = require('crypto');

const GRAPH_URL = 'https://graph.facebook.com';
// Versao da Graph API. Fixada no .env porque a Meta descontinua versoes antigas
// periodicamente (mesma logica do alias do Gemini em midia.js).
const GRAPH_VERSION = process.env.GRAPH_API_VERSION || 'v21.0';

// Le a configuracao a cada uso (o painel pode gravar o token com o bot rodando,
// e vale na proxima chamada — mesmo padrao das outras chaves).
function cfg() {
  return {
    token: (process.env.WHATSAPP_TOKEN || '').trim(),
    phoneId: (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
    appSecret: (process.env.WHATSAPP_APP_SECRET || '').trim(),
    verifyToken: (process.env.WHATSAPP_VERIFY_TOKEN || '').trim(),
  };
}

// Ha o minimo para enviar/receber? (token + ID do numero)
function temWhatsappConfig() {
  const c = cfg();
  return !!(c.token && c.phoneId);
}

// Troca o token em runtime (usado pelo painel ao salvar).
function setWhatsappToken(chave) {
  process.env.WHATSAPP_TOKEN = String(chave || '').trim();
}
function setWhatsappPhoneId(id) {
  process.env.WHATSAPP_PHONE_NUMBER_ID = String(id || '').trim();
}

/**
 * Envia uma mensagem de texto livre pelo WhatsApp oficial. So funciona dentro da
 * janela de 24h (mensagem de servico) — como o bot sempre RESPONDE quem escreveu
 * primeiro, isso e o caso normal. Substitui o antigo client.sendMessage.
 */
async function enviarTexto(numero, texto) {
  const c = cfg();
  if (!c.token || !c.phoneId) {
    throw new Error('WhatsApp Cloud API nao configurada (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID).');
  }
  const to = String(numero || '').replace(/\D/g, '');
  if (!to) throw new Error('Numero de destino vazio.');

  const resp = await fetch(`${GRAPH_URL}/${GRAPH_VERSION}/${c.phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: String(texto || '') },
    }),
    signal: AbortSignal.timeout(30000),
  });

  let data = null;
  try { data = await resp.json(); } catch (_) { /* corpo nao-JSON */ }
  if (!resp.ok) {
    const msg = (data && data.error && data.error.message) || `HTTP ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return data;
}

/**
 * Baixa uma midia recebida a partir do seu ID (a Cloud API nao manda o binario
 * no webhook, so o media_id). Sao duas chamadas: (1) obter a URL temporaria e
 * (2) baixar o binario com o mesmo Bearer. Devolve { data (base64), mimetype },
 * exatamente o formato que o midia.js (Gemini) ja consome.
 */
async function baixarMidia(mediaId) {
  const c = cfg();
  if (!c.token) throw new Error('WHATSAPP_TOKEN nao configurado.');
  if (!mediaId) throw new Error('media_id ausente.');

  // 1) Metadados: a Meta devolve uma URL temporaria (valida por poucos minutos).
  const metaResp = await fetch(`${GRAPH_URL}/${GRAPH_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${c.token}` },
    signal: AbortSignal.timeout(30000),
  });
  let meta = null;
  try { meta = await metaResp.json(); } catch (_) { /* trata abaixo */ }
  if (!metaResp.ok || !meta || !meta.url) {
    const msg = (meta && meta.error && meta.error.message) || `HTTP ${metaResp.status}`;
    throw new Error(`Falha ao obter a URL da midia: ${msg}`);
  }

  // 2) Binario (a URL da Meta tambem exige o Authorization).
  const binResp = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${c.token}` },
    signal: AbortSignal.timeout(60000),
  });
  if (!binResp.ok) throw new Error(`Falha ao baixar a midia: HTTP ${binResp.status}`);
  const buf = Buffer.from(await binResp.arrayBuffer());
  return {
    data: buf.toString('base64'),
    mimetype: meta.mime_type || binResp.headers.get('content-type') || 'application/octet-stream',
  };
}

/**
 * Valida a assinatura do webhook (cabecalho X-Hub-Signature-256) contra o
 * WHATSAPP_APP_SECRET — garante que o POST veio mesmo da Meta. Se o segredo nao
 * estiver configurado, NAO valida (retorna true) para o bot funcionar antes do
 * setup completo; o index.js avisa no boot quando o segredo esta ausente.
 */
function validarAssinatura(rawBody, header) {
  const c = cfg();
  if (!c.appSecret) return true; // sem segredo: pula a validacao (com aviso no boot)
  if (!header) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', c.appSecret)
    .update(rawBody, 'utf8').digest('hex');
  try {
    const a = Buffer.from(header);
    const b = Buffer.from(esperado);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

/**
 * Trata a verificacao inicial do webhook (GET). A Meta chama a URL com
 * hub.mode=subscribe, hub.verify_token e hub.challenge; devolvemos o challenge
 * se o token bater. Retorna a string do challenge (200) ou null (403).
 * @param {URLSearchParams} query
 */
function verificarWebhook(query) {
  const c = cfg();
  const mode = query.get('hub.mode');
  const token = query.get('hub.verify_token');
  const challenge = query.get('hub.challenge');
  if (mode === 'subscribe' && token && c.verifyToken && token === c.verifyToken) {
    return challenge == null ? '' : String(challenge);
  }
  return null;
}

// Mapeia o "type" da Cloud API para os rotulos que o bot ja usa. Observacao: no
// WhatsApp oficial mensagens de voz chegam como type "audio" (nao existe "ptt").
function mapearTipo(t) {
  switch (t) {
    case 'text': return 'text';
    case 'image': return 'image';
    case 'audio': return 'audio';
    case 'video': return 'video';
    case 'document': return 'document';
    default: return t || 'desconhecido';
  }
}

/**
 * Cria um objeto "mensagem" com a mesma interface do whatsapp-web.js que o bot
 * consome (from, fromMe, type, body, getContact, reply, downloadMedia), a partir
 * de uma mensagem do payload da Cloud API. Assim bot.js muda muito pouco.
 */
function criarMensagem(m, nome) {
  const numero = String(m.from || '').replace(/\D/g, '');
  const tipo = mapearTipo(m.type);

  let body = '';
  let mediaId = null;
  let mimetype = '';
  switch (m.type) {
    case 'text': body = (m.text && m.text.body) || ''; break;
    case 'image':
      mediaId = m.image && m.image.id; mimetype = (m.image && m.image.mime_type) || '';
      body = (m.image && m.image.caption) || ''; break;
    case 'audio':
      mediaId = m.audio && m.audio.id; mimetype = (m.audio && m.audio.mime_type) || ''; break;
    case 'video':
      mediaId = m.video && m.video.id; mimetype = (m.video && m.video.mime_type) || '';
      body = (m.video && m.video.caption) || ''; break;
    case 'document':
      mediaId = m.document && m.document.id; mimetype = (m.document && m.document.mime_type) || '';
      body = (m.document && m.document.caption) || ''; break;
    default: break;
  }

  return {
    id: m.id,
    // O bot faz from.replace(/@(c\.us|lid)$/, '') para extrair o numero; mantemos
    // o sufixo @c.us para a logica existente continuar valendo sem alteracao.
    from: numero ? `${numero}@c.us` : '',
    fromMe: false, // o webhook so entrega mensagens recebidas do cliente
    type: tipo,
    body,
    // getContact e async no whatsapp-web.js; aqui o nome ja vem no payload.
    async getContact() {
      return { id: { user: numero }, number: numero, pushname: nome || '', name: nome || '' };
    },
    // reply do cliente: envia texto livre (estamos na janela de 24h).
    async reply(texto) {
      return enviarTexto(numero, texto);
    },
    // downloadMedia: busca o binario pelo media_id. Devolve { data, mimetype }.
    async downloadMedia() {
      if (!mediaId) return null;
      const md = await baixarMidia(mediaId);
      return { data: md.data, mimetype: md.mimetype || mimetype };
    },
  };
}

/**
 * Converte o corpo (cru ou objeto) de um POST do webhook em uma lista de objetos
 * "mensagem" prontos para o handleMessage. Ignora eventos de status/entrega
 * (value.statuses) e qualquer coisa que nao seja mensagem recebida.
 */
function parseWebhook(body) {
  let payload;
  try {
    payload = typeof body === 'string' ? JSON.parse(body) : body;
  } catch (_) {
    return [];
  }
  const out = [];
  const entries = (payload && payload.entry) || [];
  for (const entry of entries) {
    const changes = (entry && entry.changes) || [];
    for (const change of changes) {
      const value = (change && change.value) || {};
      const mensagens = value.messages || []; // ausente em eventos de status
      // Nome do contato por wa_id (pode faltar).
      const nomePorWa = {};
      for (const ct of (value.contacts || [])) {
        if (ct && ct.wa_id) nomePorWa[ct.wa_id] = (ct.profile && ct.profile.name) || '';
      }
      for (const m of mensagens) {
        out.push(criarMensagem(m, nomePorWa[m.from] || ''));
      }
    }
  }
  return out;
}

/**
 * "Ping" no numero configurado para o painel mostrar se o token/numero estao
 * validos. Nao lanca: devolve um objeto de status.
 */
async function statusConexao() {
  const c = cfg();
  if (!c.token || !c.phoneId) return { ok: false, motivo: 'nao_configurado' };
  try {
    const resp = await fetch(
      `${GRAPH_URL}/${GRAPH_VERSION}/${c.phoneId}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(15000) },
    );
    let data = null;
    try { data = await resp.json(); } catch (_) { /* ignora */ }
    if (!resp.ok) {
      return { ok: false, motivo: 'token_invalido', erro: (data && data.error && data.error.message) || `HTTP ${resp.status}` };
    }
    return { ok: true, numero: data && data.display_phone_number, nome: data && data.verified_name };
  } catch (e) {
    return { ok: false, motivo: 'erro_rede', erro: e.message };
  }
}

module.exports = {
  temWhatsappConfig,
  setWhatsappToken,
  setWhatsappPhoneId,
  enviarTexto,
  baixarMidia,
  validarAssinatura,
  verificarWebhook,
  parseWebhook,
  statusConexao,
};
</content>
</invoke>
