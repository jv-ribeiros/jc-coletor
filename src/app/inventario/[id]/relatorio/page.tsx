"use client";
// Relatório para imprimir / salvar em PDF (A4). Resumo em retrato; tabela de itens em paisagem,
// com cabeçalho repetido em cada página, linhas que não quebram e numeração de páginas.
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { useEmpresa } from "@/components/acesso";
import { Button, Carregando } from "@/components/ui";
import { descreverEscopo } from "@/lib/escopo";
import { NOME_DECISAO, NOME_ETAPA, api, fdata, fpct, fq, frs, indicadores, semAjuste, type Row } from "@/lib/client";

export default function Relatorio() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Row | null>(null), [log, setLog] = useState<Row[]>([]), empresa = useEmpresa();
  useEffect(() => {
    api(`inventarios/${id}`).then(setD);
    api<Row[]>(`inventarios/${id}/log`).then(setLog).catch(() => {});
  }, [id]);
  useEffect(() => { if (d) document.title = `Inventário ${d.inv.id} - ${d.inv.descricao}`; }, [d]);
  if (!d) return <Carregando />;

  const { inv } = d, { t, it } = indicadores(d.itens);
  const ativos = it.filter((i) => i.situacao !== "DESCONSIDERADO");
  const div = ativos.filter((i) => i.dif !== 0).sort((a, b) => a.grupo?.localeCompare(b.grupo || "") || Math.abs(b.valor) - Math.abs(a.valor));
  const top = [...div].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)).slice(0, 10);
  const naoAjust = it.filter((i) => semAjuste(i) && i.situacao !== "DESCONSIDERADO");
  const quando = (a: string) => fdata(log.find((x) => x.acao === a)?.em);
  const ops = d.operadores as Row[];
  const equipe = [...new Set(ops.map((o) => o.usuario))].map((u) => ({ u, n: ops.filter((o) => o.usuario === u).reduce((s, o) => s + o.n, 0), etapas: [...new Set(ops.filter((o) => o.usuario === u).map((o) => ["", "Contagem", "Recontagem", "Auditoria"][o.etapa]))].join(", ") }));
  const rito = [
    ["Abertura", fdata(inv.snapshot_em)], ["Contagem", quando("FECHOU CONTAGEM")], ["Recontagem", quando("FECHOU RECONTAGEM")],
    ["Auditoria", quando("FECHOU AUDITORIA")], ["Lançamento", fdata(inv.lancado_em)], ["Encerramento", fdata(inv.encerrado_em)],
  ];
  // por grupo
  const gmap = new Map<string, { n: number; dif: number; sobra: number; falta: number; certos: number; vSis: number }>();
  for (const i of ativos.filter((x) => !semAjuste(x))) {
    const k = i.grupo || "Sem grupo", g = gmap.get(k) || { n: 0, dif: 0, sobra: 0, falta: 0, certos: 0, vSis: 0 };
    g.n++; g.vSis += i.saldo * i.precus; if (i.dif === 0) g.certos++; else g.dif++; if (i.valor > 0) g.sobra += i.valor; else g.falta += i.valor; gmap.set(k, g);
  }
  const grupos = [...gmap.entries()].sort((a, b) => Math.abs(b[1].sobra + b[1].falta) - Math.abs(a[1].sobra + a[1].falta));
  const maxG = Math.max(1, ...grupos.map(([, g]) => Math.max(g.sobra, -g.falta)));
  const pctLiq = t.vSis ? (100 * t.liq) / t.vSis : 0;

  return (
    <div className="rel min-h-screen bg-slate-200/70 py-8 print:bg-white print:py-0">
      <style>{CSS}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-4 px-2 text-[13px] text-muted">
        <span>Dica: no diálogo de impressão escolha <b>Salvar como PDF</b>, margens <b>Padrão</b> e marque <b>Gráficos de plano de fundo</b>.</span>
        <Button onClick={() => window.print()}><Printer className="size-4" />Imprimir / PDF</Button>
      </div>

      {/* ---------- página 1: resumo ---------- */}
      <article className="folha">
        <header className="flex items-stretch justify-between gap-6 border-b-[3px] border-brand-800 pb-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[.18em] text-brand-700">{empresa || inv.nomemp}</div>
            <h1 className="mt-1.5 text-[24px] font-bold leading-tight tracking-tight text-ink">Relatório de Inventário</h1>
            <div className="mt-0.5 text-[13px] font-medium text-slate-700">#{inv.id} · {inv.descricao}</div>
            <div className="mt-1 text-[11px] text-muted">{inv.nomemp ? `${inv.nomemp} · ` : ""}Escopo: {descreverEscopo(inv.escopo ? JSON.parse(inv.escopo) : null)}</div>
          </div>
          <div className="flex shrink-0 flex-col items-end justify-between text-right text-[11px] text-muted">
            <span className="rounded-md bg-brand-800 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">{NOME_ETAPA[inv.etapa]}</span>
            <span>Saldo congelado em <b className="text-ink">{fdata(inv.snapshot_em)}</b><br />Emitido em {new Date().toLocaleString("pt-BR")}</span>
          </div>
        </header>
        {inv.etapa === "CANCELADO" && <div className="mt-4 rounded-xl border border-slate-300 bg-slate-100 p-3 text-[12px]"><b>Cancelado em {fdata(inv.encerrado_em)} por {inv.encerrado_por}.</b> Motivo: {inv.motivo_cancel}. Nada foi gravado no Lieto: os valores abaixo são o que foi apurado até o cancelamento.</div>}

        <section className="mt-5 grid grid-cols-[1.1fr_1fr_1fr] gap-3">
          <div className="rounded-xl bg-brand-800 p-4 text-white">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-brand-100/80">Acuracidade</div>
            <div className="mt-1 text-[34px] font-bold leading-none tabular">{fpct(t.acur)}</div>
            <div className="mt-2 text-[11px] text-brand-100/90">{t.certos.toLocaleString("pt-BR")} de {t.escopo.toLocaleString("pt-BR")} itens sem diferença</div>
            <div className="mt-2 h-1.5 rounded-full bg-white/20"><div className="h-full rounded-full bg-white" style={{ width: `${Math.min(100, t.acur)}%` }} /></div>
          </div>
          <Kpi l="Estoque no sistema" v={frs(t.vSis)} s={`Apurado: ${frs(t.vCont)}`} />
          <Kpi l="Diferença líquida" v={frs(t.liq)} s={`${fpct(pctLiq)} do estoque`} cor={t.liq < 0 ? "neg" : t.liq > 0 ? "pos" : undefined} />
          <Kpi l="Sobras (entradas)" v={frs(t.sobra)} cor="pos" s={`${ativos.filter((i) => i.valor > 0 && !semAjuste(i)).length} itens`} />
          <Kpi l="Faltas (saídas)" v={frs(t.falta)} cor="neg" s={`${ativos.filter((i) => i.valor < 0 && !semAjuste(i)).length} itens`} />
          <Kpi l="Itens" v={t.escopo.toLocaleString("pt-BR")} s={`${t.comSaldo} com saldo · ${d.itens.filter((i: Row) => i.c2 != null).length} recontados · ${t.auditados} auditados`} />
        </section>
        {(t.desconsiderados > 0 || t.mantidos > 0 || t.reenviados > 0) && (
          <p className="mt-2 text-[10.5px] text-muted">Fora do acerto: {[t.desconsiderados && `${t.desconsiderados} desconsiderado(s) (sem contagem)`, t.mantidos && `${t.mantidos} mantido(s) pela auditoria`, t.reenviados && `${t.reenviados} enviado(s) para nova recontagem`].filter(Boolean).join(" · ")}.</p>
        )}

        <section className="mt-5">
          <H>Rito</H>
          <ol className="grid grid-cols-6">
            {rito.map(([n, v], k) => (
              <li key={n} className="relative pr-2">
                <div className="flex items-center"><span className={`size-3 rounded-full ring-2 ring-white ${v !== "—" ? "bg-brand-600" : "bg-slate-300"}`} />{k < 5 && <span className="h-0.5 flex-1 bg-slate-200" />}</div>
                <div className="mt-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-muted">{n}</div>
                <div className="text-[11px] font-medium tabular">{v}</div>
              </li>
            ))}
          </ol>
        </section>

        <div className="mt-5 grid grid-cols-2 gap-5">
          <section>
            <H>Diferença por grupo</H>
            <table className="tab">
              <colgroup><col style={{ width: "40%" }} /><col style={{ width: "10%" }} /><col style={{ width: "14%" }} /><col style={{ width: "36%" }} /></colgroup>
              <thead><tr><th>Grupo</th><th className="r">Itens</th><th className="r">Acur.</th><th>Faltas · Sobras</th></tr></thead>
              <tbody>
                {grupos.slice(0, 12).map(([g, x]) => (
                  <tr key={g}>
                    <td className="truncate">{g}</td><td className="r">{x.n}</td><td className="r">{fpct((100 * x.certos) / x.n)}</td>
                    <td>
                      <div className="flex h-2.5 items-center">
                        <div className="flex h-full flex-1 justify-end"><div className="h-full rounded-l-sm bg-rose-500" style={{ width: `${(100 * -x.falta) / maxG}%` }} /></div>
                        <div className="h-3 w-px bg-slate-400" />
                        <div className="h-full flex-1"><div className="h-full rounded-r-sm bg-brand-500" style={{ width: `${(100 * x.sobra) / maxG}%` }} /></div>
                      </div>
                      <div className="mt-0.5 flex justify-between text-[9px] tabular text-muted"><span>{x.falta ? frs(x.falta) : ""}</span><span>{x.sobra ? frs(x.sobra) : ""}</span></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {grupos.length > 12 && <p className="mt-1 text-[9.5px] text-muted">+ {grupos.length - 12} grupos com menor impacto</p>}
          </section>
          <section>
            <H>10 maiores divergências</H>
            <table className="tab">
              <thead><tr><th>Código</th><th>Produto</th><th className="r">Dif.</th><th className="r">Valor</th></tr></thead>
              <tbody>
                {top.map((i) => (
                  <tr key={i.codpro}><td>{i.codpro}</td><td className="font-medium">{i.nompro}</td>
                    <td className={`r ${i.dif < 0 ? "neg" : "pos"}`}>{i.dif > 0 ? "+" : ""}{fq(i.dif)}</td><td className={`r font-semibold ${i.valor < 0 ? "neg" : "pos"}`}>{frs(i.valor)}</td></tr>
                ))}
                {!top.length && <tr><td colSpan={4} className="text-muted">Nenhuma divergência.</td></tr>}
              </tbody>
            </table>
          </section>
        </div>

        <section className="mt-5 break-inside-avoid">
          <H>Equipe</H>
          <div className="flex flex-wrap gap-1.5">
            {equipe.map((e) => <span key={e.u} className="rounded-md border border-line px-2 py-1 text-[10.5px]"><b>{e.u}</b> <span className="text-muted">· {e.etapas} · {e.n} leituras</span></span>)}
            {!equipe.length && <span className="text-muted">—</span>}
          </div>
        </section>

        <section className="mt-5 break-inside-avoid">
          <H>Parecer</H>
          <div className="whitespace-pre-wrap rounded-xl border border-line bg-slate-50/60 p-4 text-[11.5px] leading-relaxed">{inv.parecer || "—"}</div>
          {inv.parecer_por && <div className="mt-1 text-right text-[10px] text-muted">{inv.parecer_por} · {fdata(inv.parecer_em)}</div>}
        </section>

        <footer className="mt-14 grid break-inside-avoid grid-cols-3 gap-10 text-center text-[10.5px]">
          {["Responsável pelo inventário", "Auditoria", "Gerência / Diretoria"].map((n) => <div key={n} className="border-t border-ink pt-1.5">{n}</div>)}
        </footer>
      </article>

      {/* ---------- itens com diferença: paisagem ---------- */}
      <article className="folha paisagem">
        <H>Itens com diferença ({div.length}) · por grupo</H>
        <table className="tab itens">
          <colgroup>
            <col style={{ width: "7%" }} /><col style={{ width: "27%" }} /><col style={{ width: "4%" }} /><col style={{ width: "7%" }} /><col style={{ width: "7%" }} /><col style={{ width: "7%" }} />
            <col style={{ width: "7%" }} /><col style={{ width: "7%" }} /><col style={{ width: "7%" }} /><col style={{ width: "8%" }} /><col style={{ width: "12%" }} />
          </colgroup>
          <thead>
            <tr><th>Código</th><th>Produto</th><th>Un</th><th className="r">Sistema</th><th className="r">Contagem</th><th className="r">Recont.</th><th className="r">Auditor</th><th className="r">Final</th><th className="r">Diferença</th><th className="r">Valor</th><th>Justificativa</th></tr>
          </thead>
          <tbody>
            {div.map((i, k) => (
              <Linhas key={i.codpro} i={i} grupoNovo={k === 0 || div[k - 1].grupo !== i.grupo} />
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={8}>Total ajustado (sem itens mantidos ou reenviados)</td><td /><td className={`r ${t.liq < 0 ? "neg" : "pos"}`}>{frs(t.liq)}</td><td /></tr>
          </tfoot>
        </table>
        {naoAjust.length > 0 && (
          <section className="mt-6 break-inside-avoid">
            <H>Decisões da auditoria sem ajuste ({naoAjust.length})</H>
            <table className="tab">
              <colgroup><col style={{ width: "8%" }} /><col style={{ width: "34%" }} /><col style={{ width: "11%" }} /><col style={{ width: "10%" }} /><col style={{ width: "10%" }} /><col style={{ width: "27%" }} /></colgroup>
              <thead><tr><th>Código</th><th>Produto</th><th>Decisão</th><th className="r">Sistema</th><th className="r">Apurado</th><th>Justificativa</th></tr></thead>
              <tbody>{naoAjust.map((i) => <tr key={i.codpro}><td>{i.codpro}</td><td>{i.nompro}</td><td>{NOME_DECISAO[i.decisao]}</td><td className="r">{fq(i.saldo)}</td><td className="r">{fq(i.final ?? i.c3 ?? i.c2 ?? i.c1)}</td><td>{i.justificativa}</td></tr>)}</tbody>
            </table>
          </section>
        )}
      </article>
    </div>
  );
}

function Linhas({ i, grupoNovo }: { i: Row; grupoNovo: boolean }) {
  return (
    <>
      {grupoNovo && <tr className="grupo"><td colSpan={11}>{i.grupo || "Sem grupo"}</td></tr>}
      <tr className={semAjuste(i) ? "opacity-50" : ""}>
        <td className="tabular">{i.codpro}</td><td>{i.nompro}</td><td>{i.unipro}</td>
        <td className="r">{fq(i.saldo)}</td><td className="r">{fq(i.c1)}</td><td className="r">{fq(i.c2)}</td><td className="r">{fq(i.c3)}</td>
        <td className="r font-semibold">{fq(i.atual)}</td><td className={`r ${i.dif < 0 ? "neg" : "pos"}`}>{i.dif > 0 ? "+" : ""}{fq(i.dif)}</td>
        <td className={`r font-semibold ${i.valor < 0 ? "neg" : "pos"}`}>{frs(i.valor)}</td><td className="just">{i.justificativa}</td>
      </tr>
    </>
  );
}

const Kpi = ({ l, v, s, cor }: { l: string; v: string; s?: string; cor?: "pos" | "neg" }) => (
  <div className="rounded-xl border border-line p-3.5">
    <div className="text-[9.5px] font-semibold uppercase tracking-wider text-muted">{l}</div>
    <div className={`mt-1 text-[17px] font-bold leading-tight tabular ${cor === "pos" ? "text-brand-700" : cor === "neg" ? "text-rose-700" : ""}`}>{v}</div>
    {s && <div className="mt-0.5 text-[10px] text-muted">{s}</div>}
  </div>
);
const H = ({ children }: { children: React.ReactNode }) => <h2 className="mb-2 flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[.14em] text-brand-800"><span className="h-3 w-1 rounded-full bg-brand-600" />{children}</h2>;

const CSS = `
.rel { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.rel .folha { margin: 0 auto 24px; max-width: 210mm; background: #fff; padding: 14mm 14mm 12mm; font-size: 11px; line-height: 1.4; box-shadow: 0 10px 30px rgba(0,0,0,.12); }
.rel .folha.paisagem { max-width: 297mm; }
.rel .tab { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10.5px; font-variant-numeric: tabular-nums; }
.rel .tab th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: #475569; font-weight: 700; padding: 5px 6px; border-bottom: 1.5px solid #1a1f26; background: #f4f5f7; }
.rel .tab td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; overflow-wrap: anywhere; }
.rel .tab .r { text-align: right; white-space: nowrap; }
.rel .tab .neg { color: #be123c; } .rel .tab .pos { color: #42556a; }
.rel .tab tbody tr:nth-child(even) td { background: #f8fafc; }
.rel .tab tr.grupo td { background: #f1f4f7 !important; color: #364759; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; padding-top: 6px; border-bottom: 1px solid #bcc8d4; }
.rel .tab tfoot td { border-top: 1.5px solid #1a1f26; border-bottom: 0; font-weight: 700; padding-top: 6px; }
.rel .tab .just { font-size: 9.5px; color: #475569; }
.rel .tab.itens td:nth-child(2) { font-weight: 500; }
@media print {
  @page { size: A4 portrait; margin: 12mm 11mm 14mm; @bottom-right { content: "Página " counter(page) " de " counter(pages); font-size: 8pt; color: #64748b; } @bottom-left { content: "Inventário — relatório"; font-size: 8pt; color: #64748b; } }
  @page paisagem { size: A4 landscape; margin: 10mm 10mm 13mm; }
  .rel .folha { box-shadow: none; margin: 0; padding: 0; max-width: none; }
  .rel .folha.paisagem { page: paisagem; break-before: page; }
  .rel .tab thead { display: table-header-group; }
  .rel .tab tfoot { display: table-row-group; }
  .rel .tab tr { break-inside: avoid; }
  .rel .tab tr.grupo { break-after: avoid; }
}
`;
