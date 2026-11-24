# Baixa a ultima versao publicada, confere o arquivo e atualiza. Aberto pelo atualizar.bat da pasta do sistema.
$ErrorActionPreference = 'Stop'
$destino = if ($PSScriptRoot) { $PSScriptRoot } else { 'C:\JC\Coletor de Dados' }
$tmp = $null
try {
  $adm = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $adm) { throw 'Abra como administrador.' }
  if (-not (Test-Path "$destino\config.json")) { throw "O sistema nao esta instalado em $destino." }
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $ProgressPreference = 'SilentlyContinue'
  Write-Host 'Procurando a ultima versao...'
  $rel = Invoke-RestMethod 'https://api.github.com/repos/jv-ribeiros/jc-coletor/releases/latest' -UseBasicParsing
  $atual = (Get-Content "$destino\package.json" -Raw | ConvertFrom-Json).version; $nova = $rel.tag_name -replace '^v', ''
  if ([version]$atual -ge [version]$nova) { Write-Host "Ja esta na ultima versao ($atual)." -ForegroundColor Green; Read-Host 'Enter para fechar' | Out-Null; return }
  $arq = $rel.assets | Where-Object { $_.name -eq 'jc-coletor-atualizacao.zip' } | Select-Object -First 1
  if (-not $arq -or $arq.digest -notmatch '^sha256:[0-9a-f]{64}$') { throw "A versao $nova nao tem pacote de atualizacao." }
  $tmp = Join-Path $env:TEMP ('jc-' + [guid]::NewGuid().ToString('N')); New-Item -ItemType Directory $tmp | Out-Null
  Write-Host "Baixando a $nova..."
  Invoke-WebRequest $arq.browser_download_url -OutFile "$tmp\a.zip" -UseBasicParsing
  if ((Get-FileHash "$tmp\a.zip" -Algorithm SHA256).Hash -ne $arq.digest.Substring(7)) { throw 'O arquivo baixado veio diferente do publicado. Nada foi alterado.' }
  Expand-Archive "$tmp\a.zip" "$tmp\a"
  & powershell -NoProfile -ExecutionPolicy Bypass -File "$tmp\a\atualizar.ps1" -Destino $destino
} catch { Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red; Read-Host 'Enter para fechar' | Out-Null }
finally { if ($tmp -and (Test-Path $tmp)) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue } }
