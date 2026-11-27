"use client";
// Recebimento › um pedido (design/pages/recebimento_v2.html, estados "vincular" e "gestao").
// Sem nota: o painel sugere (mesmo fornecedor, lançadas da chegada a 7 dias depois, sem recebimento; a forte tem os mesmos
// produtos e quantidades) e alguém confirma com um clique. Com nota: pedido × contagem × recontagem × recebido × nota (ENTRADAS2).
// Vermelho em "Na nota" = a nota cobra mais do que chegou. As decisões (encerrar, nova contagem, cancelar) não vão para o Lieto.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Topo } from "@/components/topo";
import { Button, Card, Carregando, Modal, cx, inputCls, useConfirm, useToast } from "@/components/ui";
import { api, fq, type Row } from "@/lib/client";
import { validadeTexto } from "@/lib/paletes";
import { FINAIS, MODO, SITUACAO, dm, dmh, nf, selo } from "@/lib/recebimento";

const hm = (s?: string | null) => (s ? s.slice(11, 16) : "");
const dmhs = (a?: string | null, b?: string | null) => (a ? `${dm(a)} ${hm(a)}${b ? (b.slice(0, 10) === a.slice(0, 10) ? `–${hm(b)}` : ` a ${dmh(b)}`) : ""}` : "");
const lista = (l: Row[]) => { const t = l.map((x) => `${fq(x.qtd)} ${x.unipro} de ${x.nompro}`); return t.length > 1 ? `${t.slice(0, -1).join(", ")} e ${t.at(-1)}` : t[0]; };
const soma = (l: Row[]) => l.reduce((s, x) => s + x.qtd, 0);
type Acao = { a: "encerrar" | "restante" | "cancelar"; titulo: string; texto: string; botao: string };

