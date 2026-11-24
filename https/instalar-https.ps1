# HTTPS local com autoridade propria (sem dominio), em qualquer servidor. Abra pelo instalar-https.bat.
# Pode rodar de novo (ex.: o IP mudou): o certificado dos coletores e mantido.
param([string]$Ip, [switch]$SemPausa)
$ErrorActionPreference = 'Stop'
try {
  $adm = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $adm) { throw 'Abra pelo instalar-https.bat e aceite a permissao de administrador.' }
  $caddy = Join-Path $PSScriptRoot 'caddy.exe'
  if (-not (Test-Path $caddy)) { throw "Falta o caddy.exe em $PSScriptRoot. Rode o instalar.bat de novo." }

  $ips = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' })
  if (-not $Ip) {
    if (-not $ips.Count) { throw 'Este computador esta sem rede.' }
    if ($ips.Count -eq 1) { $Ip = $ips[0].IPAddress }
    else {
      Write-Host 'Qual o endereco da rede dos coletores?'
      for ($i = 0; $i -lt $ips.Count; $i++) { Write-Host "  $($i + 1) - $($ips[$i].IPAddress)   ($($ips[$i].InterfaceAlias))" }
      do { $n = Read-Host 'Numero' } until ($n -match '^\d{1,2}$' -and [int]$n -ge 1 -and [int]$n -le $ips.Count)
      $Ip = $ips[[int]$n - 1].IPAddress
    }
  }
  $meu = $ips | Where-Object { $_.IPAddress -eq $Ip }
  if (-not $meu) { throw "O IP $Ip nao e deste computador." }
  if ($meu.PrefixOrigin -eq 'Dhcp') { Write-Warning 'IP automatico (DHCP). Fixe no Windows ou reserve no roteador: se mudar, rode este instalador de novo.' }

  if (Get-Service LietoHttps -ErrorAction SilentlyContinue) { Stop-Service LietoHttps -Force; & sc.exe delete LietoHttps | Out-Null; Start-Sleep 2 }
  # 443/80 podem estar com outro programa: usa a proxima livre
  function Get-PortaLivre([int[]]$portas) { foreach ($x in $portas) { if (-not (Get-NetTCPConnection -State Listen -LocalPort $x -ErrorAction SilentlyContinue)) { return $x } }; throw "Portas $($portas -join ', ') em uso." }
  $ps = Get-PortaLivre 443, 8443, 9443; $ph = Get-PortaLivre 80, 8080, 9080
  $us = "https://$Ip"; if ($ps -ne 443) { $us += ":$ps" }
  $uh = "http://$Ip"; if ($ph -ne 80) { $uh += ":$ph" }

  $dados = Join-Path $PSScriptRoot 'dados'; $pub = Join-Path $PSScriptRoot 'publico'; $conf = Join-Path $PSScriptRoot 'Caddyfile'
  New-Item -ItemType Directory -Force $dados, $pub | Out-Null
  # a chave da autoridade fica em "dados": so SYSTEM e administradores (por SID, vale em qualquer idioma)
  & icacls $dados /inheritance:r /grant '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE) { throw 'Nao foi possivel proteger a pasta dados.' }
  $d = $dados -replace '\\', '/'; $p = $pub -replace '\\', '/'
  $texto = @"
{
	admin off
	skip_install_trust
	auto_https disable_redirects
	storage file_system "$d"
	default_sni $Ip
}
$us {
	tls internal
	reverse_proxy 127.0.0.1:3090
}
$uh {
	handle /lieto.crt {
		root * "$p"
		header Content-Type application/x-x509-ca-cert
		file_server
	}
	handle {
		redir $us{uri}
	}
}
"@
  [IO.File]::WriteAllText($conf, ($texto -replace "`r", ''), (New-Object Text.UTF8Encoding $false))
  # o Caddy escreve avisos no canal de erro: nao e falha, quem decide e o codigo de saida
  $ErrorActionPreference = 'Continue'
  $saida = & $caddy validate --config $conf --adapter caddyfile 2>&1 | Out-String
  $ruim = $LASTEXITCODE; $ErrorActionPreference = 'Stop'
  if ($ruim) { throw "Configuracao invalida: $saida" }

  New-Service -Name LietoHttps -DisplayName 'Lieto HTTPS (Caddy)' -StartupType Automatic -BinaryPathName "`"$caddy`" run --config `"$conf`" --adapter caddyfile" | Out-Null
  Get-NetFirewallRule -DisplayName 'Lieto HTTPS' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop
  New-NetFirewallRule -DisplayName 'Lieto HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $ph, $ps -RemoteAddress LocalSubnet -ErrorAction Stop | Out-Null
  Start-Service LietoHttps
  $raiz = Join-Path $dados 'pki\authorities\local\root.crt'
  for ($i = 0; $i -lt 30 -and -not (Test-Path $raiz); $i++) { Start-Sleep 1 }
  if (-not (Test-Path $raiz)) { throw 'O certificado nao foi criado. Veja o servico LietoHttps.' }
  Copy-Item $raiz (Join-Path $pub 'lieto.crt') -Force
  Write-Host ''; Write-Host 'HTTPS pronto.' -ForegroundColor Green
  Write-Host "  Certificado para os coletores: $uh/lieto.crt"
  Write-Host "  Sistema: $us/coletor"
} catch { Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red }
if (-not $SemPausa) { Read-Host 'Enter para fechar' }
