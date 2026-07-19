// sync.js
// Sincronizacao das fichas de cliente (e configuracoes) entre os PCs do
// escritorio, que rodam numeros de WhatsApp DIFERENTES para os MESMOS clientes.
//
// COMO FUNCIONA (caixa-postal, nao conexao direta):
// os PCs estao em cidades diferentes, atras de NAT, e nao podem depender de
// estarem ligados ao mesmo tempo. Entao cada um ENVIA seu pacote para um
// endpoint no servidor do proprio escritorio (sync.php, ao lado do clientes.php
// que o crm.js ja consome) e BUSCA de la o pacote do outro quando quiser.
// E assincrono de proposito.
//
// PRINCIPIO CENTRAL — "espelho, nao fusao":
// cada PC e dono soberano dos seus arquivos. Aplicar um pacote recebido NUNCA
// sobrescreve dado local: o que vem de fora entra numa secao separada e marcada
// da ficha, que o bot le mas nunca escreve (ver context.js). Assim nao existe
// arquivo com dois donos — e, portanto, nao existe conflito para resolver.
// Fundir os dados de verdade so acontece por acao explicita do usuario
// ("internalizar" no painel). O perigo nunca foi a fusao; foi a fusao
// automatica e invisivel.
//
// NAO TRAFEGAM AQUI: as chaves do .env (nao tem categoria), a sessao do
// WhatsApp e o bot.db. Ver o aviso sobre "clone de conhecimento" no painel.

const fs = require('fs');
const path = require('path');

const db = require('./db');
const avisos = require('./avisos');
const {
  lerPerfilMd, aplicarEspelho, lerEspelho, atualizarMdCliente, criarMdCliente,
} = require('./context');
const whitelist = require('./whitelist');
const advogados = require('./advogados');
const mensagens = require('./mensagens');
const triagem = require('./triagem');
const escritorio = require('./escritorio');
const { getPersonalidade, salvarPersonalidade } = require('./prompt');

// Instituicao usada ao criar cliente vindo do outro PC (mesma logica do painel).
const INSTITUICAO_PADRAO_ID = Number(process.env.INSTITUICAO_PADRAO_ID) || 1;

const CONFIG_PATH = path.join(__dirname, 'sync.json');

// Versao do formato do pacote. Se um dia mudar de forma incompativel, o lado
// que recebe precisa saber recusar em vez de aplicar lixo.
const SCHEMA = 1;

// Timeout maior que o do crm.js: o pacote carrega todas as fichas.
const TIMEOUT_MS = 30000;

// As categorias que podem ser sincronizadas, na ordem em que aparecem no painel.
const CATEGORIAS = [
  'clientes', 'whitelist', 'advogados', 'mensagens',
  'triagem', 'personalidade', 'escritorio',
];

const CATEGORIAS_PADRAO = {
  clientes: true, whitelist: true, advogados: true, mensagens: false,
  triagem: false, personalidade: false, escritorio: false,
};

// Estado em memoria para o painel poder acompanhar sem travar a tela.
// (o sync roda em segundo plano; a pagina faz poll em /api/sync/estado)
const emMemoria = { rodando: false, pendentes: [] };

/* ------------------------------------------------------------------ */
/* Configuracao (sync.json)                                            */
/* ------------------------------------------------------------------ */

/**
 * Le a configuracao do sync. Arquivo ausente ou invalido -> padroes seguros
 * (sem parceiros e sem sincronizacao automatica: nao faz nada sozinho).
 * Lido a cada uso, como as demais configs do projeto.
 */
