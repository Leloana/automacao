// avisos.js
// Guarda em memoria os problemas/avisos relevantes para o USUARIO (nao tecnico),
// em portugues claro, para aparecerem no PAINEL WEB — sem precisar olhar o
// terminal nem o log.txt. Tambem ecoa no console (que o logger grava em log.txt).
//
// Nao depende de nenhum outro modulo do projeto (evita ciclos de require).

const MAX = 50; // guarda apenas os avisos mais recentes

const lista = []; // ordem cronologica (mais recentes no fim)
let seq = 0;

// Data/hora local curta (dia/mes hora:min) para exibir no painel.
function horaLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Registra um aviso/erro amigavel para o usuario.
 * @param {'erro'|'aviso'} nivel  gravidade (erro = vermelho, aviso = amarelo).
 * @param {string} titulo         frase curta em portugues simples.
 * @param {string} [detalhe]      explicacao/acao sugerida (opcional).
 *
 * Se o mesmo aviso se repetir em sequencia (dentro de 15s), apenas atualiza a
 * hora e um contador — evita encher a lista com a mesma mensagem em rajada.
 */
function registrar(nivel, titulo, detalhe = '') {
  const agora = Date.now();
  const nv = nivel === 'erro' ? 'erro' : 'aviso';
  const ultimo = lista[lista.length - 1];

  if (ultimo && ultimo.titulo === titulo && ultimo.detalhe === detalhe && (agora - ultimo._t) < 15000) {
    ultimo.hora = horaLocal();
    ultimo.repeticoes = (ultimo.repeticoes || 1) + 1;
    ultimo._t = agora;
  } else {
    lista.push({ id: ++seq, nivel: nv, titulo, detalhe, hora: horaLocal(), repeticoes: 1, _t: agora });
    if (lista.length > MAX) lista.shift();
  }

  // Ecoa no log tecnico (console.* e capturado pelo logger -> log.txt).
  const linha = detalhe ? `${titulo} — ${detalhe}` : titulo;
  if (nv === 'erro') console.error('[AVISO-USUARIO]', linha);
  else console.warn('[AVISO-USUARIO]', linha);
}

/** Lista os avisos, mais recentes primeiro, sem o campo interno de tempo. */
function listar() {
  return lista.slice().reverse().map(({ _t, ...a }) => a);
}

/** Limpa todos os avisos (usado pelo botao "Limpar" do painel). */
function limpar() {
  lista.length = 0;
}

module.exports = { registrar, listar, limpar };
