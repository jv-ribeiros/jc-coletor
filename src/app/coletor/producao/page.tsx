"use client";
// Coletor › Produção. Fluxo: ler/buscar o produto → quantidade (e lote) → confirmar.
// A confirmação grava o apontamento e o servidor lança no Lieto na hora (PRODUCOES + MESTOQUE).
// Cada apontamento tem um uid gerado no aparelho: se a rede cair e o operador repetir, não duplica.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, CircleAlert, History, LoaderCircle, RefreshCw, ScanBarcode, Search, X } from "lucide-react";
import { cx } from "@/components/ui";
import { Observacao } from "@/components/observacao";
import { SelectLote } from "@/components/producao";
import { api, chave, fatorLido, fdata, fq, nomeFator, r4, sessao, type Row } from "@/lib/client";

const hoje = () => new Date().toLocaleDateString("sv-SE");
const novoUid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const NOME: Record<string, string> = { PENDENTE: "Pendente", LANCADA: "Lançada", ERRO: "Erro", CANCELADA: "Cancelada" };
const COR: Record<string, string> = { PENDENTE: "bg-amber-100 text-amber-800", LANCADA: "bg-brand-100 text-brand-800", ERRO: "bg-rose-100 text-rose-700", CANCELADA: "bg-slate-200 text-slate-600" };

function bip(ok: boolean) {
  try {
    const ac = new AudioContext(), o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = ok ? 1600 : 280; o.connect(g); g.connect(ac.destination); g.gain.value = 0.15; o.start(); o.stop(ac.currentTime + (ok ? 0.08 : 0.35));
  } catch {}
  try { navigator.vibrate?.(ok ? 40 : [140, 70, 140]); } catch {}
}

