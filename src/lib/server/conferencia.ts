// Conferência de expedição por pedido (a fila pode ser aberta por romaneio), gravada nas tabelas do próprio Lieto.
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
import { comConexao, consultar, emTransacao, executar, hoje, lerBlob, num, txt, type Conexao } from "./fb";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Ped = { pedido: number; itens: Record<string, number> };
type Item = { codpro: string; nompro: string; unipro: string; qtd: number; codigos: string[]; fatores?: Record<string, number>; con: number; rec: number; numrec: number };

const abertas = () => db().prepare("SELECT id, usuario, pedido, romaneio, pedidos FROM conferencias WHERE status IN ('CONTANDO','RECONTANDO')").all() as Row[];
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

// Fila: pedidos de um romaneio, um pedido, ou os pendentes sem conferência
export async function fila(q: URLSearchParams) {
  const rom = Number(q.get("romaneio") || 0), ped = Number(q.get("pedido") || 0);
  return comConexao(async (c) => {
    const filtro = rom ? "a.numrom = ?" : ped ? "a.numdoc = ?" : "a.sitdoc = 'PED' and a.datfat is null";
    const l = await consultar(c, `select first 300 a.numdoc, a.numrom, a.sitdoc, a.datdoc, b.nomcli, (select count(*) from pedidos2 x where x.numdoc = a.numdoc and x.baiest = 'S') n,
      (select max(h.numide) from conferencias1 h where h.numped = a.numdoc) h from pedidos1 a left join clientes b on b.codcli = a.codcli where ${filtro} order by a.numrom desc, a.numdoc`, rom || ped ? [rom || ped] : []);
    const hs = l.map((x) => num(x.H)).filter(Boolean), est = new Map<number, string>();
    if (hs.length) for (const h of await consultar(c, `select numide, datcon, datenc from conferencias1 where numide in (${hs.join(",")})`)) est.set(num(h.NUMIDE), h.DATCON ? "CONFERIDA" : h.DATENC ? "ENCERRADA" : "ABERTA NO LIETO");
    return l.map((x) => { const a = abertaDe(num(x.NUMDOC)); return { pedido: num(x.NUMDOC), romaneio: num(x.NUMROM), situacao: txt(x.SITDOC), data: x.DATDOC, cliente: txt(x.NOMCLI), itens: num(x.N), conferencia: a ? "EM ANDAMENTO" : est.get(num(x.H)) || "", usuario: a ? `${a.usuario}${a.pedido == null ? ` (romaneio ${a.romaneio})` : ""}` : "", id: a && a.pedido != null ? a.id : null, noRomaneio: !!a && a.pedido == null }; });
  });
}

