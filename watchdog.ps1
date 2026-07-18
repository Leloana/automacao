# watchdog.ps1
# Vigia o bot e o reinicia se ele CONGELAR.
#
# ATENCAO: ESTE ARQUIVO E ASCII PURO. NAO USE ACENTO NEM TRAVESSAO LONGO AQUI.
# O iniciar.bat chama o "powershell" (Windows PowerShell 5.1), que le arquivos
# .ps1 SEM BOM como ANSI, e nao UTF-8. Um caractere fora do ASCII vira bytes
# invalidos: se cair dentro de uma string, o parser acusa "cadeia de caracteres
# nao tem o terminador" e o vigia MORRE NO ARRANQUE, silenciosamente, porque
# roda escondido. Ou seja: o vigia contra falha silenciosa falharia em silencio.
# O iniciar.bat segue a mesma regra pelo mesmo motivo.
#
# O problema que este arquivo resolve (18/07/2026): o bot ficou 5h30 fora do ar
# sem UM erro sequer no log. O processo node continuava vivo, a janela preta
# continuava aberta mostrando a ultima linha, e as mensagens dos clientes iam
# para o vazio. Causa: o "Modo de Edicao Rapida" do console do Windows. Um
# clique dentro da janela entra em modo de selecao e CONGELA o processo inteiro
# no primeiro console.log - sem erro, sem crash, sem aviso.
#
# O iniciar.bat ja desliga a Edicao Rapida (a causa). Este watchdog e a rede de
# seguranca: se o bot congelar por QUALQUER outro motivo, alguem percebe em
# ~3 min em vez de horas.
#
# COMO ELE DISTINGUE "CONGELADO" DE "FECHADO PELO USUARIO" - importante:
#   - node vivo + painel NAO responde  -> CONGELADO   -> mata e reinicia.
#   - node nao existe                  -> o usuario fechou a janela -> SAI quieto.
# Sem essa distincao o watchdog reabriria o bot toda vez que alguem o fechasse
# de proposito. Por isso ele nunca reage a ausencia do processo, so a travamento.
#
# E POR QUE UM GET HTTP E NAO UM TESTE DE PORTA: com o processo congelado o
# Windows continua ACEITANDO a conexao TCP (o socket fica no backlog do sistema).
# Um "Test-NetConnection" passaria com o bot morto por dentro. So um GET de
# verdade prova que o event loop do Node esta girando.

param(
  [int]$Porta = 3000,
  [string]$Raiz = $PSScriptRoot
)

$INTERVALO_S      = 60   # de quanto em quanto tempo checa
$FALHAS_P_REINICIO = 3   # so reinicia apos 3 falhas seguidas (~3 min)
$MAX_REINICIOS    = 3    # trava de seguranca contra loop de reinicio

$logPath = Join-Path $Raiz 'sistema\log.txt'

function Escrever($texto) {
  $linha = "[{0}] [WATCHDOG] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto
  try { Add-Content -Path $logPath -Value $linha -Encoding utf8 } catch { }
}

# Retorna o PID do node.exe dono da porta do painel, ou $null se nao houver.
function PidDoBot {
  try {
    $c = Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction Stop |
         Select-Object -First 1
    if (-not $c) { return $null }
    $p = Get-Process -Id $c.OwningProcess -ErrorAction Stop
    if ($p.ProcessName -ne 'node') { return $null }  # outro programa na porta
    return $p.Id
  } catch { return $null }
}

# $true se o painel respondeu de verdade (event loop do Node girando).
function PainelResponde {
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:$Porta/" -TimeoutSec 10 `
      -UseBasicParsing -ErrorAction Stop | Out-Null
    return $true
  } catch { return $false }
}

Escrever "Vigia iniciado (checa a cada ${INTERVALO_S}s)."

$falhas    = 0
$reinicios = 0

while ($true) {
  Start-Sleep -Seconds $INTERVALO_S

  $botPid = PidDoBot
  if (-not $botPid) {
    # Ninguem na porta: o bot foi fechado de proposito. Nada a vigiar.
    Escrever "O bot nao esta mais rodando. Encerrando o vigia."
    break
  }

  if (PainelResponde) { $falhas = 0; continue }

  $falhas++
  Escrever "O bot nao respondeu ($falhas de $FALHAS_P_REINICIO)."
  if ($falhas -lt $FALHAS_P_REINICIO) { continue }

  if ($reinicios -ge $MAX_REINICIOS) {
    Escrever "Ja reiniciei $MAX_REINICIOS vezes e o bot nao se manteve de pe. Parando o vigia para nao ficar em loop - precisa de atencao manual."
    break
  }

  $reinicios++
  Escrever "Bot CONGELADO (respondendo nada ha ~$($FALHAS_P_REINICIO * $INTERVALO_S)s). Reiniciando (tentativa $reinicios de $MAX_REINICIOS)..."

  # /T leva junto o Chrome filho do puppeteer; sem isso a sessao fica presa.
  taskkill /F /T /PID $botPid 2>&1 | Out-Null
  Start-Sleep -Seconds 5

  # O iniciar.bat tem guard de instancia unica e limpa as travas Singleton*,
  # entao relancar por ele e o caminho seguro.
  Start-Process -FilePath (Join-Path $Raiz 'iniciar.bat') -WorkingDirectory $Raiz

  # Da tempo do bot subir (npm/puppeteer/QR) antes de voltar a cobrar resposta.
  Start-Sleep -Seconds 90
  $falhas = 0
}
