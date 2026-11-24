// Utilitários do lado do navegador.
export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class ApiErro extends Error { constructor(msg: string, public status: number) { super(msg); } }

// sessão (código e senha do Lieto): token guardado no aparelho e enviado em toda chamada
export const sessao = {
  token: () => { try { return localStorage.getItem("inv.token") || ""; } catch { return ""; } },
  usuario: () => ls.get<{ codfun: number; nome: string; nomfun: string } | null>("usuario", null),
  gravar(token: string, u: unknown) { try { localStorage.setItem("inv.token", token); } catch {} ls.set("usuario", u); window.dispatchEvent(new Event("sessao")); },
  limpar() { try { localStorage.removeItem("inv.token"); } catch {} ls.set("usuario", null); window.dispatchEvent(new Event("sessao")); },
};

export async function api<T = Row>(url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "x-sessao": sessao.token() };
  const r = await fetch("/api/" + url, body !== undefined
    ? { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { cache: "no-store", headers });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== "sessao/entrar") sessao.limpar();
  if (!r.ok) throw new ApiErro(j.erro || `Erro ${r.status}`, r.status);
  return j as T;
}

export const ETAPAS = ["CONTAGEM", "RECONTAGEM", "AUDITORIA", "LANCAMENTO", "ENCERRADO"] as const;
export const NOME_ETAPA: Record<string, string> = {
  PROGRAMADO: "Programado", CONTAGEM: "Contagem", RECONTAGEM: "Recontagem", AUDITORIA: "Auditoria", LANCAMENTO: "Lançamento e parecer", ENCERRADO: "Encerrado",
};
export const NUM_ETAPA: Record<string, number> = { CONTAGEM: 1, RECONTAGEM: 2, AUDITORIA: 3 };

export const fq = (n: unknown) => (n == null || n === "" ? "—" : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 4 }));
export const frs = (n: unknown) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const frsK = (n: number) => Math.abs(n) >= 1e6 ? `R$ ${(n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`
  : Math.abs(n) >= 1e4 ? `R$ ${(n / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : frs(n);
export const fpct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
export const fdata = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}${s.length > 10 ? " " + s.slice(11, 16) : ""}` : "—");
// Fator do código lido (PRODUTOSSIMILARES): 1 leitura = fator unidades do produto
export const fatorLido = (p: Row | null | undefined, codigo: string): number => Number(p?.fatores?.[chave(codigo)]) || 1;
export const nomeFator = (f?: number) => (!f || f === 1 ? "" : f > 1 ? `× ${fq(f)}` : `÷ ${fq(Math.round(1 / f))}`);
export const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
export const chave = (c: string) => String(c || "").trim().toUpperCase().replace(/^0+(?=.)/, "");

// Itens que não geram ajuste: desconsiderados e decisões "manter" / "recontar em outro inventário"
export const semAjuste = (i: Row) => i.situacao === "DESCONSIDERADO" || (i.situacao === "AUDITADO" && (i.decisao === "MANTER" || i.decisao === "RECONTAR"));
export const NOME_DECISAO: Record<string, string> = { ACERTAR: "Acertar", MANTER: "Manter", RECONTAR: "Recontagem" };

// Quantidade "melhor conhecida" de um item em qualquer etapa.
export function calcItem(i: Row) {
  const c1 = i.c1 ?? i.l[1]?.q ?? null, c2 = i.c2 ?? i.l[2]?.q ?? null, c3 = i.l[3]?.q ?? i.c3 ?? null;
  // desconsiderado: fica com o saldo do sistema (sem ajuste)
  const atual: number = semAjuste(i) ? i.saldo : i.final ?? (i.situacao === "AUDITAR" ? c3 ?? c2 : null) ?? c2 ?? c1 ?? 0;
  const dif = r4(atual - i.saldo);
  return { c1, c2, c3, atual, dif, valor: r4(dif * i.precus) };
}

export function indicadores(itens: Row[]) {
  const it: Row[] = itens.map((i) => ({ ...i, ...calcItem(i) }));
  const t = { escopo: 0, comSaldo: 0, contados: 0, faltaContar: 0, vSis: 0, vCont: 0, sobra: 0, falta: 0, certos: 0, recontar: 0, auditar: 0, auditados: 0, comDif: 0, desconsiderados: 0, mantidos: 0, reenviados: 0 };
  for (const i of it) {
    if (i.situacao === "DESCONSIDERADO") { t.desconsiderados++; continue; }
    if (semAjuste(i)) { if (i.decisao === "MANTER") t.mantidos++; else t.reenviados++; t.auditados++; continue; }
    t.escopo++;
    if (i.saldo !== 0) t.comSaldo++;
    if (i.l[1]) t.contados++; else if (i.saldo !== 0) t.faltaContar++;
    t.vSis += i.saldo * i.precus; t.vCont += i.atual * i.precus;
    if (i.valor > 0) t.sobra += i.valor; else t.falta += i.valor;
    if (i.dif === 0) t.certos++; else t.comDif++;
    if (i.situacao === "RECONTAR") t.recontar++;
    if (i.situacao === "AUDITAR") t.auditar++;
    if (i.situacao === "AUDITADO") t.auditados++;
  }
  return { t: { ...t, acur: t.escopo ? (100 * t.certos) / t.escopo : 0, liq: t.sobra + t.falta }, it };
}

export function baixarCsv(nome: string, cab: string[], linhas: unknown[][]) {
  const cel = (v: unknown) => {
    if (v == null) return "";
    if (typeof v === "number") return String(v).replace(".", ",");
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const txt = "﻿" + [cab, ...linhas].map((l) => l.map(cel).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([txt], { type: "text/csv;charset=utf-8" }));
  a.download = nome; a.click();
}

export const ls = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem("inv." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem("inv." + k, JSON.stringify(v)); } catch {} },
};
