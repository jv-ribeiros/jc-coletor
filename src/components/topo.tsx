"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRightLeft, Boxes, ClipboardCheck, FileCode2, History, KeyRound, Undo2, PackageOpen, Factory, LayoutGrid, LogOut, ScanBarcode, ShieldAlert, ShieldCheck, Shuffle, Warehouse } from "lucide-react";
import { sair, useEmpresa } from "@/components/acesso";
import { cx } from "@/components/ui";
import { api, sessao, type Row } from "@/lib/client";

// Usuário logado (código e senha do Lieto). Mantém a assinatura antiga: [nome, setter sem efeito].
export function useResponsavel() {
  const [nome, setNome] = useState("");
  useEffect(() => { const f = () => setNome(sessao.usuario()?.nome || ""); f(); window.addEventListener("sessao", f); return () => window.removeEventListener("sessao", f); }, []);
  return [nome, (_: string) => {}] as const; // eslint-disable-line @typescript-eslint/no-unused-vars
}

// Rotinas liberadas para o usuário logado (a trava de verdade é no servidor)
let permCache: { token: string; s: Row | null } = { token: "", s: null };
export function usePode() {
  const [s, setS] = useState<Row | null>(permCache.token === sessao.token() ? permCache.s : null);
  useEffect(() => {
    let vivo = true;
    const ler = () => { const token = sessao.token(); if (token) api("sessao").then((r) => { permCache = { token, s: r }; if (vivo) setS(r); }).catch(() => {}); };
    ler(); window.addEventListener("sessao", ler);
    return () => { vivo = false; window.removeEventListener("sessao", ler); };
  }, []);
  return Object.assign((rs?: string[]) => !rs || (!!s && (s.admin || rs.some((r) => s.rotinas?.includes(r)))), { pronto: !!s });
}

// Status de conformidade do banco do Lieto (compartilhado entre telas, recarrega a cada 2 min)
let cache: { em: number; s: Row | null } = { em: 0, s: null };
export function useConformidade() {
  const [s, setS] = useState<Row | null>(cache.s);
  useEffect(() => {
    let vivo = true;
    const ler = () => api("sistema/ddl").then((r) => { cache = { em: Date.now(), s: r }; if (vivo) setS(r); }).catch(() => {});
    if (Date.now() - cache.em > 30_000) ler();
    const t = setInterval(ler, 120_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);
  return s;
}

const PERM: Record<string, string[]> = { "/inventario": ["inventario", "inventario_gestao", "inventario_lancar"], "/producao": ["producao", "producao_gestao"], "/movimentos": ["transferencia", "transformacao", "kit", "retorno", "perda"], "/xml": ["xml"], "/permissoes": ["admin"], "/conferencia": ["conferencia_gestao"], "/auditoria": ["auditoria"] };
const MODULOS = [
  { href: "/", n: "Painel", icone: LayoutGrid, ativo: (r: string) => r === "/" },
  { href: "/inventario", n: "Inventário", icone: Warehouse, ativo: (r: string) => r.startsWith("/inventario") },
  { href: "/producao", n: "Produção", icone: Factory, ativo: (r: string) => r.startsWith("/producao") },
  { href: "/movimentos", n: "Movimentos", icone: ArrowRightLeft, ativo: (r: string) => r.startsWith("/movimentos") },
  { href: "/conferencia", n: "Conferência", icone: ClipboardCheck, ativo: (r: string) => r.startsWith("/conferencia") },
  { href: "/xml", n: "XML", icone: FileCode2, ativo: (r: string) => r.startsWith("/xml") },
  { href: "/auditoria", n: "Auditoria", icone: History, ativo: (r: string) => r.startsWith("/auditoria") },
  { href: "/permissoes", n: "Liberações", icone: KeyRound, ativo: (r: string) => r.startsWith("/permissoes") },
  { href: "/sistema", n: "Sistema", icone: ShieldCheck, ativo: (r: string) => r.startsWith("/sistema") },
];

export function Topo({ children }: { children?: React.ReactNode }) {
  const [nome] = useResponsavel(), rota = usePathname(), conf = useConformidade(), pode = usePode(), empresa = useEmpresa();
  const bloqueadas = (conf?.rotinas || []).filter((r: Row) => !r.ok);
  const alerta = conf && (conf.erro || !conf.homologado || bloqueadas.length > 0);
  const link = (ativo: boolean) => cx("inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition", ativo ? "bg-slate-100 text-ink" : "text-muted hover:text-ink");
  return (
    <header className="no-print sticky top-0 z-30 border-b border-line bg-white/85 backdrop-blur">
      {alerta && (
        <Link href="/sistema" className="flex items-center justify-center gap-2 bg-rose-700 px-4 py-2 text-center text-[13px] font-semibold text-white hover:bg-rose-800">
          <ShieldAlert className="size-4 shrink-0" />
          {conf.erro ? "Não foi possível conferir a estrutura do banco do Lieto. Gravações bloqueadas."
            : !conf.homologado ? "Estrutura do banco do Lieto ainda não homologada: gravações no Lieto bloqueadas."
            : `O banco do Lieto mudou: ${bloqueadas.map((r: Row) => r.nome).join(", ")} bloqueado(s) para gravação.`}
          <span className="underline underline-offset-2">Ver detalhes</span>
        </Link>
      )}
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-brand-800 text-white"><Boxes className="size-[18px]" /></span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-[14px] font-semibold tracking-tight">Operações</span>
            <span className="block whitespace-nowrap text-[11px] text-muted">{empresa ? `Lieto · ${empresa}` : "Lieto"}</span>
          </span>
        </Link>
        <nav className="ml-2 hidden shrink-0 items-center gap-0.5 md:flex">
          {MODULOS.filter((m) => pode(PERM[m.href])).map((m) => <Link key={m.href} href={m.href} title={m.n} className={link(m.ativo(rota)) + " !px-2 xl:!px-2.5"}><m.icone className="size-4 shrink-0" /><span className={m.ativo(rota) ? "" : "hidden min-[1700px]:inline"}>{m.n}</span></Link>)}
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
        <Link href="/coletor" className="inline-flex h-9 items-center gap-2 rounded-lg bg-ink px-3 text-[13px] font-medium text-white hover:bg-black">
          <ScanBarcode className="size-4" /><span className="hidden sm:inline">Coletor</span>
        </Link>
        <div className="flex items-center gap-2 border-l border-line pl-3">
          <span className="grid size-8 place-items-center rounded-full bg-brand-100 text-[12px] font-bold text-brand-800" title={sessao.usuario()?.nomfun || ""}>{nome.slice(0, 2)}</span>
          <span className="hidden max-w-[120px] truncate text-[13px] font-medium min-[1400px]:block">{nome}</span>
          <button onClick={sair} title="Sair" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-slate-100 hover:text-ink"><LogOut className="size-4" /></button>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-line px-3 py-1.5 md:hidden">
        {MODULOS.filter((m) => pode(PERM[m.href])).map((m) => <Link key={m.href} href={m.href} className={link(m.ativo(rota))}><m.icone className="size-4" />{m.n}</Link>)}
      </nav>
    </header>
  );
}
