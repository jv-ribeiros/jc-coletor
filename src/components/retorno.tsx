"use client";
import { useEffect, useState } from "react";
import { Button, useToast } from "@/components/ui";
import { BuscaProduto, Rot, novoUid, numero, rotFator, useProdutos } from "@/components/movimentos";
import { Observacao } from "@/components/observacao";
import { Campo, campoCol } from "@/components/coletor";
import { api, fq, r4, type Row } from "@/lib/client";

export function FormRetorno({ salvo }: { salvo?: () => void }) {
  const lista = useProdutos(), toast = useToast();
  const [op, setOp] = useState<Row>({ motoristas: [], motivos: [], centros: [] }), [tipo, setTipo] = useState("R"), [n, setN] = useState(""), [o, setO] = useState<Row | null>(null), [mot, setMot] = useState(0);
  const [p, setP] = useState<Row | null>(null), [q, setQ] = useState(""), [motivo, setMotivo] = useState(0), [centro, setCentro] = useState(1), [itens, setItens] = useState<Row[]>([]), [oc, setOc] = useState(false), [uid, setUid] = useState(novoUid), [obs, setObs] = useState("");
  useEffect(() => { api("retorno/opcoes").then(setOp).catch((e) => toast(e.message, "erro")); }, [toast]);
  const limpar = () => { setO(null); setP(null); setQ(""); setItens([]); setUid(novoUid()); };
  async function abrir(e: React.FormEvent) { e.preventDefault(); try { const r = await api(`retorno/origem/${tipo}/${Number(n)}`); limpar(); setO(r); if (r.motorista && op.motoristas.some((m: Row) => m.id === r.motorista)) setMot(r.motorista); } catch (x) { toast((x as Error).message, "erro"); } }
  const pronto = tipo === "A" || !!o, saldo = p && o ? p.saiu - p.voltou - itens.filter((i) => i.codpro === p.codpro).reduce((s, i) => s + i.qtd, 0) : null;
  const real = r4(numero(q) * (p?.fator || 1));
  const escolher = (x: Row) => { if (tipo === "A") return setP(x); const i = o?.itens.find((y: Row) => y.codpro === x.codpro); if (i) setP({ ...i, fator: x.fator }); else toast("Este produto não saiu aqui.", "erro"); };
  function incluir() { setItens([...itens, { codpro: p!.codpro, nompro: p!.nompro, unipro: p!.unipro, qtd: real, motivo, centro }]); setP(null); setQ(""); setUid(novoUid()); }
  async function gravar() {
    setOc(true);
    try { const r = await api("retorno", { uid, obs, tipo, numero: tipo === "A" ? 0 : Number(n), motorista: mot, itens }); toast(r.status === "LANCADA" ? "Retorno lançado no Lieto." : `Registrado, mas não lançado: ${r.erro}`, r.status === "LANCADA" ? "ok" : "erro"); limpar(); setN(""); setObs(""); salvo?.(); }
    catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); }
  }
  const sel = (v: number, f: (n: number) => void, l: Row[], off: boolean) => <select className={campoCol} disabled={off} value={v} onChange={(e) => { f(Number(e.target.value)); setUid(novoUid()); }}><option value={0}>Escolha…</option>{l.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 border border-line bg-white">{[["R", "Romaneio"], ["P", "Pedido"], ["A", "Avulso"]].map(([k, t]) => <button key={k} onClick={() => { setTipo(k); setN(""); limpar(); }} className={"h-11 text-[14px] font-semibold " + (tipo === k ? "bg-brand-800 text-white" : "text-muted")}>{t}</button>)}</div>
      <form onSubmit={abrir}><Campo nome={tipo === "P" ? "Número do pedido" : "Número do romaneio"}><div className="flex gap-2"><input className={campoCol} inputMode="numeric" disabled={tipo === "A"} value={n} onChange={(e) => { setN(e.target.value.replace(/\D/g, "")); limpar(); }} /><Button size="lg" disabled={tipo === "A" || !n}>Abrir</Button></div></Campo></form>
      <Campo nome="Motorista">{sel(mot, setMot, op.motoristas, !pronto)}</Campo>
      <div><Rot n="Produto" />{p ? <div className="flex min-h-12 items-center justify-between gap-2 border border-line bg-white px-3 text-sm"><span><b>{p.nompro}</b>{saldo !== null && <span className="block text-muted">pode voltar {fq(saldo)} {p.unipro}</span>}</span><button type="button" className="underline" onClick={() => setP(null)}>Trocar</button></div> : <BuscaProduto lista={tipo === "A" ? lista : (o?.itens as Row[]) || []} escolher={escolher} off={!pronto} />}</div>
      <div className="grid grid-cols-2 gap-2"><Campo nome={`Quantidade${rotFator(p, q)}`}><input className={campoCol} inputMode="decimal" disabled={!p} value={q} onChange={(e) => setQ(e.target.value)} /></Campo><Campo nome="Centro">{sel(centro, setCentro, op.centros, !p)}</Campo></div>
      <Campo nome="Motivo">{sel(motivo, setMotivo, op.motivos, !p)}</Campo>
      <Button size="lg" variant="secondary" className="w-full" disabled={!p || !(numero(q) > 0) || !motivo || !centro || (saldo !== null && real > saldo)} onClick={incluir}>Incluir item</Button>
      <div className="border border-line bg-white">{!itens.length && <p className="p-3 text-sm text-muted">Nenhum item incluído.</p>}{itens.map((i, k) => <div key={k} className="flex items-center justify-between gap-2 border-b border-line p-3 text-sm last:border-0"><span><b>{fq(i.qtd)} {i.unipro}</b> {i.nompro}<span className="block text-[12px] text-muted">{op.motivos.find((m: Row) => m.id === i.motivo)?.nome} · {op.centros.find((m: Row) => m.id === i.centro)?.nome}</span></span><button className="px-3 py-2" onClick={() => { setItens(itens.filter((_, j) => j !== k)); setUid(novoUid()); }}>✕</button></div>)}</div>
      <Observacao valor={obs} mudar={(v) => { setObs(v); setUid(novoUid()); }} />
      <Button size="lg" className="w-full" loading={oc} disabled={!itens.length || !mot} onClick={gravar}>Gravar retorno</Button>
    </div>
  );
}
