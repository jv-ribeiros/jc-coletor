// Movimentos de estoque na MESTOQUE: transferência entre centros (CCUSTOS) , transformação e kit.
//
// TRANSFERÊNCIA: muda só a localização. Copia o modelo "[VIRTUAL]" do Lieto (movs 78786/78787): uma saída com CODSET = origem e
//   uma entrada com CODSET = destino (CODSET = CCUSTOS.CODSIM). CODSET > 0 não entra no saldo da SP_ESTOQUE.
// KIT: entra o kit e saem os itens informados pelo operador (sem CODSET).
//
// Duplicidade: os CODIDE são reservados no generator e guardados localmente ANTES de gravar. Se a conexão cair depois do
// commit, o reenvio encontra os CODIDE e só reconcilia; se tentasse gravar de novo, a chave primária recusaria.
import { db } from "./db";
import { adicionais, cods, fatores } from "./cadastro";
import * as ddl from "./ddl";
import { empresaDe } from "./empresas";
import * as erp from "./erp";
import * as PD from "./perda";
import * as R from "./retorno";
import { Erro, agora, evento, juntar, limparObs, obsErp, r4, r6, type Usuario } from "./comum";
import { comConexao, consultar, emTransacao, executar, hoje, num, txt, type Conexao } from "./fb";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Linha = { ret?: number; codmot?: number; codide?: number; codpro: string; codint: number; nompro: string; qtd: number; entsai: "E" | "S"; obs: string; precus: number; codset: number | null };
export type Tipo = "transferencia" | "kit" | "transformacao" | "retorno" | "perda";

export const lerProdutos = (cods: string[]) => comConexao(async (c) => {
  const m = new Map<string, Row>();
  for (const cod of new Set(cods)) {
    const p = (await consultar(c, "select codpro, codint, nompro, unipro, precus from produtos where codpro = ?", [cod]))[0];
    if (!p) throw new Erro(`Produto ${cod} não existe no Lieto.`);
    m.set(cod, { codpro: txt(p.CODPRO), codint: num(p.CODINT), nompro: txt(p.NOMPRO), unipro: txt(p.UNIPRO), precus: num(p.PRECUS) });
  }
  return m;
});

export const produtos = () => comConexao(async (c) => {
  const ad = await adicionais(c);
  return (await consultar(c, "select codpro, codint, nompro, unipro, codbar, coddum, eantri from produtos where proati = 'S' order by nompro"))
    .map((r) => ({ codpro: txt(r.CODPRO), nompro: txt(r.NOMPRO), unipro: txt(r.UNIPRO), fatores: fatores(ad.get(txt(r.CODPRO))), codigos: [...[r.CODPRO, r.CODBAR, r.CODDUM, r.EANTRI, r.CODINT].map(txt).filter((x) => x && x !== "0"), ...cods(ad.get(txt(r.CODPRO)))] }));
});

export const centros = () => comConexao(async (c) => (await consultar(c, "select codsim, nomcus from ccustos where codsim > 0 order by codsim"))
  .map((r) => ({ id: num(r.CODSIM), nome: txt(r.NOMCUS) })));

// Saldo por centro (somente movimentos com CODSET)
export const saldoCentros = (codpro: string): Promise<Record<number, number>> => comConexao(async (c) => Object.fromEntries((await consultar(c, `select codset, sum(case when entsai = 'E' then qntpro else -qntpro end) q
  from mestoque where codpro = ? and codset > 0 and codemp = ? group by codset`, [codpro, empresaDe("transferencia")])).map((r) => [num(r.CODSET), r4(num(r.Q))])));

