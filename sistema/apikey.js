// apikey.js
// Leitura e gravacao dos segredos do .env (DEEPSEEK_API_KEY, GEMINI_API_KEY e
// SYNC_TOKEN), para o cliente poder informa-los pelo painel web (sem editar
// arquivos). Ao salvar, aplica o valor em tempo real (sem reiniciar o bot).

const fs = require('fs');
const path = require('path');
const { setDeepseekKey } = require('./bot');
const { setGeminiKey } = require('./midia');
const sync = require('./sync');

const ENV_PATH = path.join(__dirname, '.env');
const ENV_EXEMPLO = path.join(__dirname, '.env.example');

function lerEnv() {
  try { return fs.readFileSync(ENV_PATH, 'utf8'); } catch (e) { return ''; }
}

// Valor atual de uma variavel no .env (string vazia se nao houver).
function valorEnv(nome) {
  const m = lerEnv().match(new RegExp('^' + nome + '=(.*)$', 'm'));
  return m ? m[1].trim() : '';
}

// Grava (ou substitui) uma variavel no .env. Base: o .env existente; se nao
// houver, parte do .env.example (que traz os demais parametros com valores
// padrao) ou de um arquivo vazio.
function gravarEnv(nome, valor) {
  let env = lerEnv();
  if (!env) {
    try { env = fs.readFileSync(ENV_EXEMPLO, 'utf8'); } catch (e) { env = ''; }
  }

  const linha = nome + '=' + valor;
  // Escapa o nome ao montar o regex (nomes atuais sao seguros, mas evita surpresa)
  // e usa uma FUNCAO como substituicao: string literal faria o replace interpretar
  // "$" do valor da chave como padrao especial ($&, $', $`), corrompendo-a.
  const nomeEsc = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^' + nomeEsc + '=.*$', 'm');
  if (re.test(env)) {
    env = env.replace(re, () => linha);
  } else {
    if (env && !env.endsWith('\n')) env += '\n';
    env += linha + '\n';
  }

  fs.writeFileSync(ENV_PATH, env, 'utf8');
}

// Valida o formato de um segredo colado no painel. O rotulo entra na mensagem
// de erro porque o mesmo teste vale para as chaves e para a senha do sync.
function validarChave(chave, rotulo = 'a chave da API') {
  chave = String(chave == null ? '' : chave).trim();
  if (!chave) throw new Error('Informe ' + rotulo + '.');
  if (/\s/.test(chave)) throw new Error('O valor nao pode conter espacos ou quebras de linha.');
  return chave;
}

// Mostra so o comeco e o fim da chave, para conferencia sem expor o segredo.
function mascarar(chave) {
  if (!chave) return '';
  if (chave.length <= 10) return '••••';
  return chave.slice(0, 4) + '••••••••' + chave.slice(-4);
}

// ---- Chave da DeepSeek (respostas do bot) ----

function chaveAtual() {
  return valorEnv('DEEPSEEK_API_KEY');
}

// Estado enviado ao painel (nunca devolve a chave inteira).
function status() {
  const chave = chaveAtual();
  return { configurada: !!chave, mascara: mascarar(chave) };
}

// Grava a chave no .env, aplica no cliente da API e devolve o novo status.
function salvarChave(chave) {
  chave = validarChave(chave);
  gravarEnv('DEEPSEEK_API_KEY', chave);
  // Aplica agora, sem reiniciar: proxima mensagem ja usa a chave nova.
  setDeepseekKey(chave);
  return status();
}

// ---- Chave do Google/Gemini (audios e imagens) ----

function statusGemini() {
  const chave = valorEnv('GEMINI_API_KEY');
  return { configurada: !!chave, mascara: mascarar(chave) };
}

// Grava a chave do Google no .env e aplica na hora: a proxima midia recebida
// ja e transcrita/descrita, sem reiniciar.
function salvarChaveGemini(chave) {
  chave = validarChave(chave);
  gravarEnv('GEMINI_API_KEY', chave);
  setGeminiKey(chave);
  return statusGemini();
}

// ---- Senha da sincronizacao entre os PCs (SYNC_TOKEN) ----
//
// Fica aqui, e nao na aba "Sincronizar", porque e um segredo do mesmo tipo das
// chaves: guardado no .env, digitado uma vez so. Com ela salva, `chamar()` do
// sync.js usa process.env.SYNC_TOKEN sozinho e a aba de sincronizacao nao
// precisa mais pedir senha nenhuma.

function statusSync() {
  const senha = valorEnv('SYNC_TOKEN');
  return { configurada: !!senha, mascara: mascarar(senha) };
}

function salvarSenhaSync(senha) {
  senha = validarChave(senha, 'a senha da sincronizacao');
  gravarEnv('SYNC_TOKEN', senha);
  // Aplica agora, sem reiniciar: o sync.js le de process.env a cada chamada.
  process.env.SYNC_TOKEN = senha;
  // Religa o automatico — ele fica desligado enquanto nao ha senha salva.
  try { sync.iniciarAgendamento(); } catch (e) { console.error('Erro ao religar o sync automatico:', e.message); }
  return statusSync();
}

module.exports = {
  status, salvarChave, chaveAtual, mascarar,
  statusGemini, salvarChaveGemini,
  statusSync, salvarSenhaSync,
};
