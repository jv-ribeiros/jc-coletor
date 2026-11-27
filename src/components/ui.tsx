"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, CircleAlert, LoaderCircle, X } from "lucide-react";
import { ETAPAS, NOME_ETAPA } from "@/lib/client";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- botão ----------
const VAR = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 shadow-sm shadow-brand-900/10",
  secondary: "bg-white text-ink border border-line hover:bg-slate-50 shadow-sm shadow-black/[.03]",
  ghost: "text-muted hover:bg-slate-200/60 hover:text-ink",
  danger: "bg-white text-rose-700 border border-rose-200 hover:bg-rose-50",
  dark: "bg-ink text-white hover:bg-black",
};
const TAM = { sm: "h-8 px-3 text-[13px] gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-5 text-[15px] gap-2" };
export function Button({ variant = "primary", size = "md", loading, className, children, ...p }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VAR; size?: keyof typeof TAM; loading?: boolean }) {
  return (
    <button {...p} disabled={p.disabled || loading}
      className={cx("inline-flex items-center justify-center rounded-lg font-medium transition-colors cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap", VAR[variant], TAM[size], className)}>
      {loading && <LoaderCircle className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

// ---------- superfícies ----------
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cx("rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(0,0,0,.03)]", className)}>{children}</div>;
}

export function Stat({ label, value, hint, tone, icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "pos" | "neg" | "warn"; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted">{icon}{label}</div>
      <div className={cx("mt-1 text-[22px] font-semibold tracking-tight tabular", tone === "pos" && "text-brand-700", tone === "neg" && "text-rose-700", tone === "warn" && "text-amber-700")}>{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-muted tabular">{hint}</div>}
    </div>
  );
}

const SIT: Record<string, string> = {
  OK: "bg-brand-50 text-brand-700 ring-brand-200", RECONTAR: "bg-amber-50 text-amber-800 ring-amber-200",
  AUDITAR: "bg-rose-50 text-rose-700 ring-rose-200", AUDITADO: "bg-sky-50 text-sky-800 ring-sky-200",
  CONTAGEM: "bg-sky-50 text-sky-800 ring-sky-200", RECONTAGEM: "bg-amber-50 text-amber-800 ring-amber-200",
  AUDITORIA: "bg-rose-50 text-rose-700 ring-rose-200", LANCAMENTO: "bg-violet-50 text-violet-800 ring-violet-200",
  ENCERRADO: "bg-slate-100 text-slate-700 ring-slate-200", CANCELADO: "bg-slate-200 text-slate-700 ring-slate-300",
  DESCONSIDERADO: "bg-slate-100 text-slate-500 ring-slate-200",
  PROGRAMADO: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  PENDENTE: "bg-amber-50 text-amber-800 ring-amber-200", LANCADA: "bg-brand-50 text-brand-700 ring-brand-200",
  ERRO: "bg-rose-50 text-rose-700 ring-rose-200", CANCELADA: "bg-slate-100 text-slate-500 ring-slate-200",
};
export function Badge({ v, children }: { v: string; children?: React.ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap", SIT[v] || "bg-slate-100 text-slate-700 ring-slate-200")}>{children ?? (NOME_ETAPA[v] || v)}</span>;
}

export const inputCls = "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10";
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

// ---------- etapas ----------
// "inicio": etapa em que o inventário começou — as anteriores aparecem como puladas
export function Stepper({ etapa, compacto, inicio }: { etapa: string; compacto?: boolean; inicio?: string | null }) {
  const atual = ETAPAS.indexOf(etapa as (typeof ETAPAS)[number]);
  const ini = Math.max(0, ETAPAS.indexOf((inicio || "CONTAGEM") as (typeof ETAPAS)[number]));
  if (compacto) return (
    <div className="flex gap-1">{ETAPAS.slice(0, 4).map((e, k) => (
      <div key={e} title={NOME_ETAPA[e] + (k < ini ? " (pulada)" : "")} className={cx("h-1.5 flex-1 rounded-full", k < ini ? "bg-slate-200 opacity-50" : k < atual || etapa === "ENCERRADO" ? "bg-brand-500" : k === atual ? "bg-brand-200" : "bg-slate-200")} />
    ))}</div>
  );
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {ETAPAS.slice(0, 4).map((e, k) => {
        const pulada = k < ini && atual >= ini, feito = !pulada && (k < atual || etapa === "ENCERRADO"), agora = k === atual;
        return (
          <li key={e} className={cx("flex items-center gap-3 rounded-xl border px-3 py-2.5",
            feito ? "border-brand-200 bg-brand-50" : agora ? "border-brand-600 bg-white ring-4 ring-brand-500/10" : "border-line bg-slate-50/60")}>
            <span className={cx("grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-bold",
              feito ? "bg-brand-600 text-white" : agora ? "bg-brand-700 text-white anim-pulso" : "bg-slate-200 text-slate-500")}>
              {feito ? <Check className="size-4" strokeWidth={3} /> : pulada ? "–" : k + 1}
            </span>
            <div className="min-w-0">
              <div className={cx("text-[13px] font-semibold leading-tight", !feito && !agora && "text-slate-500")}>{NOME_ETAPA[e]}</div>
              <div className="text-[11px] text-muted">{pulada ? "Pulada" : feito ? "Concluída" : agora ? "Em andamento" : "Aguardando"}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- modal / gaveta ----------
export function Modal({ aberto, onClose, titulo, descricao, children, rodape, largura = "max-w-lg" }:
  { aberto: boolean; onClose: () => void; titulo: React.ReactNode; descricao?: React.ReactNode; children?: React.ReactNode; rodape?: React.ReactNode; largura?: string }) {
  useEffect(() => {
    if (!aberto) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [aberto, onClose]);
  if (!aberto) return null;
  return createPortal(
    <div data-modal className="fixed inset-0 z-50 grid place-items-start overflow-y-auto bg-slate-900/40 p-4 pt-[10vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx("anim-entra mx-auto w-full rounded-2xl bg-white shadow-2xl ring-1 ring-black/5", largura)}>
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div><h2 className="text-[17px] font-semibold tracking-tight">{titulo}</h2>{descricao && <p className="mt-1 text-sm text-muted">{descricao}</p>}</div>
          <button onClick={onClose} className="-mr-2 rounded-lg p-1.5 text-muted hover:bg-slate-100"><X className="size-5" /></button>
        </div>
        {children && <div className="px-6 pt-4">{children}</div>}
        <div className="flex justify-end gap-2 px-6 pb-5 pt-5">{rodape}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Gaveta({ aberto, onClose, children }: { aberto: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!aberto) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [aberto, onClose]);
  if (!aberto) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="anim-lado h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">{children}</div>
    </div>,
    document.body,
  );
}

// Confirmação com digitação opcional de palavra-chave
export function useConfirm() {
  const [st, setSt] = useState<null | { titulo: string; texto: React.ReactNode; acao: string; palavra?: string; perigo?: boolean; resolve: (v: boolean) => void }>(null);
  const [digitado, setDigitado] = useState("");
  const confirmar = useCallback((o: { titulo: string; texto: React.ReactNode; acao?: string; palavra?: string; perigo?: boolean }) =>
    new Promise<boolean>((resolve) => { setDigitado(""); setSt({ acao: "Confirmar", ...o, resolve }); }), []);
  const fechar = (v: boolean) => { st?.resolve(v); setSt(null); };
  const dialogo = (
    <Modal aberto={!!st} onClose={() => fechar(false)} titulo={st?.titulo} descricao={st?.texto}
      rodape={<>
        <Button variant="secondary" onClick={() => fechar(false)}>Voltar</Button>
        <Button variant={st?.perigo ? "dark" : "primary"} disabled={!!st?.palavra && digitado.trim().toUpperCase() !== st.palavra} onClick={() => fechar(true)}>{st?.acao}</Button>
      </>}>
      {st?.palavra && (
        <Field label={`Digite ${st.palavra} para confirmar`}>
          <input autoFocus className={cx(inputCls, "font-mono uppercase")} value={digitado} onChange={(e) => setDigitado(e.target.value)} />
        </Field>
      )}
    </Modal>
  );
  return { confirmar, dialogo };
}

// ---------- toasts ----------
type Toast = { id: number; texto: string; tipo: "ok" | "erro" };
const ToastCtx = createContext<(texto: string, tipo?: "ok" | "erro") => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function Toaster({ children }: { children: React.ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([]);
  const add = useCallback((texto: string, tipo: "ok" | "erro" = "ok") => {
    const id = Date.now() + Math.random();
    setLista((l) => [...l, { id, texto, tipo }]);
    setTimeout(() => setLista((l) => l.filter((t) => t.id !== id)), tipo === "erro" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={add}>
      {children}
      <div data-avisos className="no-print pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
        {lista.map((t) => (
          <div key={t.id} className="anim-entra pointer-events-auto flex items-start gap-2.5 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-xl">
            {t.tipo === "ok" ? <Check className="mt-0.5 size-4 shrink-0 text-brand-200" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-300" />}
            <span>{t.texto}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Vazio({ icone, titulo, texto, children }: { icone: React.ReactNode; titulo: string; texto?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">{icone}</div>
      <div className="mt-3 font-semibold">{titulo}</div>
      {texto && <p className="mt-1 max-w-sm text-sm text-muted">{texto}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function Carregando() {
  return <div className="grid min-h-[50vh] place-items-center text-muted"><LoaderCircle className="size-6 animate-spin" /></div>;
}

// ---------- paginação ----------
// usePaginacao(lista, 50, filtro): devolve a página atual e os controles. Volta à página 1 quando "chave" muda.
export function usePaginacao<T>(lista: T[], porPadrao = 50, chave: unknown = "") {
  const [pagina, setPagina] = useState(1), [por, setPor] = useState(porPadrao);
  const total = lista.length, paginas = Math.max(1, Math.ceil(total / por));
  useEffect(() => { setPagina(1); }, [chave, por]);
  const p = Math.min(pagina, paginas);
  const itens = lista.slice((p - 1) * por, p * por);
  const controles = total > Math.min(por, 25) ? <Paginacao pagina={p} paginas={paginas} total={total} por={por} mudar={setPagina} mudarPor={setPor} /> : null;
  return { itens, controles, inicio: (p - 1) * por };
}

export function Paginacao({ pagina, paginas, total, por, mudar, mudarPor }:
  { pagina: number; paginas: number; total: number; por: number; mudar: (p: number) => void; mudarPor?: (n: number) => void }) {
  const ini = (pagina - 1) * por + 1, fim = Math.min(total, pagina * por);
  const nums = Array.from(new Set([1, pagina - 1, pagina, pagina + 1, paginas])).filter((n) => n >= 1 && n <= paginas).sort((a, b) => a - b);
  const btn = "grid h-8 min-w-8 place-items-center rounded-lg px-2 text-[13px] font-medium tabular transition disabled:opacity-30";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-[13px] text-muted">
      <span className="tabular">{ini.toLocaleString("pt-BR")}–{fim.toLocaleString("pt-BR")} de {total.toLocaleString("pt-BR")}</span>
      <div className="flex items-center gap-1">
        <button className={cx(btn, "hover:bg-slate-200/60")} disabled={pagina <= 1} onClick={() => mudar(pagina - 1)} aria-label="Página anterior">‹</button>
        {nums.map((n, k) => (
          <span key={n} className="flex items-center gap-1">
            {k > 0 && n - nums[k - 1] > 1 && <span className="px-1">…</span>}
            <button className={cx(btn, n === pagina ? "bg-ink text-white" : "hover:bg-slate-200/60 text-ink")} onClick={() => mudar(n)}>{n}</button>
          </span>
        ))}
        <button className={cx(btn, "hover:bg-slate-200/60")} disabled={pagina >= paginas} onClick={() => mudar(pagina + 1)} aria-label="Próxima página">›</button>
      </div>
      {mudarPor && (
        <select value={por} onChange={(e) => mudarPor(Number(e.target.value))} className="h-8 rounded-lg border border-line bg-white px-2 text-[13px] text-ink">
          {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} por página</option>)}
        </select>
      )}
    </div>
  );
}

// ---------- abas ----------
export function Abas<K extends string>({ abas, ativa, mudar, className }: { abas: { k: K; n: React.ReactNode; cont?: number; alerta?: boolean }[]; ativa: K; mudar: (k: K) => void; className?: string }) {
  return (
    <div className={cx("flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line", className)}>
      {abas.map((a) => (
        <button key={a.k} onClick={() => mudar(a.k)} className={cx("relative inline-flex h-10 shrink-0 items-center gap-2 px-3 text-[13px] font-medium transition",
          ativa === a.k ? "text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-600" : "text-muted hover:text-ink")}>
          {a.n}{a.cont != null && a.cont > 0 && <span className={cx("rounded-full px-1.5 text-[11px] font-semibold tabular", a.alerta ? "bg-rose-600 text-white" : "bg-slate-200 text-slate-700")}>{a.cont}</span>}
        </button>
      ))}
    </div>
  );
}
