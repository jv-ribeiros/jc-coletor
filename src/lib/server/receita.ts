// Receita (CONJUNTOS): insumos de um produto. QNTVEN > 0 = "QNTCON do insumo rende QNTVEN" (ex.: 1 CX = 12 UN); senão QNTCON por unidade.
import { db } from "./db";
import * as ddl from "./ddl";
import { Erro, agora, evento, limparObs, r6, type Usuario } from "./comum";
import { comConexao, consultar, emTransacao, executar, num, txt, type Conexao } from "./fb";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const obter = (codpro: string) => comConexao(async (c) => (await consultar(c, `select k.codcon, k.qntcon, k.qntven, k.baiest, k.profor, p.nompro, p.unipro, p.precus, p.proati
  from conjuntos k join produtos p on p.codpro = k.codcon where k.codpro = ? order by k.numreg, k.codcon`, [codpro])).map((r) => ({ codcon: txt(r.CODCON), nompro: txt(r.NOMPRO), unipro: txt(r.UNIPRO), qntcon: num(r.QNTCON), qntven: num(r.QNTVEN), baixa: txt(r.BAIEST) === "S", custo: num(r.PRECUS), ativo: txt(r.PROATI) !== "N" })));

// O Lieto não tem campo de observação na receita: fica só aqui.
export const observacoes = (codpro: string) => db().prepare("SELECT texto, por, em FROM observacoes WHERE modulo = 'receita' AND ref = ? ORDER BY id DESC LIMIT 10").all(codpro);
function anotar(codpro: string, b: Row, acao: string, u: Usuario) {
  const o = limparObs(b.obs);
  if (o) db().prepare("INSERT INTO observacoes (modulo, ref, texto, por, em) VALUES ('receita', ?, ?, ?, ?)").run(codpro, `${acao}: ${o}`, u.nome, agora());
}

// O insumo não pode depender (direta ou indiretamente) do próprio produto
async function ciclo(t: Conexao, codpro: string, codcon: string) {
  const fila = [codcon], vistos = new Set<string>();
  while (fila.length) {
    const x = fila.pop()!;
    if (x === codpro) return true;
    if (vistos.has(x)) continue;
    vistos.add(x);
    for (const r of await consultar(t, "select codcon from conjuntos where codpro = ?", [x])) fila.push(txt(r.CODCON));
  }
  return false;
}
const quant = (b: Row) => {
  const n = (v: unknown) => r6(Number(String(v ?? "").replace(",", "."))), qntcon = n(b.qntcon), qntven = n(b.qntven || 0);
  if (!(qntcon > 0) || qntcon > 999999) throw new Erro("Quantidade do insumo inválida.");
  if (!(qntven >= 0) || qntven > 999999) throw new Erro("Rendimento inválido.");
  return { qntcon, qntven };
};

export async function salvar(codpro: string, b: Row, u: Usuario) {
  const codcon = String(b.codcon || "").trim(), { qntcon, qntven } = quant(b);
  if (!codcon || codcon === codpro) throw new Erro("Insumo inválido.");
  await ddl.exigir("cadastro");
  const acao = await emTransacao(async (t) => {
    for (const c of [codpro, codcon]) if (!(await consultar(t, "select codpro from produtos where codpro = ?", [c]))[0]) throw new Erro(`Produto ${c} não existe.`);
    const at = (await consultar(t, "select qntcon, qntven from conjuntos where codpro = ? and codcon = ?", [codpro, codcon]))[0];
    if (at) {
      if (!b.antes) throw new Erro("Este insumo já está na receita.");
      if (num(at.QNTCON) !== Number(b.antes.qntcon) || num(at.QNTVEN) !== Number(b.antes.qntven)) throw new Erro("A receita foi alterada por outra pessoa. Abra o produto de novo.", 409);
      await executar(t, "update conjuntos set qntcon = ?, qntven = ? where codpro = ? and codcon = ?", [qntcon, qntven, codpro, codcon]);
      return `ALTEROU ${codcon}: ${num(at.QNTCON)}/${num(at.QNTVEN)} > ${qntcon}/${qntven}`;
    }
    if (b.antes) throw new Erro("Este insumo saiu da receita. Abra o produto de novo.", 409);
    if (await ciclo(t, codpro, codcon)) throw new Erro("Este insumo já usa o próprio produto na receita dele.");
    const n = num((await consultar(t, "select coalesce(max(numreg), -1) + 1 n from conjuntos where codpro = ?", [codpro]))[0].N);
    await executar(t, "insert into conjuntos (codpro, codcon, qntcon, qntven, numreg, baiest, entsai, porcon, profor, medcom, medlar, medalt, medpec) values (?, ?, ?, ?, ?, 'S', 'S', 0, 'P', 0, 0, 0, 0)", [codpro, codcon, qntcon, qntven, n]);
    return `INCLUIU ${codcon}: ${qntcon}/${qntven}`;
  });
  evento("cadastro", codpro, u, "RECEITA", acao);
  anotar(codpro, b, acao, u);
  return obter(codpro);
}

export async function remover(codpro: string, b: Row, u: Usuario) {
  const codcon = String(b.codcon || "").trim();
  await ddl.exigir("cadastro");
  await emTransacao(async (t) => {
    const at = (await consultar(t, "select qntcon, qntven from conjuntos where codpro = ? and codcon = ?", [codpro, codcon]))[0];
    if (!at) throw new Erro("Insumo não está na receita.", 404);
    await executar(t, "delete from conjuntos where codpro = ? and codcon = ?", [codpro, codcon]);
    evento("cadastro", codpro, u, "RECEITA", `REMOVEU ${codcon}: ${num(at.QNTCON)}/${num(at.QNTVEN)}`);
  });
  anotar(codpro, b, `REMOVEU ${codcon}`, u);
  return obter(codpro);
}
