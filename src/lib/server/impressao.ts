// Impressoras (Sistema › Impressoras) e o adesivo de volume — design/pages/impressoras_v1.html.
// O servidor monta a etiqueta pronta em ZPL e manda:
//   PC   = a Zebra no USB de outro computador, compartilhada no Windows dele: copy /b para \\PC\fila (o PC só repassa; precisa estar ligado).
//   REDE = impressora com IP: direto na porta (9100).
// Senha de PC nunca vai para o banco: fica no cofre do Windows do usuário do serviço (DPAPI em servico\rede\<pc>.bin e Gerenciador de
// Credenciais), como o acesso-rede.bat. Imprimir nunca trava a conferência: ela já gravou no Lieto antes e a falha volta como aviso.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { db } from "./db";
import { Erro, agora, evento, type Usuario } from "./comum";
import { comConexao, consultar, num, txt } from "./fb";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Config = { nome: string; onde: "PC" | "REDE"; pc: string; fila: string; ip: string; porta: number; tipo: "ZPL" | "A4"; dpi: number; largura: number; altura: number };
export type Impressora = Config & { id: number; ultimo_em: string | null; ultimo_ok: number | null; ultimo_msg: string | null };

const servico = () => `${os.hostname()}\\${os.userInfo().username}`;
const caminho = (i: Config) => (i.onde === "PC" ? `\\\\${i.pc}\\${i.fila}` : `${i.ip}:${i.porta}`);
function lerImp(id: number) {
  const x = db().prepare("SELECT * FROM impressoras WHERE id = ?").get(id) as Impressora | undefined;
  if (!x) throw new Erro("Impressora não encontrada.", 404);
  return x;
}

