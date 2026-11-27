"use client";
// Recebimento › lista (design/pages/recebimento_v2.html, estado "lista"). O recebimento é controlado aqui, à parte do Lieto:
// a coluna "Nota de entrada" é o controle, todo recebimento termina com uma nota vinculada. A faixa amarela é o outro sentido:
// nota de compra lançada no Lieto sem nada recebido (as operações de compra são escolhidas em Sistema › Recebimento).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Topo, usePode } from "@/components/topo";
import { Card, Carregando, cx, inputCls, usePaginacao, useToast } from "@/components/ui";
import { api, fq, ls, type Row } from "@/lib/client";
import { FINAIS, MODO, SITUACAO, dm, dmh, nf, selo } from "@/lib/recebimento";

const diasDesde = (s: string) => Math.floor((Date.now() - Date.parse(s.replace(" ", "T"))) / 864e5);
type Filtro = "abertos" | "semnota" | "diferenca" | "todos";

export default function Pagina() {
  const [d, setD] = useState<Row | null>(null), [erro, setErro] = useState(""), [f, setF] = useState<Filtro>("todos"), [b, setB] = useState(""), [verNotas, setVerNotas] = useState(false);
  const toast = useToast(), router = useRouter(), admin = usePode()(["admin"]);
  const ler = useCallback(() => api("recebimento").then((r) => { setD(r); setErro(""); }).catch((e) => { setErro(e.message); toast(e.message, "erro"); }), [toast]);
  useEffect(() => { ler(); const t = setInterval(ler, 20_000); return () => clearInterval(t); }, [ler]);
  useEffect(() => { setF(ls.get<Filtro>("rec.filtro", "todos")); }, []);
  const mudar = (x: Filtro) => { setF(x); ls.set("rec.filtro", x); };
  const grupos = useMemo(() => {
    const l: Row[] = d?.lista || [];
    return { abertos: l.filter((x) => ["CONTANDO", "RECONTANDO"].includes(x.status)), semnota: l.filter((x) => FINAIS.includes(x.status) && !x.nota), diferenca: l.filter((x) => x.status === "DIFERENCA"), todos: l };
  }, [d]);
  const q = b.trim().toUpperCase(), l = grupos[f].filter((x) => !q || `${x.pedido} ${x.fornecedor} ${x.usuario} ${x.nota?.numnot || ""}`.toUpperCase().includes(q)), { itens, controles } = usePaginacao(l, 25, f + q);
  if (!d && !erro) return <><Topo /><Carregando pagina /></>;
  const sem: Row[] = d?.notasSem || [];
  return (
    <><Topo /><main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold">Recebimento</h1>
      <p className="mt-1 text-sm text-muted">O que chegou, conferido no coletor, e a nota de entrada de cada um.</p>
      {sem.length > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><b>{sem.length === 1 ? "1 nota de compra lançada sem recebimento:" : `${sem.length} notas de compra lançadas sem recebimento:`}</b>
          <span>{sem.slice(0, 2).map((n) => `NF ${nf(n.numnot)} · ${n.fornecedor} · lançada ${dm(n.datdoc)}`).join("  ·  ")}{sem.length > 2 ? "  ·  …" : ""}</span>
          <button className="ml-auto rounded-md px-2 py-1 font-semibold text-amber-900 underline hover:bg-amber-100" onClick={() => setVerNotas((x) => !x)}>{verNotas ? "Esconder" : "Ver"}</button></div>
        {verNotas && <table className="mt-3 w-full text-[13px]"><thead className="text-left text-[12px] text-amber-800"><tr><th className="py-1 pr-4 font-medium">Nota</th><th className="pr-4 font-medium">Fornecedor</th><th className="pr-4 font-medium">Lançada</th><th className="font-medium">Emissão</th></tr></thead>
          <tbody>{sem.map((n) => <tr key={n.numdoc} className="border-t border-amber-200"><td className="py-1.5 pr-4 tabular">NF {nf(n.numnot)}{n.sernot ? ` série ${n.sernot}` : ""}</td><td className="pr-4">{n.fornecedor}</td><td className="pr-4 tabular">{dm(n.datdoc)}</td><td className="tabular">{dm(n.datemi)}</td></tr>)}</tbody></table>}
      </div>}
      {d && !d.compraConfigurada && admin && <p className="mt-4 rounded-xl bg-slate-100 px-4 py-3 text-sm text-muted">Para ver as notas de compra lançadas sem recebimento, escolha em <Link href="/sistema" className="font-medium text-brand-700 underline">Sistema › Recebimento</Link> quais operações do Lieto são compra.</p>}
      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="flex flex-wrap gap-1.5">{([["abertos", "Abertos"], ["semnota", "Sem nota"], ["diferenca", "Com diferença"], ["todos", "Todos"]] as [Filtro, string][]).map(([k, n]) =>
            <button key={k} onClick={() => mudar(k)} className={cx("h-9 rounded-full border px-3.5 text-[13px] font-medium transition", f === k ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:bg-slate-50")}>{n}{k !== "todos" && <span className={cx("ml-1.5 tabular", f === k ? "text-white/70" : "text-muted")}>{grupos[k].length}</span>}</button>)}</div>
          <input className={inputCls + " min-w-[220px] flex-1"} placeholder="Pedido, fornecedor, conferente, nota" value={b} onChange={(e) => setB(e.target.value)} />
        </div>
        <div className="scroll-fino overflow-x-auto"><table className="w-full text-[13px]">
          <thead className="text-left text-[12px] text-muted"><tr className="border-b border-line">{["Pedido", "Fornecedor", "Chegou", "Conferido por", "Situação", "Nota de entrada"].map((h) => <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>{itens.map((x) => { const nome = SITUACAO[x.status]?.[0] || x.status, fim = FINAIS.includes(x.status), atraso = fim && !x.nota && x.fim ? diasDesde(x.fim) : 0; return (
            <tr key={x.id} onClick={() => router.push(`/recebimento/${x.id}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-slate-50">
              <td className="px-4 py-2.5 font-semibold tabular"><Link href={`/recebimento/${x.id}`} onClick={(e) => e.stopPropagation()}>{fq(x.pedido)}</Link></td>
              <td className="px-4 py-2.5">{x.fornecedor}</td>
              <td className="whitespace-nowrap px-4 py-2.5 tabular">{dmh(x.criado_em)}</td>
              <td className="whitespace-nowrap px-4 py-2.5">{x.usuario} <span className="text-muted">· {MODO[x.modo]}</span></td>
              <td className="whitespace-nowrap px-4 py-2.5"><span className={selo(x.status)}>{nome}</span>{x.status === "ENCERRADO" && x.restante && <span className="ml-1.5 text-muted">restante a vir</span>}{x.status === "DIFERENCA" && x.divergentes > 0 && <span className="ml-1.5 text-muted">{x.divergentes} {x.divergentes === 1 ? "produto" : "produtos"}</span>}</td>
              <td className="whitespace-nowrap px-4 py-2.5">{x.nota ? <>NF {nf(x.nota.numnot)}{x.nota_como === "CHAVE" && <span className="text-muted"> · pela chave bipada</span>}</>
                : fim ? <span className="inline-flex items-center gap-2"><Link href={`/recebimento/${x.id}`} onClick={(e) => e.stopPropagation()} className={cx("inline-flex h-7 items-center rounded-md px-2.5 text-[12.5px] font-semibold", x.sugestao?.forte ? "bg-brand-700 text-white hover:bg-brand-800" : "border border-line bg-white hover:bg-slate-50")}>Vincular</Link>
                  {x.sugestao?.forte ? <span className="text-muted">{x.sugestao.forte === 1 ? "1 sugestão forte" : `${x.sugestao.forte} sugestões fortes`}</span>
                    : atraso >= 1 ? <span className="font-semibold text-amber-800">sem nota há {atraso} {atraso === 1 ? "dia" : "dias"}</span>
                    : x.sugestao?.total ? <span className="text-muted">{x.sugestao.total === 1 ? "1 sugestão" : `${x.sugestao.total} sugestões`}</span>
                    : <span className="text-muted">{x.chave ? "nota bipada, ainda não lançada" : "nenhuma nota lançada ainda"}</span>}</span>
                : <span className="text-muted">—</span>}</td>
            </tr>); })}</tbody></table></div>
        {!l.length && <p className="p-8 text-center text-sm text-muted">{q ? "Nada encontrado com essa busca." : f === "todos" ? "Nenhum recebimento ainda. Eles são abertos no coletor, em Receber." : f === "abertos" ? "Nenhum recebimento sendo conferido agora." : f === "semnota" ? "Todo recebimento conferido já tem nota." : "Nenhum recebimento com diferença."}</p>}
        <div className="px-4">{controles}</div>
      </Card>
    </main></>
  );
}
