"use client";
import { useCallback, useEffect, useState } from "react";
import { Topo } from "@/components/topo";
import { Button, Card, Carregando, inputCls, useToast } from "@/components/ui";
import { api, type Row } from "@/lib/client";

export default function Pagina() {
  const [d, setD] = useState<Row | null>(null), [erro, setErro] = useState(""), [b, setB] = useState(""), [sel, setSel] = useState<number | null>(null);
  const ler = useCallback(() => api("permissoes").then(setD).catch((e) => setErro(e.message)), []);
  useEffect(() => { ler(); }, [ler]);
  if (erro) return <><Topo /><p className="p-8 text-center text-rose-700">{erro}</p></>;
  if (!d) return <><Topo /><Carregando pagina /></>;
  const q = b.trim().toUpperCase(), lista = d.usuarios.filter((u: Row) => !q || String(u.codfun) === q || `${u.nome} ${u.nomfun}`.toUpperCase().includes(q));
  const u = d.usuarios.find((x: Row) => x.codfun === sel);
  return (
    <><Topo /><main className="mx-auto max-w-[1100px] px-4 py-6">
      <h1 className="text-2xl font-semibold">Liberação de rotinas</h1>
      <p className="mt-1 text-sm text-muted">Por código do funcionário no Lieto. Quem não tem liberação não usa a rotina.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card className="p-4"><input className={inputCls} placeholder="Código ou nome" value={b} onChange={(e) => setB(e.target.value)} />
          <div className="mt-2 max-h-[60vh] overflow-y-auto">{lista.map((x: Row) => (
            <button key={x.codfun} onClick={() => setSel(x.codfun)} className={"flex w-full justify-between gap-3 border-b border-line px-2 py-2.5 text-left text-sm " + (sel === x.codfun ? "bg-brand-50" : "hover:bg-slate-50")}>
              <span><b>{x.codfun}</b> · {x.nome}</span><span className="text-muted">{x.admin ? "administrador" : `${x.rotinas.length} liberada(s)`}</span></button>))}</div></Card>
        {u && <Edicao key={u.codfun} u={u} rotinas={d.rotinas} salvo={ler} />}
      </div>
    </main></>
  );
}

function Edicao({ u, rotinas, salvo }: { u: Row; rotinas: Row[]; salvo: () => void }) {
  const [r, setR] = useState<string[]>(u.rotinas), [oc, setOc] = useState(false); const toast = useToast();
  async function ok() { setOc(true); try { await api(`permissoes/${u.codfun}`, { rotinas: r }); toast("Liberações salvas."); salvo(); } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); } }
  return (
    <Card className="p-5"><b>{u.codfun} · {u.nomfun}</b>
      {u.admin ? <p className="mt-2 text-sm text-muted">Administrador (config.json › admins): pode tudo.</p> : <>
        <div className="mt-3 space-y-2">{rotinas.map((x) => <label key={x.id} className="flex items-start gap-3 text-sm"><input type="checkbox" className="size-5 shrink-0" checked={r.includes(x.id)} onChange={(e) => setR(e.target.checked ? [...r, x.id] : r.filter((y) => y !== x.id))} /><span className="pt-px">{x.nome}{x.dica && <small className="block text-[12.5px] text-muted">{x.dica}</small>}</span></label>)}</div>
        <div className="mt-4 flex gap-2"><Button loading={oc} onClick={ok}>Salvar</Button><Button variant="ghost" onClick={() => setR(rotinas.map((x) => x.id))}>Marcar todas</Button><Button variant="ghost" onClick={() => setR([])}>Limpar</Button></div></>}
    </Card>
  );
}
