@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Bot Juridico WhatsApp - Ferreira Ramos
rem Entra na pasta "sistema", onde ficam todos os arquivos do bot.
rem (%~dp0 e a pasta deste .bat, mesmo que seja aberto de outro lugar.)
cd /d "%~dp0sistema"
if errorlevel 1 (
  echo [ERRO] Pasta "sistema" nao encontrada ao lado deste arquivo.
  echo Mantenha o "iniciar.bat" na mesma pasta que a pasta "sistema".
  echo.
  pause
  exit /b 1
)

echo ============================================
echo   Bot Juridico WhatsApp - Ferreira Ramos
echo ============================================
echo.

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
rem 2) Dependencias do Node (instala na primeira vez).
rem ============================================================
if not exist "node_modules" (
  echo.
  echo Primeira execucao detectada. Instalando dependencias...
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
