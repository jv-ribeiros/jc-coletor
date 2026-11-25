"use client";
// Vínculo de um item do anúncio: o produto que vai na NOTA e, se for kit, os produtos que SAEM do estoque.
// Ao mudar um vínculo que já importou notas, pergunta o que fazer com elas: só as próximas, todas ou a partir de uma data.
import { useEffect, useState } from "react";
import { BuscaProduto, numero } from "@/components/movimentos";
import { Button, Modal, inputCls, useToast } from "@/components/ui";
import { api, fdata, fq, type Row } from "@/lib/client";

export type Alvo = { emitente: string; cprod: string; un: string; xProd: string; produto: Row | null; fator: string; kit: Row[]; existe: boolean; chave?: string; n?: number };

export function EditorVinculo({ a, lista, admin, fechar, salvo }: { a: Alvo; lista: Row[] | null; admin: boolean; fechar: () => void; salvo: () => void }) {
  const [p, setP] = useState<Row | null>(a.produto), [f, setF] = useState(a.fator), [kit, setKit] = useState<{ codpro: string; nompro: string; unipro: string; q: string }[]>(a.kit.map((k) => ({ codpro: k.codpro, nompro: k.nompro, unipro: k.unipro, q: String(k.qtd).replace(".", ",") })));
  const [notas, setNotas] = useState<Row[] | null>(a.existe ? null : []), [quais, setQuais] = useState<"proximas" | "todas" | "data">("proximas"), [de, setDe] = useState(""), [oc, setOc] = useState(false), [res, setRes] = useState<Row | null>(null), toast = useToast();
  useEffect(() => { if (a.existe) api(`xml/impacto?emitente=${a.emitente}&cprod=${encodeURIComponent(a.cprod)}&un=${encodeURIComponent(a.un)}`).then((r) => setNotas(r.notas)).catch((e) => { toast(e.message, "erro"); setNotas([]); }); }, [a, toast]);
  const aPartir = (notas || []).filter((n) => de && String(n.emissao).slice(0, 10) >= de).length, afeta = quais === "todas" ? (notas || []).length : quais === "data" ? aPartir : 0;
  const ok = !!p && numero(f) > 0 && kit.every((k) => numero(k.q) > 0) && (quais !== "data" || !!de);
  const corpo = () => ({ emitente: a.emitente, cProd: a.cprod, un: a.un, codpro: p!.codpro, fator: numero(f), kit: kit.map((k) => ({ codpro: k.codpro, qtd: numero(k.q) })) });
  function juntar(x: Row) {
    if (kit.some((k) => k.codpro === x.codpro)) return toast("Este produto já está no kit.", "erro");
    if (x.codpro === p?.codpro) return toast("É o próprio produto da nota.", "erro");
    setKit([...kit, { codpro: x.codpro, nompro: x.nompro, unipro: x.unipro, q: "1" }]);
  }
  async function salvar() {
    setOc(true);
    try {
      await api("xml/vincular", corpo()); salvo();
      if (!afeta) { toast("Vínculo salvo."); fechar(); return; }
      setRes(await api("xml/corrigir", { emitente: a.emitente, cprod: a.cprod, un: a.un, de: quais === "data" ? de : "" })); salvo();
    } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); }
  }
  async function cadastrar() {
    setOc(true);
    try { const r = await api("xml/produto", { chave: a.chave, item: a.n, modelo: p!.codpro, kit: corpo().kit }); toast(`Produto ${r.codpro} cadastrado e vinculado.`); salvo(); fechar(); } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); }
  }
  if (res) return (
    <Modal aberto onClose={fechar} titulo="Vínculo salvo" largura="max-w-2xl" rodape={<Button onClick={fechar}>Fechar</Button>}>
      <p className="text-sm">{res.ok} nota(s) corrigida(s) no Lieto.{res.falhas.length > 0 && ` ${res.falhas.length} não mudou(aram):`}</p>
      {res.falhas.length > 0 && <div className="mt-3 max-h-72 overflow-y-auto"><table className="w-full text-[13px]"><thead className="text-left text-[12px] text-muted"><tr className="border-b border-line"><th className="py-2 pr-4">Nota</th><th>Motivo</th></tr></thead><tbody>{res.falhas.map((x: Row, k: number) => <tr key={k} className="border-b border-line"><td className="py-2 pr-4 tabular">{x.numero}</td><td className="text-rose-700">{x.motivo}</td></tr>)}</tbody></table></div>}
    </Modal>
  );
  return (
    <Modal aberto onClose={() => !oc && fechar()} titulo={a.existe ? "Alterar vínculo" : "Vincular"} descricao={`${a.xProd || "Item"} · código no anúncio ${a.cprod}`} largura="max-w-3xl"
      rodape={<><Button variant="secondary" disabled={oc} onClick={fechar}>Cancelar</Button>{!a.existe && <Button variant="secondary" disabled={!admin || !ok || oc || !a.chave} title="Cria no Lieto um produto com o nome do anúncio, copiando grupo e tributação do escolhido" onClick={cadastrar}>Cadastrar novo com este modelo</Button>}<Button loading={oc} disabled={!ok || notas === null} onClick={salvar}>Salvar</Button></>}>
      <div className="max-h-[60vh] space-y-5 overflow-y-auto text-sm">
        <section><b>Produto na nota</b>
          {!p ? <div className="mt-2"><BuscaProduto lista={lista} escolher={setP} /></div> : <div className="mt-2 flex flex-wrap items-center gap-3"><span className="tabular text-muted">{p.codpro}</span><span className="min-w-0 flex-1 font-medium">{p.nompro}</span><Button size="sm" variant="ghost" onClick={() => setP(null)}>Trocar</Button></div>}
          <div className="mt-2 flex items-center gap-2"><span>1 {a.un} do anúncio =</span><input className={inputCls + " !w-24 text-right"} inputMode="decimal" value={f} onChange={(e) => setF(e.target.value)} /><span>{p?.unipro || ""}</span></div>
        </section>
        <section><b>Sai do estoque</b>
          <p className="text-[13px] text-muted">{kit.length ? "É kit: a nota leva o produto acima e o estoque baixa só estes." : "Sem produtos aqui, sai o próprio produto da nota. Se for kit, adicione o que sai em cada 1 vendido."}</p>
          {kit.length > 0 && <table className="mt-2 w-full text-[13px]"><thead className="text-left text-[12px] text-muted"><tr className="border-b border-line"><th className="py-2 pr-3">Código</th><th className="pr-3">Produto</th><th className="pr-3">Qtd</th><th className="pr-3">Un</th><th /></tr></thead>
            <tbody>{kit.map((k, j) => <tr key={k.codpro} className="border-b border-line"><td className="py-2 pr-3 tabular">{k.codpro}</td><td className="pr-3">{k.nompro}</td><td className="pr-3"><input aria-label={`Quantidade de ${k.nompro}`} className={inputCls + " !w-20 text-right"} inputMode="decimal" value={k.q} onChange={(e) => setKit(kit.map((y, n) => (n === j ? { ...y, q: e.target.value } : y)))} /></td><td className="pr-3">{k.unipro}</td><td className="text-right"><Button size="sm" variant="ghost" onClick={() => setKit(kit.filter((_, n) => n !== j))}>Remover</Button></td></tr>)}</tbody></table>}
          <div className="mt-2"><BuscaProduto lista={lista} escolher={juntar} /></div>
        </section>
        {a.existe && <section><b>Notas já importadas</b>
          {notas === null ? <p className="text-muted">Conferindo…</p> : !notas.length ? <p className="text-muted">Nenhuma nota importada com este anúncio. Vale para as próximas.</p> : <>
            <label className="mt-2 flex items-center gap-2"><input type="radio" name="quais" checked={quais === "proximas"} onChange={() => setQuais("proximas")} />Só as próximas. As {notas.length} já importadas ficam como estão.</label>
            <label className="mt-2 flex items-center gap-2"><input type="radio" name="quais" disabled={!admin} checked={quais === "todas"} onChange={() => setQuais("todas")} />Corrigir também todas as {notas.length} deste anúncio ({fdata(notas[0].emissao).slice(0, 10)} a {fdata(notas[notas.length - 1].emissao).slice(0, 10)})</label>
            <label className="mt-2 flex flex-wrap items-center gap-2"><input type="radio" name="quais" disabled={!admin} checked={quais === "data"} onChange={() => setQuais("data")} />Corrigir a partir da emissão<input type="date" className={inputCls + " !w-auto"} disabled={!admin} value={de} onChange={(e) => { setDe(e.target.value); setQuais("data"); }} />{de && <span className="text-muted">{aPartir} nota(s)</span>}</label>
            {!admin && <p className="mt-2 text-[12px] text-muted">Só administradores corrigem notas já importadas.</p>}
            {afeta > 0 && <p className="mt-2 bg-amber-50 p-3 text-amber-900">Muda o produto no pedido e na nota dentro do Lieto, e o estoque acompanha. Valores, impostos e financeiro não mudam. Pedido conferido, devolvido ou alterado no Lieto não é mexido.</p>}
          </>}
        </section>}
      </div>
    </Modal>
  );
}
export const resumoKit = (k: Row[]) => k.map((x) => `${fq(x.qtd)} × ${x.nompro}`).join(" + ");
