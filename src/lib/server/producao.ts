// Produção: apontamento no coletor/gestão e lançamento no Lieto exatamente como o próprio ERP grava.
//
// O Lieto grava uma produção assim (quantidades conferidas em 2.586 produções desde jun/2026: 2.584 iguais à ficha atual):
//   PRODUCOES  1 linha: NUMIDE = max+1 (não há generator), CODPRO, QNTPRO, DATPRO/DATFAB, HORPRO, NUMLOT, PEDENT, BAIEST='S',
//              PRECUS = custo unitário do produzido (soma dos PRECUS das saídas)
//   MESTOQUE   1 saída por insumo da ficha (CONJUNTOS com BAIEST='S'), OBSEST "SAÍDA PARA PRODUÇÃO <lote>  - <numide>"
//                 qtd    = QNTPRO × QNTCON            (ficha normal)
//                        = QNTPRO × QNTCON / QNTVEN   (quando QNTVEN > 0: ex. 1 CX = 12 UN)
//                 PRECUS = PRODUTOS.PRECUS do insumo × QNTCON
//              1 entrada do produzido, OBSEST "PRODUÇÃO <lote>  - <numide>", NUMLOT = lote, PRECUS = soma acima
//   Não altera PRODUTOS.PRECUS.
import type * as FB from "node-firebird";
import { db, getConfig } from "./db";
import { empresaDe } from "./empresas";
import * as ddl from "./ddl";
import * as erp from "./erp";
import { adicionais, cods, fatores } from "./cadastro";
import { limparObs, obsErp, Erro, agora, evento, r4, r6, type Usuario } from "./comum";
import { comConexao, consultar, dataDe, emTransacao, executar, num, txt } from "./fb";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Insumo = { codpro: string; nompro: string; unipro: string; qntcon: number; qntven: number; qtd: number; custo: number; precus: number; saldo?: number | null };

// vai no OBSPRO: impede lançamento duplicado e identifica a origem no Lieto. Usa o uid (aleatório) e não o id local,
// que recomeçaria se o SQLite fosse recriado.
const MARCA = (uid: string) => `[OPS ${uid}]`.toUpperCase();

// ---------- leituras do Lieto ----------
// Produtos que têm ficha técnica (CONJUNTOS) — o que pode ser produzido.
export async function catalogo() {
  return comConexao(async (c) => {
    const rows = await consultar(c, `select p.codpro, p.nompro, p.unipro, p.codbar, p.coddum, p.eantri, p.codint, p.proati,
        (select count(*) from conjuntos k where k.codpro = p.codpro and k.baiest = 'S') n
      from produtos p where exists (select 1 from conjuntos k where k.codpro = p.codpro and k.baiest = 'S')`);
    const ad = await adicionais(c);
    return rows.map((r) => ({ extras: cods(ad.get(txt(r.CODPRO))), fatores: fatores(ad.get(txt(r.CODPRO))), codpro: txt(r.CODPRO), nompro: txt(r.NOMPRO), unipro: txt(r.UNIPRO), codbar: txt(r.CODBAR), coddum: txt(r.CODDUM),
      eantri: txt(r.EANTRI), codint: txt(r.CODINT), ativo: txt(r.PROATI) !== "N", insumos: num(r.N) }));
  });
}

async function lerFicha(c: FB.Database | FB.Transaction, codpro: string) {
  const p = (await consultar(c, "select codpro, codint, nompro, unipro, proati from produtos where codpro = ?", [codpro]))[0];
  if (!p) throw new Erro(`Produto ${codpro} não existe no Lieto.`, 404);
  const itens = await consultar(c, `select k.codcon, k.qntcon, k.qntven, p.nompro, p.unipro, p.precus, p.codint
    from conjuntos k join produtos p on p.codpro = k.codcon where k.codpro = ? and k.baiest = 'S' order by k.numreg, k.codcon`, [codpro]);
  return { produto: { codpro: txt(p.CODPRO), codint: num(p.CODINT), nompro: txt(p.NOMPRO), unipro: txt(p.UNIPRO), ativo: txt(p.PROATI) !== "N" }, itens };
}

function calcularInsumos(itens: Row[], qtd: number): Insumo[] {
  return itens.map((k) => {
    const qntcon = num(k.QNTCON), qntven = num(k.QNTVEN), custo = num(k.PRECUS);
    return { codpro: txt(k.CODCON), nompro: txt(k.NOMPRO), unipro: txt(k.UNIPRO), qntcon, qntven,
      qtd: r6(qntven > 0 ? (qtd * qntcon) / qntven : qtd * qntcon), custo, precus: r6(custo * qntcon) };
  });
}

