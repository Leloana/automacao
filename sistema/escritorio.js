// escritorio.js
// Leitura/edicao do contexto do escritorio (o .md da instituicao) em campos
// separados, para o painel: as AREAS que o escritorio atende e a DESCRICAO
// (horario, endereco, orientacoes, perguntas frequentes...).
//
// O arquivo e o mesmo que o bot injeta no system prompt como "Contexto do
// escritório" — e dele que o bot conclui se o escritorio atende ou nao um
// assunto. E lido a cada uso, entao alteracoes pelo painel valem sem reiniciar.

const path = require('path');
const fs = require('fs');
const db = require('./db');

const INSTITUICAO_PADRAO_ID = Number(process.env.INSTITUICAO_PADRAO_ID) || 1;

// Rotulo da linha de areas gravada no .md. Explicito de proposito: e ele que
// diz ao modelo quais assuntos o escritorio cobre (evita o bot "recusar" uma
// area que o escritorio atende).
const ROTULO_AREAS = 'Especialidades (áreas que o escritório atende)';

// Reconhece a linha de areas tambem nos rotulos antigos ("Especialidades:",
// "Áreas de atuação:"), para ler arquivos criados antes desta tela existir.
const RE_LINHA_AREAS = /^(?:Especialidades|Áreas de atuação|Areas de atuacao)[^:\n]*:[ \t]*(.*)$/i;

/**
 * Busca a instituicao padrao e resolve o caminho absoluto do seu .md.
 * Lanca erro amigavel se a instituicao nao existir no banco.
 */
function resolverInstituicao() {
  const inst = db.getInstituicao(INSTITUICAO_PADRAO_ID);
  if (!inst || !inst.arquivo_md) {
    throw new Error('Escritório não encontrado no banco. Reinicie o bot e tente de novo.');
  }
  const fullPath = path.isAbsolute(inst.arquivo_md)
    ? inst.arquivo_md
    : path.join(__dirname, inst.arquivo_md);
  return { inst, fullPath };
}

/**
 * Le o .md da instituicao e devolve os campos separados:
 * { nome, areas, descricao }. "areas" e uma string ("trabalhista, família");
 * "descricao" e todo o resto do arquivo (sem o titulo e sem a linha de areas).
 */
function getEscritorio() {
  const { inst, fullPath } = resolverInstituicao();
  const conteudo = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';

  const linhas = conteudo.replace(/\r/g, '').split('\n');
  let areas = '';
  let tituloRemovido = false;
  let areasRemovida = false;
  const resto = linhas.filter((l) => {
    // Remove o titulo do arquivo ("# Nome") — e regenerado a partir do banco.
    if (!tituloRemovido && /^#[ \t]/.test(l)) {
      tituloRemovido = true;
      return false;
    }
    // Extrai a primeira linha de areas; o resto do texto fica na descricao.
    if (!areasRemovida) {
      const m = l.match(RE_LINHA_AREAS);
      if (m) {
        areas = m[1].trim();
        areasRemovida = true;
        return false;
      }
    }
    return true;
  });

  return { nome: inst.nome, areas, descricao: resto.join('\n').trim() };
}

/**
 * Regrava o .md da instituicao a partir dos campos do painel.
 * Normaliza as areas (separadas por virgula) e preserva a descricao como veio.
 * Retorna { ok, nome, areas, descricao } ja relidos do arquivo.
 */
function salvarEscritorio(dados = {}) {
  const { inst, fullPath } = resolverInstituicao();

  const areas = String(dados.areas == null ? '' : dados.areas)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
  const descricao = String(dados.descricao == null ? '' : dados.descricao)
    .replace(/\r\n/g, '\n')
    .trim();

  const partes = [`# ${inst.nome}`];
  if (areas) partes.push(`${ROTULO_AREAS}: ${areas}`);
  if (descricao) partes.push('', descricao);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, partes.join('\n') + '\n', 'utf8');

  return { ok: true, ...getEscritorio() };
}

module.exports = { getEscritorio, salvarEscritorio };
