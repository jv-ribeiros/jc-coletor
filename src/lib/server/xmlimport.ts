// Importação da NF-e no Lieto, numa única transação:
//   CLIENTES (se não existir) -> PEDIDOS1/2/3/4 (faturado: é o pedido que baixa o estoque) -> NOTAS1/2/3 -> RECEBER
// A tributação gravada é a do XML autorizado (não é recalculada). NOTIMP = 'P' como as notas de pedido: com TIPEST = 'F'
// a SP_ESTOQUE ignora essas notas e conta só o pedido, então não baixa em dobro.
import { auditar } from "./auditoria";
import { db, getConfig } from "./db";
import * as ddl from "./ddl";
import * as X from "./xml";
import { bloco, blocos, tag, val } from "./xml";
import { Erro, agora, evento, limparObs, obsErp, r4, r6, type Usuario } from "./comum";
import { comConexao, consultar, dataDe, emTransacao, executar, num, txt, type Conexao } from "./fb";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const c = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);

// ---------- configuração por canal (intermediador do XML) ----------
export type Canal = { cnpj: string; nome: string; codven: number; codcon: number; codcor: number; codtip: number; sernot: string };
export const config = (): { auto: boolean; canais: Canal[]; cnpjs: string[] } => {
  const v = (db().prepare("SELECT valor FROM opcoes WHERE chave = 'xml.cfg'").get() as Row | undefined)?.valor;
  return { auto: false, canais: [], cnpjs: [], ...(v ? JSON.parse(v) : {}) };
};
export const canalDe = (n: X.Nota) => config().canais.find((k) => k.cnpj === n.intermCnpj);

