// bot.js
// Trata cada mensagem recebida do WhatsApp: identifica o cliente, monta o
// contexto, consulta a DeepSeek e responde.

const OpenAI = require('openai');

const db = require('./db');
const { readMarkdown, criarMdCliente, atualizarMdCliente } = require('./context');
const { buildSystemPrompt } = require('./prompt');
const { escolherAdvogado, getAreasDisponiveis } = require('./advogados');
const { consultarProcesso } = require('./datajud');
const { numeroPermitido } = require('./whitelist');
const { renderMensagemCliente, renderMensagemAdvogado } = require('./mensagens');
const avisos = require('./avisos');

// Identifica se um erro da API e de autenticacao (chave invalida/ausente).
function ehErroDeChave(err) {
  const status = err && (err.status || err.statusCode);
  const msg = String((err && err.message) || err || '');
  return status === 401 || /\b401\b|unauthorized|api key|invalid.*key|authentication/i.test(msg);
}

// Extrai o primeiro nome (para tratar o cliente pelo nome na mensagem). Se o
// "nome" for so o numero de telefone, devolve vazio (nao usa numero como nome).
function primeiroNome(nome) {
  const s = String(nome || '').trim();
  if (!s || /^\d{10,}$/.test(s)) return '';
  return s.split(/\s+/)[0];
}

// Aviso educativo. Adicionado apenas na PRIMEIRA mensagem do atendimento
// (a "saudacao inicial"); nas mensagens seguintes nao se repete.
const DISCLAIMER =
  '⚠️ Esta informação é de caráter educativo e não substitui a consulta com um advogado.';

/**
 * Interpreta a resposta do modelo como JSON, de forma tolerante:
 * 1) tenta JSON puro; 2) remove cercas de codigo (```); 3) extrai o primeiro
 * objeto {...} encontrado no texto. Retorna null se nada der certo.
 */
function extrairDados(content) {
  try {
    return JSON.parse(content);
  } catch (_) {
    // Continua para as tentativas abaixo.
  }
  const limpo = content.replace(/```json/gi, '').replace(/```/g, '');
  const ini = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (ini !== -1 && fim > ini) {
    try {
      return JSON.parse(limpo.slice(ini, fim + 1));
    } catch (_) {
      // Cai para o retorno null.
    }
  }
  return null;
}

/**
 * Transforma o retorno da consulta DataJud em um texto que o modelo usa para
 * resumir ao cliente (resultado da ferramenta).
 */
function formatarResultadoProcesso(r) {
  if (!r || r.erro) {
    return 'Nao foi possivel consultar o processo agora (instabilidade no servico de consulta). ' +
      'Informe o cliente e sugira tentar novamente em instantes.';
  }
  if (!r.encontrado) {
    if (r.motivo === 'numero_invalido') {
      return 'O numero informado nao parece valido (um processo CNJ tem 20 digitos). ' +
        'Peca gentilmente ao cliente para conferir e reenviar o numero completo.';
    }
    return 'Processo nao encontrado no DataJud. O numero pode estar incorreto ou o tribunal ainda ' +
      'nao enviou os dados ao CNJ. Peca ao cliente para conferir o numero.';
  }
  return [
    'Dados do processo (fonte: DataJud/CNJ). Resuma para o cliente em linguagem simples e curta, ' +
      'com foco na situacao atual (ultima movimentacao e sua data). Use somente o que esta abaixo; nao invente:',
    `- Numero: ${r.num_processo || 'N/D'}`,
    `- Tipo: ${r.tipo || 'N/D'}`,
    `- Tribunal: ${r.tribunal || 'N/D'} (grau ${r.grau || 'N/D'})`,
    `- Orgao julgador: ${r.orgao_julgador || 'N/D'}`,
    `- Inicio: ${r.data_inicio || 'N/D'}`,
    `- Ultima movimentacao: ${r.ultima_movimentacao || 'N/D'}`,
    `- Data da ultima movimentacao: ${r.data_ultima_movimentacao || 'N/D'}`,
  ].join('\n');
}

// Modelo da DeepSeek. Configuravel pelo .env (DEEPSEEK_MODEL).
// Opcoes na API: deepseek-chat (recomendado: rapido e barato), deepseek-v4-flash,
// deepseek-v4-pro, deepseek-reasoner.
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

