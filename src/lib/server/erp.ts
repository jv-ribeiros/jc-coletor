// Leituras do Lieto compartilhadas pelos módulos: empresas, produtos, saldo (regra da SP_ESTOQUE) e usuários.
import type * as FB from "node-firebird";
import { juntar } from "./comum";
import { getConfig } from "./db";
import { adicionais } from "./cadastro";
import { comConexao, consultar, emTransacao, executar, hoje, iso, num, txt } from "./fb";

export async function testar() {
  return comConexao(async (db) => {
    const r = await consultar(db, "select count(*) n from produtos");
    const e = await consultar(db, "select count(*) n from empresas");
    const v = await consultar(db, "select max(versao) v from versao");
    return { produtos: num(r[0].N), empresas: num(e[0].N), versaoLieto: num(v[0]?.V) };
  });
}

export async function empresas() {
  return comConexao(async (db) => {
    const r = await consultar(db, "select codemp, nomemp from empresas order by codemp");
    return r.map((x) => ({ codemp: num(x.CODEMP), nomemp: txt(x.NOMEMP) }));
  });
}

export type ProdutoErp = {
  codpro: string; codint: string; nompro: string; unipro: string; codbar: string; coddum: string; eantri: string;
  extras?: { cod: string; fator: number }[]; precus: number; saldo: number; grupo: string; subgrupo: string; marca: string; tipo: string; local_erp: string;
};

// ---------- saldo de estoque ----------
// 1º tenta a SP_ESTOQUE do próprio ERP. Se o servidor não conseguir executá-la (ex.: Firebird 2.0 com base
// criada no 2.5 → "Invalid request BLR"), calcula com a MESMA regra da procedure (MODEST = 0) em SQL de conjunto.
// codpros: limita o cálculo a alguns produtos (telas de produção, transferência etc.).
let spIndisponivel = false;
const lista = (codpros: string[]) => codpros.map((c) => `'${String(c).replace(/'/g, "''")}'`).join(",");

