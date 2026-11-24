"use client";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, useConfirm, useToast, Vazio } from "@/components/ui";
import { Observacao } from "@/components/observacao";
import { Campo, campoCol } from "@/components/coletor";
import { api, chave, fatorLido, fq, nomeFator, r4, type Row } from "@/lib/client";

export const novoUid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
export function bip(ok: boolean) {
  try {
    const ac = new AudioContext(), o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = ok ? 1600 : 280; o.connect(g); g.connect(ac.destination); g.gain.value = 0.15; o.start(); o.stop(ac.currentTime + (ok ? 0.08 : 0.35)); o.onended = () => ac.close();
  } catch {}
  try { navigator.vibrate?.(ok ? 40 : [140, 70, 140]); } catch {}
}
export const numero = (s: string) => Number(String(s).replace(",", "."));
export const campo = "h-12 w-full rounded-xl bg-white px-3 text-[16px] outline-none ring-2 ring-line focus:ring-brand-500";

export function useProdutos() {
  const [l, setL] = useState<Row[] | null>(null); const toast = useToast();
  useEffect(() => { api<Row[]>("produtos").then(setL).catch((e) => toast(e.message, "erro")); }, [toast]);
  return l;
}
export const porCodigo = (l: Row[] | null, c: string) => l?.find((p) => p.codigos.some((x: string) => chave(x) === chave(c)));

// "× 12 = 36": mostra quanto a quantidade digitada vale quando o código lido tem multiplicador
export const rotFator = (p: Row | null, q: string) => (p?.fator && p.fator !== 1 ? ` ${nomeFator(p.fator)}${numero(q) > 0 ? ` = ${fq(r4(numero(q) * p.fator))} ${p.unipro}` : ""}` : "");
export const Rot = ({ n }: { n: string }) => <span className="rotulo">{n}</span>;

export function BuscaProduto({ lista, escolher, off }: { lista: Row[] | null; escolher: (p: Row) => void; off?: boolean }) {
  const [b, setB] = useState(""); const toast = useToast();
  const ws = b.trim().toUpperCase().split(/\s+/);
  const ach = b.trim().length > 1 ? (lista || []).filter((p) => ws.every((w) => p.nompro.toUpperCase().includes(w))).slice(0, 20) : [];
  return (
    <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); const lido = porCodigo(lista, b), p = lido ? { ...lido, fator: fatorLido(lido, b) } : ach.length === 1 ? ach[0] : null; if (p) { escolher(p); setB(""); } else if (!ach.length) toast(`"${b}" não encontrado.`, "erro"); }}>
      <input disabled={off} className={campo + " disabled:bg-slate-100"} placeholder={lista ? "Leia o código ou digite o nome" : "Carregando…"} value={b} onChange={(e) => setB(e.target.value)} />
      <div className="mt-1 max-h-64 overflow-y-auto">
        {ach.map((p) => <button type="button" key={p.codpro} onClick={() => { escolher(p); setB(""); }} className="block w-full border-b border-line bg-white px-3 py-2.5 text-left text-sm">{p.nompro} <span className="text-muted">{p.codpro}</span></button>)}
      </div>
    </form>
  );
}