export async function salvarConfig(b: Row, u: Usuario) {
  const canais = ((b.canais || []) as Row[]).map((k): Canal => ({ cnpj: String(k.cnpj || "").replace(/\D/g, ""), nome: c(k.nome, 30), codven: Number(k.codven), codcon: Number(k.codcon), codcor: Number(k.codcor), codtip: Number(k.codtip), sernot: c(k.sernot, 1).toUpperCase() }));
  const cnpjs = [...new Set(String(b.cnpjs || "").split(/[^0-9./-]+/).map((x) => x.replace(/\D/g, "")).filter(Boolean))];
  const ruim = cnpjs.find((x) => x.length !== 14);
  if (ruim) throw new Erro(`CNPJ aceito inválido: ${ruim}.`);
  if (new Set(canais.map((k) => k.cnpj)).size !== canais.length) throw new Erro("Há dois canais com o mesmo CNPJ de intermediador.");
  await comConexao(async (t) => {
    for (const k of canais) {
      if (!k.nome || !k.sernot) throw new Erro("Informe nome e série interna de cada canal.");
      for (const [tab, campo, v] of [["vendedores", "codven", k.codven], ["condicoes", "codcon", k.codcon], ["correntistas", "codcor", k.codcor], ["tiposclientes", "codtip", k.codtip]] as const)
        if (!v || !(await consultar(t, `select ${campo} from ${tab} where ${campo} = ?`, [v]))[0]) throw new Erro(`${k.nome}: escolha ${tab}.`);
    }
  });
  db().prepare("INSERT INTO opcoes (chave, valor) VALUES ('xml.cfg', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(JSON.stringify({ auto: !!b.auto, canais, cnpjs }));
  evento("xml", "config", u, "ALTEROU CONFIGURAÇÃO", { auto: !!b.auto, canais, cnpjs });
  X.marcar();
}

export const opcoes = () => comConexao(async (t) => {
  const l = async (sql: string) => (await consultar(t, sql)).map((r) => ({ id: num(r.I), nome: txt(r.N) }));
  return {
    vendedores: await l("select codven i, nomven n from vendedores where venati = 'S' order by nomven"), condicoes: await l("select codcon i, nomcon n from condicoes where conati = 'S' order by nomcon"),
    correntistas: await l("select codcor i, nomcor n from correntistas where corati = 'S' or corati is null order by nomcor"), tipos: await l("select codtip i, nomtip n from tiposclientes order by nomtip"),
  };
});

// ---------- tributação do XML ----------
type Fiscal = Record<string, unknown>;
function tributos(det: string): Fiscal {
  const imp = bloco(det, "imposto"), icms = bloco(imp, "ICMS"), ipi = bloco(imp, "IPI"), pis = bloco(imp, "PIS"), cof = bloco(imp, "COFINS"), dif = bloco(imp, "ICMSUFDest"), cbs = bloco(imp, "IBSCBS");
  const uf = bloco(cbs, "gIBSUF"), mun = bloco(cbs, "gIBSMun"), gc = bloco(cbs, "gCBS");
  const n = (x: string, t: string) => (tag(x, t) === "" ? null : val(x, t));
  return {
    CODTRI: (tag(icms, "orig") || "0") + (tag(icms, "CST") || ""), CODOSN: tag(icms, "CSOSN") || null, MODBAS: n(icms, "modBC"), ICMPRO: val(icms, "pICMS"), REDICM: val(icms, "pRedBC"), BASICM: val(icms, "vBC"), VALICM: val(icms, "vICMS"),
    MODSUB: n(icms, "modBCST"), PORIVA: val(icms, "pMVAST"), ICMSUB: val(icms, "pICMSST"), REDIST: val(icms, "pRedBCST"), BASSUB: val(icms, "vBCST"), VALSUB: val(icms, "vICMSST"),
    PCRICM: val(icms, "pCredSN"), VCRICM: val(icms, "vCredICMSSN"), BASRET: val(icms, "vBCSTRet"), VALRET: val(icms, "vICMSSTRet"),
    BASPOB: val(dif, "vBCFCPUFDest"), ALIPOB: val(dif, "pFCPUFDest"), ICMTER: val(dif, "pICMSUFDest"), ICMINT: val(dif, "pICMSInter"), PORPAR: val(dif, "pICMSInterPart"),
    TRIIPI: tag(ipi, "CST") || "99", ENCIPI: tag(ipi, "cEnq") || "999", IPIPRO: val(ipi, "pIPI"), BASIPI: val(ipi, "vBC"), VALIPI: val(ipi, "vIPI"),
    TRIPIS: tag(pis, "CST"), PISPRO: val(pis, "pPIS"), BASPIS: val(pis, "vBC"), VALPIS: val(pis, "vPIS"), TRICOF: tag(cof, "CST"), COFPRO: val(cof, "pCOFINS"), BASCOF: val(cof, "vBC"), VALCOF: val(cof, "vCOFINS"),
    CLASSTRIB: tag(cbs, "cClassTrib"), BASCBS: val(cbs, "vBC"), ALICBS: val(gc, "pCBS"), REDCBS: val(gc, "pRedAliq"), VALCBS: val(gc, "vCBS"),
    ALIIBS: val(uf, "pIBSUF"), REDIBS: val(uf, "pRedAliq"), VALIBS: val(uf, "vIBSUF"), ALIIBM: val(mun, "pIBSMun"), REDIBM: val(mun, "pRedAliq"), VALIBM: val(mun, "vIBSMun"),
  };
}

// CFOP -> operação do Lieto: a ativa de saída; havendo mais de uma, a mais usada em notas
async function operacao(t: Conexao, cfop: string) {
  const l = await consultar(t, "select codope, nomope, fatope from operacoes where numope = ? and entsai = 'S' and opeati = 'S'", [Number(cfop)]);
  if (l.length < 2) return l[0] ? { codope: num(l[0].CODOPE), nome: txt(l[0].NOMOPE), fatope: txt(l[0].FATOPE) } : null;
  const uso = await consultar(t, `select codope, count(*) n from notas2 where codope in (${l.map((x) => num(x.CODOPE)).join(",")}) group by codope order by 2 desc`);
  const e = l.find((x) => uso[0] && num(x.CODOPE) === num(uso[0].CODOPE)) || l[0];
  return { codope: num(e.CODOPE), nome: txt(e.NOMOPE), fatope: txt(e.FATOPE) };
}

// O que falta para importar (além da validação da nota)
export async function pendencias(n: X.Nota, conteudo: string): Promise<string[]> {
  const out: string[] = [], k = canalDe(n);
  if (!k) out.push(`Canal não configurado para o intermediador ${n.intermCnpj || "(sem intermediador no XML)"}.`);
  if (!/^(\d{11}|\d{14})$/.test(n.destDoc)) out.push("Destinatário sem CPF/CNPJ.");
  await comConexao(async (t) => {
    for (const cf of new Set(n.itens.map((i) => i.cfop))) if (!(await operacao(t, cf))) out.push(`CFOP ${cf} sem operação de saída ativa no Lieto.`);
    if (n.destDoc && num((await consultar(t, "select count(*) n from clientes where cgccpf = ?", [n.destDoc]))[0].N) > 1) out.push("Há mais de um cliente no Lieto com esse CPF/CNPJ.");
    for (const cl of new Set(blocos(conteudo, "cClassTrib"))) if (!(await consultar(t, "select codcbs from tributacaocbs where codcla = ?", [cl.trim()]))[0]) out.push(`Classificação CBS/IBS ${cl} não cadastrada no Lieto.`);
    if (k) {
      const ex = (await consultar(t, "select nfecha from notas1 where numnot = ? and sernot = ?", [n.numero, k.sernot]))[0];
      if (ex && txt(ex.NFECHA) !== n.chave) out.push(`Já existe a nota ${n.numero} na série interna ${k.sernot} com outra chave.`);
    }
  });
  return out;
}

// INSERT montado pelos campos informados (ignora undefined)
function inserir(t: Conexao, tabela: string, o: Row) {
  const ks = Object.keys(o).filter((k) => o[k] !== undefined);
  return executar(t, `insert into ${tabela} (${ks.join(", ")}) values (${ks.map(() => "?").join(", ")})`, ks.map((k) => o[k]));
}
const gen = async (t: Conexao, g: string) => num((await consultar(t, `select gen_id(${g}, 1) n from rdb$database`))[0].N);

async function cliente(t: Conexao, x: string, n: X.Nota, k: Canal, codemp: number) {
  const ex = await consultar(t, "select codcli from clientes where cgccpf = ?", [n.destDoc]);
  if (ex.length > 1) throw new Erro("Há mais de um cliente com esse CPF/CNPJ.");
  if (ex[0]) return { codcli: num(ex[0].CODCLI), novo: false };
  const d = bloco(x, "dest"), e = bloco(d, "enderDest"), hoje = dataDe(agora()), ie = tag(d, "IE");
  const cid = (await consultar(t, "select nomcid from cidades where codcid = ?", [tag(e, "cMun")]))[0];
  const codcli = num((await consultar(t, "select coalesce(max(codcli), 0) + 1 n from clientes"))[0].N), email = tag(d, "email");
  await inserir(t, "clientes", {
    CODCLI: codcli, NOMCLI: c(n.destNome, 50), NOMFAN: c(n.destNome, 50), FISJUR: n.destDoc.length === 11 ? "F" : "J", ENDCLI: c(tag(e, "xLgr"), 50), NUMCLI: c(tag(e, "nro"), 10), COMCLI: c(tag(e, "xCpl"), 60), BAICLI: c(tag(e, "xBairro"), 35),
    CIDCLI: c(cid ? txt(cid.NOMCID) : tag(e, "xMun"), 35), COCCLI: c(tag(e, "cMun"), 7), ESTCLI: c(tag(e, "UF"), 2), CEPCLI: c(tag(e, "CEP"), 9), TELCLI: c(tag(e, "fone"), 40), EMACLI: c(email, 150), EMANFE: c(email, 500),
    CGCCPF: n.destDoc, INSNRG: c(ie, 17), DATCAD: hoje, DATALT: hoje, CODTIP: k.codtip, CODVEN: k.codven, CODCON: k.codcon, CODCOR: k.codcor, RETPIS: "N", RETCOF: "N", ENVPDF: "S", CLIATI: "S", PAICLI: "BRASIL", PAICOD: "1058",
    TIPTRA: "P", SUBSAO: "N", RETISS: "N", TIPCLI: "C", CLIALT: "S", MODNOT: "S", CODEMP: codemp,
  });
  return { codcli, novo: true };
}

// Linhas do pedido (o que sai do estoque) de um item da nota: o próprio produto ou os produtos do kit.
// O valor do kit é dividido pelo preço de venda de cada um no Lieto (faltando preço: pelo custo; senão, pela quantidade). O que sobra vai no último.
async function linhasPedido(t: Conexao, it: X.Item, v: Row, f: Fiscal): Promise<Row[]> {
  const alvo = (v.kit.length ? v.kit : [v]) as Row[], ps: { p: Row; qtd: number; idencm: number | null }[] = [];
  for (const a of alvo) {
    const p = (await consultar(t, "select * from produtos where codpro = ?", [a.codpro]))[0];
    if (!p) throw new Erro(`Produto ${a.codpro} não existe no Lieto.`);
    const ult = (await consultar(t, "select first 1 idencm from notas2 where codpro = ? and idencm > 0 order by numide desc", [a.codpro]))[0];
    ps.push({ p, qtd: Math.round(a.qtd), idencm: ult ? num(ult.IDENCM) : null });
  }
  if (ps.some((x) => !(x.qtd > 0))) throw new Erro(`Quantidade zerada em ${it.xProd}.`);
  const campo = ["PREPRO", "PRECUS"].find((k) => ps.every((x) => num(x.p[k]) > 0)), pesos = ps.map((x) => (campo ? num(x.p[campo]) : 1) * x.qtd), soma = pesos.reduce((s, x) => s + x, 0);
  const dividir = (total: number) => { if (ps.length === 1) return [total]; const l = pesos.map((w) => Math.floor(r6((total * w) / soma) * 100) / 100); l[l.length - 1] = r2(total - l.slice(0, -1).reduce((s, x) => s + x, 0)); return l; };
  const bruto = dividir(it.vProd), desc = dividir(it.desc), frete = dividir(it.frete), outros = dividir(it.outros);
  return ps.map(({ p, qtd, idencm }, k) => ({
    CODPRO: txt(p.CODPRO), CODINT: num(p.CODINT), NOMPRO: c(p.NOMPRO, 50), UNIPRO: c(p.UNIPRO, 3), QNTPRO: qtd, PRECUS: num(p.PRECUS), PREORI: bruto[k] / qtd, PREPRO: (bruto[k] - desc[k]) / qtd, VDENOR: (bruto[k] - desc[k]) / qtd,
    IDENCM: idencm, IDENBM: p.IDENBM ?? null, ALIICM: f.ICMPRO, VALFRE: frete[k], VALOUT: outros[k], pesB: num(p.PESBRU) * qtd, pesL: num(p.PESLIQ) * qtd,
  }));
}
const semPeso = ({ pesB, pesL, ...x }: Row) => { void pesB; void pesL; return x; };

// ---------- importação ----------
// uma importação por vez em todo o processo (API e agendador)
const g = globalThis as unknown as { __xmlFila?: Promise<unknown>; __xmlProc?: boolean; __xmlUlt?: number };
export const importar = (chave: string, u: Usuario, obs?: unknown): Promise<Row> => {
  if (obs !== undefined) db().prepare("UPDATE xmls SET obs = ? WHERE chave = ? AND status IS NOT 'IMPORTADA'").run(limparObs(obs) || null, chave);
  const p = (g.__xmlFila ?? Promise.resolve()).then(() => importarAgora(chave, u)); g.__xmlFila = p.catch(() => {}); return p; };

async function importarAgora(chave: string, u: Usuario): Promise<Row> {
  const reg = db().prepare("SELECT * FROM xmls WHERE chave = ?").get(chave) as Row | undefined;
  if (!reg) throw new Erro("XML não encontrado.", 404);
  if (reg.status === "IMPORTADA") return { status: reg.status, pedido: reg.pedido };
  try {
    await ddl.exigir("xml");
    const d = await X.detalhe(chave), n = d.nota, x = bloco(reg.conteudo, "infNFe");
    // conteúdo já no Lieto por esta importação (queda depois do commit): só reconcilia
    const ja = await comConexao((t) => consultar(t, "select numnot, sernot from notas1 where nfecha = ? and datimp is not null", [chave]));
    if (ja[0]) {
      const pe = await comConexao((t) => consultar(t, "select first 1 p.numdoc from notas2 a join pedidos2 p on p.numide = a.ideped where a.numnot = ? and a.sernot = ?", [num(ja[0].NUMNOT), txt(ja[0].SERNOT)]));
      return concluir(chave, num(pe[0]?.NUMDOC), u, "RECONCILIOU COM O LIETO");
    }
    if (d.erros.length) throw new Erro(d.erros.join(" "));
    const k = canalDe(n)!, cfg = getConfig(), ide = bloco(x, "ide"), emi = dataDe(n.emissao), hora = n.emissao.slice(11, 19), dets = blocos(x, "det"), usu = u.codfun || cfg.lancamento.codfun, tot = bloco(x, "ICMSTot"), ib = bloco(x, "IBSCBSTot");
    const r = await emTransacao(async (t) => {
      if ((await consultar(t, "select numnot from notas1 where nfecha = ?", [chave]))[0]) throw new Erro("Nota já está no Lieto.");
      const codemp = (await X.empresasPorCnpj(t)).get(n.emitente);
      if (!codemp) throw new Erro(`Emitente ${n.emitente} não é nenhuma empresa cadastrada no Lieto.`);
      // a série pode ser a mesma das notas emitidas pelo Lieto: confere o número de novo, já dentro da transação
      if ((await consultar(t, "select numnot from notas1 where numnot = ? and sernot = ?", [n.numero, k.sernot]))[0]) throw new Erro(`Já existe a nota ${n.numero} na série interna ${k.sernot} com outra chave.`);
      const cl = await cliente(t, x, n, k, codemp), cd = (await consultar(t, "select * from clientes where codcli = ?", [cl.codcli]))[0];
      const cond = (await consultar(t, "select * from condicoes where codcon = ?", [k.codcon]))[0];
      const itens: Row[] = [];
      for (let i = 0; i < n.itens.length; i++) {
        const it = n.itens[i], v = d.itens[i].produto, p = (await consultar(t, "select * from produtos where codpro = ?", [v.codpro]))[0], op = (await operacao(t, it.cfop))!, f = tributos(dets[i]);
        const ult = (await consultar(t, "select first 1 idencm from notas2 where codpro = ? and idencm > 0 order by numide desc", [v.codpro]))[0];
        const cb = f.CLASSTRIB ? (await consultar(t, "select codcbs from tributacaocbs where codcla = ?", [f.CLASSTRIB]))[0] : null;
        delete f.CLASSTRIB;
        const ls = await linhasPedido(t, it, v, f), peso = (a: string) => r4(ls.reduce((s, x) => s + x[a], 0));
        itens.push({ it, p, op, f, ls, kit: v.kit.length > 0, pesB: peso("pesB"), pesL: peso("pesL"), qtd: Math.round(v.qtd), idencm: ult ? num(ult.IDENCM) : null, codcbs: cb ? num(cb.CODCBS) : null });
      }
      const pesB = r4(itens.reduce((s, i) => s + i.pesB, 0)), pesL = r4(itens.reduce((s, i) => s + i.pesL, 0));

      // pedido faturado
      const numdoc = await gen(t, "gen_pedidos1");
      await inserir(t, "pedidos1", {
        NUMDOC: numdoc, CODCLI: cl.codcli, DATDOC: emi, NUMORC: n.numero, CODVEN: k.codven, CODCON: k.codcon, CODCOR: k.codcor, TOTPED: n.vNota, PDEQNT: 100, DATFAT: emi, TIPFRE: c(tag(x, "modFrete"), 1) || "9",
        PESBRU: pesB, PESLIQ: pesL, PEDORC: "P", TIPPDE: "1", DATENT: emi, TIPPRE: "T", CODEMP: codemp, FUNCON: usu, CODUSU: usu, HORENT: hora.slice(0, 5), SITDOC: "FAT", DATPRE: emi, DATALT: new Date(), COMMAN: "A",
        OBSINT: obsErp(reg.obs, 500) || undefined, SERNOT: k.sernot, PESMAN: "A", MODNOT: "N", INDPRE: tag(ide, "indPres") || "2", BAIEST: "S", FRERED: "0", DATIMP: new Date(), PEDMAR: c(n.pedidoMarket, 50) || null, PEDCLI: c(n.pedidoMarket, 15) || null,
      });
      await inserir(t, "pedidos3", { NUMDOC: numdoc });
      for (const i of itens) {
        i.peds = [];
        for (const l of i.ls) {
          const numide = await gen(t, "gen_pedidos2");
          await inserir(t, "pedidos2", { NUMIDE: numide, NUMDOC: numdoc, ...semPeso(l), TIPPRO: "VND", BAIEST: "S", SERPEC: "P", CODDES: 1, CHANFO: "AF", HORPRO: hora, COMMAN: "A" });
          i.peds.push({ numide, codpro: l.CODPRO });
        }
        i.ideped = i.peds[0].numide;
      }

      // nota (tributação do XML)
      const soma = (a: string) => r2(itens.reduce((s, i) => s + (Number(i.f[a]) || 0), 0)), fat = itens.some((i) => i.op.fatope === "S");
      await inserir(t, "notas1", {
        NUMNOT: n.numero, SERNOT: k.sernot, CODCLI: cl.codcli, NOMCLI: c(cd.NOMCLI, 50), ENDCLI: c(cd.ENDCLI, 50), NUMCLI: c(cd.NUMCLI, 10), BAICLI: c(cd.BAICLI, 35), CIDCLI: c(cd.CIDCLI, 35), ESTCLI: c(cd.ESTCLI, 2), CEPCLI: c(cd.CEPCLI, 9),
        TELCLI: c(cd.TELCLI, 40), CGCCPF: n.destDoc, INSEST: c(cd.INSNRG, 17), ENTSAI: "S", CODOPE: 0, DATEMI: emi, DATSAI: emi, BASICM: val(tot, "vBC"), VALICM: val(tot, "vICMS"), BASSUB: val(tot, "vBCST"), VALSUB: val(tot, "vST"),
        TOTPRO: n.vProd, VALFRE: n.vFrete, TIPFRE: Number(tag(x, "modFrete") || 9), VALSEG: val(tot, "vSeg"), VALDES: n.vDesc, OUTDES: n.vOutros, TOTIPI: val(tot, "vIPI"), TOTPIS: val(tot, "vPIS"), TOTCOF: val(tot, "vCOFINS"), TOTNOT: n.vNota,
        CODVEN: k.codven, CODCON: k.codcon, CODCOR: k.codcor, PESBRU: pesB, PESLIQ: pesL, FATOPE: fat ? "S" : "N", NOTCAN: "N", NOTIMP: "P", CALMAN: "C", NFECHA: chave, NFEREC: null, NFEPRO: c(tag(bloco(reg.conteudo, "infProt"), "nProt"), 30),
        FINEMI: "1", FOREMI: "0", DESOPE: c(n.natOp, 60), TOTFAT: n.vNota, CRTEMP: c(tag(bloco(x, "emit"), "CRT"), 1), SERNFE: c(n.serie, 3), NFEAMB: "P", HOREMI: hora, DATGNR: emi, DATDEC: emi, CODCHA: Number(tag(ide, "cNF")) || null,
        FORPAG: c(n.pagamentos[0]?.tipo, 2) || "99", CODEMP: codemp, MODNOT: "N", PESMAN: "A", CODUSU: usu, INDPRE: tag(ide, "indPres") || "2", BASCBS: val(ib, "vBCIBSCBS"), TOTCBS: soma("VALCBS"), TOTIBS: soma("VALIBS"), TOTIBM: soma("VALIBM"),
        DATIMP: new Date(), ORINOT: "N", PEDMAR: c(n.pedidoMarket, 50) || null, LOCPRE: "E", TIPCRE: "0", TIPDEB: "0",
      });
      await inserir(t, "notas3", { NUMNOT: n.numero, SERNOT: k.sernot });
      for (const i of itens) await inserir(t, "notas2", {
        NUMIDE: await gen(t, "gen_notas2"), NUMNOT: n.numero, SERNOT: k.sernot, CODPRO: txt(i.p.CODPRO), CODINT: num(i.p.CODINT), NOMPRO: c(i.it.xProd, 200), UNIPRO: c(i.p.UNIPRO, 3), QNTPRO: i.qtd, PRECUS: r6(i.p.PRECUS), PREORI: i.it.vProd / i.qtd, PREPRO: i.it.vProd / i.qtd,
        CODOPE: i.op.codope, CODNCM: c(i.it.ncm, 8), PESBRU: i.pesB, PESLIQ: i.pesL, BAIEST: i.kit ? "N" : "S", FATOPE: i.op.fatope, TIPSPE: txt(i.p.TIPSPE) || null, PRETOT: i.it.vProd, IDENCM: i.idencm, IDENBM: i.p.IDENBM ?? null,
        VALFRE: i.it.frete, VALDES: i.it.desc, VALOUT: i.it.outros, CONPRE: "N", BAIEXT: "N", SOMNOT: "S", TIPPRO: "VND", IDEPED: i.ideped, CODCBS: i.codcbs, ...i.f,
      });

      // financeiro: parcelas da condição, valor bruto da nota (o XML não traz a comissão), na ficha do cliente da venda.
      // Já vêm BAIXADAS, como o Lieto baixa: RECEBER pago + RECEBIMENTOS + FLUXO (na conta destino CORDES, se houver).
      const cor = (await consultar(t, "select cordes from correntistas where codcor = ?", [k.codcor]))[0], contaFluxo = num(cor?.CORDES) || k.codcor;
      const pagador = txt(cd.NOMCLI);
      if (fat) {
        const np = Math.max(1, num(cond.QNTPAR)), base = Math.floor((n.vNota * 100) / np) / 100;
        for (let q = 1; q <= np; q++) {
          const ven = new Date(emi); ven.setDate(ven.getDate() + num(cond["DIAS" + String(q).padStart(2, "0")]));
          const valor = q === np ? r2(n.vNota - base * (np - 1)) : base;
          await inserir(t, "pedidos4", { NUMIDE: await gen(t, "gen_pedidos4"), NUMDOC: numdoc, NUMPAR: String(q), CODCOR: k.codcor, DATVEN: ven, VALPAR: valor, FATNOT: "F" });
          const iderec = await gen(t, "gen_receber"), ideb = await gen(t, "gen_recebimentos"), par = `${String(q).padStart(2, "0")}/${String(np).padStart(2, "0")}`;
          await inserir(t, "receber", { NUMIDE: iderec, NUMDOC: n.numero, TIPDOC: "A", SERNOT: k.sernot, NUMPAR: par, CODCLI: cl.codcli, CODCOR: k.codcor,
            DATDOC: emi, DATVEN: ven, VALPAR: valor, OBSERV: c(`${k.nome} ${n.pedidoMarket}`, 200), NUMPED: numdoc, CODVEN: k.codven, CODEMP: codemp,
            VALDES: 0, VALJUR: 0, VALACR: 0, DATPAG: emi, VALPAG: valor });
          await inserir(t, "recebimentos", { NUMIDE: ideb, IDEREC: iderec, CODCOR: k.codcor, IDELOT: 0, DATPAG: emi, VALPAG: valor, QNTPAR: 1, PORCAR: 0, VALDES: 0, VALJUR: 0, CODUSU: usu, CODCAI: 1, HORPAG: hora });
          await inserir(t, "fluxo", { NUMIDE: await gen(t, "gen_fluxo"), CODCOR: contaFluxo, DATDOC: emi, HORDOC: hora, VALDOC: valor, HISDOC: c(`RECEBIMENTO REF. DOC. NRO. NFE: ${n.numero}-${par} - ${pagador}`, 150), CREDEB: "+", CODPAG: 0, ORIGEM: "REC", IDEREC: ideb,
            TIPPAG: k.codcor === 3 ? "DIN" : k.codcor === 2 ? "CHE" : "OUT", DATCOM: emi, CODUSU: usu, CODCAI: 1, DATLAN: dataDe(agora()), IDEOFX: 0 });
        }
      }
      return { numdoc, cli: cl, peds: itens.map((i) => i.peds) };
    });
    r.peds.forEach((p, k) => guardarLinhas(chave, k + 1, p));
    return concluir(chave, r.numdoc, u, r.cli.novo ? `IMPORTOU (cliente novo ${r.cli.codcli})` : "IMPORTOU");
  } catch (e) {
    db().prepare("UPDATE xmls SET status = 'ERRO', erro = ? WHERE chave = ?").run((e as Error).message, chave);
    evento("xml", chave, u, "ERRO AO IMPORTAR", (e as Error).message);
    throw e;
  }
}
const guardarLinhas = (chave: string, n: number, peds: unknown) => db().prepare("INSERT INTO xml_linhas (chave, n, peds) VALUES (?,?,?) ON CONFLICT(chave, n) DO UPDATE SET peds = excluded.peds").run(chave, n, JSON.stringify(peds));

// ---------- correção das notas já importadas quando o vínculo muda ----------
const importadasCom = (emitente: string, cprod: string, un: string, de = "") => {
  const out: { chave: string; numero: number; emissao: string; pedido: number; nota: X.Nota; ns: number[]; conteudo: string }[] = [];
  for (const x of db().prepare("SELECT chave, numero, emissao, pedido, conteudo FROM xmls WHERE status = 'IMPORTADA' AND substr(chave, 7, 14) = ? AND substr(emissao, 1, 10) >= ? ORDER BY emissao").all(emitente, de) as Row[]) {
    let r; try { r = X.ler(x.conteudo); } catch { continue; }
    if (r.tipo !== "nota") continue;
    const ns = r.nota.itens.filter((i) => i.cProd === cprod && i.un === un).map((i) => i.n);
    if (ns.length) out.push({ chave: x.chave, numero: x.numero, emissao: x.emissao, pedido: x.pedido, nota: r.nota, ns, conteudo: x.conteudo });
  }
  return out;
};
export function impacto(q: URLSearchParams) {
  return { notas: importadasCom(q.get("emitente") || "", q.get("cprod") || "", q.get("un") || "").map((x) => ({ numero: x.numero, emissao: x.emissao, pedido: x.pedido })) };
}
export async function corrigir(b: Row, u: Usuario) {
  const de = String(b.de || "");
  if (de && !/^\d{4}-\d{2}-\d{2}$/.test(de)) throw new Erro("Data inválida.");
  const l = importadasCom(String(b.emitente || ""), String(b.cprod || ""), String(b.un || ""), de);
  await ddl.exigir("xml");
  const falhas: { numero: number; motivo: string }[] = []; let ok = 0;
  for (const x of l) {
    const p = (g.__xmlFila ?? Promise.resolve()).then(() => corrigirNota(x, u)); g.__xmlFila = p.catch(() => {});
    try { await p; ok++; } catch (e) { falhas.push({ numero: x.numero, motivo: (e as Error).message }); evento("xml", x.chave, u, "NÃO CORRIGIU O VÍNCULO", (e as Error).message); }
  }
  return { ok, falhas };
}
async function corrigirNota(x: ReturnType<typeof importadasCom>[number], u: Usuario) {
  const feitas = await emTransacao(async (t) => {
    const n1 = (await consultar(t, "select numnot, sernot, notcan from notas1 where nfecha = ? and datimp is not null", [x.chave]))[0];
    if (!n1) throw new Erro("Nota não encontrada no Lieto.");
    if (txt(n1.NOTCAN) === "S") throw new Erro("Nota cancelada no Lieto.");
    const pe = (await consultar(t, "select sitdoc from pedidos1 where numdoc = ?", [x.pedido]))[0];
    if (!pe || txt(pe.SITDOC) !== "FAT") throw new Erro(`Pedido ${x.pedido} não está mais faturado no Lieto.`);
    if ((await consultar(t, "select first 1 numdev from devolucoes1 where numped = ?", [x.pedido]))[0]) throw new Erro(`Pedido ${x.pedido} tem devolução.`);
    if ((await consultar(t, "select first 1 numide from conferencias1 where numped = ?", [x.pedido]))[0] || db().prepare("SELECT 1 FROM conferencias WHERE status IN ('CONTANDO','RECONTANDO') AND (pedido = ? OR pedidos LIKE ?)").get(x.pedido, `%"pedido":${x.pedido},%`)) throw new Erro(`Pedido ${x.pedido} já tem conferência.`);
    const nl = await consultar(t, "select numide, ideped, codpro from notas2 where numnot = ? and sernot = ? order by numide", [num(n1.NUMNOT), txt(n1.SERNOT)]);
    const pl = await consultar(t, "select numide, codpro from pedidos2 where numdoc = ?", [x.pedido]);
    if (nl.length !== x.nota.itens.length) throw new Erro("A nota foi alterada no Lieto.");
    const out: { n: number; peds: { numide: number; codpro: string }[] }[] = [], dets = blocos(bloco(x.conteudo, "infNFe"), "det");
    for (const n of x.ns) {
      const it = x.nota.itens[n - 1], li = nl[n - 1], v = await X.resolver(t, x.nota.emitente, it);
      if (!v) throw new Erro("O vínculo não está completo.");
      if ([v, ...v.kit].some((k) => Math.abs(k.qtd - Math.round(k.qtd)) > 1e-6)) throw new Erro("Quantidade fracionada.");
      if (v.kit.length && txt((await consultar(t, "select e.tipest from empresas e join pedidos1 p on p.codemp = e.codemp where p.numdoc = ?", [x.pedido]))[0]?.TIPEST) === "N") throw new Erro("Esta empresa baixa o estoque pela nota: kit não é aceito.");
      const reg = db().prepare("SELECT peds FROM xml_linhas WHERE chave = ? AND n = ?").get(x.chave, n) as Row | undefined;
      if (!reg && pl.length !== nl.length) throw new Erro("O pedido foi alterado no Lieto.");
      const velhas = reg ? (JSON.parse(reg.peds) as { numide: number; codpro: string }[]) : [{ numide: num(li.IDEPED), codpro: txt(li.CODPRO) }];
      for (const a of velhas) if (!pl.some((y) => num(y.NUMIDE) === a.numide && txt(y.CODPRO) === a.codpro)) throw new Erro("O item foi alterado no Lieto.");
      const p = (await consultar(t, "select * from produtos where codpro = ?", [v.codpro]))[0], ls = await linhasPedido(t, it, v, tributos(dets[n - 1])), peds: { numide: number; codpro: string }[] = [], q = Math.round(v.qtd);
      if (!(q > 0)) throw new Erro("Quantidade zerada.");
      const ult = (await consultar(t, "select first 1 idencm from notas2 where codpro = ? and idencm > 0 order by numide desc", [v.codpro]))[0];
      const mudar = (tab: string, o: Row, id: number) => executar(t, `update ${tab} set ${Object.keys(o).map((k) => k + " = ?").join(", ")} where numide = ?`, [...Object.values(o), id]);
      // primeiro para de baixar o estoque: há bases com gatilho de compensação que só desfaz a do produto que ainda está na linha
      for (const a of velhas) await mudar("pedidos2", { BAIEST: "N" }, a.numide);
      await mudar("notas2", { BAIEST: "N" }, num(li.NUMIDE));
      for (let k = 0; k < ls.length; k++) {
        let id = velhas[k]?.numide;
        if (id) await mudar("pedidos2", { ...semPeso(ls[k]), BAIEST: "S" }, id);
        else { id = await gen(t, "gen_pedidos2"); await inserir(t, "pedidos2", { NUMIDE: id, NUMDOC: x.pedido, ...semPeso(ls[k]), TIPPRO: "VND", BAIEST: "S", SERPEC: "P", CODDES: 1, CHANFO: "AF", HORPRO: x.emissao.slice(11, 19), COMMAN: "A" }); }
        peds.push({ numide: id, codpro: ls[k].CODPRO });
      }
      for (const a of velhas.slice(ls.length)) await executar(t, "delete from pedidos2 where numide = ?", [a.numide]);
      await mudar("notas2", { CODPRO: txt(p.CODPRO), CODINT: num(p.CODINT), UNIPRO: c(p.UNIPRO, 3), QNTPRO: q, PRECUS: r6(p.PRECUS), PREORI: it.vProd / q, PREPRO: it.vProd / q, IDENCM: ult ? num(ult.IDENCM) : null, IDENBM: p.IDENBM ?? null,
        PESBRU: r4(ls.reduce((s, y) => s + y.pesB, 0)), PESLIQ: r4(ls.reduce((s, y) => s + y.pesL, 0)), BAIEST: v.kit.length ? "N" : "S" }, num(li.NUMIDE));
      out.push({ n, peds });
    }
    return out;
  });
  for (const y of feitas) guardarLinhas(x.chave, y.n, y.peds);
  evento("xml", x.chave, u, "CORRIGIU O VÍNCULO NA NOTA IMPORTADA", { pedido: x.pedido, itens: feitas.map((y) => `${y.n}: ${y.peds.map((k) => k.codpro).join(" + ")}`).join("; ") });
}
function concluir(chave: string, pedido: number, u: Usuario, acao: string) {
  db().prepare("UPDATE xmls SET status = 'IMPORTADA', erro = NULL, pedido = ?, importado_em = ? WHERE chave = ?").run(pedido, agora(), chave);
  evento("xml", chave, u, acao, { pedido });
  try { X.arquivar(chave); } catch (e) { evento("xml", chave, u, "IMPORTOU, MAS NÃO COPIOU O ARQUIVO", (e as Error).message); console.error("[XML] arquivo:", (e as Error).message); }
  return { status: "IMPORTADA", pedido };
}

// Importa sozinho o que estiver pronto (se ligado). Só roda quando algo mudou: XML novo, vínculo ou configuração.
export async function processar() {
  if (g.__xmlProc || !config().auto) return;
  // algo mudou, ou já faz 2 min: pega também o que foi corrigido direto no Lieto
  if (!X.consumirMarca() && Date.now() - (g.__xmlUlt || 0) < 120_000) return;
  g.__xmlUlt = Date.now();
  g.__xmlProc = true;
  const sis: Usuario = { codfun: getConfig().lancamento.codfun || 1, nome: "AUTOMÁTICO", nomfun: "" };
  try {
    const s = await ddl.status();
    if (!s.rotinas.find((r) => r.id === "xml")?.ok) { X.marcar(); return; } // banco bloqueado: tenta de novo depois
    const aceitos = new Set((await comConexao((t) => X.empresasPorCnpj(t))).keys());
    // posições 7-20 da chave = CNPJ do emitente, 21-22 = modelo: descarta as de fora sem abrir nem consultar o Lieto
    for (const r of db().prepare("SELECT chave FROM xmls WHERE status IS NULL AND substr(chave, 21, 2) = '55' ORDER BY emissao").all() as Row[]) {
      if (!aceitos.has(r.chave.slice(6, 20))) continue;
      try { if (!(await X.detalhe(r.chave)).erros.length) await auditar({ origem: "AUTOMATICO", rota: "xml/importar", ref: r.chave, codfun: sis.codfun, usuario: sis.nome }, () => importar(r.chave, sis)); } catch (e) { console.error("[XML]", r.chave, (e as Error).message); }
    }
  } finally { g.__xmlProc = false; }
}

// ---------- cadastro de produto a partir do XML ----------
// Copia um produto-modelo do Lieto (grupo, tributação, parâmetros) e troca nome, unidade, barras, NCM e custo.
export async function cadastrarProduto(b: Row, u: Usuario) {
  const d = await X.detalhe(String(b.chave || "")), it = d.nota.itens.find((i) => i.n === Number(b.item)), modelo = String(b.modelo || "").trim();
  if (!it) throw new Erro("Item não encontrado.");
  if (!d.aceitos.includes(d.nota.emitente)) throw new Erro("Nota de outra empresa.");
  await ddl.exigir("xml");
  const codpro = await emTransacao(async (t) => {
    const m = (await consultar(t, "select * from produtos where codpro = ?", [modelo]))[0];
    if (!m) throw new Erro("Produto-modelo não existe.");
    const nbm = (await consultar(t, "select codide from nbm where codnbm = ? order by codide", [it.ncm]))[0];
    if (!nbm) throw new Erro(`NCM ${it.ncm} não cadastrado no Lieto (tabela NBM).`);
    const cods = (await consultar(t, "select codpro, codint from produtos")).flatMap((r) => [Number(txt(r.CODPRO)), num(r.CODINT)]).filter((v) => Number.isInteger(v) && v > 0 && v < 1e6);
    const novo = Math.max(0, ...cods) + 1, cod = String(novo);
    if ((await consultar(t, "select codpro from produtos where codpro = ?", [cod]))[0]) throw new Erro(`Código ${cod} já existe.`);
    const o: Row = {};
    for (const k of Object.keys(m)) if (m[k] != null && typeof m[k] !== "function") o[k] = typeof m[k] === "string" ? (m[k] as string).trimEnd() : m[k];
    const hoje = dataDe(agora());
    Object.assign(o, { CODPRO: cod, CODINT: novo, NOMPRO: c(b.nome || it.xProd, 50).toUpperCase(), UNIPRO: c(b.unidade || it.un, 3).toUpperCase(), UNICOM: c(b.unidade || it.un, 3).toUpperCase(), CODBAR: it.ean || "", IDENBM: num(nbm.CODIDE), PROATI: "S", DATCAD: hoje, DATPRO: hoje });
    for (const k of ["CODDUM", "EANTRI", "REF001", "REF002", "QNTEST", "ESTMIN", "PRECUS", "CUSUNI", "PREPRO", "PREMIN", "CODSIM", "PRENEC", "DATNEC"]) delete o[k];
    await inserir(t, "produtos", o);
    return cod;
  });
  evento("xml", codpro, u, "CADASTROU PRODUTO", { modelo, xProd: it.xProd, ncm: it.ncm });
  await X.vincular({ emitente: d.nota.emitente, cProd: it.cProd, un: it.un, codpro, fator: 1, kit: b.kit }, u);
  return { codpro };
}
