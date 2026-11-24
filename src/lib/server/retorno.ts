// Retorno de mercadorias, como o Lieto grava (conferido nos 28 itens existentes):
//   RETORNOS1  cabeçalho (NUMDOC), CODFUN, CODMOT = motorista
//   RETORNOS2  item: CODMOT = motivo (MOTIVOS.TIPREG = 'N'), CODSET = centro, TIPRET R = romaneio / P = pedido / A = avulso, STATUS PEN
//   MESTOQUE   DUAS entradas por item, com IDERET: uma sem CODSET (volta ao saldo) e outra com CODSET (localização)
// RETORNOS1 e RETORNOS2 usam o mesmo generator (GEN_RETORNOS1), como nas triggers do Lieto.
import { adicionais, cods, fatores } from "./cadastro";
import * as M from "./movimentos";
import { Erro, agora, obsErp, r4, type Usuario } from "./comum";
import { comConexao, consultar, executar, hoje, num, txt, type Conexao } from "./fb";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const opcoes = () => comConexao(async (c) => ({
  motoristas: (await consultar(c, "select codmot, nommot from motoristas where motati = 'S' order by nommot")).map((r) => ({ id: num(r.CODMOT), nome: txt(r.NOMMOT) })),
  motivos: (await consultar(c, "select codmot, nommot from motivos where tipreg = 'N' order by nommot")).map((r) => ({ id: num(r.CODMOT), nome: txt(r.NOMMOT) })),
  centros: await M.centros(),
}));

// O que saiu no romaneio/pedido e quanto já voltou
export async function origem(tipo: string, n: number) {
  if (!["R", "P"].includes(tipo) || !Number.isInteger(n) || n <= 0) throw new Erro("Informe o número.");
  return comConexao(async (c) => {
    const campo = tipo === "R" ? "numrom" : "numdoc";
    const cab = await consultar(c, `select numdoc, sitdoc, codemp from pedidos1 where ${campo} = ?`, [n]);
    const ok = cab.filter((p) => txt(p.SITDOC) === "FAT" || txt(p.SITDOC) === "ENT");
    if (!cab.length) throw new Erro(`${tipo === "R" ? "Romaneio" : "Pedido"} ${n} não encontrado.`, 404);
    if (!ok.length) throw new Erro("Nenhum pedido faturado aqui: ainda não há o que retornar.");
    const its = await consultar(c, `select b.codpro, max(b.nompro) nompro, max(b.unipro) unipro, sum(b.qntpro) q from pedidos2 b join pedidos1 a on a.numdoc = b.numdoc
      where a.${campo} = ? and a.sitdoc in ('FAT','ENT') and b.baiest = 'S' group by b.codpro order by 2`, [n]);
    const volta = new Map((await consultar(c, `select codpro, sum(qntpro) q from retornos2 where ${tipo === "R" ? "numrom" : "numped"} = ? group by codpro`, [n])).map((r) => [txt(r.CODPRO), num(r.Q)]));
    const ad = await adicionais(c), mot = tipo === "R" ? (await consultar(c, "select codmot from romaneios where numdoc = ?", [n]))[0] : null;
    const itens: Row[] = [];
    for (const i of its) {
      const p = (await consultar(c, "select codbar, coddum, eantri, codint from produtos where codpro = ?", [i.CODPRO]))[0] || {};
      itens.push({ codpro: txt(i.CODPRO), nompro: txt(i.NOMPRO), unipro: txt(i.UNIPRO), saiu: r4(num(i.Q)), fatores: fatores(ad.get(txt(i.CODPRO))), voltou: r4(volta.get(txt(i.CODPRO)) || 0), codigos: [txt(i.CODPRO), txt(p.CODBAR), txt(p.CODDUM), txt(p.EANTRI), ...cods(ad.get(txt(i.CODPRO)))].filter(Boolean) });
    }
    return { tipo, numero: n, pedidos: ok.length, motorista: mot ? num(mot.CODMOT) : 0, itens };
  });
}

