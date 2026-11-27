// Rótulos do recebimento compartilhados pela lista e pela página do recebimento (painel)
// situação -> [nome, tom]. Tons do desenho: em andamento azul, conferido verde, com diferença âmbar, encerrado cinza.
export const SITUACAO: Record<string, [string, string]> = {
  CONTANDO: ["Contando", "bg-indigo-50 text-indigo-800 ring-indigo-200"], RECONTANDO: ["Recontando", "bg-indigo-50 text-indigo-800 ring-indigo-200"],
  CONFERIDO: ["Conferido", "bg-emerald-50 text-emerald-800 ring-emerald-200"], DIFERENCA: ["Com diferença", "bg-amber-50 text-amber-800 ring-amber-200"],
  ENCERRADO: ["Encerrado", "bg-slate-100 text-slate-700 ring-slate-200"], CANCELADO: ["Cancelado", "bg-slate-200 text-slate-600 ring-slate-300"],
};
export const selo = (st: string) => `inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap ${SITUACAO[st]?.[1] || "bg-slate-100 text-slate-700 ring-slate-200"}`;
export const MODO: Record<string, string> = { CEGA: "cega", COMQTD: "com quantidade" };
export const FINAIS = ["CONFERIDO", "DIFERENCA", "ENCERRADO"];
// número da nota como o fornecedor imprime: 000011209 -> 11.209
export const nf = (s?: string) => (s && /^\d+$/.test(s) ? Number(s).toLocaleString("pt-BR") : s || "");
export const dm = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : "");
export const dmh = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}` : "—");