export function FormTransferencia({ salvo }: { salvo?: () => void }) {
  const lista = useProdutos(), toast = useToast();
  const [cs, setCs] = useState<Row[]>([]), [o, setO] = useState(1), [d, setD] = useState(0), [p, setP] = useState<Row | null>(null), [q, setQ] = useState("");
  const [s, setS] = useState<Row>({}), [obs, setObs] = useState(""), [oc, setOc] = useState(false), [uid, setUid] = useState(novoUid);
  useEffect(() => { api<Row[]>("centros").then(setCs).catch((e) => toast(e.message, "erro")); }, [toast]);
  useEffect(() => { setS({}); if (p) api(`centros/saldo?codpro=${encodeURIComponent(p.codpro)}`).then(setS).catch(() => {}); }, [p]);
  async function ok() {
    setOc(true);
    try {
      const r = await api("transferencia", { uid, obs, codpro: p!.codpro, qtd: r4(numero(q) * (p!.fator || 1)), origem: o, destino: d });
      toast(r.status === "LANCADA" ? "Transferência lançada no Lieto." : `Registrada, mas não lançada: ${r.erro}`, r.status === "LANCADA" ? "ok" : "erro");
      setP(null); setQ(""); setObs(""); setUid(novoUid()); salvo?.();
    } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); }
  }
  const sel = (v: number, f: (n: number) => void) => (
    <select className={campo} value={v} onChange={(e) => { f(Number(e.target.value)); setUid(novoUid()); }}>
      <option value={0}>Escolha…</option>{cs.map((c) => <option key={c.id} value={c.id}>{c.nome}{p ? ` (${fq(s[c.id] || 0)})` : ""}</option>)}
    </select>
  );
  return (
    <div className="space-y-3">
      <Campo nome="De">{sel(o, setO)}</Campo><Campo nome="Para">{sel(d, setD)}</Campo>
      <div><Rot n="Produto" />{!p ? <BuscaProduto lista={lista} escolher={(x) => { setP(x); setUid(novoUid()); }} /> : <div className="flex min-h-12 items-center justify-between gap-2 border border-line bg-white px-3 text-sm"><b>{p.nompro}</b><Button size="sm" variant="ghost" onClick={() => setP(null)}>Trocar</Button></div>}</div>
      <Campo nome={`Quantidade${p ? ` (${p.unipro})` : ""}${rotFator(p, q)}`}><input inputMode="decimal" className={campoCol} disabled={!p} value={q} onChange={(e) => { setQ(e.target.value); setUid(novoUid()); }} /></Campo>
      <Observacao valor={obs} mudar={(v) => { setObs(v); setUid(novoUid()); }} cabe={12} />
      <Button size="lg" className="w-full" loading={oc} disabled={!p || !(numero(q) > 0) || !o || !d || o === d} onClick={ok}>Transferir</Button>
      <p className="text-[12px] text-muted">Muda só a localização; o saldo de venda não se altera.</p>
    </div>
  );
}

export function FormKit({ salvo }: { salvo?: () => void }) {
  const lista = useProdutos(), toast = useToast();
  const [k, setK] = useState<Row | null>(null), [q, setQ] = useState(""), [itens, setItens] = useState<{ p: Row; q: string }[]>([]), [obs, setObs] = useState("");
  const [oc, setOc] = useState(false), [uid, setUid] = useState(novoUid);
  const mudar = (f: (l: { p: Row; q: string }[]) => { p: Row; q: string }[]) => { setItens(f); setUid(novoUid()); };
  // ler de novo o mesmo item soma 1
  const ler = (p: Row) => mudar((l) => l.some((x) => x.p.codpro === p.codpro)
    ? l.map((x) => (x.p.codpro === p.codpro ? { ...x, q: String(r4((numero(x.q) || 0) + (p.fator || 1))) } : x)) : [...l, { p, q: String(r4(p.fator || 1)) }]);
  async function ok() {
    setOc(true);
    try {
      const r = await api("kit", { uid, obs, kit: k!.codpro, qtd: r4(numero(q) * (k!.fator || 1)), itens: itens.map((x) => ({ codpro: x.p.codpro, qtd: numero(x.q) })) });
      toast(r.status === "LANCADA" ? "Kit lançado no Lieto." : `Registrado, mas não lançado: ${r.erro}`, r.status === "LANCADA" ? "ok" : "erro");
      setK(null); setQ(""); setItens([]); setObs(""); setUid(novoUid()); salvo?.();
    } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); }
  }
  return (
    <div className="space-y-3">
      <div><Rot n="Kit (entra)" />{!k ? <BuscaProduto lista={lista} escolher={(p) => { setK(p); setUid(novoUid()); }} /> : <div className="flex min-h-12 items-center justify-between gap-2 border border-line bg-white px-3 text-sm"><b>{k.nompro}</b><Button size="sm" variant="ghost" onClick={() => setK(null)}>Trocar</Button></div>}</div>
      <Campo nome={`Quantidade${k ? ` (${k.unipro})` : ""}${rotFator(k, q)}`}><input inputMode="decimal" className={campoCol} disabled={!k} value={q} onChange={(e) => { setQ(e.target.value); setUid(novoUid()); }} /></Campo>
      <div><Rot n="Itens (saem)" /><BuscaProduto lista={lista} escolher={ler} off={!k} /></div>
      <div className="border border-line bg-white">{!itens.length && <p className="p-3 text-sm text-muted">Nenhum item.</p>}{itens.map((x) => (
        <div key={x.p.codpro} className="flex items-center gap-2 border-b border-line p-2 text-sm last:border-0"><span className="min-w-0 flex-1">{x.p.nompro}</span>
          <input inputMode="decimal" className={campoCol + " !w-24"} value={x.q} onChange={(e) => mudar((l) => l.map((y) => (y.p.codpro === x.p.codpro ? { ...y, q: e.target.value } : y)))} /><button onClick={() => mudar((l) => l.filter((y) => y.p.codpro !== x.p.codpro))} className="px-3 py-2">✕</button></div>
      ))}</div>
      <Observacao valor={obs} mudar={(v) => { setObs(v); setUid(novoUid()); }} cabe={k ? 39 - k.codpro.length : 35} />
      <Button size="lg" className="w-full" loading={oc} disabled={!k || !(numero(q) > 0) || !itens.length || itens.some((x) => !(numero(x.q) > 0))} onClick={ok}>Confirmar</Button>
    </div>
  );
}