function lerConfig() {
  let dados = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      dados = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Erro ao ler sync.json:', e.message);
  }

  const categorias = { ...CATEGORIAS_PADRAO };
  if (dados.categorias && typeof dados.categorias === 'object') {
    for (const c of CATEGORIAS) {
      if (typeof dados.categorias[c] === 'boolean') categorias[c] = dados.categorias[c];
    }
  }

  return {
    // O id identifica ESTA maquina na caixa-postal (nome do arquivo no servidor).
    id: String(dados.id || process.env.SYNC_ID || '').trim(),
    rotulo: String(dados.rotulo || '').trim(),
    parceiros: Array.isArray(dados.parceiros)
      ? dados.parceiros
          .filter((p) => p && p.id)
          .map((p) => ({ id: String(p.id).trim(), rotulo: String(p.rotulo || p.id).trim() }))
      : [],
    categorias,
    // 'externo' = vira bloco espelho marcado (padrao, reversivel).
    // 'interno' = adota como dado proprio (migracao/clonagem, irreversivel).
    modoImportacao: dados.modoImportacao === 'interno' ? 'interno' : 'externo',
    criarClientesNovos: dados.criarClientesNovos === true,
    autoMinutos: Number(dados.autoMinutos) > 0 ? Number(dados.autoMinutos) : 0,
    ultimo: dados.ultimo && typeof dados.ultimo === 'object'
      ? dados.ultimo
      : { envio: '', recebimento: '', erro: '', resumo: {} },
  };
}

/** Grava a configuracao (merge parcial com a atual). Retorna o que foi salvo. */
function salvarConfig(parcial = {}) {
  const atual = lerConfig();
  const novo = { ...atual, ...parcial };

  // Categorias tambem em merge parcial (o painel pode mandar so uma).
  if (parcial.categorias && typeof parcial.categorias === 'object') {
    novo.categorias = { ...atual.categorias };
    for (const c of CATEGORIAS) {
      if (typeof parcial.categorias[c] === 'boolean') novo.categorias[c] = parcial.categorias[c];
    }
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(novo, null, 2) + '\n', 'utf8');
  return novo;
}

/* ------------------------------------------------------------------ */
/* Montagem do pacote                                                  */
/* ------------------------------------------------------------------ */

/**
 * Chave estavel de um cliente entre as duas maquinas.
 * Reaproveita a normalizacao da whitelist e escolhe SEMPRE a variante de 13
 * digitos quando ela existe — assim o mesmo cliente gera a mesma chave nos dois
 * PCs, mesmo que um o tenha cadastrado com o "9" do celular e o outro sem.
 */
function chaveCliente(numero) {
  const vars = whitelist.variantes(whitelist.soDigitos(numero));
  return vars.find((v) => v.length === 13) || vars[0] || '';
}

/** Achata quebras de linha e corta no limite (os campos vivem em 1 linha). */
function umaLinha(texto, limite = 0) {
  const s = String(texto || '').replace(/\s*\r?\n\s*/g, ' ').trim();
  return limite > 0 && s.length > limite ? s.slice(0, limite - 1).trimEnd() + '…' : s;
}

/**
 * Resumo textual do atendimento recente, SEM IA (deterministico e de graca).
 *
 * So as falas do CLIENTE: as do assistant estao salvas como JSON bruto de
 * proposito (ver bot.js) e nao servem para leitura humana. E de proposito que
 * isto e um resumo, e nao as mensagens em si — replicar linhas na tabela
 * historico estouraria o HISTORICO_LIMIT e faria o modelo "lembrar" de
 * conversas que ele nao teve.
 */
function resumoHistorico(clienteId) {
  try {
    const linhas = db.getHistorico(clienteId)
      .filter((l) => l.role === 'user')
      .slice(-10)
      .map((l) => umaLinha(l.conteudo))
      .filter(Boolean);
    return umaLinha(linhas.join(' | '), 800);
  } catch (e) {
    console.error('Erro ao resumir historico do cliente', clienteId, e.message);
    return '';
  }
}

/**
 * Monta o pacote desta maquina com as categorias pedidas.
 * Sincrono de proposito: better-sqlite3 e sincrono e nao ha I/O de rede aqui.
 */