export default function Pagina() {
  const id = Number(useParams<{ id: string }>().id), [d, setD] = useState<Row | null>(null), [erro, setErro] = useState(""), [todos, setTodos] = useState(false);
  const [acao, setAcao] = useState<Acao | null>(null), [obs, setObs] = useState(""), [oc, setOc] = useState(false), toast = useToast(), { confirmar, dialogo } = useConfirm();
  const ler = useCallback(() => api(`recebimento/${id}/gestao`).then((r) => { setD(r); setErro(""); }).catch((e) => setErro((e as Error).message)), [id]);
  useEffect(() => { ler(); const t = setInterval(ler, 20_000); return () => clearInterval(t); }, [ler]);
  async function fazer(caminho: string, corpo: Row, ok: string) {
    setOc(true);
    try { setD(await api(`recebimento/${id}/${caminho}`, corpo)); toast(ok); setAcao(null); setObs(""); } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); }
  }
  if (!d) return <><Topo />{erro ? <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6"><Voltar /><p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{erro}</p></main> : <Carregando pagina />}</>;
  const nome = SITUACAO[d.status]?.[0] || d.status, fim = FINAIS.includes(d.status), aberto = ["CONTANDO", "RECONTANDO"].includes(d.status);
  const linhas: Row[] = d.linhas, temRec = linhas.some((l) => l.rec != null), temNota = !!d.nota;
  const dif = (l: Row) => (l.pedido != null ? l.recebido !== l.pedido : l.recebido > 0) || (temNota && l.nota !== l.recebido) || l.falta;
  const ped = linhas.filter((l) => l.pedido != null), ndif = ped.filter((l) => l.recebido !== l.pedido).length;
  const ordem = [...linhas].sort((a, b) => Number(dif(b)) - Number(dif(a))), mostrar = todos || !ordem.some(dif) ? ordem : ordem.filter(dif), ocultos = ordem.length - mostrar.length;
  const divPed = ped.some((l) => l.recebido !== l.pedido);
  return (
    <><Topo /><main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <Voltar />
      <h1 className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-semibold">Pedido {fq(d.pedido)} · {d.fornecedor} <span className={selo(d.status)}>{nome}</span>{d.restante && <span className="text-sm font-normal text-muted">o restante ainda vem</span>}</h1>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
        <span>Pedido do fornecedor <b className="text-ink">{d.pedfor || "—"}</b></span>
        <span>{aberto && !d.fechado_em ? "Conferindo" : "Conferido por"} <b className="text-ink">{d.usuario}</b> ({MODO[d.modo]}), {dmhs(d.criado_em, d.fechado_em)}</span>
        {d.rec_por && <span>Recontagem <b className="text-ink">{d.rec_por}</b> {hm(d.rec_em)}</span>}
        {fim && <span><b className="text-ink">{ped.length}</b> {ped.length === 1 ? "produto" : "produtos"} · {ndif ? `${ndif} com diferença do pedido` : "tudo bateu com o pedido"}</span>}
        {d.origem && <span>Continua o <Link className="text-brand-700 underline" href={`/recebimento/${d.origem}`}>recebimento anterior</Link></span>}
      </div>
      {d.status === "RECONTANDO" && <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Em recontagem no coletor: {linhas.filter((l) => l.recontar).length} produto(s), do zero, sem ver a 1ª contagem.</p>}
      {d.obs_fim && <p className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-100 px-4 py-3 text-sm"><b>{d.status === "CANCELADO" ? "Cancelado" : "Encerrado"} por {d.fim_por}, {dmh(d.fim_em)}:</b> {d.obs_fim}</p>}

      {d.nota ? <Card className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 p-4 text-sm">
          <span><b>Nota de entrada:</b> NF {nf(d.nota.numnot)}{d.nota.sernot ? ` série ${d.nota.sernot}` : ""} · lançada no Lieto {dm(d.nota.datdoc)} · {d.nota_como === "CHAVE" ? "vinculada sozinha pela chave bipada" : `vinculada por ${d.nota_por}, ${dmh(d.nota_em)}`}{d.nota.codfor && d.nota.fornecedor !== d.fornecedor ? <b className="text-amber-800"> · nota de outro fornecedor: {d.nota.fornecedor}</b> : null}</span>
          {d.status !== "CANCELADO" && <Button size="sm" variant="secondary" className="ml-auto" disabled={oc} onClick={async () => { if (await confirmar({ titulo: "Desvincular a nota?", texto: d.nota_como === "CHAVE" ? `A NF ${nf(d.nota.numnot)} sai deste recebimento e a chave bipada é esquecida, para não vincular de novo sozinha.` : `A NF ${nf(d.nota.numnot)} sai deste recebimento e volta para as sugestões.`, acao: "Desvincular" })) fazer("nota/remover", {}, "Nota desvinculada."); }}>Desvincular</Button>}
        </Card>
        : fim && <Vincular d={d} oc={oc} vincular={(n) => fazer("nota", { numdoc: n.numdoc }, `NF ${nf(n.numnot)} vinculada.`)} />}
      {aberto && !d.nota && <p className="mt-4 rounded-xl bg-slate-100 px-4 py-3 text-sm text-muted">{d.chave ? `DANFE bipada: nota ${Number(d.chaveNumero).toLocaleString("pt-BR")}. Quando for lançada no Lieto, vincula sozinha.` : "A nota é vinculada aqui depois que a contagem fechar."}</p>}

      {temNota && (d.cobra.length || d.sobra.length ? <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {d.cobra.length > 0 && <><b>A nota cobra {fq(soma(d.cobra))} que não {soma(d.cobra) === 1 ? "chegou" : "chegaram"}:</b> {lista(d.cobra)}. </>}
          {d.sobra.length > 0 && <>{d.cobra.length ? "Chegaram" : <b>Chegaram</b>} {fq(soma(d.sobra))} que a nota não cobra: {lista(d.sobra)}.</>}</p>
        : <p className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800"><b>A nota bate com o que chegou:</b> os mesmos produtos e as mesmas quantidades.</p>)}

      <Card className="mt-4"><div className="scroll-fino overflow-x-auto"><table className="w-full text-[13px]">
        <thead className="text-[12px] text-muted"><tr className="border-b border-line">
          <th className="px-4 py-2.5 text-left font-medium">Produto</th><th className="px-3 text-right font-medium">Pedido</th><th className="px-3 text-right font-medium">Contagem</th>
          {temRec && <th className="px-3 text-right font-medium">Recontagem</th>}<th className="px-3 text-right font-medium">Recebido</th>{temNota && <th className="px-3 text-right font-medium">Na nota</th>}<th className="px-4 text-left font-medium">Validade</th></tr></thead>
        <tbody>{mostrar.map((l) => { const vals: Row[] = l.validades.filter((v: Row) => v.validade || v.lote); return (
          <tr key={l.codpro} className={cx("border-b border-line last:border-0", (l.fora || l.semcad || (l.pedido == null && l.nota)) && "bg-amber-50/50")}>
            <td className="px-4 py-2.5">{l.semcad ? <>Código sem cadastro <span className="tabular">{l.codigo}</span></> : <>{l.nompro}{l.unipro && <span className="text-muted"> · {l.unipro}</span>}</>}
              {l.fora && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">fora do pedido</span>}
              {!l.fora && !l.semcad && l.pedido == null && <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-800">só na nota</span>}
              {l.falta && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">não veio o resto</span>}
              {l.recontar && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">recontando</span>}</td>
            <td className="px-3 text-right tabular">{l.pedido != null ? fq(l.pedido) : "—"}</td>
            <td className="px-3 text-right tabular">{l.pedido == null && !l.con && l.nota ? "—" : fq(l.con)}</td>
            {temRec && <td className="px-3 text-right tabular">{l.rec != null ? fq(l.rec) : ""}</td>}
            <td className={cx("px-3 text-right font-semibold tabular", l.pedido != null && l.recebido !== l.pedido && "text-rose-700", l.pedido == null && l.recebido > 0 && "text-amber-800")}>{l.pedido == null && !l.recebido && l.nota ? "—" : fq(l.recebido)}</td>
            {temNota && <td className={cx("px-3 text-right tabular", l.nota > l.recebido && "bg-rose-50 font-semibold text-rose-700")}>{l.nota ? fq(l.nota) : "—"}</td>}
            <td className="px-4 tabular">{vals.length ? vals.map((v) => `${v.validade ? validadeTexto(v.validade) : "sem validade"}${v.lote ? ` (lote ${v.lote})` : ""}${vals.length > 1 ? `: ${fq(v.qtd)}` : ""}`).join(" · ") : l.semValidade ? <span className="text-muted">sem validade</span> : <span className="text-muted">—</span>}</td>
          </tr>); })}
          {ocultos > 0 && <tr><td colSpan={7} className="px-4 py-2.5"><button className="text-muted underline hover:text-ink" onClick={() => setTodos(true)}>+ {ocultos} {ocultos === 1 ? "produto que bateu" : "produtos que bateram"}</button></td></tr>}
          {todos && ordem.some((l) => !dif(l)) && mostrar.some(dif) && <tr><td colSpan={7} className="px-4 py-2.5"><button className="text-muted underline hover:text-ink" onClick={() => setTodos(false)}>Mostrar só as diferenças</button></td></tr>}
        </tbody></table></div>
        {!linhas.length && <p className="p-6 text-center text-sm text-muted">Nenhum produto.</p>}</Card>

      {d.status !== "ENCERRADO" && d.status !== "CANCELADO" && <div className="mt-4 flex flex-wrap gap-2">
        {d.status === "DIFERENCA" && <>
          <Button variant="dark" disabled={oc} onClick={() => setAcao({ a: "encerrar", titulo: "Encerrar com a diferença?", texto: "O recebimento fica como chegou. Nada é gravado no Lieto.", botao: "Encerrar" })}>Encerrar com a diferença</Button>
          <Button variant="secondary" disabled={oc || !d.falta} title={d.falta ? "" : "Não falta nada do pedido"} onClick={() => setAcao({ a: "restante", titulo: "Encerrar: o restante ainda vem?", texto: "O pedido volta para a fila do coletor só com o que faltou.", botao: "Encerrar e esperar o restante" })}>Encerrar: o restante ainda vem</Button>
          <Button variant="secondary" disabled={oc || !divPed} title={divPed ? "" : "Os produtos do pedido bateram: a diferença é do que veio fora do pedido"} onClick={async () => { if (await confirmar({ titulo: "Pedir nova contagem?", texto: `${ndif} produto(s) com diferença voltam para o coletor, para contar de novo do zero.`, acao: "Pedir nova contagem" })) fazer("recontar", {}, "Nova contagem pedida."); }}>Pedir nova contagem</Button>
        </>}
        <Button variant="danger" disabled={oc} onClick={() => setAcao({ a: "cancelar", titulo: "Cancelar o recebimento?", texto: aberto ? "A contagem para no coletor e o pedido volta para a fila." : "O recebimento é descartado e o pedido volta para a fila.", botao: "Cancelar recebimento" })}>Cancelar recebimento</Button>
      </div>}
      {d.status === "DIFERENCA" && <p className="mt-2 text-sm text-muted">Encerrar e cancelar pedem uma observação (ex.: &quot;fornecedor manda o restante na próxima entrega&quot;). Nada disso é gravado no Lieto.</p>}

      <Modal aberto={!!acao} onClose={() => !oc && setAcao(null)} titulo={acao?.titulo} descricao={acao?.texto}
        rodape={<><Button variant="secondary" disabled={oc} onClick={() => setAcao(null)}>Voltar</Button><Button variant={acao?.a === "cancelar" ? "dark" : "primary"} loading={oc} disabled={!obs.trim()} title={obs.trim() ? "" : "Escreva o motivo"} onClick={() => acao && fazer(acao.a === "cancelar" ? "cancelar" : "encerrar", { obs, restante: acao.a === "restante" }, acao.a === "cancelar" ? "Recebimento cancelado." : "Recebimento encerrado.")}>{acao?.botao}</Button></>}>
        <label className="block text-sm font-medium">Motivo<textarea autoFocus rows={3} maxLength={500} className={inputCls + " mt-1.5 !h-auto py-2"} value={obs} onChange={(e) => setObs(e.target.value)} placeholder={acao?.a === "cancelar" ? "Ex.: pedido aberto errado" : "Ex.: fornecedor manda o restante na próxima entrega"} /></label>
      </Modal>
      {dialogo}
    </main></>
  );
}

function Voltar() { return <Link href="/recebimento" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft className="size-4" />Recebimento</Link>; }

// Sem nota: as sugestões e a busca pelo número (qualquer fornecedor) quando ela não aparece
function Vincular({ d, oc, vincular }: { d: Row; oc: boolean; vincular: (n: Row) => void }) {
  const [s, setS] = useState<Row | null>(null), [num, setNum] = useState(""), [busca, setBusca] = useState(""), [erro, setErro] = useState("");
  useEffect(() => { setErro(""); api(`recebimento/${d.id}/notas${busca ? `?numero=${encodeURIComponent(busca)}` : ""}`).then(setS).catch((e) => setErro((e as Error).message)); }, [d.id, busca]);
  const ns: Row[] = s?.notas || [];
  return (
    <Card className="mt-4 p-4 text-sm">
      <b className="text-[15px]">Vincular a nota de entrada</b>
      <p className="mt-0.5 text-muted">{busca ? `Notas com o número ${busca}, de qualquer fornecedor.` : s ? `Notas de ${d.fornecedor} lançadas no Lieto de ${dm(s.de)} a ${dm(s.ate)} que ainda não têm recebimento.` : "Procurando as notas…"} {!busca && (d.chave ? `A DANFE bipada (nota ${Number(d.chaveNumero).toLocaleString("pt-BR")}) ainda não foi lançada no Lieto.` : "A DANFE não foi bipada no coletor.")}</p>
      {erro && <p className="mt-2 text-rose-700">{erro}</p>}
      {s && (ns.length ? <div className="scroll-fino mt-3 overflow-x-auto"><table className="w-full text-[13px]">
        <thead className="text-[12px] text-muted"><tr className="border-b border-line"><th className="py-2 pr-4 text-left font-medium">Nota</th>{busca && <th className="pr-4 text-left font-medium">Fornecedor</th>}<th className="pr-4 text-left font-medium">Lançada</th><th className="pr-4 text-left font-medium">Emissão</th><th className="pr-4 text-right font-medium">Itens</th><th className="pr-4 text-right font-medium">Produtos em comum</th><th className="pr-4 text-right font-medium">Quantidades</th><th /></tr></thead>
        <tbody>{ns.map((n) => <tr key={n.numdoc} className="border-b border-line last:border-0">
          <td className={cx("py-2 pr-4 tabular", n.forte && "font-semibold")}>NF {nf(n.numnot)}{n.sernot ? <span className="text-muted"> série {n.sernot}</span> : null}{n.forte && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">sugestão forte</span>}</td>
          {busca && <td className="pr-4">{n.fornecedor}</td>}
          <td className="pr-4 tabular">{dm(n.datdoc)}</td><td className="pr-4 tabular">{dm(n.datemi)}</td><td className="pr-4 text-right tabular">{n.itens}</td>
          <td className={cx("pr-4 text-right tabular", n.comum === n.de && "font-semibold")}>{n.comum} de {n.de}</td><td className="pr-4 text-right tabular">{n.iguais} {n.iguais === 1 ? "igual" : "iguais"}</td>
          <td className="py-1.5 text-right">{n.ocupada != null ? <span className="text-muted">no pedido {fq(n.ocupada)}</span> : <Button size="sm" variant={n.forte ? "primary" : "secondary"} disabled={oc} onClick={() => vincular(n)}>Vincular</Button>}</td>
        </tr>)}</tbody></table></div>
        : <p className="mt-3 rounded-lg bg-slate-50 p-3 text-muted">{busca ? "Nenhuma nota com esse número no Lieto." : "Nenhuma nota deste fornecedor lançada ainda. Quando o escritório lançar a entrada, ela aparece aqui."}</p>)}
      <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setBusca(num.replace(/\D/g, "")); }}>
        <span className="text-muted">Não está aqui?</span>
        <input className={inputCls + " !w-44"} inputMode="numeric" placeholder="Número da nota" value={num} onChange={(e) => setNum(e.target.value)} />
        <Button size="sm" variant="secondary" type="submit" disabled={!num.replace(/\D/g, "")}>Buscar</Button>
        {busca && <Button size="sm" variant="ghost" type="button" onClick={() => { setBusca(""); setNum(""); }}>Voltar às sugestões</Button>}
      </form>
    </Card>
  );
}
