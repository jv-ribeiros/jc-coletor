"use client";
// Alertas no topo do Painel. Sem botão de dispensar: cada um some quando o problema é resolvido.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button, Card, cx } from "@/components/ui";
import { api, fdata, type Row } from "@/lib/client";

const N: Record<string, [string, string, string]> = { E: ["Erro", "Erros", "bg-rose-50 text-rose-800"], P: ["Pendência", "Pendências", "bg-amber-50 text-amber-800"], A: ["Aviso", "Avisos", "bg-brand-100 text-brand-800"] };
export function Alertas() {
  const [d, setD] = useState<Row | null>(null), [erro, setErro] = useState(""), [oc, setOc] = useState(false), [tudo, setTudo] = useState(false);
  const ler = useCallback(async () => { setOc(true); try { setD(await api("alertas")); setErro(""); } catch (e) { setErro((e as Error).message); } finally { setOc(false); } }, []);
  useEffect(() => { ler(); const t = setInterval(() => { if (!document.hidden) ler(); }, 60_000); return () => clearInterval(t); }, [ler]);
  if (!d) return <Card className="mt-5 space-y-3 p-5">{erro ? <p className="text-sm text-rose-800">Não foi possível ler os alertas: {erro}</p> : <><span className="sk h-3.5 w-[55%]" /><span className="sk h-3.5 w-[38%]" /><span className="sk h-3.5 w-[46%]" /></>}</Card>;
  const l = d.alertas as Row[], ver = tudo ? l : l.slice(0, 10);
  return (
    <section className="mt-5">
      {erro && <p className="mb-3 bg-rose-50 p-3 text-sm text-rose-800">Alertas desatualizados: {erro}</p>}
      {d.falhas.length > 0 && <p className="mb-3 bg-rose-50 p-3 text-sm text-rose-800"><b>Alertas incompletos.</b> Não foi possível conferir {d.falhas.join(" · ")}</p>}
      {l.length > 0 && <div className="mb-3 grid gap-3 sm:grid-cols-3">{Object.entries(N).map(([k, x]) => <Card key={k} className="px-5 py-4"><div className={cx("text-2xl font-semibold tabular", k === "E" ? "text-rose-800" : k === "P" ? "text-amber-800" : "")}>{l.filter((a) => a.nivel === k).length}</div><div className="text-sm text-muted">{x[1]}</div></Card>)}</div>}
      <Card className="px-5 py-2">
        {!l.length && <div className="py-3 text-sm">{d.falhas.length ? "Nenhum alerta no que foi possível conferir." : <b>Nenhum alerta.</b>}</div>}
        {ver.map((a, k) => (
          <div key={k} className="grid items-center gap-2 border-b border-line py-3 text-sm last:border-0 sm:grid-cols-[100px_1fr_auto_auto] sm:gap-4">
            <span className={cx("justify-self-start px-2 py-0.5 text-[12px] font-semibold", N[a.nivel][2])}>{N[a.nivel][0]}</span>
            <span className="min-w-0"><b>{a.titulo}</b><span className="block break-words text-[13px] text-muted">{a.texto}</span></span>
            <span className="whitespace-nowrap text-[13px] text-muted tabular">{a.em ? fdata(a.em) : ""}</span><Link href={a.href} className="font-semibold text-brand-700 underline">Abrir</Link>
          </div>))}
        <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12px] text-muted"><span>Conferido em {fdata(d.em)}{d.parcial ? " · só as rotinas liberadas para você" : ""}</span>
          <span className="flex gap-2">{l.length > 10 && <Button size="sm" variant="ghost" onClick={() => setTudo(!tudo)}>{tudo ? "Mostrar menos" : `Ver todos (${l.length})`}</Button>}<Button size="sm" variant="ghost" loading={oc} onClick={ler}><RefreshCw className="size-3.5" />Atualizar</Button></span></div>
      </Card>
    </section>
  );
}
