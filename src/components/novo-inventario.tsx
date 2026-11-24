"use client";
// Abrir agora (congela o saldo) ou programar para uma data — com etapa inicial e itens a contar.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Building2, CalendarPlus, Database, FileSpreadsheet, ListChecks, Play, X } from "lucide-react";
import { MontarLista, deLinha, resumoLista, type LinhaPrevia, type ProdPrevia } from "@/components/montar-lista";
import { EtapaInicial, SelResponsavel, useUsuariosLieto } from "@/components/inicio";
import { Button, Field, cx, inputCls, useToast } from "@/components/ui";
import { ESCOPO_VAZIO, descreverEscopo, escopoAtivo, filtrarEscopo, type Escopo } from "@/lib/escopo";
import { api, frsK, type Row } from "@/lib/client";

const REPETIR = [["", "Não repetir"], ["7", "Toda semana"], ["14", "A cada 15 dias"], ["mensal", "Todo mês"], ["trimestral", "A cada 3 meses"]] as const;

export function NovoInventario({ modoInicial, fechar, aoCriar }: { modoInicial: "agora" | "programar"; fechar: () => void; aoCriar: () => void }) {
  const router = useRouter(), toast = useToast(), usuarios = useUsuariosLieto();
  const [quando, setQuando] = useState(modoInicial);
  const [origem, setOrigem] = useState<"erp" | "csv">("erp");
  const [empresas, setEmpresas] = useState<Row[] | null>(null);
  const [erpErro, setErpErro] = useState("");
  const amanha = new Date(Date.now() + 864e5).toLocaleDateString("sv-SE");
  const [f, setF] = useState({ descricao: "", codemp: "", dataSaldo: new Date().toLocaleDateString("sv-SE"), etapa: "CONTAGEM", dataPrevista: amanha, responsavel: "", repetir: "", vezes: "6", obs: "" });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [modo, setModo] = useState<"todos" | "lista">("todos");
  const [escopo, setEscopo] = useState<Escopo>(ESCOPO_VAZIO);
  const [prods, setProds] = useState<ProdPrevia[] | null>(null), [prevErro, setPrevErro] = useState(""), [listaAberta, setListaAberta] = useState(false);
  const programar = quando === "programar";
  useEffect(() => { setProds(null); setPrevErro(""); }, [origem, f.codemp, f.dataSaldo, arquivo]);
  useEffect(() => { if (programar) setOrigem("erp"); }, [programar]);

  async function lerCsv() {
    const buf = await arquivo!.arrayBuffer();
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("windows-1252").decode(buf); }
  }
  async function abrirLista() {
    if (origem === "erp" && !f.codemp) return toast("Escolha a empresa primeiro.", "erro");
    if (origem === "csv" && !arquivo) return toast("Escolha o arquivo CSV primeiro.", "erro");
    setListaAberta(true);
    if (prods) return;
    try {
      const linhas = await api<LinhaPrevia[]>("inventarios/previa", { origem, codemp: f.codemp, dataSaldo: f.dataSaldo, csv: origem === "csv" ? await lerCsv() : undefined });
      setProds(linhas.map(deLinha));
    } catch (e) { setPrevErro((e as Error).message); }
  }
  const resumo = prods && escopoAtivo(escopo) ? resumoLista(filtrarEscopo(prods, escopo)) : null;

  useEffect(() => {
    api<Row[]>("erp/empresas").then((e) => { setEmpresas(e); if (e.length === 1) setF((x) => ({ ...x, codemp: String(e[0].codemp) })); })
      .catch((e) => { setErpErro(e.message); setEmpresas([]); setOrigem("csv"); });
  }, []);

  async function criar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!f.descricao.trim()) return toast("Dê um nome ao inventário.", "erro");
    let csv: string | undefined;
    if (origem === "csv") {
      if (!arquivo) return toast("Escolha o arquivo CSV.", "erro");
      csv = await lerCsv();
    } else if (!f.codemp) return toast("Escolha a empresa.", "erro");
    if (modo === "lista" && !escopoAtivo(escopo)) return toast("Monte a lista de itens ou escolha “Todos os itens”.", "erro");
    setSalvando(true);
    try {
      const emp = empresas?.find((e) => String(e.codemp) === f.codemp);
      const r = await api<Row>("inventarios", { ...f, origem, csv, nomemp: emp?.nomemp, escopo: modo === "lista" ? escopo : null, programar, vezes: f.repetir ? f.vezes : 1 });
      aoCriar();
      if (programar) { toast(r.ids.length > 1 ? `${r.ids.length} inventários programados.` : "Inventário programado."); fechar(); router.push("/inventario/programacao"); }
      else { toast("Inventário aberto e saldos congelados."); router.push(`/inventario/${r.id}`); }
    } catch (e) { toast((e as Error).message, "erro"); setSalvando(false); }
  }

  const seg = (ativo: boolean) => cx("inline-flex h-9 items-center justify-center gap-2 rounded-md text-[13px] font-medium transition disabled:opacity-40", ativo ? "bg-white shadow-sm" : "text-muted hover:text-ink");
  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-gradient-to-br from-brand-800 to-brand-900 px-6 py-5 text-white">
        <div>
          <div className="text-[17px] font-semibold">{programar ? "Programar inventário" : "Novo inventário"}</div>
          <p className="mt-1 text-[13px] text-brand-100/80">{programar ? "Fica na agenda. No dia, é só iniciar: o saldo é congelado nessa hora." : "Congela o saldo do sistema agora. Os coletores passam a contar contra essa foto."}</p>
        </div>
        <button onClick={fechar} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10"><X className="size-5" /></button>
      </div>
      <form onSubmit={criar} className="flex-1 space-y-5 p-6">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
          <button type="button" onClick={() => setQuando("agora")} className={seg(!programar)}><Play className="size-4" />Abrir agora</button>
          <button type="button" onClick={() => setQuando("programar")} className={seg(programar)}><CalendarPlus className="size-4" />Programar</button>
        </div>

        <Field label="Nome"><input autoFocus className={inputCls} placeholder="Ex.: Inventário geral — novembro/2026" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Field>

        {!programar && (
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
            {([["erp", "Saldo do ERP", Database], ["csv", "Arquivo CSV", FileSpreadsheet]] as const).map(([k, n, Ic]) => (
              <button type="button" key={k} onClick={() => setOrigem(k)} disabled={k === "erp" && !!erpErro} className={seg(origem === k)}><Ic className="size-4" />{n}</button>
            ))}
          </div>
        )}

        {origem === "erp" ? (
          <div className={cx("grid gap-3", !programar && "sm:grid-cols-2")}>
            <Field label="Empresa">
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
                <select className={cx(inputCls, "pl-9")} value={f.codemp} onChange={(e) => setF({ ...f, codemp: e.target.value })}>
                  <option value="">{empresas === null ? "Consultando o ERP…" : "Selecione"}</option>
                  {empresas?.map((e) => <option key={e.codemp} value={e.codemp}>{e.codemp} · {e.nomemp}</option>)}
                </select>
              </div>
            </Field>
            {!programar && <Field label="Saldo na data"><input type="date" className={inputCls} value={f.dataSaldo} onChange={(e) => setF({ ...f, dataSaldo: e.target.value })} /></Field>}
          </div>
        ) : (
          <Field label="Arquivo" hint="Relatório de estoque do ERP em CSV (CÓDIGO;PRODUTOS;UN;BARRAS;P.CUSTO;SALDO…)">
            <input type="file" accept=".csv,.txt" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted file:mr-3 file:h-9 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:text-[13px] file:font-medium file:text-ink hover:file:bg-slate-200" />
          </Field>
        )}

        <div>
          <span className="mb-1.5 block text-[13px] font-medium">Itens a contar</span>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
            {([["todos", "Todos os itens"], ["lista", "Lista personalizada"]] as const).map(([k, n]) => (
              <button type="button" key={k} onClick={() => { setModo(k); if (k === "lista" && !escopoAtivo(escopo)) abrirLista(); }} className={seg(modo === k)}>{n}</button>
            ))}
          </div>
          {modo === "lista" && (
            <button type="button" onClick={abrirLista} className="mt-2 flex w-full items-center gap-3 rounded-lg border border-dashed border-brand-200 bg-brand-50/50 px-3 py-2.5 text-left transition hover:border-brand-500">
              <ListChecks className="size-5 shrink-0 text-brand-700" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{escopoAtivo(escopo) ? descreverEscopo(escopo) : "Montar lista por grupo, subgrupo, marca, tipo ou produto"}</span>
                {resumo && <span className="block text-[12px] text-muted tabular">{resumo.itens.toLocaleString("pt-BR")} itens · {resumo.comSaldo.toLocaleString("pt-BR")} com saldo · {frsK(resumo.valor)}</span>}
              </span>
              <span className="text-[12px] font-semibold text-brand-700">{escopoAtivo(escopo) ? "Editar" : "Montar"}</span>
            </button>
          )}
        </div>

        <EtapaInicial valor={f.etapa} mudar={(v) => setF({ ...f, etapa: v })} />

        {programar && (
          <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Data prevista"><input type="date" className={inputCls} value={f.dataPrevista} onChange={(e) => setF({ ...f, dataPrevista: e.target.value })} /></Field>
              <Field label="Responsável"><SelResponsavel usuarios={usuarios} valor={f.responsavel} mudar={(v) => setF({ ...f, responsavel: v })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Repetir"><select className={inputCls} value={f.repetir} onChange={(e) => setF({ ...f, repetir: e.target.value })}>{REPETIR.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
              {f.repetir && <Field label="Quantas vezes"><input type="number" min={2} max={24} className={inputCls} value={f.vezes} onChange={(e) => setF({ ...f, vezes: e.target.value })} /></Field>}
            </div>
            <Field label="Observação"><input className={inputCls} value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} placeholder="Ex.: parar expedição às 16h" /></Field>
          </div>
        )}

        {erpErro && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-amber-200">ERP indisponível: {erpErro}</p>}
        <Button type="submit" size="lg" className="w-full" loading={salvando}>
          {programar ? <><CalendarPlus className="size-4" />{f.repetir ? `Programar ${f.vezes} inventários` : "Programar inventário"}</> : "Abrir inventário e congelar saldos"}
        </Button>
      </form>
      <MontarLista aberto={listaAberta} fechar={() => setListaAberta(false)} prods={prods} erro={prevErro} escopo={escopo} aplicar={setEscopo} />
    </div>
  );
}