// ---------- núcleo ----------
export const uidDe = (b: Row) => { const u = String(b.uid || "").replace(/[^\w-]/g, "").slice(0, 40); if (!u) throw new Erro("Identificador do lançamento ausente."); return u; };
export const linha = (p: Row, qtd: number, entsai: "E" | "S", obs: string, precus: number, codset: number | null): Linha => {
  if (!(qtd <= 999_999)) throw new Erro("Quantidade acima do limite (999.999).");
  return { codpro: p.codpro, codint: p.codint, nompro: p.nompro, qtd, entsai, obs, precus: r6(precus), codset };
};
const inverter = (l: Linha[], id: number): Linha[] => l.map((x) => ({ ...x, codide: undefined, entsai: x.entsai === "E" ? "S" : "E", obs: `ESTORNO OPS ${id} - ${x.obs}` }));
export const porUid = (uid: string) => db().prepare("SELECT id FROM movs WHERE uid = ?").get(uid) as Row | undefined;

export function inserir(uid: string, tipo: Tipo, resumo: string, linhas: Linha[], u: Usuario, extra: Row = {}) {
  const codemp = Number(extra.codemp) || empresaDe(tipo); // fica preso ao movimento: mudar em Sistema só vale para os próximos
  const id = Number(db().prepare(`INSERT INTO movs (obs, codemp, uid, tipo, resumo, linhas, pedido, item, qtd, estorno_de, extra, status, codfun, usuario, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,'PENDENTE',?,?,?)`)
    .run(limparObs(extra.obs) || null, codemp, uid, tipo, resumo, JSON.stringify(linhas), extra.pedido ?? null, extra.item ?? null, extra.qtd ?? null, extra.estornoDe ?? null, extra.extra ? JSON.stringify(extra.extra) : null, u.codfun, u.nome, agora()).lastInsertRowid);
  evento(tipo, id, u, extra.estornoDe ? "PEDIU ESTORNO" : "REGISTROU", limparObs(extra.obs) ? `${resumo} | OBS: ${limparObs(extra.obs)}` : resumo);
  return id;
}

export function obter(id: number): Row {
  const m = db().prepare("SELECT * FROM movs WHERE id = ?").get(id) as Row | undefined;
  if (!m) throw new Erro("Movimento não encontrado.", 404);
  return { ...m, linhas: JSON.parse(m.linhas) as Linha[] };
}
const jaGravado = async (c: Conexao, linhas: Linha[]) =>
  !!linhas[0]?.codide && num((await consultar(c, `select count(*) n from mestoque where codide in (${linhas.map((l) => Number(l.codide)).join(",")})`))[0].N) > 0;

