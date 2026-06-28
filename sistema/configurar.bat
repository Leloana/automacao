@echo off
chcp 65001 >nul
title Configurar Bot Juridico
cd /d "%~dp0"

rem Se nao existir .env, cria a partir do modelo .env.example.
if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
  )
)

echo Abrindo o arquivo de configuracao (.env) no Bloco de Notas.
echo.
echo Cole a sua chave da API DeepSeek apos "DEEPSEEK_API_KEY=" e salve (Ctrl+S).
echo Exemplo:  DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
echo.

rem Abre o .env para edicao.
notepad ".env"
