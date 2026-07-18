@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Bot Juridico WhatsApp - Ferreira Ramos
rem %~dp0 e a pasta deste .bat (raiz do projeto, com o .git e a pasta sistema).
cd /d "%~dp0"

rem ============================================================
rem DESLIGA O "MODO DE EDICAO RAPIDA" DO CONSOLE. NAO REMOVA.
rem Com ele ligado (padrao do Windows), UM CLIQUE dentro desta janela preta
rem entra em modo de selecao e CONGELA o processo inteiro no primeiro
rem console.log: sem erro, sem crash, sem nada no log. O bot fica de pe
rem aparentemente, mas nao le mais nenhuma mensagem. Em 18/07/2026 isso deixou
rem o escritorio 5h30 sem atendimento e nao havia UMA linha de erro para
rem explicar. Basta esbarrar o mouse ou clicar na janela para "acordar" o PC.
rem
rem ATENCAO ao mexer aqui: gravar a chave NAO conserta esta janela. O Windows le
rem a configuracao do console quando a JANELA NASCE, entao a correcao so vale a
rem partir da proxima. Por isso, quando precisamos mudar a chave, RELANCAMOS o
rem .bat uma vez: a janela nova ja nasce sem a Edicao Rapida. Sem esse relance,
rem o primeiro uso em um PC novo continuaria vulneravel justamente ao bug.
rem
rem O relance acontece UMA vez so: na proxima abertura a chave ja esta 0x0 e o
rem bloco inteiro e pulado. A variavel CONSOLE_OK e um cinto de seguranca contra
rem loop de relance caso a gravacao da chave falhe (ex.: politica da empresa) -
rem nesse caso seguimos assim mesmo, sem travar o inicio do bot.
rem ============================================================
if not defined CONSOLE_OK (
  set "QE="
  for /f "tokens=3" %%q in ('reg query "HKCU\Console" /v QuickEdit 2^>nul ^| findstr /I /C:"QuickEdit"') do set "QE=%%q"
  if /I not "!QE!"=="0x0" (
    echo Ajustando a configuracao da janela para o bot nao travar...
    reg add "HKCU\Console" /v QuickEdit /t REG_DWORD /d 0 /f >nul 2>nul
    set "CONSOLE_OK=1"
    start "" "%~f0" %*
    exit /b 0
  )
)
set "CONSOLE_OK=1"

echo ============================================
echo   Bot Juridico WhatsApp - Ferreira Ramos
echo ============================================
echo.

rem Se foi reiniciado apos uma atualizacao, pula o update e so reinstala deps.
if "%~1"=="--updated" (
  set "NEED_INSTALL=1"
  goto APOS_UPDATE
)

rem ============================================================
rem 0) Atualizacao automatica (git pull). NUNCA trava o inicio: se faltar
rem    git/internet ou houver conflito, segue rodando a versao atual.
rem ============================================================
set "NEED_INSTALL="
if not exist ".git" (
  echo [INFO] Instalado sem controle de versao; atualizacao automatica desativada.
  goto APOS_UPDATE
)

where git >nul 2>nul
if not errorlevel 1 goto GIT_PRONTO
echo [INFO] Git nao encontrado. Tentando instalar via winget...
where winget >nul 2>nul
if errorlevel 1 (
  echo [INFO] winget indisponivel; seguindo sem atualizar.
  goto APOS_UPDATE
)
winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
set "PATH=%PATH%;C:\Program Files\Git\cmd"
where git >nul 2>nul
if errorlevel 1 (
  echo [INFO] Git instalado; pode ser preciso reabrir. Seguindo sem atualizar agora.
  goto APOS_UPDATE
)

:GIT_PRONTO
echo Procurando atualizacoes...
set "GIT_TERMINAL_PROMPT=0"
for /f "delims=" %%i in ('git rev-parse HEAD 2^>nul') do set "REV_ANTES=%%i"
rem Descobre a branch atual (fallback: main) para saber com quem alinhar.
set "BRANCH=main"
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%b"
if "!BRANCH!"=="HEAD" set "BRANCH=main"