// Instituicao padrao para clientes novos (definida no .env).
const INSTITUICAO_PADRAO_ID = Number(process.env.INSTITUICAO_PADRAO_ID || 1);

// Cliente da API DeepSeek (compativel com a SDK da OpenAI).
// IMPORTANTE: a SDK lanca excecao se apiKey vier vazio na construcao. Como o
// bot precisa subir MESMO sem chave (para o cliente cola-la depois no painel),
// usamos um placeholder quando falta a chave. Sem chave real, as requisicoes
// falham (401) e o cliente recebe a mensagem de instabilidade padrao — mas o
// painel abre normalmente para configurar a chave.
const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || 'sem-chave-configurada',
  baseURL: 'https://api.deepseek.com',
});

// Troca a chave da API em tempo de execucao (usado pelo painel quando o
// cliente cola a chave). A SDK le this.apiKey a cada requisicao, entao basta
// atualizar o valor — nao precisa recriar o cliente nem reiniciar o bot.
function setDeepseekKey(chave) {
  openai.apiKey = String(chave || '').trim();
  process.env.DEEPSEEK_API_KEY = openai.apiKey;
}

// Mensagem enviada ao cliente quando a API falha.
const MSG_INSTABILIDADE =
  'Desculpe, estou com uma instabilidade momentânea. Tente novamente em instantes.';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chama a DeepSeek e retorna o texto da resposta (o prompt pede JSON; a leitura
 * fica por conta do extrator tolerante).
 *
 * Importante: usamos o modo TEXTO normal — nos testes, o modo "json_object" da
 * DeepSeek se mostrou instavel (devolvia respostas vazias em rajadas), enquanto o
 * modo texto retorna JSON valido de forma confiavel. Mantemos retentativas com
 * espera progressiva apenas como rede de seguranca contra falhas transitorias.
 */
async function chamarDeepSeek(messages, tentativas = 3) {
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const completion = await openai.chat.completions.create({
        model: DEEPSEEK_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 600,
      });
      const content = completion.choices?.[0]?.message?.content?.trim();
      if (content) return content;
      console.warn(`DeepSeek devolveu resposta vazia (tentativa ${i + 1}/${tentativas}).`);
    } catch (e) {
      ultimoErro = e;
      console.warn(`Erro na DeepSeek (tentativa ${i + 1}/${tentativas}): ${e.message}`);
    }
    await espera(1000 * (i + 1)); // 1s, 2s...
  }
  if (ultimoErro) throw ultimoErro;
  throw new Error('Resposta vazia da DeepSeek apos varias tentativas');
}

// Tempo de espera (em ms) apos a ultima mensagem antes de responder. Funciona
// como um "debounce": cada nova mensagem reinicia a contagem. Enquanto a pessoa
// continua enviando mensagens, o bot aguarda; so depois de ~5s de silencio o
// lote inteiro vira uma unica resposta. Configuravel pelo .env (DEBOUNCE_MS).
const DEBOUNCE_MS = Number(process.env.DEBOUNCE_MS || 5000);

// Buffer de mensagens por remetente, para agrupar mensagens enviadas em
// sequencia (que muitas vezes so fazem sentido juntas) em um unico atendimento.
// Chave: "from" do WhatsApp. Valor: { mensagens, timer, ultimaMessage, numero, nomeDisplay }.
const pendentes = new Map();

/**
 * Handler de mensagens. Faz os filtros e identifica o remetente, mas NAO
 * responde na hora: acumula a mensagem em um buffer e (re)agenda o
 * processamento do lote. Assim, varias mensagens seguidas viram uma so resposta.
 * @param {import('whatsapp-web.js').Client} client
 * @param {import('whatsapp-web.js').Message} message
 */
