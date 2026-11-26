"use client";
// Tela inicial dividida em abas (rotas): Em andamento · Programação · Encerrados.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Boxes, CalendarClock, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Clock, ListChecks, Pencil, Play, Plus, ScanBarcode, Search, Trash2, TriangleAlert, Users,
} from "lucide-react";
import { NovoInventario } from "@/components/novo-inventario";
import { Topo } from "@/components/topo";
import { Badge, Button, Card, Field, Gaveta, Modal, Stepper, Vazio, cx, inputCls, useConfirm, usePaginacao, useToast } from "@/components/ui";
import { descreverEscopo } from "@/lib/escopo";
import { NOME_ETAPA, api, fdata, frsK, type Row } from "@/lib/client";

export type AbaInicio = "andamento" | "programacao" | "encerrados";
const hojeIso = () => new Date().toLocaleDateString("sv-SE");
const ETAPAS_INI = [["CONTAGEM", "Contagem"], ["RECONTAGEM", "Recontagem"], ["AUDITORIA", "Auditoria"]] as const;

export function Inicio({ aba }: { aba: AbaInicio }) {
  const [invs, setInvs] = useState<Row[] | null>(null);
  const [novo, setNovo] = useState<null | "agora" | "programar">(null);
  const carregar = () => api<Row[]>("inventarios").then(setInvs).catch(() => setInvs([]));
  useEffect(() => { carregar(); }, []);
  const hoje = hojeIso();
  const grupos = useMemo(() => {
    const l = invs ?? [];
    return {
      andamento: l.filter((i) => !["ENCERRADO", "PROGRAMADO"].includes(i.etapa)),
      programacao: l.filter((i) => i.etapa === "PROGRAMADO").sort((a, b) => a.data_prevista.localeCompare(b.data_prevista)),
      encerrados: l.filter((i) => i.etapa === "ENCERRADO"),
    };
  }, [invs]);
  const atrasados = grupos.programacao.filter((i) => i.data_prevista < hoje).length, deHoje = grupos.programacao.filter((i) => i.data_prevista === hoje).length;

  const abas: [AbaInicio, string, string, number][] = [
    ["andamento", "Em andamento", "/inventario", grupos.andamento.length], ["programacao", "Programação", "/inventario/programacao", grupos.programacao.length], ["encerrados", "Encerrados", "/inventario/encerrados", grupos.encerrados.length],
  ];
  return (
    <>
      <Topo />
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Inventários</h1>
            <p className="mt-1 text-sm text-muted">Contagem → Recontagem → Auditoria → Lançamento + Parecer</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setNovo("programar")}><CalendarPlus className="size-4" />Programar</Button>
            <Button onClick={() => setNovo("agora")}><Plus className="size-4" />Novo inventário</Button>
          </div>
        </div>

        {(atrasados > 0 || deHoje > 0) && aba !== "programacao" && (
          <Link href="/inventario/programacao" className="mt-5 flex items-center gap-3 rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-950 ring-1 ring-indigo-200 transition hover:bg-indigo-100/70">
            <CalendarClock className="size-5 text-indigo-700" />
            <span className="flex-1">{deHoje > 0 && <><b>{deHoje}</b> programado(s) para hoje. </>}{atrasados > 0 && <><b>{atrasados}</b> programado(s) com data vencida.</>}</span>
            <span className="text-[13px] font-semibold text-indigo-700">Ver programação</span><ArrowRight className="size-4 text-indigo-700" />
          </Link>
        )}

        <div className="mt-5 flex gap-1 border-b border-line">
          {abas.map(([k, n, href, c]) => (
            <Link key={k} href={href} className={cx("relative inline-flex h-11 items-center gap-2 px-3 text-[14px] font-medium transition",
              aba === k ? "text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-600" : "text-muted hover:text-ink")}>
              {n}{c > 0 && <span className={cx("rounded-full px-1.5 text-[11px] font-semibold tabular", k === "programacao" && atrasados ? "bg-rose-600 text-white" : "bg-slate-200 text-slate-700")}>{c}</span>}
            </Link>
          ))}
        </div>

        <div className="pt-5">
          {invs === null ? null
            : aba === "andamento" ? <EmAndamento itens={grupos.andamento} novo={() => setNovo("agora")} />
            : aba === "programacao" ? <Programacao itens={grupos.programacao} todos={invs} recarregar={carregar} programar={() => setNovo("programar")} />
            : <Encerrados itens={grupos.encerrados} />}
        </div>
      </main>
      <Gaveta aberto={!!novo} onClose={() => setNovo(null)}>
        {novo && <NovoInventario modoInicial={novo} fechar={() => setNovo(null)} aoCriar={carregar} />}
      </Gaveta>
    </>
  );
}

