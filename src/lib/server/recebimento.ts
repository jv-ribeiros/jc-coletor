// Recebimento de compra: o coletor confere o que chegou contra o pedido de compra do Lieto (COMPRAS1/COMPRAS2).
// Nada é gravado no Lieto. A contagem fica aqui; a nota de entrada (ENTRADAS1), lançada no Lieto como hoje, é vinculada depois
// no painel: sozinha, quando a DANFE bipada na abertura bate com ENTRADAS1.CHANFE, ou escolhida entre as sugestões.
// O Lieto não liga a nota ao pedido (ENTRADAS2.IDECOM/IDEPRO vêm 0), por isso o vínculo é recebimento ↔ nota, feito aqui.
// Dois modos, do usuário (liberação "Recebimento: ver quantidade do pedido"; administrador vê sempre), congelados na abertura:
//   CEGA    não vê o pedido. Fechou com diferença: reconta do zero só o que divergiu; continuou diferente, o escritório decide.
//   COMQTD  vê quanto o pedido tem e quanto falta. Sem recontagem: a diferença vai direto para o escritório.
// Validade na 1ª leitura de cada produto (lote opcional; "sem validade" fica lembrado por produto). Fora do pedido conta e marca;
// código sem cadastro anota e segue. Situações: CONTANDO · RECONTANDO · CONFERIDO · DIFERENCA · ENCERRADO · CANCELADO.
// Assumido até haver pedidos reais na base (L1/L2): entra na fila o pedido liberado (DATLIB) e não encerrado nem baixado
// (DATENC, DATBAI); a quantidade é a QNTBAS (convertida para a unidade do produto, que é a do coletor) ou, sem ela, a QNTPED.
import { db } from "./db";
import { adicionais, cods, fatores } from "./cadastro";
import { ve } from "./permissoes";
import { Erro, agora, chave, evento, limparObs, r4, type Usuario } from "./comum";
import { comConexao, consultar, dataDe, iso, lerBlob, num, txt, type Conexao } from "./fb";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Modo = "CEGA" | "COMQTD";
// "validade|lote" -> quantidade. Validade "AAAA-MM" ou "AAAA-MM-DD"; vazia = sem validade
type Vals = Record<string, number>;
type Item = { codpro: string; nompro: string; unipro: string; qtd: number; codigos: string[]; fatores?: Record<string, number>; con: number; rec: number; numrec: number;
  vals: Vals; vals2: Vals; recontar?: boolean; falta?: boolean; fora?: boolean; semcad?: boolean };
