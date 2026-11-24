"use client";
// Planilha de vínculo: cada linha é um item do XML; produto e conversão são células.
// Teclado: digita/lê o código, ↑↓ escolhe, Enter confirma o produto e vai para a conversão; Enter na conversão salva e vai para a próxima linha.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, cx, useConfirm, useToast } from "@/components/ui";
import { numero, porCodigo } from "@/components/movimentos";
import { api, fq, type Row } from "@/lib/client";

const id = (i: Row) => [i.emitente, i.cProd, i.un].join("|");

function CelulaProduto({ lista, valor, mudar, pronto, dica, refInput }: { lista: Row[] | null; valor: Row | null; mudar: (p: Row | null) => void; pronto: () => void; dica: string; refInput: (e: HTMLInputElement | null) => void }) {
  const [b, setB] = useState<string | null>(null), [k, setK] = useState(0), [pos, setPos] = useState<DOMRect | null>(null), el = useRef<HTMLInputElement | null>(null);
  const texto = (b || "").trim(), ws = texto.toUpperCase().split(/\s+/);
  const exato = texto ? porCodigo(lista, texto) : undefined;
  const op: Row[] = b === null || !texto ? [] : exato ? [exato] : texto.length > 1 ? (lista || []).filter((p) => ws.every((w) => p.nompro.toUpperCase().includes(w))).slice(0, 12) : [];
  const aberto = op.length > 0 && !!pos;
  useEffect(() => {
    if (b === null) return;
    const f = () => setPos(el.current?.getBoundingClientRect() ?? null);
    f(); window.addEventListener("scroll", f, true); window.addEventListener("resize", f);
    return () => { window.removeEventListener("scroll", f, true); window.removeEventListener("resize", f); };
  }, [b]);
  const escolher = (p: Row) => { mudar(p); setB(null); pronto(); };
  const acima = pos && pos.bottom + 300 > window.innerHeight && pos.top > 300;
  return (
    <>
      <input ref={(e) => { el.current = e; refInput(e); }} value={b ?? (valor ? `${valor.codpro} · ${valor.nompro}` : "")} placeholder={lista ? "Código ou nome" : "Carregando…"} autoComplete="off" title={valor?.nompro}
        className={cx("truncate", valor && b === null && "font-medium")}
        onFocus={(e) => e.target.select()} onBlur={() => setTimeout(() => setB(null), 150)}
        onChange={(e) => { setB(e.target.value); setK(0); if (valor) mudar(null); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && aberto) { e.preventDefault(); setK(Math.min(k + 1, op.length - 1)); }
          else if (e.key === "ArrowUp" && aberto) { e.preventDefault(); setK(Math.max(k - 1, 0)); }
          else if (e.key === "Escape") setB(null);
          else if (e.key === "Enter") { e.preventDefault(); if (op.length) escolher(op[Math.min(k, op.length - 1)]); else if (valor) pronto(); }
        }} />
      {dica && b === null && valor && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-brand-50 px-1.5 text-[10px] font-semibold text-brand-700">{dica}</span>}
      {aberto && createPortal(
        <div className="fixed z-50 max-h-[288px] overflow-y-auto rounded-lg bg-white shadow-xl ring-1 ring-line" style={{ left: pos.left, width: Math.max(pos.width, 320), ...(acima ? { bottom: window.innerHeight - pos.top + 2 } : { top: pos.bottom + 2 }) }}>
          {op.map((p, n) => <button key={p.codpro} type="button" tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); escolher(p); }} className={cx("flex w-full gap-2 px-3 py-1.5 text-left text-[13px]", n === k ? "bg-brand-50" : "hover:bg-slate-50")}><span className="w-12 shrink-0 tabular text-muted">{p.codpro}</span><span className="min-w-0 flex-1 truncate">{p.nompro}</span><span className="text-muted">{p.unipro}</span></button>)}
        </div>, document.body)}
    </>
  );
}