// O coletor não recebe as quantidades do pedido (contagem cega)
function vista(c: Row & { itens: Item[] }, gestao = false) {
  const rec = c.status === "RECONTANDO";
  const itens = c.itens.filter((i) => gestao || !rec || i.numrec > 0).map((i) => ({ codpro: i.codpro, nompro: i.nompro, unipro: i.unipro, codigos: i.codigos, fatores: i.fatores || {}, contado: rec ? i.rec : i.con, ...(gestao ? { qtd: i.qtd, con: i.con, rec: i.rec, numrec: i.numrec } : {}) }));
  const ps = c.pedidos ? (JSON.parse(c.pedidos) as Ped[]).map((x) => x.pedido) : null;
  return { pedidos: ps, id: c.id, pedido: c.pedido, romaneio: c.romaneio, cliente: c.cliente, status: c.status, erro: c.erro, usuario: c.usuario, numide: c.numide, criado_em: c.criado_em, fim_em: c.fim_em, obs: c.obs || "", obs_fim: c.obs_fim || "", itens };
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
    const its = await consultar(c, "select b.codpro, max(p.nompro) nompro, max(p.unipro) unipro, max(p.codbar) codbar, max(p.coddum) coddum, max(p.eantri) eantri, sum(b.qntpro) q from pedidos2 b join produtos p on p.codpro = b.codpro where b.numdoc = ? and b.baiest = 'S' group by b.codpro order by 2", [pedido]);
    if (!its.length) throw new Erro("Pedido sem itens.");
    return { rom: num(p.NUMROM), cli: txt(p.NOMCLI), itens: its.map((i): Item => ({ codpro: txt(i.CODPRO), nompro: txt(i.NOMPRO), unipro: txt(i.UNIPRO), qtd: r4(num(i.Q)), con: 0, rec: 0, numrec: 0,
      codigos: [txt(i.CODPRO), txt(i.CODBAR), txt(i.CODDUM), txt(i.EANTRI), ...cods(ad.get(txt(i.CODPRO)))].filter(Boolean), fatores: fatores(ad.get(txt(i.CODPRO))) })) };
  });
  const ja2 = abertaDe(pedido); if (ja2) { if (ja2.pedido == null) throw new Erro(`Este pedido está na conferência do romaneio ${ja2.romaneio}.`); return obter(ja2.id, false); }
  const id = Number(db().prepare("INSERT INTO conferencias (pedido, romaneio, cliente, itens, status, codfun, usuario, criado_em) VALUES (?,?,?,?,'CONTANDO',?,?,?)").run(pedido, d.rom, d.cli, JSON.stringify(d.itens), u.codfun, u.nome, agora()).lastInsertRowid);
  evento("conferencia", id, u, "ABRIU", { pedido });
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
    const ls = await consultar(c, `select a.numdoc, b.codpro, p.nompro, p.unipro, p.codbar, p.coddum, p.eantri, b.qntpro from pedidos1 a join pedidos2 b on b.numdoc = a.numdoc
      join produtos p on p.codpro = b.codpro where a.numdoc in (${ns.join(",")}) and b.baiest = 'S'`);
    const ps = new Map<number, Ped>(), it = new Map<string, Item>();
    for (const x of ls) {
      const n = num(x.NUMDOC), cod = txt(x.CODPRO), q = num(x.QNTPRO);
      const pe = ps.get(n) ?? { pedido: n, itens: {} }; pe.itens[cod] = r4((pe.itens[cod] || 0) + q); ps.set(n, pe);
      const i = it.get(cod) ?? { codpro: cod, nompro: txt(x.NOMPRO), unipro: txt(x.UNIPRO), qtd: 0, con: 0, rec: 0, numrec: 0, codigos: [cod, txt(x.CODBAR), txt(x.CODDUM), txt(x.EANTRI), ...cods(ad.get(cod))].filter(Boolean), fatores: fatores(ad.get(cod)) };
      i.qtd = r4(i.qtd + q); it.set(cod, i);
    }
    return { pedidos: [...ps.values()], itens: [...it.values()].sort((a, b) => a.nompro.localeCompare(b.nompro)) };
  });
  // daqui até o INSERT não há await: ninguém abre um destes pedidos no meio
  const ja = romaneioAberto(rom); if (ja) return obter(ja.id, false);
  const preso = d.pedidos.find((x) => abertaDe(x.pedido));
  if (preso) throw new Erro(`O pedido ${preso.pedido} acabou de entrar em conferência. Abra o romaneio de novo.`, 409);
  const id = Number(db().prepare("INSERT INTO conferencias (pedido, romaneio, cliente, itens, pedidos, status, codfun, usuario, criado_em) VALUES (NULL,?,?,?,?,'CONTANDO',?,?,?)")
    .run(rom, `${d.pedidos.length} pedido(s)${r.fora.length ? `, ${r.fora.length} fora` : ""}`, JSON.stringify(d.itens), JSON.stringify(d.pedidos), u.codfun, u.nome, agora()).lastInsertRowid);
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
  if (!Number.isFinite(q) || q < 0 || q > 999999 || (b.modo !== "fixa" && q <= 0)) throw new Erro("Quantidade inválida.");
  const i = c.itens.find((x) => x.codigos.some((y) => chave(y) === cod));
  if (!i) throw new Erro("Este produto não é deste pedido.");
  if (rec && !(i.numrec > 0)) throw new Erro(`${i.nompro} já está certo: não precisa reconferir.`);
  const k = rec ? "rec" : "con";
  i[k] = b.modo === "fixa" ? q : r4(i[k] + q);
  db().prepare("INSERT INTO conf_leituras (uid, conf_id, codpro, qtd, modo, usuario, em) VALUES (?,?,?,?,?,?,?)").run(uid, id, i.codpro, q, b.modo === "fixa" ? "FIXA" : "SOMA", u.nome, agora());
  gravarItens(id, c.itens, c.status);
  return vista(c);
}

const emAndamento = new Set<number>();
// Fecha a contagem: confere tudo certo -> grava; divergiu -> abre/continua a reconferência só dos divergentes
export async function fechar(id: number, u: Usuario, obs?: unknown) {
  const c = ler(id);
  if (!["CONTANDO", "RECONTANDO"].includes(c.status)) throw new Erro("Conferência já finalizada.");
  guardarObs(id, "obs", obs);
  const div = c.itens.filter((i) => final(i) !== i.qtd);
  if (div.length) {
    const primeira = c.status === "CONTANDO"; let n = 0;
    if (primeira) for (const i of div) i.numrec = ++n;
    else for (const i of div) i.rec = 0; // ainda errado: conta de novo
    gravarItens(id, c.itens, "RECONTANDO");
    evento("conferencia", id, u, primeira ? "FOI PARA RECONFERÊNCIA" : "RECONFERÊNCIA AINDA DIVERGENTE", div.map((i) => i.codpro).join(", "));
    return { ...obter(id, false), divergentes: div.length };
  }
  return finalizar(id, u, "CONFERIDA");
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

async function finalizar(id: number, u: Usuario, como: "CONFERIDA" | "ENCERRADA") {
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
        await executar(t, "update pedidos1 set datsep = ? where numdoc = ? and datsep is null", [hoje(), x.pedido]);
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
  return { id: c.id, pedido: c.pedido, romaneio: c.romaneio, cliente: c.cliente, status: c.status, usuario: c.usuario, criado_em: c.criado_em, fim_em: c.fim_em, numide: c.numide, erro: c.erro, pedidos: c.pedidos ? (JSON.parse(c.pedidos) as Ped[]).length : 1, itens: it.length, divergentes: it.filter((i) => final(i) !== i.qtd).length };
});