export async function registrar(b: Row, u: Usuario) {
  const uid = M.uidDe(b), ex = M.porUid(uid);
  if (ex) return { ...M.obter(ex.id), repetido: true };
  const tipo = String(b.tipo || ""), numero = Number(b.numero || 0), motorista = Number(b.motorista), op = await opcoes();
  if (!["R", "P", "A"].includes(tipo)) throw new Erro("Escolha romaneio, pedido ou avulso.");
  if (!op.motoristas.some((m) => m.id === motorista)) throw new Erro("Escolha o motorista.");
  const itens = ((b.itens || []) as Row[]).map((i) => ({ codpro: String(i.codpro || "").trim(), qtd: r4(i.qtd), motivo: Number(i.motivo), centro: Number(i.centro), obs: String(i.obs || "").trim().slice(0, 50) }));
  if (!itens.length) throw new Erro("Informe os itens.");
  for (const i of itens) {
    if (!i.codpro || !(i.qtd > 0)) throw new Erro("Informe a quantidade de todos os itens.");
    if (!op.motivos.some((m) => m.id === i.motivo)) throw new Erro("Escolha o motivo de todos os itens.");
    if (!op.centros.some((m) => m.id === i.centro)) throw new Erro("Escolha o centro de todos os itens.");
  }
  if (tipo !== "A") {
    const o = await origem(tipo, numero);
    for (const cod of new Set(itens.map((i) => i.codpro))) {
      const s = o.itens.find((x) => x.codpro === cod), q = r4(itens.filter((i) => i.codpro === cod).reduce((t, i) => t + i.qtd, 0));
      if (!s) throw new Erro(`Produto ${cod} não saiu neste ${tipo === "R" ? "romaneio" : "pedido"}.`);
      if (q > r4(s.saiu - s.voltou)) throw new Erro(`${s.nompro}: saiu ${s.saiu}, já voltou ${s.voltou}. Não dá para retornar ${q}.`);
    }
  }
  const ps = await M.lerProdutos(itens.map((i) => i.codpro));
  const ex2 = M.porUid(uid); if (ex2) return { ...M.obter(ex2.id), repetido: true };
  const linhas = itens.flatMap((i, n) => { const p = ps.get(i.codpro)!; return [null, i.centro].map((c) => ({ ...M.linha(p, i.qtd, "E", "RETORNO ENTREGA", p.precus, c), codint: 0, ret: n })); });
  const nome = tipo === "R" ? `Romaneio ${numero}` : tipo === "P" ? `Pedido ${numero}` : "Avulso";
  return M.registrarELancar(M.inserir(uid, "retorno", `${nome}: ${itens.map((i) => `${i.qtd} ${ps.get(i.codpro)!.nompro}`).join(", ")}`.slice(0, 400), linhas, u,
    { obs: b.obs, extra: { tipo, numero, motorista, itens: itens.map((i) => { const p = ps.get(i.codpro)!; return { ...i, nompro: p.nompro, unipro: p.unipro, precus: p.precus }; }) } }), u);
}

// Cabeçalho + itens (chamado dentro da transação do movimento). Devolve o NUMDOC e o IDERET de cada item.
export async function gravar(t: Conexao, m: Row) {
  const e = JSON.parse(m.extra) as Row, g = async () => num((await consultar(t, "select gen_id(gen_retornos1, 1) n from rdb$database"))[0].N), doc = await g(), ids: number[] = [];
  await executar(t, "insert into retornos1 (numdoc, datdoc, hordoc, codfun, codmot, obsdoc) values (?, ?, ?, ?, ?, ?)", [doc, hoje(), agora().slice(11, 19), m.codfun, e.motorista, obsErp(m.obs, 500) || null]);
  for (const i of e.itens as Row[]) {
    const id = await g(); ids.push(id);
    await executar(t, "insert into retornos2 (numide, numdoc, codpro, nompro, unipro, qntpro, precus, codmot, codset, numped, numrom, obspro, status, tipret) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PEN', ?)",
      [id, doc, i.codpro, String(i.nompro).slice(0, 50), i.unipro, i.qtd, i.precus, i.motivo, i.centro, e.tipo === "P" ? e.numero : 0, e.tipo === "R" ? e.numero : 0, i.obs, e.tipo]);
  }
  return { doc, ids, obs: `RETORNO ENTREGA [${String(doc).padStart(7, "0")}]` };
}