type Rec = Row & { itens: Item[] };
const ABERTOS = ["CONTANDO", "RECONTANDO"], FINAIS = ["CONFERIDO", "DIFERENCA", "ENCERRADO"];
const doPedido = (i: Item) => !i.fora && !i.semcad;
const final = (i: Item) => (i.numrec > 0 ? i.rec : i.con);
const valsFinal = (i: Item) => (i.numrec > 0 ? i.vals2 : i.vals);
const soma = (v: Vals) => r4(Object.values(v).reduce((s, x) => s + x, 0));
const dia = (v: unknown) => (v instanceof Date ? iso(v) : v ? String(v).slice(0, 10) : "");
const opcao = (k: string) => (db().prepare("SELECT valor FROM opcoes WHERE chave = ?").get(k) as Row | undefined)?.valor as string | undefined;
const gravarOpcao = (k: string, v: string) => db().prepare("INSERT INTO opcoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(k, v);
const VAL = /^\d{4}-\d{2}(-\d{2})?$/;
const acha = (its: Item[], cod: string) => its.find((x) => x.codigos.some((y) => chave(y) === cod));

const ler = (id: number): Rec => {
  const r = db().prepare("SELECT * FROM recebimentos WHERE id = ?").get(id) as Row | undefined;
  if (!r) throw new Erro("Recebimento não encontrado.", 404);
  return { ...r, itens: JSON.parse(r.itens) as Item[] };
};
const gravar = (id: number, itens: Item[]) => db().prepare("UPDATE recebimentos SET itens = ? WHERE id = ?").run(JSON.stringify(itens), id);
const aberto = (pedido: number) => db().prepare("SELECT id FROM recebimentos WHERE pedido = ? AND status IN ('CONTANDO','RECONTANDO')").get(pedido) as Row | undefined;
// o último recebimento de cada pedido diz onde ele está: aberto, recebido (sai da fila) ou encerrado com "o restante ainda vem" (volta)
function situacoes() {
  const m = new Map<number, Row>();
  for (const r of db().prepare("SELECT id, pedido, status, restante, codfun, usuario, fechado_em, rec_em FROM recebimentos WHERE status <> 'CANCELADO' ORDER BY id").all() as Row[]) m.set(r.pedido, r);
  return m;
}
const jaRecebido = (s?: Row) => !!s && FINAIS.includes(s.status) && !(s.status === "ENCERRADO" && s.restante);
// o que já chegou deste pedido nos recebimentos encerrados com "o restante ainda vem"
function chegouAntes(pedido: number) {
  const m = new Map<string, number>();
  for (const r of db().prepare("SELECT itens FROM recebimentos WHERE pedido = ? AND status = 'ENCERRADO' AND restante = 1").all(pedido) as Row[])
    for (const i of JSON.parse(r.itens) as Item[]) if (doPedido(i)) m.set(i.codpro, r4((m.get(i.codpro) || 0) + final(i)));
  return m;
}
const semValidade = (cs: string[]) => new Set(cs.length ? (db().prepare(`SELECT codpro FROM sem_validade WHERE codpro IN (${cs.map(() => "?").join(",")})`).all(...cs) as Row[]).map((x) => x.codpro as string) : []);

// ---------- Lieto (só leitura) ----------
const CAB = `a.numdoc, a.codfor, a.datdoc, a.pedfor, a.datlib, a.datenc, a.datbai, f.nomfor, f.nomfan, f.cgccpf,
  (select count(distinct b.codpro) from compras2 b where b.numdoc = a.numdoc) n, (select min(b.datpre) from compras2 b where b.numdoc = a.numdoc) prev`;
const DE_COMPRA = "from compras1 a left join fornecedores f on f.codfor = a.codfor";
// NOMFAN tem 30 letras: cheio, quase sempre foi cortado ("A SHINE PET COMERCIO DE PRODUT"), e a razão social diz melhor
const nomeFor = (x: Row) => { const fan = txt(x.NOMFAN), raz = txt(x.NOMFOR); return (fan && (fan.length < 30 || !raz) ? fan : raz || fan) || (x.CODFOR ? `Fornecedor ${num(x.CODFOR)}` : ""); };
const cnpjFmt = (d: string) => `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
function motivo(x: Row, s?: Row) {
  if (!x.DATLIB) return "Este pedido ainda não foi liberado no Lieto.";
  if (x.DATENC) return "Este pedido está encerrado no Lieto.";
  if (x.DATBAI) return "Este pedido já foi baixado no Lieto.";
  if (jaRecebido(s)) return `Este pedido já foi recebido (${s!.usuario}, ${String(s!.rec_em || s!.fechado_em || "").slice(8, 10)}/${String(s!.rec_em || s!.fechado_em || "").slice(5, 7)}).`;
  return "";
}
async function itensPedido(c: Conexao, n: number, comCodigos: boolean): Promise<Item[]> {
  const ad = comCodigos ? await adicionais(c) : null;
  const l = await consultar(c, `select b.codpro, coalesce(max(p.nompro), max(b.nompro)) nompro, coalesce(max(p.unipro), max(b.unibas), max(b.unipro)) unipro, max(p.codbar) codbar, max(p.coddum) coddum,
    max(p.eantri) eantri, sum(case when b.qntbas > 0 then b.qntbas else b.qntped end) q from compras2 b left join produtos p on p.codpro = b.codpro where b.numdoc = ? group by b.codpro order by 2`, [n]);
  return l.map((i) => { const cod = txt(i.CODPRO); return { codpro: cod, nompro: txt(i.NOMPRO), unipro: txt(i.UNIPRO), qtd: r4(num(i.Q)), con: 0, rec: 0, numrec: 0, vals: {}, vals2: {},
    codigos: [cod, txt(i.CODBAR), txt(i.CODDUM), txt(i.EANTRI), ...cods(ad?.get(cod))].filter(Boolean), fatores: fatores(ad?.get(cod)) }; });
}
// Produto de qualquer código que os coletores leem (o mesmo que o Cadastro procura)
async function produtoDoCodigo(cod: string) {
  return comConexao(async (c) => {
    const x = (await consultar(c, `select first 1 p.codpro, p.nompro, p.unipro, p.codbar, p.coddum, p.eantri from produtos p where p.codpro = ? or p.codbar = ? or p.coddum = ? or p.eantri = ?
      or exists (select 1 from produtossimilares s where s.codpro = p.codpro and s.codbar = ? and s.proati = 'S')`, [cod.slice(0, 20), cod, cod.slice(0, 14), cod, cod]))[0];
    if (!x) return null;
    const ad = await adicionais(c), cp = txt(x.CODPRO);
    return { codpro: cp, nompro: txt(x.NOMPRO), unipro: txt(x.UNIPRO), codigos: [cp, txt(x.CODBAR), txt(x.CODDUM), txt(x.EANTRI), ...cods(ad.get(cp))].filter(Boolean), fatores: fatores(ad.get(cp)) };
  });
}
// Chave da NF-e: 44 números com dígito verificador (módulo 11). Pega leitura trocada (código de produto, boleto).
function chaveValida(ch: string) {
  if (!/^\d{44}$/.test(ch)) return false;
  let s = 0, p = 2;
  for (let k = 42; k >= 0; k--) { s += Number(ch[k]) * p; p = p === 9 ? 2 : p + 1; }
  const dv = s % 11 < 2 ? 0 : 11 - (s % 11);
  return dv === Number(ch[43]);
}
const numeroDaChave = (ch: string) => String(Number(ch.slice(25, 34)));

// ---------- coletor ----------
function linha(x: Row, s: Row | undefined, u: Usuario) {
  const ab = s && ABERTOS.includes(s.status) ? s : null;
  return { pedido: num(x.NUMDOC), fornecedor: nomeFor(x), pedfor: txt(x.PEDFOR), previsto: dia(x.PREV), emissao: dia(x.DATDOC), itens: num(x.N),
    aberto: ab ? { id: ab.id, usuario: ab.usuario, meu: ab.codfun === u.codfun, recontagem: ab.status === "RECONTANDO" } : null,
    restante: !!s && s.status === "ENCERRADO" && !!s.restante, recebido: jaRecebido(s) };
}
// Fila: os pedidos que ainda esperam mercadoria, o que está com você primeiro e depois pela data prevista.
// q = nº do pedido (ou o do fornecedor), nome do fornecedor, ou a chave da DANFE bipada (acha o fornecedor pelo CNPJ).
export async function fila(q: URLSearchParams, u: Usuario) {
  const b = (q.get("q") || "").trim(), d = b.replace(/\D/g, ""), B = b.toUpperCase();
  return comConexao(async (c) => {
    let where = "a.datlib is not null and a.datenc is null and a.datbai is null", args: unknown[] = [];
    if (d.length === 44 && d === b) { const cnpj = d.slice(6, 20); where += " and (f.cgccpf = ? or f.cgccpf = ?)"; args = [cnpj, cnpjFmt(cnpj)]; }
    else if (/^\d{1,9}$/.test(b)) { where += " and (a.numdoc = ? or a.pedfor = ?)"; args = [Number(b), b]; }
    else if (b.length > 1) { where += " and (upper(f.nomfor) containing ? or upper(f.nomfan) containing ? or upper(a.pedfor) containing ?)"; args = [B, B, B]; }
    const st = situacoes(), busca = !!args.length;
    const l = (await consultar(c, `select first 300 ${CAB} ${DE_COMPRA} where ${where} order by a.numdoc`, args)).map((x) => linha(x, st.get(num(x.NUMDOC)), u)).filter((x) => busca || !x.recebido);
    const ordem = (x: Row) => (x.aberto?.meu ? 0 : x.aberto ? 1 : 2);
    return l.sort((x, y) => ordem(x) - ordem(y) || Number(!x.previsto) - Number(!y.previsto) || x.previsto.localeCompare(y.previsto) || x.pedido - y.pedido);
  });
}

// Ficha antes de começar: o nº que o fornecedor usa (vem na nota), previsão, quantos produtos e a observação. Não abre nada.
export async function ficha(n: number, u: Usuario) {
  return comConexao(async (c) => {
    const x = (await consultar(c, `select ${CAB}, a.observ ${DE_COMPRA} where a.numdoc = ?`, [n]))[0];
    if (!x) throw new Erro(`Pedido de compra ${n} não encontrado.`, 404);
    const s = situacoes().get(n), l = linha(x, s, u), antes = l.restante ? chegouAntes(n) : null;
    const produtos = antes ? (await itensPedido(c, n, false)).filter((i) => i.qtd - (antes.get(i.codpro) || 0) > 0).length : l.itens;
    return { ...l, produtos, obs: (await lerBlob(x.OBSERV)).trim(), bloqueio: l.aberto ? "" : motivo(x, s) };
  });
}

export async function abrir(b: Row, u: Usuario) {
  const pedido = Number(b.pedido), ch = String(b.chave || "").replace(/\D/g, "");
  if (!Number.isInteger(pedido) || pedido <= 0) throw new Erro("Pedido inválido.");
  if (ch && !chaveValida(ch)) throw new Erro("Isto não é a chave de uma nota fiscal. Bipe o código de barras da DANFE, o maior da folha.");
  const ja = aberto(pedido);
  if (ja) return obter(ja.id);
  if (ch) { const outro = db().prepare("SELECT pedido FROM recebimentos WHERE chave_nfe = ? AND status <> 'CANCELADO'").get(ch) as Row | undefined; if (outro) throw new Erro(`Esta nota já está no recebimento do pedido ${outro.pedido}.`); }
  const d = await comConexao(async (c) => {
    const x = (await consultar(c, `select ${CAB} ${DE_COMPRA} where a.numdoc = ?`, [pedido]))[0];
    if (!x) throw new Erro(`Pedido de compra ${pedido} não encontrado.`, 404);
    const m = motivo(x, situacoes().get(pedido)); if (m) throw new Erro(m);
    const cnpj = txt(x.CGCCPF).replace(/\D/g, "");
    if (ch && cnpj.length === 14 && ch.slice(6, 20) !== cnpj) throw new Erro(`Esta nota é de outro fornecedor, não da ${nomeFor(x)}. Confira a DANFE.`);
    return { x, its: await itensPedido(c, pedido, true) };
  });
  // daqui até o INSERT não há await: ninguém abre o mesmo pedido no meio
  const ja2 = aberto(pedido); if (ja2) return obter(ja2.id);
  const antes = chegouAntes(pedido), itens = d.its.map((i) => ({ ...i, qtd: r4(i.qtd - (antes.get(i.codpro) || 0)) })).filter((i) => i.qtd > 0);
  if (!itens.length) throw new Erro(d.its.length ? "Já chegou tudo deste pedido." : "Pedido sem produtos.");
  const origem = antes.size ? (db().prepare("SELECT MAX(id) id FROM recebimentos WHERE pedido = ? AND status = 'ENCERRADO' AND restante = 1").get(pedido) as Row).id : null;
  const modo: Modo = ve(u, "recebimento_ver") ? "COMQTD" : "CEGA";
  const id = Number(db().prepare("INSERT INTO recebimentos (pedido, codfor, fornecedor, pedfor, itens, modo, status, codfun, usuario, criado_em, origem, chave_nfe) VALUES (?,?,?,?,?,?,'CONTANDO',?,?,?,?,?)")
    .run(pedido, num(d.x.CODFOR), nomeFor(d.x), txt(d.x.PEDFOR), JSON.stringify(itens), modo, u.codfun, u.nome, agora(), origem, ch || null).lastInsertRowid);
  evento("recebimento", id, u, "ABRIU", { pedido, modo, ...(ch ? { chave: ch } : {}), ...(origem ? { restanteDe: origem } : {}) });
  return obter(id);
}

// O coletor recebe a quantidade do pedido só no modo com quantidade; na recontagem, só o que é para recontar
function vista(r: Rec) {
  const rec = r.status === "RECONTANDO", cq = r.modo === "COMQTD", sv = semValidade(r.itens.map((i) => i.codpro)), ped = r.itens.filter(doPedido);
  const itens = r.itens.filter((i) => !rec || i.recontar).map((i) => ({ codpro: i.codpro, nompro: i.nompro, unipro: i.unipro, codigos: i.codigos, fatores: i.fatores || {},
    contado: rec ? i.rec : i.con, vals: rec ? i.vals2 : i.vals, semValidade: sv.has(i.codpro), fora: !!i.fora, semcad: !!i.semcad, falta: !!i.falta, ...(cq ? { qtd: i.qtd } : {}) }));
  const fim = FINAIS.includes(r.status) || r.status === "CANCELADO";
  return { id: r.id, pedido: r.pedido, fornecedor: r.fornecedor, pedfor: r.pedfor || "", status: r.status, modo: r.modo, usuario: r.usuario, criado_em: r.criado_em, fechado_em: r.fechado_em, rec_em: r.rec_em,
    nota: r.nota ? `NF ${JSON.parse(r.nota).numnot}` : r.chave_nfe ? `${Number(numeroDaChave(r.chave_nfe)).toLocaleString("pt-BR")} (bipada)` : "", itens,
    ...(fim ? { lidos: r.itens.filter((i) => final(i) > 0).length, divergentes: ped.filter((i) => final(i) !== i.qtd).length + r.itens.filter((i) => !doPedido(i) && i.con > 0).length } : {}) };
}
export const obter = (id: number) => vista(ler(id));

// "Você parou aqui": recebimento aberto por este usuário (produtos lidos, nunca quantidade)
export function minhas(u: Usuario) {
  return (db().prepare("SELECT * FROM recebimentos WHERE status IN ('CONTANDO','RECONTANDO') AND codfun = ? ORDER BY id DESC").all(u.codfun) as Row[]).map((x) => {
    const its = (JSON.parse(x.itens) as Item[]), rec = x.status === "RECONTANDO", l = its.filter((i) => (rec ? i.recontar : doPedido(i)));
    return { id: x.id, pedido: x.pedido, fornecedor: x.fornecedor, recontagem: rec, feito: l.filter((i) => (rec ? i.rec : i.con) > 0).length, total: l.length };
  });
}

// Código que não é do pedido: produto cadastrado (fora do pedido) ou sem cadastro. O coletor pergunta antes de contar.
export async function codigo(id: number, cod: string) {
  const r = ler(id), k = chave(cod), i = acha(r.itens, k);
  if (i) return { codpro: i.codpro };
  const p = await produtoDoCodigo(String(cod).trim().toUpperCase());
  return p ? { produto: p } : { semcadastro: true };
}

// Leitura: modo "soma" (bipou ou +1) ou "fixa" (digitou: quanto tem DESTA validade). uid evita contar duas vezes se a rede cair.
export async function contar(id: number, b: Row, u: Usuario) {
  let r = ler(id);
  if (!ABERTOS.includes(r.status)) throw new Erro("Este recebimento já foi fechado.");
  const uid = String(b.uid || "").slice(0, 40), bruto = String(b.codigo || "").trim().toUpperCase(), cod = chave(bruto), q = r4(b.qtd), fixa = b.modo === "fixa", rec = r.status === "RECONTANDO";
  if (!uid) throw new Erro("Leitura sem identificador.");
  if (db().prepare("SELECT 1 FROM rec_leituras WHERE uid = ?").get(uid)) return vista(r);
  if (!cod) throw new Erro("Código vazio.");
  if (!Number.isFinite(q) || q < 0 || q > 999999 || (!fixa && q <= 0)) throw new Erro("Quantidade inválida.");
  const validade = String(b.validade ?? ""), lote = String(b.lote ?? "").trim().toUpperCase().replace(/\s+/g, " ").slice(0, 20);
  if (validade && !VAL.test(validade)) throw new Erro("Validade inválida.");
  let i = acha(r.itens, cod);
  if (!i) {
    if (rec) throw new Erro("Este produto não está na recontagem.");
    if (!b.fora && !b.semcad) throw new Erro("Este produto não é deste pedido.");
    const p = await produtoDoCodigo(bruto);
    r = ler(id); // pode ter mudado durante a consulta
    if (!ABERTOS.includes(r.status)) throw new Erro("Este recebimento já foi fechado.");
    i = acha(r.itens, cod) || (p ? r.itens.find((x) => x.codpro === p.codpro) : undefined);
    if (!i) { i = p ? { ...p, qtd: 0, con: 0, rec: 0, numrec: 0, vals: {}, vals2: {}, fora: true } : { codpro: `?${cod}`, nompro: "Código sem cadastro", unipro: "", qtd: 0, codigos: [bruto], con: 0, rec: 0, numrec: 0, vals: {}, vals2: {}, semcad: true }; r.itens.push(i); }
  }
  if (rec && !i.recontar) throw new Erro(`${i.nompro} não está na recontagem.`);
  const v = rec ? i.vals2 : i.vals, k = i.semcad ? "|" : `${validade}|${lote}`;
  v[k] = fixa ? q : r4((v[k] || 0) + q);
  if (!v[k]) delete v[k];
  i[rec ? "rec" : "con"] = soma(v);
  if (q > 0) i.falta = false;
  if (!i.semcad && b.semValidade) db().prepare("INSERT OR IGNORE INTO sem_validade (codpro, por, em) VALUES (?,?,?)").run(i.codpro, u.nome, agora());
  else if (!i.semcad && validade) db().prepare("DELETE FROM sem_validade WHERE codpro = ?").run(i.codpro);
  db().prepare("INSERT INTO rec_leituras (uid, rec_id, codpro, codigo, qtd, modo, validade, lote, etapa, usuario, em) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(uid, id, i.codpro, bruto, q, fixa ? "FIXA" : "SOMA", validade || null, lote || null, rec ? 2 : 1, u.nome, agora());
  gravar(id, r.itens);
  return vista(r);
}

// Com quantidade: "Não veio o resto" marca a falta (o escritório vê) e o coletor passa ao próximo
export function falta(id: number, b: Row, u: Usuario) {
  const r = ler(id), i = r.itens.find((x) => x.codpro === String(b.codpro || ""));
  if (r.status !== "CONTANDO" || r.modo !== "COMQTD") throw new Erro("Só vale na contagem com quantidade.");
  if (!i || !doPedido(i)) throw new Erro("Este produto não é deste pedido.");
  i.falta = b.falta !== false && i.con < i.qtd;
  gravar(id, r.itens);
  evento("recebimento", id, u, i.falta ? "NÃO VEIO O RESTO" : "DESMARCOU FALTA", { codpro: i.codpro, chegou: i.con, pedido: i.qtd });
  return obter(id);
}

// Fecha a contagem. Cega com diferença, na 1ª vez: reconta (do zero) só os produtos que divergiram, sem dizer quanto nem para que lado.
// Senão: tudo bateu = CONFERIDO; o resto (inclusive fora do pedido e sem cadastro) = DIFERENCA, para o escritório.
export function fechar(id: number, u: Usuario) {
  const r = ler(id);
  if (!ABERTOS.includes(r.status)) throw new Erro("Este recebimento já foi fechado.");
  const rec = r.status === "RECONTANDO", div = r.itens.filter((i) => doPedido(i) && final(i) !== i.qtd), h = agora();
  if (!rec && r.modo === "CEGA" && div.length) {
    let n = 0;
    for (const i of div) { i.numrec = ++n; i.recontar = true; i.rec = 0; i.vals2 = {}; }
    db().prepare("UPDATE recebimentos SET itens = ?, status = 'RECONTANDO', fechado_em = ? WHERE id = ?").run(JSON.stringify(r.itens), h, id);
    evento("recebimento", id, u, "FOI PARA RECONTAGEM", div.map((i) => i.codpro).join(", "));
    return { ...obter(id), recontar: div.length };
  }
  for (const i of r.itens) delete i.recontar;
  const extras = r.itens.filter((i) => !doPedido(i) && i.con > 0), st = div.length || extras.length ? "DIFERENCA" : "CONFERIDO";
  if (rec) db().prepare("UPDATE recebimentos SET itens = ?, status = ?, rec_em = ?, rec_por = ? WHERE id = ?").run(JSON.stringify(r.itens), st, h, u.nome, id);
  else db().prepare("UPDATE recebimentos SET itens = ?, status = ?, fechado_em = ? WHERE id = ?").run(JSON.stringify(r.itens), st, h, id);
  evento("recebimento", id, u, st === "CONFERIDO" ? "CONFERIU" : "FECHOU COM DIFERENÇA", [...div.map((i) => `${i.codpro}: ${final(i)} de ${i.qtd}`), ...extras.map((i) => `${i.fora ? "fora do pedido" : "sem cadastro"} ${i.semcad ? i.codigos[0] : i.codpro}: ${i.con}`)].join(", "));
  return obter(id);
}

// ---------- painel ----------
type NotaCab = { numdoc: number; numnot: string; sernot: string; datdoc: string; datemi: string; codfor: number; fornecedor: string };
const NOTA = "e.numdoc, e.numnot, e.sernot, e.datdoc, e.datemi, e.codfor, e.chanfe, f.nomfor, f.nomfan";
const DE_NOTA = "from entradas1 e left join fornecedores f on f.codfor = e.codfor";
const notaCab = (x: Row): NotaCab => ({ numdoc: num(x.NUMDOC), numnot: txt(x.NUMNOT), sernot: txt(x.SERNOT), datdoc: dia(x.DATDOC), datemi: dia(x.DATEMI), codfor: num(x.CODFOR), fornecedor: nomeFor(x) });
// nota -> pedido do recebimento que já a tem (uma nota só pode estar em um recebimento)
const ocupadas = (exceto = 0) => new Map((db().prepare("SELECT nota_numdoc, pedido FROM recebimentos WHERE nota_numdoc IS NOT NULL AND status <> 'CANCELADO' AND id <> ?").all(exceto) as Row[]).map((x) => [x.nota_numdoc as number, x.pedido as number]));
async function itensNotas(c: Conexao, numdocs: number[]) {
  const m = new Map<number, Map<string, { q: number; nompro: string; unipro: string }>>();
  for (let k = 0; k < numdocs.length; k += 200) {
    const l = await consultar(c, `select numdoc, codpro, max(nompro) nompro, max(unipro) unipro, sum(qntent) q from entradas2 where numdoc in (${numdocs.slice(k, k + 200).map(Number).join(",")}) group by numdoc, codpro`);
    for (const x of l) { const n = num(x.NUMDOC), mm = m.get(n) ?? new Map(); mm.set(txt(x.CODPRO), { q: r4(num(x.Q)), nompro: txt(x.NOMPRO), unipro: txt(x.UNIPRO) }); m.set(n, mm); }
  }
  return m;
}
// Quão bem a nota casa com o recebimento: produtos em comum e quantidades iguais (ao que chegou ou ao pedido).
// Forte = os mesmos produtos, nem um a mais nem a menos, e todas as quantidades iguais.
function casar(r: Rec, nota: Map<string, { q: number }>) {
  const its = r.itens.filter((i) => !i.semcad && (doPedido(i) || i.con > 0));
  let comum = 0, iguais = 0;
  for (const i of its) { const n = nota.get(i.codpro); if (!n) continue; comum++; if (n.q === final(i) || (doPedido(i) && n.q === i.qtd)) iguais++; }
  return { itens: nota.size, comum, iguais, de: its.length, forte: its.length > 0 && comum === its.length && iguais === its.length && nota.size === its.length };
}

// DANFE bipada na abertura: quando a entrada é lançada no Lieto, a chave bate com ENTRADAS1.CHANFE e o vínculo é feito sozinho
async function ligarPorChave(c: Conexao) {
  const ps = db().prepare("SELECT id, chave_nfe FROM recebimentos WHERE chave_nfe IS NOT NULL AND nota_numdoc IS NULL AND status <> 'CANCELADO' ORDER BY id DESC LIMIT 500").all() as Row[];
  if (!ps.length) return;
  const l = await consultar(c, `select ${NOTA} ${DE_NOTA} where e.chanfe in (${ps.map(() => "?").join(",")})`, ps.map((p) => p.chave_nfe));
  const oc = ocupadas();
  for (const x of l) {
    const p = ps.find((y) => y.chave_nfe === txt(x.CHANFE)), n = notaCab(x);
    if (!p || oc.has(n.numdoc)) continue;
    db().prepare("UPDATE recebimentos SET nota_numdoc = ?, nota = ?, nota_como = 'CHAVE', nota_por = NULL, nota_em = ? WHERE id = ? AND nota_numdoc IS NULL").run(n.numdoc, JSON.stringify(n), agora(), p.id);
    oc.set(n.numdoc, 0);
    evento("recebimento", p.id, null, "NOTA VINCULADA PELA CHAVE", { numdoc: n.numdoc, nota: n.numnot });
  }
}

// Operações de entrada que são compra (Sistema › Recebimento), para "nota de compra sem recebimento" não pegar devolução, despesa e CT-e
export const compraOps = (): number[] => { try { const v = JSON.parse(opcao("recebimento.compra") || "[]"); return Array.isArray(v) ? v.map(Number).filter(Boolean) : []; } catch { return []; } };
async function notasSem(c: Conexao) {
  const ops = compraOps(), desde = opcao("recebimento.desde");
  if (!ops.length || !desde) return [];
  const oc = ocupadas();
  return (await consultar(c, `select first 300 ${NOTA} ${DE_NOTA} where e.codope in (${ops.join(",")}) and e.datdoc >= ? order by e.datdoc, e.numdoc`, [dataDe(desde)])).map(notaCab).filter((n) => !oc.has(n.numdoc));
}

const fimDe = (r: Row) => r.rec_em || r.fechado_em || "";
export async function listar() {
  const recs = (db().prepare("SELECT * FROM recebimentos ORDER BY id DESC LIMIT 1000").all() as Row[]).map((r) => ({ ...r, itens: JSON.parse(r.itens) as Item[] }) as Rec);
  const { sugestoes, sem } = await comConexao(async (c) => {
    await ligarPorChave(c);
    for (const r of recs) if (r.chave_nfe && !r.nota_numdoc) Object.assign(r, db().prepare("SELECT nota_numdoc, nota, nota_como FROM recebimentos WHERE id = ?").get(r.id));
    // sugestões só para quem terminou e está sem nota (os 100 mais recentes): mesmo fornecedor, da chegada a 7 dias depois
    const alvo = recs.filter((r) => FINAIS.includes(r.status) && !r.nota_numdoc && r.codfor).slice(0, 100), sugestoes = new Map<number, { forte: number; total: number }>();
    if (alvo.length) {
      const ini = alvo.map((r) => r.criado_em.slice(0, 10)).sort()[0], fim = new Date(dataDe(alvo.map((r) => r.criado_em.slice(0, 10)).sort().at(-1)!)); fim.setDate(fim.getDate() + 7);
      const cands = (await consultar(c, `select first 2000 ${NOTA} ${DE_NOTA} where e.codfor in (${[...new Set(alvo.map((r) => Number(r.codfor)))].join(",")}) and e.datdoc >= ? and e.datdoc <= ?`, [dataDe(ini), fim])).map(notaCab);
      const oc = ocupadas(), livres = cands.filter((n) => !oc.has(n.numdoc)), its = await itensNotas(c, livres.map((n) => n.numdoc));
      for (const r of alvo) {
        const d0 = r.criado_em.slice(0, 10), d1 = new Date(dataDe(d0)); d1.setDate(d1.getDate() + 7);
        const ns = livres.filter((n) => n.codfor === r.codfor && n.datdoc >= d0 && n.datdoc <= iso(d1));
        sugestoes.set(r.id, { total: ns.length, forte: ns.filter((n) => casar(r, its.get(n.numdoc) || new Map()).forte).length });
      }
    }
    return { sugestoes, sem: await notasSem(c) };
  });
  return {
    compraConfigurada: compraOps().length > 0, notasSem: sem,
    lista: recs.map((r) => { const ped = r.itens.filter(doPedido);
      return { id: r.id, pedido: r.pedido, fornecedor: r.fornecedor, criado_em: r.criado_em, fim: fimDe(r), usuario: r.usuario, modo: r.modo, status: r.status, restante: !!r.restante,
        nota: r.nota ? JSON.parse(r.nota) : null, nota_como: r.nota_como, chave: !!r.chave_nfe, produtos: ped.length, divergentes: ped.filter((i) => final(i) !== i.qtd).length + r.itens.filter((i) => !doPedido(i) && i.con > 0).length,
        sugestao: sugestoes.get(r.id) || null }; }),
  };
}

// Página do recebimento: pedido × contagem × recontagem × recebido × nota (com a nota vinculada) e as validades
export async function gestao(id: number) {
  return comConexao(async (c) => {
    await ligarPorChave(c);
    const r = ler(id), nota = r.nota_numdoc ? (await itensNotas(c, [r.nota_numdoc])).get(r.nota_numdoc) || new Map() : null, sv = semValidade(r.itens.map((i) => i.codpro));
    const linhas = r.itens.map((i) => ({ codpro: i.codpro, nompro: i.nompro, unipro: i.unipro, codigo: i.semcad ? i.codigos[0] : "", pedido: doPedido(i) ? i.qtd : null, con: i.con, rec: i.numrec > 0 ? i.rec : null,
      recebido: final(i), nota: nota ? nota.get(i.codpro)?.q ?? 0 : null, fora: !!i.fora, semcad: !!i.semcad, falta: !!i.falta, recontar: !!i.recontar,
      validades: Object.entries(valsFinal(i)).map(([k, q]) => ({ validade: k.split("|")[0], lote: k.split("|")[1] || "", qtd: q })).sort((a, b) => a.validade.localeCompare(b.validade)), semValidade: sv.has(i.codpro) }));
    // produtos que só a nota tem: cobrados sem ter sido pedidos nem recebidos
    if (nota) for (const [cod, n] of nota) if (!r.itens.some((i) => i.codpro === cod)) linhas.push({ codpro: cod, nompro: n.nompro, unipro: n.unipro, codigo: "", pedido: null, con: 0, rec: null, recebido: 0, nota: n.q, fora: false, semcad: false, falta: false, recontar: false, validades: [], semValidade: false });
    const cobra = nota ? linhas.filter((l) => (l.nota ?? 0) > l.recebido).map((l) => ({ nompro: l.nompro, unipro: l.unipro, qtd: r4((l.nota ?? 0) - l.recebido) })) : [];
    const sobra = nota ? linhas.filter((l) => l.recebido > (l.nota ?? 0)).map((l) => ({ nompro: l.semcad ? `código ${l.codigo}` : l.nompro, unipro: l.unipro, qtd: r4(l.recebido - (l.nota ?? 0)) })) : [];
    return { id: r.id, pedido: r.pedido, fornecedor: r.fornecedor, pedfor: r.pedfor || "", status: r.status, modo: r.modo, restante: !!r.restante, origem: r.origem, usuario: r.usuario, criado_em: r.criado_em, fechado_em: r.fechado_em,
      rec_em: r.rec_em, rec_por: r.rec_por, fim_em: r.fim_em, fim_por: r.fim_por, obs_fim: r.obs_fim || "", chave: r.chave_nfe || "", chaveNumero: r.chave_nfe ? numeroDaChave(r.chave_nfe) : "",
      nota: r.nota ? JSON.parse(r.nota) : null, nota_como: r.nota_como, nota_por: r.nota_por, nota_em: r.nota_em, linhas, cobra, sobra,
      falta: r.itens.some((i) => doPedido(i) && final(i) < i.qtd) };
  });
}

// Sugestões para vincular: notas do mesmo fornecedor lançadas da chegada até 7 dias depois, a que mais casa primeiro.
// numero = procurar pelo número da nota (qualquer fornecedor), quando ela não está entre as sugestões.
export async function notas(id: number, q: URLSearchParams) {
  const r = ler(id), bruto = (q.get("numero") || "").trim(), numero = bruto.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const d0 = r.criado_em.slice(0, 10), d1 = new Date(dataDe(d0)); d1.setDate(d1.getDate() + 7);
  return comConexao(async (c) => {
    const l = numero ? await consultar(c, `select first 30 ${NOTA} ${DE_NOTA} where e.numnot = ? or e.numnot = ? order by e.datdoc desc`, [numero, numero.padStart(9, "0")])
      : r.codfor ? await consultar(c, `select first 50 ${NOTA} ${DE_NOTA} where e.codfor = ? and e.datdoc >= ? and e.datdoc <= ? order by e.datdoc, e.numdoc`, [r.codfor, dataDe(d0), d1]) : [];
    const ns = l.map(notaCab), its = await itensNotas(c, ns.map((n) => n.numdoc)), oc = ocupadas(r.id);
    const ord = (x: Row) => [x.forte ? 0 : 1, -x.comum, -x.iguais];
    return { numero, de: d0, ate: iso(d1), notas: ns.map((n) => ({ ...n, ocupada: oc.get(n.numdoc) ?? null, ...casar(r, its.get(n.numdoc) || new Map()) }))
      .filter((n) => numero || n.ocupada == null).sort((a, b) => { const x = ord(a), y = ord(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.datdoc.localeCompare(b.datdoc); }) };
  });
}

export async function vincular(id: number, b: Row, u: Usuario) {
  const r = ler(id), numdoc = Number(b.numdoc);
  if (r.status === "CANCELADO") throw new Erro("Recebimento cancelado.");
  if (r.nota_numdoc) throw new Erro("Este recebimento já tem nota. Desvincule antes.");
  const n = await comConexao(async (c) => (await consultar(c, `select ${NOTA} ${DE_NOTA} where e.numdoc = ?`, [numdoc]))[0]);
  if (!n) throw new Erro("Nota de entrada não encontrada no Lieto.", 404);
  const outro = ocupadas(id).get(numdoc);
  if (outro != null) throw new Erro(`Esta nota já está no recebimento do pedido ${outro}.`);
  const cab = notaCab(n);
  db().prepare("UPDATE recebimentos SET nota_numdoc = ?, nota = ?, nota_como = 'MANUAL', nota_por = ?, nota_em = ? WHERE id = ?").run(cab.numdoc, JSON.stringify(cab), u.nome, agora(), id);
  evento("recebimento", id, u, "VINCULOU NOTA", { numdoc: cab.numdoc, nota: cab.numnot, fornecedor: cab.codfor !== r.codfor ? cab.fornecedor : undefined });
  return gestao(id);
}
export async function desvincular(id: number, u: Usuario) {
  const r = ler(id);
  if (!r.nota_numdoc) throw new Erro("Este recebimento não tem nota.");
  // pela chave bipada: tira a chave também, senão o vínculo volta sozinho
  db().prepare(`UPDATE recebimentos SET nota_numdoc = NULL, nota = NULL, nota_como = NULL, nota_por = NULL, nota_em = NULL${r.nota_como === "CHAVE" ? ", chave_nfe = NULL" : ""} WHERE id = ?`).run(id);
  evento("recebimento", id, u, "DESVINCULOU NOTA", { numdoc: r.nota_numdoc, como: r.nota_como, ...(r.nota_como === "CHAVE" ? { chave: r.chave_nfe } : {}) });
  return gestao(id);
}

// Decisões do escritório. Nada vai para o Lieto.
export async function encerrar(id: number, b: Row, u: Usuario) {
  const r = ler(id), obs = limparObs(b.obs), restante = !!b.restante;
  if (r.status !== "DIFERENCA") throw new Erro("Só se encerra recebimento com diferença.");
  if (!obs) throw new Erro("Escreva o motivo (ex.: fornecedor manda o restante na próxima entrega).");
  if (restante && !r.itens.some((i) => doPedido(i) && final(i) < i.qtd)) throw new Erro("Não falta nada do pedido: não há restante para vir.");
  db().prepare("UPDATE recebimentos SET status = 'ENCERRADO', restante = ?, fim_em = ?, fim_por = ?, obs_fim = ? WHERE id = ?").run(restante ? 1 : 0, agora(), u.nome, obs, id);
  evento("recebimento", id, u, restante ? "ENCERROU: O RESTANTE AINDA VEM" : "ENCERROU COM A DIFERENÇA", obs);
  return gestao(id);
}
export async function recontar(id: number, u: Usuario) {
  const r = ler(id), div = r.itens.filter((i) => doPedido(i) && final(i) !== i.qtd);
  if (r.status !== "DIFERENCA") throw new Erro("Só se pede nova contagem de recebimento com diferença.");
  if (!div.length) throw new Erro("Os produtos do pedido bateram: a diferença é do que veio fora do pedido.");
  let n = Math.max(0, ...r.itens.map((i) => i.numrec));
  for (const i of div) { i.numrec = i.numrec || ++n; i.recontar = true; i.rec = 0; i.vals2 = {}; }
  db().prepare("UPDATE recebimentos SET itens = ?, status = 'RECONTANDO' WHERE id = ?").run(JSON.stringify(r.itens), id);
  evento("recebimento", id, u, "PEDIU NOVA CONTAGEM", div.map((i) => i.codpro).join(", "));
  return gestao(id);
}
export async function cancelar(id: number, b: Row, u: Usuario) {
  const r = ler(id), obs = limparObs(b.obs);
  if (["ENCERRADO", "CANCELADO"].includes(r.status)) throw new Erro("Este recebimento já foi encerrado.");
  if (!obs) throw new Erro("Escreva o motivo do cancelamento.");
  db().prepare("UPDATE recebimentos SET status = 'CANCELADO', fim_em = ?, fim_por = ?, obs_fim = ? WHERE id = ?").run(agora(), u.nome, obs, id);
  evento("recebimento", id, u, "CANCELOU", obs);
  return gestao(id);
}

// ---------- Sistema › Recebimento ----------
export async function opcoes() {
  const ops = compraOps();
  const l = await comConexao(async (c) => {
    const n = new Map((await consultar(c, "select codope, count(*) n from entradas1 where datdoc >= current_date - 90 group by codope")).map((x) => [num(x.CODOPE), num(x.N)]));
    return (await consultar(c, "select codope, nomope from operacoes where entsai = 'E' order by codope")).map((x) => ({ codope: num(x.CODOPE), nome: txt(x.NOMOPE), n: n.get(num(x.CODOPE)) || 0 }));
  });
  return { compra: ops, desde: opcao("recebimento.desde") || "", operacoes: l.filter((x) => x.n > 0 || ops.includes(x.codope)).sort((a, b) => b.n - a.n || a.codope - b.codope) };
}
export async function salvarOpcoes(b: Row, u: Usuario) {
  const ops = [...new Set((Array.isArray(b.compra) ? b.compra : []).map(Number))].filter((x) => Number.isInteger(x) && x > 0).sort((x, y) => x - y);
  const desde = String(b.desde || "").slice(0, 10) || agora().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || isNaN(dataDe(desde).getTime())) throw new Erro("Data inválida.");
  if (ops.length) {
    const existe = new Set((await comConexao((c) => consultar(c, `select codope from operacoes where entsai = 'E' and codope in (${ops.join(",")})`))).map((x) => num(x.CODOPE)));
    const nao = ops.find((x) => !existe.has(x)); if (nao) throw new Erro(`A operação ${nao} não é de entrada no Lieto.`);
  }
  gravarOpcao("recebimento.compra", JSON.stringify(ops)); gravarOpcao("recebimento.desde", desde);
  evento("sistema", "recebimento", u, "ALTEROU O RECEBIMENTO", { compra: ops, desde });
  return opcoes();
}

// ---------- alertas do Painel (nos dois sentidos) ----------
export async function alertas() {
  const l: { nivel: "E" | "P" | "A"; titulo: string; texto: string; em: string; href: string }[] = [];
  const d = new Date(Date.now() - 24 * 3_600_000), ontem = `${iso(d)} ${d.toTimeString().slice(0, 8)}`;
  const sem = await comConexao(async (c) => { await ligarPorChave(c); return notasSem(c); });
  for (const r of db().prepare("SELECT id, pedido, fornecedor, usuario, status, criado_em, fechado_em, rec_em, nota_numdoc FROM recebimentos WHERE status IN ('CONTANDO','RECONTANDO','CONFERIDO','DIFERENCA','ENCERRADO') ORDER BY id").all() as Row[]) {
    const ref = `pedido ${r.pedido}`, href = `/recebimento/${r.id}`, texto = [r.fornecedor, r.usuario].filter(Boolean).join(" · ");
    if (r.status === "DIFERENCA") l.push({ nivel: "P", titulo: `Recebimento com diferença: ${ref}`, texto, em: fimDe(r), href });
    else if (ABERTOS.includes(r.status) && r.criado_em < ontem) l.push({ nivel: "P", titulo: `Recebimento aberto há mais de 24 horas: ${ref}`, texto, em: r.criado_em, href });
    if (FINAIS.includes(r.status) && !r.nota_numdoc && fimDe(r) && fimDe(r) < ontem) l.push({ nivel: "P", titulo: `Recebido há mais de 1 dia sem nota: ${ref}`, texto: `${r.fornecedor} · vincule a nota de entrada`, em: fimDe(r), href });
  }
  if (sem.length) l.push({ nivel: "P", titulo: `${sem.length} nota(s) de compra sem recebimento`, texto: sem.slice(0, 3).map((n) => `NF ${n.numnot} · ${n.fornecedor}`).join(" · ") + (sem.length > 3 ? " · …" : ""), em: sem[0].datdoc, href: "/recebimento" });
  return l;
}