// ---------- em andamento ----------
function EmAndamento({ itens, novo }: { itens: Row[]; novo: () => void }) {
  const { itens: pag, controles } = usePaginacao(itens, 12);
  if (!itens.length) return <Card><Vazio icone={<Boxes className="size-6" />} titulo="Nenhum inventário em andamento" texto="Abra um inventário agora ou veja a programação.">
    <Button onClick={novo}><Plus className="size-4" />Novo inventário</Button></Vazio></Card>;
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">{pag.map((i) => <CartaoInventario key={i.id} i={i} />)}</div>
      {controles}
    </>
  );
}

function CartaoInventario({ i }: { i: Row }) {
  return (
    <Link href={`/inventario/${i.id}`} className="group">
      <Card className="h-full p-5 transition group-hover:border-brand-200 group-hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-muted">#{i.id} · {i.origem === "ERP" ? i.nomemp || `Empresa ${i.codemp}` : "Importado de CSV"}</div>
            <div className="mt-0.5 truncate text-[16px] font-semibold tracking-tight">{i.descricao}</div>
          </div>
          <Badge v={i.etapa} />
        </div>
        <div className="mt-2 flex items-center gap-1.5 truncate text-[12px] text-muted"><ListChecks className="size-3.5 shrink-0" /><span className="truncate">{descreverEscopo(i.escopo ? JSON.parse(i.escopo) : null)}</span></div>
        <div className="mt-4"><Stepper etapa={i.etapa} inicio={i.etapa_inicial} compacto /></div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" />{fdata(i.snapshot_em)}</span>
          <span className="inline-flex items-center gap-1.5 tabular"><ScanBarcode className="size-3.5" />{(i.leituras?.n ?? 0).toLocaleString("pt-BR")} leituras</span>
          <span className="inline-flex items-center gap-1.5"><Users className="size-3.5" />{i.leituras?.ops ?? 0}</span>
          <span className="inline-flex items-center gap-1.5 tabular"><Boxes className="size-3.5" />{(i.resumo?.comsaldo ?? 0).toLocaleString("pt-BR")} itens · {frsK(i.resumo?.valor ?? 0)}</span>
          <ArrowRight className="ml-auto size-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
        </div>
      </Card>
    </Link>
  );
}

