// Utilitários do servidor compartilhados pelos módulos.
import { ctx } from "./auditoria";
import { db } from "./db";

export class Erro extends Error { constructor(msg: string, public status = 400) { super(msg); } }

const pad = (n: number) => String(n).padStart(2, "0");
export const agora = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
export const r4 = (x: unknown) => Math.round((Number(x) || 0) * 1e4) / 1e4;
export const r6 = (x: unknown) => Math.round((Number(x) || 0) * 1e6) / 1e6;
export const chave = (c: unknown) => String(c ?? "").trim().toUpperCase().replace(/^0+(?=.)/, "");

// Observação do operador: o texto completo fica aqui; para o Lieto vai em maiúsculas, só com caracteres WIN1252 e no tamanho do campo.
export const limparObs = (v: unknown) => String(v ?? "").trim().slice(0, 500);
export const obsErp = (v: unknown, n: number) => limparObs(v).toUpperCase().replace(/\s+/g, " ").replace(/[^\x20-\x7e\xa0-\xff]/g, "").trim().slice(0, Math.max(0, n)).trim();
// texto padrão do Lieto sempre no começo (relatórios dependem dele), observação no espaço que sobrar
export const juntar = (base: string, obs: unknown, n: number) => { const o = obsErp(obs, n - base.length - 3); return (o ? `${base} - ${o}` : base).slice(0, n); };

export type Usuario = { codfun: number; nome: string; nomfun: string };

// Trilha de auditoria geral (quem fez o quê, em qual módulo)
export function evento(modulo: string, ref: string | number, u: Usuario | null, acao: string, detalhe: unknown = "") {
  db().prepare("INSERT INTO eventos (em, modulo, ref, codfun, usuario, acao, detalhe, trace) VALUES (?,?,?,?,?,?,?,?)")
    .run(agora(), modulo, String(ref), u?.codfun ?? null, u?.nome ?? "SISTEMA", acao, typeof detalhe === "string" ? detalhe : JSON.stringify(detalhe), ctx().trace || null);
}
