"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Factory, RefreshCw, Search, Send, X } from "lucide-react";
import { Topo, useConformidade } from "@/components/topo";
import { Badge, Button, Card, Carregando, Field, Gaveta, Modal, Stat, Vazio, cx, inputCls, usePaginacao, useToast } from "@/components/ui";
import { api, baixarCsv, fdata, fq, frs, type Row } from "@/lib/client";

const NOME: Record<string, string> = { PENDENTE: "Pendente", LANCADA: "Lançada", ERRO: "Erro", CANCELADA: "Cancelada" };
const hoje = () => new Date().toLocaleDateString("sv-SE");

export default function Producao() {
  const [de, setDe] = useState(hoje().slice(0, 8) + "01"), [ate, setAte] = useState(hoje()), [status, setStatus] = useState(""), [busca, setBusca] = useState("");
  const [d, setD] = useState<Row | null>(null), [sel, setSel] = useState<number | null>(null), [ocupado, setOcupado] = useState(false);
  const toast = useToast(), conf = useConformidade();
  const bloqueada = conf && !conf.rotinas?.find((r: Row) => r.id === "producao")?.ok;
  const carregar = useCallback(() => api(`producao?de=${de}&ate=${ate}${status ? `&status=${status}` : ""}`).then(setD).catch((e) => toast(e.message, "erro")), [de, ate, status, toast]);
  useEffect(() => { carregar(); }, [carregar]);

  const lista = useMemo(() => {
    const b = busca.trim().toUpperCase();
    return ((d?.producoes || []) as Row[]).filter((p) => !b || `${p.codpro} ${p.nompro} ${p.lote} ${p.usuario} ${p.numide ?? ""}`.toUpperCase().includes(b));
  }, [d, busca]);
  const { itens, controles } = usePaginacao(lista, 50, busca + status);
  const lancadas = lista.filter((p) => p.status === "LANCADA");
  const pend = ((d?.pendentes || []) as Row[]).reduce((s, p) => s + p.n, 0);

  async function reprocessar() {
    setOcupado(true);
    try { const r = await api("producao/reprocessar", {}); toast(`${r.ok} lançada(s)${r.erro ? `, ${r.erro} com erro: ${r.mensagens[0]}` : "."}`, r.erro ? "erro" : "ok"); carregar(); }
    catch (e) { toast((e as Error).message, "erro"); } finally { setOcupado(false); }
  }

  return (
    <>
      <Topo />
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Produção</h1>
            <p className="mt-1 text-sm text-muted">Apontamentos feitos no coletor. Cada um vira uma produção no Lieto, com baixa dos insumos pela ficha técnica.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" loading={ocupado} disabled={!!bloqueada || !pend} onClick={reprocessar}><Send className="size-4" />Reenviar {pend} pendente(s)</Button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Apontamentos no período" value={lista.length} />
          <Stat label="Lançadas no Lieto" value={lancadas.length} tone="pos" hint={`${fq(lancadas.reduce((s, p) => s + p.qtd, 0))} unidades`} />
          <Stat label="Custo produzido" value={frs(lancadas.reduce((s, p) => s + (p.total || 0), 0))} />
          <Stat label="Pendentes / com erro" value={pend} tone={pend ? "warn" : undefined} hint="todas as datas" />
        </div>

        <Card className="mt-5">
          <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
            <Field label="De"><input type="date" className={inputCls} value={de} onChange={(e) => setDe(e.target.value)} /></Field>
            <Field label="Até"><input type="date" className={inputCls} value={ate} onChange={(e) => setAte(e.target.value)} /></Field>
            <Field label="Situação">
              <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Todas</option>{Object.entries(NOME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-3 size-4 text-muted" />
              <input className={cx(inputCls, "pl-9")} placeholder="Produto, lote, operador, nº Lieto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <Button variant="ghost" onClick={carregar}><RefreshCw className="size-4" /></Button>
            <Button variant="ghost" onClick={() => baixarCsv(`producao_${de}_${ate}.csv`, ["ID", "Data", "Código", "Produto", "Un", "Qtd", "Lote", "Custo unit.", "Situação", "Nº Lieto", "Operador", "Apontado em", "Erro"],
              lista.map((p) => [p.id, p.data, p.codpro, p.nompro, p.unipro, p.qtd, p.lote, p.custo, NOME[p.status], p.numide, p.usuario, p.criado_em, p.erro]))}>CSV</Button>
          </div>
          {!d ? <Carregando /> : !lista.length ? <Vazio icone={<Factory className="size-6" />} titulo="Nenhuma produção no período" texto="O apontamento é feito no coletor." /> : (
            <div className="scroll-fino overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-left text-[12px] text-muted"><tr className="border-b border-line">
                  {["Data", "Código", "Produto", "Qtd", "Un", "Lote", "Custo unit.", "Operador", "Situação", "Nº Lieto"].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}
                </tr></thead>
                <tbody>
                  {itens.map((p) => (
                    <tr key={p.id} onClick={() => setSel(p.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-2.5 tabular">{fdata(p.data)}</td>
                      <td className="px-4 py-2.5 tabular">{p.codpro}</td><td className="px-4 py-2.5 font-medium">{p.nompro}</td>
                      <td className="px-4 py-2.5 tabular font-semibold">{fq(p.qtd)}</td><td className="px-4 py-2.5">{p.unipro}</td>
                      <td className="px-4 py-2.5">{p.lote || "—"}</td>
                      <td className="px-4 py-2.5 tabular">{p.custo != null ? frs(p.custo) : "—"}</td>
                      <td className="px-4 py-2.5">{p.usuario}</td>
                      <td className="px-4 py-2.5"><Badge v={p.status}>{NOME[p.status]}</Badge>{p.erro && <div className="mt-0.5 max-w-[260px] truncate text-[11px] text-rose-700" title={p.erro}>{p.erro}</div>}</td>
                      <td className="px-4 py-2.5 tabular">{p.numide ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4">{controles}</div>
            </div>
          )}
        </Card>
      </main>
      <Detalhe id={sel} fechar={() => setSel(null)} mudou={carregar} />
    </>
  );
}

function Detalhe({ id, fechar, mudou }: { id: number | null; fechar: () => void; mudou: () => void }) {
  const [p, setP] = useState<Row | null>(null), [ocupado, setOcupado] = useState(false), [motivo, setMotivo] = useState(""), [cancelando, setCancelando] = useState(false);
  const toast = useToast();
  const carregar = useCallback(() => { if (id) api(`producao/${id}`).then(setP).catch((e) => toast(e.message, "erro")); }, [id, toast]);
  useEffect(() => { setP(null); setCancelando(false); setMotivo(""); carregar(); }, [carregar]);
  async function acao(url: string, body: Row = {}) {
    setOcupado(true);
    try { await api(url, body); toast("Feito."); carregar(); mudou(); setCancelando(false); } catch (e) { toast((e as Error).message, "erro"); carregar(); mudou(); } finally { setOcupado(false); }
  }
  return (
    <Gaveta aberto={!!id} onClose={fechar}>
      {!p ? <Carregando /> : (
        <div className="p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2"><Badge v={p.status}>{NOME[p.status]}</Badge><span className="text-[13px] text-muted">#{p.id}{p.numide ? ` · Lieto nº ${p.numide}` : ""}</span></div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight">{p.nompro}</h2>
              <div className="text-sm text-muted">{p.codpro} · {fq(p.qtd)} {p.unipro} · lote {p.lote || "—"} · {fdata(p.data)}</div>
            </div>
            <button onClick={fechar} className="rounded-lg p-1.5 text-muted hover:bg-slate-100"><X className="size-5" /></button>
          </div>
          {p.erro && <div className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200"><b>Último erro:</b> {p.erro}</div>}
          {p.obs && <p className="mt-4 whitespace-pre-wrap text-sm"><b>Observação</b><br />{p.obs}</p>}
          <h3 className="mt-6 text-sm font-semibold">Insumos baixados {p.status !== "LANCADA" && <span className="font-normal text-muted">(prévia: recalculados no lançamento)</span>}</h3>
          <table className="mt-2 w-full text-[13px]">
            <thead className="text-left text-[12px] text-muted"><tr className="border-b border-line"><th className="py-2">Insumo</th><th>Qtd</th><th className="text-right">Custo por un. produzida</th></tr></thead>
            <tbody>{p.insumos.map((i: Row) => (
              <tr key={i.codpro} className="border-b border-line"><td className="py-2"><div className="font-medium">{i.nompro}</div><div className="text-[12px] text-muted">{i.codpro}{i.qntven > 0 ? ` · 1 ${i.unipro} = ${fq(i.qntven / (i.qntcon || 1))} un.` : ` · ${fq(i.qntcon)} ${i.unipro} por un.`}</div></td>
                <td className="tabular">{fq(i.qtd)} {i.unipro}</td><td className="text-right tabular">{frs(i.precus)}</td></tr>
            ))}</tbody>
            <tfoot><tr><td className="py-2 font-semibold" colSpan={2}>Custo unitário do produzido</td><td className="text-right font-semibold tabular">{frs(p.custo)}</td></tr></tfoot>
          </table>
          {["PENDENTE", "ERRO"].includes(p.status) && (
            <div className="mt-6 flex flex-wrap gap-2">
              <Button loading={ocupado} onClick={() => acao(`producao/${p.id}/lancar`)}><Send className="size-4" />Lançar no Lieto</Button>
              {!cancelando ? <Button variant="danger" onClick={() => setCancelando(true)}>Cancelar apontamento</Button> : (
                <div className="flex w-full gap-2"><input autoFocus className={inputCls} placeholder="Motivo do cancelamento" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                  <Button variant="danger" disabled={!motivo.trim()} loading={ocupado} onClick={() => acao(`producao/${p.id}/cancelar`, { motivo })}>Confirmar</Button></div>
              )}
            </div>
          )}
          {p.status === "LANCADA" && <p className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-[13px] text-muted">Lançada em {fdata(p.lancado_em)} por {p.lancado_por}. Para estornar, exclua a produção nº {p.numide} no Lieto.</p>}
          <h3 className="mt-6 text-sm font-semibold">Histórico</h3>
          <ul className="mt-2 space-y-1.5 text-[13px]">
            {p.historico.map((e: Row) => <li key={e.id}><span className="tabular text-muted">{fdata(e.em)}</span> · <b>{e.usuario}</b> · {e.acao}{e.detalhe && e.acao.startsWith("ERRO") ? `: ${e.detalhe}` : ""}</li>)}
          </ul>
        </div>
      )}
    </Gaveta>
  );
}