// ---------- encerrados ----------
function Encerrados({ itens }: { itens: Row[] }) {
  const [busca, setBusca] = useState(""), [ano, setAno] = useState("");
  const anos = useMemo(() => [...new Set(itens.map((i) => (i.encerrado_em || i.snapshot_em || "").slice(0, 4)).filter(Boolean))].sort().reverse(), [itens]);
  const lista = useMemo(() => {
    const b = busca.trim().toUpperCase();
    return itens.filter((i) => (!ano || (i.encerrado_em || i.snapshot_em || "").startsWith(ano)) && (!b || `#${i.id} ${i.descricao} ${i.nomemp || ""}`.toUpperCase().includes(b)))
      .sort((a, b) => String(b.encerrado_em || "").localeCompare(String(a.encerrado_em || "")));
  }, [itens, busca, ano]);
  const { itens: pag, controles } = usePaginacao(lista, 25, busca + ano);
  if (!itens.length) return <Card><Vazio icone={<Boxes className="size-6" />} titulo="Nenhum inventário encerrado ainda" /></Card>;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
          <input className={cx(inputCls, "pl-9")} placeholder="Buscar por número, nome ou empresa" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <select className={cx(inputCls, "w-auto")} value={ano} onChange={(e) => setAno(e.target.value)}>
          <option value="">Todos os anos</option>{anos.map((a) => <option key={a}>{a}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <tr className="[&>th]:border-b [&>th]:border-line [&>th]:px-4 [&>th]:py-2.5"><th>#</th><th>Inventário</th><th>Congelado em</th><th>Encerrado em</th><th className="text-right">Leituras</th><th className="text-right">Estoque</th><th /></tr>
          </thead>
          <tbody className="tabular">
            {pag.map((i) => (
              <tr key={i.id} className="border-b border-line/70 last:border-0 hover:bg-slate-50 [&>td]:px-4 [&>td]:py-2.5">
                <td className="text-muted">{i.id}</td>
                <td className="max-w-[420px]"><Link href={`/inventario/${i.id}`} className="block truncate font-medium hover:underline">{i.descricao}</Link>
                  <div className="truncate text-[11px] text-muted">{descreverEscopo(i.escopo ? JSON.parse(i.escopo) : null)}</div></td>
                <td>{fdata(i.snapshot_em)}</td><td>{fdata(i.encerrado_em)}</td>
                <td className="text-right">{(i.leituras?.n ?? 0).toLocaleString("pt-BR")}</td><td className="text-right">{frsK(i.resumo?.valor ?? 0)}</td>
                <td className="text-right"><Link href={`/inventario/${i.id}/relatorio`} target="_blank" className="text-[12px] font-semibold text-brand-700 hover:underline">Relatório</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4">{controles}</div>
    </Card>
  );
}

// ---------- programação ----------
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function Programacao({ itens, todos, recarregar, programar }: { itens: Row[]; todos: Row[]; recarregar: () => void; programar: () => void }) {
  const hoje = hojeIso();
  const [mes, setMes] = useState(() => hoje.slice(0, 7)), [dia, setDia] = useState<string | null>(null);
  const [editar, setEditar] = useState<Row | null>(null), [iniciar, setIniciar] = useState<Row | null>(null);
  const toast = useToast(), { confirmar, dialogo } = useConfirm();

  // calendário: programados (roxo) e realizados (verde) por dia
  const porDia = useMemo(() => {
    const m = new Map<string, { prog: number; feitos: number }>();
    for (const i of itens) { const k = i.data_prevista; const x = m.get(k) || { prog: 0, feitos: 0 }; x.prog++; m.set(k, x); }
    for (const i of todos) if (i.etapa !== "PROGRAMADO" && i.snapshot_em) { const k = i.snapshot_em.slice(0, 10); const x = m.get(k) || { prog: 0, feitos: 0 }; x.feitos++; m.set(k, x); }
    return m;
  }, [itens, todos]);
  const [a, mm] = mes.split("-").map(Number), primeiro = new Date(a, mm - 1, 1), diasMes = new Date(a, mm, 0).getDate();
  const vazios = (primeiro.getDay() + 6) % 7; // semana começando na segunda
  const mover = (n: number) => { const d = new Date(a, mm - 1 + n, 1); setMes(d.toLocaleDateString("sv-SE").slice(0, 7)); setDia(null); };

  const lista = dia ? itens.filter((i) => i.data_prevista === dia) : itens;
  const secoes: [string, Row[], string][] = dia ? [[`Programados para ${fdata(dia)}`, lista, ""]] : [
    ["Atrasados", lista.filter((i) => i.data_prevista < hoje), "text-rose-700"],
    ["Hoje", lista.filter((i) => i.data_prevista === hoje), "text-brand-700"],
    ["Próximos", lista.filter((i) => i.data_prevista > hoje), ""],
  ];

  async function excluir(i: Row) {
    if (!(await confirmar({ titulo: "Excluir esta programação?", texto: `${i.descricao} (${fdata(i.data_prevista)}). Nada foi contado ainda; só a programação é removida.`, acao: "Excluir", perigo: true }))) return;
    try { await api(`inventarios/${i.id}/excluir`, {}); toast("Programação excluída."); recarregar(); } catch (e) { toast((e as Error).message, "erro"); }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      <Card className="self-start p-4">
        <div className="flex items-center justify-between">
          <button onClick={() => mover(-1)} className="grid size-8 place-items-center rounded-lg hover:bg-slate-100"><ChevronLeft className="size-4" /></button>
          <div className="text-[14px] font-semibold capitalize">{MESES[mm - 1]} {a}</div>
          <button onClick={() => mover(1)} className="grid size-8 place-items-center rounded-lg hover:bg-slate-100"><ChevronRight className="size-4" /></button>
        </div>
        <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-muted">{["S", "T", "Q", "Q", "S", "S", "D"].map((d, k) => <div key={k}>{d}</div>)}</div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: vazios }, (_, k) => <div key={"v" + k} />)}
          {Array.from({ length: diasMes }, (_, k) => {
            const iso = `${mes}-${String(k + 1).padStart(2, "0")}`, x = porDia.get(iso), sel = dia === iso;
            return (
              <button key={iso} onClick={() => setDia(sel ? null : iso)} className={cx("flex h-11 flex-col items-center justify-center rounded-lg text-[13px] tabular transition",
                sel ? "bg-ink text-white" : iso === hoje ? "bg-brand-50 font-bold text-brand-800 ring-1 ring-brand-200" : "hover:bg-slate-100")}>
                {k + 1}
                <span className="mt-0.5 flex h-1.5 gap-0.5">
                  {x?.prog ? <span className={cx("size-1.5 rounded-full", iso < hoje ? "bg-rose-500" : "bg-indigo-500")} /> : null}
                  {x?.feitos ? <span className="size-1.5 rounded-full bg-brand-500" /> : null}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-indigo-500" />Programado</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-rose-500" />Vencido</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-brand-500" />Realizado</span>
        </div>
        <Button className="mt-4 w-full" variant="secondary" onClick={programar}><CalendarPlus className="size-4" />Programar inventário</Button>
      </Card>

      <div className="space-y-5">
        {!itens.length && <Card><Vazio icone={<CalendarClock className="size-6" />} titulo="Nenhum inventário programado" texto="Programe inventários por data (inclusive recorrentes: semanal, mensal…) e inicie com um clique no dia.">
          <Button onClick={programar}><CalendarPlus className="size-4" />Programar</Button></Vazio></Card>}
        {dia && <button onClick={() => setDia(null)} className="text-[13px] font-medium text-brand-700 hover:underline">← Ver toda a programação</button>}
        {secoes.filter(([, l]) => l.length || dia).map(([titulo, l, cor]) => (
          <section key={titulo}>
            <h2 className={cx("mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted", cor)}>{titulo} <span className="tabular opacity-70">({l.length})</span></h2>
            {!l.length ? <p className="text-sm text-muted">Nada programado neste dia.</p> : (
              <Card className="divide-y divide-line overflow-hidden">
                {l.map((i) => <LinhaProgramada key={i.id} i={i} hoje={hoje} iniciar={() => setIniciar(i)} editar={() => setEditar(i)} excluir={() => excluir(i)} />)}
              </Card>
            )}
          </section>
        ))}
      </div>
      {editar && <EditarProgramacao inv={editar} fechar={() => setEditar(null)} salvo={() => { setEditar(null); recarregar(); }} />}
      {iniciar && <IniciarProgramado inv={iniciar} fechar={() => setIniciar(null)} />}
      {dialogo}
    </div>
  );
}

function LinhaProgramada({ i, hoje, iniciar, editar, excluir }: { i: Row; hoje: string; iniciar: () => void; editar: () => void; excluir: () => void }) {
  const d = i.data_prevista as string, atrasado = d < hoje;
  return (
    <div className="flex flex-wrap items-center gap-4 px-4 py-3">
      <div className={cx("grid w-14 shrink-0 place-items-center rounded-xl py-1.5 text-center leading-tight", atrasado ? "bg-rose-50 text-rose-700" : d === hoje ? "bg-brand-50 text-brand-800" : "bg-indigo-50 text-indigo-800")}>
        <span className="text-[18px] font-bold tabular">{d.slice(8, 10)}</span><span className="text-[11px] font-semibold uppercase">{MESES[Number(d.slice(5, 7)) - 1].slice(0, 3)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="truncate font-semibold">{i.descricao}</span>{atrasado && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700"><TriangleAlert className="size-3" />vencido</span>}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-4 text-[12px] text-muted">
          <span className="truncate">{descreverEscopo(i.escopo ? JSON.parse(i.escopo) : null)}</span>
          <span>Começa em: <b className="text-ink">{NOME_ETAPA[i.etapa_inicial || "CONTAGEM"]}</b></span>
          {i.responsavel && <span>Responsável: <b className="text-ink">{i.responsavel}</b></span>}
          {(i.antecipar ?? 1) === 0 && <span className="font-semibold text-amber-700">Só na data</span>}
          {i.obs && <span className="truncate italic">{i.obs}</span>}
        </div>
      </div>
      <div className="flex gap-1.5">
        <Button size="sm" variant="ghost" onClick={editar} title="Editar"><Pencil className="size-3.5" /></Button>
        <Button size="sm" variant="ghost" onClick={excluir} title="Excluir"><Trash2 className="size-3.5" /></Button>
        <Button size="sm" onClick={iniciar}><Play className="size-3.5" />Iniciar</Button>
      </div>
    </div>
  );
}

function IniciarProgramado({ inv, fechar }: { inv: Row; fechar: () => void }) {
  const router = useRouter(), toast = useToast();
  const [etapa, setEtapa] = useState<string>(inv.etapa_inicial || "CONTAGEM"), [data, setData] = useState(hojeIso()), [ocupado, setOcupado] = useState(false);
  async function ir() {
    setOcupado(true);
    try { await api(`inventarios/${inv.id}/iniciar`, { etapa, dataSaldo: data }); toast("Inventário iniciado: saldos congelados."); router.push(`/inventario/${inv.id}`); }
    catch (e) { toast((e as Error).message, "erro"); setOcupado(false); }
  }
  return (
    <Modal aberto onClose={fechar} titulo={`Iniciar “${inv.descricao}”?`} descricao="O saldo do ERP é lido e congelado agora, e os coletores passam a ver este inventário."
      rodape={<><Button variant="secondary" onClick={fechar}>Voltar</Button><Button onClick={ir} loading={ocupado}><Play className="size-4" />Iniciar agora</Button></>}>
      <div className="space-y-4">
        <EtapaInicial valor={etapa} mudar={setEtapa} />
        <Field label="Saldo na data" hint="Normalmente hoje."><input type="date" className={inputCls} value={data} onChange={(e) => setData(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function EtapaInicial({ valor, mudar }: { valor: string; mudar: (v: string) => void }) {
  const dica: Record<string, string> = {
    CONTAGEM: "Fluxo completo: contagem cega, recontagem e auditoria.",
    RECONTAGEM: "Pula a contagem: todos os itens com saldo vão direto para a lista de recontagem.",
    AUDITORIA: "Pula contagem e recontagem: o auditor confere item a item e define a quantidade final.",
  };
  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-medium">Começar pela etapa</span>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
        {ETAPAS_INI.map(([k, n]) => (
          <button type="button" key={k} onClick={() => mudar(k)} className={cx("h-9 rounded-md text-[13px] font-medium transition", valor === k ? "bg-white shadow-sm" : "text-muted hover:text-ink")}>{n}</button>
        ))}
      </div>
      <span className="mt-1 block text-[12px] text-muted">{dica[valor]}</span>
    </div>
  );
}

export function useUsuariosLieto() {
  const [u, setU] = useState<Row[]>([]);
  useEffect(() => { api<Row[]>("erp/usuarios").then(setU).catch(() => {}); }, []);
  return u;
}

function EditarProgramacao({ inv, fechar, salvo }: { inv: Row; fechar: () => void; salvo: () => void }) {
  const toast = useToast(), usuarios = useUsuariosLieto();
  const [f, setF] = useState({ descricao: inv.descricao, dataPrevista: inv.data_prevista, responsavel: inv.responsavel || "", etapa: inv.etapa_inicial || "CONTAGEM", obs: inv.obs || "", antecipar: (inv.antecipar ?? 1) === 1 });
  const [ocupado, setOcupado] = useState(false);
  async function salvar() {
    setOcupado(true);
    try { await api(`inventarios/${inv.id}/programacao`, f); toast("Programação atualizada."); salvo(); } catch (e) { toast((e as Error).message, "erro"); setOcupado(false); }
  }
  return (
    <Modal aberto onClose={fechar} titulo="Editar programação" largura="max-w-xl"
      rodape={<><Button variant="secondary" onClick={fechar}>Cancelar</Button><Button onClick={salvar} loading={ocupado}>Salvar</Button></>}>
      <div className="space-y-4">
        <Field label="Nome"><input className={inputCls} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data prevista"><input type="date" className={inputCls} value={f.dataPrevista} onChange={(e) => setF({ ...f, dataPrevista: e.target.value })} /></Field>
          <Field label="Responsável"><SelResponsavel usuarios={usuarios} valor={f.responsavel} mudar={(v) => setF({ ...f, responsavel: v })} /></Field>
        </div>
        <EtapaInicial valor={f.etapa} mudar={(v) => setF({ ...f, etapa: v })} />
        <Field label="Observação"><input className={inputCls} value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} placeholder="Ex.: parar expedição às 16h" /></Field>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.antecipar} onChange={(e) => setF({ ...f, antecipar: e.target.checked })} /><span><b>Pode antecipar no coletor</b><span className="block text-[12px] text-muted">Desligado, o coletor mostra o inventário mas só deixa começar na data prevista.</span></span></label>
        <p className="flex items-center gap-2 text-[12px] text-muted"><Clock className="size-3.5" />Os itens (escopo) são definidos na programação e lidos do ERP ao iniciar.</p>
      </div>
    </Modal>
  );
}

export function SelResponsavel({ usuarios, valor, mudar }: { usuarios: Row[]; valor: string; mudar: (v: string) => void }) {
  return (
    <select className={inputCls} value={valor} onChange={(e) => mudar(e.target.value)}>
      <option value="">—</option>
      {valor && !usuarios.some((u) => u.nome === valor) && <option value={valor}>{valor}</option>}
      {usuarios.map((u) => <option key={u.codfun} value={u.nome}>{u.nome}{u.nomfun && u.nomfun.toUpperCase() !== u.nome ? ` · ${u.nomfun}` : ""}</option>)}
    </select>
  );
}
