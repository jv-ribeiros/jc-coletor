"use client";
// Coletor › Conferência de expedição: contagem cega por pedido; a fila abre por romaneio, pedido ou pendentes.
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, useConfirm, useToast } from "@/components/ui";
import { novoUid, numero, rotFator } from "@/components/movimentos";
import { Observacao } from "@/components/observacao";
import { Campo, Tela, campoCol } from "@/components/coletor";
import { api, chave, fatorLido, fq, r4, type Row } from "@/lib/client";

export default function Pagina() {
  const [c, setC] = useState<Row | null>(null), [fila, setFila] = useState<Row[]>([]), [rom, setRom] = useState(""), [ped, setPed] = useState(""), [rm, setRm] = useState<Row | null>(null), [oc, setOc] = useState(false); const toast = useToast();
  const ler = useCallback(async (q = "") => { try { setFila(await api<Row[]>(`conferencia/fila${q}`)); const r = /romaneio=(\d+)/.exec(q); setRm(r ? await api(`conferencia/romaneio/${r[1]}`) : null); } catch (e) { toast((e as Error).message, "erro"); } }, [toast]);
  useEffect(() => { ler(); }, [ler]);
  const filtro = rom ? `?romaneio=${rom}` : ped ? `?pedido=${ped}` : "";
  async function abrir(x: Row) { try { setC(x.id ? await api(`conferencia/${x.id}`) : await api("conferencia", { pedido: x.pedido })); } catch (e) { toast((e as Error).message, "erro"); } }
  async function abrirRom() { setOc(true); try { setC(await api("conferencia/romaneio", { romaneio: rm!.romaneio })); } catch (e) { toast((e as Error).message, "erro"); ler(filtro); } finally { setOc(false); } }
  if (c) return <Contagem inicial={c} sair={() => { setC(null); ler(filtro); }} />;
  return (
    <Tela titulo="Conferência de expedição">
      <form className="grid grid-cols-[1fr_1fr_auto] items-end gap-2" onSubmit={(e) => { e.preventDefault(); ler(filtro); }}>
        <Campo nome="Romaneio"><input className={campoCol} inputMode="numeric" disabled={!!ped} value={rom} onChange={(e) => setRom(e.target.value.replace(/\D/g, ""))} /></Campo>
        <Campo nome="Pedido"><input className={campoCol} inputMode="numeric" disabled={!!rom} value={ped} onChange={(e) => setPed(e.target.value.replace(/\D/g, ""))} /></Campo><Button size="lg">Buscar</Button>
      </form>
      <Button size="lg" className="w-full" loading={oc} disabled={!rm || (!rm.aberta && !rm.entram.length)} onClick={abrirRom}>{!rm ? "Conferir romaneio inteiro" : rm.aberta ? `Continuar romaneio ${rm.romaneio} (${rm.aberta.usuario})` : `Conferir romaneio ${rm.romaneio}: ${rm.entram.length} pedido(s)`}</Button>
      {rm && rm.fora.length > 0 && <div className="border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900"><b>{rm.fora.length} pedido(s) ficam de fora:</b> {rm.fora.map((x: Row) => `${x.pedido} (${x.motivo})`).join(", ")}</div>}
      <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Ou um pedido</p>
      <div className="border border-line bg-white">{!fila.length && <p className="p-4 text-sm text-muted">Nenhum pedido.</p>}
        {fila.map((x) => { const feito = !!x.conferencia && x.conferencia !== "EM ANDAMENTO", fora = !["PED", "FAT"].includes(x.situacao); return (
          <button key={x.pedido} disabled={feito || fora || x.noRomaneio} onClick={() => abrir(x)} className="flex w-full items-center justify-between gap-3 border-b border-line p-3 text-left text-sm last:border-0 disabled:opacity-40">
            <span className="min-w-0"><b>Pedido {x.pedido}</b>{x.romaneio ? <span className="text-muted"> · rom. {x.romaneio}</span> : null}<span className="block truncate text-muted">{x.cliente}</span></span>
            <span className="shrink-0 text-right text-[12px]">{x.itens} itens<span className="block font-semibold">{x.conferencia ? `${x.conferencia}${x.usuario ? " · " + x.usuario : ""}` : fora ? x.situacao : ""}</span></span>
          </button>); })}</div>
    </Tela>
  );
}

