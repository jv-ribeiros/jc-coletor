# Instala (ou refaz) o servico do Windows que mantem o sistema no ar sem ninguem logado, com o usuario escolhido.
# -Remover tira o servico e volta a abrir junto com o Windows. Pode rodar de novo quando a senha do usuario mudar.
param([switch]$Remover, [switch]$SemPausa)
$ErrorActionPreference = 'Stop'
$global:ServicoOk = $false
$nome = 'JCColetor'; $raiz = Split-Path $PSScriptRoot -Parent; $exe = Join-Path $PSScriptRoot 'JCColetor.exe'
function Set-Atalho([string]$pasta, [bool]$criar) {
  $f = Join-Path ([Environment]::GetFolderPath($pasta)) 'Operacoes Lieto.lnk'
  if (-not $criar) { Remove-Item $f -Force -ErrorAction SilentlyContinue; return }
  $l = (New-Object -ComObject WScript.Shell).CreateShortcut($f); $l.TargetPath = "$raiz\iniciar.bat"; $l.WorkingDirectory = $raiz; $l.Save()
}
function Stop-Sistema {
  if (Get-Service $nome -ErrorAction SilentlyContinue) { Stop-Service $nome -Force }
  # janela aberta pelo iniciar.bat desta mesma pasta
  Get-NetTCPConnection -State Listen -LocalPort 3090 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
    $p = Get-Process -Id $_ -ErrorAction SilentlyContinue
    if ($p -and $p.Path -eq "$raiz\node.exe") { Stop-Process -Id $p.Id -Force } elseif ($p) { throw "A porta 3090 esta em uso por outro programa ($($p.ProcessName)). Feche e rode de novo." }
  }
  Start-Sleep 1
}
function Remove-Servico {
  if (-not (Get-Service $nome -ErrorAction SilentlyContinue)) { return }
  & sc.exe delete $nome | Out-Null
  for ($i = 0; $i -lt 20 -and (Get-Service $nome -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
  if (Get-Service $nome -ErrorAction SilentlyContinue) { throw 'O servico antigo ainda esta saindo. Feche a janela Servicos do Windows e rode de novo.' }
}
try {
  $adm = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $adm) { throw 'Abra pelo instalar-servico.bat e aceite a permissao de administrador.' }
  if ($Remover) {
    Stop-Sistema; Remove-Servico; Set-Atalho 'CommonStartup' $true
    Start-Process explorer.exe "`"$raiz\iniciar.bat`""
    Write-Host 'Servico removido. O sistema volta a abrir quando alguem entra no Windows.' -ForegroundColor Green
  } else {
    if (-not (Test-Path "$raiz\config.json")) { throw 'Rode primeiro o instalar.bat.' }
    Add-Type -Language CSharp -TypeDefinition @'
using System; using System.ComponentModel; using System.Runtime.InteropServices; using System.Security.Principal;
public static class JcConta {
  [StructLayout(LayoutKind.Sequential)] struct OA { public int Length; public IntPtr Root, Name; public int Attr; public IntPtr Sd, Qos; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct US { public ushort Length, Max; [MarshalAs(UnmanagedType.LPWStr)] public string Buffer; }
  [DllImport("advapi32.dll")] static extern uint LsaOpenPolicy(IntPtr s, ref OA a, int acc, out IntPtr h);
  [DllImport("advapi32.dll")] static extern uint LsaAddAccountRights(IntPtr h, byte[] sid, US[] r, int n);
  [DllImport("advapi32.dll")] static extern int LsaNtStatusToWinError(uint s);
  [DllImport("advapi32.dll")] static extern int LsaClose(IntPtr h);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool LogonUser(string u, string d, IntPtr p, int tipo, int prov, out IntPtr t);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static void LiberarServico(string sid) {
    var s = new SecurityIdentifier(sid); var b = new byte[s.BinaryLength]; s.GetBinaryForm(b, 0);
    var a = new OA(); IntPtr h; uint r = LsaOpenPolicy(IntPtr.Zero, ref a, 0x00000810, out h);
    if (r != 0) throw new Win32Exception(LsaNtStatusToWinError(r));
    try { string n = "SeServiceLogonRight"; r = LsaAddAccountRights(h, b, new US[] { new US { Buffer = n, Length = (ushort)(n.Length * 2), Max = (ushort)(n.Length * 2 + 2) } }, 1); if (r != 0) throw new Win32Exception(LsaNtStatusToWinError(r)); }
    finally { LsaClose(h); }
  }
  // 5 = entrada de servico: prova senha E permissao, do mesmo jeito que o Windows vai usar
  public static int Testar(string u, string d, IntPtr senha, int tipo) { IntPtr t; if (LogonUser(u, d, senha, tipo, 0, out t)) { CloseHandle(t); return 0; } return Marshal.GetLastWin32Error(); }
}
'@
    Write-Host ''; Write-Host 'O servico roda com o seu usuario do Windows, para ter acesso as pastas de rede.'
    $padrao = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    while ($true) {
      $u = Read-Host "Usuario do Windows [$padrao]"; if (-not $u) { $u = $padrao }
      if ($u -notmatch '[\\@]') { $u = "$env:COMPUTERNAME\$u" }
      $u = $u -replace '^\.\\', "$env:COMPUTERNAME\"
      try { $sid = (New-Object Security.Principal.NTAccount $u).Translate([Security.Principal.SecurityIdentifier]).Value } catch { Write-Host "Usuario $u nao encontrado." -ForegroundColor Yellow; continue }
      $senha = Read-Host 'Senha do Windows (nao e o PIN)' -AsSecureString
      if (-not $senha.Length) { Write-Host 'O Windows nao aceita servico com senha vazia.' -ForegroundColor Yellow; continue }
      [JcConta]::LiberarServico($sid)
      if ($u -match '^([^\\]+)\\(.+)$') { $dom = $Matches[1]; $cta = $Matches[2] } else { $dom = $null; $cta = $u }
      $ptr = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($senha)
      try { $cod = [JcConta]::Testar($cta, $dom, $ptr, 5) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($ptr) }
      if ($cod -eq 0) { break }
      Write-Host "Nao foi possivel entrar: $((New-Object ComponentModel.Win32Exception $cod).Message)" -ForegroundColor Yellow
      if ((Read-Host 'Tentar de novo? (S/N)') -notmatch '^[sS]') { throw 'Servico nao instalado.' }
    }
    Stop-Sistema; Remove-Servico
    Remove-Item $exe -Force -ErrorAction SilentlyContinue
    Add-Type -Path (Join-Path $PSScriptRoot 'Servico.cs') -OutputAssembly $exe -OutputType ConsoleApplication -ReferencedAssemblies System.ServiceProcess
    # o usuario precisa gravar em data, logs, config e homologacao
    & icacls $raiz /grant "*${sid}:(OI)(CI)M" /Q | Out-Null
    if ($LASTEXITCODE) { throw "Nao foi possivel liberar a pasta $raiz para $u." }
    New-Service -Name $nome -DisplayName 'JC Coletor (Operacoes Lieto)' -Description 'Mantem o coletor e a gestao no ar.' -BinaryPathName "`"$exe`"" -StartupType Automatic -DependsOn 'LanmanWorkstation' -Credential (New-Object Management.Automation.PSCredential $u, $senha) | Out-Null
    & sc.exe failure $nome reset= 86400 actions= restart/5000/restart/5000/restart/30000 | Out-Null
    Start-Service $nome
    Write-Host 'Abrindo o sistema...'
    $ok = $false
    for ($i = 0; $i -lt 45 -and -not $ok; $i++) { Start-Sleep 2; try { $ok = (Invoke-WebRequest 'http://127.0.0.1:3090/api/info' -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { } }
    if (-not $ok) { Get-Content "$raiz\logs\servico.log" -Tail 15 -ErrorAction SilentlyContinue; throw "O servico foi criado, mas o sistema nao respondeu. Veja $raiz\logs\servico.log" }
    # so agora deixa de abrir junto com o login (senao seriam dois na mesma porta)
    Set-Atalho 'CommonStartup' $false
    $global:ServicoOk = $true
    Write-Host ''; Write-Host "Servico no ar com $u. Continua rodando sem ninguem logado e volta sozinho quando o servidor liga." -ForegroundColor Green
    Get-Content "$raiz\logs\servico.log" -Encoding UTF8 -Tail 40 -ErrorAction SilentlyContinue | Where-Object { $_ -match 'Unidade' } | ForEach-Object { Write-Host "  $_" }
  }
} catch { Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red }
if (-not $SemPausa) { Read-Host 'Enter para fechar' | Out-Null }
