"use client";
// Montar a lista do inventário: filtros que se somam, tabela ordenável, tirar itens e dividir em partes.
// O resultado é uma lista FIXA de produtos por parte; os filtros vão junto para reabrir a tela como estava.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, LoaderCircle, Search, X } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { NOME_TIPO } from "@/lib/escopo";
import { fq, frs, frsK, type Row } from "@/lib/client";

// linha da prévia: [codpro, nompro, unipro, grupo, subgrupo, marca, tipo, saldo, precus, codbar, local]
export type LinhaPrevia = [string, string, string, string, string, string, string, number, number, string, string?];
export type ProdPrevia = { codpro: string; nompro: string; unipro: string; grupo: string; subgrupo: string; marca: string; tipo: string; saldo: number; precus: number; codbar: string; local: string };
export const deLinha = (l: LinhaPrevia): ProdPrevia => ({ codpro: l[0], nompro: l[1], unipro: l[2], grupo: l[3], subgrupo: l[4], marca: l[5], tipo: l[6], saldo: l[7], precus: l[8], codbar: l[9], local: l[10] || "" });

export function resumoLista(prods: ProdPrevia[]) {
  let comSaldo = 0, valor = 0;
  for (const p of prods) { if (p.saldo !== 0) comSaldo++; valor += p.saldo * p.precus; }
  return { itens: prods.length, comSaldo, valor };
}

type Col = "codpro" | "nompro" | "unipro" | "local" | "marca" | "subgrupo" | "saldo" | "precus" | "valor";
type Corte = "local" | "ordem" | "subgrupo" | "valor";
export type Filtros = {
  sub: string[]; grp: string[]; marca: string[]; tipo: string[]; rua: string[]; sMin: string; sMax: string; vMin: string; vMax: string; semSaldo: "incluir" | "tirar" | "so";
  fora: string[]; extra: string[]; ordem: { col: Col; dir: 1 | -1 }; dividir: { ligado: boolean; n: string; como: "partes" | "itens"; corte: Corte; datas: "util" | "mesmo" | "cada" };
};
export const FILTROS_VAZIOS: Filtros = { sub: [], grp: [], marca: [], tipo: [], rua: [], sMin: "", sMax: "", vMin: "", vMax: "", semSaldo: "incluir", fora: [], extra: [], ordem: { col: "local", dir: 1 }, dividir: { ligado: false, n: "4", como: "partes", corte: "local", datas: "util" } };
export type ParteSel = { produtos: string[]; dataPrevista: string; responsavel: string };
export type Selecao = { rotulo: string; filtros: Filtros; produtos: string[]; partes: ParteSel[] };

