"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Boxes, Check, LoaderCircle, Search, Tag, Layers, FolderTree, Package, Shapes, X } from "lucide-react";
import { Button, cx, inputCls } from "@/components/ui";
import { ESCOPO_VAZIO, NOME_TIPO, escopoAtivo, filtrarEscopo, type Escopo } from "@/lib/escopo";
import { fq, frsK } from "@/lib/client";

// linha da prévia: [codpro, nompro, unipro, grupo, subgrupo, marca, tipo, saldo, precus, codbar]
export type LinhaPrevia = [string, string, string, string, string, string, string, number, number, string];
export type ProdPrevia = { codpro: string; nompro: string; unipro: string; grupo: string; subgrupo: string; marca: string; tipo: string; saldo: number; precus: number; codbar: string };
export const deLinha = (l: LinhaPrevia): ProdPrevia => ({ codpro: l[0], nompro: l[1], unipro: l[2], grupo: l[3], subgrupo: l[4], marca: l[5], tipo: l[6], saldo: l[7], precus: l[8], codbar: l[9] });

type Aba = "grupos" | "subgrupos" | "marcas" | "tipos" | "produtos";
const ABAS: { k: Aba; n: string; campo?: keyof ProdPrevia; i: typeof Boxes }[] = [
  { k: "grupos", n: "Grupo", campo: "grupo", i: FolderTree }, { k: "subgrupos", n: "Subgrupo", campo: "subgrupo", i: Layers },
  { k: "marcas", n: "Marca", campo: "marca", i: Tag }, { k: "tipos", n: "Tipo", campo: "tipo", i: Shapes }, { k: "produtos", n: "Produtos", i: Package },
];

export function resumoLista(prods: ProdPrevia[]) {
  let comSaldo = 0, valor = 0;
  for (const p of prods) { if (p.saldo !== 0) comSaldo++; valor += p.saldo * p.precus; }
  return { itens: prods.length, comSaldo, valor };
}