function montarPacote(categorias) {
  const cfg = lerConfig();
  const quais = categorias || cfg.categorias;
  const conteudo = {};

  if (quais.clientes) {
    conteudo.clientes = db.listClientes().map((c) => {
      // lerPerfilMd (e NUNCA readMarkdown): le so os campos proprios desta
      // maquina. Ler o arquivo inteiro arrastaria o bloco espelho recebido do
      // outro PC de volta para o pacote, e o espelho cresceria em espiral.
      const perfil = c.arquivo_md ? lerPerfilMd(c.arquivo_md) : {};
      return {
        chave: chaveCliente(c.numero_telefone),
        nome: c.nome_display || '',
        area_interesse: perfil.areaInteresse || '',
        observacoes: perfil.observacoes || '',
        resumo_historico: resumoHistorico(c.id),
        pausado: c.pausado ? 1 : 0,
      };
    }).filter((c) => c.chave);
  }

  if (quais.whitelist) {
    const w = whitelist.lerConfig();
    // liberarTodos NUNCA viaja: e uma decisao perigosa e estritamente local.
    conteudo.whitelist = { numeros: w.numeros, bloqueados: w.bloqueados };
  }

  if (quais.advogados) conteudo.advogados = advogados.getAdvogados();
  if (quais.mensagens) conteudo.mensagens = mensagens.getMensagens();
  if (quais.triagem) conteudo.triagem = triagem.getTriagem();
  if (quais.personalidade) conteudo.personalidade = getPersonalidade();
  if (quais.escritorio) conteudo.escritorio = escritorio.getEscritorio();

  return {
    schema: SCHEMA,
    origem: { id: cfg.id, rotulo: cfg.rotulo || cfg.id },
    gerado_em: new Date().toISOString(),
    categorias: conteudo,
  };
}

/* ------------------------------------------------------------------ */
/* Aplicacao do pacote recebido                                        */
/* ------------------------------------------------------------------ */

/** Acha o cliente local correspondente a uma chave, tolerando o "9" do celular. */
function acharClienteLocal(chave) {
  for (const v of whitelist.variantes(whitelist.soDigitos(chave))) {
    const c = db.getClienteByNumero(v);
    if (c) return c;
  }
  return null;
}

/** Garante que o cliente tenha ficha .md; devolve o caminho relativo. */
function garantirFicha(cliente) {
  if (cliente.arquivo_md) return cliente.arquivo_md;
  const rel = criarMdCliente(cliente.numero_telefone, cliente.nome_display || cliente.numero_telefone);
  db.setClienteArquivoMd(cliente.id, rel);
  return rel;
}

/**
 * Aplica um cliente recebido no modo INTERNO: o dado do outro PC vira dado
 * NOSSO e o bloco espelho some. E irreversivel — so acontece por escolha
 * explicita (modo "interno" ou botao "Internalizar" no painel).
 *
 * Uma regra so, que serve aos dois cenarios:
 *  - ficha local VAZIA (migracao de PC) -> adota limpo, sem marca de origem:
 *    o resultado fica identico a ficha da maquina de origem;
 *  - ficha local COM conteudo (mesmo cliente atendido nos dois numeros) ->
 *    junta, marcando a origem, sem apagar nada do que era nosso.
 */
function internalizarCliente(cliente, remoto, rotuloOrigem) {
  const arquivo = garantirFicha(cliente);
  const local = lerPerfilMd(arquivo);

  const area = umaLinha(remoto.area_interesse);
  const obs = umaLinha(remoto.observacoes);
  const marca = rotuloOrigem ? `(do atendimento de ${rotuloOrigem})` : '(do outro atendimento)';

  // Observacoes vivem em UMA linha no .md (relidas por regex de linha unica):
  // por isso juntamos com separador, nunca com quebra de linha.
  let novasObs = local.observacoes;
  if (obs && obs !== local.observacoes) {
    novasObs = local.observacoes ? `${local.observacoes} ${marca}: ${obs}` : obs;
  }
  const novaArea = local.areaInteresse || area;

  atualizarMdCliente(arquivo, { areaInteresse: novaArea, observacoes: umaLinha(novasObs) });
  // O dado agora e nosso: o espelho perde a razao de existir.
  aplicarEspelho(arquivo, {});
  return true;
}

/**
 * Aplica o pacote recebido do outro PC.
 *
 * "Espelho, nao fusao": no modo externo (padrao) NADA local e sobrescrito — o
 * que vem de fora entra num bloco marcado que o bot le e nunca escreve.
 * Sincrono: better-sqlite3 e sincrono e nao ha rede aqui.
 */