// Prévia para a tela: ficha + quantidades + saldo atual de cada insumo.
export async function simular(codpro: string, qtd: number) {
  if (!codpro) throw new Erro("Informe o produto.");
  const f = await comConexao((c) => lerFicha(c, codpro));
  if (!f.itens.length) throw new Erro(`${f.produto.nompro} não tem ficha técnica (CONJUNTOS) no Lieto.`);
  const insumos = calcularInsumos(f.itens, qtd > 0 ? qtd : 1);
  let saldos: Map<string, number> | null = null, aviso: string | null = null;
  try { saldos = await erp.saldosDe([codpro, ...insumos.map((i) => i.codpro)], empresaDe("producao")); } catch (e) { aviso = "Saldo indisponível: " + (e as Error).message; }
  return {
    produto: { ...f.produto, saldo: saldos ? r4(saldos.get(codpro) || 0) : null },
    insumos: insumos.map((i) => ({ ...i, saldo: saldos ? r4(saldos.get(i.codpro) || 0) : null })),
    custo: r6(insumos.reduce((s, i) => s + i.precus, 0)), aviso,
  };
}

// Lote x Produto cadastrado no Lieto (LOTESENTRADAS), só os não vencidos. Mais novo primeiro.
export const lotes = (codpro: string) => comConexao(async (c) => {
  const m = new Map<string, { lote: string; validade: string | null }>();
  for (const r of await consultar(c, `select numlot, datven from lotesentradas where codpro = ? and numlot <> '' and (datven is null or datven < '1900-01-01' or datven >= current_date) order by numide desc`, [codpro])) {
    const l = txt(r.NUMLOT);
    if (l && !m.has(l)) m.set(l, { lote: l, validade: r.DATVEN instanceof Date && r.DATVEN.getFullYear() > 1900 ? r.DATVEN.toLocaleDateString("sv-SE") : null });
  }
  return [...m.values()];
});

// ---------- apontamento ----------
export async function apontar(body: Row, u: Usuario) {
  const uid = String(body.uid || "").replace(/[^\w-]/g, "").slice(0, 24) || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const ja = db().prepare("SELECT id FROM producoes WHERE uid = ?").get(uid) as Row | undefined;
  if (ja) return { ...obter(ja.id), repetido: true }; // reenvio do coletor (rede caiu): não duplica

  const codpro = String(body.codpro || "").trim(), qtd = r4(body.qtd);
  if (!codpro) throw new Erro("Informe o produto.");
  if (!(qtd > 0)) throw new Erro("Informe a quantidade produzida.");
  if (qtd > 999_999) throw new Erro("Quantidade acima do limite (999.999).");
  const lote = String(body.lote || "").trim().toUpperCase().slice(0, 20);
  const data = /^\d{4}-\d{2}-\d{2}$/.test(String(body.data || "")) ? String(body.data) : agora().slice(0, 10);
  if (data > agora().slice(0, 10)) throw new Erro("A data da produção não pode ser futura.");
  if (lote && !(await lotes(codpro)).some((l) => l.lote.toUpperCase() === lote)) throw new Erro(`Lote ${lote} não está cadastrado (ou está vencido) para este produto no Lieto.`);
  const codemp = empresaDe("producao"), sim = await simular(codpro, qtd);
  if (getConfig().producao?.bloquearSaldoNegativo) {
    const falta = sim.insumos.filter((i) => i.saldo != null && i.saldo < i.qtd);
    if (falta.length) throw new Erro("Saldo insuficiente: " + falta.map((i) => `${i.nompro} (tem ${i.saldo}, precisa ${i.qtd})`).join("; "));
  }
  const r = db().prepare(`INSERT INTO producoes (codemp, uid, codpro, nompro, unipro, qtd, lote, data, obs, status, insumos, custo, codfun, usuario, dispositivo, criado_em)
    VALUES (?,?,?,?,?,?,?,?,?, 'PENDENTE', ?,?,?,?,?,?)`).run(codemp, uid, codpro, sim.produto.nompro, sim.produto.unipro, qtd, lote, data, limparObs(body.obs),
    JSON.stringify(sim.insumos), sim.custo, u.codfun, u.nome, String(body.dispositivo || "").slice(0, 60), agora());
  const id = Number(r.lastInsertRowid);
  evento("producao", id, u, "APONTOU", { codpro, qtd, lote, data });
  if (getConfig().producao?.lancamentoAutomatico !== false) {
    try { await lancar(id, u); } catch { /* fica PENDENTE/ERRO com a mensagem; a gestão reenvia */ }
  }
  return obter(id);
}

