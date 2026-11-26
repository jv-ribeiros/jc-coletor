// Conferência de expedição por pedido (a fila pode ser aberta por romaneio), gravada nas tabelas do próprio Lieto.
// Dois modos (Sistema › Conferência), congelados na abertura. SEPARACAO: mostra local e quantidade, quem separa já confere, recusa leitura
// a mais e o que não tem fica como falta, esperando a gestão (encerrar ou cancelar). CEGA: não mostra nada e reconfere o que divergir:
//   1ª contagem (cega) -> QNTCON. O que divergir vai para reconferência (cega) -> QNTREC, com NUMREC = ordem.
//   Tudo certo: DATCON/HORCON/CODCON. Encerrar com divergência (gestão): DATENC/HORENC/CODENC.
// Por ROMANEIO: soma por produto só os pedidos ainda não conferidos (os já conferidos, ou em conferência, ficam de fora). Batendo,
// grava uma conferência POR PEDIDO, que é como o Lieto tem todas. A lista de pedidos é congelada na abertura.
// A contagem em andamento fica no SQLite; no fim grava tudo no Lieto numa transação. Não mexe em estoque nem na situação do pedido
// (só preenche PEDIDOS1.DATSEP se estiver vazio, como o Lieto faz).
import { db } from "./db";
import { adicionais, cods, fatores } from "./cadastro";
import * as ddl from "./ddl";
import { Erro, agora, chave, evento, limparObs, obsErp, r4, type Usuario } from "./comum";
import { comConexao, consultar, emTransacao, executar, hoje, iso, lerBlob, num, txt, type Conexao } from "./fb";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Ped = { pedido: number; itens: Record<string, number> };
type Item = { codpro: string; nompro: string; unipro: string; qtd: number; codigos: string[]; fatores?: Record<string, number>; con: number; rec: number; numrec: number; local?: string; falta?: boolean };
type Modo = "CEGA" | "SEPARACAO";
const MODOS: Modo[] = ["SEPARACAO", "CEGA"];
export const modoAtual = (): Modo => { const v = (db().prepare("SELECT valor FROM opcoes WHERE chave = 'conferencia.modo'").get() as Row | undefined)?.valor; return MODOS.includes(v) ? v : "SEPARACAO"; };
// Na separação: se o produto pode ser confirmado pela bipagem (nem toda empresa tem coletor). Sem isto, confirma na tela.
export const bipar = () => (db().prepare("SELECT valor FROM opcoes WHERE chave = 'conferencia.bipar'").get() as Row | undefined)?.valor === "S";
export function salvarModo(b: Row, u: Usuario) {
  if (!MODOS.includes(b.modo)) throw new Erro("Modo de conferência inválido.");
  db().prepare("INSERT INTO opcoes (chave, valor) VALUES ('conferencia.modo', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(b.modo);
  db().prepare("INSERT INTO opcoes (chave, valor) VALUES ('conferencia.bipar', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(b.bipar ? "S" : "N");
  evento("sistema", "conferencia", u, "ALTEROU MODO DA CONFERÊNCIA", { modo: b.modo, bipar: !!b.bipar });
  return { modo: modoAtual(), bipar: bipar() };
}
const separando = (c: Row) => c.modo === "SEPARACAO";
// ordem de andar no estoque: pelo local; sem local vai para o fim
const porLocal = (a: Item, b: Item) => Number(!a.local) - Number(!b.local) || (a.local || "").localeCompare(b.local || "", "pt-BR", { numeric: true }) || a.nompro.localeCompare(b.nompro);

const abertas = () => db().prepare("SELECT id, codfun, usuario, cliente, pedido, romaneio, pedidos, itens, modo, aguarda_em, criado_em FROM conferencias WHERE status IN ('CONTANDO','RECONTANDO')").all() as Row[];
// conferência em andamento que contém o pedido (sozinho ou dentro de um romaneio)
const abertaDe = (numped: number) => abertas().find((a) => a.pedido === numped || (a.pedidos && (JSON.parse(a.pedidos) as Ped[]).some((x) => x.pedido === numped)));
const romaneioAberto = (rom: number) => abertas().find((a) => a.pedido == null && a.romaneio === rom);
const ler = (id: number) => {
  const c = db().prepare("SELECT * FROM conferencias WHERE id = ?").get(id) as Row | undefined;
  if (!c) throw new Erro("Conferência não encontrada.", 404);
  return { ...c, itens: JSON.parse(c.itens) as Item[] } as Row & { itens: Item[] };
};
const gravarItens = (id: number, itens: Item[], status: string) => db().prepare("UPDATE conferencias SET itens = ?, status = ? WHERE id = ?").run(JSON.stringify(itens), status, id);
const noLieto = async (t: Conexao, numped: number) => (await consultar(t, "select first 1 numide, datcon, datenc from conferencias1 where numped = ? order by numide desc", [numped]))[0];
const final = (i: Item) => (i.numrec > 0 ? i.rec : i.con);

// Fila: pedidos de um romaneio, um pedido, ou os pendentes sem conferência. Com entrega, cidade, tamanho e o PCP do Lieto (PEDIDOS1).
// filtro (sem romaneio/pedido): hoje = entrega até hoje · amanha · todos · andamento (abertos aqui). q = número de pedido/romaneio ou nome do cliente.
const dia = (v: unknown) => (v instanceof Date ? iso(v) : v ? String(v).slice(0, 10) : "");
const CAMPOS = `a.numdoc, a.numrom, a.ordrom, a.sitdoc, a.datdoc, a.datent, a.datpcp, a.datsep, a.datcon, a.datfat, a.datexp, a.qntvol, a.pesbru, b.nomcli, b.cidcli, b.estcli,
  (select first 1 r.nomrot from rotas r where r.codrot = a.codrot) nomrot, (select count(*) from pedidos2 x where x.numdoc = a.numdoc and x.baiest = 'S') n,
  (select max(h.numide) from conferencias1 h where h.numped = a.numdoc) h`;
async function linhas(c: Conexao, where: string, args: unknown[]) {
  const l = await consultar(c, `select first 300 ${CAMPOS} from pedidos1 a left join clientes b on b.codcli = a.codcli where ${where} order by a.datent, a.numrom, a.ordrom, a.numdoc`, args);
  const hs = l.map((x) => num(x.H)).filter(Boolean), est = new Map<number, Row>();
  if (hs.length) for (const h of await consultar(c, `select numide, datcon, datenc, codcon from conferencias1 where numide in (${hs.join(",")})`)) est.set(num(h.NUMIDE), h);
  const aqui = new Map((db().prepare("SELECT pedido, MAX(fim_em) fim, usuario FROM conferencias WHERE status = 'CONFERIDA' AND pedido IS NOT NULL GROUP BY pedido").all() as Row[]).map((x) => [x.pedido, x]));
  return l.map((x) => {
    const n = num(x.NUMDOC), a = abertaDe(n), h = est.get(num(x.H)), fe = aqui.get(n);
    return { pedido: n, romaneio: num(x.NUMROM), ordem: num(x.ORDROM), situacao: txt(x.SITDOC), data: x.DATDOC, entrega: dia(x.DATENT), cliente: txt(x.NOMCLI), cidade: [txt(x.CIDCLI), txt(x.ESTCLI)].filter(Boolean).join("/"), rota: txt(x.NOMROT),
      itens: num(x.N), volumes: num(x.QNTVOL), peso: num(x.PESBRU), pcp: { pcp: dia(x.DATPCP), sep: dia(x.DATSEP), con: dia(x.DATCON), fat: dia(x.DATFAT), exp: dia(x.DATEXP) },
      conferencia: a ? (a.aguarda_em ? "AGUARDA GESTÃO" : "EM ANDAMENTO") : h ? (h.DATCON ? "CONFERIDA" : h.DATENC ? "ENCERRADA" : "ABERTA NO LIETO") : "",
      usuario: a ? `${a.usuario}${a.pedido == null ? ` (romaneio ${a.romaneio})` : ""}` : fe?.usuario || "", desde: a?.criado_em || "", feito: a ? progresso(a) : null, id: a && a.pedido != null ? a.id : null, noRomaneio: !!a && a.pedido == null };
  });
}
const progresso = (a: Row) => { const it = JSON.parse(a.itens) as Item[]; return separando(a) ? { feito: r4(it.reduce((s, i) => s + i.con, 0)), total: r4(it.reduce((s, i) => s + i.qtd, 0)) } : { feito: it.filter((i) => final(i) > 0).length, total: it.length }; };
export async function fila(q: URLSearchParams) {
  const rom = Number(q.get("romaneio") || 0), ped = Number(q.get("pedido") || 0), f = q.get("filtro") || "", busca = (q.get("q") || "").trim();
  return comConexao(async (c) => {
    if (rom) return linhas(c, "a.numrom = ?", [rom]);
    if (ped) return linhas(c, "a.numdoc = ?", [ped]);
    if (/^\d+$/.test(busca)) return linhas(c, "(a.numdoc = ? or a.numrom = ?)", [Number(busca), Number(busca)]);
    if (busca.length > 1) return linhas(c, "a.sitdoc = 'PED' and a.datfat is null and upper(b.nomcli) containing ?", [busca.toUpperCase()]);
    if (f === "andamento") { const ns = abertas().flatMap((a) => (a.pedido != null ? [a.pedido] : (JSON.parse(a.pedidos) as Ped[]).map((x) => x.pedido))); return ns.length ? linhas(c, `a.numdoc in (${ns.map(Number).join(",")})`, []) : []; }
    const base = "a.sitdoc = 'PED' and a.datfat is null";
    return linhas(c, f === "hoje" ? `${base} and a.datent <= current_date` : f === "amanha" ? `${base} and a.datent = current_date + 1` : base, []);
  });
}

// Romaneios dos últimos 30 dias (ROMANEIOS: uma linha por produto; o cabeçalho é a primeira) com caminhão, motorista, rota e andamento.
export async function romaneios() {
  return comConexao(async (c) => {
    const cab = await consultar(c, `select r.numdoc, min(r.datdoc) datdoc, max(r.datfec) datfec, max(r.codmot) codmot, max(r.codcam) codcam from romaneios r where r.datdoc >= current_date - 30 group by r.numdoc order by r.numdoc desc`);
    if (!cab.length) return [];
    const ns = cab.map((x) => num(x.NUMDOC)), ps = await linhas(c, `a.numrom in (${ns.join(",")})`, []);
    const mot = new Map((await consultar(c, "select codmot, nommot from motoristas")).map((x) => [num(x.CODMOT), txt(x.NOMMOT)]));
    const cam = new Map((await consultar(c, "select codcam, nomcam, placam from caminhoes")).map((x) => [num(x.CODCAM), [txt(x.NOMCAM), txt(x.PLACAM)].filter(Boolean).join(" ")]));
    return cab.map((x) => { const l = ps.filter((p) => p.romaneio === num(x.NUMDOC)); return { romaneio: num(x.NUMDOC), saida: dia(x.DATDOC), fechado: !!x.DATFEC, motorista: mot.get(num(x.CODMOT)) || "", caminhao: cam.get(num(x.CODCAM)) || "",
      rotas: [...new Set(l.map((p) => p.rota).filter(Boolean))].join(", "), pedidos: l.length, conferidos: l.filter((p) => ["CONFERIDA", "ENCERRADA"].includes(p.conferencia)).length, andamento: l.filter((p) => ["EM ANDAMENTO", "AGUARDA GESTÃO"].includes(p.conferencia)).length }; }).filter((x) => x.pedidos);
  });
}

// Ficha do pedido antes de começar: cabeçalho, PCP, observação e itens em ordem de local. Não abre conferência.
export async function ficha(n: number) {
  return comConexao(async (c) => {
    const p = (await linhas(c, "a.numdoc = ?", [n]))[0];
    if (!p) throw new Erro(`Pedido ${n} não encontrado.`, 404);
    const cab = (await consultar(c, "select a.obsped, a.datdoc, v.nomven from pedidos1 a left join vendedores v on v.codven = a.codven where a.numdoc = ?", [n]))[0];
    const its = await consultar(c, "select b.codpro, max(p.nompro) nompro, max(p.unipro) unipro, max(p.locpro) locpro, sum(b.qntpro) q from pedidos2 b join produtos p on p.codpro = b.codpro where b.numdoc = ? and b.baiest = 'S' group by b.codpro", [n]);
    const itens = its.map((i) => ({ codpro: txt(i.CODPRO), nompro: txt(i.NOMPRO), unipro: txt(i.UNIPRO), local: txt(i.LOCPRO), qtd: r4(num(i.Q)) })).sort((a, b) => Number(!a.local) - Number(!b.local) || a.local.localeCompare(b.local, "pt-BR", { numeric: true }) || a.nompro.localeCompare(b.nompro));
    return { ...p, vendedor: txt(cab?.NOMVEN), obs: (await lerBlob(cab?.OBSPED)).trim(), criado: cab?.DATDOC ?? null, lista: itens };
  });
}

// Conferência de volumes do romaneio: pedidos dele que foram separados ANTES (fora da separação somada do romaneio).
// Contou igual ao QNTVOL: confere. Diferente: só grava se pedirem para corrigir, e aí o QNTVOL do Lieto passa a ser o contado.
export async function volumes(rom: number) {
  const juntos = new Set((db().prepare("SELECT pedidos FROM conferencias WHERE pedido IS NULL AND romaneio = ? AND status = 'CONFERIDA'").all(rom) as Row[]).flatMap((x) => (JSON.parse(x.pedidos) as Ped[]).map((p) => p.pedido)));
  const l = (await comConexao((c) => linhas(c, "a.numrom = ?", [rom]))).filter((p) => p.conferencia === "CONFERIDA" && !juntos.has(p.pedido));
  const ult = new Map((db().prepare("SELECT pedido, contado, esperado, corrigido, usuario, em FROM conf_volumes WHERE romaneio = ? ORDER BY id").all(rom) as Row[]).map((x) => [x.pedido, x]));
  return { romaneio: rom, pedidos: l.map((p) => ({ pedido: p.pedido, cliente: p.cliente, esperado: p.volumes, por: p.usuario, ordem: p.ordem, conferido: ult.get(p.pedido) || null })).sort((a, b) => a.ordem - b.ordem || a.pedido - b.pedido) };
}
export async function conferirVolume(rom: number, b: Row, u: Usuario) {
  const pedido = Number(b.pedido), contado = Number(b.contado);
  if (!Number.isInteger(contado) || contado < 0 || contado > 9999) throw new Erro("Quantidade de volumes inválida.");
  const p = (await volumes(rom)).pedidos.find((x) => x.pedido === pedido);
  if (!p) throw new Erro("Este pedido não está na conferência de volumes deste romaneio.");
  if (contado !== p.esperado && !b.corrigir) return { diferente: true, esperado: p.esperado, contado };
  if (contado !== p.esperado) {
    await ddl.exigir("conferencia");
    await emTransacao((t) => executar(t, "update pedidos1 set qntvol = ? where numdoc = ?", [contado, pedido]));
    evento("conferencia", `romaneio ${rom}`, u, "CORRIGIU VOLUMES", { pedido, antes: p.esperado, contado });
  }
  db().prepare("INSERT INTO conf_volumes (romaneio, pedido, esperado, contado, corrigido, usuario, em) VALUES (?,?,?,?,?,?,?)").run(rom, pedido, p.esperado, contado, contado !== p.esperado ? 1 : 0, u.nome, agora());
  return volumes(rom);
}

// Por pedido, quem começa a separar marca DATSEP no PCP do Lieto (só se vazio). Banco fora do homologado: fica para o fim.
async function marcarSeparando(pedido: number, id: number, u: Usuario) {
  try { await ddl.exigir("conferencia"); await emTransacao((t) => executar(t, "update pedidos1 set datsep = ? where numdoc = ? and datsep is null", [hoje(), pedido])); }
  catch (e) { evento("conferencia", id, u, "DATSEP FICA PARA O FIM", (e as Error).message); }
}

// Em andamento com este usuário ("Você parou aqui")
export function minhas(u: Usuario) {
  return abertas().filter((a) => a.codfun === u.codfun && !a.aguarda_em).sort((a, b) => b.id - a.id).map((a) => {
    const it = JSON.parse(a.itens) as Item[], soma = (f: (i: Item) => number) => r4(it.reduce((s, i) => s + f(i), 0));
    return { id: a.id, pedido: a.pedido, romaneio: a.romaneio, cliente: a.cliente, ...(separando(a) ? { feito: soma((i) => i.con), total: soma((i) => i.qtd) } : { feito: it.filter((i) => final(i) > 0).length, total: it.length }) };
  });
}

// Na contagem cega o coletor não recebe as quantidades do pedido
function vista(c: Row & { itens: Item[] }, gestao = false) {
  const rec = c.status === "RECONTANDO", sep = separando(c);
  const itens = c.itens.filter((i) => gestao || !rec || i.numrec > 0).map((i) => ({ codpro: i.codpro, nompro: i.nompro, unipro: i.unipro, codigos: i.codigos, fatores: i.fatores || {}, contado: rec ? i.rec : i.con, ...(gestao || sep ? { qtd: i.qtd, local: i.local || "", falta: !!i.falta } : {}), ...(gestao ? { con: i.con, rec: i.rec, numrec: i.numrec } : {}) }));
  const ps = c.pedidos ? (JSON.parse(c.pedidos) as Ped[]).map((x) => x.pedido) : null;
  return { pedidos: ps, id: c.id, pedido: c.pedido, romaneio: c.romaneio, cliente: c.cliente, status: c.status, modo: sep ? "SEPARACAO" : "CEGA", bipar: !sep || bipar(), aguarda: !!c.aguarda_em, erro: c.erro, usuario: c.usuario, numide: c.numide, criado_em: c.criado_em, fim_em: c.fim_em, obs: c.obs || "", obs_fim: c.obs_fim || "", itens };
}
export const obter = (id: number, gestao: boolean) => vista(ler(id), gestao);

export async function abrir(b: Row, u: Usuario) {
  const pedido = Number(b.pedido);
  if (!Number.isInteger(pedido) || pedido <= 0) throw new Erro("Pedido inválido.");
  const ja = abertaDe(pedido);
  if (ja) { if (ja.pedido == null) throw new Erro(`Este pedido está na conferência do romaneio ${ja.romaneio} (${ja.usuario}).`); return obter(ja.id, false); }
  const d = await comConexao(async (c) => {
    const p = (await consultar(c, "select a.numdoc, a.sitdoc, a.numrom, b.nomcli from pedidos1 a left join clientes b on b.codcli = a.codcli where a.numdoc = ?", [pedido]))[0];
    if (!p) throw new Erro(`Pedido ${pedido} não encontrado.`, 404);
    if (!["PED", "FAT"].includes(txt(p.SITDOC))) throw new Erro(`Pedido na situação ${txt(p.SITDOC)}: só confere PED ou FAT.`);
    const h = await noLieto(c, pedido);
    if (h) throw new Erro(`Pedido já tem conferência no Lieto (nº ${num(h.NUMIDE)}, ${h.DATCON ? "conferida" : h.DATENC ? "encerrada" : "aberta"}).`);
    const ad = await adicionais(c);
    const its = await consultar(c, "select b.codpro, max(p.nompro) nompro, max(p.unipro) unipro, max(p.codbar) codbar, max(p.coddum) coddum, max(p.eantri) eantri, max(p.locpro) locpro, sum(b.qntpro) q from pedidos2 b join produtos p on p.codpro = b.codpro where b.numdoc = ? and b.baiest = 'S' group by b.codpro order by 2", [pedido]);
    if (!its.length) throw new Erro("Pedido sem itens.");
    return { rom: num(p.NUMROM), cli: txt(p.NOMCLI), itens: its.map((i): Item => ({ codpro: txt(i.CODPRO), nompro: txt(i.NOMPRO), unipro: txt(i.UNIPRO), qtd: r4(num(i.Q)), con: 0, rec: 0, numrec: 0, local: txt(i.LOCPRO),
      codigos: [txt(i.CODPRO), txt(i.CODBAR), txt(i.CODDUM), txt(i.EANTRI), ...cods(ad.get(txt(i.CODPRO)))].filter(Boolean), fatores: fatores(ad.get(txt(i.CODPRO))) })) };
  });
  const modo = modoAtual(), ja2 = abertaDe(pedido); if (ja2) { if (ja2.pedido == null) throw new Erro(`Este pedido está na conferência do romaneio ${ja2.romaneio}.`); return obter(ja2.id, false); }
  const id = Number(db().prepare("INSERT INTO conferencias (pedido, romaneio, cliente, itens, modo, status, codfun, usuario, criado_em) VALUES (?,?,?,?,?,'CONTANDO',?,?,?)").run(pedido, d.rom, d.cli, JSON.stringify(modo === "SEPARACAO" ? [...d.itens].sort(porLocal) : d.itens), modo, u.codfun, u.nome, agora()).lastInsertRowid);
  evento("conferencia", id, u, "ABRIU", { pedido, modo });
  await marcarSeparando(pedido, id, u);
  return obter(id, false);
}

// O que entra e o que fica de fora do romaneio (antes de abrir)
export async function romaneio(rom: number) {
  if (!Number.isInteger(rom) || rom <= 0) throw new Erro("Romaneio inválido.");
  const l = await fila(new URLSearchParams({ romaneio: String(rom) })), ab = romaneioAberto(rom);
  const motivo = (x: Row) => (!["PED", "FAT"].includes(x.situacao) ? `situação ${x.situacao}` : x.conferencia ? x.conferencia.toLowerCase() : x.itens ? "" : "sem itens");
  const todos = l.map((x) => ({ pedido: x.pedido, cliente: x.cliente, motivo: motivo(x) }));
  return { romaneio: rom, aberta: ab ? { id: ab.id, usuario: ab.usuario } : null, entram: todos.filter((x) => !x.motivo), fora: todos.filter((x) => x.motivo) };
}

export async function abrirRomaneio(b: Row, u: Usuario) {
  const rom = Number(b.romaneio), r = await romaneio(rom);
  if (r.aberta) return obter(r.aberta.id, false);
  if (!r.entram.length) throw new Erro(r.fora.length ? "Todos os pedidos deste romaneio já foram conferidos (ou não podem ser)." : "Romaneio sem pedidos.");
  const d = await comConexao(async (c) => {
    const ns = r.entram.map((x) => x.pedido), ad = await adicionais(c);
    const ls = await consultar(c, `select a.numdoc, b.codpro, p.nompro, p.unipro, p.codbar, p.coddum, p.eantri, p.locpro, b.qntpro from pedidos1 a join pedidos2 b on b.numdoc = a.numdoc
      join produtos p on p.codpro = b.codpro where a.numdoc in (${ns.join(",")}) and b.baiest = 'S'`);
    const ps = new Map<number, Ped>(), it = new Map<string, Item>();
    for (const x of ls) {
      const n = num(x.NUMDOC), cod = txt(x.CODPRO), q = num(x.QNTPRO);
      const pe = ps.get(n) ?? { pedido: n, itens: {} }; pe.itens[cod] = r4((pe.itens[cod] || 0) + q); ps.set(n, pe);
      const i = it.get(cod) ?? { codpro: cod, nompro: txt(x.NOMPRO), unipro: txt(x.UNIPRO), qtd: 0, con: 0, rec: 0, numrec: 0, local: txt(x.LOCPRO), codigos: [cod, txt(x.CODBAR), txt(x.CODDUM), txt(x.EANTRI), ...cods(ad.get(cod))].filter(Boolean), fatores: fatores(ad.get(cod)) };
      i.qtd = r4(i.qtd + q); it.set(cod, i);
    }
    return { pedidos: [...ps.values()], itens: [...it.values()].sort((a, b) => a.nompro.localeCompare(b.nompro)) };
  });
  // daqui até o INSERT não há await: ninguém abre um destes pedidos no meio
  const ja = romaneioAberto(rom); if (ja) return obter(ja.id, false);
  const modo = modoAtual(), preso = d.pedidos.find((x) => abertaDe(x.pedido));
  if (preso) throw new Erro(`O pedido ${preso.pedido} acabou de entrar em conferência. Abra o romaneio de novo.`, 409);
  const id = Number(db().prepare("INSERT INTO conferencias (pedido, romaneio, cliente, itens, pedidos, modo, status, codfun, usuario, criado_em) VALUES (NULL,?,?,?,?,?,'CONTANDO',?,?,?)")
    .run(rom, `${d.pedidos.length} pedido(s)${r.fora.length ? `, ${r.fora.length} fora` : ""}`, JSON.stringify(modo === "SEPARACAO" ? [...d.itens].sort(porLocal) : d.itens), JSON.stringify(d.pedidos), modo, u.codfun, u.nome, agora()).lastInsertRowid);
  evento("conferencia", id, u, "ABRIU ROMANEIO", { romaneio: rom, pedidos: d.pedidos.map((x) => x.pedido), fora: r.fora.map((x) => x.pedido) });
  return obter(id, false);
}

// modo "soma" (leitura) ou "fixa" (digitado). uid evita contar duas vezes se a rede cair.
export function contar(id: number, b: Row, u: Usuario) {
  const c = ler(id);
  if (!["CONTANDO", "RECONTANDO"].includes(c.status)) throw new Erro("Conferência já finalizada.");
  const uid = String(b.uid || "").slice(0, 40), cod = chave(b.codigo), q = r4(b.qtd), rec = c.status === "RECONTANDO";
  if (!uid) throw new Erro("Leitura sem identificador.");
  if (db().prepare("SELECT 1 FROM conf_leituras WHERE uid = ?").get(uid)) return vista(c);
  if (c.aguarda_em) throw new Erro("Este pedido está esperando a gestão.");
  if (!Number.isFinite(q) || q < 0 || q > 999999 || (b.modo !== "fixa" && q <= 0)) throw new Erro("Quantidade inválida.");
  const i = c.itens.find((x) => x.codigos.some((y) => chave(y) === cod));
  if (!i) throw new Erro("Este produto não é deste pedido.");
  if (rec && !(i.numrec > 0)) throw new Erro(`${i.nompro} já está certo: não precisa reconferir.`);
  const k = rec ? "rec" : "con", novo = b.modo === "fixa" ? q : r4(i[k] + q);
  if (separando(c)) { if (novo > i.qtd) throw new Erro(`Passa do pedido: são ${i.qtd.toLocaleString("pt-BR")} ${i.unipro}.`); i.falta = false; }
  i[k] = novo;
  db().prepare("INSERT INTO conf_leituras (uid, conf_id, codpro, qtd, modo, usuario, em) VALUES (?,?,?,?,?,?,?)").run(uid, id, i.codpro, q, b.modo === "fixa" ? "FIXA" : "SOMA", u.nome, agora());
  gravarItens(id, c.itens, c.status);
  return vista(c);
}

// Com separação: "não tem" (o que já foi pego fica contado) e voltar a separar antes de a gestão decidir
export function falta(id: number, b: Row, u: Usuario) {
  const c = ler(id), i = c.itens.find((x) => x.codpro === String(b.codpro || ""));
  if (c.status !== "CONTANDO" || c.aguarda_em || !separando(c)) throw new Erro("Só vale na separação em andamento.");
  if (!i) throw new Erro("Este produto não é deste pedido.");
  i.falta = i.con < i.qtd;
  gravarItens(id, c.itens, c.status);
  evento("conferencia", id, u, "NÃO TEM", { codpro: i.codpro, pego: i.con, pedido: i.qtd });
  return vista(ler(id));
}
export function voltar(id: number, u: Usuario) {
  const c = ler(id);
  if (c.status !== "CONTANDO" || !c.aguarda_em || emAndamento.has(id)) throw new Erro("Este pedido não está esperando a gestão.");
  for (const i of c.itens) i.falta = false;
  gravarItens(id, c.itens, c.status);
  db().prepare("UPDATE conferencias SET aguarda_em = NULL WHERE id = ?").run(id);
  evento("conferencia", id, u, "VOLTOU A SEPARAR");
  return obter(id, false);
}

const emAndamento = new Set<number>();
// Fecha a contagem: confere tudo certo -> grava; divergiu -> abre/continua a reconferência só dos divergentes
// Volumes (PEDIDOS1.QNTVOL) de cada pedido, pedidos no fim: sem eles não conclui. 428 = o coletor pergunta e chama de novo.
function lerVolumes(c: Row, v: unknown): Record<string, number> {
  const ps = c.pedido != null ? [c.pedido] : (JSON.parse(c.pedidos) as Ped[]).map((x) => x.pedido), m = (v && typeof v === "object" ? v : {}) as Record<string, unknown>, out: Record<string, number> = {};
  for (const p of ps) { const n = Number(m[p]); if (!Number.isInteger(n) || n < 1 || n > 9999) throw new Erro("Informe os volumes.", 428); out[p] = n; }
  return out;
}
export async function fechar(id: number, u: Usuario, obs?: unknown, vols?: unknown) {
  const c = ler(id);
  if (!["CONTANDO", "RECONTANDO"].includes(c.status)) throw new Erro("Conferência já finalizada.");
  if (c.aguarda_em) throw new Erro("Este pedido está esperando a gestão.");
  guardarObs(id, "obs", obs);
  const div = c.itens.filter((i) => final(i) !== i.qtd);
  if (div.length && separando(c)) {
    const sem = div.filter((i) => !i.falta).length;
    if (sem) throw new Erro(`Falta separar ${sem} item(ns).`);
    db().prepare("UPDATE conferencias SET aguarda_em = ? WHERE id = ?").run(agora(), id);
    evento("conferencia", id, u, "CONCLUIU COM FALTA", div.map((i) => `${i.codpro}: ${i.con} de ${i.qtd}`).join(", "));
    return { ...obter(id, false), divergentes: div.length };
  }
  if (div.length) {
    const primeira = c.status === "CONTANDO"; let n = 0;
    if (primeira) for (const i of div) i.numrec = ++n;
    else for (const i of div) i.rec = 0; // ainda errado: conta de novo
    gravarItens(id, c.itens, "RECONTANDO");
    evento("conferencia", id, u, primeira ? "FOI PARA RECONFERÊNCIA" : "RECONFERÊNCIA AINDA DIVERGENTE", div.map((i) => i.codpro).join(", "));
    return { ...obter(id, false), divergentes: div.length };
  }
  return finalizar(id, u, "CONFERIDA", lerVolumes(c, vols));
}
export const encerrar = (id: number, u: Usuario, obs?: unknown) => { guardarObs(id, "obs_fim", obs); return finalizar(id, u, "ENCERRADA"); };
function guardarObs(id: number, campo: "obs" | "obs_fim", obs: unknown) {
  if (obs !== undefined) db().prepare(`UPDATE conferencias SET ${campo} = ? WHERE id = ? AND status IN ('CONTANDO','RECONTANDO')`).run(limparObs(obs) || null, id);
}

// A conferência não tem campo de observação no Lieto: vai para a observação INTERNA do pedido (OBSINT; a OBSPED pode ir para a NF-e),
// no fim do que já existe. Todo UPDATE em PEDIDOS1 dispara a compensação de estoque, que regrava a data dela: se o pedido já tem
// compensação e não ia ser alterado (DATSEP preenchido), não mexe e a observação fica só aqui.
async function obsInterna(t: Conexao, pedido: number, texto: string) {
  const p = (await consultar(t, "select datsep, obsint from pedidos1 where numdoc = ?", [pedido]))[0];
  if (!p) return false;
  if (p.DATSEP && (await consultar(t, "select first 1 codide from mestoque where obsest starting with ?", [`COMPENS ESTOQUE PEDIDO N.${pedido} `]))[0]) return false;
  const atual = (await lerBlob(p.OBSINT)).trimEnd();
  // consultar: não passa o texto que já existe para maiúsculas
  await consultar(t, `update pedidos1 set obsint = ?${p.DATSEP ? "" : ", datsep = ?"} where numdoc = ?`, [atual ? `${atual}\r\n${texto}` : texto, ...(p.DATSEP ? [] : [hoje()]), pedido]);
  return true;
}

async function finalizar(id: number, u: Usuario, como: "CONFERIDA" | "ENCERRADA", vols?: Record<string, number>) {
  if (emAndamento.has(id)) throw new Erro("Já está gravando.");
  emAndamento.add(id);
  try {
    const c = ler(id);
    if (!["CONTANDO", "RECONTANDO"].includes(c.status)) throw new Erro("Conferência já finalizada.");
    const rom = c.pedido == null, ok = como === "CONFERIDA";
    if (rom && !ok) throw new Erro("Romaneio com divergência não encerra somado: não dá para saber de qual pedido é a diferença. Cancele e confira por pedido.");
    await ddl.exigir("conferencia");
    const peds: Ped[] = rom ? JSON.parse(c.pedidos) : [{ pedido: c.pedido, itens: Object.fromEntries(c.itens.map((x) => [x.codpro, x.qtd])) }];
    const antes = (c.numides ? JSON.parse(c.numides) : {}) as Record<string, number>;
    const soAqui: number[] = [];
    const numides = await emTransacao(async (t) => {
      const hs = new Map<number, number>();
      for (const x of peds) { const h = await noLieto(t, x.pedido); if (h) hs.set(x.pedido, num(h.NUMIDE)); }
      // queda depois do commit: são as nossas se os números batem todos
      if (hs.size === peds.length && peds.every((x) => antes[x.pedido] === hs.get(x.pedido))) return antes;
      if (hs.size) throw new Erro(`Já há conferência no Lieto para: ${[...hs.keys()].join(", ")}. Cancele e abra de novo.`, 409);
      // algum pedido mudou no Lieto durante a contagem?
      for (const x of peds) {
        const at = await consultar(t, "select codpro, sum(qntpro) q from pedidos2 where numdoc = ? and baiest = 'S' group by codpro", [x.pedido]);
        const cab = (await consultar(t, "select numrom, sitdoc from pedidos1 where numdoc = ?", [x.pedido]))[0];
        if (!cab || at.length !== Object.keys(x.itens).length || at.some((y) => x.itens[txt(y.CODPRO)] !== r4(num(y.Q)))) throw new Erro(`O pedido ${x.pedido} foi alterado no Lieto durante a conferência. Cancele e confira de novo.`, 409);
        if (rom && num(cab.NUMROM) !== c.romaneio) throw new Erro(`O pedido ${x.pedido} saiu deste romaneio. Cancele e abra de novo.`, 409);
      }
      let n = num((await consultar(t, "select coalesce(max(numide), 0) n from conferencias1"))[0].N);
      const ids: Record<string, number> = {}; for (const x of peds) ids[x.pedido] = ++n;
      db().prepare("UPDATE conferencias SET numides = ? WHERE id = ?").run(JSON.stringify(ids), id); // antes do commit: permite reconciliar
      const hora = agora().slice(11, 19), ini = new Date(Number(c.criado_em.slice(0, 4)), Number(c.criado_em.slice(5, 7)) - 1, Number(c.criado_em.slice(8, 10)));
      for (const x of peds) {
        const num1 = ids[x.pedido];
        await executar(t, "insert into conferencias1 (numide, numdoc, datdoc, hordoc, codfun, numped, numrom, datcon, horcon, codcon, datenc, horenc, codenc, volcon, nument) values (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 0, 0)",
          [num1, num1, ini, c.criado_em.slice(11, 19), c.codfun, x.pedido, ok ? hoje() : null, ok ? hora : null, ok ? u.codfun : null, ok ? null : hoje(), ok ? null : hora, ok ? null : u.codfun]);
        let k = 0;
        for (const i of c.itens) {
          const q = x.itens[i.codpro];
          if (q === undefined) continue;
          // romaneio: o total bateu, então cada pedido bate. Produto reconferido entra como reconferência (QNTCON 0 + QNTREC), padrão do Lieto.
          const v = rom ? (i.numrec > 0 ? { con: 0, rec: q, nr: ++k } : { con: q, rec: 0, nr: 0 }) : { con: i.con, rec: i.rec, nr: i.numrec }, visto = v.con > 0 || v.nr > 0;
          await executar(t, "insert into conferencias (numdoc, idepro, codpro, qntpro, qntsal, datcon, funcon, horcon, qntcon, numrom, nument, qntrec, idecon, numrec) values (?, 0, ?, ?, 0, ?, ?, ?, ?, 0, 0, ?, ?, ?)",
            [x.pedido, i.codpro, q, visto ? hoje() : null, visto ? u.codfun : null, visto ? hora.slice(0, 5) : null, v.con, v.rec, num1, v.nr]);
        }
        const o = obsErp([c.obs, c.obs_fim].filter(Boolean).join(" | "), 500);
        if (o && !(await obsInterna(t, x.pedido, `CONFERENCIA ${num1}: ${o}`))) soAqui.push(x.pedido);
        // PCP do Lieto: separado (se vazio) e, conferido, DATCON/FUNCON (se vazios) e os volumes
        if (ok) await executar(t, "update pedidos1 set datsep = coalesce(datsep, ?), funcon = case when datcon is null then ? else funcon end, datcon = coalesce(datcon, ?), qntvol = ? where numdoc = ?", [hoje(), u.codfun, hoje(), vols![x.pedido], x.pedido]);
        else await executar(t, "update pedidos1 set datsep = ? where numdoc = ? and datsep is null", [hoje(), x.pedido]);
      }
      return ids;
    });
    const numide = Object.values(numides)[0];
    db().prepare("UPDATE conferencias SET status = ?, erro = NULL, numide = ?, fim_em = ?, fim_por = ? WHERE id = ?").run(como, numide, agora(), u.nome, id);
    evento("conferencia", id, u, como === "CONFERIDA" ? "CONFERIU" : "ENCERROU COM DIVERGÊNCIA", numides);
    if (soAqui.length) evento("conferencia", id, u, "OBSERVAÇÃO FICOU SÓ AQUI", soAqui.join(", "));
    return { ...obter(id, false), divergentes: 0 };
  } catch (e) {
    db().prepare("UPDATE conferencias SET erro = ? WHERE id = ?").run((e as Error).message, id);
    throw e;
  } finally { emAndamento.delete(id); }
}

export async function cancelar(id: number, u: Usuario, obs?: unknown) {
  if (emAndamento.has(id)) throw new Erro("Está gravando.");
  const c = ler(id);
  if (!["CONTANDO", "RECONTANDO"].includes(c.status)) throw new Erro("Conferência já finalizada.");
  const ids = Object.entries((c.numides ? JSON.parse(c.numides) : {}) as Record<string, number>);
  if (ids.length && num((await comConexao((t) => noLieto(t, Number(ids[0][0]))))?.NUMIDE) === ids[0][1]) throw new Erro("Esta conferência já está no Lieto: feche de novo para reconciliar.");
  db().prepare("UPDATE conferencias SET status = 'CANCELADA', fim_em = ?, fim_por = ?, obs_fim = ? WHERE id = ?").run(agora(), u.nome, limparObs(obs) || null, id);
  evento("conferencia", id, u, "CANCELOU", limparObs(obs));
}
export const listar = () => (db().prepare("SELECT * FROM conferencias ORDER BY id DESC LIMIT 1000").all() as Row[]).map((c) => {
  const it = JSON.parse(c.itens) as Item[];
  return { id: c.id, pedido: c.pedido, romaneio: c.romaneio, cliente: c.cliente, status: c.status, modo: c.modo || "CEGA", aguarda: !!c.aguarda_em, usuario: c.usuario, criado_em: c.criado_em, fim_em: c.fim_em, numide: c.numide, erro: c.erro, pedidos: c.pedidos ? (JSON.parse(c.pedidos) as Ped[]).length : 1, itens: it.length, divergentes: it.filter((i) => final(i) !== i.qtd).length };
});
