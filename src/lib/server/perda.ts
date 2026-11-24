// Perdas, como o Lieto grava (conferido nas existentes): uma saída na MESTOQUE por item, OBSEST "PERCAS [S1]", CODMOT = motivo
// (MOTIVOS.TIPREG = 'E'), sem CODSET. O relatório FPERDAS lê OBSEST LIKE 'PERCAS%' e não desconta entradas: por isso o
// estorno exclui as linhas em vez de lançar o contrário.
import * as M from "./movimentos";
import { Erro, r4, type Usuario } from "./comum";
import { comConexao, consultar, executar, num, txt, type Conexao } from "./fb";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const motivos = () => comConexao(async (c) => (await consultar(c, "select codmot, nommot from motivos where tipreg = 'E' order by nommot")).map((r) => ({ id: num(r.CODMOT), nome: txt(r.NOMMOT) })));

export async function registrar(b: Row, u: Usuario) {
  const uid = M.uidDe(b), ex = M.porUid(uid);
  if (ex) return { ...M.obter(ex.id), repetido: true };
  const mot = (await motivos()).find((m) => m.id === Number(b.motivo));
  if (!mot) throw new Erro("Escolha o motivo.");
  const itens = ((b.itens || []) as Row[]).map((x) => ({ codpro: String(x.codpro || "").trim(), qtd: r4(x.qtd) }));
  if (!itens.length) throw new Erro("Informe os itens.");
  if (itens.some((x) => !x.codpro || !(x.qtd > 0))) throw new Erro("Informe a quantidade de todos os itens.");
  if (new Set(itens.map((x) => x.codpro)).size !== itens.length) throw new Erro("Item repetido.");
  const ps = await M.lerProdutos(itens.map((x) => x.codpro));
  const ex2 = M.porUid(uid); if (ex2) return { ...M.obter(ex2.id), repetido: true };
  const resumo = `${mot.nome}: ${itens.map((x) => `${x.qtd} ${ps.get(x.codpro)!.unipro} ${ps.get(x.codpro)!.nompro}`).join(", ")}`.slice(0, 400);
  return M.registrarELancar(M.inserir(uid, "perda", resumo,
    itens.map((x) => { const p = ps.get(x.codpro)!; return { ...M.linha(p, x.qtd, "S", "PERCAS [S1]", p.precus, null), codmot: mot.id }; }), u, { obs: b.obs }), u);
}

// Exclui no Lieto só as linhas que este movimento gravou, e só se continuarem como foram gravadas.
export async function excluir(t: Conexao, linhas: M.Linha[]) {
  const ids = linhas.map((l) => Number(l.codide));
  if (!ids.length || ids.some((x) => !Number.isInteger(x) || x <= 0)) throw new Erro("Movimento sem identificação no Lieto.");
  const at = new Map((await consultar(t, `select codide, codpro, qntpro, entsai, obsest, codmot from mestoque where codide in (${ids.join(",")})`)).map((r) => [num(r.CODIDE), r]));
  if (!at.size) return; // já excluído (queda depois do commit, ou alguém excluiu no Lieto)
  for (const l of linhas) {
    const r = at.get(Number(l.codide));
    if (!r || txt(r.CODPRO) !== l.codpro || r4(num(r.QNTPRO)) !== r4(l.qtd) || txt(r.ENTSAI) !== "S" || !txt(r.OBSEST).startsWith("PERCAS") || num(r.CODMOT) !== l.codmot)
      throw new Erro(`${l.nompro}: o registro foi alterado ou excluído no Lieto. Confira lá antes de estornar.`, 409);
  }
  // estas tabelas apagam em cascata junto com a MESTOQUE: havendo vínculo, não exclui
  for (const [tab, campo] of [["lotessaidas", "idemes"], ["despesas", "idemes"], ["armazem2", "ideest"]])
    if (num((await consultar(t, `select count(*) n from ${tab} where ${campo} in (${ids.join(",")})`))[0].N)) throw new Erro(`Há registro em ${tab.toUpperCase()} ligado a esta perda. Estorne pelo Lieto.`, 409);
  for (const id of ids) await executar(t, "delete from mestoque where codide = ?", [id]);
}
