// context.js
// Leitura/criacao dos arquivos Markdown usados como contexto (instituicoes e clientes).

const path = require('path');
const fs = require('fs');

// Pasta onde ficam os arquivos .md de cada cliente.
const CLIENTES_DIR = path.join(__dirname, 'clientes');

/**
 * Le um arquivo Markdown e retorna seu conteudo como string.
 * Aceita caminho relativo a raiz do projeto (ex: "clientes/joao_silva.md")
 * ou caminho absoluto.
 * Se o arquivo nao existir, retorna string vazia (sem lancar erro).
 */
function readMarkdown(filepath) {
  if (!filepath) {
    return '';
  }

  // Resolve caminhos relativos a partir da raiz do projeto.
  const fullPath = path.isAbsolute(filepath)
    ? filepath
    : path.join(__dirname, filepath);

  if (!fs.existsSync(fullPath)) {
    return '';
  }

  return fs.readFileSync(fullPath, 'utf8');
}

/**
 * Gera um nome de arquivo seguro (sem acentos, espacos ou caracteres especiais)
 * a partir do nome de exibicao do cliente.
 */
function slugify(texto) {
  return (texto || '')
    .normalize('NFD')               // separa os acentos das letras
    .replace(/[^\x00-\x7f]/g, '')   // remove tudo que nao for ASCII (acentos, emojis)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')    // troca o que nao for letra/numero por _
    .replace(/^_+|_+$/g, '')        // remove _ das pontas
    .slice(0, 40);                  // limita o tamanho do nome
}

/**
 * Cria (se ainda nao existir) um arquivo .md para o cliente com um modelo
 * basico para ser preenchido pelo escritorio. Retorna o caminho relativo
 * (ex: "clientes/joao_silva_5514998689481.md").
 *
 * O numero entra no nome do arquivo para garantir unicidade; o nome facilita
 * a identificacao visual na pasta.
 */
function criarMdCliente(numero, nomeDisplay) {
  if (!fs.existsSync(CLIENTES_DIR)) {
    fs.mkdirSync(CLIENTES_DIR, { recursive: true });
  }

  const slug = slugify(nomeDisplay);
  const base = slug ? `${slug}_${numero}` : `${numero}`;
  const relativo = `clientes/${base}.md`;
  const completo = path.join(CLIENTES_DIR, `${base}.md`);

  // Nao sobrescreve um arquivo ja existente (preserva o que o escritorio editou).
  if (!fs.existsSync(completo)) {
    fs.writeFileSync(completo, modeloMdCliente(nomeDisplay, numero), 'utf8');
  }

  return relativo;
}

/**
 * Cria (se ainda nao existir) a ficha .md de um cliente JA PREENCHIDA pela
 * secretaria no momento em que o numero e autorizado no painel. Retorna o
 * caminho relativo (ex: "clientes/joao_silva_5514998689481.md").
 *
 * IMPORTANTE: todo o conteudo digitado por humano (area + observacoes) vai
 * ABAIXO do marcador "Anotações do escritório", justamente para que o bot nunca
 * o altere (ver atualizarMdCliente). A secao "Atendimento" comeca vazia, livre
 * para o bot preencher conforme a conversa evolui.
 *
 * Se o arquivo JA existir (cliente re-adicionado), nao sobrescreve nada — apenas
 * devolve o caminho — para preservar o que humanos ja escreveram. Ajustes finos
 * ficam pelo editor "Contexto dos clientes" do painel.
 */
function criarFichaCliente(numero, nome, dados = {}) {
  if (!fs.existsSync(CLIENTES_DIR)) {
    fs.mkdirSync(CLIENTES_DIR, { recursive: true });
  }

  const slug = slugify(nome);
  const base = slug ? `${slug}_${numero}` : `${numero}`;
  const relativo = `clientes/${base}.md`;
  const completo = path.join(CLIENTES_DIR, `${base}.md`);

  if (!fs.existsSync(completo)) {
    // Monta o bloco da secretaria (so as linhas que foram preenchidas).
    const area = (dados.area || '').trim();
    const observacoes = (dados.observacoes || '').trim();
    const linhas = ['Cadastro pela secretaria:'];
    if (area) linhas.push(`Área de interesse: ${area}`);
    if (observacoes) linhas.push(`Observações: ${observacoes}`);
    const anotacoes = linhas.length > 1 ? linhas.join('\n') : '';

    fs.writeFileSync(
      completo,
      modeloMdCliente(nome, numero, { areaInteresse: '', observacoes: '', anotacoes }),
      'utf8'
    );
  }

  return relativo;
}