rem Busca as atualizacoes do servidor. Sem internet -> segue com a versao atual.
git fetch origin
if errorlevel 1 (
  echo [INFO] Sem internet para atualizar agora. Seguindo com a versao atual.
  goto APOS_UPDATE
)

rem Caso comum: avanca em linha reta ate o remoto.
git merge --ff-only "origin/!BRANCH!"
if not errorlevel 1 goto UPDATE_OK

rem Nao deu fast-forward: o historico do servidor foi reescrito (force-push) ou
rem ha commits/alteracoes locais neste PC. Esta maquina so CONSOME atualizacoes,
rem entao alinhamos forcado com o servidor. Os dados sensiveis (.env, db, sessao
rem do WhatsApp, whitelist, clientes...) sao git-ignored e NAO sao afetados pelo
rem reset --hard (ele so mexe em arquivos versionados).
echo [INFO] Historico divergente do servidor ^(force-push^). Alinhando com origin/!BRANCH!...
git reset --hard "origin/!BRANCH!"
if errorlevel 1 (
  echo [INFO] Nao foi possivel alinhar com o servidor agora. Seguindo com a versao atual.
  goto APOS_UPDATE
)

:UPDATE_OK
for /f "delims=" %%i in ('git rev-parse HEAD 2^>nul') do set "REV_DEPOIS=%%i"
if "!REV_ANTES!"=="!REV_DEPOIS!" (
  echo [OK] Ja esta na versao mais recente.
  goto APOS_UPDATE
)
echo [OK] Sistema atualizado para a versao mais recente.
rem Se o proprio iniciar.bat mudou, reinicia para evitar erro de execucao.
git diff --name-only "!REV_ANTES!" "!REV_DEPOIS!" | findstr /I /C:"iniciar.bat" >nul
if not errorlevel 1 (
  echo [INFO] O iniciar foi atualizado. Reiniciando...
  start "" "%~f0" --updated
  exit /b 0
)
rem Atualizou algo (possivelmente dependencias): reinstala por seguranca.
set "NEED_INSTALL=1"

:APOS_UPDATE
rem Entra na pasta "sistema", onde ficam todos os arquivos do bot.
cd /d "%~dp0sistema"
if errorlevel 1 (
  echo [ERRO] Pasta "sistema" nao encontrada ao lado deste arquivo.
  echo Mantenha o "iniciar.bat" na mesma pasta que a pasta "sistema".
  echo.
  pause
  exit /b 1
)

rem ============================================================
rem 0.1) Guard de instancia unica: se o bot JA esta aberto (painel na porta
rem      3000), abrir de novo quebra tudo — a porta e a sessao do WhatsApp ficam
rem      "em uso" (EADDRINUSE, "browser already running", "Acesso negado" nos
rem      arquivos do Chrome). Entao ENCERRAMOS a instancia anterior (o node e o
rem      Chrome filho dele) e seguimos com a nova. So matamos se o dono da porta
rem      for mesmo um node.exe (para nao fechar outro programa por engano).
rem ============================================================
set "OLD_PID="
for /f "tokens=5" %%p in ('netstat -ano -p tcp 2^>nul ^| findstr /C:"127.0.0.1:3000" ^| findstr /C:"LISTENING"') do set "OLD_PID=%%p"
if defined OLD_PID (
  set "OLD_IMG="
  for /f "tokens=1" %%n in ('tasklist /FI "PID eq !OLD_PID!" /NH 2^>nul') do set "OLD_IMG=%%n"
  if /I "!OLD_IMG!"=="node.exe" (
    echo [INFO] O bot ja estava aberto ^(PID !OLD_PID!^). Encerrando a instancia anterior...
    taskkill /F /T /PID !OLD_PID! >nul 2>nul
    rem Espera a porta e a sessao do WhatsApp serem liberadas pelo Windows.
    timeout /t 4 /nobreak >nul
    echo [OK] Instancia anterior encerrada. Iniciando de novo...
    echo.
  ) else (
    echo.
    echo ============================================
    echo  [ATENCAO] A porta 3000 esta ocupada por outro programa
    echo  ^(!OLD_IMG!^), nao pelo bot. Feche esse programa ou reinicie o
    echo  computador antes de abrir o bot.
    echo ============================================
    echo.
    pause
    exit /b 1
  )
)

