# Instala ou atualiza o Operacoes Lieto em qualquer empresa. Ao atualizar, mantem config.json, data e a homologacao do banco.
param([string]$Destino = 'C:\JC\Coletor de Dados', [switch]$Reconfigurar)
$ErrorActionPreference = 'Stop'
try {
  $adm = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $adm) { throw 'Abra pelo instalar.bat e aceite a permissao de administrador.' }
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Precisa de Windows 64 bits.' }
  $origem = Join-Path $PSScriptRoot 'app'; $antigo = 'C:\LietoOperacoes'
  if (-not (Test-Path "$origem\node.exe")) { throw 'Extraia o zip inteiro antes de instalar.' }
  $sv = Get-Service JCColetor -ErrorAction SilentlyContinue
  if ($sv -and $sv.Status -ne 'Stopped') { Write-Host 'Parando o servico...'; Stop-Service JCColetor -Force; Start-Sleep 1 }
  if (Get-NetTCPConnection -State Listen -LocalPort 3090 -ErrorAction SilentlyContinue) { throw 'A porta 3090 esta em uso. Feche o sistema (janela Operacoes Lieto) e rode de novo.' }
  New-Item -ItemType Directory -Force $Destino | Out-Null

  # traz da pasta antiga (a antiga fica intacta); config.json por ultimo: se falhar no meio, a proxima vez refaz
  if ($antigo -ne $Destino -and (Test-Path "$antigo\config.json") -and -not (Test-Path "$Destino\config.json")) {
    Write-Host "Trazendo configuracao e dados de $antigo ..."
    foreach ($x in 'data', 'XML-importadas') { if (Test-Path "$antigo\$x") { & robocopy "$antigo\$x" "$Destino\$x" /E /R:2 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null; if ($LASTEXITCODE -ge 8) { throw "Falha ao trazer $x." } } }
    if (Test-Path "$antigo\ddl-homologado.json") { Copy-Item "$antigo\ddl-homologado.json" $Destino -Force }
    $txt = [IO.File]::ReadAllText("$antigo\config.json").Replace('C:/LietoOperacoes/', ($Destino -replace '\\', '/') + '/')
    [IO.File]::WriteAllText("$Destino\config.json", $txt, (New-Object Text.UTF8Encoding $false))
  }

  # nunca sobrescreve configuracao, dados ou homologacao
  $manter = @()
  if (Test-Path "$Destino\ddl-homologado.json") { $manter = @('/XF', "$origem\ddl-homologado.json") }
  $srv = Get-Service LietoHttps -ErrorAction SilentlyContinue
  $parado = $srv -and $srv.Status -eq 'Running'
  if ($parado) { Stop-Service LietoHttps }
  try {
    Write-Host "Copiando para $Destino ..."
    foreach ($x in '.next', 'src') { if (Test-Path "$Destino\$x") { Remove-Item "$Destino\$x" -Recurse -Force } }
    & robocopy $origem $Destino /E /MT:16 /R:2 /W:2 @manter /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar (robocopy $LASTEXITCODE)." }
  } finally { if ($parado) { Start-Service LietoHttps } }
  New-Item -ItemType Directory -Force "$Destino\data", "$Destino\XML-importadas" | Out-Null

  $pedir = $Reconfigurar -or -not (Test-Path "$Destino\config.json")
  while ($true) {
    if ($pedir) {
      Write-Host ''; Write-Host 'Banco do Lieto (Firebird)'
      $h = Read-Host 'Servidor [127.0.0.1]'; if (-not $h) { $h = '127.0.0.1' }
      $po = Read-Host 'Porta [3050]'; if (-not $po) { $po = '3050' }
      do { $b = Read-Host 'Caminho do banco no servidor (ex.: C:/Lieto/Dados/ERP.FDB)' } until ($b)
      $u = Read-Host 'Usuario [SYSDBA]'; if (-not $u) { $u = 'SYSDBA' }
      $s = Read-Host 'Senha do banco' -AsSecureString
      $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
      try {
        $env:L_HOST = $h; $env:L_PORT = $po; $env:L_DB = ($b -replace '\\', '/'); $env:L_USER = $u; $env:L_PASS = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        & "$Destino\node.exe" "$Destino\configurar.js"; if ($LASTEXITCODE) { throw 'Nao foi possivel gravar o config.json.' }
      } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); Remove-Item Env:L_HOST, Env:L_PASS -ErrorAction SilentlyContinue }
    }
    Write-Host 'Testando a conexao com o Lieto (so consulta)...'
    & "$Destino\node.exe" "$Destino\testar-conexao.js"
    if (-not $LASTEXITCODE) { break }
    if ((Read-Host 'Sem conexao. Informar os dados do banco de novo? (S/N)') -notmatch '^[sS]') { throw 'Sem conexao com o Lieto. Nada foi iniciado.' }
    $pedir = $true
  }

  # administradores: cada empresa tem os seus
  while ($Reconfigurar -or -not @((Get-Content "$Destino\config.json" -Raw | ConvertFrom-Json).admins | Where-Object { $_ }).Count) {
    Write-Host ''; & "$Destino\node.exe" "$Destino\testar-conexao.js" funcionarios
    $env:L_ADMINS = (Read-Host 'Codigos dos administradores (ex.: 1,2)') + ' '
    & "$Destino\node.exe" "$Destino\configurar.js"
    if (-not $LASTEXITCODE) { break }
  }
  Remove-Item Env:L_ADMINS -ErrorAction SilentlyContinue

  if (-not (Get-NetFirewallRule -DisplayName 'Operacoes Lieto 3090' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName 'Operacoes Lieto 3090' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3090 -RemoteAddress LocalSubnet -ErrorAction Stop | Out-Null }
  # abre sozinho quando alguem entra no Windows (com o servico instalado, quem abre e o servico)
  $w = New-Object -ComObject WScript.Shell
  foreach ($p in $(if ($sv) { 'CommonDesktopDirectory' } else { 'CommonStartup', 'CommonDesktopDirectory' })) { $l = $w.CreateShortcut((Join-Path ([Environment]::GetFolderPath($p)) 'Operacoes Lieto.lnk')); $l.TargetPath = "$Destino\iniciar.bat"; $l.WorkingDirectory = $Destino; $l.Save() }
  if ($sv) { Start-Service JCColetor; $sv = $null; $comServico = $true }
  elseif ((Read-Host 'Deixar como servico, rodando sem ninguem logado? (S/N) [S]') -notmatch '^[nN]') { & "$Destino\servico\instalar-servico.ps1" -SemPausa; $comServico = $global:ServicoOk -or (Get-Service JCColetor -ErrorAction SilentlyContinue) }
  if (-not $comServico) { Start-Process explorer.exe "`"$Destino\iniciar.bat`"" }
  Write-Host ''; Write-Host "Instalado em $Destino" -ForegroundColor Green
  Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' } | ForEach-Object { Write-Host "  http://$($_.IPAddress):3090   ($($_.InterfaceAlias))" }
  if (-not $srv -and (Read-Host 'Instalar o HTTPS agora? (S/N) [N]') -match '^[sS]') { & "$Destino\https\instalar-https.ps1" -SemPausa }
} catch {
  Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
  # falhou antes de terminar: nao deixa o servico parado
  if ($sv -and (Test-Path "$Destino\.next\BUILD_ID")) { Start-Service JCColetor -ErrorAction SilentlyContinue }
}
Read-Host 'Enter para fechar'