export default function ColetorProducao() {
  const [aba, setAba] = useState<"apontar" | "minhas">("apontar");
  const [cat, setCat] = useState<Row[] | null>(null), [erroCat, setErroCat] = useState("");
  const [busca, setBusca] = useState(""), [prod, setProd] = useState<Row | null>(null);
  const [qtd, setQtd] = useState(""), [obs, setObs] = useState(""), [lote, setLote] = useState(""), [data, setData] = useState(hoje());
  const [sim, setSim] = useState<Row | null>(null), [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Row | null>(null), [aviso, setAviso] = useState("");
  const [minhas, setMinhas] = useState<Row[] | null>(null);
  const uid = useRef(novoUid()), refBusca = useRef<HTMLInputElement>(null), refQtd = useRef<HTMLInputElement>(null);

  const carregarCat = useCallback(() => { setErroCat(""); api<Row[]>("producao/catalogo").then(setCat).catch((e) => setErroCat(e.message)); }, []);
  const carregarMinhas = useCallback(() => api<Row[]>("producao/minhas").then(setMinhas).catch(() => setMinhas([])), []);
  useEffect(() => { carregarCat(); carregarMinhas(); }, [carregarCat, carregarMinhas]);
  useEffect(() => { if (!prod) setTimeout(() => refBusca.current?.focus(), 50); else setTimeout(() => refQtd.current?.focus(), 50); }, [prod]);

  // índice por código: interno, barras, DUN, EAN tributável, código numérico
  const indice = useMemo(() => {
    const m = new Map<string, Row>();
    for (const p of cat || []) for (const c of [p.codpro, p.codbar, p.coddum, p.eantri, p.codint, ...(p.extras || [])]) if (c) m.set(chave(c), p);
    return m;
  }, [cat]);
  const achados = useMemo(() => {
    const b = busca.trim().toUpperCase();
    if (b.length < 2 || !cat) return [];
    const ws = b.split(/\s+/);
    return cat.filter((p) => ws.every((w) => p.nompro.toUpperCase().includes(w))).slice(0, 40);
  }, [cat, busca]);

  const n = r4(Number(qtd.replace(",", ".")) * (prod?.fator || 1));
  useEffect(() => {
    if (!prod) return setSim(null);
    const t = setTimeout(() => api(`producao/simular?codpro=${encodeURIComponent(prod.codpro)}&qtd=${n > 0 ? n : 1}`).then(setSim).catch((e) => setAviso(e.message)), 300);
    return () => clearTimeout(t);
  }, [prod, n]);

  function ler(e: React.FormEvent) {
    e.preventDefault();
    const p = indice.get(chave(busca));
    if (p) { bip(true); escolher({ ...p, fator: fatorLido(p, busca) }); return; }
    if (achados.length === 1) { bip(true); escolher(achados[0]); return; }
    if (!achados.length) { bip(false); setAviso(`Código "${busca}" não é de um produto com ficha técnica.`); setBusca(""); }
  }
  function escolher(p: Row) { setProd(p); setBusca(""); setAviso(""); setQtd(""); setObs(""); setResultado(null); uid.current = novoUid(); }

  async function confirmar() {
    if (!prod || !(n > 0)) return;
    setEnviando(true); setAviso("");
    try {
      const r = await api("producao", { uid: uid.current, codpro: prod.codpro, qtd: n, lote, data, obs, dispositivo: navigator.userAgent.slice(0, 60) });
      bip(r.status === "LANCADA"); setResultado(r); setProd(null); setSim(null); carregarMinhas();
    } catch (e) { bip(false); setAviso((e as Error).message); }
    finally { setEnviando(false); }
  }

  const u = sessao.usuario();
  return (
    <div className="inv tela">
      <header className="cabec">
        <Link href="/coletor" className="ic" aria-label="Voltar"><ArrowLeft /></Link>
        <div><b>Produção</b><small>{u?.nome}</small></div>
      </header>

      <main className="corpo !block">
        {aba === "apontar" && <>
          {resultado && (
            <div className={cx("anim-entra mb-4 rounded-2xl px-4 py-4", resultado.status === "LANCADA" ? "bg-brand-700 text-white" : "bg-amber-100 text-amber-900")}>
              <div className="flex items-center gap-2 text-[17px] font-semibold">
                {resultado.status === "LANCADA" ? <Check className="size-6" /> : <CircleAlert className="size-6" />}
                {resultado.status === "LANCADA" ? `Lançada no Lieto · nº ${resultado.numide}` : "Apontada, mas NÃO lançada"}
              </div>
              <div className="mt-1 text-[14px] opacity-90">{fq(resultado.qtd)} {resultado.unipro} · {resultado.nompro}</div>
              {resultado.status !== "LANCADA" && <div className="mt-2 text-[13px]">{resultado.erro || "Ficou pendente."} A gestão reenvia depois; não aponte de novo.</div>}
            </div>
          )}
          {aviso && <div className="anim-entra mb-4 flex items-start gap-2 rounded-xl bg-rose-100 px-4 py-3 text-[14px] text-rose-800"><CircleAlert className="mt-0.5 size-4 shrink-0" /><span className="flex-1">{aviso}</span><button onClick={() => setAviso("")}><X className="size-4" /></button></div>}

          <form onSubmit={ler} className="relative">
            <ScanBarcode className="absolute left-4 top-[22px] size-6 text-muted" />
            <input ref={refBusca} value={prod ? prod.nompro : busca} disabled={!!prod} onChange={(e) => setBusca(e.target.value)} enterKeyHint="search" autoComplete="off" placeholder={cat ? "Leia o código ou digite o nome" : "Carregando produtos…"}
              className="h-14 w-full bg-white !pl-13 pr-4 text-[17px] font-medium outline-none focus:ring-brand-500 disabled:bg-slate-100" />
          </form>
          {erroCat && <button onClick={carregarCat} className="mt-3 flex w-full items-center justify-center gap-2 bg-rose-100 py-3 text-sm text-rose-800"><RefreshCw className="size-4" />{erroCat} — tentar de novo</button>}
          <div className="mt-2 space-y-1">{achados.map((p) => <button key={p.codpro} onClick={() => escolher(p)} className="block w-full bg-white px-4 py-3 text-left active:bg-brand-50"><span className="block text-[15px] font-semibold">{p.nompro}</span><span className="text-[12px] text-muted">{p.codpro} · {p.unipro} · {p.insumos} insumo(s)</span></button>)}
            {busca.trim().length >= 2 && cat && !achados.length && !indice.get(chave(busca)) && <p className="px-1 text-sm text-muted"><Search className="mr-1 inline size-4" />Nada encontrado. Só aparecem produtos com ficha técnica no Lieto.</p>}</div>
          <div className="mt-3 space-y-4">
            <div className="flex items-center justify-between text-[13px] text-muted"><span>{prod ? `${prod.codpro} · ${prod.unipro}${sim?.produto?.saldo != null ? ` · saldo ${fq(sim.produto.saldo)}` : ""}` : "Nenhum produto"}</span><button disabled={!prod} onClick={() => setProd(null)} className="bg-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40">Trocar</button></div>
            <label className="block"><span className="mb-1 block text-[13px] font-semibold text-muted">Quantidade produzida {prod ? `(${prod.unipro})` : ""} {prod && nomeFator(prod.fator)}{prod?.fator && prod.fator !== 1 && n > 0 ? ` = ${fq(n)} ${prod.unipro}` : ""}</span>
              <input ref={refQtd} value={qtd} disabled={!prod} onChange={(e) => setQtd(e.target.value.replace(/[^\d,.]/g, ""))} inputMode="decimal" enterKeyHint="done" onKeyDown={(e) => { if (e.key === "Enter") confirmar(); }}
                className="h-16 w-full bg-white px-4 text-center text-[32px] font-bold tabular outline-none focus:ring-brand-500 disabled:bg-slate-100" placeholder="0" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1 block text-[13px] font-semibold text-muted">Lote</span>{prod ? <SelectLote codpro={prod.codpro} valor={lote} mudar={setLote} className="h-12 w-full bg-white px-3 text-[15px] font-semibold outline-none disabled:bg-slate-100" /> : <select disabled className="h-12 w-full bg-slate-100 px-3" />}</label>
              <label className="block"><span className="mb-1 block text-[13px] font-semibold text-muted">Data</span><input type="date" value={data} disabled={!prod} max={hoje()} onChange={(e) => setData(e.target.value)} className="h-12 w-full bg-white px-3 text-[15px] outline-none focus:ring-brand-500 disabled:bg-slate-100" /></label>
            </div>
            <Observacao valor={obs} mudar={setObs} cabe={75} off={!prod} />
            <div className="bg-white px-4 py-3"><div className="text-[13px] font-semibold text-muted">Sai do estoque{prod && !(n > 0) ? " (por unidade)" : ""}</div>
              {!sim && <div className="py-2 text-[13px] text-muted">—</div>}
              {sim?.insumos.map((i: Row) => <div key={i.codpro} className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-0"><span className="min-w-0 text-[14px]">{i.nompro}</span><span className="shrink-0 text-right"><span className="block font-semibold tabular">{fq(i.qtd)} {i.unipro}</span>{i.saldo != null && <span className={cx("text-[11px] tabular", i.saldo < i.qtd ? "font-semibold text-rose-700" : "text-muted")}>saldo {fq(i.saldo)}</span>}</span></div>)}</div>
          </div>
        </>}

        {aba === "minhas" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between"><span className="text-[13px] font-semibold text-muted">Meus apontamentos de hoje</span>
              <button onClick={carregarMinhas} className="grid size-9 place-items-center rounded-lg bg-white"><RefreshCw className="size-4" /></button></div>
            {minhas === null && <LoaderCircle className="mx-auto mt-6 size-6 animate-spin text-muted" />}
            {minhas?.length === 0 && <p className="rounded-xl bg-white px-4 py-3 text-sm text-muted">Nenhum apontamento hoje.</p>}
            {minhas?.map((p) => (
              <div key={p.id} className="rounded-xl bg-white px-4 py-3">
                <div className="flex items-start justify-between gap-2"><span className="text-[15px] font-semibold">{p.nompro}</span>
                  <span className={cx("shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold", COR[p.status])}>{NOME[p.status]}</span></div>
                <div className="text-[13px] text-muted">{fq(p.qtd)} {p.unipro}{p.lote ? ` · lote ${p.lote}` : ""} · {fdata(p.criado_em).slice(11)}{p.numide ? ` · Lieto nº ${p.numide}` : ""}</div>
                {p.erro && <div className="mt-1 text-[12px] text-rose-700">{p.erro}</div>}
              </div>
            ))}
          </div>
        )}
      </main>

      {aba === "apontar" && (
        <div className="rodape">
          <button onClick={confirmar} disabled={!prod || !(n > 0) || enviando}
            className="bt1 flex items-center justify-center gap-2">
            {enviando ? <LoaderCircle className="size-6 animate-spin" /> : <><Check className="size-6" />Confirmar {prod && n > 0 ? `${fq(n)} ${prod.unipro}` : ""}</>}
          </button>
        </div>
      )}
      <nav className="grid h-[72px] shrink-0 grid-cols-2 border-t border-line bg-white">
        {([["apontar", "Apontar", ScanBarcode], ["minhas", "Hoje", History]] as const).map(([k, nome, Ic]) => (
          <button key={k} onClick={() => { setAba(k); if (k === "minhas") carregarMinhas(); }} className={cx("flex flex-col items-center justify-center gap-0.5 text-[12px] font-semibold", aba === k ? "text-brand-700" : "text-muted")}>
            <Ic className="size-5" />{nome}{k === "minhas" && minhas?.some((p) => p.status !== "LANCADA" && p.status !== "CANCELADA") && <span className="absolute ml-8 -mt-6 size-2 rounded-full bg-rose-600" />}
          </button>
        ))}
      </nav>
    </div>
  );
}
