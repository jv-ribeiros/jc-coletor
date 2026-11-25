// Importação de XML de venda (NF-e emitida fora do Lieto com o CNPJ da empresa).
// Vigia a pasta e as subpastas, lê, valida e concilia produtos (a gravação no Lieto fica em xmlimport.ts).
// Depois de importado, o arquivo sai da pasta vigiada para <config.xml.importadas>/AAAA-MM (mês de emissão).
// Produto NUNCA é casado só pelo código do XML (cProd): o código é de quem emitiu e pode coincidir com outro produto do Lieto.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { marco } from "./auditoria";
import { db, getConfig } from "./db";
import { Erro, agora, evento, r4, type Usuario } from "./comum";
import * as I from "./xmlimport";
import { comConexao, consultar, num, txt, type Conexao } from "./fb";

type Falha = { arquivo: string; erro: string; em: string };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const MAX = 5 * 1024 * 1024;

// ---------- leitura ----------
const limpa = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, "&").trim();
export const bloco = (x: string, t: string) => new RegExp(`<(?:[A-Za-z0-9]+:)?${t}(?: [^>]*)?>([^]*?)</(?:[A-Za-z0-9]+:)?${t}>`).exec(x)?.[1] ?? "";
export const tag = (x: string, t: string) => limpa(bloco(x, t));
export const blocos = (x: string, t: string) => [...x.matchAll(new RegExp(`<${t}(?: [^>]*)?>([^]*?)</${t}>`, "g"))].map((m) => m[1]);
export const val = (x: string, t: string) => Number(tag(x, t)) || 0;

export type Item = { n: number; cProd: string; xProd: string; ean: string; un: string; qtd: number; vUn: number; vProd: number; desc: number; frete: number; outros: number; ncm: string; cfop: string };
export type Nota = {
  chave: string; mod: string; serie: string; numero: number; emissao: string; natOp: string; tpNF: string; finalidade: string; ambiente: string; cStat: string;
  emitente: string; destDoc: string; destNome: string; destCidade: string; destUf: string; pedidoMarket: string; intermediador: string; intermCnpj: string;
  itens: Item[]; vProd: number; vDesc: number; vFrete: number; vOutros: number; vNota: number; pagamentos: { tipo: string; valor: number }[]; verProc: string;
};

