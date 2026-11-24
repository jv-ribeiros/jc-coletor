"use client";
// Porta de entrada: senha do usuário no Lieto. Protege a gestão e o coletor.
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Warehouse } from "lucide-react";
import { SoGestao } from "@/components/so-gestao";
import { TelaCheia } from "@/components/instalar";
import { api, sessao } from "@/lib/client";

export function Acesso({ children }: { children: React.ReactNode }) {
  const rota = usePathname();
  // coletor: visual próprio (vale também para modais e avisos, que ficam no body)
  useEffect(() => { document.body.classList.toggle("coletor", rota.startsWith("/coletor")); }, [rota]);
  const [st, setSt] = useState<"?" | "fora" | "dentro">("?");
  useEffect(() => {
    const ver = () => setSt(sessao.token() ? "dentro" : "fora");
    ver();
    window.addEventListener("sessao", ver);
    // confere se a sessão ainda vale (o api() limpa o token se o servidor responder 401)
    if (sessao.token()) api("sessao").then((u) => { if (u?.nome) ls_atualiza(u); }).catch(() => {});
    return () => window.removeEventListener("sessao", ver);
  }, []);
  if (st === "?") return null;
  return <><TelaCheia ativo={rota.startsWith("/coletor")} />{st === "fora" ? <Login /> : rota.startsWith("/coletor") ? children : <SoGestao>{children}</SoGestao>}</>;
}
const ls_atualiza = (u: unknown) => { try { localStorage.setItem("inv.usuario", JSON.stringify(u)); } catch {} };

// Nome da empresa: vem sempre do config.json (via "info"). Vazio enquanto carrega ou se não configurado.
let empresaCache = "";
export function useEmpresa() {
  const [empresa, setEmpresa] = useState(empresaCache);
  useEffect(() => {
    let vivo = true;
    api("info").then((i) => { empresaCache = i.empresa || ""; if (vivo) setEmpresa(empresaCache); }).catch(() => {});
    return () => { vivo = false; };
  }, []);
  return empresa;
}

function Login() {
  const [senha, setSenha] = useState(""), [ver, setVer] = useState(false);
  const [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false), empresa = useEmpresa();
  const refSenha = useRef<HTMLInputElement>(null);
  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (!senha) return setErro("Informe a senha.");
    setOcupado(true); setErro("");
    try { const r = await api("sessao/entrar", { senha }); sessao.gravar(r.token, r.usuario); }
    catch (x) { setErro((x as Error).message); setSenha(""); refSenha.current?.focus(); }
    finally { setOcupado(false); }
  }
  const campo = "h-14 w-full rounded-xl border-0 bg-white px-4 text-xl font-semibold text-ink outline-none ring-4 ring-transparent transition focus:ring-brand-500/40";
  return (
    <div className="min-h-dvh bg-brand-900 text-white">
      <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-white/10"><Warehouse className="size-6" /></span>
          <div><div className="text-xl font-semibold tracking-tight">Operações Lieto</div><div className="text-sm text-brand-100/70">{empresa}</div></div>
        </div>
        <form onSubmit={entrar} className="mt-10 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-brand-100">Senha</span>
            <span className="relative block">
              <input autoFocus ref={refSenha} value={senha} onChange={(e) => setSenha(e.target.value)} type={ver ? "text" : "password"} autoComplete="current-password" enterKeyHint="go"
                className={campo + " pr-14 tracking-widest"} placeholder="••••" />
              <button type="button" onClick={() => setVer(!ver)} className="absolute right-2 top-2 grid size-10 place-items-center rounded-lg text-muted" aria-label="Mostrar senha">
                {ver ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </button>
            </span>
          </label>
          {erro && <p className="rounded-xl bg-rose-500/25 px-4 py-3 text-sm font-medium">{erro}</p>}
          <button disabled={ocupado} className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 text-lg font-semibold transition hover:bg-brand-600 disabled:opacity-60">
            {ocupado ? <LoaderCircle className="size-5 animate-spin" /> : <>Entrar <ArrowRight className="size-5" /></>}
          </button>
        </form>
        <p className="mt-8 flex items-center gap-2 text-[13px] text-brand-100/60"><LockKeyhole className="size-4" />Use a sua senha do Lieto.</p>
      </div>
    </div>
  );
}

export async function sair() {
  try { await api("sessao/sair", {}); } catch {}
  sessao.limpar();
}