function Contagem({ inicial, sair }: { inicial: Row; sair: () => void }) {
  const [c, setC] = useState(inicial), [aba, setAba] = useState("ler"), [b, setB] = useState(""), [it, setIt] = useState<Row | null>(null), [q, setQ] = useState(""), [oc, setOc] = useState(false), [ult, setUlt] = useState(""), [obs, setObs] = useState<string>(inicial.obs || "");
  const toast = useToast(), { confirmar, dialogo } = useConfirm(), ref = useRef<HTMLInputElement>(null), uid = useRef(novoUid());
  const rec = c.status === "RECONTANDO", fim = !["CONTANDO", "RECONTANDO"].includes(c.status);
  useEffect(() => { if (!it && aba === "ler") ref.current?.focus(); }, [it, aba, c]);
  const achar = (t: string) => c.itens.find((i: Row) => i.codigos.some((x: string) => chave(x) === chave(t)));
  const achados = b.trim().length > 1 && !achar(b) ? c.itens.filter((i: Row) => b.trim().toUpperCase().split(/\s+/).every((w) => i.nompro.toUpperCase().includes(w))) : [];
  const pegar = (i: Row, cod = "") => { i = { ...i, fator: cod ? fatorLido(i, cod) : 1 }; setIt(i); setB(""); setQ(""); uid.current = novoUid(); };
  function ler(e: React.FormEvent) { e.preventDefault(); if (!b.trim()) return; const i = achar(b) || (achados.length === 1 ? achados[0] : null); if (i) pegar(i, achar(b) ? b : ""); else if (!achados.length) { toast(c.pedidos ? "Este produto não é deste romaneio." : "Este produto não é deste pedido.", "erro"); try { navigator.vibrate?.([140, 70, 140]); } catch {} setB(""); } }
  async function contar(modo: "soma" | "fixa") {
    if (!it || oc) return;
    setOc(true);
    try { setC(await api(`conferencia/${c.id}/contar`, { uid: uid.current, codigo: it.codpro, qtd: r4(numero(q) * (it.fator || 1)), modo })); setUlt(`${modo === "soma" ? "+" : "="}${fq(r4(numero(q) * (it.fator || 1)))} ${it.unipro} · ${it.nompro}`); setIt(null); setQ(""); try { navigator.vibrate?.(35); } catch {} }
    catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); }
  }
  async function fechar() {
    const zero = c.itens.filter((i: Row) => !i.contado).length;
    if (!(await confirmar({ titulo: rec ? "Fechar a reconferência?" : "Fechar a contagem?", texto: zero ? `${zero} item(ns) ainda sem quantidade.` : "O que divergir volta para reconferência." }))) return;
    setOc(true);
    try { const r = await api(`conferencia/${c.id}/fechar`, { obs }); setC(r); setIt(null); setAba("ler"); toast(r.divergentes ? `${r.divergentes} item(ns) para reconferir.` : "Conferido e gravado no Lieto.", r.divergentes ? "erro" : "ok"); } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); }
  }
  return (
    <Tela titulo={c.pedidos ? `Romaneio ${c.romaneio}` : `Pedido ${c.pedido}`} sub={c.cliente} voltar={sair} abas={[{ k: "ler", n: rec ? "Reconferir" : "Contar" }, { k: "lista", n: `Itens (${c.itens.filter((i: Row) => i.contado > 0).length}/${c.itens.length})` }]} aba={aba} mudar={setAba}>
      {fim ? <div className="border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900"><b>{c.status === "CONFERIDA" ? (c.pedidos ? `Romaneio conferido: ${c.pedidos.length} pedido(s) gravados no Lieto.` : "Pedido conferido.") : c.status}</b>{c.numide && !c.pedidos ? ` Conferência nº ${c.numide} no Lieto.` : ""}<Button size="lg" className="mt-3 w-full" onClick={sair}>Próximo</Button></div> : aba === "ler" ? <>
        {rec && <div className="border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Conte de novo só os {c.itens.length} item(ns) que divergiram.</div>}
        <form onSubmit={ler}><Campo nome="Produto"><input ref={ref} className={campoCol} disabled={!!it} placeholder="Leia o código ou digite o nome" value={it ? it.nompro : b} onChange={(e) => setB(e.target.value)} /></Campo></form>
        {achados.length > 0 && <div className="border border-line bg-white">{achados.map((i: Row) => <button key={i.codpro} onClick={() => pegar(i)} className="block w-full border-b border-line p-3 text-left text-sm last:border-0">{i.nompro}</button>)}</div>}
        <Campo nome={`Quantidade${it ? ` (${it.unipro})` : ""}${rotFator(it, q)}`}><input key={it?.codpro || "-"} autoFocus={!!it} className={campoCol + " !h-16 text-center !text-[28px] font-bold"} inputMode="decimal" disabled={!it} value={q} onChange={(e) => setQ(e.target.value.replace(/[^\d,.]/g, ""))} onKeyDown={(e) => { if (e.key === "Enter" && numero(q) > 0) contar("soma"); }} /></Campo>
        <div className="grid grid-cols-2 gap-2"><Button size="lg" loading={oc} disabled={!it || !(numero(q) > 0)} onClick={() => contar("soma")}>Somar</Button><Button size="lg" variant="secondary" disabled={!it || oc} onClick={() => setIt(null)}>Limpar</Button></div>
        <div className="min-h-10 border border-line bg-white p-2.5 text-[13px] text-muted">{ult || "Última leitura aparece aqui."}</div>
        <Observacao valor={obs} mudar={setObs} />
        <Button size="lg" variant="dark" className="w-full" disabled={oc || !!it} onClick={fechar}>{rec ? "Fechar reconferência" : "Fechar contagem"}</Button>
      </> : <div className="border border-line bg-white">{c.itens.map((i: Row) => <div key={i.codpro} className="flex items-center justify-between gap-3 border-b border-line p-3 text-sm last:border-0"><span className="min-w-0"><span className="block">{i.nompro}</span><span className="text-[12px] text-muted">{i.codpro}</span></span><span className="flex shrink-0 items-center gap-2"><b className="tabular">{fq(i.contado)} {i.unipro}</b><button disabled={!i.contado || oc} className="border border-line px-2 py-1 text-[12px] disabled:opacity-35" onClick={async () => { if (await confirmar({ titulo: "Zerar a contagem deste item?", texto: i.nompro })) try { setC(await api(`conferencia/${c.id}/contar`, { uid: novoUid(), codigo: i.codpro, qtd: 0, modo: "fixa" })); } catch (e) { toast((e as Error).message, "erro"); } }}>Zerar</button></span></div>)}</div>}
      {dialogo}
    </Tela>
  );
}
