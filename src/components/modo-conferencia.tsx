"use client";
// Sistema › Conferência de expedição: cega ou com separação, bipar, e as empresas que liberam o pedido pelo PCP do Lieto.
// Vale para as próximas; as abertas seguem como começaram.
import { useEffect, useState } from "react";
import { Button, Card, cx, useToast } from "@/components/ui";
import { api, type Row } from "@/lib/client";

const OPCOES = [["SEPARACAO", "Com separação", "Mostra local e quantidade. Quem separa já confere."], ["CEGA", "Cega", "Não mostra a quantidade do pedido."]] as const;
const igual = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));
export function ModoConferencia({ admin }: { admin: boolean }) {
  const [salvo, setSalvo] = useState<Row | null>(null), [v, setV] = useState(""), [bip, setBip] = useState(false), [pcp, setPcp] = useState<number[]>([]), [erro, setErro] = useState(""), [oc, setOc] = useState(false), toast = useToast();
  const por = (r: Row) => { setSalvo(r); setV(r.modo); setBip(r.bipar); setPcp(r.pcp || []); };
  useEffect(() => { api("sistema/conferencia").then(por).catch((e) => setErro((e as Error).message)); }, []);
  async function salvar() { setOc(true); try { por(await api("sistema/conferencia", { modo: v, bipar: bip, pcp })); toast("Conferência salva."); } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); } }
  const mudou = !!salvo && (v !== salvo.modo || bip !== salvo.bipar || !igual(pcp, salvo.pcp || []));
  return (
    <Card className="mt-4 p-5">
      <h2 className="font-semibold">Conferência de expedição</h2>
      <p className="mt-1 text-sm text-muted">Vale para as próximas conferências. As já abertas continuam como começaram.</p>
      {erro && <p className="mt-3 bg-rose-50 p-3 text-sm text-rose-800">{erro}</p>}
      <div className="mt-3">{OPCOES.map(([k, n, t]) => (
        <label key={k} className="flex items-start gap-3 border-b border-line py-3 text-sm"><input type="radio" name="modo" className="mt-1" disabled={!admin || !v} checked={v === k} onChange={() => setV(k)} /><span><b>{n}</b><span className="block text-muted">{t}</span></span></label>
      ))}</div>
      <label className="flex items-start gap-3 py-3 text-sm"><input type="checkbox" className="mt-1" disabled={!admin || v !== "SEPARACAO"} checked={bip} onChange={(e) => setBip(e.target.checked)} /><span><b>Bipar o produto na separação</b><span className="block text-muted">Ligado: bipar confirma o produto e abre a quantidade. Desligado: confirma na tela, e bipar não funciona.</span></span></label>
      {/* Por empresa: o PCP só é usado em uma. Nas outras, pedido pendente já está pronto para separar. */}
      <h3 className="mt-4 font-semibold">Liberação pelo PCP</h3>
      <p className="mt-1 text-sm text-muted">Ligado: só vai para a fila o pedido liberado no PCP do Lieto. Desligado: pedido pendente já está pronto para separar.</p>
      {salvo && <div className="mt-2">{(salvo.empresas as Row[]).map((e) => { const on = pcp.includes(e.codemp); return (
        <label key={e.codemp} className="flex items-center gap-3 border-b border-line py-3 text-sm">
          <span className="flex-1"><b>{e.codemp} · {e.nomemp}</b><span className="block text-muted">{on ? "Só entra na fila o pedido com a data de liberação do PCP preenchida." : "Pedido pendente vai direto para a fila de separar."}</span></span>
          <span className="text-[12.5px] font-semibold text-muted">Usa PCP</span>
          <input type="checkbox" className="peer sr-only" disabled={!admin} checked={on} onChange={(x) => setPcp(x.target.checked ? [...pcp, e.codemp] : pcp.filter((y) => y !== e.codemp))} />
          <span aria-hidden className={cx("relative h-[22px] w-[38px] shrink-0 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500", on ? "bg-brand-700" : "bg-slate-300", !admin && "opacity-60")}><i className={cx("absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all", on ? "left-[19px]" : "left-[3px]")} /></span>
        </label>); })}</div>}
      <div className="mt-3">{admin ? <Button loading={oc} disabled={!v || !mudou} onClick={salvar}>Salvar</Button> : <p className="text-[12px] text-muted">Só administradores alteram.</p>}</div>
    </Card>
  );
}
