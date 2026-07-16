// apikey.js
// Leitura e gravacao das chaves de API (DEEPSEEK_API_KEY e GEMINI_API_KEY) no
// arquivo .env, para o cliente poder informa-las pelo painel web (sem editar
// arquivos). Ao salvar, aplica a chave em tempo real (sem reiniciar o bot).

const fs = require('fs');
const path = require('path');
const { setDeepseekKey } = require('./bot');
const { setGeminiKey } = require('./midia');

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

// Valida o formato de uma chave colada no painel.
function validarChave(chave) {
  chave = String(chave == null ? '' : chave).trim();
  if (!chave) throw new Error('Informe a chave da API.');
  if (/\s/.test(chave)) throw new Error('A chave nao pode conter espacos ou quebras de linha.');
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

module.exports = { status, salvarChave, chaveAtual, mascarar, statusGemini, salvarChaveGemini };