rem ============================================================
rem 1) Node.js (OBRIGATORIO) - sem ele o bot nao roda.
rem    ATENCAO: os modulos nativos (better-sqlite3) sao compilados para UMA
rem    versao MAIOR do Node (ABI). Este projeto foi feito no Node 22, entao
rem    FIXAMOS o Node 22. O pacote generico "OpenJS.NodeJS.LTS" do winget hoje
rem    instala o Node 24 (ABI diferente) e quebra o better-sqlite3, que ainda
rem    nao tem binario pronto para o 24. Por isso usamos o pacote "OpenJS.NodeJS.22".
rem ============================================================
set "NODE_REQ_MAJOR=22"
set "NODE_WINGET_ID=OpenJS.NodeJS.22"

where node >nul 2>nul
if errorlevel 1 (
  echo [AVISO] Node.js nao encontrado. Vou instalar o Node %NODE_REQ_MAJOR% automaticamente...
  echo.
  goto NODE_INSTALL
)

rem Node existe: confere se a versao MAIOR e a exigida por este sistema.
set "NODE_MAJOR="
for /f "tokens=1 delims=." %%v in ('node --version 2^>nul') do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=!NODE_MAJOR:v=!"
if "!NODE_MAJOR!"=="%NODE_REQ_MAJOR%" goto NODE_OK

echo [AVISO] Este PC tem o Node !NODE_MAJOR!, mas este sistema exige o Node %NODE_REQ_MAJOR%.
echo Vou ajustar para a versao correta ^(isso corrige o erro "NODE_MODULE_VERSION"^)...
echo.

:NODE_INSTALL
where winget >nul 2>nul
if errorlevel 1 goto NODE_MANUAL

rem IMPORTANTE: se ja existe um Node de OUTRA versao maior, e preciso DESINSTALAR
rem antes. O instalador do Node se recusa a "rebaixar" (ex.: 24 -> 22): ele acha
rem que ja ha uma versao mais nova e nao faz nada, mas retorna "sucesso" -> o bat
rem reabria e detectava o 24 de novo, entrando em loop. Removendo o antigo, o
rem Node 22 instala limpo.
if defined NODE_MAJOR (
  echo Removendo a versao atual do Node ^(!NODE_MAJOR!^) antes de instalar a correta...
  winget uninstall -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements >nul 2>nul
  winget uninstall -e --id OpenJS.NodeJS --silent --accept-source-agreements >nul 2>nul
  winget uninstall --name "Node.js" --silent --accept-source-agreements >nul 2>nul
  echo Versao antiga removida.
  echo.
)

echo Instalando o Node.js %NODE_REQ_MAJOR% ^(versao fixa para compatibilidade^).
echo Pode pedir permissao ^(clique em "Sim"^) e levar alguns minutos. Aguarde...
echo.
winget install -e --id %NODE_WINGET_ID% --force --accept-source-agreements --accept-package-agreements

rem Coloca o caminho padrao do Node na FRENTE do PATH para esta janela usar
rem imediatamente a versao recem-instalada (sem precisar reabrir).
set "PATH=C:\Program Files\nodejs;%PATH%"
set "NODE_MAJOR="
for /f "tokens=1 delims=." %%v in ('node --version 2^>nul') do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=!NODE_MAJOR:v=!"
if "!NODE_MAJOR!"=="%NODE_REQ_MAJOR%" goto NODE_OK

