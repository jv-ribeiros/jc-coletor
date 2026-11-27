"use client";
// Sistema › Recebimento: quais operações de entrada do Lieto são compra. O Lieto não marca (OPERACOES.PEDCOM é 'N' em todas),
// e sem isto o alerta "nota de compra sem recebimento" pegaria devolução, despesa e CT-e. "Desde" evita acusar as notas antigas,
// lançadas antes de o recebimento existir.
import { useEffect, useState } from "react";
import { Button, Card, cx, inputCls, useToast } from "@/components/ui";
import { api, type Row } from "@/lib/client";

const igual = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));
export function RecebimentoSistema({ admin }: { admin: boolean }) {
  const [salvo, setSalvo] = useState<Row | null>(null), [sel, setSel] = useState<number[]>([]), [desde, setDesde] = useState(""), [erro, setErro] = useState(""), [oc, setOc] = useState(false), [todas, setTodas] = useState(false), toast = useToast();
  const por = (r: Row) => { setSalvo(r); setSel(r.compra || []); setDesde(r.desde || new Date().toLocaleDateString("sv-SE")); };
  useEffect(() => { api("sistema/recebimento").then(por).catch((e) => setErro((e as Error).message)); }, []);
  async function salvar() { setOc(true); try { por(await api("sistema/recebimento", { compra: sel, desde })); toast("Recebimento salvo."); } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); } }
  const mudou = !!salvo && (!igual(sel, salvo.compra || []) || desde !== (salvo.desde || ""));
  // as marcadas primeiro, depois as mais usadas; o resto (operações quase sem nota) fica recolhido
  const todasOps: Row[] = [...(salvo?.operacoes || [])].sort((a, b) => Number((salvo?.compra || []).includes(b.codope)) - Number((salvo?.compra || []).includes(a.codope)) || b.n - a.n);
  const base = todasOps.filter((o, k) => k < 10 || (salvo?.compra || []).includes(o.codope) || sel.includes(o.codope)), ops = todas ? todasOps : base, resto = todasOps.length - base.length;
  return (
    <Card className="mt-4 p-5">
      <h2 className="font-semibold">Recebimento</h2>
      <p className="mt-1 text-sm text-muted">Marque as operações de entrada que são compra. As notas delas lançadas no Lieto sem recebimento viram alerta no Painel.</p>
      {erro && <p className="mt-3 bg-rose-50 p-3 text-sm text-rose-800">{erro}</p>}
      {salvo && <>
        <div className="mt-3 grid gap-x-6 sm:grid-cols-2">{ops.map((o) => <label key={o.codope} className={cx("flex items-start gap-3 border-b border-line py-2.5 text-sm", !admin && "opacity-70")}>
          <input type="checkbox" className="mt-1" disabled={!admin} checked={sel.includes(o.codope)} onChange={(e) => setSel((x) => (e.target.checked ? [...x, o.codope] : x.filter((y) => y !== o.codope)))} />
          <span><b className="tabular">{o.codope}</b> · {o.nome || "sem nome"}<span className="block text-[12.5px] text-muted">{o.n ? `${o.n} nota(s) nos últimos 90 dias` : "nenhuma nota nos últimos 90 dias"}</span></span></label>)}</div>
        {resto > 0 && <button className="mt-2 text-sm font-medium text-brand-700 underline" onClick={() => setTodas((x) => !x)}>{todas ? "Mostrar só as mais usadas" : `Mostrar as outras ${resto}`}</button>}
        {!ops.length && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-muted">Nenhuma operação de entrada usada nos últimos 90 dias.</p>}
        <label className="mt-4 flex flex-wrap items-center gap-3 text-sm"><span>Acusar notas lançadas a partir de</span><input type="date" className={inputCls + " !w-44"} disabled={!admin} value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <div className="mt-4 flex items-center gap-3"><Button disabled={!admin || !mudou} loading={oc} onClick={salvar}>Salvar</Button>{!admin && <span className="text-sm text-muted">Só o administrador altera.</span>}</div>
      </>}
    </Card>
  );
}