function aplicarPacote(pacote, categorias) {
  const cfg = lerConfig();
  const quais = categorias || cfg.categorias;
  const recebido = (pacote && pacote.categorias) || {};
  const origem = (pacote && pacote.origem && pacote.origem.rotulo) || 'outro computador';
  const recebidoEm = new Date().toISOString();
  const resultado = { clientes: { atualizados: 0, criados: 0, pendentes: [] }, categorias: [] };

  // ---- clientes ----
  if (quais.clientes && Array.isArray(recebido.clientes)) {
    const interno = cfg.modoImportacao === 'interno';
    for (const r of recebido.clientes) {
      if (!r || !r.chave) continue;
      let cliente = acharClienteLocal(r.chave);

      if (!cliente) {
        // Cliente que existe la e nao aqui. Por padrao NAO criamos nem
        // autorizamos: autorizar um numero e decisao local e deliberada (a aba
        // "Criar cliente" existe para isso). Vira "pendente" para o usuario
        // decidir no painel.
        if (!cfg.criarClientesNovos && !interno) {
          resultado.clientes.pendentes.push({
            chave: r.chave, nome: r.nome || '', area_interesse: r.area_interesse || '',
          });
          continue;
        }
        cliente = db.getOrCreateCliente(r.chave, r.nome || r.chave, INSTITUICAO_PADRAO_ID);
        garantirFicha(cliente);
        resultado.clientes.criados++;
      }

      const arquivo = garantirFicha(cliente);
      if (interno) {
        internalizarCliente(cliente, r, origem);
      } else {
        aplicarEspelho(arquivo, {
          origem,
          recebidoEm,
          areaInteresse: r.area_interesse,
          observacoes: r.observacoes,
          resumoHistorico: r.resumo_historico,
          pausado: r.pausado,
        });
      }
      resultado.clientes.atualizados++;
    }
  }

  // ---- whitelist: UNIAO, nunca remocao ----
  if (quais.whitelist && recebido.whitelist) {
    const local = whitelist.lerConfig();
    const numeros = [...new Set([...local.numeros, ...(recebido.whitelist.numeros || [])])];
    const bloqueados = [...new Set([...local.bloqueados, ...(recebido.whitelist.bloqueados || [])])];
    // Por que uniao e nao espelho: "remover autorizacao" nao se propaga — mas
    // bloquearNumero TAMBEM poe na blacklist, e a blacklist vence a whitelist
    // em numeroPermitido. Ou seja: autorizacoes sao aditivas, silenciamentos
    // propagam. E o comportamento certo para o caso perigoso.
    whitelist.salvarConfig({ numeros, bloqueados });
    resultado.categorias.push('clientes autorizados');
  }

  // ---- demais categorias: substituicao direta (sao config, nao dado pessoal) ----
  if (quais.advogados && Array.isArray(recebido.advogados)) {
    advogados.salvarAdvogados(recebido.advogados);
    resultado.categorias.push('advogados');
  }
  if (quais.mensagens && recebido.mensagens) {
    mensagens.salvarMensagens(recebido.mensagens);
    resultado.categorias.push('mensagens de encaminhamento');
  }
  if (quais.triagem && recebido.triagem) {
    triagem.salvarTriagem(recebido.triagem);
    resultado.categorias.push('o que anotar e perguntar');
  }
  if (quais.personalidade && typeof recebido.personalidade === 'string' && recebido.personalidade.trim()) {
    salvarPersonalidade(recebido.personalidade);
    resultado.categorias.push('personalidade');
  }
  if (quais.escritorio && recebido.escritorio) {
    escritorio.salvarEscritorio(recebido.escritorio);
    resultado.categorias.push('dados do escritório');
  }

  return resultado;
}

/**
 * Lista os clientes que tem bloco espelho (dado vindo do outro PC ainda nao
 * internalizado), para o painel oferecer o botao "Internalizar".
 */
function listarEspelhados() {
  return db.listClientes()
    .filter((c) => c.arquivo_md && lerEspelho(c.arquivo_md))
    .map((c) => ({
      id: c.id,
      nome: c.nome_display || c.numero_telefone,
      numero: c.numero_telefone,
      espelho: lerEspelho(c.arquivo_md),
    }));
}

/** Internaliza o espelho de um cliente pelo id (acao do painel). */
function internalizarPorId(clienteId) {
  const cliente = db.getCliente(Number(clienteId));
  if (!cliente) throw new Error('Cliente não encontrado.');
  const arquivo = garantirFicha(cliente);
  const bloco = lerEspelho(arquivo);
  if (!bloco) throw new Error('Este cliente não tem nada vindo do outro computador.');

  // Relemos os campos do proprio bloco (ele e a unica fonte: o pacote original
  // pode nem estar mais na caixa-postal).
  const pegar = (rot) => {
    const m = bloco.match(new RegExp('^' + rot + ' \\(lá\\):[ \\t]*(.*)$', 'm'));
    return m ? m[1].trim() : '';
  };
  const mOrigem = bloco.match(/^Origem:[ \t]*(.+?)(?:\s*•|$)/m);
  internalizarCliente(cliente, {
    area_interesse: pegar('Área de interesse'),
    observacoes: pegar('Observações'),
  }, mOrigem ? mOrigem[1].trim() : '');
  return true;
}

/**
 * Importa um cliente que so existe no outro PC (estava em "pendentes").
 * Cria o cadastro e a ficha, mas NAO mexe na whitelist: autorizar o numero
 * continua sendo decisao explicita da aba "Criar cliente".
 */
function importarPendente(chave, nome) {
  const digitos = whitelist.soDigitos(chave);
  if (digitos.length < 12 || digitos.length > 13) throw new Error('Número inválido.');
  const cliente = db.getOrCreateCliente(digitos, nome || digitos, INSTITUICAO_PADRAO_ID);
  garantirFicha(cliente);
  emMemoria.pendentes = emMemoria.pendentes.filter((p) => p.chave !== chave);
  return { id: cliente.id, nome: cliente.nome_display };
}

/* ------------------------------------------------------------------ */
/* HTTP (caixa-postal)                                                 */
/* ------------------------------------------------------------------ */

/**
 * Chamada ao sync.php. Nunca rejeita: sempre resolve para o JSON recebido ou
 * para { erro: '<codigo>' }. Mesmo padrao do crm.js (fetch nativo do Node 18+).
 *
 * Codigos de erro possiveis: sem_url, url_insegura, senha_invalida,
 * http_<status>, resposta_invalida, sem_resposta.
 */
async function chamar(acao, { senha, metodo = 'GET', corpo, params = {} } = {}) {
  const base = String(process.env.SYNC_URL || '').trim();
  if (!base) return { erro: 'sem_url' };
  // O pacote leva dados de cliente: nao aceitamos http:// em hipotese nenhuma.
  if (!/^https:\/\//i.test(base)) return { erro: 'url_insegura' };

  const token = senha || process.env.SYNC_TOKEN || '';

  const url = new URL(base);
  url.searchParams.set('acao', acao);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: metodo,
      signal: controller.signal,
      headers: {
        'X-Sync-Token': token,
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    });

    if (resp.status === 401 || resp.status === 403) return { erro: 'senha_invalida' };
    if (!resp.ok) {
      console.error(`sync.php respondeu HTTP ${resp.status} em "${acao}"`);
      return { erro: `http_${resp.status}` };
    }

    try {
      return await resp.json();
    } catch (e) {
      // Tipicamente uma pagina de erro em HTML do servidor no lugar do JSON.
      console.error(`Resposta invalida do sync.php em "${acao}":`, e.message);
      return { erro: 'resposta_invalida' };
    }
  } catch (e) {
    console.error(`Erro ao chamar o sync.php em "${acao}":`, e.message);
    return { erro: 'sem_resposta' };
  } finally {
    clearTimeout(timer);
  }
}

/** Envia (substitui) o pacote desta maquina na caixa-postal. */
async function enviarPacote(pacote, senha) {
  return chamar('enviar', { senha, metodo: 'POST', corpo: pacote });
}