async function saldos(db: FB.Database, codemp: number, data: Date, codpros?: string[]): Promise<{ mapa: Map<string, number>; metodo: string }> {
  if (codpros && !codpros.length) return { mapa: new Map(), metodo: "-" };
  const emp = (await consultar(db, "select estcup, tipest from empresas where codemp = ?", [codemp]))[0];
  if (!emp) throw new Error("ERP: empresa " + codemp + " não encontrada.");
  const modest = Number(getConfig().estoque.modest ?? 0), estcup = txt(emp.ESTCUP), tipest = txt(emp.TIPEST);
  const modo = getConfig().estoque.calculo || "auto";
  const filtroP = codpros ? ` where p.codpro in (${lista(codpros)})` : "";
  if (modo === "procedure" || (modo === "auto" && !spIndisponivel)) {
    try {
      const rows = await consultar(db, `select p.codpro, (select x.qntest from sp_estoque(p.codpro, cast(? as date), ?, ?, ?, ?) x) saldo from produtos p${filtroP}`,
        [iso(data), modest, estcup, tipest, String(codemp)]);
      return { mapa: new Map(rows.map((r) => [txt(r.CODPRO), num(r.SALDO)])), metodo: "SP_ESTOQUE" };
    } catch (e) {
      if (modo === "procedure") throw e;
      spIndisponivel = true; // não insiste a cada chamada
      console.warn("SP_ESTOQUE indisponível, usando cálculo equivalente:", (e as Error).message);
    }
  }
  if (modest !== 0) throw new Error("ERP: cálculo alternativo só cobre MODEST = 0 (config.estoque.modest).");
  // filtros idênticos aos da procedure (empresa via CONTAINING, data como DATE)
  const D = `cast('${iso(data)}' as date)`, E = (c: string) => `'${Number(codemp)}' containing cast(${c} as varchar(10))`;
  const P = (c: string) => (codpros ? ` and ${c} in (${lista(codpros)})` : "");
  const partes = [
    `select a.codpro, sum(a.qntent) q from entradas2 a join entradas1 b on b.numdoc = a.numdoc
       where a.baiest = 'S' and (b.notimp <> 'N' or b.notimp is null) and b.datdoc <= ${D} and ${E("b.codemp")}${P("a.codpro")} group by a.codpro`,
    `select codpro, sum((case when entsai = 'S' then -1 when entsai = 'E' then 1 else 0 end) * qntpro) q from mestoque
       where (pedent <> 'E' or pedent is null) and (codset is null or codset = 0) and datest <= ${D} and ${E("codemp")}${P("codpro")} group by codpro`,
    `select a.codpro, sum(a.qntpro) q from devolucoes2 a join devolucoes1 b on b.numdev = a.numdev
       where a.baiest = 'S' and b.datdev <= ${D} and ${E("b.codemp")}${P("a.codpro")} group by a.codpro`,
  ];
  const notas = (extra: string) => `select a.codpro, sum((case when b.entsai = 'S' then -1 else 1 end) * a.qntpro) q from notas2 a
       join notas1 b on a.numnot = b.numnot and a.sernot = b.sernot
       where b.entsai in ('S','E') and a.baiest = 'S' ${extra} and b.datemi <= ${D} and ${E("b.codemp")}${P("a.codpro")} group by a.codpro`;
  const pedidos = (campoData: string) => `select a.codpro, sum(-1 * a.qntpro) q from pedidos2 a join pedidos1 b on b.numdoc = a.numdoc
       where a.baiest = 'S' and b.${campoData} <= ${D} and ${E("b.codemp")}${P("a.codpro")} group by a.codpro`;
  if (tipest === "N" || tipest === "A") partes.push(notas(""));
  if (tipest === "P" || tipest === "A") partes.push(notas("and b.notimp = 'A'"), pedidos("datdoc"));
  if (tipest === "F") partes.push(notas("and b.notimp = 'A'"), pedidos("datfat"));
  if (estcup === "S") partes.push(`select codpro, sum(qntpro) q from cupom where sitpro = 'N' and datdoc <= ${D} and ${E("codemp")}${P("codpro")} group by codpro`);
  const mapa = new Map<string, number>();
  for (const sql of partes) for (const r of await consultar(db, sql)) {
    const k = txt(r.CODPRO); mapa.set(k, (mapa.get(k) || 0) + num(r.Q));
  }
  return { mapa, metodo: "SQL equivalente à SP_ESTOQUE" };
}

// Foto do estoque: produtos ativos ou com saldo na empresa escolhida.
// Marca = TERGRUPOS (terceiro grupo do Lieto); Tipo = TIPPRO (V venda / B beneficiamento).
export async function lerProdutos(codemp: number, data: Date): Promise<ProdutoErp[]> {
  return comConexao(async (db) => {
    const rows = await consultar(db, `
      select p.codpro, p.codint, p.nompro, p.unipro, p.codbar, p.coddum, p.eantri, p.precus, p.proati, p.locpro, p.tippro,
             g.nomgru, s.nomsub, t.nomter
      from produtos p
      left join grupos g on g.codgru = p.codgru
      left join subgrupos s on s.codsub = p.codsub
      left join tergrupos t on t.codter = p.codter`);
    const { mapa } = await saldos(db, codemp, data), ad = await adicionais(db);
    return rows
      .map((r) => ({ r, saldo: Math.round((mapa.get(txt(r.CODPRO)) || 0) * 1e4) / 1e4 }))
      .filter(({ r, saldo }) => txt(r.PROATI) !== "N" || saldo !== 0)
      .map(({ r, saldo }) => ({
        codpro: txt(r.CODPRO), codint: txt(r.CODINT), nompro: txt(r.NOMPRO), unipro: txt(r.UNIPRO),
        codbar: txt(r.CODBAR), coddum: txt(r.CODDUM), eantri: txt(r.EANTRI), extras: ad.get(txt(r.CODPRO)), precus: num(r.PRECUS), saldo,
        grupo: txt(r.NOMGRU), subgrupo: txt(r.NOMSUB), marca: txt(r.NOMTER), tipo: txt(r.TIPPRO), local_erp: txt(r.LOCPRO),
      }));
  });
}

