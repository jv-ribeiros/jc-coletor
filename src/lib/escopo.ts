// Escopo do inventário: lista de itens montada por Grupo, Subgrupo, Marca, Tipo e/ou Produtos avulsos.
// Usado tanto na prévia (navegador) quanto na abertura (servidor), para dar exatamente o mesmo resultado.

export type Escopo = { grupos: string[]; subgrupos: string[]; marcas: string[]; tipos: string[]; produtos: string[]; avulso?: boolean };
export const ESCOPO_VAZIO: Escopo = { grupos: [], subgrupos: [], marcas: [], tipos: [], produtos: [] };

export type ProdutoBase = { codpro: string; grupo: string; subgrupo: string; marca: string; tipo: string };

export const escopoAtivo = (e?: Partial<Escopo> | null) =>
  !!e && ["grupos", "subgrupos", "marcas", "tipos", "produtos"].some((k) => (e[k as Exclude<keyof Escopo, "avulso">] || []).length > 0);

// Um item entra se atender a QUALQUER critério marcado (união). Sem critério = inventário geral.
export function filtrarEscopo<T extends ProdutoBase>(produtos: T[], e?: Partial<Escopo> | null): T[] {
  if (!escopoAtivo(e)) return produtos;
  const s = (k: Exclude<keyof Escopo, "avulso">) => new Set(e![k] || []);
  const g = s("grupos"), sg = s("subgrupos"), m = s("marcas"), t = s("tipos"), p = s("produtos");
  return produtos.filter((x) => g.has(x.grupo) || sg.has(x.subgrupo) || m.has(x.marca) || t.has(x.tipo) || p.has(x.codpro));
}

export const NOME_TIPO: Record<string, string> = { V: "Venda", B: "Beneficiamento" };

export function descreverEscopo(e?: Partial<Escopo> | null): string {
  if (e?.avulso) return "Avulso (só os itens lidos)";
  if (!escopoAtivo(e)) return "Inventário geral (todos os itens)";
  const partes: string[] = [];
  const lista = (rot: string, v: string[] = []) => v.length && partes.push(`${rot}: ${v.length > 4 ? `${v.slice(0, 4).join(", ")} +${v.length - 4}` : v.join(", ")}`);
  lista("Grupos", e!.grupos); lista("Subgrupos", e!.subgrupos); lista("Marcas", e!.marcas);
  lista("Tipos", (e!.tipos || []).map((t) => NOME_TIPO[t] || t));
  if (e!.produtos?.length) partes.push(`${e!.produtos.length} produto(s) avulso(s)`);
  return partes.join(" · ");
}
