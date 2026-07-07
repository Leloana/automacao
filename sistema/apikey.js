// apikey.js
// Leitura e gravacao da chave da API (DEEPSEEK_API_KEY) no arquivo .env,
// para o cliente poder informar a chave pelo painel web (sem editar arquivos).
// Ao salvar, aplica a chave em tempo real no cliente da DeepSeek (sem reiniciar).

const fs = require('fs');
const path = require('path');
const { setDeepseekKey } = require('./bot');

const ENV_PATH = path.join(__dirname, '.env');
const ENV_EXEMPLO = path.join(__dirname, '.env.example');

function lerEnv() {
  try { return fs.readFileSync(ENV_PATH, 'utf8'); } catch (e) { return ''; }
}

// Valor atual da chave no .env (string vazia se nao houver).
function chaveAtual() {
  const m = lerEnv().match(/^DEEPSEEK_API_KEY=(.*)$/m);
  return m ? m[1].trim() : '';
}

// Mostra so o comeco e o fim da chave, para conferencia sem expor o segredo.
function mascarar(chave) {
  if (!chave) return '';
  if (chave.length <= 10) return '••••';
  return chave.slice(0, 4) + '••••••••' + chave.slice(-4);
}

// Estado enviado ao painel (nunca devolve a chave inteira).
function status() {
  const chave = chaveAtual();
  return { configurada: !!chave, mascara: mascarar(chave) };
}

// Grava a chave no .env, aplica no cliente da API e devolve o novo status.
function salvarChave(chave) {
  chave = String(chave == null ? '' : chave).trim();
  if (!chave) throw new Error('Informe a chave da API.');
  if (/\s/.test(chave)) throw new Error('A chave nao pode conter espacos ou quebras de linha.');

  // Base do .env: usa o que ja existe; se nao houver, parte do .env.example
  // (que traz os demais parametros com valores padrao) ou de um arquivo vazio.
  let env = lerEnv();
  if (!env) {
    try { env = fs.readFileSync(ENV_EXEMPLO, 'utf8'); } catch (e) { env = ''; }
  }

  const linha = 'DEEPSEEK_API_KEY=' + chave;
  if (/^DEEPSEEK_API_KEY=.*$/m.test(env)) {
    env = env.replace(/^DEEPSEEK_API_KEY=.*$/m, linha);
  } else {
    if (env && !env.endsWith('\n')) env += '\n';
    env += linha + '\n';
  }

  fs.writeFileSync(ENV_PATH, env, 'utf8');

  // Aplica agora, sem reiniciar: proxima mensagem ja usa a chave nova.
  setDeepseekKey(chave);

  return status();
}

module.exports = { status, salvarChave, chaveAtual, mascarar };
