# Atualiza so o sistema ja instalado: para, troca os arquivos e religa. Nao toca em config.json, data nem homologacao.
param([string]$Destino = 'C:\JC\Coletor de Dados')
$ErrorActionPreference = 'Stop'
$trocou = $false; $sv = $null
function Stop-Sistema {
  if ($sv) { Stop-Service JCColetor -Force }
  Get-NetTCPConnection -State Listen -LocalPort 3090 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
    $p = Get-Process -Id $_ -ErrorAction SilentlyContinue
    if ($p -and $p.Path -eq "$Destino\node.exe") { Stop-Process -Id $p.Id -Force } elseif ($p) { throw "A porta 3090 esta em uso por outro programa ($($p.ProcessName))." }
  }
  Start-Sleep 1
}
function Start-Sistema { if ($sv) { Start-Service JCColetor } else { Start-Process explorer.exe "`"$Destino\iniciar.bat`"" } }
try {
  $adm = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $adm) { throw 'Abra pelo atualizar.bat e aceite a permissao de administrador.' }
  $origem = Join-Path $PSScriptRoot 'app'
  if (-not (Test-Path "$origem\.next\BUILD_ID")) { throw 'Extraia o zip inteiro antes.' }
  if (-not (Test-Path "$Destino\config.json") -or -not (Test-Path "$Destino\node.exe")) { throw "O sistema nao esta instalado em $Destino. Use o jc-coletor-instalador.zip na primeira vez." }
  $novo = Get-Content "$origem\package.json" -Raw | ConvertFrom-Json; $atual = Get-Content "$Destino\package.json" -Raw | ConvertFrom-Json
  if (($novo.dependencies | ConvertTo-Json -Compress) -ne ($atual.dependencies | ConvertTo-Json -Compress)) { throw 'Esta versao precisa do instalador completo (jc-coletor-instalador.zip).' }
  Write-Host "Atualizando de $($atual.version) para $($novo.version) em $Destino"
  $sv = Get-Service JCColetor -ErrorAction SilentlyContinue
  Stop-Sistema
  try {
    if (Test-Path "$Destino\.next.anterior") { Remove-Item "$Destino\.next.anterior" -Recurse -Force }
    Rename-Item "$Destino\.next" '.next.anterior'; $trocou = $true
    & robocopy $origem $Destino /E /R:2 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar (robocopy $LASTEXITCODE)." }
    if ($sv) {
      Add-Type -Path "$Destino\servico\Servico.cs" -OutputAssembly "$Destino\servico\novo.exe" -OutputType ConsoleApplication -ReferencedAssemblies System.ServiceProcess, System.Security
      Move-Item "$Destino\servico\novo.exe" "$Destino\servico\JCColetor.exe" -Force
    }
    Start-Sistema
    Write-Host 'Conferindo se abriu...'
    $ok = $false
    for ($i = 0; $i -lt 30 -and -not $ok; $i++) { Start-Sleep 2; try { $ok = (Invoke-WebRequest 'http://127.0.0.1:3090/api/info' -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { } }
    if (-not $ok) { throw 'O sistema nao respondeu na versao nova.' }
  } catch {
    $motivo = $_.Exception.Message
    if ($trocou) {
      Write-Host 'Nao deu certo: voltando para a versao anterior...' -ForegroundColor Yellow
      try { Stop-Sistema } catch { }
      if (Test-Path "$Destino\.next") { Remove-Item "$Destino\.next" -Recurse -Force }
      Rename-Item "$Destino\.next.anterior" '.next'
    }
    Start-Sistema
    throw $motivo
  }
  Remove-Item "$Destino\.next.anterior" -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Atualizado para $($novo.version)." -ForegroundColor Green
} catch { Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red }
Read-Host 'Enter para fechar' | Out-Null