// Marcador que separa a parte preenchida pelo bot da parte do escritorio.
// Tudo que vier DEPOIS desta linha nunca e alterado automaticamente.
const MARCADOR_ESCRITORIO = '## Anotações do escritório (não alterado pelo bot)';

/**
 * Monta o conteudo padrao do .md de um cliente, separando a area preenchida
 * automaticamente pelo bot da area livre para anotacoes do escritorio.
 */
function modeloMdCliente(nomeDisplay, numero, dados = {}) {
  const { areaInteresse = '', observacoes = '', anotacoes = '', apelido } = dados;
  // Apelido vazio cai de volta para o nome (evita "Apelido:" em branco).
  const ape = apelido || nomeDisplay || '';
  return `# ${nomeDisplay || numero}
Telefone: ${numero}
Apelido: ${ape}

## Atendimento (preenchido automaticamente pelo bot)
Área de interesse: ${areaInteresse}
Observações: ${observacoes}

${MARCADOR_ESCRITORIO}
${anotacoes}`;
}

/**
 * Extrai os campos estruturados de um .md de cliente JA LIDO (string).
 *
 * Captura o valor de um rotulo em UMA unica linha. Usamos [ \t]* (e nao \s*)
 * de proposito: \s incluiria quebras de linha e, com um campo vazio, a captura
 * "pularia" para a proxima linha (ex.: o marcador do escritorio). Tambem
 * descartamos qualquer "##" que tenha vazado de arquivos corrompidos antigos.
 *
 * Os valores voltam EXATAMENTE como estao no arquivo (sem fallback) — quem
 * chama decide o que fazer com campo vazio.
 */
