// Empresa do Lieto em que cada rotina de estoque grava (Sistema › Empresa por rotina). Sem empresa escolhida, a rotina não grava.
import { db } from "./db";
import * as erp from "./erp";
import { Erro, evento, type Usuario } from "./comum";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const ROTINAS = [
  { id: "producao", nome: "Produção" }, { id: "transformacao", nome: "Transformação" }, { id: "kit", nome: "Kit" },
  { id: "transferencia", nome: "Transferência" }, { id: "retorno", nome: "Retorno" }, { id: "perda", nome: "Perdas" },
  { id: "inventario_avulso", nome: "Inventário avulso" },
];
const ler = (): Record<string, number> => {
  const v = (db().prepare("SELECT valor FROM opcoes WHERE chave = 'empresas.rotinas'").get() as Row | undefined)?.valor;
  return v ? JSON.parse(v) : {};
};

export function empresaDe(rotina: string): number {
  const e = Number(ler()[rotina] || 0);
  if (!e) throw new Erro(`Escolha a empresa de ${ROTINAS.find((r) => r.id === rotina)?.nome || rotina} em Sistema › Empresa por rotina.`);
  return e;
}

export const listar = async () => { const m = ler(); return { empresas: await erp.empresas(), rotinas: ROTINAS.map((r) => ({ ...r, codemp: m[r.id] || 0 })) }; };

export async function salvar(b: Row, u: Usuario) {
  const existe = new Set((await erp.empresas()).map((e) => Number(e.codemp))), m: Record<string, number> = {};
  for (const r of ROTINAS) {
    const e = Number(b.rotinas?.[r.id] || 0);
    if (!e) continue;
    if (!existe.has(e)) throw new Erro(`${r.nome}: a empresa ${e} não existe no Lieto.`);
    m[r.id] = e;
  }
  db().prepare("INSERT INTO opcoes (chave, valor) VALUES ('empresas.rotinas', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(JSON.stringify(m));
  evento("sistema", "empresas", u, "ALTEROU EMPRESA POR ROTINA", JSON.stringify(m));
  return listar();
}