export function TabelaVincular({ itens, lista, admin, mudou }: { itens: Row[]; lista: Row[] | null; admin: boolean; mudou: () => void }) {
  const [ed, setEd] = useState<Record<string, { p: Row | null; f: string }>>({}), [oc, setOc] = useState("");
  const toast = useToast(), { confirmar, dialogo } = useConfirm(), refP = useRef(new Map<string, HTMLInputElement>()), refF = useRef(new Map<string, HTMLInputElement>());
  const val = (i: Row) => ed[id(i)] ?? { p: i.sugestao as Row | null, f: "1" };
  const muda = (i: Row, v: Partial<{ p: Row | null; f: string }>) => setEd((e) => ({ ...e, [id(i)]: { ...(e[id(i)] ?? { p: i.sugestao, f: "1" }), ...v } }));
  const guarda = (m: Map<string, HTMLInputElement>, k: string) => (e: HTMLInputElement | null) => { if (e) m.set(k, e); else m.delete(k); };
  const enviar = (i: Row) => { const { p, f } = val(i); return api("xml/vincular", { emitente: i.emitente, cProd: i.cProd, un: i.un, codpro: p!.codpro, fator: numero(f) }); };
  const ok = (i: Row) => !!val(i).p && numero(val(i).f) > 0;
  async function salvar(i: Row, n: number) {
    if (!ok(i) || oc) return;
    setOc(id(i));
    const prox = itens[n + 1];
    try { await enviar(i); if (prox) refP.current.get(id(prox))?.focus(); mudou(); } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(""); }
  }
  async function novo(i: Row) {
    const { p } = val(i);
    if (!p || !(await confirmar({ titulo: "Cadastrar produto novo?", texto: `“${i.xProd}” será criado no Lieto copiando grupo e tributação de ${p.codpro} · ${p.nompro}.`, acao: "Cadastrar" }))) return;
    setOc(id(i));
    try { const r = await api("xml/produto", { chave: i.chave, item: i.n, modelo: p.codpro }); toast(`Produto ${r.codpro} cadastrado.`); mudou(); } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(""); }
  }
  return (
    <div className="scroll-fino overflow-x-auto rounded-xl border border-line">
      <table className="planilha w-full min-w-[980px] table-fixed border-collapse text-[13px]">
        <colgroup><col className="w-[30%]" /><col className="w-[70px]" /><col className="w-[90px]" /><col /><col className="w-[190px]" /><col className={admin ? "w-[170px]" : "w-[100px]"} /></colgroup>
        <thead className="bg-slate-50 text-left text-[12px] text-muted"><tr><th className="font-medium">Item do XML</th><th className="text-right font-medium">Notas</th><th className="text-right font-medium">Qtd</th><th className="font-medium">Produto no Lieto</th><th className="font-medium">Conversão</th><th /></tr></thead>
        <tbody>{itens.map((i, n) => { const v = val(i), k = id(i); return (
          <tr key={k} className="hover:bg-slate-50/60">
            <td><div className="truncate font-medium" title={i.xProd}>{i.xProd}</div><div className="truncate text-[11px] text-muted" title={`${i.cProd} · EAN ${i.ean || "—"} · CFOP ${i.cfop}`}>{i.cProd}{i.ean ? ` · ${i.ean}` : ""}</div></td>
            <td className="text-right tabular">{i.notas}</td><td className="text-right tabular">{fq(i.qtd)} {i.un}</td>
            <td className={cx("cel-edit", !!ed[k]?.p && "sujo")}><CelulaProduto lista={lista} valor={v.p} mudar={(p) => muda(i, { p })} pronto={() => setTimeout(() => { const e = refF.current.get(k); e?.focus(); e?.select(); }, 0)} dica={!ed[k] && i.sugestao ? "EAN" : ""} refInput={guarda(refP.current, k)} /></td>
            <td className={cx("cel-edit", !(numero(v.f) > 0) && "invalido")}><div className="flex items-center"><span className="shrink-0 pl-2 text-muted">1 {i.un} =</span><input ref={guarda(refF.current, k)} inputMode="decimal" className="!w-16 text-right tabular" value={v.f} onChange={(e) => muda(i, { f: e.target.value })} onFocus={(e) => e.target.select()} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); salvar(i, n); } }} /><span className="truncate text-muted">{v.p?.unipro || ""}</span></div></td>
            <td><div className="flex justify-end gap-1"><Button size="sm" loading={oc === k} disabled={!ok(i) || !!oc} onClick={() => salvar(i, n)}>Vincular</Button>{admin && <Button size="sm" variant="ghost" disabled={!v.p || !!oc} title="Cadastrar como produto novo, usando o escolhido como modelo" onClick={() => novo(i)}>Novo</Button>}</div></td>
          </tr>); })}</tbody>
      </table>
      {dialogo}
    </div>
  );
}