async function handleMessage(client, message) {
  const from = message.from || '';

  // 1) Filtros: ignora mensagens do proprio bot, de grupos e de status.
  if (message.fromMe) return;                 // mensagens enviadas pelo proprio bot
  if (from.endsWith('@g.us')) return;         // grupos
  if (from === 'status@broadcast') return;    // status/stories

  // Aceita conversas individuais: @c.us (numero comum) e @lid (numero "oculto",
  // usado quando o remetente nao esta salvo nos contatos do telefone do bot).
  if (!from.endsWith('@c.us') && !from.endsWith('@lid')) return;

  // 2) Descobre o numero de telefone real e o nome do remetente.
  // Quando o remetente vem como @lid, o "from" nao traz o telefone. O numero real
  // costuma estar em contact.id.user (12 ou 13 digitos). Caimos para contact.number
  // e, por ultimo, para o id do proprio "from".
  const ehTelefone = (s) => /^\d{12,13}$/.test(s);
  let numero = from.replace(/@(c\.us|lid)$/, '');
  let nomeDisplay = numero;
  try {
    const contato = await message.getContact();
    const idUser = contato && contato.id && contato.id.user
      ? String(contato.id.user).replace(/\D/g, '') : '';
    const num = contato && contato.number ? String(contato.number).replace(/\D/g, '') : '';
    if (ehTelefone(idUser)) numero = idUser;
    else if (ehTelefone(num)) numero = num;
    nomeDisplay = (contato && (contato.pushname || contato.name)) || numero;
  } catch (err) {
    console.error('Nao foi possivel obter o contato:', err.message);
  }

  console.log(`[MSG] from=${from} numero=${numero} nome=${nomeDisplay}`);

  // 3) Whitelist: se habilitada, so responde numeros autorizados.
  if (!numeroPermitido(numero)) {
    console.log(`Mensagem ignorada (fora da whitelist): ${numero} (from=${from})`);
    return;
  }

  // 3b) Pausa (atendimento humano): se o cliente estiver pausado, o bot fica em
  // silencio total — nao responde, nao trata midia, nao enfileira nem registra.
  // Uma pessoa do escritorio assume o atendimento pelo proprio WhatsApp.
  const clienteAtual = db.getClienteByNumero(numero);
  if (clienteAtual && clienteAtual.pausado) {
    console.log(`Cliente pausado (atendimento humano): ${numero} — bot em silencio.`);
    return;
  }

  // 4) Midia (audio, imagem, video, documento): o bot nao processa o conteudo.
  // Avisa o cliente que uma pessoa vai responder e alerta o numero padrao.
  if (TIPOS_MIDIA.includes(message.type)) {
    await tratarMidia(client, message, numero, nomeDisplay);
    return;
  }

  // Ignora mensagens sem texto que nao sejam midia tratavel (sticker, etc.).
  const texto = (message.body || '').trim();
  if (!texto) return;

  // 5) Enfileira a mensagem e (re)agenda o processamento do lote.
  enfileirarMensagem(client, from, texto, message, numero, nomeDisplay);
}

// Tipos de midia que recebem o aviso "nao consigo processar" + alerta.
const TIPOS_MIDIA = ['image', 'audio', 'ptt', 'video', 'document'];

// Rotulo amigavel de cada tipo, usado no aviso ao advogado.
const NOMES_MIDIA = {
  image: 'imagem',
  audio: 'áudio',
  ptt: 'áudio (mensagem de voz)',
  video: 'vídeo',
  document: 'documento',
};

// Cooldown por numero para nao floodar cliente/advogado numa rajada de midias.
const ultimaMidiaPorNumero = new Map(); // numero -> timestamp (ms)
const MIDIA_COOLDOWN_MS = Number(process.env.MIDIA_COOLDOWN_MS || 60000);

/**
 * Trata uma mensagem de midia: avisa o cliente que o assistente nao consegue
 * processar audios/imagens e que uma pessoa vai responder; em seguida emite um
 * alerta para o numero padrao (advogado padrao ou numero da instituicao).
 */