const rua = (l: string) => (l.split("-")[0] || "").trim() || "Sem local";
const valorDe = (p: ProdPrevia) => p.saldo * p.precus;
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
const cmpLocal = (a: ProdPrevia, b: ProdPrevia) => Number(!a.local) - Number(!b.local) || a.local.localeCompare(b.local, "pt-BR", { numeric: true }) || a.nompro.localeCompare(b.nompro);
function ordenar(l: ProdPrevia[], o: Filtros["ordem"]) {
  const k = o.col, d = o.dir;
  if (k === "local") return [...l].sort((a, b) => d * cmpLocal(a, b));
  return [...l].sort((a, b) => { const x = k === "valor" ? valorDe(a) : a[k], y = k === "valor" ? valorDe(b) : b[k]; return d * (typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y), "pt-BR", { numeric: true })) || a.nompro.localeCompare(b.nompro); });
}
// Divide em partes do mesmo tamanho na ordem escolhida; "valor" distribui para cada parte ter valor parecido.
function dividir(l: ProdPrevia[], ordemTabela: ProdPrevia[], f: Filtros["dividir"]): ProdPrevia[][] {
  const v = Math.max(1, Math.floor(Number(f.n) || 1)), n = Math.min(50, Math.max(1, f.como === "partes" ? v : Math.ceil(l.length / v)));
  if (n === 1) return [l];
  if (f.corte === "valor") {
    const partes = Array.from({ length: n }, () => ({ l: [] as ProdPrevia[], v: 0 }));
    const cap = Math.ceil(l.length / n);
    for (const p of [...l].sort((a, b) => Math.abs(valorDe(b)) - Math.abs(valorDe(a)))) { const alvo = partes.filter((x) => x.l.length < cap).sort((a, b) => a.v - b.v)[0]; alvo.l.push(p); alvo.v += Math.abs(valorDe(p)); }
    return partes.map((x) => x.l.sort(cmpLocal)).filter((x) => x.length);
  }
  const seq = f.corte === "ordem" ? ordemTabela : f.corte === "subgrupo" ? [...l].sort((a, b) => a.subgrupo.localeCompare(b.subgrupo) || cmpLocal(a, b)) : [...l].sort(cmpLocal);
  const out: ProdPrevia[][] = [], base = Math.floor(seq.length / n), sobra = seq.length % n; let i = 0;
  for (let k = 0; k < n; k++) { const t = base + (k < sobra ? 1 : 0); if (t) out.push(seq.slice(i, i + t)); i += t; }
  return out;
}
const diaUtil = (iso: string, k: number) => { const [a, m, d] = iso.split("-").map(Number); const x = new Date(a, m - 1, d); let n = 0; while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() + 1); while (n < k) { x.setDate(x.getDate() + 1); if (x.getDay() !== 0 && x.getDay() !== 6) n++; } return x.toLocaleDateString("sv-SE"); };
const faixa = (l: ProdPrevia[]) => { const c = l.filter((p) => p.local).map((p) => p.local).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })); const sem = l.length - c.length; return c.length ? `Local ${c[0]} a ${c[c.length - 1]}${sem ? ` + ${sem} sem local` : ""}` : "Sem local"; };
const CORES = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#dc2626", "#4d7c0f", "#c026d3"];