function extrairPerfil(conteudo) {
  const atual = conteudo || '';
  const pegar = (re) => {
    const m = atual.match(re);
    if (!m) return '';
    return m[1].split('##')[0].replace(/\r/g, '').trim();
  };
  return {
    nomeDisplay: pegar(/^#[ \t]*(.+)$/m),
    numero: pegar(/^Telefone:[ \t]*(.*)$/m),
    apelido: pegar(/^Apelido:[ \t]*(.*)$/m),
    areaInteresse: pegar(/^Área de interesse:[ \t]*(.*)$/m),
    observacoes: pegar(/^Observações:[ \t]*(.*)$/m),
  };
}

/**
 * Le os campos estruturados da ficha de um cliente a partir do CAMINHO do .md.
 *
 * IMPORTANTE (sincronizacao): use esta funcao — e nunca readMarkdown — para
 * montar o pacote de sync. readMarkdown devolve o arquivo INTEIRO, incluindo o
 * bloco espelhado do outro PC; mandar isso de volta faria o espelho crescer em
 * espiral a cada ciclo de sincronizacao. Os regexes acima leem so os campos
 * proprios desta maquina (os do espelho tem o sufixo "(lá)" justamente para
 * nao casarem aqui).
 */
function lerPerfilMd(arquivoMd) {
  return extrairPerfil(readMarkdown(arquivoMd));
}

// Sentinelas do bloco espelhado do OUTRO PC (sincronizacao). Ficam ABAIXO do
// MARCADOR_ESCRITORIO de proposito: atualizarMdCliente preserva verbatim tudo
// que vem depois do marcador, entao o bloco sobrevive a cada turno do bot sem
// precisar de UMA LINHA sequer de mudanca naquela funcao (a mais delicada do
// projeto, que roda a cada mensagem de cada cliente).
const ESPELHO_INICIO = '<!-- espelho-sync:inicio -->';
const ESPELHO_FIM = '<!-- espelho-sync:fim -->';

// O .md inteiro entra no system prompt a cada turno: um espelho gordo vira
// custo e ruido recorrentes. Cortamos o bloco montado neste limite.
const ESPELHO_MAX = 1200;

/** Data/hora curta (dia/mes hora:min) para exibir dentro do bloco. */
function horaCurta(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Devolve o conteudo do bloco espelhado (sem as sentinelas), ou '' se nao houver.
 * Usado pelo painel para listar quem tem dado vindo do outro PC.
 */
function lerEspelho(arquivoMd) {
  const atual = readMarkdown(arquivoMd);
  const i = atual.lastIndexOf(ESPELHO_INICIO);
  const f = atual.lastIndexOf(ESPELHO_FIM);
  if (i === -1 || f <= i) return '';
  return atual.slice(i + ESPELHO_INICIO.length, f).trim();
}

/**
 * Escreve (ou remove) o bloco com o que o OUTRO PC sabe deste cliente.
 *
 * O bloco e SEMPRE reescrito por inteiro, nunca mesclado: ele espelha o estado
 * do outro lado. O bot le mas nunca escreve nele (ver prompt.js) — e por isso
 * que nao existe conflito: nenhum arquivo tem dois donos.
 *
 * @param {string} arquivoMd caminho do .md
 * @param {{origem?:string, recebidoEm?:string, areaInteresse?:string,
 *          observacoes?:string, resumoHistorico?:string, pausado?:number}} dados
 *        Passe um objeto vazio (ou sem campos) para REMOVER o bloco.
 * @returns {boolean} true se o arquivo foi alterado.
 */
function aplicarEspelho(arquivoMd, dados = {}) {
  if (!arquivoMd) return false;
  const fullPath = path.isAbsolute(arquivoMd) ? arquivoMd : path.join(__dirname, arquivoMd);
  if (!fs.existsSync(fullPath)) return false;

  let atual = fs.readFileSync(fullPath, 'utf8');

  // GUARDA CONTRA ECO: depois de "internalizar", o dado do outro PC virou dado
  // nosso e volta para la no proximo pacote — o outro lado nos devolveria um
  // espelho repetindo o que ja e nosso. Campos identicos ao local sao omitidos.
  const local = extrairPerfil(atual);
  const achatar = (t) => String(t || '').replace(/\s*\r?\n\s*/g, ' ').trim();
  const area = achatar(dados.areaInteresse);
  const obs = achatar(dados.observacoes);
  const resumo = achatar(dados.resumoHistorico);

  const linhas = [];
  if (area && area !== local.areaInteresse) linhas.push(`Área de interesse (lá): ${area}`);
  if (obs && obs !== local.observacoes) linhas.push(`Observações (lá): ${obs}`);
  if (resumo) linhas.push(`Resumo do atendimento recente (lá): ${resumo}`);
  // A pausa NAO e aplicada no banco local (pausar aqui porque um advogado
  // assumiu o caso la e uma decisao discutivel) — vira so informacao.
  if (dados.pausado) linhas.push('Situação: o atendimento deste cliente está em pausa no outro número.');

  let bloco = '';
  if (linhas.length) {
    const cabecalho = [
      '## Informado pelo outro número do escritório (não confirmado)',
      '<!-- Este trecho é reescrito a cada sincronização — não edite aqui. -->',
      `Origem: ${dados.origem || 'outro computador'} • Recebido em ${horaCurta(dados.recebidoEm)}`,
    ];
    let corpo = cabecalho.concat(linhas).join('\n');
    if (corpo.length > ESPELHO_MAX) corpo = corpo.slice(0, ESPELHO_MAX - 1).trimEnd() + '…';
    bloco = `${ESPELHO_INICIO}\n${corpo}\n${ESPELHO_FIM}`;
  }

  // GARANTE O MARCADOR antes de anexar. Sem ele, atualizarMdCliente cai no ramo
  // idx === -1, monta anotacoes = '' e APAGA o bloco na primeira mensagem que o
  // cliente mandar. Fichas editadas a mao pelo painel podem nao ter o marcador.
  if (atual.lastIndexOf(MARCADOR_ESCRITORIO) === -1) {
    atual = atual.trimEnd() + `\n\n${MARCADOR_ESCRITORIO}\n`;
  }

  // Splice por SENTINELA (nao por posicao): assim um humano pode mover ou
  // apagar o bloco pela aba Clientes sem quebrar nada — o proximo sync o
  // recria no lugar certo. lastIndexOf colapsa blocos duplicados.
  const i = atual.lastIndexOf(ESPELHO_INICIO);
  const f = atual.lastIndexOf(ESPELHO_FIM);
  let novo;
  if (i !== -1 && f > i) {
    novo = atual.slice(0, i) + bloco + atual.slice(f + ESPELHO_FIM.length);
  } else if (bloco) {
    novo = atual.trimEnd() + '\n\n' + bloco;
  } else {
    novo = atual;
  }
  // Bloco vazio: nao deixa cabecalho orfao nem linhas em branco sobrando.
  novo = novo.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

  if (novo === atual) return false;
  fs.writeFileSync(fullPath, novo, 'utf8');
  return true;
}

/**
 * Atualiza o .md do cliente com o perfil gerado pelo modelo (area de interesse
 * e observacoes), PRESERVANDO o cabecalho e as anotacoes manuais do escritorio.
 *
 * - Campos novos vazios nao apagam o que ja existia (so substituem quando ha
 *   conteudo novo).
 * - Tudo que estiver abaixo do marcador "Anotações do escritório" e mantido.
 *
 * @param {string} arquivoMd  caminho do .md (relativo a raiz ou absoluto).
 * @param {{areaInteresse?: string, observacoes?: string, nomeDisplay?: string, numero?: string}} perfil
 */
function atualizarMdCliente(arquivoMd, perfil = {}) {
  if (!arquivoMd) return;

  const fullPath = path.isAbsolute(arquivoMd)
    ? arquivoMd
    : path.join(__dirname, arquivoMd);

  const atual = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';

  // Le o que ja esta no arquivo (mesmos regexes usados pelo sync — ver extrairPerfil).
  const doArquivo = extrairPerfil(atual);
  const nomeDisplay = perfil.nomeDisplay || doArquivo.nomeDisplay || perfil.numero || '';
  const numero = perfil.numero || doArquivo.numero || '';
  const apelido = doArquivo.apelido;

  // Os dois campos vivem em UMA linha cada no .md, e sao relidos pelos regexes
  // de linha unica acima. Um valor com quebra de linha truncaria o texto na
  // proxima releitura, entao achatamos antes de gravar.
  const umaLinha = (texto) => (texto || '').replace(/\s*\r?\n\s*/g, ' ').trim();

  // Mantem o valor antigo quando o novo vier vazio (nao apaga dados ja escritos).
  const areaInteresse = umaLinha(perfil.areaInteresse) || doArquivo.areaInteresse;
  const observacoes = umaLinha(perfil.observacoes) || doArquivo.observacoes;

  // Preserva o que o escritorio escreveu: tudo apos a ULTIMA ocorrencia do
  // marcador. Usar lastIndexOf colapsa marcadores duplicados de arquivos que
  // tenham sido corrompidos por versoes anteriores.
  const idx = atual.lastIndexOf(MARCADOR_ESCRITORIO);
  const anotacoes = idx !== -1
    ? atual.slice(idx + MARCADOR_ESCRITORIO.length).replace(/^\r?\n/, '').trimEnd()
    : '';

  const conteudo = modeloMdCliente(nomeDisplay, numero, { areaInteresse, observacoes, anotacoes, apelido });
  fs.writeFileSync(fullPath, conteudo, 'utf8');
}

/**
 * Escreve o conteudo bruto em um arquivo Markdown (usado pelo painel para que
 * o escritorio corrija o contexto de um cliente, por exemplo se a IA alucinar).
 * Aceita caminho relativo a raiz do projeto ou absoluto.
 */
function escreverMarkdown(filepath, conteudo) {
  if (!filepath) throw new Error('Arquivo nao informado.');
  const fullPath = path.isAbsolute(filepath)
    ? filepath
    : path.join(__dirname, filepath);
  fs.writeFileSync(fullPath, String(conteudo == null ? '' : conteudo), 'utf8');
  return true;
}

module.exports = {
  readMarkdown, criarMdCliente, criarFichaCliente, atualizarMdCliente,
  escreverMarkdown, lerPerfilMd, aplicarEspelho, lerEspelho,
};