export function FormTransformacao({ salvo }: { salvo?: () => void }) {
  const lista = useProdutos(), toast = useToast();
  const [o, setO] = useState<Row | null>(null), [ops, setOps] = useState<Row[]>([]), [d, setD] = useState<Row | null>(null), [q, setQ] = useState(""), [qp, setQp] = useState(""), [obs, setObs] = useState("");
  const [oc, setOc] = useState(false), [uid, setUid] = useState(novoUid);
  useEffect(() => { setOps([]); setD(null); if (o) api<Row[]>(`transformacao/opcoes?codpro=${encodeURIComponent(o.codpro)}`).then(setOps).catch((e) => toast(e.message, "erro")); }, [o, toast]);
  const op = d && ops.find((x) => x.codpro === d.codpro), sai = r4(numero(q) * (o?.fator || 1)), entra = op ? (op.abre ? sai * op.un : sai / op.un) : r4(numero(qp) * (d?.fator || 1));
  async function ok() {
    setOc(true);
    try {
      const r = await api("transformacao", { uid, obs, de: o!.codpro, para: d!.codpro, qtdDe: sai, qtdPara: entra });
      toast(r.status === "LANCADA" ? "Transformação lançada no Lieto." : `Registrada, mas não lançada: ${r.erro}`, r.status === "LANCADA" ? "ok" : "erro");
      setO(null); setQ(""); setQp(""); setObs(""); setUid(novoUid()); salvo?.();
    } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); }
  }
  return (
    <div className="space-y-3">
      <div><Rot n="Sai" />{!o ? <BuscaProduto lista={lista} escolher={(p) => { setO(p); setUid(novoUid()); }} /> : <div className="flex min-h-12 items-center justify-between gap-2 border border-line bg-white px-3 text-sm"><b>{o.nompro} ({o.unipro})</b><Button size="sm" variant="ghost" onClick={() => setO(null)}>Trocar</Button></div>}</div>
      <Campo nome={`Quantidade que sai${o ? ` (${o.unipro})` : ""}${rotFator(o, q)}`}><input inputMode="decimal" className={campoCol} disabled={!o} value={q} onChange={(e) => { setQ(e.target.value); setUid(novoUid()); }} /></Campo>
      <div><Rot n="Entra" />{!d ? <>
        {ops.map((x) => <button key={x.codpro} onClick={() => { setD(x); setUid(novoUid()); }} className="mb-1 block w-full border border-brand-200 bg-brand-50 p-3 text-left text-sm"><b>{x.nompro}</b><span className="block text-muted">{x.abre ? `1 ${o?.unipro} = ${fq(x.un)} ${x.unipro}` : `${fq(x.un)} ${o?.unipro} = 1 ${x.unipro}`}</span></button>)}
        <BuscaProduto lista={lista} escolher={(p) => { setD(p); setUid(novoUid()); }} off={!o} /></> : <div className="flex min-h-12 items-center justify-between gap-2 border border-line bg-white px-3 text-sm"><b>{d.nompro} ({d.unipro})</b><Button size="sm" variant="ghost" onClick={() => setD(null)}>Trocar</Button></div>}</div>
      <Campo nome={`Quantidade que entra${d ? ` (${d.unipro})` : ""}`}><input inputMode="decimal" className={campoCol} disabled={!d || !!op} value={op ? (entra > 0 ? fq(entra) : "") : qp} onChange={(e) => { setQp(e.target.value); setUid(novoUid()); }} /></Campo>
      <Observacao valor={obs} mudar={(v) => { setObs(v); setUid(novoUid()); }} cabe={75} />
      <Button size="lg" className="w-full" loading={oc} disabled={!o || !d || !(numero(q) > 0) || !(entra > 0)} onClick={ok}>Transformar</Button>
    </div>
  );
}
