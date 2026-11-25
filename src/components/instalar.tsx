"use client";
// Coletor em tela cheia e instalação.
// Tela cheia fica DESLIGADA até ligarem em Ajustes. Ligada, o navegador só deixa entrar a partir de um toque.
// Instalar de verdade (botão do Chrome) exige HTTPS; sem HTTPS mostramos como criar o atalho.
import { useEffect, useState } from "react";
import { Download, Maximize, Minimize } from "lucide-react";
import { Modal, Button } from "@/components/ui";
import { ls } from "@/lib/client";

type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let guardado: Prompt | null = null;
const avisar = () => window.dispatchEvent(new Event("instalar"));
const instalado = () => matchMedia("(display-mode: fullscreen)").matches && !document.fullscreenElement || matchMedia("(display-mode: standalone)").matches;

async function entrar() { try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" }); } catch { /* aparelho não permite */ } }
async function saindo() { try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* */ } }

// Montado uma vez no Acesso; age só dentro do coletor.
export function TelaCheia({ ativo }: { ativo: boolean }) {
  useEffect(() => {
    const f = (e: Event) => { e.preventDefault(); guardado = e as Prompt; avisar(); }, g = () => { guardado = null; avisar(); };
    window.addEventListener("beforeinstallprompt", f); window.addEventListener("appinstalled", g);
    if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => { window.removeEventListener("beforeinstallprompt", f); window.removeEventListener("appinstalled", g); };
  }, []);
  useEffect(() => {
    if (!ativo) { saindo(); return; }
    const f = (e: Event) => { if ((e.target as Element | null)?.closest?.("[data-semcheia]")) return; if (ls.get("telacheia2", false)) entrar(); };
    // a cada toque: se o teclado, um alerta ou o botão voltar tirou da tela cheia, ela volta no próximo toque
    document.addEventListener("click", f, true);
    return () => document.removeEventListener("click", f, true);
  }, [ativo]);
  return null;
}

export function BotoesApp() {
  const [cheia, setCheia] = useState(false), [pronto, setPronto] = useState(false), [inst, setInst] = useState(false), [ajuda, setAjuda] = useState(false), [podeCheia, setPode] = useState(false);
  useEffect(() => {
    const f = () => { setPronto(!!guardado); setInst(instalado()); };
    f(); setCheia(ls.get("telacheia2", false)); setPode(!!document.documentElement.requestFullscreen);
    window.addEventListener("instalar", f); return () => window.removeEventListener("instalar", f);
  }, []);
  function alternar() { const v = !cheia; ls.set("telacheia2", v); setCheia(v); if (v) entrar(); else saindo(); }
  async function instalar() { if (!guardado) return setAjuda(true); const p = guardado; await p.prompt(); if ((await p.userChoice).outcome === "accepted") { guardado = null; avisar(); } }
  const bt = "bt2 gap-2 !text-[15px]";
  return (
    <div className="grid grid-cols-2 gap-2" data-semcheia>
      <button className={bt} disabled={!podeCheia} aria-pressed={cheia} onClick={alternar}>{cheia ? <Minimize className="size-4" /> : <Maximize className="size-4" />}Tela cheia: {cheia ? "ligada" : "desligada"}</button>
      <button className={bt} disabled={inst} onClick={instalar}><Download className="size-4" />{inst ? "Instalado" : "Instalar"}</button>
      <Modal aberto={ajuda} onClose={() => setAjuda(false)} titulo="Instalar no aparelho" rodape={<Button onClick={() => setAjuda(false)}>Entendi</Button>}>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink"><li>No Chrome, toque nos três pontinhos (⋮).</li><li>Toque em <b>Adicionar à tela inicial</b> ou <b>Instalar app</b>.</li><li>Abra sempre pelo ícone <b>Coletor</b>.</li></ol>
        {!pronto && typeof window !== "undefined" && !window.isSecureContext && <p className="mt-3 text-[13px] text-muted">Este endereço não é HTTPS, então o Chrome cria só um atalho.</p>}
      </Modal>
    </div>
  );
}