/** Busca o pacote deixado por outra maquina. Pode voltar { vazio: true }. */
async function buscarPacote(idOrigem, senha) {
  return chamar('buscar', { senha, params: { de: idOrigem } });
}

/** Lista as maquinas que ja depositaram algum pacote. */
async function listarMaquinas(senha) {
  return chamar('listar', { senha });
}

/* ------------------------------------------------------------------ */
/* Orquestracao                                                        */
/* ------------------------------------------------------------------ */

/** Mensagem amigavel (em portugues) para cada codigo de erro tecnico. */
function explicarErro(codigo) {
  const mapa = {
    sem_id: ['Este computador ainda não tem um nome para a sincronização.',
      'Na aba "Sincronizar", dê um nome a este PC (ex.: "londrina"). É por ele que o outro computador vai identificar os dados que vêm daqui.'],
    sem_url: ['A sincronização ainda não foi configurada.',
      'Falta o endereço do servidor (SYNC_URL) no arquivo de configuração.'],
    url_insegura: ['O endereço da sincronização não é seguro.',
      'O endereço precisa começar com https:// — os dados dos clientes não podem trafegar sem criptografia.'],
    senha_invalida: ['A senha da sincronização foi recusada.',
      'Confira se os dois computadores estão usando exatamente a mesma senha na aba "Sincronizar".'],
    resposta_invalida: ['O servidor respondeu de um jeito que não entendi.',
      'Pode ser que o arquivo sync.php não tenha sido instalado corretamente no site do escritório.'],
    sem_resposta: ['Não consegui falar com o servidor do escritório.',
      'Verifique se este computador está com internet. Se estiver, o site do escritório pode estar fora do ar.'],
  };
  if (mapa[codigo]) return mapa[codigo];
  if (String(codigo).startsWith('http_')) {
    return ['O servidor do escritório respondeu com erro.',
      `Código técnico: ${codigo}. Se persistir, avise quem cuida do site.`];
  }
  return ['Não consegui sincronizar com o outro computador.', `Código técnico: ${codigo}.`];
}

/** Registra o erro no painel (avisos.js) e devolve o resultado padronizado. */
function falhar(codigo) {
  const [titulo, detalhe] = explicarErro(codigo);
  avisos.registrar('erro', titulo, detalhe);
  salvarConfig({ ultimo: { ...lerConfig().ultimo, erro: titulo } });
  return { ok: false, erro: codigo, mensagem: titulo };
}

/** Sincroniza com uma maquina: envia o pacote local, busca o dela e aplica. */
async function sincronizarAgora({ maquina, senha } = {}) {
  if (emMemoria.rodando) return { ok: false, erro: 'ja_rodando', mensagem: 'Uma sincronização já está em andamento.' };

  const cfg = lerConfig();
  if (!cfg.id) {
    return falhar('sem_id');
  }
  const alvo = maquina || (cfg.parceiros[0] && cfg.parceiros[0].id);
  if (!alvo) {
    avisos.registrar('aviso', 'Nenhum outro computador foi cadastrado para sincronizar.',
      'Cadastre o outro PC na aba "Sincronizar" antes de tentar.');
    return { ok: false, erro: 'sem_parceiro', mensagem: 'Nenhum outro computador cadastrado.' };
  }

  emMemoria.rodando = true;
  try {
    // 1) Envia o nosso.
    const pacote = montarPacote(cfg.categorias);
    const envio = await enviarPacote(pacote, senha);
    if (envio.erro) return falhar(envio.erro);

    // 2) Busca o do outro.
    const recebido = await buscarPacote(alvo, senha);
    if (recebido.erro) return falhar(recebido.erro);

    // 3) Aplica o que veio (se veio algo).
    const agora = new Date().toISOString();
    let aplicacao = null;
    if (!recebido.vazio) {
      if (Number(recebido.schema) > SCHEMA) {
        // O outro PC esta numa versao mais nova do formato: melhor nao aplicar
        // do que aplicar pela metade e corromper ficha.
        avisos.registrar('aviso', 'O outro computador está com uma versão mais nova do programa.',
          'Atualize este computador (feche e abra pelo iniciar) para poder receber os dados dele.');
      } else {
        try {
          aplicacao = aplicarPacote(recebido, cfg.categorias);
          emMemoria.pendentes = aplicacao.clientes.pendentes;
        } catch (e) {
          console.error('Erro ao aplicar o pacote recebido:', e.message);
          avisos.registrar('erro', 'Recebi os dados do outro computador, mas não consegui aplicar.',
            'Nada foi alterado pela metade de propósito. Se continuar, avise o suporte. Detalhe técnico: ' + e.message);
          return { ok: false, erro: 'falha_ao_aplicar', mensagem: 'Não consegui aplicar os dados recebidos.' };
        }
      }
    }

    const resumo = {
      enviados: (pacote.categorias.clientes || []).length,
      recebidos: recebido.vazio ? 0 : ((recebido.categorias && recebido.categorias.clientes) || []).length,
      vazio: recebido.vazio === true,
      geradoEm: recebido.gerado_em || '',
      origem: (recebido.origem && recebido.origem.rotulo) || alvo,
      aplicado: !!aplicacao,
      atualizados: aplicacao ? aplicacao.clientes.atualizados : 0,
      criados: aplicacao ? aplicacao.clientes.criados : 0,
      pendentes: aplicacao ? aplicacao.clientes.pendentes.length : 0,
      outras: aplicacao ? aplicacao.categorias : [],
      modo: cfg.modoImportacao,
    };

    salvarConfig({ ultimo: { envio: agora, recebimento: recebido.vazio ? '' : agora, erro: '', resumo } });
    console.log(`Sync com "${alvo}": enviados ${resumo.enviados}, recebidos ${resumo.recebidos}, ` +
      `aplicados ${resumo.atualizados} (${resumo.pendentes} pendentes).`);
    return { ok: true, resumo };
  } finally {
    emMemoria.rodando = false;
  }
}