export function MontarLista({ aberto, fechar, prods, erro, inicial, programar, dataBase, usuarios, aplicar }:
  { aberto: boolean; fechar: () => void; prods: ProdPrevia[] | null; erro: string; inicial: Selecao | null; programar: boolean; dataBase: string; usuarios: Row[]; aplicar: (s: Selecao | null) => void }) {
  const [f, setF] = useState<Filtros>(inicial?.filtros || FILTROS_VAZIOS), [marc, setMarc] = useState<Set<string>>(new Set()), [buscas, setBuscas] = useState<Record<string, string>>({});
  const [datas, setDatas] = useState<Record<number, string>>({}), [resp, setResp] = useState<Record<number, string>>({}), [add, setAdd] = useState(""), ultimo = useRef(-1);
  useEffect(() => { if (aberto) { setF(inicial?.filtros || FILTROS_VAZIOS); setMarc(new Set()); setDatas(Object.fromEntries((inicial?.partes || []).map((p, k) => [k, p.dataPrevista]))); setResp(Object.fromEntries((inicial?.partes || []).map((p, k) => [k, p.responsavel]))); } }, [aberto, inicial]);
  useEffect(() => { if (!aberto) return; const k = (e: KeyboardEvent) => e.key === "Escape" && fechar(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [aberto, fechar]);
  const muda = (x: Partial<Filtros>) => setF((y) => ({ ...y, ...x }));

  const facetas = useMemo(() => {
    const m: Record<string, Map<string, number>> = { sub: new Map(), grp: new Map(), marca: new Map(), tipo: new Map(), rua: new Map() };
    for (const p of prods || []) for (const [k, v] of [["sub", p.subgrupo], ["grp", p.grupo], ["marca", p.marca], ["tipo", p.tipo], ["rua", rua(p.local)]] as const) if (v) m[k].set(v, (m[k].get(v) || 0) + 1);
    return Object.fromEntries(Object.entries(m).map(([k, x]) => [k, [...x.entries()].sort((a, b) => (a[0] === "Sem local" ? 1 : b[0] === "Sem local" ? -1 : a[0].localeCompare(b[0], "pt-BR", { numeric: true })))])) as Record<string, [string, number][]>;
  }, [prods]);
  // passa nos filtros (blocos se somam); "fora" fica na tabela riscado; "extra" entra sempre
  const { passa, lista } = useMemo(() => {
    const ex = new Set(f.extra), fo = new Set(f.fora), sMin = num(f.sMin), sMax = num(f.sMax), vMin = num(f.vMin), vMax = num(f.vMax);
    const s = { sub: new Set(f.sub), grp: new Set(f.grp), marca: new Set(f.marca), tipo: new Set(f.tipo), rua: new Set(f.rua) };
    const ok = (p: ProdPrevia) => ex.has(p.codpro) || ((!s.sub.size || s.sub.has(p.subgrupo)) && (!s.grp.size || s.grp.has(p.grupo)) && (!s.marca.size || s.marca.has(p.marca)) && (!s.tipo.size || s.tipo.has(p.tipo)) && (!s.rua.size || s.rua.has(rua(p.local)))
      && (sMin == null || p.saldo >= sMin) && (sMax == null || p.saldo <= sMax) && (vMin == null || valorDe(p) >= vMin) && (vMax == null || valorDe(p) <= vMax) && (f.semSaldo === "incluir" || (f.semSaldo === "tirar" ? p.saldo !== 0 : p.saldo === 0)));
    const passa = ordenar((prods || []).filter(ok), f.ordem);
    return { passa, lista: passa.filter((p) => !fo.has(p.codpro)) };
  }, [prods, f]);
  const partes = useMemo(() => (f.dividir.ligado && lista.length ? dividir(lista, lista, f.dividir) : [lista]), [lista, f.dividir]);
  const corDe = useMemo(() => { const m = new Map<string, number>(); if (partes.length > 1) partes.forEach((pt, k) => pt.forEach((p) => m.set(p.codpro, k))); return m; }, [partes]);
  const dataParte = (k: number) => (f.dividir.datas === "cada" ? datas[k] || dataBase : f.dividir.datas === "mesmo" ? dataBase : diaUtil(dataBase, k));
  const r = resumoLista(lista), fora = new Set(f.fora), filtrado = f.sub.length + f.grp.length + f.marca.length + f.tipo.length + f.rua.length > 0 || !!(f.sMin || f.sMax || f.vMin || f.vMax) || f.semSaldo !== "incluir" || f.extra.length > 0;
  const LIM = 800, vis = passa.slice(0, LIM);

  function clicar(p: ProdPrevia, k: number, shift: boolean) {
    setMarc((m) => { const n = new Set(m), liga = !m.has(p.codpro); if (shift && ultimo.current >= 0) { const [a, b] = [Math.min(ultimo.current, k), Math.max(ultimo.current, k)]; for (const x of vis.slice(a, b + 1)) liga ? n.add(x.codpro) : n.delete(x.codpro); } else liga ? n.add(p.codpro) : n.delete(p.codpro); return n; });
    ultimo.current = k;
  }
  const ordem = (col: Col) => muda({ ordem: { col, dir: f.ordem.col === col ? (-f.ordem.dir as 1 | -1) : 1 } });
  const rotulo = () => {
    const p: string[] = [];
    const l = (v: string[], n: string) => v.length && p.push(v.length > 2 ? `${n}: ${v.slice(0, 2).join(", ")} +${v.length - 2}` : v.join(", "));
    l(f.sub, "Subgrupos"); l(f.grp, "Grupos"); l(f.marca, "Marcas"); l(f.rua, "Locais"); l(f.tipo.map((t) => NOME_TIPO[t] || t), "Tipos");
    if (f.sMin || f.sMax) p.push(`saldo ${f.sMin || "…"} a ${f.sMax || "…"}`); if (f.semSaldo === "tirar") p.push("com saldo"); if (f.semSaldo === "so") p.push("sem saldo");
    return (p.join(" · ") || "Lista montada").slice(0, 120);
  };
  function usar() {
    aplicar({ rotulo: rotulo(), filtros: f, produtos: lista.map((p) => p.codpro), partes: partes.map((pt, k) => ({ produtos: pt.map((p) => p.codpro), dataPrevista: dataParte(k), responsavel: resp[k] || "" })) });
    fechar();
  }
  const achados = add.trim().length > 1 && prods ? prods.filter((p) => { const b = add.trim().toUpperCase(); return p.codpro.toUpperCase() === b || p.codbar === b || p.nompro.toUpperCase().includes(b); }).slice(0, 8) : [];

  if (!aberto) return null;
  // funções (não componentes): a busca do filtro não perde o foco a cada letra
  const faceta = (k: "sub" | "grp" | "marca" | "tipo" | "rua", nome: string, campo: string) => {
    const ops = facetas[k] || [], b = (buscas[k] || "").toUpperCase(), sel = f[k];
    if (ops.length < (k === "tipo" ? 2 : 1)) return null;
    const ver = ops.filter(([v]) => !b || v.toUpperCase().includes(b) || (k === "tipo" && (NOME_TIPO[v] || "").toUpperCase().includes(b)));
    return (
      <div key={k} className="mb-3">
        <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted"><span>{nome}{sel.length > 0 && <span className="ml-1 rounded-full bg-brand-700 px-1.5 text-white">{sel.length}</span>}</span>{sel.length > 0 && <button className="normal-case text-brand-700" onClick={() => muda({ [k]: [] } as Partial<Filtros>)}>limpar</button>}</div>
        {ops.length > 8 && <input className="mb-1 h-8 w-full rounded-md border border-line px-2 text-[13px]" placeholder={`Filtrar ${campo}`} value={buscas[k] || ""} onChange={(e) => setBuscas({ ...buscas, [k]: e.target.value })} />}
        <div className="max-h-48 overflow-y-auto">{ver.map(([v, n]) => (
          <label key={v} className={cx("flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-slate-50", sel.includes(v) && "bg-brand-50 font-semibold")}>
            <input type="checkbox" className="accent-brand-700" checked={sel.includes(v)} onChange={() => muda({ [k]: sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v] } as Partial<Filtros>)} />
            <span className="flex-1">{k === "tipo" ? NOME_TIPO[v] || v : v}</span><span className="text-[12px] font-normal text-muted tabular">{n}</span></label>))}</div>
      </div>
    );
  };
  const th = (c: Col, n: string, dir?: boolean) => <th key={c} onClick={() => ordem(c)} className={cx("sticky top-0 cursor-pointer select-none whitespace-nowrap border-b border-line bg-slate-50 px-2 py-2 font-semibold text-muted", dir && "text-right")}>{n}{f.ordem.col === c && <span className="text-brand-700"> {f.ordem.dir === 1 ? "▲" : "▼"}</span>}</th>;
  const nMarc = marc.size, marcFora = [...marc].some((c) => fora.has(c));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/40 backdrop-blur-[2px] sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && fechar()}>
      <div className="anim-entra flex w-full max-w-[1400px] flex-col overflow-hidden bg-white shadow-2xl ring-1 ring-black/5 sm:rounded-2xl">
        <div className="flex items-start gap-4 border-b border-line px-6 py-4">
          <div className="flex-1"><h2 className="text-[17px] font-semibold tracking-tight">Montar lista de itens</h2><p className="mt-0.5 text-sm text-muted">Filtre, ordene, tire o que não quer e, se for grande, divida em partes. Cada parte vira um inventário.</p></div>
          <button onClick={fechar} className="rounded-lg p-1.5 text-muted hover:bg-slate-100" aria-label="Fechar"><X className="size-5" /></button>
        </div>
        {!prods ? <div className="grid flex-1 place-items-center p-10 text-sm text-muted">{erro ? <span className="text-rose-700">{erro}</span> : <span className="inline-flex items-center gap-2"><LoaderCircle className="size-5 animate-spin" />Lendo produtos e saldos…</span>}</div> : (
          <div className="grid min-h-0 flex-1 lg:grid-cols-[260px_1fr_330px]">
            {/* filtros: blocos se somam; dentro do bloco, qualquer marcado */}
            <div className="scroll-fino min-h-0 overflow-y-auto border-line p-4 lg:border-r">
              {faceta("sub", "Subgrupo", "subgrupos")}{faceta("grp", "Grupo", "grupos")}{faceta("marca", "Marca", "marcas")}{faceta("rua", "Local", "locais")}{faceta("tipo", "Tipo", "tipos")}
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Saldo</div>
              <div className="mb-3 grid grid-cols-2 gap-1.5"><input className="h-8 rounded-md border border-line px-2 text-[13px]" inputMode="decimal" placeholder="mínimo" value={f.sMin} onChange={(e) => muda({ sMin: e.target.value })} /><input className="h-8 rounded-md border border-line px-2 text-[13px]" inputMode="decimal" placeholder="máximo" value={f.sMax} onChange={(e) => muda({ sMax: e.target.value })} /></div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Valor em estoque (R$)</div>
              <div className="mb-3 grid grid-cols-2 gap-1.5"><input className="h-8 rounded-md border border-line px-2 text-[13px]" inputMode="decimal" placeholder="mínimo" value={f.vMin} onChange={(e) => muda({ vMin: e.target.value })} /><input className="h-8 rounded-md border border-line px-2 text-[13px]" inputMode="decimal" placeholder="máximo" value={f.vMax} onChange={(e) => muda({ vMax: e.target.value })} /></div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Itens sem saldo</div>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">{([["incluir", "Incluir"], ["tirar", "Tirar"], ["so", "Só eles"]] as const).map(([k, n]) => <button key={k} onClick={() => muda({ semSaldo: k })} className={cx("h-7 rounded-md text-[12px]", f.semSaldo === k ? "bg-white font-semibold shadow-sm" : "text-muted")}>{n}</button>)}</div>
              {filtrado && <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => { setF({ ...FILTROS_VAZIOS, ordem: f.ordem, dividir: f.dividir }); setMarc(new Set()); }}>Limpar filtros</Button>}
            </div>

            {/* tabela */}
            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
                <b className="text-[14px] tabular">{lista.length.toLocaleString("pt-BR")} itens</b>
                <span className="text-[13px] text-muted">{f.fora.length > 0 && `${f.fora.length} tirados · `}{f.extra.length > 0 && `${f.extra.length} incluídos à mão · `}{passa.length > LIM && `mostrando ${LIM} de ${passa.length.toLocaleString("pt-BR")}`}</span>
                <span className="flex-1" />
                <div className="relative"><Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted" /><input className="h-8 w-56 rounded-md border border-line pl-7 pr-2 text-[13px]" placeholder="Incluir produto (código ou nome)" value={add} onChange={(e) => setAdd(e.target.value)} />
                  {achados.length > 0 && <div className="absolute right-0 top-9 z-10 w-96 rounded-lg bg-white shadow-xl ring-1 ring-line">{achados.map((p) => <button key={p.codpro} className="flex w-full gap-2 px-3 py-2 text-left text-[13px] hover:bg-slate-50" onClick={() => { muda({ extra: [...new Set([...f.extra, p.codpro])], fora: f.fora.filter((x) => x !== p.codpro) }); setAdd(""); }}><span className="w-16 shrink-0 tabular text-muted">{p.codpro}</span><span className="flex-1">{p.nompro}</span></button>)}</div>}</div>
                <Button size="sm" variant="secondary" onClick={() => setMarc(new Set(vis.map((p) => p.codpro)))}>Marcar visíveis</Button>
                <Button size="sm" variant="secondary" disabled={!nMarc} onClick={() => { muda(marcFora ? { fora: f.fora.filter((x) => !marc.has(x)) } : { fora: [...new Set([...f.fora, ...marc])], extra: f.extra.filter((x) => !marc.has(x)) }); setMarc(new Set()); }}>{marcFora ? `Devolver marcados (${nMarc})` : `Tirar marcados (${nMarc})`}</Button>
                <Button size="sm" variant="secondary" disabled={!nMarc} onClick={() => { muda({ fora: [...new Set([...f.fora, ...passa.filter((p) => !marc.has(p.codpro)).map((p) => p.codpro)])] }); setMarc(new Set()); }}>Só os marcados</Button>
              </div>
              <div className="scroll-fino min-h-0 flex-1 overflow-auto">
                {!passa.length ? <p className="p-10 text-center text-sm text-muted">Nenhum item com esses filtros. Afrouxe um filtro.</p> : (
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead className="text-left"><tr><th className="sticky top-0 w-8 border-b border-line bg-slate-50 px-2"><input type="checkbox" className="accent-brand-700" checked={nMarc > 0 && nMarc >= vis.length} onChange={(e) => setMarc(e.target.checked ? new Set(vis.map((p) => p.codpro)) : new Set())} /></th>
                      {th("codpro", "Código")}{th("nompro", "Produto")}{th("unipro", "Un")}{th("local", "Local")}{th("marca", "Marca")}{th("subgrupo", "Subgrupo")}{th("saldo", "Saldo", true)}{th("precus", "Custo", true)}{th("valor", "Valor", true)}</tr></thead>
                    <tbody className="tabular">{vis.map((p, k) => { const fo = fora.has(p.codpro), cor = corDe.get(p.codpro); return (
                      <tr key={p.codpro} onClick={(e) => clicar(p, k, e.shiftKey)} className={cx("cursor-pointer border-b border-slate-100", marc.has(p.codpro) ? "bg-brand-50" : "hover:bg-slate-50", fo && "text-slate-400 line-through")}>
                        <td className="px-2 py-1.5" style={cor != null && !fo ? { boxShadow: `inset 4px 0 0 ${CORES[cor % CORES.length]}` } : undefined}><input type="checkbox" className="accent-brand-700" readOnly checked={marc.has(p.codpro)} /></td>
                        <td className="px-2 py-1.5">{p.codpro}</td><td className="px-2 py-1.5">{p.nompro}</td><td className="px-2 py-1.5">{p.unipro}</td><td className="whitespace-nowrap px-2 py-1.5">{p.local || "—"}</td><td className="px-2 py-1.5">{p.marca}</td><td className="px-2 py-1.5">{p.subgrupo}</td>
                        <td className={cx("px-2 py-1.5 text-right", p.saldo === 0 && "text-muted")}>{fq(p.saldo)}</td><td className="px-2 py-1.5 text-right">{frs(p.precus)}</td><td className="px-2 py-1.5 text-right">{frs(valorDe(p))}</td></tr>); })}</tbody>
                  </table>)}
              </div>
            </div>

            {/* resumo e divisão */}
            <div className="flex min-h-0 flex-col border-line bg-slate-50/70 lg:border-l">
              <div className="grid grid-cols-3 gap-px border-b border-line bg-line">{[["Itens", r.itens.toLocaleString("pt-BR")], ["Com saldo", r.comSaldo.toLocaleString("pt-BR")], ["Valor", frsK(r.valor)]].map(([l, v]) => <div key={l} className="bg-white px-3 py-2.5"><div className="text-[11px] text-muted">{l}</div><div className="text-[15px] font-semibold tabular">{v}</div></div>)}</div>
              <div className="scroll-fino min-h-0 flex-1 overflow-y-auto p-4 text-[13px]">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Como contar</div>
                {([[false, "Uma lista só", `Um inventário com os ${lista.length} itens`], [true, "Dividir em partes", "Vários inventários menores"]] as const).map(([v, n, d]) => (
                  <label key={n} className={cx("mb-1 flex cursor-pointer items-start gap-2 rounded-lg p-2", f.dividir.ligado === v && "bg-white ring-1 ring-line")}><input type="radio" className="mt-1 accent-brand-700" checked={f.dividir.ligado === v} onChange={() => muda({ dividir: { ...f.dividir, ligado: v } })} /><span><b>{n}</b><span className="block text-[12px] text-muted">{d}</span></span></label>))}
                {f.dividir.ligado && <>
                  <div className="mt-3 flex items-center gap-1.5"><select className="h-8 rounded-md border border-line px-1" value={f.dividir.como} onChange={(e) => muda({ dividir: { ...f.dividir, como: e.target.value as "partes" | "itens" } })}><option value="partes">Em</option><option value="itens">Até</option></select>
                    <input className="h-8 w-16 rounded-md border border-line px-2 text-right" inputMode="numeric" value={f.dividir.n} onChange={(e) => muda({ dividir: { ...f.dividir, n: e.target.value.replace(/\D/g, "") } })} /><span>{f.dividir.como === "partes" ? "partes" : "itens por parte"}</span></div>
                  <div className="mt-2 flex items-center gap-1.5">Cortar por <select className="h-8 flex-1 rounded-md border border-line px-1" value={f.dividir.corte} onChange={(e) => muda({ dividir: { ...f.dividir, corte: e.target.value as Corte } })}><option value="local">Local (corredor)</option><option value="ordem">Ordem da tabela</option><option value="subgrupo">Subgrupo</option><option value="valor">Equilibrar valor</option></select></div>
                  {programar && <div className="mt-2 flex items-center gap-1.5">Datas <select className="h-8 flex-1 rounded-md border border-line px-1" value={f.dividir.datas} onChange={(e) => muda({ dividir: { ...f.dividir, datas: e.target.value as Filtros["dividir"]["datas"] } })}><option value="util">Uma por dia útil a partir da data prevista</option><option value="mesmo">Todas na data prevista</option><option value="cada">Cada uma na sua data</option></select></div>}
                  <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Partes</div>
                  {partes.map((pt, k) => { const rr = resumoLista(pt); return (
                    <div key={k} className="mb-2 rounded-lg border border-line bg-white p-2.5" style={{ borderLeft: `4px solid ${CORES[k % CORES.length]}` }}>
                      <b>Parte {k + 1} · {pt.length} itens</b><span className="block text-[12px] text-muted">{f.dividir.corte === "subgrupo" ? [...new Set(pt.map((p) => p.subgrupo))].slice(0, 3).join(", ") : faixa(pt)} · {frsK(rr.valor)}</span>
                      {programar && <div className="mt-1.5 flex gap-1.5"><input type="date" disabled={f.dividir.datas !== "cada"} className="h-8 rounded-md border border-line px-1 text-[12px] disabled:bg-slate-50" value={dataParte(k)} onChange={(e) => setDatas({ ...datas, [k]: e.target.value })} />
                        <select className="h-8 min-w-0 flex-1 rounded-md border border-line px-1 text-[12px]" value={resp[k] || ""} onChange={(e) => setResp({ ...resp, [k]: e.target.value })}><option value="">Responsável</option>{usuarios.map((u) => <option key={u.codfun} value={u.nome}>{u.nome}</option>)}</select></div>}
                    </div>); })}
                </>}
              </div>
              <div className="flex gap-2 border-t border-line bg-white p-3">
                <Button variant="secondary" onClick={() => { aplicar(null); fechar(); }}>Descartar</Button>
                <Button className="flex-1" disabled={!lista.length} onClick={usar}><Check className="size-4" />{partes.length > 1 ? `Usar ${partes.length} partes` : `Usar lista (${lista.length.toLocaleString("pt-BR")})`}</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
