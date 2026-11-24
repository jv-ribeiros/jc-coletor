"use client";
// Sistema › Empresa por rotina. Conferência e XML não aparecem: seguem a empresa do pedido e do emitente.
import { useEffect, useState } from "react";
import { Button, Card, inputCls, useToast } from "@/components/ui";
import { api, type Row } from "@/lib/client";

export function EmpresasRotina({ admin }: { admin: boolean }) {
  const [d, setD] = useState<Row | null>(null), [v, setV] = useState<Record<string, number>>({}), [erro, setErro] = useState(""), [oc, setOc] = useState(false), toast = useToast();
  const por = (r: Row) => { setD(r); setV(Object.fromEntries(r.rotinas.map((x: Row) => [x.id, x.codemp]))); };
  useEffect(() => { api("sistema/empresas").then(por).catch((e) => setErro((e as Error).message)); }, []);
  async function salvar() { setOc(true); try { por(await api("sistema/empresas", { rotinas: v })); toast("Empresas salvas."); } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); } }
  const faltam = d ? d.rotinas.filter((r: Row) => !v[r.id]).length : 0;
  return (
    <Card className="mt-4 p-5">
      <h2 className="font-semibold">Empresa por rotina</h2>
      <p className="mt-1 text-sm text-muted">Em qual empresa do Lieto cada rotina grava. Conferência e XML seguem a empresa do pedido e do emitente.</p>
      {erro && <p className="mt-3 bg-rose-50 p-3 text-sm text-rose-800">Não foi possível ler as empresas do Lieto: {erro}</p>}
      {!d && !erro && <p className="mt-3 text-sm text-muted">Carregando empresas…</p>}
      {d && <>
        <div className="mt-3">{d.rotinas.map((r: Row) => (
          <label key={r.id} className="grid items-center gap-2 border-b border-line py-2 text-sm sm:grid-cols-[200px_1fr]"><b>{r.nome}</b>
            <select className={inputCls} disabled={!admin} value={v[r.id] || 0} onChange={(e) => setV({ ...v, [r.id]: Number(e.target.value) })}><option value={0}>Escolha…</option>{d.empresas.map((e: Row) => <option key={e.codemp} value={e.codemp}>{e.codemp} · {e.nomemp}</option>)}</select></label>
        ))}</div>
        {faltam > 0 && <p className="mt-3 bg-rose-50 p-3 text-sm text-rose-800">{faltam} rotina(s) sem empresa: não gravam até você escolher.</p>}
        <div className="mt-3">{admin ? <Button loading={oc} onClick={salvar}>Salvar</Button> : <p className="text-[12px] text-muted">Só administradores alteram.</p>}</div>
      </>}
    </Card>
  );
}