/** Estado atual para o painel (poll). Nunca devolve senha/token. */
function estado() {
  const cfg = lerConfig();
  return {
    rodando: emMemoria.rodando,
    ultimo: cfg.ultimo,
    pendentes: emMemoria.pendentes,
    espelhados: listarEspelhados().length,
  };
}

/* ------------------------------------------------------------------ */
/* Sincronizacao automatica                                            */
/* ------------------------------------------------------------------ */

let timer = null;

/**
 * Liga/religa o agendamento conforme o sync.json (autoMinutos).
 * Roda dentro do proprio processo do bot, que ja fica ligado o tempo todo —
 * nao usa o Agendador de Tarefas do Windows.
 *
 * Exige SYNC_TOKEN no .env: sem a senha salva nao ha como autenticar sozinho
 * (no modo manual ela e digitada no painel a cada vez).
 */
function iniciarAgendamento() {
  if (timer) { clearInterval(timer); timer = null; }

  const cfg = lerConfig();
  if (!cfg.autoMinutos) return false;

  if (!String(process.env.SYNC_TOKEN || '').trim()) {
    avisos.registrar('aviso', 'A sincronização automática está desligada porque a senha não foi salva.',
      'Para sincronizar sozinho, a senha precisa estar guardada no computador. Enquanto isso, use o botão "Sincronizar agora".');
    return false;
  }
  if (!cfg.id || !cfg.parceiros.length) return false;

  const ms = Math.max(1, cfg.autoMinutos) * 60000;
  timer = setInterval(() => {
    sincronizarAgora({ maquina: cfg.parceiros[0].id }).catch((e) => {
      console.error('Erro na sincronizacao automatica:', e.message);
    });
  }, ms);
  // unref: um timer pendente nao deve segurar o processo ao encerrar o bot.
  if (timer.unref) timer.unref();
  console.log(`Sincronizacao automatica ligada: a cada ${cfg.autoMinutos} min com "${cfg.parceiros[0].id}".`);
  return true;
}

module.exports = {
  CATEGORIAS,
  lerConfig,
  salvarConfig,
  montarPacote,
  aplicarPacote,
  enviarPacote,
  buscarPacote,
  listarMaquinas,
  sincronizarAgora,
  listarEspelhados,
  internalizarPorId,
  importarPendente,
  iniciarAgendamento,
  estado,
};
