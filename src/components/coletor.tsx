"use client";
// Peças do coletor: cabeçalho, abas fixas, campo e botão grande. Campo indisponível aparece desabilitado, nunca some.
// O visual (toque mínimo de 64 px) fica em globals.css, sob body.coletor.
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cx } from "@/components/ui";

export function Cabecalho({ titulo, sub, esq, dir }: { titulo: string; sub?: string; esq?: React.ReactNode; dir?: React.ReactNode }) {
  return <header className="cabec">{esq}<div><b>{titulo}</b>{sub && <small>{sub}</small>}</div>{dir}</header>;
}

export function BotaoG({ tom, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tom?: "ok" }) {
  return <button {...p} className={cx("bt1", tom, className)} />;
}

export function Tela({ titulo, sub, voltar, abas, aba, mudar, rodape, children }: { titulo: string; sub?: string; voltar?: () => void; abas?: { k: string; n: string; off?: boolean }[]; aba?: string; mudar?: (k: string) => void; rodape?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="tela">
      <Cabecalho titulo={titulo} sub={sub} esq={voltar ? <button onClick={voltar} className="ic" aria-label="Voltar"><ChevronLeft /></button> : <Link href="/coletor" className="ic" aria-label="Voltar"><ChevronLeft /></Link>} />
      {abas && <div className="abas" style={{ gridTemplateColumns: `repeat(${abas.length}, 1fr)` }}>
        {abas.map((a) => <button key={a.k} disabled={a.off} onClick={() => mudar?.(a.k)} className={cx(aba === a.k && "sel")}>{a.n}</button>)}
      </div>}
      <main className="corpo">{children}</main>
      {rodape && <div className="rodape">{rodape}</div>}
    </div>
  );
}

export const campoCol = "h-12 w-full border border-line bg-white px-3 text-[16px] outline-none focus:border-brand-600 disabled:bg-slate-100 disabled:text-slate-400";
export function Campo({ nome, children }: { nome: string; children: React.ReactNode }) {
  return <label className="block"><span className="rotulo">{nome}</span>{children}</label>;
}
