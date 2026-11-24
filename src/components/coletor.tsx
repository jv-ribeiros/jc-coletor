"use client";
// Peças do coletor: cabeçalho, abas fixas e campo com rótulo. Campo indisponível aparece desabilitado, nunca some.
import Link from "next/link";
import { cx } from "@/components/ui";

export function Tela({ titulo, sub, voltar, abas, aba, mudar, children }: { titulo: string; sub?: string; voltar?: () => void; abas?: { k: string; n: string; off?: boolean }[]; aba?: string; mudar?: (k: string) => void; children: React.ReactNode }) {
  const bt = "grid h-10 w-11 shrink-0 place-items-center bg-white/10 text-lg";
  return (
    <div className="min-h-dvh bg-canvas">
      <div className="sticky top-0 z-20">
        <header className="flex items-center gap-3 bg-brand-900 px-3 py-2.5 text-white">
          {voltar ? <button onClick={voltar} className={bt} aria-label="Voltar">←</button> : <Link href="/coletor" className={bt} aria-label="Voltar">←</Link>}
          <div className="min-w-0"><div className="truncate font-semibold">{titulo}</div>{sub && <div className="truncate text-[12px] text-brand-100/80">{sub}</div>}</div>
        </header>
        {abas && <div className="grid border-b border-line bg-white" style={{ gridTemplateColumns: `repeat(${abas.length}, 1fr)` }}>
          {abas.map((a) => <button key={a.k} disabled={a.off} onClick={() => mudar?.(a.k)} className={cx("h-12 border-b-2 text-[14px] font-semibold disabled:opacity-35", aba === a.k ? "border-brand-700 text-brand-800" : "border-transparent text-muted")}>{a.n}</button>)}
        </div>}
      </div>
      <main className="mx-auto max-w-md space-y-3 p-3">{children}</main>
    </div>
  );
}

export const campoCol = "h-12 w-full border border-line bg-white px-3 text-[16px] outline-none focus:border-brand-600 disabled:bg-slate-100 disabled:text-slate-400";
export function Campo({ nome, children }: { nome: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-muted">{nome}</span>{children}</label>;
}
