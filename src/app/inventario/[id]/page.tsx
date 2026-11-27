"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Ban, Boxes, Check, ChevronRight, CircleAlert, ClipboardCheck, Download, FileText, History, ListChecks, MapPin,
  Printer, ScanBarcode, Search, Send, ShieldCheck, TrendingDown, TrendingUp, TriangleAlert, Undo2, Users,
} from "lucide-react";
import { Observacao } from "@/components/observacao";
import { Topo, useResponsavel } from "@/components/topo";
import { DESC, PlanilhaAuditoria, semLeitura, useDesconsiderar } from "@/components/planilha-auditoria";
import { descreverEscopo } from "@/lib/escopo";
import { Badge, Button, Card, Carregando, Gaveta, Modal, Stat, Stepper, Vazio, cx, inputCls, useConfirm, usePaginacao, useToast } from "@/components/ui";
import { ApiErro, NOME_DECISAO, NOME_ETAPA, NUM_ETAPA, api, baixarCsv, fdata, fpct, fq, frs, frsK, indicadores, type Row } from "@/lib/client";

type Dados = { inv: Row; regras: Row; itens: Row[]; operadores: Row[]; lancamentos: Row[]; totalItens: number };
const ABAS = [
  { k: "itens", n: "Itens", i: Boxes }, { k: "auditoria", n: "Auditoria", i: ShieldCheck }, { k: "ajustes", n: "Ajustes", i: Send },
  { k: "parecer", n: "Parecer", i: FileText }, { k: "equipe", n: "Equipe", i: Users }, { k: "historico", n: "Histórico", i: History },
] as const;

export default function Painel() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<string>("itens");
  const [item, setItem] = useState<string | null>(null);
  const carregar = useCallback(() => api<Dados>(`inventarios/${id}`).then(setD).catch((e) => setErro(e.message)), [id]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { // atualização automática enquanto há contagem acontecendo
    if (!d || !NUM_ETAPA[d.inv.etapa]) return;
    const t = setInterval(() => { if (!document.hidden) carregar(); }, 10000);
    return () => clearInterval(t);
  }, [d, carregar]);
  const ind = useMemo(() => (d ? indicadores(d.itens) : null), [d]);

  if (erro) return <><Topo /><div className="mx-auto max-w-xl p-10"><Card><Vazio icone={<CircleAlert className="size-6" />} titulo="Não foi possível abrir" texto={erro} /></Card></div></>;
  if (!d || !ind) return <><Topo /><Carregando pagina /></>;
  const { inv } = d, { t } = ind;
  if (inv.etapa === "PROGRAMADO") return <><Topo /><Programado inv={inv} /></>;

  return (
    <>
      <Topo>
        <nav className="hidden items-center gap-1.5 text-[13px] text-muted sm:flex">
          <ChevronRight className="size-4 text-slate-300" />
          <Link href="/inventario" className="hover:text-ink">Inventários</Link>
          <ChevronRight className="size-4 text-slate-300" />
          <span className="truncate font-medium text-ink">#{inv.id} {inv.descricao}</span>
        </nav>
      </Topo>
      <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{inv.descricao}</h1><Badge v={inv.etapa} /></div>
            <p className="mt-1 text-sm text-muted">
              {inv.origem === "ERP" ? `${inv.nomemp || "Empresa " + inv.codemp} · saldo em ${fdata(inv.data_saldo)}` : "Saldos importados de CSV"} · congelado em {fdata(inv.snapshot_em)} por {inv.criado_por}
            </p>
            {inv.origem_inv && <p className="mt-1 text-[13px]"><Link href={`/inventario/${inv.origem_inv}`} className="font-medium text-brand-700 hover:underline">← Recontagem dos itens enviados pela auditoria do inventário #{inv.origem_inv}</Link></p>}
            <p className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-[12px] font-medium text-slate-700">
              <ListChecks className="size-3.5 shrink-0" /><span className="truncate">{descreverEscopo(inv.escopo ? JSON.parse(inv.escopo) : null)} · {d.totalItens.toLocaleString("pt-BR")} itens na lista · {t.comSaldo.toLocaleString("pt-BR")} com saldo</span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex flex-wrap justify-end gap-2">
              <Exportar d={d} />
              <Link href={`/inventario/${inv.id}/relatorio`} target="_blank"><Button variant="secondary"><Printer className="size-4" />Relatório</Button></Link>
              <CancelarInventario d={d} recarregar={carregar} />
            </div>
            {inv.etapa === "LANCAMENTO" && inv.lancado_em && <p className="max-w-md text-right text-[12px] text-rose-700">Não dá para cancelar: os ajustes já foram {inv.lancado_modo === "ERP" ? "gravados na MESTOQUE" : "lançados no ERP"} em {fdata(inv.lancado_em)}. Para desfazer, estorne no Lieto.</p>}
          </div>
        </div>

        {/* Cancelado: sai a linha de etapas e entra a faixa com quem, quando e por quê. O resto fica para consulta. */}
        {inv.etapa === "CANCELADO" ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-100 p-5 text-sm">
            <b>Cancelado em {fdata(inv.encerrado_em)} por {inv.encerrado_por}.</b> Motivo: {inv.motivo_cancel}
            <div className="mt-1 text-muted">Estava {inv.etapa_cancel === "LANCAMENTO" ? "no lançamento" : `na ${(NOME_ETAPA[inv.etapa_cancel] || "").toLowerCase()}`}. {((n) => `${n.toLocaleString("pt-BR")} ${n === 1 ? "leitura fica" : "leituras ficam"}`)(d.operadores.reduce((s: number, o: Row) => s + o.n, 0))} aqui para consulta. Nada foi gravado no Lieto.</div>
          </div>
        ) : <>
          <Stepper etapa={inv.etapa} inicio={inv.etapa_inicial} />
          <ProximoPasso d={d} t={t} recarregar={carregar} irPara={setAba} />
        </>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat icon={<ScanBarcode className="size-3.5" />} label="Itens contados" value={<>{t.contados.toLocaleString("pt-BR")}<span className="text-base font-normal text-muted"> / {t.comSaldo.toLocaleString("pt-BR")}</span></>}
            hint={t.faltaContar ? `${t.faltaContar.toLocaleString("pt-BR")} com saldo ainda não contados` : "Todos os itens com saldo foram contados"} />
          <Stat icon={<ClipboardCheck className="size-3.5" />} label="Acuracidade" value={fpct(t.acur)} hint={`${t.comDif.toLocaleString("pt-BR")} itens com diferença`} tone={t.acur >= 95 ? "pos" : t.acur >= 85 ? "warn" : "neg"} />
          <Stat icon={<Boxes className="size-3.5" />} label="Estoque no sistema" value={frsK(t.vSis)} hint={`Apurado: ${frsK(t.vCont)}`} />
          <Stat icon={t.liq < 0 ? <TrendingDown className="size-3.5" /> : <TrendingUp className="size-3.5" />} label="Diferença líquida" value={frsK(t.liq)} tone={t.liq < 0 ? "neg" : t.liq > 0 ? "pos" : undefined}
            hint={<><span className="text-brand-700">+{frsK(t.sobra)}</span> · <span className="text-rose-700">{frsK(t.falta)}</span></>} />
          <Stat icon={<ShieldCheck className="size-3.5" />} label="Recontagem · Auditoria" value={`${t.recontar} · ${t.auditar}`} hint={`${t.auditados} decididos pela auditoria`} tone={t.auditar ? "warn" : undefined} />
        </div>

        <Card>
          <div className="scroll-fino flex gap-1 overflow-x-auto border-b border-line px-3 pt-2">
            {ABAS.filter((a) => inv.etapa !== "CANCELADO" || !["ajustes", "parecer"].includes(a.k)).map(({ k, n, i: Ic }) => {
              const cont = k === "auditoria" ? t.auditar : 0;
              return (
                <button key={k} onClick={() => setAba(k)} className={cx("relative inline-flex h-10 items-center gap-2 px-3 text-[13px] font-medium transition",
                  aba === k ? "text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-600" : "text-muted hover:text-ink")}>
                  <Ic className="size-4" />{n}{cont > 0 && <span className="rounded-full bg-rose-600 px-1.5 text-[11px] font-semibold text-white">{cont}</span>}
                </button>
              );
            })}
          </div>
          <div className="p-4 sm:p-5">
            {aba === "itens" && <AbaItens inv={d.inv} it={ind.it} abrir={setItem} recarregar={carregar} />}
            {aba === "auditoria" && <PlanilhaAuditoria inv={d.inv} it={ind.it} recarregar={carregar} abrir={setItem} />}
            {aba === "ajustes" && <AbaAjustes d={d} recarregar={carregar} />}
            {aba === "parecer" && <AbaParecer d={d} t={t} recarregar={carregar} />}
            {aba === "equipe" && <AbaEquipe d={d} />}
            {aba === "historico" && <AbaHistorico id={inv.id} />}
          </div>
        </Card>
      </main>
      <DetalheItem invId={inv.id} etapa={inv.etapa} codpro={item} fechar={() => setItem(null)} recarregar={carregar} />
    </>
  );
}

