// midia.js
// Transcricao de audios e descricao de imagens via API do Google Gemini.
// O resultado vira TEXTO e entra no fluxo normal de atendimento (a DeepSeek
// continua fazendo a triagem — o Gemini so "ouve" e "enxerga").
// A chave e opcional: sem GEMINI_API_KEY o bot mantem o comportamento antigo
// (avisa o cliente que nao processa midia e alerta o advogado).

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// Modelo multimodal. O alias "-latest" aponta sempre para o flash-lite estavel
// mais recente (o mais barato) — evita quebrar quando o Google aposenta uma
// versao (ex.: gemini-2.5-flash-lite sumiu para contas novas em 2026).
// Configuravel pelo .env (GEMINI_MODEL).
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';

// Tamanho maximo do arquivo (binario) aceito para processamento. A API aceita
// ate ~20MB por requisicao (o base64 inflaciona ~33%); acima do limite a midia
// cai no fluxo antigo de aviso. Configuravel pelo .env (MIDIA_MAX_MB).
const MIDIA_MAX_BYTES = Number(process.env.MIDIA_MAX_MB || 15) * 1024 * 1024;

// Ha chave do Google configurada? (lida a cada uso: o painel pode salvar a
// chave com o bot rodando, e vale na proxima midia, sem reiniciar)
function temGeminiKey() {
  return !!(process.env.GEMINI_API_KEY || '').trim();
}

// Troca a chave em tempo de execucao (usado pelo painel ao salvar).
function setGeminiKey(chave) {
  process.env.GEMINI_API_KEY = String(chave || '').trim();
}

const PROMPT_AUDIO =
  'Transcreva este áudio em português do Brasil, fielmente ao que foi falado ' +
  '(pode ajustar pontuação). Retorne SOMENTE o texto transcrito, sem comentários ' +
  'nem apresentação. Se não houver fala compreensível, retorne exatamente: ' +
  '(áudio sem fala compreensível)';

const PROMPT_IMAGEM =
  'Descreva esta imagem em português, de forma objetiva, para uso em um ' +
  'atendimento jurídico por mensagem. Se for um documento, identifique o tipo e ' +
  'transcreva as informações principais (partes, datas, valores, prazos, números ' +
  'de processo). Se for uma foto, descreva o que ela mostra e os detalhes ' +
  'relevantes. Retorne SOMENTE a descrição, sem comentários.';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chama o Gemini com um arquivo (base64) + instrucao e devolve o texto.
 * Retenta uma vez em falha transitoria (rede, 429, 5xx); erros de chave ou de
 * requisicao (4xx) nao sao retentados — nao se resolvem sozinhos.
 */
async function chamarGemini(base64, mimetype, prompt, tentativas = 2) {
  const chave = (process.env.GEMINI_API_KEY || '').trim();
  if (!chave) throw new Error('Chave do Google (GEMINI_API_KEY) não configurada');

  // O WhatsApp manda mimetypes com parametros (ex: "audio/ogg; codecs=opus");
  // a API espera so o tipo base.
  const mime = String(mimetype || 'application/octet-stream').split(';')[0].trim();

  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const resp = await fetch(`${GEMINI_URL}/${GEMINI_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mime, data: base64 } },
              { text: prompt },
            ],
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(90000),
      });

      let data = null;
      try { data = await resp.json(); } catch (_) { /* corpo nao-JSON: trata abaixo */ }

      if (!resp.ok) {
        const msg = (data && data.error && data.error.message) || `HTTP ${resp.status}`;
        const err = new Error(msg);
        err.status = resp.status;
        // 4xx (menos 429) = chave invalida ou requisicao ruim: nao adianta retentar.
        if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) throw err;
        ultimoErro = err;
      } else {
        const cand = (data && data.candidates && data.candidates[0]) || {};
        const partes = (cand.content && cand.content.parts) || [];
        // Modelos gemini-3 sao "thinking": ignora partes de raciocinio (thought)
        // para nao poluir a transcricao/descricao com o pensamento do modelo.
        const texto = partes.filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
        if (texto) return texto;
        // Sem texto: expoe o finishReason (ex.: MAX_TOKENS, SAFETY) no erro para
        // facilitar o diagnostico no painel/log.
        const fr = cand.finishReason ? ` (finishReason=${cand.finishReason})` : '';
        ultimoErro = new Error('Resposta vazia do Gemini' + fr);
      }
    } catch (e) {
      if (e.status >= 400 && e.status < 500 && e.status !== 429) throw e;
      ultimoErro = e;
    }
    console.warn(`Erro no Gemini (tentativa ${i + 1}/${tentativas}): ${ultimoErro.message}`);
    await espera(1000 * (i + 1));
  }
  throw ultimoErro;
}

// Transcreve um audio (mensagem de voz ou arquivo). Devolve o texto falado.
function transcreverAudio(base64, mimetype) {
  return chamarGemini(base64, mimetype, PROMPT_AUDIO);
}

// Descreve uma imagem (foto ou documento fotografado). Devolve a descricao.
function descreverImagem(base64, mimetype) {
  return chamarGemini(base64, mimetype, PROMPT_IMAGEM);
}

module.exports = {
  temGeminiKey,
  setGeminiKey,
  transcreverAudio,
  descreverImagem,
  MIDIA_MAX_BYTES,
};
