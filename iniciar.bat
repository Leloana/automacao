@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Bot Juridico WhatsApp - Ferreira Ramos
rem %~dp0 e a pasta deste .bat (raiz do projeto, com o .git e a pasta sistema).
cd /d "%~dp0"

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
git pull --ff-only
if errorlevel 1 (
  echo [INFO] Nao foi possivel atualizar agora ^(sem internet ou alteracoes locais^). Seguindo.
  goto APOS_UPDATE
)
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

echo Instalando o Node.js %NODE_REQ_MAJOR% ^(versao fixa para compatibilidade^).
echo Pode pedir permissao ^(clique em "Sim"^) e levar alguns minutos. Aguarde...
echo.
rem --force troca a versao mesmo que ja exista outro Node instalado.
winget install -e --id %NODE_WINGET_ID% --force --accept-source-agreements --accept-package-agreements

rem Coloca o caminho padrao do Node na FRENTE do PATH para esta janela usar
rem imediatamente a versao recem-instalada (sem precisar reabrir).
set "PATH=C:\Program Files\nodejs;%PATH%"
set "NODE_MAJOR="
for /f "tokens=1 delims=." %%v in ('node --version 2^>nul') do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=!NODE_MAJOR:v=!"
if "!NODE_MAJOR!"=="%NODE_REQ_MAJOR%" goto NODE_OK

echo.
echo ============================================
echo  O Node.js %NODE_REQ_MAJOR% foi instalado/ajustado agora.
echo  FECHE esta janela e abra o "iniciar.bat" de novo.
echo.
echo  Se aparecer erro de instalacao, baixe o Node %NODE_REQ_MAJOR%
echo  manualmente em: https://nodejs.org/dist/latest-v%NODE_REQ_MAJOR%.x/
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
echo [OK] Dependencias do Node prontas.

rem O Chrome usado pelo WhatsApp fica no cache do usuario (fora do projeto);
rem numa maquina nova ele pode faltar mesmo com node_modules presente.
node -e "process.exit(require('fs').existsSync(require('puppeteer').executablePath()) ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo.
  echo Baixando o navegador usado pelo WhatsApp ^(so na primeira vez^)...
  call npx puppeteer browsers install chrome
  if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao baixar o navegador. Verifique a internet e tente de novo.
    pause
    exit /b 1
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

rem Abre o painel no navegador apos alguns segundos (tempo do servidor subir).
rem Roda numa janela minimizada e separada, para nao travar o bot.
start "" /min cmd /c "timeout /t 5 /nobreak >nul & explorer http://localhost:3000"

rem ============================================================
rem 5) Inicia o bot.
rem ============================================================
node index.js

echo.
echo O bot foi encerrado.
pause
endlocal