// ---------- próximo passo ----------
function ProximoPasso({ d, t, recarregar, irPara }: { d: Dados; t: Row; recarregar: () => void; irPara: (a: string) => void }) {
  const { inv } = d, toast = useToast(), [usuario] = useResponsavel(), { confirmar, dialogo } = useConfirm();
  const [ocupado, setOcupado] = useState(false);
  const pendRec = d.itens.filter((i) => i.situacao === "RECONTAR" && !i.l[2]).length;

  async function avancar() {
    const textos: Record<string, [string, React.ReactNode]> = {
      CONTAGEM: ["Encerrar a contagem?", `Itens fora da tolerância vão para a recontagem${t.faltaContar ? `, inclusive os ${t.faltaContar} itens com saldo que ninguém contou` : ""}. Os coletores deixam de aceitar leituras de contagem.`],
      RECONTAGEM: ["Encerrar a recontagem?", "Itens em que a recontagem não bater nem com a contagem nem com o sistema vão para a auditoria."],
      AUDITORIA: ["Encerrar a auditoria?", <>As quantidades finais ficam fixadas e o inventário segue para o lançamento. <b>Acertar</b> ajusta o estoque; <b>Manter</b> deixa o saldo do sistema.
        {t.reenviados > 0 && <> <b>{t.reenviados} item(ns) com decisão “Recontagem”</b> abrem um novo inventário “Recontagem - #{inv.id}”, já na etapa de recontagem.</>}</>],
    };
    const [titulo, texto] = textos[inv.etapa];
    if (!(await confirmar({ titulo, texto, acao: "Encerrar etapa" }))) return;
    setOcupado(true);
    try {
      let r: Row;
      try { r = await api(`inventarios/${inv.id}/avancar`, { usuario, etapa: inv.etapa }); }
      catch (e) {
        if (!(e instanceof ApiErro) || e.status !== 409) throw e;
        if (!(await confirmar({ titulo: "Há itens sem recontagem", texto: e.message, acao: "Enviar para auditoria" }))) return;
        r = await api(`inventarios/${inv.id}/avancar`, { usuario, forcar: true, etapa: inv.etapa });
      }
      toast(`Etapa encerrada. Agora: ${NOME_ETAPA[r.etapa]}.` + (r.novoInventario ? ` ${r.reenviados} item(ns) foram para o inventário de recontagem #${r.novoInventario}.` : ""));
      if (r.etapa === "AUDITORIA") irPara("auditoria");
      if (r.etapa === "LANCAMENTO") irPara("ajustes");
      recarregar();
    } catch (e) { toast((e as Error).message, "erro"); } finally { setOcupado(false); }
  }

  const cfg: Record<string, { titulo: string; texto: React.ReactNode; acao?: React.ReactNode }> = {
    CONTAGEM: {
      titulo: "Contagem em andamento",
      texto: <>Os operadores bipam pelo coletor, por local. A contagem é cega. <b className="text-ink">{fpct(t.comSaldo ? (100 * (t.comSaldo - t.faltaContar)) / t.comSaldo : 0)}</b> dos itens com saldo já foram contados.</>,
      acao: <Button onClick={avancar} loading={ocupado}>Encerrar contagem <ArrowRight className="size-4" /></Button>,
    },
    RECONTAGEM: {
      titulo: `Recontagem de ${t.recontar} ${t.recontar === 1 ? "item" : "itens"}`,
      texto: <>Só os itens divergentes, feita por <b className="text-ink">outra pessoa</b>. {pendRec ? `${pendRec} ainda sem recontagem.` : "Todos já recontados."} O coletor mostra a lista do que falta.</>,
      acao: <Button onClick={avancar} loading={ocupado}>Encerrar recontagem <ArrowRight className="size-4" /></Button>,
    },
    AUDITORIA: {
      titulo: t.auditar ? `${t.auditar} ${t.auditar === 1 ? "item aguarda" : "itens aguardam"} decisão da auditoria` : "Auditoria concluída",
      texto: "Para cada item, decida: Acertar (ajusta para o final), Manter (sem ajuste) ou Recontagem (vai para um novo inventário). O auditor também confere pelo coletor: a contagem dele vira o final.",
      acao: t.auditar ? <Button onClick={() => irPara("auditoria")}>Auditar itens <ArrowRight className="size-4" /></Button>
        : <Button onClick={avancar} loading={ocupado}>Encerrar auditoria <ArrowRight className="size-4" /></Button>,
    },
    LANCAMENTO: {
      titulo: "Lançamento e parecer",
      texto: (
        <span className="flex flex-wrap gap-x-5 gap-y-1">
          <Checagem ok={!!inv.lancado_em}>Ajustes lançados no ERP</Checagem>
          <Checagem ok={!!String(inv.parecer || "").trim()}>Parecer escrito</Checagem>
        </span>
      ),
      acao: !inv.lancado_em ? <Button onClick={() => irPara("ajustes")}>Ver ajustes <ArrowRight className="size-4" /></Button>
        : <Button onClick={() => irPara("parecer")}>{inv.parecer ? "Revisar e encerrar" : "Escrever parecer"} <ArrowRight className="size-4" /></Button>,
    },
    ENCERRADO: {
      titulo: "Inventário encerrado",
      texto: `Encerrado em ${fdata(inv.encerrado_em)} por ${inv.encerrado_por}. Ajustes ${inv.lancado_modo === "ERP" ? "gravados na MESTOQUE" : "lançados manualmente"} em ${fdata(inv.lancado_em)}.`,
      acao: <Link href={`/inventario/${inv.id}/relatorio`} target="_blank"><Button variant="secondary"><Printer className="size-4" />Relatório final</Button></Link>,
    },
  };
  const c = cfg[inv.etapa];
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-brand-200 bg-brand-50/60 p-5 sm:flex-row sm:items-center">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-700 text-white"><ListChecks className="size-5" /></div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{c.titulo}</div>
        <div className="mt-0.5 text-sm text-muted">{c.texto}</div>
      </div>
      {c.acao}
      {dialogo}
    </div>
  );
}
const Checagem = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <span className={cx("inline-flex items-center gap-1.5", ok ? "text-brand-700" : "text-muted")}>
    <span className={cx("grid size-4 place-items-center rounded-full", ok ? "bg-brand-600 text-white" : "border border-slate-300")}>{ok && <Check className="size-3" strokeWidth={3} />}</span>{children}
  </span>
);

