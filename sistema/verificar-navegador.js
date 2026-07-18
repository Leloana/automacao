// verificar-navegador.js
// Verifica se o navegador (Chrome) que o WhatsApp usa esta realmente instalado
// no cache do puppeteer. Sai com codigo 0 = pronto, 1 = precisa baixar.
//
// Pega DOIS casos:
//   (a) navegador ausente;
//   (b) download pela metade — a pasta da versao foi criada, mas nao ha .exe
//       dentro dela (foi isso que quebrou o boot uma vez).
//
// IMPORTANTE: isto vive num arquivo separado, e nao dentro de um `node -e "..."`
// no iniciar.bat, de proposito. O .bat roda com `setlocal enabledelayedexpansion`,
// e nesse modo o cmd COME tudo o que estiver entre dois pontos de exclamacao. O
// codigo aqui usa `!` (ex.: `!hasExe(...)`), entao dentro do .bat ele chegava
// mutilado ao Node, dava SyntaxError e a verificacao falhava SEMPRE — fazendo o
// bot rebaixar o Chrome inteiro a cada abertura. Nao traga este codigo de volta
// para dentro do .bat.

const fs = require('fs');
const os = require('os');
const path = require('path');

const cache = process.env.PUPPETEER_CACHE_DIR
  || path.join(os.homedir(), '.cache', 'puppeteer');

/** Ha algum .exe em algum lugar dentro desta pasta? */
function temExe(dir) {
  for (const nome of fs.readdirSync(dir)) {
    const alvo = path.join(dir, nome);
    if (fs.statSync(alvo).isDirectory()) {
      if (temExe(alvo)) return true;
    } else if (nome.toLowerCase().endsWith('.exe')) {
      return true;
    }
  }
  return false;
}

let ok = false;
try {
  if (fs.existsSync(require('puppeteer').executablePath())) {
    ok = true;
    // Alguma versao baixada pela metade derruba a verificacao inteira.
    for (const navegador of fs.readdirSync(cache)) {
      const pastaNavegador = path.join(cache, navegador);
      if (!fs.statSync(pastaNavegador).isDirectory()) continue;
      for (const versao of fs.readdirSync(pastaNavegador)) {
        const pastaVersao = path.join(pastaNavegador, versao);
        if (fs.statSync(pastaVersao).isDirectory() && !temExe(pastaVersao)) ok = false;
      }
    }
  }
} catch (e) {
  ok = false;
}

process.exit(ok ? 0 : 1);
