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
rem    Se faltar, tenta instalar sozinho pelo winget (Windows 10/11).
rem ============================================================
where node >nul 2>nul
if not errorlevel 1 goto NODE_OK

echo [AVISO] Node.js nao encontrado. Vou tentar instalar automaticamente...
echo.
where winget >nul 2>nul
if errorlevel 1 goto NODE_MANUAL

echo Instalando o Node.js LTS. Pode pedir permissao (clique em "Sim") e levar
echo alguns minutos. Aguarde...
echo.
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements

rem Esta janela ainda nao conhece o Node recem-instalado: adiciona o caminho
rem padrao para tentar continuar sem precisar reabrir.
set "PATH=%PATH%;C:\Program Files\nodejs"
where node >nul 2>nul
if not errorlevel 1 goto NODE_OK

echo.
echo ============================================
echo  Quase la! Se o Node.js foi instalado agora,
echo  FECHE esta janela e abra o "iniciar.bat" de novo.
echo.
echo  Se aparecer erro de instalacao, baixe a versao
echo  LTS manualmente em: https://nodejs.org
echo ============================================
echo.
pause
exit /b 1

:NODE_MANUAL
echo [ERRO] Nao foi possivel instalar automaticamente (winget indisponivel).
echo.
echo Baixe e instale a versao LTS em: https://nodejs.org
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
rem 3) Arquivo .env e chave da API (OBRIGATORIO para responder).
rem ============================================================
if not exist ".env" (
  echo.
  echo [ERRO] Arquivo .env nao encontrado.
  echo Abra a pasta "sistema" e rode "configurar.bat" para informar a chave da API.
  echo.
  pause
  exit /b 1
)
rem Verifica se DEEPSEEK_API_KEY tem algum valor (linha com algo apos o "=").
findstr /R /C:"^DEEPSEEK_API_KEY=." ".env" >nul
if errorlevel 1 (
  echo.
  echo [ERRO] A chave DEEPSEEK_API_KEY esta vazia no arquivo .env.
  echo Na pasta "sistema", rode "configurar.bat", cole a chave e salve antes de iniciar.
  echo.
  pause
  exit /b 1
)
echo [OK] Chave da API configurada.
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