// ---------- itens ----------
const FILTROS = [["", "Todos"], ["dif", "Com diferença"], ["nao", "Não contados"], ["RECONTAR", "Recontar"], ["AUDITAR", "Auditar"], ["AUDITADO", "Auditados"], [DESC, "Desconsiderados"]] as const;
const naoContado = (i: Row) => !i.l[1] && i.saldo !== 0 && i.situacao !== DESC;
function AbaItens({ inv, it, abrir, recarregar }: { inv: Row; it: Row[]; abrir: (c: string) => void; recarregar: () => Promise<unknown> }) {
  const [busca, setBusca] = useState(""), [filtro, setFiltro] = useState("");
  const { executar: desconsiderar, dialogo } = useDesconsiderar(inv.id, recarregar);
  const lista = useMemo(() => {
    const b = busca.trim().toUpperCase();
    return it.filter((i) => (!b || i.codpro.toUpperCase().includes(b) || i.nompro.toUpperCase().includes(b) || (i.codbar || "").includes(b)) &&
      (!filtro || (filtro === "dif" ? i.dif !== 0 : filtro === "nao" ? naoContado(i) : i.situacao === filtro)))
      .sort((a, c) => Math.abs(c.valor) - Math.abs(a.valor) || a.nompro.localeCompare(c.nompro));
  }, [it, busca, filtro]);
  const conta = (k: string) => it.filter((i) => (k === "dif" ? i.dif !== 0 : k === "nao" ? naoContado(i) : !k || i.situacao === k)).length;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
          <input className={cx(inputCls, "pl-9")} placeholder="Buscar por código, nome ou código de barras" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTROS.map(([k, n]) => (
            <button key={k} onClick={() => setFiltro(k)} className={cx("h-8 rounded-full px-3 text-[12px] font-medium transition",
              filtro === k ? "bg-ink text-white" : "bg-slate-100 text-muted hover:text-ink")}>{n} <span className="tabular opacity-60">{conta(k)}</span></button>
          ))}
        </div>
      </div>
      {!!NUM_ETAPA[inv.etapa] && (filtro === "nao" || filtro === DESC) && lista.length > 0 && (() => {
        const alvo = filtro === DESC ? lista : lista.filter(semLeitura);
        return alvo.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-slate-100 px-4 py-2.5 text-[13px]">
            <span className="flex-1">{filtro === DESC
              ? <>Itens desconsiderados não geram ajuste e ficam fora da acuracidade.</>
              : <><b>{alvo.length}</b> {alvo.length === 1 ? "item com saldo não foi contado" : "itens com saldo não foram contados"} por ninguém. Se não fazem parte deste inventário, desconsidere-os: o saldo do ERP fica como está.</>}</span>
            <Button size="sm" variant="secondary" onClick={() => desconsiderar(alvo.map((i) => i.codpro), filtro === DESC)}>{filtro === DESC ? `Reconsiderar os ${alvo.length}` : `Desconsiderar os ${alvo.length}`}</Button>
          </div>
        );
      })()}
      {dialogo}
      {!lista.length ? <Vazio icone={<Search className="size-5" />} titulo="Nada encontrado" /> : <TabelaItens lista={lista} abrir={abrir} chave={busca + filtro} />}
    </>
  );
}