// Saldo de hoje (para detectar movimentação depois do congelamento).
export async function saldosAtuais(codemp: number): Promise<Map<string, number>> {
  return comConexao(async (db) => (await saldos(db, codemp, hoje())).mapa);
}

// Saldo de hoje de alguns produtos.
export async function saldosDe(codpros: string[], codemp: number): Promise<Map<string, number>> {
  return comConexao(async (db) => (await saldos(db, codemp, hoje(), [...new Set(codpros)])).mapa);
}

// Diagnóstico: qual método de saldo este servidor consegue usar.
export async function metodoSaldo(codemp: number) {
  return comConexao(async (db) => {
    const r = await saldos(db, codemp, hoje());
    return { metodo: r.metodo, comSaldo: [...r.mapa.values()].filter((v) => v !== 0).length };
  });
}

// Ajustes de inventário na MESTOQUE (E/S), numa transação única: ou grava tudo, ou nada.
// codfun: usuário logado que lançou (cai no config.lancamento.codfun se não vier).
export async function gravarAjustes(codemp: number, invId: number, ajustes: { codpro: string; ajuste: number; precus: number }[], codfun?: number | null, observacao?: unknown) {
  const cfg = getConfig();
  const obs = juntar(String(cfg.lancamento.obs || "AJUSTE INVENTARIO #{id}").replace("{id}", String(invId)), observacao, 60);
  return emTransacao(async (t) => {
    const out: { codpro: string; codide: number | null }[] = [];
    for (const a of ajustes) {
      const r = await executar(t, `insert into mestoque (codide, codpro, codint, codemp, codfun, datest, qntpro, entsai, obsest, precus, pedent, numlot)
        values (gen_id(gen_mestoque, 1), ?, (select codint from produtos where codpro = ?), ?, ?, ?, ?, ?, ?, ?, ?, '') returning codide`,
        [a.codpro, a.codpro, codemp, codfun ?? cfg.lancamento.codfun ?? null, hoje(), Math.abs(a.ajuste), a.ajuste > 0 ? "E" : "S", obs, a.precus, pedent()]);
      out.push({ codpro: a.codpro, codide: r && r.CODIDE != null ? num(r.CODIDE) : null });
    }
    return out;
  });
}

// Estoque em que os movimentos entram (V = gerencial). Fixo por configuração.
export const pedent = () => String(getConfig().estoque.pedent || "V").slice(0, 1).toUpperCase();

// ---------- usuários do Lieto (FUNCIONARIOS: código + senha do sistema) ----------
// Só a senha: o código do funcionário é descoberto por ela. Se dois ativos tiverem a mesma senha, ninguém entra
// com ela (não dá para saber quem é) até trocarem no Lieto.
export async function validarSenha(senha: string) {
  const alvo = String(senha || "").trim().toUpperCase();
  if (!alvo) return { ok: false as const, erro: "Senha inválida." };
  return comConexao(async (db) => {
    const rs = (await consultar(db, "select codfun, nomfun, apefun, senfun from funcionarios where datdem is null"))
      .filter((r) => txt(r.SENFUN).toUpperCase() === alvo);
    if (!rs.length) return { ok: false as const, erro: "Senha inválida." };
    if (rs.length > 1) return { ok: false as const, erro: "Senha repetida em mais de um funcionário. Altere no Lieto para entrar." };
    const r = rs[0], nomfun = txt(r.NOMFUN), codfun = num(r.CODFUN);
    return { ok: true as const, codfun, nomfun, nome: (txt(r.APEFUN) || nomfun.split(" ")[0] || `USUÁRIO ${codfun}`).toUpperCase() };
  });
}

export async function usuariosAtivos() {
  return comConexao(async (db) => {
    const r = await consultar(db, "select codfun, nomfun, apefun from funcionarios where datdem is null order by apefun, nomfun");
    return r.map((x) => ({ codfun: num(x.CODFUN), nome: (txt(x.APEFUN) || txt(x.NOMFUN)).toUpperCase(), nomfun: txt(x.NOMFUN) }));
  });
}