rem Chegou aqui: mesmo apos desinstalar+instalar, o Node ainda nao e o %NODE_REQ_MAJOR%.
rem Nao mandamos "reabrir" (evita o loop) — damos o passo manual definitivo.
echo.
echo ============================================
echo  [ATENCAO] Nao consegui trocar o Node automaticamente.
echo  O Node detectado ainda e: !NODE_MAJOR!
echo.
echo  Faca a troca manual (uma vez so):
echo   1) Abra "Adicionar ou remover programas" e DESINSTALE o "Node.js".
echo   2) Instale o Node %NODE_REQ_MAJOR% (arquivo .msi x64) por este link:
echo      https://nodejs.org/dist/latest-v%NODE_REQ_MAJOR%.x/
echo   3) Abra o "iniciar.bat" de novo.
echo ============================================
echo.
pause
exit /b 1

:NODE_MANUAL
echo [ERRO] Nao foi possivel instalar automaticamente (winget indisponivel).
echo.
echo Baixe e instale o Node %NODE_REQ_MAJOR% em: https://nodejs.org/dist/latest-v%NODE_REQ_MAJOR%.x/
echo Depois feche e abra este arquivo novamente.
echo.
pause
exit /b 1

:NODE_OK
for /f "delims=" %%v in ('node --version 2^>nul') do echo [OK] Node.js %%v

rem ============================================================
rem 2) Dependencias do Node (instala na primeira vez ou apos atualizacao).
rem ============================================================
if not exist "node_modules" set "NEED_INSTALL=1"
rem Modulos nativos (better-sqlite3) sao compilados para UMA versao de Node.
rem Se a pasta node_modules veio de outra maquina/versao (ex.: copiada num zip),
rem o require falha; nesse caso apaga tudo e reinstala para este Node.
if not defined NEED_INSTALL (
  node -e "require('better-sqlite3')" >nul 2>nul
  if errorlevel 1 (
    echo [INFO] Dependencias incompativeis com este Node. Vou reinstalar...
    rmdir /s /q "node_modules" 2>nul
    set "NEED_INSTALL=1"
  )
)
rem IMPORTANTE: o puppeteer baixa o navegador automaticamente durante o "npm
rem install". Esse download e fragil: se cair a internet no meio, ele deixa a
rem pasta do navegador (ex.: chrome-headless-shell) criada MAS sem o .exe, se
rem recusa a rebaixar e ABORTA todo o npm install. Por isso PULAMOS esse download
rem aqui e baixamos o navegador no passo seguinte, isolado e com limpeza/retry.
set "PUPPETEER_SKIP_DOWNLOAD=1"
if defined NEED_INSTALL (
  echo.
  echo Instalando/atualizando dependencias do Node...
  echo Isso pode levar alguns minutos.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao instalar as dependencias do Node.
    pause
    exit /b 1
  )
)
set "PUPPETEER_SKIP_DOWNLOAD="
echo [OK] Dependencias do Node prontas.

rem O Chrome usado pelo WhatsApp fica no cache do usuario (fora do projeto);
rem numa maquina nova ele pode faltar mesmo com node_modules presente.
rem A verificacao pega DOIS casos: (a) navegador ausente e (b) download pela
rem metade (pasta do navegador criada, mas SEM o .exe dentro) - foi isso que
rem quebrou o boot. Nos dois casos, apagamos o cache e baixamos de novo.
rem A verificacao mora em verificar-navegador.js, e NAO num "node -e" aqui: este
rem .bat roda com delayed expansion, que come tudo entre dois "!" — e o codigo
rem usa "!". Inline, ele chegava mutilado ao Node e falhava SEMPRE, fazendo o bot
rem rebaixar o Chrome (190 MB) a cada abertura. Nao traga o codigo de volta.
node verificar-navegador.js >nul 2>nul
if errorlevel 1 (
  echo.
  echo Baixando o navegador usado pelo WhatsApp ^(so na primeira vez^)...
  rem Um download interrompido antes deixa a pasta do navegador sem o .exe e o
  rem puppeteer se recusa a rebaixar. Limpamos o cache parcial antes de tentar.
  if exist "%USERPROFILE%\.cache\puppeteer" rmdir /s /q "%USERPROFILE%\.cache\puppeteer"
  call npx puppeteer browsers install chrome
  if errorlevel 1 (
    echo [INFO] Falhou. Limpando o cache e tentando mais uma vez...
    if exist "%USERPROFILE%\.cache\puppeteer" rmdir /s /q "%USERPROFILE%\.cache\puppeteer"
    call npx puppeteer browsers install chrome
    if errorlevel 1 (
      echo.
      echo [ERRO] Falha ao baixar o navegador. Verifique a internet e tente de novo.
      pause
      exit /b 1
    )
  )
)
echo [OK] Navegador do WhatsApp pronto.