// OBSEST de cada linha. A transferência já enche o campo: com observação, sai o nome do centro (que continua em CODSET).
function obsest(m: Row, l: Linha) {
  if (!m.obs || m.tipo === "transformacao" || m.tipo === "retorno") return l.obs.slice(0, 60); // gravam em OBSPRO / OBSDOC
  return juntar(m.tipo === "transferencia" ? l.obs.replace(/((?:PARA|\]) \d+)-.*$/, "$1") : l.obs, m.obs, 60);
}
const emAndamento = new Set<number>();
export async function lancar(id: number, u: Usuario) {
  const m = obter(id);
  if (m.status === "LANCADA") return m;
  if (["CANCELADA", "ESTORNADA"].includes(m.status)) throw new Erro("Movimento cancelado ou estornado.");
  if (emAndamento.has(id)) throw new Erro("Lançamento já em andamento.");
  emAndamento.add(id);
  try {
    await ddl.exigir(m.tipo);
    const linhas = m.linhas as Linha[], codemp: number = m.codemp || empresaDe(m.tipo);
    if (!linhas[0].codide) {
      await comConexao(async (c) => { for (const l of linhas) l.codide = num((await consultar(c, "select gen_id(gen_mestoque, 1) n from rdb$database"))[0].N); });
      const saida = String(linhas.find((l) => l.entsai === "S")?.codide ?? "").padStart(6, "0");
      for (const l of linhas) l.obs = l.obs.replace("{saida}", saida);
      db().prepare("UPDATE movs SET linhas = ? WHERE id = ?").run(JSON.stringify(linhas), id);
    }
    await emTransacao(async (t) => {
      if (await jaGravado(t, linhas)) return;
      const ot = m.tipo === "transformacao" ? await gravarOT(t, m, linhas, codemp) : null;
      const rt = m.tipo === "retorno" ? await R.gravar(t, m) : null;
      if (rt) for (const l of linhas) l.obs = rt.obs;
      for (const l of linhas) await executar(t, `insert into mestoque (codide, codpro, codint, codfun, idepro, datest, qntpro, entsai, obsest, precus, pedent, codemp, codset, numlot, ideret, codmot)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [l.codide, l.codpro, ot && l.entsai === "S" ? 0 : l.codint, m.codfun, ot, hoje(), l.qtd, l.entsai, ot ? `OT-${l.entsai} ORDEM DE TRANSFERENCIA   - ${ot}`.slice(0, 60) : obsest(m, l), l.precus, erp.pedent(), codemp, l.codset, ot || m.tipo === "perda" ? "" : null, rt ? rt.ids[l.ret!] : null, l.codmot ?? null]);
    });
    db().prepare("UPDATE movs SET status = 'LANCADA', erro = NULL, lancado_em = ? WHERE id = ?").run(agora(), id);
    evento(m.tipo, id, u, "LANÇOU NO LIETO", { codides: linhas.map((l) => l.codide) });
    return obter(id);
  } catch (e) {
    db().prepare("UPDATE movs SET status = 'ERRO', erro = ? WHERE id = ?").run((e as Error).message, id);
    evento(m.tipo, id, u, "ERRO AO LANÇAR", (e as Error).message);
    throw e;
  } finally { emAndamento.delete(id); }
}
// Transformação = Ordem de Transferência do Lieto: linha em PRODUCOES (CODPRO = o que entra, CODMAP = o que sai, PRECUS 0)
// e OT-S / OT-E na MESTOQUE com IDEPRO. NUMIDE = max+1, como o Lieto.
async function gravarOT(t: Conexao, m: Row, linhas: Linha[], codemp: number) {
  const s = linhas.find((l) => l.entsai === "S")!, e = linhas.find((l) => l.entsai === "E")!;
  for (let k = 0; ; k++) {
    const n = num((await consultar(t, "select coalesce(max(numide), 0) + 1 n from producoes"))[0].N);
    try {
      await executar(t, `insert into producoes (numide, codpro, datpro, qntpro, codfun, qntbru, qntsuc, codmap, qntmap, pedent, baiest, numlot, obspro, retamo, denpro, datfab, numtan, codemp, precus, numpal, clanot, horpro, somcus)
        values (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 'S', '', ?, 'N', 0, ?, '', ?, 0, 0, 0, ?, 'N')`,
        [n, e.codpro, hoje(), e.qtd, m.codfun, s.codpro, s.qtd, erp.pedent(), `[OPS ${m.uid}] ${obsErp(m.obs, 100)}`.trim().slice(0, 100), hoje(), codemp, agora().slice(11, 19)]);
      return n;
    } catch (x) { if (k < 4 && /PRIMARY|UNIQUE|duplicate/i.test((x as Error).message)) continue; throw x; }
  }
}
export async function registrarELancar(id: number, u: Usuario) { try { return await lancar(id, u); } catch { return obter(id); } }

export async function cancelar(id: number, u: Usuario, obs?: unknown) {
  if (emAndamento.has(id)) throw new Erro("Lançamento em andamento.");
  const m = obter(id);
  if (["LANCADA", "ESTORNADA"].includes(m.status)) throw new Erro("Já lançado: use o estorno.");
  emAndamento.add(id);
  try {
    if (await comConexao((c) => jaGravado(c, m.linhas))) throw new Erro("Este movimento já está no Lieto: clique em Lançar para reconciliar.");
    db().prepare("UPDATE movs SET status = 'CANCELADA', obs_fim = ? WHERE id = ?").run(limparObs(obs) || null, id);
    evento(m.tipo, id, u, "CANCELOU", limparObs(obs));
    return obter(id);
  } finally { emAndamento.delete(id); }
}

export async function estornar(id: number, u: Usuario, obs?: unknown) {
  const m = obter(id);
  if (m.tipo === "retorno") throw new Erro("Retorno se desfaz no Lieto.");
  if (m.status !== "LANCADA" || m.estorno_de) throw new Erro("Só dá para estornar um movimento lançado.");
  if (m.tipo === "perda") { // o estorno da perda é excluir o registro no Lieto
    if (emAndamento.has(id)) throw new Erro("Estorno já em andamento.");
    emAndamento.add(id);
    try {
      await ddl.exigir("perda");
      await emTransacao((t) => PD.excluir(t, m.linhas));
      db().prepare("UPDATE movs SET status = 'ESTORNADA', erro = NULL, obs_fim = ? WHERE id = ?").run(limparObs(obs) || null, id);
      evento("perda", id, u, "ESTORNOU (EXCLUIU NO LIETO)", { codides: (m.linhas as Linha[]).map((l) => l.codide), obs: limparObs(obs) });
      return obter(id);
    } finally { emAndamento.delete(id); }
  }
  const ja = db().prepare("SELECT id FROM movs WHERE estorno_de = ? AND status <> 'CANCELADA'").get(id) as Row | undefined;
  if (ja) throw new Erro(`Já existe o estorno #${ja.id}.`);
  return registrarELancar(inserir(`estorno-${id}-${Date.now().toString(36)}`, m.tipo, `ESTORNO #${id}: ${m.resumo}`.slice(0, 200), inverter(m.linhas, id), u, { pedido: m.pedido, item: m.item, estornoDe: id, codemp: m.codemp, obs }), u);
}

export const listar = (tipo: Tipo) => (db().prepare(`SELECT m.*, (SELECT e.id FROM movs e WHERE e.estorno_de = m.id AND e.status <> 'CANCELADA') estorno
  FROM movs m WHERE tipo = ? ORDER BY id DESC LIMIT 500`).all(tipo) as Row[]).map((m) => ({ ...m, linhas: JSON.parse(m.linhas) }));

// ---------- transferência ----------
export async function transferir(b: Row, u: Usuario) {
  const uid = uidDe(b), ex = porUid(uid);
  if (ex) return { ...obter(ex.id), repetido: true };
  const origem = Number(b.origem), destino = Number(b.destino), qtd = r4(b.qtd), codpro = String(b.codpro || "").trim();
  const cs = await centros(), o = cs.find((c) => c.id === origem), d = cs.find((c) => c.id === destino);
  if (!o || !d || origem === destino) throw new Erro("Escolha origem e destino diferentes.");
  if (!(qtd > 0)) throw new Erro("Informe a quantidade.");
  const p = (await lerProdutos([codpro])).get(codpro)!;
  // O centro 1 (Geral) quase não tem movimento próprio no Lieto: só os demais têm saldo conferível.
  if (origem !== 1) { const s = (await saldoCentros(codpro))[origem] || 0; if (s < qtd) throw new Erro(`${o.nome} tem ${s} de ${p.nompro}.`); }
  const ex2 = porUid(uid); if (ex2) return { ...obter(ex2.id), repetido: true };
  return registrarELancar(inserir(uid, "transferencia", `${qtd} ${p.unipro} ${p.nompro}: ${o.nome} > ${d.nome}`, [
    linha(p, qtd, "S", `TRANSFERENCIA ESTOQUE [VIRTUAL] PARA ${d.id}-${d.nome}`, p.precus, origem),
    linha(p, qtd, "E", `TRANSFERENCIA ESTOQUE [VIRTUAL] DE [{saida}] ${o.id}-${o.nome}`, p.precus, destino),
  ], u, { obs: b.obs }), u);
}

// ---------- transformação (CX <-> UN) ----------
// Pares vindos da ficha (CONJUNTOS com QNTVEN): 1 CODCON = QNTVEN/QNTCON CODPRO. Só fichas de um insumo.
export const opcoes = (codpro: string) => comConexao(async (c) => (await consultar(c, `select k.codpro, k.codcon, k.qntcon, k.qntven, p.nompro, p.unipro from conjuntos k
    join produtos p on (k.codcon = ? and p.codpro = k.codpro) or (k.codpro = ? and p.codpro = k.codcon)
    where k.qntven > 0 and k.qntcon > 0 and k.baiest = 'S'
      and (select count(*) from conjuntos x where x.codpro = k.codpro and x.baiest = 'S') = 1`, [codpro, codpro])).map((r) => {
  const abre = txt(r.CODCON) === codpro, un = num(r.QNTVEN) / num(r.QNTCON);
  return { codpro: abre ? txt(r.CODPRO) : txt(r.CODCON), nompro: txt(r.NOMPRO), unipro: txt(r.UNIPRO), abre, un };
}));

export async function transformar(b: Row, u: Usuario) {
  const uid = uidDe(b), ex = porUid(uid);
  if (ex) return { ...obter(ex.id), repetido: true };
  const de = String(b.de || "").trim(), para = String(b.para || "").trim(), qDe = r4(b.qtdDe);
  if (!(qDe > 0) || !de || !para || de === para) throw new Erro("Informe origem, destino e quantidade.");
  const op = (await opcoes(de)).find((x) => x.codpro === para);
  const qPara = op ? r4(op.abre ? qDe * op.un : qDe / op.un) : r4(b.qtdPara); // com ficha, o fator é o da ficha
  if (!(qPara > 0)) throw new Erro("Informe a quantidade que entra.");
  if (op && Math.abs(qPara - Math.round(qPara)) > 1e-6) throw new Erro(`A quantidade não fecha ${op.unipro} inteira (fator ${op.un}).`);
  const ps = await lerProdutos([de, para]), o = ps.get(de)!, d = ps.get(para)!;
  const ex2 = porUid(uid); if (ex2) return { ...obter(ex2.id), repetido: true };
  return registrarELancar(inserir(uid, "transformacao", `${qDe} ${o.unipro} ${o.nompro} > ${qPara} ${d.unipro} ${d.nompro}`,
    [linha(o, qDe, "S", "OT", o.precus, null), linha(d, qPara, "E", "OT", (o.precus * qDe) / qPara, null)], u, { obs: b.obs }), u);
}

// ---------- kit ----------
// Transformação de 1 produto em vários, todos produtos normais, só na MESTOQUE: entra o kit e saem os itens que o operador
// informou (ex.: 2 KITS -> 4 bolas, 4 petecas, 4 camas). Sem ficha, sem pedido, sem proporção fixa.
export async function montarKit(b: Row, u: Usuario) {
  const uid = uidDe(b), ex = porUid(uid);
  if (ex) return { ...obter(ex.id), repetido: true };
  const kit = String(b.kit || "").trim(), q = r4(b.qtd);
  const itens = ((b.itens || []) as Row[]).map((x) => ({ codpro: String(x.codpro || "").trim(), qtd: r4(x.qtd) }));
  if (!kit || !(q > 0)) throw new Erro("Informe o kit e a quantidade.");
  if (!itens.length) throw new Erro("Informe os itens do kit.");
  if (itens.some((x) => !x.codpro || !(x.qtd > 0))) throw new Erro("Informe a quantidade de todos os itens.");
  if (itens.some((x) => x.codpro === kit)) throw new Erro("O kit não pode ser item dele mesmo.");
  if (new Set(itens.map((x) => x.codpro)).size !== itens.length) throw new Erro("Item repetido.");
  const ps = await lerProdutos([kit, ...itens.map((x) => x.codpro)]), k = ps.get(kit)!;
  const ex2 = porUid(uid); if (ex2) return { ...obter(ex2.id), repetido: true };
  const custo = itens.reduce((t, x) => t + x.qtd * ps.get(x.codpro)!.precus, 0) / q, obs = `TRANSFORMACAO KIT ${k.codpro}`;
  return registrarELancar(inserir(uid, "kit", `${q} ${k.unipro} ${k.nompro} = ${itens.map((x) => `${x.qtd} ${ps.get(x.codpro)!.nompro}`).join(", ")}`, [
    ...itens.map((x) => linha(ps.get(x.codpro)!, x.qtd, "S", obs, ps.get(x.codpro)!.precus, null)),
    linha(k, q, "E", obs, custo, null),
  ], u, { obs: b.obs }), u);
}