function TabelaItens({ lista, abrir, chave }: { lista: Row[]; abrir: (c: string) => void; chave: string }) {
  const { itens: pag, controles } = usePaginacao(lista, 50, chave);
  return (
    <>
    <div className="scroll-fino overflow-auto rounded-xl border border-line">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
          <tr className="[&>th]:border-b [&>th]:border-line [&>th]:px-3 [&>th]:py-2.5">
            <th>Código</th><th>Produto</th><th>Un</th><th>Local</th><th className="text-right">Sistema</th><th className="text-right">Contagem</th><th className="text-right">Recont.</th>
            <th className="text-right">Auditor</th><th className="text-right">Final</th><th className="text-right">Diferença</th><th className="text-right">Valor</th><th>Situação</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {pag.map((i) => (
            <tr key={i.codpro} onClick={() => abrir(i.codpro)} className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-brand-50/40 [&>td]:px-3 [&>td]:py-2">
              <td>{i.codpro}</td><td className="font-medium">{i.nompro}</td><td>{i.unipro}</td><td>{i.l[1]?.locais || "—"}</td>
              <td className="text-right text-muted">{fq(i.saldo)}</td>
              <td className="text-right">{fq(i.c1)}</td>
              <td className="text-right">{fq(i.c2)}</td>
              <td className="text-right">{fq(i.c3)}</td>
              <td className="text-right font-semibold">{fq(i.final)}</td>
              <td className={cx("text-right font-medium", i.dif > 0 && "text-brand-700", i.dif < 0 && "text-rose-700")}>{i.dif > 0 ? "+" : ""}{fq(i.dif)}</td>
              <td className={cx("text-right", i.valor > 0 && "text-brand-700", i.valor < 0 && "text-rose-700")}>{i.valor ? frs(i.valor) : "—"}</td>
              <td>{i.situacao && <Badge v={i.situacao} />}{i.situacao === "AUDITADO" && i.decisao && i.decisao !== "ACERTAR" && <span className="ml-1 text-[11px] font-medium text-muted">· {NOME_DECISAO[i.decisao]}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {controles}
    </>
  );
}

// ---------- ajustes ----------
function AbaAjustes({ d, recarregar }: { d: Dados; recarregar: () => void }) {
  const { inv } = d, toast = useToast(), [usuario] = useResponsavel(), { confirmar, dialogo } = useConfirm();
  const [r, setR] = useState<Row | null>(null), [erro, setErro] = useState(""), [enviando, setEnviando] = useState(""), [obs, setObs] = useState("");
  const pronto = ["LANCAMENTO", "ENCERRADO"].includes(inv.etapa);
  useEffect(() => { if (pronto && !inv.lancado_em) api(`inventarios/${inv.id}/ajustes`).then(setR).catch((e) => setErro(e.message)); }, [pronto, inv.id, inv.lancado_em]);

  if (!pronto) return <Vazio icone={<Send className="size-6" />} titulo="Ainda não é hora" texto="Os ajustes ficam disponíveis depois de encerradas contagem, recontagem e auditoria." />;
  if (inv.lancado_em) return <AjustesLancados d={d} />;
  if (erro) return <p className="text-sm text-rose-700">{erro}</p>;
  if (!r) return <Carregando />;

  const efet = (r.ajustes as Row[]).filter((a) => a.ajuste !== 0), mov = (r.ajustes as Row[]).filter((a) => a.movimentou);
  const sobra = efet.filter((a) => a.valor > 0).reduce((s, a) => s + a.valor, 0), falta = efet.filter((a) => a.valor < 0).reduce((s, a) => s + a.valor, 0);

  async function lancar(modo: "ERP" | "MANUAL") {
    const ok = await confirmar(modo === "ERP"
      ? { titulo: "Gravar ajustes na MESTOQUE?", perigo: true, palavra: "CONFIRMAR", acao: "Gravar no ERP",
          texto: `Serão gravados ${efet.length} movimentos (entradas e saídas) na empresa ${inv.codemp}, numa única transação. Isso altera o estoque oficial do ERP.` }
      : { titulo: "Registrar lançamento manual?", palavra: "CONFIRMAR", acao: "Registrar", texto: `Confirma que os ${efet.length} ajustes já foram lançados no ERP por outro meio?` });
    if (!ok) return;
    setEnviando(modo);
    try { const x = await api(`inventarios/${inv.id}/lancar`, { modo, obs, confirmacao: "CONFIRMAR", usuario }); toast(`${x.itens} ajustes registrados.`); recarregar(); }
    catch (e) { toast((e as Error).message, "erro"); } finally { setEnviando(""); }
  }

  return (
    <div className="space-y-4">
      {r.aviso && <Aviso>{r.aviso}</Aviso>}
      {mov.length > 0 && <Aviso><b>{mov.length} produtos movimentaram no ERP depois do congelamento</b> (coluna “Atual ERP” diferente de “Congelado”). O ajuste continua calculado sobre o saldo congelado. Confira esses itens se a operação não parou durante a contagem.</Aviso>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Itens a ajustar" value={efet.length} />
        <Stat label="Sobras (entradas)" value={frsK(sobra)} tone="pos" />
        <Stat label="Faltas (saídas)" value={frsK(falta)} tone="neg" />
        <Stat label="Líquido" value={frsK(sobra + falta)} tone={sobra + falta < 0 ? "neg" : "pos"} />
      </div>
      <Observacao valor={obs} mudar={setObs} cabe={35} />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => lancar("ERP")} loading={enviando === "ERP"} disabled={!r.podeGravarErp || !efet.length} title={!r.podeGravarErp ? "Inventário de CSV não tem empresa do ERP" : ""}><Send className="size-4" />Gravar na MESTOQUE</Button>
        <Button variant="secondary" onClick={() => lancar("MANUAL")} loading={enviando === "MANUAL"}><Check className="size-4" />Já lancei no ERP</Button>
        <Button variant="ghost" onClick={() => baixarCsv(`ajustes_inv${inv.id}.csv`, ["Código", "Produto", "Un", "Congelado", "Final", "Ajuste", "E/S", "Custo", "Valor", "Atual ERP", "Justificativa"],
          efet.map((a) => [a.codpro, a.nompro, a.unipro, a.saldo, a.final, a.ajuste, a.ajuste > 0 ? "E" : "S", a.precus, a.valor, a.atual, a.justificativa]))}><Download className="size-4" />Exportar CSV</Button>
      </div>
      <TabelaAjustes lista={r.ajustes as Row[]} />
      {dialogo}
    </div>
  );
}
function TabelaAjustes({ lista }: { lista: Row[] }) {
  const { itens: pag, controles } = usePaginacao(lista, 50);
  return (
    <div>
      <div className="scroll-fino overflow-auto rounded-xl border border-line">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <tr className="[&>th]:border-b [&>th]:border-line [&>th]:px-3 [&>th]:py-2.5"><th>Código</th><th>Produto</th><th>Un</th><th className="text-right">Congelado</th><th className="text-right">Final</th><th className="text-right">Ajuste</th><th className="text-right">Custo</th><th className="text-right">Valor</th><th className="text-right">Atual ERP</th><th>Justificativa</th></tr>
          </thead>
          <tbody className="tabular">
            {pag.map((a) => (
              <tr key={a.codpro} className="border-b border-line/70 last:border-0 [&>td]:px-3 [&>td]:py-2">
                <td>{a.codpro}</td><td className="font-medium">{a.nompro}</td><td>{a.unipro}</td>
                <td className="text-right text-muted">{fq(a.saldo)}</td><td className="text-right font-semibold">{fq(a.final)}</td>
                <td className={cx("text-right font-semibold", a.ajuste > 0 ? "text-brand-700" : a.ajuste < 0 ? "text-rose-700" : "text-muted")}>{a.ajuste > 0 ? "+" : ""}{fq(a.ajuste)}</td>
                <td className="text-right text-muted">{frs(a.precus)}</td>
                <td className={cx("text-right", a.valor > 0 ? "text-brand-700" : a.valor < 0 ? "text-rose-700" : "")}>{frs(a.valor)}</td>
                <td className={cx("text-right", a.movimentou && "font-semibold text-amber-700")}>{fq(a.atual)}</td>
                <td className="text-[12px] text-muted">{a.justificativa}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {controles}
    </div>
  );
}
function AjustesLancados({ d }: { d: Dados }) {
  const { inv, lancamentos: l } = d, nomes = new Map(d.itens.map((i) => [i.codpro, i]));
  const tot = l.reduce((a, x) => a + x.valor, 0);
  const { itens: pag, controles } = usePaginacao(l, 50);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl bg-brand-50 px-4 py-3 text-sm ring-1 ring-brand-200">
        <Check className="size-5 text-brand-700" />
        <span>{l.length} ajustes {inv.lancado_modo === "ERP" ? "gravados na MESTOQUE" : "registrados como lançados manualmente"} em {fdata(inv.lancado_em)} por {inv.lancado_por}. Líquido <b>{frs(tot)}</b>.</span>
      </div>
      {inv.obs_lanc && <p className="whitespace-pre-wrap text-sm"><b>Observação</b><br />{inv.obs_lanc}</p>}
      <div className="scroll-fino overflow-auto rounded-xl border border-line">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <tr className="[&>th]:border-b [&>th]:border-line [&>th]:px-3 [&>th]:py-2.5"><th>Código</th><th>Produto</th><th className="text-right">Congelado</th><th className="text-right">Final</th><th className="text-right">Ajuste</th><th>E/S</th><th className="text-right">Valor</th><th className="text-right">CODIDE</th></tr>
          </thead>
          <tbody className="tabular">
            {pag.map((x) => (
              <tr key={x.id} className="border-b border-line/70 last:border-0 [&>td]:px-3 [&>td]:py-2">
                <td>{x.codpro}</td><td className="font-medium">{nomes.get(x.codpro)?.nompro}</td>
                <td className="text-right text-muted">{fq(x.saldo)}</td><td className="text-right">{fq(x.final)}</td>
                <td className={cx("text-right font-semibold", x.ajuste > 0 ? "text-brand-700" : "text-rose-700")}>{x.ajuste > 0 ? "+" : ""}{fq(x.ajuste)}</td>
                <td>{x.entsai}</td><td className="text-right">{frs(x.valor)}</td><td className="text-right text-muted">{x.codide ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {controles}
    </div>
  );
}
const Aviso = ({ children }: { children: React.ReactNode }) => (
  <div className="flex gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950 ring-1 ring-amber-200"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" /><div>{children}</div></div>
);

// ---------- parecer ----------
function AbaParecer({ d, t, recarregar }: { d: Dados; t: Row; recarregar: () => void }) {
  const { inv } = d, toast = useToast(), [usuario] = useResponsavel(), { confirmar, dialogo } = useConfirm();
  const [txt, setTxt] = useState(inv.parecer || ""), [salvando, setSalvando] = useState(false);
  const fechado = inv.etapa === "ENCERRADO", sujo = txt !== (inv.parecer || "");
  const salvar = async () => {
    setSalvando(true);
    try { await api(`inventarios/${inv.id}/parecer`, { texto: txt, usuario }); toast("Parecer salvo."); recarregar(); }
    catch (e) { toast((e as Error).message, "erro"); } finally { setSalvando(false); }
  };
  const modelo = () => setTxt(
    `RESUMO\nInventário #${inv.id} — ${inv.descricao}. Saldos congelados em ${fdata(inv.snapshot_em)}${inv.nomemp ? ` (${inv.nomemp})` : ""}.\n` +
    `Itens no escopo: ${t.escopo} (${t.comSaldo} com saldo no sistema). Acuracidade: ${fpct(t.acur)} dos itens sem diferença.\n` +
    `Estoque no sistema: ${frs(t.vSis)}. Estoque apurado: ${frs(t.vCont)}.\n` +
    `Sobras: ${frs(t.sobra)} · Faltas: ${frs(t.falta)} · Líquido: ${frs(t.liq)} (${t.vSis ? fpct((100 * t.liq) / t.vSis) : "0%"} do estoque).\n` +
    `Recontados: ${d.itens.filter((i) => i.c2 != null).length} · Auditados: ${t.auditados}.\n\nPRINCIPAIS CAUSAS DAS DIVERGÊNCIAS\n\n\nPARECER\n\n\nRECOMENDAÇÕES\n\n${txt}`);
  const encerrar = async () => {
    if (!(await confirmar({ titulo: "Encerrar o inventário?", texto: "Depois de encerrado, nada mais pode ser alterado. O relatório final fica disponível para impressão.", acao: "Encerrar inventário", perigo: true }))) return;
    try { if (sujo) await api(`inventarios/${inv.id}/parecer`, { texto: txt, usuario }); await api(`inventarios/${inv.id}/encerrar`, { usuario }); toast("Inventário encerrado."); recarregar(); }
    catch (e) { toast((e as Error).message, "erro"); }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
      <div>
        <textarea disabled={fechado} value={txt} onChange={(e) => setTxt(e.target.value)} rows={18}
          placeholder="Escopo e método, equipes, principais causas das divergências, itens críticos, recomendações de controle…"
          className="w-full rounded-xl border border-line bg-white p-4 text-[14px] leading-relaxed outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 disabled:bg-slate-50" />
        <div className="mt-2 text-[12px] text-muted">{inv.parecer_em ? `Última versão salva por ${inv.parecer_por} em ${fdata(inv.parecer_em)}` : "Ainda não salvo"}{sujo && " · alterações não salvas"}</div>
      </div>
      <div className="space-y-2">
        {!fechado && <Button className="w-full" onClick={salvar} loading={salvando} disabled={!sujo}>Salvar parecer</Button>}
        {!fechado && <Button className="w-full" variant="secondary" onClick={modelo}><FileText className="size-4" />Inserir resumo automático</Button>}
        <Link href={`/inventario/${inv.id}/relatorio`} target="_blank" className="block"><Button className="w-full" variant="secondary"><Printer className="size-4" />Relatório / PDF</Button></Link>
        {inv.etapa === "LANCAMENTO" && (
          <div className="mt-4 rounded-xl border border-line p-4">
            <div className="text-[13px] font-semibold">Encerramento</div>
            <div className="mt-2 space-y-1.5 text-[13px]"><Checagem ok={!!inv.lancado_em}>Ajustes lançados</Checagem><br /><Checagem ok={!!txt.trim()}>Parecer escrito</Checagem></div>
            <Button className="mt-3 w-full" variant="dark" disabled={!inv.lancado_em || !txt.trim()} onClick={encerrar}>Encerrar inventário</Button>
          </div>
        )}
      </div>
      {dialogo}
    </div>
  );
}

// ---------- equipe / histórico ----------
function AbaEquipe({ d }: { d: Dados }) {
  if (!d.operadores.length) return <Vazio icone={<Users className="size-6" />} titulo="Ninguém contou ainda" texto="Os operadores aparecem aqui assim que enviarem a primeira leitura pelo coletor." />;
  const max = Math.max(...d.operadores.map((o) => o.n));
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {d.operadores.map((o) => (
        <div key={o.etapa + o.usuario} className="rounded-xl border border-line p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-brand-100 text-[13px] font-bold text-brand-800">{o.usuario.slice(0, 2)}</span>
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{o.usuario}</div><div className="text-[12px] text-muted">{NOME_ETAPA[["", "CONTAGEM", "RECONTAGEM", "AUDITORIA"][o.etapa]]}</div></div>
            <div className="text-right tabular"><div className="text-lg font-semibold">{o.n}</div><div className="text-[11px] text-muted">leituras</div></div>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(100 * o.n) / max}%` }} /></div>
          <div className="mt-2 text-[12px] text-muted tabular">{o.itens} itens · {o.primeira.slice(11, 16)}–{o.ultima.slice(11, 16)}</div>
        </div>
      ))}
    </div>
  );
}
function AbaHistorico({ id }: { id: number }) {
  const [l, setL] = useState<Row[] | null>(null), [acao, setAcao] = useState(""), [busca, setBusca] = useState("");
  useEffect(() => { api<Row[]>(`inventarios/${id}/log`).then(setL); }, [id]);
  const acoes = useMemo(() => [...new Set((l || []).map((x) => x.acao as string))].sort(), [l]);
  const lista = useMemo(() => (l || []).filter((x) => (!acao || x.acao === acao) && (!busca || `${x.usuario} ${x.detalhe}`.toUpperCase().includes(busca.toUpperCase()))), [l, acao, busca]);
  const { itens: pag, controles } = usePaginacao(lista, 30, acao + busca);
  if (!l) return <Carregando />;
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3">
        <select className={cx(inputCls, "w-auto")} value={acao} onChange={(e) => setAcao(e.target.value)}>
          <option value="">Todas as ações ({l.length})</option>
          {acoes.map((a) => <option key={a} value={a}>{a} ({l.filter((x) => x.acao === a).length})</option>)}
        </select>
        <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
          <input className={cx(inputCls, "pl-9")} placeholder="Buscar usuário ou detalhe (ex.: código do produto)" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
      </div>
      {!lista.length ? <Vazio icone={<History className="size-5" />} titulo="Nada encontrado" /> : (
        <ol className="relative space-y-4 border-l border-line pl-6">
          {pag.map((x) => (
            <li key={x.id} className="relative">
              <span className="absolute -left-[29px] top-1 size-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
              <div className="text-[13px]"><b>{x.acao}</b> <span className="text-muted">· {x.usuario} · {fdata(x.em)}</span></div>
              {x.detalhe && <div className="mt-0.5 break-all font-mono text-[11px] text-muted">{x.detalhe.length > 300 ? x.detalhe.slice(0, 300) + "…" : x.detalhe}</div>}
            </li>
          ))}
        </ol>
      )}
      {controles}
    </div>
  );
}

// ---------- inventário programado (ainda não iniciado) ----------
function Programado({ inv }: { inv: Row }) {
  const router = useRouter(), toast = useToast(), [ocupado, setOcupado] = useState(false);
  const [etapa, setEtapa] = useState<string>(inv.etapa_inicial || "CONTAGEM");
  async function iniciar() {
    setOcupado(true);
    try { await api(`inventarios/${inv.id}/iniciar`, { etapa }); toast("Inventário iniciado: saldos congelados."); location.reload(); }
    catch (e) { toast((e as Error).message, "erro"); setOcupado(false); }
  }
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Card className="p-6">
        <div className="flex items-center gap-2"><Badge v="PROGRAMADO" /><span className="text-[13px] text-muted">#{inv.id}</span></div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{inv.descricao}</h1>
        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-muted">Data prevista</dt><dd className="font-semibold">{fdata(inv.data_prevista)}</dd></div>
          <div><dt className="text-muted">Responsável</dt><dd className="font-semibold">{inv.responsavel || "—"}</dd></div>
          <div className="col-span-2"><dt className="text-muted">Itens</dt><dd className="font-medium">{descreverEscopo(inv.escopo ? JSON.parse(inv.escopo) : null)}</dd></div>
          {inv.obs && <div className="col-span-2"><dt className="text-muted">Observação</dt><dd>{inv.obs}</dd></div>}
        </dl>
        <div className="mt-6 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
          <span className="text-[13px] font-medium">Começar pela</span>
          <select className={cx(inputCls, "w-auto")} value={etapa} onChange={(e) => setEtapa(e.target.value)}>
            {["CONTAGEM", "RECONTAGEM", "AUDITORIA"].map((k) => <option key={k} value={k}>{NOME_ETAPA[k]}</option>)}
          </select>
          <Button className="ml-auto" onClick={iniciar} loading={ocupado}>Iniciar agora <ArrowRight className="size-4" /></Button>
        </div>
        <button onClick={() => router.push("/inventario/programacao")} className="mt-4 text-[13px] font-medium text-brand-700 hover:underline">← Programação</button>
      </Card>
    </main>
  );
}

// ---------- detalhe do item ----------
function DetalheItem({ invId, etapa, codpro, fechar, recarregar }: { invId: number; etapa: string; codpro: string | null; fechar: () => void; recarregar: () => void }) {
  const [r, setR] = useState<Row | null>(null), toast = useToast(), [usuario] = useResponsavel();
  const carregar = useCallback(() => { if (codpro) api(`inventarios/${invId}/itens/${encodeURIComponent(codpro)}`).then(setR); }, [invId, codpro]);
  useEffect(() => { setR(null); carregar(); }, [carregar]);
  const cancelar = async (uid: string) => {
    try { await api(`leituras/${uid}/cancelar`, { usuario, gestao: true }); toast("Leitura cancelada."); carregar(); recarregar(); } catch (e) { toast((e as Error).message, "erro"); }
  };
  const i = r?.item;
  return (
    <Gaveta aberto={!!codpro} onClose={fechar}>
      {!i ? <Carregando /> : (
        <div>
          <div className="sticky top-0 border-b border-line bg-white/95 px-6 py-5 backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div><div className="text-[12px] text-muted">{i.codpro} · {i.unipro} · {i.grupo}{i.subgrupo ? ` / ${i.subgrupo}` : ""}</div><h2 className="mt-0.5 text-lg font-semibold tracking-tight">{i.nompro}</h2></div>
              <Button variant="ghost" size="sm" onClick={fechar}>Fechar</Button>
            </div>
            <div className="mt-4 grid grid-cols-5 gap-2 text-center tabular">
              {[["Sistema", i.saldo], ["Contagem", i.c1], ["Recont.", i.c2], ["Auditor", i.c3], ["Final", i.final]].map(([l, v]) => (
                <div key={l} className="rounded-lg bg-slate-50 py-2"><div className="text-[11px] text-muted">{l}</div><div className="font-semibold">{fq(v)}</div></div>
              ))}
            </div>
            {i.justificativa && <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-[13px] text-sky-900">Auditoria ({i.auditado_por}): {i.justificativa}</p>}
            <div className="mt-3 flex flex-wrap gap-x-4 text-[12px] text-muted"><span>Barras: <span className="font-mono">{i.codbar || "—"}</span></span><span>DUN: <span className="font-mono">{i.coddum || "—"}</span></span><span>Custo: {frs(i.precus)}</span></div>
          </div>
          <div className="px-6 py-5">
            <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted">Leituras</h3>
            {!r.leituras.length ? <p className="text-sm text-muted">Nenhuma leitura deste item.</p> : (
              <div className="space-y-2">
                {(r.leituras as Row[]).map((l) => (
                  <div key={l.id} className={cx("flex items-center gap-3 rounded-xl border border-line px-4 py-3", l.cancelada && "opacity-50")}>
                    <span className={cx("grid size-8 place-items-center rounded-lg text-[11px] font-bold", ["", "bg-sky-50 text-sky-800", "bg-amber-50 text-amber-800", "bg-rose-50 text-rose-700"][l.etapa])}>{["", "C", "R", "A"][l.etapa]}</span>
                    <div className="min-w-0 flex-1">
                      <div className={cx("text-sm", l.cancelada && "line-through")}><b className="tabular">{fq(l.qtd)}</b> {i.unipro} <span className="text-muted">em</span> <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{l.local || "—"}</span></div>
                      <div className="text-[12px] text-muted">{l.usuario} · {l.dispositivo} · {fdata(l.lido_em)} · lido <span className="font-mono">{l.codigo}</span>{l.cancelada ? ` · cancelada por ${l.cancelada_por}` : ""}</div>
                    </div>
                    {!l.cancelada && NUM_ETAPA[etapa] === l.etapa && <Button variant="danger" size="sm" onClick={() => cancelar(l.uid)}><Undo2 className="size-3.5" />Cancelar</Button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Gaveta>
  );
}

// ---------- exportar ----------
// Cancelar: da contagem ao lançamento, até registrar os ajustes. Diz o que sai e o que fica, pede motivo e a palavra. Não reabre.
function CancelarInventario({ d, recarregar }: { d: Dados; recarregar: () => void }) {
  const { inv } = d, toast = useToast(), [usuario] = useResponsavel();
  const [aberto, setAberto] = useState(false), [motivo, setMotivo] = useState(""), [palavra, setPalavra] = useState(""), [oc, setOc] = useState(false);
  if (!NUM_ETAPA[inv.etapa] && inv.etapa !== "LANCAMENTO") return null;
  const leituras = d.operadores.reduce((s, o) => s + o.n, 0);
  const limite = new Date(Date.now() - 10 * 60000).toLocaleString("sv-SE"), recentes = new Set(d.operadores.filter((o) => o.ultima >= limite).map((o) => o.usuario)).size;
  const pronto = motivo.trim().length >= 5 && palavra.trim().toUpperCase() === "CANCELAR";
  async function cancelar() {
    setOc(true);
    try { await api(`inventarios/${inv.id}/cancelar`, { usuario, motivo, confirmacao: palavra }); toast("Inventário cancelado."); setAberto(false); recarregar(); }
    catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); }
  }
  return (
    <>
      <Button variant="danger" disabled={!!inv.lancado_em}
        title={inv.lancado_em ? `Os ajustes já foram registrados em ${fdata(inv.lancado_em)}. Para desfazer, estorne no Lieto.` : undefined}
        onClick={() => { setMotivo(""); setPalavra(""); setAberto(true); }}><Ban className="size-4" />Cancelar inventário</Button>
      <Modal aberto={aberto} onClose={() => !oc && setAberto(false)} titulo={`Cancelar “#${inv.id} ${inv.descricao}”?`}
        rodape={<><Button variant="secondary" disabled={oc} onClick={() => setAberto(false)}>Voltar</Button><Button variant="danger" className="!border-rose-700 !bg-rose-700 !text-white hover:!bg-rose-800" loading={oc} disabled={!pronto} onClick={cancelar}>Cancelar inventário</Button></>}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>Os coletores deixam de aceitar leituras deste inventário{recentes ? ` (${recentes} ${recentes === 1 ? "pessoa contou" : "pessoas contaram"} nos últimos 10 min)` : ""}.</li>
          <li>As <b>{leituras.toLocaleString("pt-BR")} leituras</b> ficam guardadas para consulta.</li>
          <li><b>Nada foi gravado no Lieto</b>: o estoque não muda.</li>
          <li>Ele sai de Em andamento e vai para Encerrados, marcado como Cancelado. <b>Não dá para reabrir.</b></li>
        </ul>
        <label className="mt-4 block text-[13px] font-semibold">Motivo <span className="font-normal text-muted">(obrigatório, vai para o histórico)</span>
          <textarea className={cx(inputCls, "mt-1 h-auto py-2")} rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus /></label>
        <label className="mt-3 block text-[13px] font-semibold">Digite CANCELAR para confirmar
          <input className={cx(inputCls, "mt-1")} value={palavra} onChange={(e) => setPalavra(e.target.value)} onKeyDown={(e) => e.key === "Enter" && pronto && !oc && cancelar()} /></label>
      </Modal>
    </>
  );
}

function Exportar({ d }: { d: Dados }) {
  const [aberto, setAberto] = useState(false);
  const itens = () => {
    const { it } = indicadores(d.itens);
    baixarCsv(`itens_inv${d.inv.id}.csv`, ["Código", "Produto", "Un", "Grupo", "Subgrupo", "Barras", "Custo", "Sistema", "Contagem", "Recontagem", "Auditor", "Final", "Diferença", "Valor dif", "Situação", "Justificativa", "Locais"],
      it.map((i) => [i.codpro, i.nompro, i.unipro, i.grupo, i.subgrupo, i.codbar, i.precus, i.saldo, i.c1, i.c2, i.c3, i.final, i.dif, i.valor, i.situacao, i.justificativa, i.l[1]?.locais]));
  };
  const leituras = async () => {
    const l = await api<Row[]>(`inventarios/${d.inv.id}/leituras`);
    baixarCsv(`leituras_inv${d.inv.id}.csv`, ["ID", "Etapa", "Local", "Código", "Produto", "Un", "Qtd", "Código lido", "Operador", "Coletor", "Lido em", "Cancelada", "Cancelada por"],
      l.map((x) => [x.id, x.etapa, x.local, x.codpro, x.nompro, x.unipro, x.qtd, x.codigo, x.usuario, x.dispositivo, x.lido_em, x.cancelada ? "SIM" : "", x.cancelada_por]));
  };
  return (
    <div className="relative">
      <Button variant="secondary" onClick={() => setAberto(!aberto)} onBlur={() => setTimeout(() => setAberto(false), 150)}><Download className="size-4" />Exportar</Button>
      {aberto && (
        <div className="anim-entra absolute right-0 top-11 z-20 w-56 rounded-xl border border-line bg-white p-1 shadow-xl">
          {[["Itens e diferenças (CSV)", itens], ["Todas as leituras (CSV)", leituras]].map(([n, fn]) => (
            <button key={n as string} onMouseDown={() => (fn as () => void)()} className="w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-slate-100">{n as string}</button>
          ))}
        </div>
      )}
    </div>
  );
}