rem ============================================================
rem 3) Chave da API (DeepSeek). NAO trava o inicio: se faltar, o bot sobe
rem    mesmo assim e o cliente cola a chave direto no painel web (aba "Chave
rem    da API"). Sem chave o bot conecta ao WhatsApp, mas nao responde.
rem ============================================================
set "APIKEY_OK="
if exist ".env" findstr /R /C:"^DEEPSEEK_API_KEY=." ".env" >nul && set "APIKEY_OK=1"
if defined APIKEY_OK (
  echo [OK] Chave da API configurada.
) else (
  echo [AVISO] Chave da API ainda nao configurada.
  echo         Quando o painel abrir, cole a chave na aba "Chave da API" e salve.
)
echo [OK] Consulta de processos via endpoint do escritorio (DataJud).

echo.
echo ============================================
echo Iniciando o bot...
echo - O painel vai abrir no navegador (http://localhost:3000).
echo   La voce escaneia o QR code e ve o status "Conectado".
echo - Para parar o bot, feche esta janela.
echo ============================================
echo.

rem Abre o painel no navegador SO quando ele estiver realmente no ar. Antes
rem abriamos apos 5s fixos: em PCs lentos o servidor ainda nao tinha subido e a
rem pagina abria com erro (precisava apertar F5). Agora um processo em segundo
rem plano testa a porta e so abre quando ela responde (espera ate ~60s).
rem O teste e um TCP puro a cada 200ms (e nao um Invoke-WebRequest a cada 2s):
rem o Invoke-WebRequest precisa carregar a pilha HTTP do .NET na 1a chamada e o
rem sleep de 2s somava atraso a toa — o painel sobe logo no inicio do index.js,
rem entao a pagina abre em ~1-2s. Roda minimizado e separado, para nao travar o bot.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "$u='http://localhost:3000'; for($i=0;$i -lt 300;$i++){ $c=New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1',3000); $c.Close(); break } catch { Start-Sleep -Milliseconds 200 } finally { $c.Dispose() } }; Start-Process $u"

rem Remove travas antigas da sessao do WhatsApp. Quando a instancia anterior e
rem encerrada a forca (ou o PC desliga sem fechar o bot), o Chrome deixa arquivos
rem "Singleton*" para tras e o proximo boot falha com "browser already running".
rem E seguro apagar aqui: o guard no inicio ja garantiu que nao ha outra
rem instancia do bot rodando.
del /s /q "data\sessions\SingletonLock" "data\sessions\SingletonCookie" "data\sessions\SingletonSocket" >nul 2>nul

rem ============================================================
rem 4.1) Vigia (watchdog): reinicia o bot se ele CONGELAR — processo de pe, mas
rem      sem responder e sem ler mensagem nenhuma. Roda escondido, em segundo
rem      plano, e SE ENCERRA sozinho quando o bot e fechado de proposito (ele so
rem      reage a travamento, nunca a ausencia do processo). Ver watchdog.ps1.
rem ============================================================
if exist "%~dp0watchdog.ps1" (
  start "" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0watchdog.ps1"
)

rem ============================================================
rem 5) Inicia o bot.
rem ============================================================
node index.js

echo.
echo O bot foi encerrado.
pause
endlocal