// ---------- cadastro ----------
export function adesivoCfg(): { impressora: number | null; auto: boolean } {
  try {
    const v = JSON.parse((db().prepare("SELECT valor FROM opcoes WHERE chave = 'impressao.adesivo'").get() as Row | undefined)?.valor || "{}");
    return { impressora: Number(v.impressora) || null, auto: v.auto !== false };
  } catch { return { impressora: null, auto: true }; }
}
const gravarAdesivo = (v: { impressora: number | null; auto: boolean }) =>
  db().prepare("INSERT INTO opcoes (chave, valor) VALUES ('impressao.adesivo', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(JSON.stringify(v));

export function lista() {
  const imps = db().prepare("SELECT * FROM impressoras ORDER BY nome").all() as Impressora[], ad = adesivoCfg();
  return {
    impressoras: imps.map((i) => ({ ...i, caminho: caminho(i) })),
    adesivo: { ...ad, nome: imps.find((i) => i.id === ad.impressora)?.nome || null },
    recentes: db().prepare("SELECT em, nome, oque, n, ok, msg, usuario FROM impressoes ORDER BY id DESC LIMIT 8").all(),
    servico: servico(),
  };
}

const NOME_PC = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
function validar(b: Row): Config {
  const nome = String(b.nome || "").trim().slice(0, 60);
  if (!nome) throw new Erro("Dê um nome à impressora.");
  const onde = b.onde === "REDE" ? "REDE" : "PC", tipo = b.tipo === "A4" ? "A4" : "ZPL";
  let pc = "", fila = "", ip = "", porta = 9100;
  if (onde === "PC") {
    pc = String(b.pc || "").trim().replace(/^\\+/, "").toUpperCase(); fila = String(b.fila || "").trim();
    if (!NOME_PC.test(pc)) throw new Erro("Nome do computador inválido. Use só o nome dele, ex.: EXPEDICAO-PC.");
    if (!fila || /[\\/"]/.test(fila)) throw new Erro("Escolha a impressora compartilhada no computador (Procurar).");
  } else {
    ip = String(b.ip || "").trim(); porta = Math.trunc(Number(b.porta) || 9100);
    if (!/^[A-Za-z0-9.-]{1,253}$/.test(ip)) throw new Erro("IP inválido.");
    if (porta < 1 || porta > 65535) throw new Erro("Porta inválida.");
  }
  const dpi = [203, 300, 600].includes(Number(b.dpi)) ? Number(b.dpi) : 203, largura = Number(b.largura) || 100, altura = Number(b.altura) || 62;
  if (tipo === "ZPL" && (largura < 30 || largura > 120 || altura < 20 || altura > 200)) throw new Erro("Tamanho da etiqueta fora do normal (largura de 30 a 120 mm, altura de 20 a 200 mm).");
  return { nome, onde, pc, fila, ip, porta, tipo, dpi, largura, altura };
}

export async function salvar(b: Row, u: Usuario) {
  const v = validar(b), id = Number(b.id) || 0;
  // compartilhamento que não é de impressora (uma pasta) receberia o arquivo em vez de imprimir: só salva o que o PC lista como impressora
  if (v.onde === "PC") {
    const r = await procurar(v.pc);
    if (r.erro) throw new Erro(r.erro);
    if (!r.filas!.some((f) => f.nome.toLowerCase() === v.fila.toLowerCase())) throw new Erro(`Não há impressora "${v.fila}" compartilhada em ${v.pc}. Clique em Procurar de novo.`);
  }
  const campos = [v.nome, v.onde, v.pc, v.fila, v.ip, v.porta, v.tipo, v.dpi, v.largura, v.altura, u.nome, agora()];
  let novo = id;
  if (id) { lerImp(id); db().prepare("UPDATE impressoras SET nome=?, onde=?, pc=?, fila=?, ip=?, porta=?, tipo=?, dpi=?, largura=?, altura=?, por=?, em=? WHERE id = ?").run(...campos, id); }
  else {
    novo = Number(db().prepare("INSERT INTO impressoras (nome, onde, pc, fila, ip, porta, tipo, dpi, largura, altura, por, em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(...campos).lastInsertRowid);
    if (v.tipo === "ZPL" && !adesivoCfg().impressora) gravarAdesivo({ impressora: novo, auto: adesivoCfg().auto }); // a 1ª Zebra já vira a do adesivo
  }
  evento("impressao", novo, u, id ? "ALTEROU IMPRESSORA" : "CADASTROU IMPRESSORA", `${v.nome} · ${caminho(v)}`);
  return lista();
}
export function excluir(id: number, u: Usuario) {
  const i = lerImp(id);
  db().prepare("DELETE FROM impressoras WHERE id = ?").run(id);
  const ad = adesivoCfg(); if (ad.impressora === id) gravarAdesivo({ impressora: null, auto: ad.auto });
  evento("impressao", id, u, "EXCLUIU IMPRESSORA", `${i.nome} · ${caminho(i)}`);
  return lista();
}
export function salvarAdesivo(b: Row, u: Usuario) {
  const imp = Number(b.impressora) || null;
  if (imp && lerImp(imp).tipo !== "ZPL") throw new Erro("O adesivo sai em impressora de etiqueta (Zebra).");
  gravarAdesivo({ impressora: imp, auto: b.auto !== false });
  evento("impressao", imp || 0, u, "ADESIVO DE VOLUME", { impressora: imp, auto: b.auto !== false });
  return lista();
}

// ---------- Windows: impressoras compartilhadas de um PC e o cofre da senha (PowerShell, segredo só pelo stdin) ----------
const PS = String.raw`$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$d = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Security
Add-Type -Language CSharp -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class JcImp {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct SI1 { public string nome; public uint tipo; public string obs; }
  [DllImport("Netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetShareEnum(string srv, int nivel, out IntPtr buf, int max, out int lidos, out int total, ref int resume);
  [DllImport("Netapi32.dll")] static extern int NetApiBufferFree(IntPtr b);
  public static int Filas(string srv, List<string> l) {
    IntPtr b; int lidos, total, r = 0;
    int c = NetShareEnum(srv, 1, out b, -1, out lidos, out total, ref r);
    if (c != 0) return c;
    try { int t = Marshal.SizeOf(typeof(SI1)); for (int i = 0; i < lidos; i++) { var s = (SI1)Marshal.PtrToStructure(new IntPtr(b.ToInt64() + (long)i * t), typeof(SI1)); if ((s.tipo & 0xFF) == 1) { l.Add(s.nome); l.Add(s.obs ?? ""); } } }
    finally { NetApiBufferFree(b); }
    return 0;
  }
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
function Msg($c) { (New-Object ComponentModel.Win32Exception ([int]$c)).Message }
$r = @{ codigo = 0 }
if ($d.acao -eq 'procurar') {
  $l = New-Object 'System.Collections.Generic.List[string]'
  $c = [JcImp]::Filas('\\' + $d.pc, $l)
  $r.codigo = $c
  if ($c -ne 0) { $r.mensagem = Msg $c } else { $f = @(); for ($i = 0; $i -lt $l.Count; $i += 2) { $f += @{ nome = $l[$i]; obs = $l[$i + 1] } }; $r.filas = $f }
} elseif ($d.acao -eq 'acesso') {
  $alvo = '\\' + $d.pc + '\IPC$'
  $c = [JcImp]::Ligar($alvo, $d.usuario, $d.senha)
  if ($c -eq 1219) { [JcImp]::Desligar($alvo); $c = [JcImp]::Ligar($alvo, $d.usuario, $d.senha) }
  if ($c -ne 0 -and $c -ne 1219) { $r.codigo = $c; $r.mensagem = Msg $c }
  else {
    New-Item -ItemType Directory -Force $d.pasta | Out-Null
    $b = [Text.Encoding]::UTF8.GetBytes($d.usuario + [char]10 + $d.senha)
    [IO.File]::WriteAllBytes((Join-Path $d.pasta ($d.pc.ToLower() + '.bin')), [Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'))
    $g = [JcImp]::Guardar($d.pc, $d.usuario, $d.senha)
    if ($g -ne 0) { $r.aviso = 'O Gerenciador de Credenciais nao aceitou: ' + (Msg $g) }
    if ($c -eq 1219) { $r.aviso = 'Ja havia uma conexao aberta com ' + $d.pc + ', entao a senha foi guardada sem testar.' }
  }
}
$r | ConvertTo-Json -Compress -Depth 4
`;
function powershell(dados: Row): Promise<Row> {
  if (process.platform !== "win32") return Promise.reject(new Erro("Impressora compartilhada só funciona com o servidor no Windows."));
  return new Promise((ok, falha) => {
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(PS, "utf16le").toString("base64")], { windowsHide: true });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => p.kill(), 40000);
    p.on("error", (e) => { clearTimeout(t); falha(new Erro(`Não consegui abrir o PowerShell: ${e.message}`)); });
    p.on("close", () => {
      clearTimeout(t);
      try { ok(JSON.parse(out.trim().split(/\r?\n/).pop() || "")); } catch { falha(new Erro(`O Windows não respondeu como esperado: ${(err || out).trim().slice(0, 300) || "sem resposta"}`)); }
    });
    p.stdin.end(JSON.stringify(dados));
  });
}

const SENHA = new Set([5, 86, 1326, 1327, 1330, 1331, 1907, 1909]), FORA = new Set([51, 53, 64, 67, 1231, 1722, 2250]);
export async function procurar(pcBruto: unknown): Promise<{ filas?: { nome: string; obs: string }[]; erro?: string; precisaSenha?: boolean; servico: string }> {
  const pc = String(pcBruto || "").trim().replace(/^\\+/, "").toUpperCase();
  if (!NOME_PC.test(pc)) throw new Erro("Informe só o nome do computador, ex.: EXPEDICAO-PC.");
  const r = await powershell({ acao: "procurar", pc });
  if (!r.codigo) return { filas: (r.filas || []) as { nome: string; obs: string }[], servico: servico() };
  if (SENHA.has(r.codigo)) return { erro: `${pc} recusou o usuário do servidor (${servico()}). Informe um usuário e senha daquele computador.`, precisaSenha: true, servico: servico() };
  if (FORA.has(r.codigo)) return { erro: `${pc} não respondeu: está desligado, fora da rede, ou o nome está errado.`, servico: servico() };
  return { erro: `${pc}: ${r.mensagem || `erro ${r.codigo}`}`, servico: servico() };
}
export async function acesso(b: Row, u: Usuario) {
  const pc = String(b.pc || "").trim().replace(/^\\+/, "").toUpperCase(), senha = String(b.senha ?? "");
  let usuario = String(b.usuario || "").trim();
  if (!NOME_PC.test(pc)) throw new Erro("Nome do computador inválido.");
  if (!usuario || !senha) throw new Erro("Informe o usuário e a senha daquele computador.");
  if (!/[\\@]/.test(usuario)) usuario = `${pc}\\${usuario}`;
  const r = await powershell({ acao: "acesso", pc, usuario, senha, pasta: path.join(process.cwd(), "servico", "rede") });
  if (r.codigo) throw new Erro(`${pc} recusou: ${r.mensagem || `erro ${r.codigo}`} Nada foi guardado.`);
  evento("impressao", 0, u, "GUARDOU ACESSO A COMPUTADOR", `${pc} · ${usuario}`); // a senha não vai para o registro
  return { ...(await procurar(pc)), aviso: r.aviso || "" };
}

// ---------- envio ----------
const alcanca = (host: string, porta: number, ms: number) => new Promise<boolean>((ok) => {
  const s = net.connect({ host, port: porta }), t = setTimeout(() => { s.destroy(); ok(false); }, ms);
  s.on("connect", () => { clearTimeout(t); s.destroy(); ok(true); }); s.on("error", () => { clearTimeout(t); ok(false); });
});
const enviarRede = (ip: string, porta: number, dados: Buffer) => new Promise<void>((ok, falha) => {
  const s = net.connect({ host: ip, port: porta });
  s.setTimeout(8000);
  s.on("connect", () => s.end(dados));
  s.on("timeout", () => { s.destroy(); falha(new Erro(`${ip} não respondeu na porta ${porta}. A impressora desligou ou trocou de IP?`)); });
  s.on("error", (e) => falha(new Erro(`${ip} não respondeu na porta ${porta} (${(e as NodeJS.ErrnoException).code || e.message}). A impressora desligou ou trocou de IP?`)));
  s.on("close", (comErro) => { if (!comErro) ok(); });
});
// a resposta do cmd vem na página de código do console (850)
const CP850 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00AD±‗¾¶§÷¸°¨·¹³²■\u00A0";
const oem = (b: Buffer) => [...b].map((c) => (c < 128 || CP850.length !== 128 ? String.fromCharCode(c) : CP850[c - 128])).join("");
const copiar = (arq: string, destino: string) => new Promise<void>((ok, falha) =>
  execFile("cmd.exe", ["/d", "/c", "copy", "/b", arq, destino], { windowsHide: true, timeout: 45000, encoding: "buffer" }, (e, out, err) =>
    (e ? falha(new Error((oem(err as Buffer) + " " + oem(out as Buffer)).replace(/\s+/g, " ").trim() || e.message)) : ok())));

async function enviar(i: Config, conteudo: string) {
  const buf = Buffer.from(conteudo, "utf8");
  if (i.onde === "REDE") return enviarRede(i.ip, i.porta, buf);
  if (!(await alcanca(i.pc, 445, 4000))) throw new Erro(`${i.pc} não respondeu. O computador da impressora está ligado e na rede?`);
  const arq = path.join(os.tmpdir(), `jc-impressao-${process.pid}-${Date.now()}.zpl`);
  fs.writeFileSync(arq, buf);
  try { await copiar(arq, caminho(i)); }
  catch (e) {
    let motivo = "";
    try {
      const r = await procurar(i.pc);
      motivo = r.erro ? r.erro : !r.filas!.some((f) => f.nome.toLowerCase() === i.fila.toLowerCase()) ? `Não há impressora "${i.fila}" compartilhada em ${i.pc}. Clique em Procurar de novo.` : "";
    } catch { /* fica a mensagem do Windows */ }
    throw new Erro(motivo || `O Windows não entregou em ${caminho(i)}: ${(e as Error).message}`);
  } finally { fs.rmSync(arq, { force: true }); }
}
function registrar(i: Impressora | null, nome: string, oque: string, n: number, erro: string | null, u: Usuario | null) {
  db().prepare("INSERT INTO impressoes (em, impressora, nome, oque, n, ok, msg, usuario) VALUES (?,?,?,?,?,?,?,?)").run(agora(), i?.id ?? null, nome, oque, n, erro ? 0 : 1, erro, u?.nome ?? "SISTEMA");
  if (i) db().prepare("UPDATE impressoras SET ultimo_em = ?, ultimo_ok = ?, ultimo_msg = ? WHERE id = ?").run(agora(), erro ? 0 : 1, erro || oque, i.id);
}

// ---------- ZPL ----------
// medidas em mm, convertidas para pontos pela resolução; fonte 0 (a escalável que toda Zebra tem), ^CI28 = UTF-8
const zs = (s: string) => s.replace(/[\^~\\]/g, " ").replace(/\s+/g, " ").trim();
const LARG = 0.58; // largura média de uma letra da fonte 0, em alturas
function etiqueta(i: Config, corpo: (d: (mm: number) => number) => string) {
  const d = (mm: number) => Math.max(1, Math.round((mm * i.dpi) / 25.4));
  return `^XA^CI28^PW${d(i.largura)}^LL${d(i.altura)}^LH0,0${corpo(d)}^XZ\n`;
}
const texto = (d: (mm: number) => number, x: number, y: number, h: number, larg: number, s: string, linhas = 1, al = "L", inverso = false) =>
  `^FO${d(x)},${d(y)}${inverso ? "^FR" : ""}^A0N,${d(h)},${d(h)}^FB${d(larg)},${linhas},0,${al},0^FD${s}^FS`;
// a maior letra que cabe; se nem a menor couber, corta
function caber(s: string, larg: number, alturas: number[], linhas: number) {
  const h = alturas.find((a) => s.length * LARG * a <= larg * linhas) ?? alturas[alturas.length - 1];
  return { h, s: s.slice(0, Math.floor((larg * linhas) / (LARG * h))) };
}

type Adesivo = { pedido: number; volumes: number; empresa: string; razao: string; cidadeEmp: string; cliente: string; endereco: string; cidade: string };
// o desenho da foto: cabeçalho da empresa numa caixa, cliente, endereço, documento, o volume em branco na caixa preta e a cidade grande
function adesivoZpl(i: Config, a: Adesivo, vol: number, total: number) {
  const L = i.largura, A = i.altura, m = 2.5, w = L - 2 * m;
  return etiqueta(i, (d) => {
    let z = `^FO${d(m)},${d(m)}^GB${d(w)},${d(15)},${d(0.5)},B,1^FS`;
    const e = caber(zs(a.empresa).toUpperCase(), w - 4, [4.6, 4, 3.4], 1);
    z += texto(d, m + 2, m + 2, e.h, w - 4, e.s);
    z += texto(d, m + 2, m + 7.6, 2.6, w - 4, caber(zs(a.razao).toUpperCase(), w - 4, [2.6], 1).s);
    z += texto(d, m + 2, m + 11, 2.6, w - 4, caber(zs(a.cidadeEmp).toUpperCase(), w - 4, [2.6], 1).s);
    let y = m + 16.2;
    z += texto(d, m, y, 2.3, w, "CLIENTE"); y += 2.8;
    const c1 = a.cliente.length * LARG * 3.9 <= w ? { h: 3.9, s: a.cliente, l: 1 } : { ...caber(a.cliente, w, [3.3, 3], 2), l: 2 };
    z += texto(d, m, y, c1.h, w, c1.s, c1.l); y += c1.l * c1.h * 1.05 + 0.8;
    z += texto(d, m, y, 2.3, w, "ENDEREÇO"); y += 2.8;
    const e1 = a.endereco.length * LARG * 3.2 <= w ? { h: 3.2, s: a.endereco, l: 1 } : { ...caber(a.endereco, w, [2.7, 2.4], 2), l: 2 };
    z += texto(d, m, y, e1.h, w, e1.s, e1.l);
    const cid = caber(a.cidade, w, [5.8, 5, 4.4, 3.8], 1), yc = A - m - cid.h;
    z += texto(d, m, yc, cid.h, w, cid.s);
    const bh = 15, bw = 30, by = yc - 1 - bh, vs = `${vol}/${total}`, v = caber(vs, bw - 2, [12, 10, 8.5, 7, 6], 1);
    z += `^FO${d(L - m - bw)},${d(by)}^GB${d(bw)},${d(bh)},${d(bh)},B,1^FS`;
    z += texto(d, L - m - bw, by + (bh - v.h) / 2 + v.h * 0.1, v.h, bw, vs, 1, "C", true);
    z += texto(d, m, by + bh - 8.6 - 2.8, 2.3, w - bw - 2, "DOCUMENTO");
    z += texto(d, m, by + bh - 8.6, 8.6, w - bw - 2, String(a.pedido));
    return z;
  });
}
const testeZpl = (i: Config) => etiqueta(i, (d) => {
  const meio = i.altura / 2, quando = agora().slice(0, 16).split(" ").map((x, k) => (k ? x : `${x.slice(8, 10)}/${x.slice(5, 7)}`)).join(" ");
  return `^FO${d(1)},${d(1)}^GB${d(i.largura - 2)},${d(i.altura - 2)},${d(0.8)},B,0^FS`
    + texto(d, 3, meio - 9, 6, i.largura - 6, caber(zs(`TESTE - ${i.nome}`), i.largura - 6, [6, 5, 4], 1).s, 1, "C")
    + texto(d, 3, meio - 0.5, 3.2, i.largura - 6, `${quando} - ${i.largura} x ${i.altura} mm - ${i.dpi} dpi`, 1, "C")
    + texto(d, 3, meio + 4.5, 3.2, i.largura - 6, "a moldura tem que sair inteira", 1, "C");
});

async function dados(pedidos: number[]) {
  return comConexao(async (c) => {
    const l = await consultar(c, `select a.numdoc, a.qntvol, b.nomcli, b.endcli, b.numcli, b.comcli, b.baicli, b.cidcli, b.endent, b.nument, b.coment, b.baient, b.cident,
      e.nomfan, e.nomemp, e.cidemp, e.estemp from pedidos1 a left join clientes b on b.codcli = a.codcli left join empresas e on e.codemp = a.codemp where a.numdoc in (${pedidos.map(Number).filter(Boolean).join(",") || "0"})`);
    return new Map(l.map((x) => {
      const ent = !!txt(x.ENDENT), p = ent ? ["ENDENT", "NUMENT", "COMENT", "BAIENT"] : ["ENDCLI", "NUMCLI", "COMCLI", "BAICLI"];
      // o pedaço vazio some: "RUA X, 55 - CENTRO", sem o ", -"
      const endereco = [[txt(x[p[0]]), txt(x[p[1]]), txt(x[p[2]])].filter(Boolean).join(", "), txt(x[p[3]])].filter(Boolean).join(" - ");
      const a: Adesivo = { pedido: num(x.NUMDOC), volumes: num(x.QNTVOL), empresa: txt(x.NOMFAN) || txt(x.NOMEMP), razao: txt(x.NOMEMP), cidadeEmp: [txt(x.CIDEMP), txt(x.ESTEMP)].filter(Boolean).join(" - "),
        cliente: zs(txt(x.NOMCLI)).toUpperCase(), endereco: zs(endereco).toUpperCase(), cidade: zs((ent && txt(x.CIDENT)) || txt(x.CIDCLI)).toUpperCase() };
      return [a.pedido, a];
    }));
  });
}

// ---------- o que as telas chamam ----------
export async function teste(b: Row, u: Usuario) {
  const salva = Number(b.id) ? lerImp(Number(b.id)) : null, i = b.nome ? validar(b) : salva;
  if (!i) throw new Erro("Impressora não encontrada.", 404);
  const reg = salva && b.nome ? { ...salva, ...i } : salva;
  try {
    if (i.tipo === "A4") { // folha: só confere se ela responde, sem gastar papel
      if (i.onde === "REDE") { if (!(await alcanca(i.ip, i.porta, 4000))) throw new Erro(`${i.ip} não respondeu na porta ${i.porta}. A impressora está ligada? O IP mudou?`); }
      else { const r = await procurar(i.pc); if (r.erro) return { ok: false, erro: r.erro, precisaSenha: !!r.precisaSenha }; }
      if (reg) registrar(reg, i.nome, "Teste de conexão", 0, null, u);
      return { ok: true, msg: i.onde === "REDE" ? `Respondeu na porta ${i.porta}.` : `${i.pc} respondeu.` };
    }
    await enviar(i, testeZpl(i));
    if (reg) registrar(reg, i.nome, "Etiqueta de teste", 1, null, u);
    return { ok: true, msg: `Teste enviado às ${agora().slice(11, 16)}. Saiu uma etiqueta com a moldura inteira nas quatro bordas?` };
  } catch (e) {
    if (reg) registrar(reg, i.nome, "Teste", 0, (e as Error).message, u);
    return { ok: false, erro: (e as Error).message, precisaSenha: /recusou o usuário/.test((e as Error).message) };
  }
}

// adesivos de um ou mais pedidos (todos os volumes, ou só os escolhidos quando é um pedido só). Falha volta como resposta, não como erro.
export async function imprimirAdesivos(lista: { pedido: number; volumes?: number[] }[], u: Usuario | null) {
  const cfg = adesivoCfg();
  if (!cfg.impressora) throw new Erro("Nenhuma impressora escolhida para o adesivo. Escolha em Sistema › Impressoras.");
  const i = lerImp(cfg.impressora), ds = await dados(lista.map((x) => x.pedido));
  let z = "", n = 0;
  const por: { pedido: number; n: number; total: number }[] = [];
  for (const x of lista) {
    const a = ds.get(Number(x.pedido));
    if (!a) throw new Erro(`Pedido ${x.pedido} não encontrado.`, 404);
    const total = Math.max(1, a.volumes), vs = (x.volumes?.length ? x.volumes.map(Number) : Array.from({ length: total }, (_, k) => k + 1)).filter((v) => v >= 1 && v <= total);
    for (const v of vs) z += adesivoZpl(i, a, v, total);
    n += vs.length; por.push({ pedido: a.pedido, n: vs.length, total });
  }
  if (!n) throw new Erro("Nenhum volume para imprimir.");
  const oque = lista.length === 1 ? `Adesivos do pedido ${lista[0].pedido} (${n})` : `Adesivos de ${lista.length} pedidos (${n})`;
  try {
    await enviar(i, z); registrar(i, i.nome, oque, n, null, u);
    return { ok: true, n, impressora: i.nome, em: agora(), pedidos: por };
  } catch (e) {
    registrar(i, i.nome, oque, n, (e as Error).message, u);
    return { ok: false, n, impressora: i.nome, erro: (e as Error).message, pedidos: por };
  }
}
export const adesivoColetor = () => { const c = adesivoCfg(); return { impressora: c.impressora ? (db().prepare("SELECT nome FROM impressoras WHERE id = ?").get(c.impressora) as Row | undefined)?.nome || null : null, auto: c.auto }; };

// fim da conferência: com a impressora do adesivo escolhida e "imprimir sozinho" ligado, os adesivos saem já
export async function aoConferir<T extends Row>(r: T, u: Usuario): Promise<T & { impressao?: Row }> {
  if (r.status !== "CONFERIDA") return r;
  const cfg = adesivoCfg(), peds: number[] = r.pedidos || (r.pedido ? [r.pedido] : []);
  if (!cfg.impressora || !peds.length) return r;
  if (!cfg.auto) return { ...r, impressao: { manual: true, impressora: adesivoColetor().impressora } };
  try { return { ...r, impressao: await imprimirAdesivos(peds.map((p) => ({ pedido: p })), u) }; }
  catch (e) { return { ...r, impressao: { ok: false, erro: (e as Error).message } }; }
}
