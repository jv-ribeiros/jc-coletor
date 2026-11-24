# Guarda o usuario e a senha de um computador da rede, para o servico abrir as pastas dele (ex.: XML em \\servidor\pasta).
# Fica criptografado pelo Windows para ESTE usuario: precisa ser o mesmo do servico.
param([string]$Caminho)
$ErrorActionPreference = 'Stop'
try {
  $eu = [Security.Principal.WindowsIdentity]::GetCurrent()
  $sv = Get-CimInstance Win32_Service -Filter "Name='JCColetor'" -ErrorAction SilentlyContinue
  if ($sv) {
    $conta = $sv.StartName -replace '^\.\\', "$env:COMPUTERNAME\"
    $sid = (New-Object Security.Principal.NTAccount $conta).Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -ne $eu.User.Value) { throw "O servico roda com $conta, e voce esta com $($eu.Name). Entre no Windows com $conta e rode de novo." }
  }
  Add-Type -AssemblyName System.Security
  Add-Type -Language CSharp -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class JcRede {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct NR { public int a, dwType, c, d; public string local, remoto, e, f; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct CRED { public int Flags, Type; public string Target, Comment; public long Last; public int Size; public IntPtr Blob; public int Persist, Count; public IntPtr Attr; public string Alias, User; }
  [DllImport("mpr.dll", CharSet = CharSet.Unicode)] static extern int WNetAddConnection2(ref NR r, string s, string u, int f);
  [DllImport("mpr.dll", CharSet = CharSet.Unicode)] static extern int WNetCancelConnection2(string n, int f, bool forca);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredWrite(ref CRED c, int f);
  public static int Ligar(string remoto, string u, string s) { var r = new NR { dwType = 0, remoto = remoto }; return WNetAddConnection2(ref r, s, u, 0); }
  public static void Desligar(string remoto) { WNetCancelConnection2(remoto, 0, true); }
  public static int Guardar(string alvo, string u, string s) {
    IntPtr p = Marshal.StringToCoTaskMemUni(s);
    try { var c = new CRED { Type = 2, Target = alvo, User = u, Blob = p, Size = s.Length * 2, Persist = 3 }; return CredWrite(ref c, 0) ? 0 : Marshal.GetLastWin32Error(); }
    finally { Marshal.ZeroFreeCoTaskMemUnicode(p); }
  }
}
'@
  Write-Host 'Acesso a uma pasta de rede. Use o mesmo usuario e senha que abrem a pasta no Windows.'
  while (-not $Caminho) { $Caminho = Read-Host 'Pasta de rede (ex.: \\servidor\pasta)' }
  $Caminho = $Caminho.Trim().Trim('"')
  if ($Caminho -notmatch '^\\\\([A-Za-z0-9._-]+)(\\.*)?$') { throw 'Informe no formato \\servidor\pasta' }
  $srv = $Matches[1]
  $u = ''; while (-not $u) { $u = (Read-Host "Usuario em $srv").Trim() }
  if ($u -notmatch '[\\@]') { $u = "$srv\$u" }
  $sec = Read-Host "Senha de $u" -AsSecureString
  $senha = (New-Object Management.Automation.PSCredential 'x', $sec).GetNetworkCredential().Password

  $cod = [JcRede]::Ligar("\\$srv\IPC$", $u, $senha)
  if ($cod -eq 1219) { [JcRede]::Desligar("\\$srv\IPC$"); $cod = [JcRede]::Ligar("\\$srv\IPC$", $u, $senha) }
  if ($cod -eq 1219) { Write-Host "Ja existe uma conexao aberta com $srv neste Windows, entao nao deu para testar a senha agora. Vou guardar assim mesmo." -ForegroundColor Yellow }
  elseif ($cod -ne 0) { throw "$srv recusou: $((New-Object ComponentModel.Win32Exception $cod).Message) Nada foi guardado." }

  $d = Join-Path $PSScriptRoot 'rede'; New-Item -ItemType Directory -Force $d | Out-Null
  $bytes = [Text.Encoding]::UTF8.GetBytes("$u`n$senha")
  [IO.File]::WriteAllBytes((Join-Path $d "$($srv.ToLower()).bin"), [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser'))
  $c = [JcRede]::Guardar($srv, $u, $senha)
  if ($c -ne 0) { Write-Host "Aviso: o Gerenciador de Credenciais nao aceitou ($((New-Object ComponentModel.Win32Exception $c).Message))." -ForegroundColor Yellow }
  Remove-Variable senha, bytes
  Write-Host "Acesso a $srv guardado." -ForegroundColor Green
  if ($Caminho -match '^\\\\[^\\]+\\[^\\]') {
    try { $n = [IO.Directory]::GetFileSystemEntries($Caminho).Count; Write-Host "Abri $Caminho ($n itens)." -ForegroundColor Green }
    catch { Write-Host "O acesso foi guardado, mas a pasta nao abriu: $($_.Exception.InnerException.Message)" -ForegroundColor Yellow }
  }
  if ($sv) {
    Write-Host 'Reiniciando o servico...'
    Restart-Service JCColetor -Force; Start-Sleep 4
    Get-Content (Join-Path (Split-Path $PSScriptRoot -Parent) 'logs\servico.log') -Encoding UTF8 -Tail 25 -ErrorAction SilentlyContinue | Where-Object { $_ -match 'Rede |Unidade ' } | ForEach-Object { Write-Host "  $_" }
  }
} catch { Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red }
Read-Host 'Enter para fechar' | Out-Null