// ---------- lançamento no Lieto ----------
const emAndamento = new Set<number>();

export async function lancar(id: number, u: Usuario) {
  const p = db().prepare("SELECT * FROM producoes WHERE id = ?").get(id) as Row | undefined;
  if (!p) throw new Erro("Produção não encontrada.", 404);
  if (p.status === "LANCADA") throw new Erro(`Já lançada no Lieto (produção nº ${p.numide}).`);
  if (p.status === "CANCELADA") throw new Erro("Produção cancelada.");
  if (emAndamento.has(id)) throw new Erro("Lançamento já em andamento.");
  emAndamento.add(id);
  const falhar = (msg: string) => {
    db().prepare("UPDATE producoes SET status = 'ERRO', erro = ?, tentativas = tentativas + 1 WHERE id = ?").run(msg, id);
    evento("producao", id, u, "ERRO AO LANÇAR", msg);
  };
  try {
    await ddl.exigir("producao");
    const codemp: number = p.codemp || empresaDe("producao"), pedent = erp.pedent();
    const r = await emTransacao(async (t) => {
      // já foi gravada antes (ex.: queda depois do commit)? então só reconcilia
      const dup = (await consultar(t, "select numide, precus from producoes where upper(obspro) starting with ?", [MARCA(p.uid)]))[0];
      if (dup) return { numide: num(dup.NUMIDE), custo: num(dup.PRECUS), insumos: JSON.parse(p.insumos || "[]") as Insumo[], reconciliado: true };

      const f = await lerFicha(t, p.codpro);
      if (!f.itens.length) throw new Erro("O produto não tem mais ficha técnica no Lieto.");
      const insumos = calcularInsumos(f.itens, p.qtd); // ficha e custo do momento do lançamento (igual ao Lieto)
      const custo = r6(insumos.reduce((s, i) => s + i.precus, 0));
      const datpro = dataDe(p.data), hora = agora().slice(11, 19);
      const obspro = `${MARCA(p.uid)} ${obsErp(p.obs, 100)}`.trim().slice(0, 100);
      let numide = 0;
      for (let tentativa = 0; ; tentativa++) {
        numide = num((await consultar(t, "select coalesce(max(numide), 0) + 1 n from producoes"))[0].N);
        try {
          await executar(t, `insert into producoes (numide, codpro, datpro, qntpro, codfun, qntbru, qntsuc, qntmap, pedent, baiest, numlot, obspro,
              retamo, denpro, datfab, numtan, codemp, precus, numpal, clanot, horpro, somcus)
            values (?, ?, ?, ?, ?, 0, 0, 0, ?, 'S', ?, ?, 'N', 0, ?, '', ?, ?, 0, 0, ?, 'N')`,
            [numide, p.codpro, datpro, p.qtd, p.codfun, pedent, p.lote || "", obspro, datpro, codemp, custo, hora]);
          break;
        } catch (e) {
          // o Lieto também usa max+1: se alguém pegou o mesmo número no mesmo instante, tenta o próximo
          if (tentativa < 4 && /PRIMARY|UNIQUE|duplicate/i.test((e as Error).message)) continue;
          throw e;
        }
      }
      const lote = p.lote || "";
      const mov = (codpro: string, codint: number, qtd: number, entsai: "E" | "S", obs: string, precus: number, numlot: string) =>
        executar(t, `insert into mestoque (codide, codpro, codint, codfun, idepro, datest, qntpro, entsai, obsest, precus, pedent, numlot, codemp)
          values (gen_id(gen_mestoque, 1), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [codpro, codint, p.codfun, numide, datpro, qtd, entsai, obs.slice(0, 60), precus, pedent, numlot, codemp]);
      for (const k of f.itens) {
        const i = insumos.find((x) => x.codpro === txt(k.CODCON))!;
        await mov(i.codpro, num(k.CODINT), i.qtd, "S", `SAÍDA PARA PRODUÇÃO ${lote}  - ${numide}`, i.precus, "");
      }
      await mov(p.codpro, f.produto.codint, p.qtd, "E", `PRODUÇÃO ${lote}  - ${numide}`, custo, lote);
      return { numide, custo, insumos, reconciliado: false };
    });
    db().prepare(`UPDATE producoes SET status = 'LANCADA', erro = NULL, numide = ?, custo = ?, insumos = ?, lancado_em = ?, lancado_por = ?, tentativas = tentativas + 1 WHERE id = ?`)
      .run(r.numide, r.custo, JSON.stringify(r.insumos), agora(), u.nome, id);
    evento("producao", id, u, r.reconciliado ? "RECONCILIOU COM O LIETO" : "LANÇOU NO LIETO", { numide: r.numide });
    return obter(id);
  } catch (e) {
    falhar((e as Error).message);
    throw e;
  } finally { emAndamento.delete(id); }
}

export async function cancelar(id: number, body: Row, u: Usuario) {
  const p = obter(id);
  if (p.status === "LANCADA") throw new Erro("Produção já lançada no Lieto: o estorno deve ser feito no Lieto.");
  if (p.status === "CANCELADA") return p;
  const motivo = String(body.motivo || "").trim();
  if (!motivo) throw new Erro("Informe o motivo do cancelamento.");
  if (emAndamento.has(id)) throw new Erro("Lançamento em andamento.");
  emAndamento.add(id);
  try {
    if ((await comConexao((c) => consultar(c, "select numide from producoes where upper(obspro) starting with ?", [MARCA(p.uid)])))[0]) throw new Erro("Esta produção já está no Lieto: clique em Lançar para reconciliar.");
  } finally { emAndamento.delete(id); }
  db().prepare("UPDATE producoes SET status = 'CANCELADA', cancelado_em = ?, cancelado_por = ?, motivo_cancel = ? WHERE id = ?").run(agora(), u.nome, motivo, id);
  evento("producao", id, u, "CANCELOU", motivo);
  return obter(id);
}

// ---------- consultas locais ----------
export function obter(id: number) {
  const p = db().prepare("SELECT * FROM producoes WHERE id = ?").get(id) as Row | undefined;
  if (!p) throw new Erro("Produção não encontrada.", 404);
  return { ...p, insumos: JSON.parse(p.insumos || "[]") as Insumo[] } as Row;
}

export function listar(q: URLSearchParams) {
  const de = q.get("de") || agora().slice(0, 8) + "01", ate = q.get("ate") || agora().slice(0, 10);
  const status = q.get("status"), codfun = q.get("codfun");
  const where = ["data BETWEEN ? AND ?"], args: (string | number)[] = [de, ate];
  if (status) { where.push("status = ?"); args.push(status); }
  if (codfun) { where.push("codfun = ?"); args.push(Number(codfun)); }
  const rows = db().prepare(`SELECT id, uid, codpro, nompro, unipro, qtd, lote, data, obs, status, erro, custo, insumos, codfun, usuario, criado_em, numide, lancado_em, lancado_por, tentativas
    FROM producoes WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 2000`).all(...args);
  const pend = db().prepare("SELECT status, COUNT(*) n FROM producoes WHERE status IN ('PENDENTE','ERRO') GROUP BY status").all();
  return { de, ate, producoes: (rows as Row[]).map(({ insumos, ...r }) => ({ ...r, total: r6((JSON.parse(insumos || "[]") as Insumo[]).reduce((s, i) => s + i.qtd * i.custo, 0)) })), pendentes: pend };
}

export function minhas(u: Usuario) {
  return db().prepare(`SELECT id, codpro, nompro, unipro, qtd, lote, data, status, erro, numide, criado_em FROM producoes
    WHERE codfun = ? AND criado_em >= ? ORDER BY id DESC LIMIT 200`).all(u.codfun, agora().slice(0, 10));
}

export function historico(id: number) {
  return db().prepare("SELECT * FROM eventos WHERE modulo = 'producao' AND ref = ? ORDER BY id").all(String(id));
}

// Reenvia ao Lieto o que ficou pendente/com erro (ex.: banco fora do ar). Usado pela gestão e pelo agendador.
export async function reprocessar(u: Usuario) {
  const ids = (db().prepare("SELECT id FROM producoes WHERE status IN ('PENDENTE','ERRO') ORDER BY id").all() as Row[]).map((r) => r.id);
  const out = { ok: 0, erro: 0, mensagens: [] as string[] };
  for (const id of ids) {
    try { await lancar(id, u); out.ok++; } catch (e) { out.erro++; out.mensagens.push(`#${id}: ${(e as Error).message}`); if (e instanceof ddl.Bloqueio) break; }
  }
  return out;
}
