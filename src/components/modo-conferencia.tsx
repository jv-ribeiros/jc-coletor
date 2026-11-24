"use client";
// Sistema › Conferência de expedição: cega ou com separação. Vale para as próximas; as abertas seguem como começaram.
import { useEffect, useState } from "react";
import { Button, Card, useToast } from "@/components/ui";
import { api } from "@/lib/client";

const OPCOES = [["SEPARACAO", "Com separação", "Mostra local e quantidade. Quem separa já confere."], ["CEGA", "Cega", "Não mostra a quantidade do pedido."]] as const;
export function ModoConferencia({ admin }: { admin: boolean }) {
  const [salvo, setSalvo] = useState(""), [v, setV] = useState(""), [erro, setErro] = useState(""), [oc, setOc] = useState(false), toast = useToast();
  useEffect(() => { api("sistema/conferencia").then((r) => { setSalvo(r.modo); setV(r.modo); }).catch((e) => setErro((e as Error).message)); }, []);
  async function salvar() { setOc(true); try { const r = await api("sistema/conferencia", { modo: v }); setSalvo(r.modo); setV(r.modo); toast("Conferência salva."); } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); } }
  return (
    <Card className="mt-4 p-5">
      <h2 className="font-semibold">Conferência de expedição</h2>
      <p className="mt-1 text-sm text-muted">Vale para as próximas conferências. As já abertas continuam como começaram.</p>
      {erro && <p className="mt-3 bg-rose-50 p-3 text-sm text-rose-800">{erro}</p>}
      <div className="mt-3">{OPCOES.map(([k, n, t]) => (
        <label key={k} className="flex items-start gap-3 border-b border-line py-3 text-sm"><input type="radio" name="modo" className="mt-1" disabled={!admin || !v} checked={v === k} onChange={() => setV(k)} /><span><b>{n}</b><span className="block text-muted">{t}</span></span></label>
      ))}</div>
      <div className="mt-3">{admin ? <Button loading={oc} disabled={!v || v === salvo} onClick={salvar}>Salvar</Button> : <p className="text-[12px] text-muted">Só administradores alteram.</p>}</div>
    </Card>
  );
}
