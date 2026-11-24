"use client";
import { useCallback, useEffect, useState } from "react";
import { Topo } from "@/components/topo";
import { Badge, Button, Card, Carregando, Gaveta, inputCls, useConfirm, usePaginacao, useToast } from "@/components/ui";
import { Observacao } from "@/components/observacao";
import { api, fdata, fq, type Row } from "@/lib/client";

const COR: Record<string, string> = { CONTANDO: "PENDENTE", RECONTANDO: "ERRO", CONFERIDA: "LANCADA", ENCERRADA: "ERRO", CANCELADA: "CANCELADA" };
export default function Pagina() {
  const [l, setL] = useState<Row[]>([]), [b, setB] = useState(""), [st, setSt] = useState(""), [sel, setSel] = useState<number | null>(null); const toast = useToast();
  const ler = useCallback(() => api<Row[]>("conferencia").then(setL).catch((e) => toast(e.message, "erro")), [toast]);
  useEffect(() => { ler(); const t = setInterval(ler, 15_000); return () => clearInterval(t); }, [ler]);
  const q = b.trim().toUpperCase(), f = l.filter((x) => (!st || x.status === st) && (!q || `${x.pedido} ${x.romaneio} ${x.cliente} ${x.usuario}`.toUpperCase().includes(q))), { itens, controles } = usePaginacao(f, 25, q + st);
  return (
    <><Topo /><main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6"><h1 className="text-2xl font-semibold">Conferência de expedição</h1>
      <Card className="mt-4"><div className="flex flex-wrap gap-3 border-b border-line p-4"><input className={inputCls + " min-w-[220px] flex-1"} placeholder="Pedido, romaneio, cliente, conferente" value={b} onChange={(e) => setB(e.target.value)} /><select className={inputCls + " !w-auto"} value={st} onChange={(e) => setSt(e.target.value)}><option value="">Todas</option>{Object.keys(COR).map((k) => <option key={k}>{k}</option>)}</select></div>
        <div className="scroll-fino overflow-x-auto"><table className="w-full text-[13px]"><thead className="text-left text-[12px] text-muted"><tr className="border-b border-line">{["Pedido", "Romaneio", "Cliente", "Conferente", "Início", "Fim", "Itens", "Situação", "Nº Lieto"].map((h) => <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>{itens.map((x) => <tr key={x.id} onClick={() => setSel(x.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-slate-50"><td className="px-4 py-2.5 font-semibold tabular">{x.pedido ?? `${x.pedidos} pedidos`}</td><td className="px-4 py-2.5 tabular">{x.romaneio || "—"}</td><td className="max-w-[260px] truncate px-4 py-2.5">{x.cliente}</td><td className="px-4 py-2.5">{x.usuario}</td><td className="whitespace-nowrap px-4 py-2.5 tabular">{fdata(x.criado_em)}</td><td className="whitespace-nowrap px-4 py-2.5 tabular">{fdata(x.fim_em)}</td><td className="px-4 py-2.5 tabular">{x.itens}</td><td className="px-4 py-2.5"><Badge v={COR[x.status]}>{x.status}</Badge></td><td className="px-4 py-2.5 tabular">{["CONFERIDA", "ENCERRADA"].includes(x.status) ? (x.pedido ? x.numide : `${x.numide} a ${x.numide + x.pedidos - 1}`) : "—"}</td></tr>)}</tbody></table></div>
        {!f.length && <p className="p-8 text-center text-sm text-muted">Nenhuma conferência. Elas são abertas no coletor.</p>}<div className="px-4">{controles}</div></Card>
      <Gaveta aberto={!!sel} onClose={() => setSel(null)}>{sel && <Detalhe key={sel} id={sel} mudou={ler} />}</Gaveta></main></>
  );
}
function Detalhe({ id, mudou }: { id: number; mudou: () => void }) {
  const [d, setD] = useState<Row | null>(null), [obs, setObs] = useState(""), toast = useToast(), { confirmar, dialogo } = useConfirm();
  const ler = useCallback(() => api(`conferencia/${id}/gestao`).then(setD).catch((e) => toast(e.message, "erro")), [id, toast]);
  useEffect(() => { ler(); }, [ler]);
  if (!d) return <Carregando />;
  const viva = ["CONTANDO", "RECONTANDO"].includes(d.status);
  async function acao(a: string, t: string, x: string) { if (!(await confirmar({ titulo: t, texto: x, perigo: true }))) return; try { await api(`conferencia/${id}/${a}`, { obs }); toast("Feito."); } catch (e) { toast((e as Error).message, "erro"); } ler(); mudou(); }
  return (
    <div className="space-y-4 p-6 text-sm"><h2 className="text-xl font-semibold">{d.pedidos ? `Romaneio ${d.romaneio}` : `Pedido ${d.pedido}`}</h2>{d.pedidos && <div className="text-muted">Pedidos: {d.pedidos.join(", ")}</div>}<div className="text-muted">{d.cliente} · {d.usuario} · {d.status}</div>{d.erro && <p className="text-rose-700">{d.erro}</p>}
      <table className="w-full text-[13px]"><thead className="text-left text-[12px] text-muted"><tr className="border-b border-line"><th className="py-2">Produto</th><th className="text-right">Pedido</th><th className="text-right">Contagem</th><th className="text-right">Reconf.</th></tr></thead><tbody>{d.itens.map((i: Row) => { const fim = i.numrec > 0 ? i.rec : i.con; return <tr key={i.codpro} className={"border-b border-line " + (fim !== i.qtd ? "bg-rose-50" : "")}><td className="py-2">{i.nompro}<span className="block text-[11px] text-muted">{i.codpro}</span></td><td className="text-right tabular">{fq(i.qtd)}</td><td className="text-right tabular">{fq(i.con)}</td><td className="text-right tabular">{i.numrec > 0 ? fq(i.rec) : "—"}</td></tr>; })}</tbody></table>
      {d.obs && <p className="whitespace-pre-wrap"><b>Observação</b><br />{d.obs}</p>}
      {d.obs_fim && <p className="whitespace-pre-wrap"><b>Observação do encerramento ou cancelamento</b><br />{d.obs_fim}</p>}
      <Observacao nome="Observação do encerramento ou cancelamento" valor={obs} mudar={setObs} off={!viva} />
      <div className="flex gap-2"><Button variant="dark" disabled={!viva || !!d.pedidos} title={d.pedidos ? "Romaneio com divergência: cancele e confira por pedido" : ""} onClick={() => acao("encerrar", "Encerrar com divergência?", "Grava no Lieto como encerrada, sem marcar como conferida.")}>Encerrar com divergência</Button><Button variant="danger" disabled={!viva} onClick={() => acao("cancelar", "Cancelar conferência?", "A contagem é descartada e o pedido volta para a fila.")}>Cancelar</Button></div>{dialogo}</div>
  );
}