export function decodificar(b: Buffer) {
  const cab = b.subarray(0, 200).toString("latin1");
  return (/encoding=["'](iso-8859-1|windows-1252)/i.test(cab) ? new TextDecoder("windows-1252").decode(b) : b.toString("utf8")).replace(/^﻿/, "");
}

export function ler(x: string): { tipo: "nota"; nota: Nota } | { tipo: "cancelamento"; chave: string } {
  if (/<!DOCTYPE|<!ENTITY/i.test(x)) throw new Erro("XML com DOCTYPE/ENTITY não é aceito.");
  if (/<(procEventoNFe|envEvento|evento)[ >]/.test(x)) {
    const ret = bloco(x, "retEvento");
    if (tag(x, "tpEvento") !== "110111") throw new Erro("Evento que não é cancelamento.");
    if (!["135", "155"].includes(tag(ret, "cStat"))) throw new Erro("Cancelamento sem homologação da SEFAZ.");
    return { tipo: "cancelamento", chave: tag(x, "chNFe") };
  }
  const inf = bloco(x, "infNFe"), chave = /Id=["']NFe(\d{44})["']/.exec(x)?.[1] || "";
  if (!inf || !chave) throw new Erro("Não é um XML de NF-e.");
  const ide = bloco(inf, "ide"), emit = bloco(inf, "emit"), dest = bloco(inf, "dest"), tot = bloco(inf, "ICMSTot"), ender = bloco(dest, "enderDest");
  const prot = bloco(x, "infProt");
  if (prot && tag(prot, "chNFe") !== chave) throw new Erro("O protocolo é de outra nota.");
  const inter = bloco(inf, "infIntermed");
  const itens = blocos(inf, "det").map((d, k): Item => {
    const p = bloco(d, "prod"), ean = tag(p, "cEAN");
    return { n: k + 1, cProd: tag(p, "cProd"), xProd: tag(p, "xProd"), ean: /^\d{8,14}$/.test(ean) ? ean : "", un: tag(p, "uCom"), qtd: val(p, "qCom"), vUn: val(p, "vUnCom"), vProd: val(p, "vProd"),
      desc: val(p, "vDesc"), frete: val(p, "vFrete"), outros: val(p, "vOutro"), ncm: tag(p, "NCM"), cfop: tag(p, "CFOP") };
  });
  return { tipo: "nota", nota: {
    chave, mod: tag(ide, "mod"), serie: tag(ide, "serie"), numero: val(ide, "nNF"), emissao: tag(ide, "dhEmi").slice(0, 19).replace("T", " "), natOp: tag(ide, "natOp"), tpNF: tag(ide, "tpNF"), finalidade: tag(ide, "finNFe"),
    ambiente: tag(ide, "tpAmb"), cStat: tag(prot, "cStat"), emitente: tag(emit, "CNPJ"), destDoc: tag(dest, "CNPJ") || tag(dest, "CPF"), destNome: tag(dest, "xNome"), destCidade: tag(ender, "xMun"), destUf: tag(ender, "UF"),
    pedidoMarket: tag(inf, "xPed"), intermCnpj: tag(inter, "CNPJ"), intermediador: [tag(inter, "CNPJ"), tag(inter, "idCadIntTran")].filter(Boolean).join(" / "),
    itens, vProd: val(tot, "vProd"), vDesc: val(tot, "vDesc"), vFrete: val(tot, "vFrete"), vOutros: val(tot, "vOutro"), vNota: val(tot, "vNF"),
    pagamentos: blocos(inf, "detPag").map((p) => ({ tipo: tag(p, "tPag"), valor: val(p, "vPag") })), verProc: tag(ide, "verProc"),
  } };
}

// Empresas do Lieto por CNPJ: a nota é gravada na empresa do emitente.
export async function empresasPorCnpj(c: Conexao): Promise<Map<string, number>> {
  const l = await consultar(c, "select codemp, cgcemp from empresas");
  return new Map(l.map((e) => [txt(e.CGCEMP).replace(/\D/g, ""), num(e.CODEMP)] as [string, number]).filter(([k]) => k));
}

// ---------- validação (recalculada a cada consulta) ----------
export async function analisar(n: Nota) {
  return comConexao(async (c) => {
    const erros: string[] = [];
    const aceitos = [...(await empresasPorCnpj(c)).keys()];
    if (!aceitos.includes(n.emitente)) erros.push(`Emitente ${n.emitente || "?"} não é nenhuma empresa cadastrada no Lieto.`);
    if (n.mod !== "55") erros.push(`Modelo ${n.mod}: só NF-e (55).`);
    if (n.ambiente !== "1") erros.push("Nota de homologação (sem valor fiscal).");
    if (!["100", "150"].includes(n.cStat)) erros.push(`Nota sem autorização da SEFAZ (cStat ${n.cStat || "ausente"}).`);
    if (n.tpNF !== "1") erros.push("Nota de entrada, não é venda.");
    if (n.finalidade !== "1") erros.push(`Finalidade ${n.finalidade}: não é venda normal (devolução/ajuste/complementar).`);
    const soma = r4(n.itens.reduce((s, i) => s + i.vProd, 0));
    if (!n.itens.length || Math.abs(soma - n.vProd) > 0.02) erros.push(`Soma dos itens (${soma}) diferente do total de produtos (${n.vProd}).`);
    const ex = (await consultar(c, "select numnot, sernot from notas1 where nfecha = ?", [n.chave]))[0];
    if (ex) erros.push(`Já está no Lieto: nota ${num(ex.NUMNOT)} série ${txt(ex.SERNOT)}.`);
    const itens = [] as Row[];
    for (const i of n.itens) {
      const dp = db().prepare("SELECT codpro, fator FROM xml_depara WHERE emitente = ? AND cprod = ? AND un = ?").get(n.emitente, i.cProd, i.un) as Row | undefined;
      let p: Row | undefined, sugestao: Row | null = null;
      if (dp) p = (await consultar(c, "select codpro, nompro, unipro, proati from produtos where codpro = ?", [dp.codpro]))[0];
      else if (i.ean) {
        const s = await consultar(c, "select codpro, nompro, unipro from produtos where (codbar = ? or eantri = ?) and proati = 'S'", [i.ean, i.ean]);
        if (s.length === 1) sugestao = { codpro: txt(s[0].CODPRO), nompro: txt(s[0].NOMPRO), unipro: txt(s[0].UNIPRO) };
      }
      itens.push({ ...i, produto: p ? { codpro: txt(p.CODPRO), nompro: txt(p.NOMPRO), unipro: txt(p.UNIPRO), fator: dp!.fator, qtd: r4(i.qtd * dp!.fator) } : null, sugestao });
    }
    const falta = itens.filter((i) => !i.produto).length;
    if (falta) erros.push(`${falta} item(ns) sem produto do Lieto.`);
    const quebra = itens.filter((i) => i.produto && Math.abs(i.produto.qtd - Math.round(i.produto.qtd)) > 1e-6).length;
    if (quebra) erros.push(`${quebra} item(ns) com quantidade fracionada (o pedido do Lieto só aceita inteiro).`);
    const cl = n.destDoc ? (await consultar(c, "select codcli, nomcli, cgccpf from clientes where cgccpf = ?", [n.destDoc]))[0] : undefined;
    return { erros, itens, aceitos, cliente: cl ? { codcli: num(cl.CODCLI), nome: txt(cl.NOMCLI) } : null };
  });
}

// ---------- pasta ----------
const opcao = (k: string) => (db().prepare("SELECT valor FROM opcoes WHERE chave = ?").get(k) as Row | undefined)?.valor as string | undefined;
export const pastas = (): string[] => { const v = opcao("xml.pastas"), antiga = opcao("xml.pasta"); return v ? JSON.parse(v) : antiga ? [antiga] : []; };
export function definirPastas(l: unknown, u: Usuario) {
  const ps: string[] = [];
  for (const x of Array.isArray(l) ? l : []) {
    const d = String(x || "").trim();
    if (!d) continue;
    if (!path.isAbsolute(d)) throw new Erro("Informe o caminho completo, ex.: C:\\XML ou \\\\servidor\\pasta.");
    const n = path.resolve(d);
    // as que já estavam não são testadas de novo: uma fora do ar não pode impedir de mexer nas outras
    if (!pastas().some((y) => igual(y, n))) try { fs.readdirSync(d); } catch (e) { throw new Erro(porQue(d, e)); }
    if (!ps.some((y) => y.toLowerCase() === n.toLowerCase())) ps.push(n);
  }
  db().prepare("INSERT INTO opcoes (chave, valor) VALUES ('xml.pastas', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(JSON.stringify(ps));
  vistos.clear(); presos.clear(); est.falhas = []; est.erros = {}; est.lidas = {};
  evento("xml", "pasta", u, "DEFINIU PASTAS", ps.join(" ; ") || "(nenhuma)");
}

// marca de "há algo novo para importar"
// (no globalThis: o Next carrega este módulo mais de uma vez no mesmo processo, na API e no agendador)
const g = globalThis as unknown as { __xmlLimpo?: boolean; __xmlRodando?: boolean; __xmlVistos?: Map<string, string>; __xmlPastas?: { falhas: Falha[]; lidas: Record<string, string>; erros: Record<string, string> }; __xmlPresos?: Map<string, string> };
export const marcar = () => { g.__xmlLimpo = false; };
export const consumirMarca = () => { const s = !g.__xmlLimpo; g.__xmlLimpo = true; return s; };

// Motivo real de a pasta não abrir. O Node devolve UNKNOWN quando a rede recusa usuário e senha.
export function porQue(d: string, e: unknown) {
  const c = (e as NodeJS.ErrnoException).code || "", rede = d.startsWith("\\\\"), srv = d.split("\\").filter(Boolean)[0], quem = os.userInfo().username;
  if (rede && ["UNKNOWN", "EACCES", "EPERM"].includes(c)) return `${srv} não abriu para o usuário ${quem}: ${d}. Ou ele recusou o usuário e a senha, ou o nome do computador está errado. No servidor, rode servico\\acesso-rede.bat e informe o usuário e a senha de ${srv}.`;
  if (c === "EACCES" || c === "EPERM") return `O usuário ${quem} não tem permissão nesta pasta: ${d}`;
  if (c === "ENOENT" && /^[a-z]:/i.test(d) && !fs.existsSync(d.slice(0, 3))) return `O disco ${d.slice(0, 2)} não existe para o usuário ${quem}. Se for unidade de rede, use \\\\servidor\\pasta.`;
  if (c === "ENOTDIR") return "Isto não é uma pasta: " + d;
  return c === "ENOENT" ? (rede ? `Não achei na rede: ${d}. Confira o nome do computador e da pasta.` : "Pasta não encontrada neste servidor: " + d) : `Não consegui abrir ${d}: ${(e as Error).message}`;
}

const rodar = (exe: string, args: string[]) => new Promise<string>((ok) => {
  const { execFile } = process.getBuiltinModule("node:child_process") as typeof import("node:child_process");
  execFile(exe, args, { timeout: 15_000, windowsHide: true, encoding: "utf8" }, (_e, saida) => ok(String(saida || "")));
});
// Lugares de rede conhecidos deste usuário: unidades mapeadas e computadores com acesso guardado (servico\rede)
async function lugaresDeRede(): Promise<string[]> {
  const l = new Set<string>();
  for (const m of (await rodar("reg.exe", ["query", "HKCU\\Network", "/s", "/v", "RemotePath"])).matchAll(/RemotePath\s+REG_\w+\s+(\\\\.+)/g)) l.add(m[1].trim());
  try { for (const f of fs.readdirSync(path.join(process.cwd(), "servico", "rede"))) if (f.endsWith(".bin")) l.add("\\\\" + f.slice(0, -4)); } catch { /* nenhum */ }
  for (const p of pastas()) if (p.startsWith("\\\\")) l.add("\\\\" + p.split("\\").filter(Boolean)[0]);
  return [...l];
}

// Navegação de pastas do servidor (só administrador). Sem caminho: discos e lugares de rede. \\servidor: as pastas compartilhadas dele.
export async function navegar(p: string) {
  const d = String(p || "").trim();
  if (!d) return { atual: "", acima: null, pastas: [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => l + ":\\").filter((x) => fs.existsSync(x)), ...(await lugaresDeRede())], xmls: 0 };
  if (!path.isAbsolute(d)) throw new Erro("Informe o caminho completo, ex.: C:\\XML ou \\\\servidor\\pasta.");
  const srv = /^\\\\([A-Za-z0-9._-]+)\\?$/.exec(d)?.[1];
  if (srv) {
    const linhas = (await rodar("cmd.exe", ["/d", "/c", `chcp 65001>nul & net view \\\\${srv}`])).split(/\r?\n/), i = linhas.findIndex((x) => /^-{10,}/.test(x));
    const cs = i < 0 ? [] : linhas.slice(i + 1).map((x) => /^(.+?)\s{2,}(?:Disco|Disk)\b/i.exec(x)?.[1]?.trim()).filter((x): x is string => !!x);
    if (!cs.length) throw new Erro(`${srv} não mostrou as pastas para o usuário ${os.userInfo().username}. No servidor, rode servico\\acesso-rede.bat, ou digite o caminho completo \\\\${srv}\\pasta.`);
    return { atual: "", acima: "", pastas: cs.map((x) => `\\\\${srv}\\${x}`), xmls: 0 };
  }
  let l: fs.Dirent[];
  try { l = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { throw new Erro(porQue(d, e)); }
  const raizRede = /^(\\\\[^\\]+)\\[^\\]+\\?$/.exec(d)?.[1], acima = raizRede || path.dirname(d);
  return { atual: d, acima: acima === d ? "" : acima, pastas: l.filter((x) => x.isDirectory() && !x.name.startsWith("$")).map((x) => path.join(d, x.name)).sort((a, b) => a.localeCompare(b)).slice(0, 500), xmls: l.filter((x) => x.isFile() && /\.xml$/i.test(x.name)).length };
}

// Guarda o XML importado em Importadas/AAAA-MM: copia, confere o conteúdo e só então remove o original da pasta vigiada.
// Falhar aqui não desfaz a importação: a próxima leitura da pasta tenta de novo.
export function arquivar(chave: string, origem?: string) {
  const base = getConfig().xml?.importadas, x = db().prepare("SELECT arquivo, conteudo, emissao, status, arquivado FROM xmls WHERE chave = ?").get(chave) as Row | undefined;
  if (!base || !x || x.status !== "IMPORTADA") return;
  // a pasta já recusou apagar e esta nota já está guardada: não relê tudo pela rede
  if (origem && x.arquivado && presos.size && [...presos.values()].includes(raizDe(origem)) && fs.existsSync(x.arquivado)) { presos.set(origem, raizDe(origem)); return; }
  const arq = String(origem || x.arquivo || ""), vigiada = path.isAbsolute(arq) && pastas().some((p) => dentro(p, arq)) && !(dentro(base, arq) && !pastas().some((p) => igual(p, base) || dentro(base, p)));
  const dir = path.join(base, String(x.emissao).slice(0, 7));
  fs.mkdirSync(dir, { recursive: true });
  let destino = path.join(dir, path.basename(arq) || `${chave}-nfe.xml`);
  if (vigiada && mesmoLugar(arq, destino)) return; // já está no lugar, mesmo com outro nome de caminho
  let dados = Buffer.from(String(x.conteudo), "utf8");
  if (vigiada && fs.existsSync(arq)) {
    dados = fs.readFileSync(arq);
    const r = ler(decodificar(dados));
    if (r.tipo !== "nota" || r.nota.chave !== chave) throw new Erro("O arquivo na pasta não é mais esta nota: não foi movido.");
  }
  if (fs.existsSync(destino) && !fs.readFileSync(destino).equals(dados)) destino = path.join(dir, `${chave}-nfe.xml`); // mesmo nome, outro conteúdo
  if (!fs.existsSync(destino)) fs.writeFileSync(destino, dados, { flag: "wx" });
  if (!fs.readFileSync(destino).equals(dados)) throw new Erro("Cópia do XML não confere: o original foi mantido.");
  if (vigiada && fs.existsSync(arq) && !mesmoLugar(arq, destino)) { // nunca apaga a própria cópia
    try { fs.unlinkSync(arq); presos.delete(arq); }
    catch (e) { // sem permissão de apagar na pasta: a nota está importada e guardada, só o original fica lá. Tenta de novo quando o sistema reabrir.
      if (!["EPERM", "EACCES", "EROFS"].includes((e as NodeJS.ErrnoException).code || "")) throw e;
      presos.set(arq, raizDe(arq));
    }
  }
  db().prepare("UPDATE xmls SET arquivado = ? WHERE chave = ?").run(destino, chave);
}

export function receber(arquivo: string, conteudo: string) {
  const r = ler(conteudo);
  if (r.tipo === "cancelamento") {
    db().prepare("INSERT INTO xml_cancelados (chave, em) VALUES (?, ?) ON CONFLICT(chave) DO NOTHING").run(r.chave, agora());
    return { chave: r.chave, cancelamento: true, repetido: false };
  }
  const n = r.nota;
  const ins = db().prepare("INSERT INTO xmls (chave, arquivo, conteudo, numero, serie, emissao, valor, recebido_em) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(chave) DO NOTHING")
    .run(n.chave, arquivo, conteudo, n.numero, n.serie, n.emissao, n.vNota, agora());
  if (ins.changes) marco({ origem: "AUTOMATICO", rota: "xml/recebido", ref: n.chave, dados: { arquivo, numero: n.numero, serie: n.serie, valor: n.vNota } });
  if (Number(ins.changes) === 0) db().prepare("UPDATE xmls SET arquivo = ? WHERE chave = ? AND status IS NOT 'IMPORTADA'").run(arquivo, n.chave);
  marcar();
  return { chave: n.chave, cancelamento: false, repetido: Number(ins.changes) === 0 };
}

const vistos = (g.__xmlVistos ??= new Map<string, string>()); // arquivo -> tamanho:data já processado
const est = (g.__xmlPastas ??= { falhas: [], lidas: {}, erros: {} });
const presos = (g.__xmlPresos ??= new Map<string, string>()); // arquivo importado que a pasta não deixou apagar -> pasta vigiada
const raizDe = (arq: string) => pastas().find((p) => dentro(p, arq)) || "";
const igual = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const dentro = (raiz: string, arq: string) => { const r = path.relative(path.resolve(raiz).toLowerCase(), path.resolve(arq).toLowerCase()); return !!r && r !== ".." && !r.startsWith(".." + path.sep) && !path.isAbsolute(r); };
// O mesmo lugar pode ter dois nomes (Z: e \servidor, nome curto): compara a identidade no disco. Sem identidade = trata como o mesmo, que é o lado seguro (não apaga).
function mesmoLugar(a: string, b: string) {
  if (igual(a, b)) return true;
  let x: fs.BigIntStats, y: fs.BigIntStats;
  try { x = fs.statSync(a, { bigint: true }); y = fs.statSync(b, { bigint: true }); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
  return !x.ino || !y.ino ? path.basename(a).toLowerCase() === path.basename(b).toLowerCase() : x.ino === y.ino; // sem comparar o volume: pela rede ele pode aparecer diferente
}
// Todos os XML da pasta e das subpastas, em qualquer nível. Não segue atalhos (evita volta infinita) nem a pasta de Importadas.
// Subpasta que não abre não para as outras. Assíncrono: pasta de rede lenta não pode travar os coletores.
async function* xmlsDe(d: string, erros: string[], raiz = true): AsyncGenerator<string> {
  let l: fs.Dirent[];
  try { l = await fs.promises.readdir(d, { withFileTypes: true }); } catch (e) { if (raiz) throw e; erros.push(`${d}: ${(e as Error).message}`); return; }
  const imp = getConfig().xml?.importadas;
  for (const x of l) if (x.isFile() && /\.xml$/i.test(x.name)) yield path.join(d, x.name);
  for (const x of l) if (x.isDirectory() && !x.name.startsWith("$") && x.name !== "System Volume Information") { const s = path.join(d, x.name); if (imp && x.name.toLowerCase() === path.basename(imp).toLowerCase()) { let mesma = true; try { mesma = mesmoLugar(s, imp); } catch { /* na dúvida, não entra */ } if (mesma) continue; } yield* xmlsDe(s, erros, false); }
}
// Uma varredura por vez (no globalThis: a API e o agendador têm cópias deste módulo)
export async function varrer() {
  if (g.__xmlRodando) return;
  g.__xmlRodando = true;
  try {
    for (const d of pastas()) {
      const erros: string[] = []; let n = 0;
      try {
        for await (const arq of xmlsDe(d, erros)) {
          if (n++ % 50 === 0 && !pastas().some((p) => igual(p, d))) break; // saiu da lista no meio da leitura
          try {
            const st = await fs.promises.stat(arq), marca = `${st.size}:${st.mtimeMs}`;
            if (vistos.get(arq) === marca || Date.now() - st.mtimeMs < 3000) continue; // espera terminar de copiar
            vistos.set(arq, marca);
            est.falhas = est.falhas.filter((x) => x.arquivo !== arq);
            if (st.size > MAX) throw new Erro("Arquivo maior que 5 MB.");
            const r = receber(arq, decodificar(await fs.promises.readFile(arq)));
            if (!r.cancelamento && r.repetido) arquivar(r.chave, arq); // já importada: só guarda o arquivo
          } catch (e) { if (!(e instanceof Erro)) vistos.delete(arq); est.falhas = [{ arquivo: arq, erro: (e as Error).message, em: agora() }, ...est.falhas.filter((x) => x.arquivo !== arq)].slice(0, 200); }
        }
        est.lidas[d] = agora();
        if (erros.length) est.erros[d] = `${erros.length} subpasta(s) não abriram. ${erros[0]}`; else delete est.erros[d];
      } catch (e) { est.erros[d] = porQue(d, e); } // uma pasta fora do ar não para as outras
    }
  } finally { g.__xmlRodando = false; }
}

// ---------- telas ----------
export function situacao() {
  const c = Object.fromEntries((db().prepare("SELECT COALESCE(status, 'PENDENTE') s, COUNT(*) n FROM xmls GROUP BY 1").all() as Row[]).map((r) => [r.s, r.n]));
  return { config: I.config(), pastas: pastas().map((p) => ({ pasta: p, lida: est.lidas[p] || "", erro: est.erros[p] || "", presos: [...presos.values()].filter((r) => r === p).length })), falhas: est.falhas, contagem: c };
}

const temVinculo = (emitente: string, i: Item) => !!db().prepare("SELECT 1 FROM xml_depara WHERE emitente = ? AND cprod = ? AND un = ?").get(emitente, i.cProd, i.un);

// Tabela de notas, paginada no servidor. "motivo" mostra só o que dá para saber sem consultar o Lieto (o resto aparece ao abrir a nota).
export function notas(q: URLSearchParams) {
  const por = Math.min(100, Math.max(10, Number(q.get("por")) || 25)), where: string[] = [], args: (string | number)[] = [];
  const st = q.get("status"), b = (q.get("q") || "").trim();
  if (st === "CANCELADA") where.push("c.chave IS NOT NULL");
  else if (st === "PENDENTE") where.push("x.status IS NULL");
  else if (st) { where.push("x.status = ?"); args.push(st); }
  if (b) { where.push("(CAST(x.numero AS TEXT) = ? OR CAST(x.pedido AS TEXT) = ? OR x.chave = ? OR x.conteudo LIKE ? ESCAPE '!')"); args.push(b, b, b, `%${b.replace(/[!%_]/g, "!$&")}%`); }
  const de = `FROM xmls x LEFT JOIN xml_cancelados c ON c.chave = x.chave ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  const total = (db().prepare(`SELECT COUNT(*) n ${de}`).get(...args) as Row).n as number, paginas = Math.max(1, Math.ceil(total / por)), pagina = Math.min(paginas, Math.max(1, Number(q.get("pag")) || 1));
  const linhas = db().prepare(`SELECT x.*, c.chave IS NOT NULL cancelada ${de} ORDER BY x.emissao DESC, x.numero DESC LIMIT ? OFFSET ?`).all(...args, por, (pagina - 1) * por) as Row[];
  return { total, paginas, pagina, por, linhas: linhas.map(({ conteudo, ...x }) => {
    let dest = "", canal = "", ped = "", motivo = x.erro || "";
    try {
      const r = ler(conteudo);
      if (r.tipo === "nota") {
        const k = I.canalDe(r.nota), falta = r.nota.itens.filter((i) => !temVinculo(r.nota.emitente, i)).length;
        dest = r.nota.destNome; canal = k?.nome || r.nota.intermCnpj; ped = r.nota.pedidoMarket;
        if (!motivo && x.status !== "IMPORTADA") motivo = [x.cancelada && "cancelada", falta && `${falta} item(ns) sem vínculo`, !k && "canal não configurado"].filter(Boolean).join(" · ");
      }
    } catch { /* mostra a linha mesmo assim */ }
    return { ...x, dest, canal, ped, motivo };
  }) };
}

// Itens sem vínculo de todas as notas ainda não importadas, agrupados (vincular uma vez resolve todas)
export async function itensSemVinculo() {
  return comConexao(async (c) => {
    const aceitos = new Set((await empresasPorCnpj(c)).keys());
    const m = new Map<string, Row>(); let fora = 0;
    for (const x of db().prepare("SELECT chave, conteudo FROM xmls WHERE status IS NOT 'IMPORTADA' AND chave NOT IN (SELECT chave FROM xml_cancelados) ORDER BY emissao DESC").all() as Row[]) {
      let r; try { r = ler(x.conteudo); } catch { continue; }
      if (r.tipo !== "nota") continue;
      if (!aceitos.has(r.nota.emitente) || r.nota.mod !== "55") { fora++; continue; }
      for (const i of r.nota.itens) {
        if (temVinculo(r.nota.emitente, i)) continue;
        const k = [r.nota.emitente, i.cProd, i.un].join("|"), e = m.get(k);
        if (e) { e.notas.add(x.chave); e.qtd = r4(e.qtd + i.qtd); } else m.set(k, { ...i, emitente: r.nota.emitente, chave: x.chave, notas: new Set([x.chave]) });
      }
    }
    const itens: Row[] = [];
    for (const e of m.values()) {
      let sugestao = null;
      if (e.ean) {
        const s = await consultar(c, "select codpro, nompro, unipro from produtos where (codbar = ? or eantri = ?) and proati = 'S'", [e.ean, e.ean]);
        if (s.length === 1) sugestao = { codpro: txt(s[0].CODPRO), nompro: txt(s[0].NOMPRO), unipro: txt(s[0].UNIPRO) };
      }
      itens.push({ ...e, notas: e.notas.size, sugestao });
    }
    return { itens: itens.sort((a, b) => b.notas - a.notas || a.xProd.localeCompare(b.xProd)), fora };
  });
}

export async function vinculos() {
  const l = db().prepare("SELECT * FROM xml_depara ORDER BY em DESC").all() as Row[];
  return comConexao(async (c) => {
    const out: Row[] = [];
    for (const x of l) { const p = (await consultar(c, "select nompro, unipro from produtos where codpro = ?", [x.codpro]))[0]; out.push({ ...x, nompro: txt(p?.NOMPRO) || "(produto não existe mais)", unipro: txt(p?.UNIPRO) }); }
    return out;
  });
}
export function desvincular(b: Row, u: Usuario) {
  const r = db().prepare("DELETE FROM xml_depara WHERE emitente = ? AND cprod = ? AND un = ?").run(String(b.emitente || ""), String(b.cprod || ""), String(b.un || ""));
  if (!Number(r.changes)) throw new Erro("Vínculo não encontrado.", 404);
  evento("xml", String(b.cprod), u, "REMOVEU VÍNCULO", { emitente: b.emitente, un: b.un, codpro: b.codpro });
}
export async function detalhe(chave: string) {
  const x = db().prepare("SELECT * FROM xmls WHERE chave = ?").get(chave) as Row | undefined;
  if (!x) throw new Erro("XML não encontrado.", 404);
  const r = ler(x.conteudo);
  if (r.tipo !== "nota") throw new Erro("XML inválido.");
  const a = await analisar(r.nota);
  if (db().prepare("SELECT 1 FROM xml_cancelados WHERE chave = ?").get(chave)) a.erros.unshift("Nota cancelada na SEFAZ.");
  a.erros.push(...(await I.pendencias(r.nota, x.conteudo)));
  return { nota: r.nota, arquivo: x.arquivo, status: x.status as string | null, obs: x.obs as string | null, erroImportacao: x.erro as string | null, pedido: x.pedido as number | null, ...a };
}
export async function vincular(b: Row, u: Usuario) {
  const emitente = String(b.emitente || ""), cprod = String(b.cProd || ""), un = String(b.un || ""), codpro = String(b.codpro || "").trim(), fator = r4(b.fator);
  if (!/^\d{14}$/.test(emitente) || !cprod || !codpro) throw new Erro("Dados do vínculo incompletos.");
  if (!(fator > 0)) throw new Erro("Informe quantas unidades do Lieto correspondem a 1 do XML.");
  if (!(await comConexao((c) => consultar(c, "select codpro from produtos where codpro = ?", [codpro])))[0]) throw new Erro("Produto não existe no Lieto.");
  db().prepare("INSERT INTO xml_depara (emitente, cprod, un, codpro, fator, por, em) VALUES (?,?,?,?,?,?,?) ON CONFLICT(emitente, cprod, un) DO UPDATE SET codpro = excluded.codpro, fator = excluded.fator, por = excluded.por, em = excluded.em")
    .run(emitente, cprod, un, codpro, fator, u.nome, agora());
  marcar();
  evento("xml", cprod, u, "VINCULOU PRODUTO", { emitente, un, codpro, fator });
}
export function enviar(b: Row) {
  const c = String(b.conteudo || "");
  if (!c || c.length > MAX) throw new Erro("Arquivo vazio ou maior que 5 MB.");
  return receber(path.basename(String(b.arquivo || "enviado.xml").replace(/\\/g, "/")).slice(0, 200), c.replace(/^﻿/, ""));
}