async function tratarMidia(client, message, numero, nomeDisplay) {
  // Evita repetir o aviso quando o cliente manda varias midias em sequencia.
  const agora = Date.now();
  if (agora - (ultimaMidiaPorNumero.get(numero) || 0) < MIDIA_COOLDOWN_MS) {
    console.log(`[MIDIA] ${numero}: dentro do cooldown, aviso nao repetido.`);
    return;
  }
  ultimaMidiaPorNumero.set(numero, agora);

  // Avisa o cliente.
  try {
    await message.reply(
      'Recebi sua mensagem, mas por aqui ainda não consigo ouvir áudios nem ver imagens ou arquivos. ' +
      'Já avisei nossa equipe e uma pessoa de verdade vai te responder em breve, tá? 😊'
    );
  } catch (e) {
    console.error('Falha ao responder midia ao cliente:', e.message);
  }

  // Alerta o numero padrao.
  try {
    const instituicao = db.getInstituicao(INSTITUICAO_PADRAO_ID);
    const advPadrao = escolherAdvogado(); // sem area -> advogado padrao / primeiro ativo
    const numeroPadrao = (advPadrao && advPadrao.numero) || (instituicao && instituicao.numero_humano);
    if (numeroPadrao) {
      const tipo = NOMES_MIDIA[message.type] || 'mídia';
      const aviso =
        '🔔 *Atendimento precisa de atenção (mídia recebida)*\n\n' +
        `Cliente: ${nomeDisplay}\n` +
        `Número: ${numero}\n` +
        `Tipo: ${tipo}\n\n` +
        'O assistente virtual não consegue processar áudios, imagens ou arquivos. ' +
        'O cliente foi avisado de que uma pessoa vai responder — entre em contato.';
      await client.sendMessage(`${numeroPadrao}@c.us`, aviso);
      console.log(`[MIDIA] ${numero} (${nomeDisplay}) enviou ${message.type}; cliente avisado e alerta para ${numeroPadrao}.`);
    } else {
      console.warn('[MIDIA] Sem numero padrao configurado para alertar.');
    }
  } catch (e) {
    console.error('Falha ao alertar sobre midia:', e.message);
  }
}

/**
 * Acumula a mensagem no buffer do remetente e reinicia o temporizador de
 * debounce. Quando passam DEBOUNCE_MS sem novas mensagens, processa o lote
 * inteiro de uma vez (todas as mensagens viram uma unica resposta).
 */
function enfileirarMensagem(client, from, texto, message, numero, nomeDisplay) {
  let entrada = pendentes.get(from);
  if (!entrada) {
    entrada = { mensagens: [], timer: null };
    pendentes.set(from, entrada);
  }

  entrada.mensagens.push(texto);
  entrada.ultimaMessage = message;   // usada para responder (reply) e como referencia
  entrada.numero = numero;
  entrada.nomeDisplay = nomeDisplay;

  // Reinicia a contagem: enquanto chegarem mensagens, adia o processamento.
  if (entrada.timer) clearTimeout(entrada.timer);
  entrada.timer = setTimeout(() => {
    // Remove do buffer antes de processar: novas mensagens que cheguem durante
    // o processamento iniciam um lote novo (serao respondidas em seguida).
    pendentes.delete(from);
    const textoCombinado = entrada.mensagens.join('\n').trim();
    console.log(`[LOTE] ${from}: ${entrada.mensagens.length} mensagem(ns) agrupada(s)`);
    processarMensagens(client, entrada.ultimaMessage, textoCombinado, entrada.numero, entrada.nomeDisplay)
      .catch((err) => console.error('Erro ao processar lote de mensagens:', err));
  }, DEBOUNCE_MS);
}

/**
 * Processa um lote de mensagens ja agrupadas: monta o contexto, consulta a
 * DeepSeek e responde ao cliente.
 * @param {import('whatsapp-web.js').Client} client
 * @param {import('whatsapp-web.js').Message} message  ultima mensagem do lote (usada no reply)
 * @param {string} texto  texto combinado de todas as mensagens do lote
 * @param {string} numero
 * @param {string} nomeDisplay
 */
