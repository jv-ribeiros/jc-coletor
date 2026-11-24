"use client";
// Gestão: acompanha o que o coletor fez (transferência, transformação, kit, retorno). Nenhuma operação é feita aqui,
// só tratar pendência: relançar, cancelar, estornar.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Topo, usePode } from "@/components/topo";
import { Badge, Button, Card, Gaveta, inputCls, useConfirm, usePaginacao, useToast } from "@/components/ui";
import { Observacao } from "@/components/observacao";
import { api, fdata, fq, type Row } from "@/lib/client";

const TIPOS: [string, string][] = [["transferencia", "Transferência"], ["transformacao", "Transformação"], ["kit", "Kit"], ["retorno", "Retorno"], ["perda", "Perdas"]];
const NOME = Object.fromEntries(TIPOS), SIT: Record<string, string> = { PENDENTE: "Pendente", LANCADA: "Lançado", ERRO: "Erro", CANCELADA: "Cancelado", ESTORNADA: "Estornado" };

export default function Pagina() {
  const pode = usePode(), toast = useToast(), [l, setL] = useState<Row[]>([]), [tipo, setTipo] = useState(""), [st, setSt] = useState(""), [b, setB] = useState(""), [sel, setSel] = useState<number | null>(null);
  const livres = TIPOS.filter(([k]) => pode([k])).map(([k]) => k).join();
  const ler = useCallback(async () => { try { setL((await Promise.all(livres.split(",").filter(Boolean).map((t) => api<Row[]>(`movs/${t}`)))).flat().sort((x, y) => y.id - x.id)); } catch (e) { toast((e as Error).message, "erro"); } }, [livres, toast]);
  useEffect(() => { ler(); const t = setInterval(ler, 15_000); return () => clearInterval(t); }, [ler]);
  const q = b.trim().toUpperCase();
  const f = useMemo(() => l.filter((m) => (!tipo || m.tipo === tipo) && (!st || m.status === st) && (!q || `${m.id} ${m.resumo} ${m.usuario}`.toUpperCase().includes(q))), [l, tipo, st, q]);
  const { itens, controles } = usePaginacao(f, 25, tipo + st + q), m = l.find((x) => x.id === sel);
  return (
    <><Topo /><main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold">Movimentos do coletor</h1>
      <Card className="mt-4">
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <input className={inputCls + " min-w-[220px] flex-1"} placeholder="Produto, operador, número" value={b} onChange={(e) => setB(e.target.value)} />
          <select className={inputCls + " !w-auto"} value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todas as rotinas</option>{TIPOS.map(([k, n]) => <option key={k} value={k} disabled={!pode([k])}>{n}</option>)}</select>
          <select className={inputCls + " !w-auto"} value={st} onChange={(e) => setSt(e.target.value)}><option value="">Todas as situações</option>{Object.entries(SIT).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        </div>
        <div className="scroll-fino overflow-x-auto"><table className="w-full text-[13px]">
          <thead className="text-left text-[12px] text-muted"><tr className="border-b border-line">{["Nº", "Data", "Rotina", "Movimento", "Operador", "Situação", "Erro"].map((h) => <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>{itens.map((x) => (
            <tr key={x.id} onClick={() => setSel(x.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-slate-50">
              <td className="px-4 py-2.5 tabular">{x.id}</td><td className="whitespace-nowrap px-4 py-2.5 tabular">{fdata(x.criado_em)}</td><td className="px-4 py-2.5">{NOME[x.tipo]}{x.estorno_de ? " (estorno)" : ""}</td>
              <td className="max-w-[440px] truncate px-4 py-2.5" title={x.resumo}>{x.resumo}</td><td className="px-4 py-2.5">{x.usuario}</td><td className="whitespace-nowrap px-4 py-2.5"><Badge v={x.status}>{SIT[x.status]}</Badge>{x.estorno ? <span className="ml-1 text-[11px] text-muted">estornado</span> : null}</td><td className="max-w-[240px] truncate px-4 py-2.5 text-rose-700" title={x.erro}>{x.erro}</td>
            </tr>))}</tbody>
        </table></div>
        {!f.length && <p className="p-8 text-center text-sm text-muted">Nenhum movimento. Eles são feitos no coletor.</p>}<div className="px-4">{controles}</div>
      </Card>
      <Gaveta aberto={!!m} onClose={() => setSel(null)}>{m && <Detalhe key={m.id} m={m} pode={pode} mudou={ler} />}</Gaveta>
    </main></>
  );
}

function Detalhe({ m, pode, mudou }: { m: Row; pode: (r?: string[]) => boolean; mudou: () => void }) {
  const [oc, setOc] = useState(false), [obs, setObs] = useState(""), toast = useToast(), { confirmar, dialogo } = useConfirm(), viva = ["PENDENTE", "ERRO"].includes(m.status);
  async function acao(a: string, t?: string) {
    if (t && !(await confirmar({ titulo: t, texto: m.resumo, perigo: true }))) return;
    setOc(true);
    try { const r = await api(`mov/${m.id}/${a}`, { obs }); toast(r.status === "ERRO" ? r.erro : "Feito.", r.status === "ERRO" ? "erro" : "ok"); } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); mudou(); }
  }
  return (
    <div className="space-y-4 p-6 text-sm">
      <div><div className="flex items-center gap-2"><Badge v={m.status}>{SIT[m.status]}</Badge><span className="text-muted">{NOME[m.tipo]} nº {m.id}</span></div><h2 className="mt-2 text-lg font-semibold">{m.resumo}</h2><div className="text-muted">{m.usuario} · {fdata(m.criado_em)}{m.lancado_em ? ` · lançado ${fdata(m.lancado_em)}` : ""}</div></div>
      {m.erro && <p className="bg-rose-50 p-3 text-rose-800">{m.erro}</p>}
      <table className="w-full text-[13px]"><thead className="text-left text-[12px] text-muted"><tr className="border-b border-line"><th className="py-2">Produto</th><th>Centro</th><th className="text-right">Quantidade</th></tr></thead><tbody>{m.linhas.map((x: Row, k: number) => <tr key={k} className="border-b border-line"><td className="py-2">{x.codpro} · {x.nompro}</td><td>{x.codset ?? "—"}</td><td className={"text-right tabular " + (x.entsai === "E" ? "text-brand-700" : "text-rose-700")}>{x.entsai === "E" ? "+" : "−"}{fq(x.qtd)}</td></tr>)}</tbody></table>
      {m.obs && <p className="whitespace-pre-wrap"><b>Observação</b><br />{m.obs}</p>}
      {m.obs_fim && <p className="whitespace-pre-wrap"><b>Observação do cancelamento ou estorno</b><br />{m.obs_fim}</p>}
      <Observacao nome="Observação do cancelamento ou estorno" valor={obs} mudar={setObs} cabe={0} off={!viva && (m.status !== "LANCADA" || !!m.estorno || !!m.estorno_de || m.tipo === "retorno")} />
      <div className="flex flex-wrap gap-2">
        <Button loading={oc} disabled={!viva} onClick={() => acao("lancar")}>Lançar de novo</Button>
        <Button variant="danger" disabled={!viva || oc} onClick={() => acao("cancelar", "Cancelar movimento?")}>Cancelar</Button>
        <Button variant="secondary" disabled={m.status !== "LANCADA" || !!m.estorno || !!m.estorno_de || m.tipo === "retorno" || !pode(["estornar"]) || oc} title={m.tipo === "retorno" ? "Retorno se desfaz no Lieto" : ""} onClick={() => acao("estornar", m.tipo === "perda" ? "Estornar? O registro da perda será EXCLUÍDO no Lieto." : "Estornar movimento?")}>Estornar</Button>
      </div>{dialogo}
    </div>
  );
}