export function MontarLista({ aberto, fechar, prods, erro, escopo, aplicar }:
  { aberto: boolean; fechar: () => void; prods: ProdPrevia[] | null; erro: string; escopo: Escopo; aplicar: (e: Escopo) => void }) {
  const [sel, setSel] = useState<Escopo>(escopo);
  const [aba, setAba] = useState<Aba>("grupos");
  const [busca, setBusca] = useState("");
  useEffect(() => { if (aberto) { setSel(escopo); setBusca(""); } }, [aberto, escopo]);
  useEffect(() => {
    if (!aberto) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [aberto, fechar]);

  // opções de cada aba com contagem e valor
  const opcoes = useMemo(() => {
    const r = {} as Record<Aba, { v: string; n: number; comSaldo: number; valor: number }[]>;
    for (const a of ABAS) {
      if (!a.campo || !prods) continue;
      const m = new Map<string, { v: string; n: number; comSaldo: number; valor: number }>();
      for (const p of prods) {
        const v = String(p[a.campo] || ""); if (!v) continue;
        const o = m.get(v) || { v, n: 0, comSaldo: 0, valor: 0 };
        o.n++; if (p.saldo !== 0) o.comSaldo++; o.valor += p.saldo * p.precus; m.set(v, o);
      }
      r[a.k] = [...m.values()].sort((x, y) => x.v.localeCompare(y.v));
    }
    return r;
  }, [prods]);
  // abas sem dados nesta base somem (ex.: marca não cadastrada, tipo único)
  const abas = ABAS.filter((a) => a.k === "produtos" || (opcoes[a.k]?.length ?? 0) > (a.k === "tipos" ? 1 : 0));

  const lista = useMemo(() => (prods ? filtrarEscopo(prods, sel) : []), [prods, sel]);
  const r = resumoLista(escopoAtivo(sel) ? lista : []);
  const b = busca.trim().toUpperCase();
  const alternar = (k: Aba, v: string) => setSel((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));

  if (!aberto) return null;
  const opcoesVis = aba !== "produtos" ? (opcoes[aba] || []).filter((o) => !b || o.v.toUpperCase().includes(b) || (aba === "tipos" && (NOME_TIPO[o.v] || "").toUpperCase().includes(b))) : [];
  const prodsVis = aba === "produtos" && prods
    ? (b ? prods.filter((p) => p.codpro.toUpperCase() === b || p.nompro.toUpperCase().includes(b) || p.codbar.includes(b)) : prods.filter((p) => sel.produtos.includes(p.codpro))).slice(0, 150)
    : [];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/40 p-0 backdrop-blur-[2px] sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && fechar()}>
      <div className="anim-entra flex w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl ring-1 ring-black/5 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">Montar lista de itens</h2>
            <p className="mt-1 text-sm text-muted">Marque grupos, subgrupos, marcas, tipos ou produtos. Entra na lista todo item que atender a <b className="text-ink">qualquer</b> critério marcado.</p>
          </div>
          <button onClick={fechar} className="-mr-2 rounded-lg p-1.5 text-muted hover:bg-slate-100"><X className="size-5" /></button>
        </div>

        {!prods ? (
          <div className="grid flex-1 place-items-center p-10 text-sm text-muted">
            {erro ? <span className="text-rose-700">{erro}</span> : <span className="inline-flex items-center gap-2"><LoaderCircle className="size-5 animate-spin" />Lendo produtos e saldos…</span>}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_360px]">
            {/* seleção */}
            <div className="flex min-h-0 flex-col border-line lg:border-r">
              <div className="scroll-fino flex gap-1 overflow-x-auto border-b border-line px-4 pt-2">
                {abas.map(({ k, n, i: Ic }) => (
                  <button key={k} onClick={() => { setAba(k); setBusca(""); }} className={cx("relative inline-flex h-10 items-center gap-2 px-3 text-[13px] font-medium",
                    aba === k ? "text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-600" : "text-muted hover:text-ink")}>
                    <Ic className="size-4" />{n}{sel[k].length > 0 && <span className="rounded-full bg-brand-700 px-1.5 text-[11px] font-semibold text-white">{sel[k].length}</span>}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 px-4 py-3">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
                  <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} className={cx(inputCls, "pl-9")}
                    placeholder={aba === "produtos" ? "Buscar produto por nome, código ou código de barras" : `Filtrar ${ABAS.find((a) => a.k === aba)!.n.toLowerCase()}s`} />
                </div>
                {aba !== "produtos" && <Button variant="ghost" size="sm" onClick={() => setSel((s) => ({ ...s, [aba]: [...new Set([...s[aba], ...opcoesVis.map((o) => o.v)])] }))}>Marcar visíveis</Button>}
                {sel[aba].length > 0 && <Button variant="ghost" size="sm" onClick={() => setSel((s) => ({ ...s, [aba]: [] }))}>Limpar</Button>}
              </div>
              <div className="scroll-fino min-h-[280px] flex-1 overflow-y-auto px-2 pb-3">
                {aba !== "produtos" ? opcoesVis.map((o) => (
                  <Opcao key={o.v} marcado={sel[aba].includes(o.v)} onClick={() => alternar(aba, o.v)}
                    titulo={aba === "tipos" ? `${NOME_TIPO[o.v] || o.v} (${o.v})` : o.v}
                    detalhe={`${o.n.toLocaleString("pt-BR")} itens · ${o.comSaldo.toLocaleString("pt-BR")} com saldo`} valor={frsK(o.valor)} />
                )) : prodsVis.length ? prodsVis.map((p) => (
                  <Opcao key={p.codpro} marcado={sel.produtos.includes(p.codpro)} onClick={() => alternar("produtos", p.codpro)}
                    titulo={p.nompro} detalhe={`${p.codpro} · ${p.unipro} · ${p.grupo}`} valor={`${fq(p.saldo)} ${p.unipro}`} />
                )) : (
                  <p className="px-3 py-10 text-center text-sm text-muted">{b ? "Nenhum produto encontrado." : "Busque pelo nome, código ou código de barras para adicionar produtos avulsos."}</p>
                )}
              </div>
            </div>

            {/* resumo */}
            <div className="flex min-h-0 flex-col bg-slate-50/70">
              <div className="grid grid-cols-3 gap-px border-b border-line bg-line">
                {[["Itens", r.itens.toLocaleString("pt-BR")], ["Com saldo", r.comSaldo.toLocaleString("pt-BR")], ["Valor", frsK(r.valor)]].map(([l, v]) => (
                  <div key={l} className="bg-white px-3 py-3"><div className="text-[11px] font-medium text-muted">{l}</div><div className="whitespace-nowrap text-[15px] font-semibold tabular">{v}</div></div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 border-b border-line p-3">
                {!escopoAtivo(sel) && <span className="text-[13px] text-muted">Nenhum critério marcado.</span>}
                {(["grupos", "subgrupos", "marcas", "tipos"] as Aba[]).flatMap((k) => sel[k].map((v) => (
                  <Chip key={k + v} onRemove={() => alternar(k, v)}>{k === "tipos" ? NOME_TIPO[v] || v : v}</Chip>
                )))}
                {sel.produtos.length > 0 && <Chip onRemove={() => setSel((s) => ({ ...s, produtos: [] }))}>{sel.produtos.length} produto(s) avulso(s)</Chip>}
              </div>
              <ul className="scroll-fino min-h-0 flex-1 divide-y divide-line overflow-y-auto">
                {lista.length && escopoAtivo(sel) ? lista.slice(0, 300).map((p) => (
                  <li key={p.codpro} className="flex items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{p.nompro}</div><div className="truncate text-[11px] text-muted">{p.codpro} · {p.grupo}</div></div>
                    <div className={cx("text-right text-[12px] tabular", p.saldo === 0 && "text-muted")}>{fq(p.saldo)} {p.unipro}</div>
                  </li>
                )) : <li className="px-4 py-10 text-center text-sm text-muted">A prévia da lista aparece aqui.</li>}
                {lista.length > 300 && escopoAtivo(sel) && <li className="px-4 py-2 text-center text-[12px] text-muted">… e mais {(lista.length - 300).toLocaleString("pt-BR")} itens</li>}
              </ul>
              <div className="flex gap-2 border-t border-line bg-white p-4">
                <Button variant="secondary" onClick={() => setSel(ESCOPO_VAZIO)} disabled={!escopoAtivo(sel)}>Limpar tudo</Button>
                <Button className="flex-1" disabled={!escopoAtivo(sel) || !lista.length} onClick={() => { aplicar(sel); fechar(); }}>
                  <Check className="size-4" />Usar lista ({r.itens.toLocaleString("pt-BR")})
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Opcao({ marcado, onClick, titulo, detalhe, valor }: { marcado: boolean; onClick: () => void; titulo: string; detalhe: string; valor: string }) {
  return (
    <button onClick={onClick} className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition", marcado ? "bg-brand-50" : "hover:bg-slate-50")}>
      <span className={cx("grid size-5 shrink-0 place-items-center rounded-md border-2 transition", marcado ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white")}>
        {marcado && <Check className="size-3.5" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{titulo}</span><span className="block truncate text-[12px] text-muted">{detalhe}</span></span>
      <span className="shrink-0 text-[12px] font-medium text-muted tabular">{valor}</span>
    </button>
  );
}
function Chip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-100 py-0.5 pl-2.5 pr-1 text-[12px] font-medium text-brand-800">
      <span className="truncate">{children}</span>
      <button onClick={onRemove} className="rounded-full p-0.5 hover:bg-brand-200"><X className="size-3" /></button>
    </span>
  );
}