async function processarMensagens(client, message, texto, numero, nomeDisplay) {
  try {
    // 3-4) Busca (ou cria) o cliente vinculado a instituicao padrao.
    const cliente = db.getOrCreateCliente(numero, nomeDisplay, INSTITUICAO_PADRAO_ID);

    // Garante um arquivo .md por cliente: na primeira vez que ele fala, cria um
    // modelo na pasta clientes/ e vincula ao cadastro. O escritorio pode editar
    // esse arquivo depois para enriquecer o contexto do atendimento.
    if (!cliente.arquivo_md) {
      const arquivoMd = criarMdCliente(numero, nomeDisplay);
      db.setClienteArquivoMd(cliente.id, arquivoMd);
      cliente.arquivo_md = arquivoMd;
    }

    // 5) Le o MD da instituicao (obrigatorio para o contexto).
    const instituicao = db.getInstituicao(cliente.instituicao_id || INSTITUICAO_PADRAO_ID);
    if (!instituicao) {
      console.error(`Instituicao ${cliente.instituicao_id} nao encontrada no banco.`);
      await message.reply(MSG_INSTABILIDADE);
      return;
    }

    const contextoInstituicao = readMarkdown(instituicao.arquivo_md);
    if (!contextoInstituicao) {
      console.warn(`Aviso: MD da instituicao vazio ou inexistente: ${instituicao.arquivo_md}`);
    }

    // 6) Se o cliente tiver MD proprio, le e inclui no contexto.
    const contextoCliente = cliente.arquivo_md ? readMarkdown(cliente.arquivo_md) : '';

    // 7) Recupera a janela de mensagens recentes do historico (HISTORICO_LIMIT,
    // ver db.js). Se estiver vazio, esta e a primeira interacao do cliente (a
    // "saudacao inicial") — o unico momento em que adicionamos o aviso educativo.
    // O contexto anterior a essa janela e preservado no resumo .md do cliente.
    const historico = db.getHistorico(cliente.id);
    const ehPrimeiraInteracao = historico.length === 0;

    // 8) Monta o prompt e chama a DeepSeek (resposta em JSON estruturado).
    const systemPrompt = buildSystemPrompt({
      nomeInstituicao: instituicao.nome,
      contextoInstituicao,
      contextoCliente,
      areasDisponiveis: getAreasDisponiveis(),
    });

    const messages = [
      { role: 'system', content: systemPrompt },
      // Historico convertido para o formato esperado pela API.
      ...historico.map((h) => ({ role: h.role, content: h.conteudo })),
      { role: 'user', content: texto },
    ];

    // Chama a DeepSeek em modo JSON (confiavel). Se o modelo pedir uma consulta
    // de processo (campo "consultar_processo"), executamos a consulta e pedimos
    // a resposta final — repetindo no maximo 2 vezes.
    let dados = null;
    let consultas = 0;

    while (true) {
      const content = await chamarDeepSeek(messages);

      dados = extrairDados(content);
      if (!dados) {
        console.error('Nao foi possivel interpretar o JSON do modelo; usando texto cru.');
        dados = { resposta: content, escalar: false, area: 'geral', motivo: '' };
      }

      // Se o modelo pediu para consultar um processo, busca os dados e volta a
      // perguntar (agora com as informacoes do DataJud em maos).
      if (dados.consultar_processo && consultas < 2) {
        consultas++;
        const numeroProc = String(dados.consultar_processo).trim();
        console.log(`Consultando DataJud: ${numeroProc}`);
        const dadosProcesso = await consultarProcesso(numeroProc);

        messages.push({ role: 'assistant', content });
        messages.push({
          role: 'user',
          content: '[Resultado da consulta ao DataJud — use para responder ao cliente]\n' +
            formatarResultadoProcesso(dadosProcesso),
        });
        continue; // pede a resposta final
      }

      break; // resposta final pronta
    }

    let mensagemCliente;

    if (dados.escalar) {
      // 9a) Escolhe o advogado da area (com fallbacks) e monta a mensagem de contato.
      const advogado = escolherAdvogado(dados.area);
      const numeroHumano = advogado ? advogado.numero : instituicao.numero_humano;

      // Mensagem ao cliente (template editavel pelo painel — ver mensagens.js).
      mensagemCliente = renderMensagemCliente({
        nome: primeiroNome(nomeDisplay),
        instituicao: instituicao.nome,
      });

      // 9b) Avisa o advogado com um resumo do atendimento encaminhado (template
      // editavel pelo painel — ver mensagens.js).
      if (numeroHumano) {
        const aviso = renderMensagemAdvogado({
          nome: nomeDisplay,
          numero,
          area: dados.area || 'geral',
          motivo: dados.motivo || 'não informado',
          ultimaMensagem: texto,
          nomeAdvogado: (advogado && advogado.nome) || '',
          instituicao: instituicao.nome,
        });
        try {
          await client.sendMessage(`${numeroHumano}@c.us`, aviso);
        } catch (notifyErr) {
          // Falha ao avisar o advogado nao deve impedir a resposta ao cliente.
          console.error('Falha ao avisar o advogado:', notifyErr.message);
          avisos.registrar('aviso', 'Não consegui avisar um advogado sobre um encaminhamento.',
            `Advogado: ${(advogado && advogado.nome) || numeroHumano}. Confira o número dele na aba "Advogados". O cliente ${nomeDisplay || numero} foi avisado de que será contatado.`);
        }
      } else {
        // Nenhum advogado/numero configurado: o cliente foi avisado que sera
        // contatado, mas nao ha para quem encaminhar.
        avisos.registrar('erro', 'Um cliente precisa de atendimento humano, mas não há advogado configurado.',
          `Cliente ${nomeDisplay || numero} (área: ${dados.area || 'geral'}). Cadastre um advogado na aba "Advogados" para receber os encaminhamentos.`);
      }

      // 9b-2) Pausa o atendimento automatico: a partir da PROXIMA mensagem o bot
      // fica em silencio para este cliente, deixando o advogado assumir. Falha
      // aqui nao deve impedir a resposta ao cliente.
      try {
        db.setPausado(cliente.id, 1);
        console.log(`Cliente ${numero} pausado automaticamente apos encaminhamento.`);
      } catch (pauseErr) {
        console.error('Falha ao pausar o cliente apos encaminhamento:', pauseErr.message);
      }
    } else {
      // 9c) Atendimento normal. O aviso educativo so entra na primeira
      // interacao (saudacao inicial); nas demais respostas nao se repete.
      const corpo = (dados.resposta || '').trim();
      if (ehPrimeiraInteracao) {
        mensagemCliente = corpo ? `${corpo}\n\n${DISCLAIMER}` : DISCLAIMER;
      } else {
        mensagemCliente = corpo;
      }
    }

    // 10) Salva no historico e envia a resposta ao cliente.
    // IMPORTANTE: guardamos a resposta do assistente como JSON (e nao o texto
    // final formatado). Assim, quando o historico volta para o modelo, ele ve o
    // padrao JSON e continua respondendo em JSON — caso contrario, ele "imita" a
    // prosa e para de devolver a estrutura (escalar/area/consultar_processo).
    const respostaAssistente = JSON.stringify({
      resposta: dados.resposta || '',
      escalar: !!dados.escalar,
      area: dados.area || 'geral',
      motivo: dados.motivo || '',
    });
    db.saveMessage(cliente.id, 'user', texto);
    db.saveMessage(cliente.id, 'assistant', respostaAssistente);
    // Evita enviar uma mensagem vazia (caso raro de resposta vazia do modelo
    // fora da saudacao inicial, quando nao ha disclaimer para preencher).
    if (mensagemCliente && mensagemCliente.trim()) {
      await message.reply(mensagemCliente);
    }

    // 11) Atualiza o .md do cliente com o perfil gerado pelo modelo (area de
    // interesse + observacoes), para o escritorio acompanhar. As anotacoes
    // manuais do escritorio sao preservadas. Falhas aqui nao afetam o cliente.
    try {
      if (cliente.arquivo_md) {
        const perfil = dados.perfil || {};
        const areaInteresse = (perfil.area_interesse || '').trim()
          || (dados.area && dados.area !== 'geral' ? dados.area : '');
        atualizarMdCliente(cliente.arquivo_md, {
          areaInteresse,
          observacoes: (perfil.observacoes || '').trim(),
          nomeDisplay,
          numero,
        });
      }
    } catch (e) {
      console.error('Falha ao atualizar o .md do cliente:', e.message);
    }
  } catch (err) {
    // Qualquer erro (API, banco, etc.) cai aqui: loga, avisa o usuario no
    // painel (em portugues simples) e responde o cliente com a msg de instabilidade.
    console.error('Erro ao processar mensagem:', err);
    if (ehErroDeChave(err)) {
      avisos.registrar('erro', 'A chave da API parece inválida ou ausente.',
        'O bot não consegue gerar respostas. Confira e salve a chave na aba "Chave da API".');
    } else {
      avisos.registrar('erro', 'Não consegui responder um cliente.',
        `Cliente ${nomeDisplay || numero}. Pode ser instabilidade do serviço de IA ou falta de internet. O cliente recebeu um aviso pedindo para tentar novamente em instantes.`);
    }
    try {
      await message.reply(MSG_INSTABILIDADE);
    } catch (replyErr) {
      console.error('Falha ao enviar mensagem de erro:', replyErr.message);
    }
  }
}

// Exporta tambem funcoes internas para testes de integracao (chamada a API e
// interpretacao do JSON), permitindo exercitar o fluxo sem o WhatsApp.
module.exports = { handleMessage, chamarDeepSeek, extrairDados, setDeepseekKey };
