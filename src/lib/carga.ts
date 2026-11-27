"use client";
// Padrão "Carregando" (design/patterns/carregando_v1.html, aprovado):
// R4 voltar para uma tela já vista mostra na hora o último resultado e atualiza por baixo; R5 esqueleto só depois de 0,2 s;
// O4 a primeira carga troca tudo de uma vez (ou em 3 s); R6 passou de 8 s, avisa que está demorando.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, sessao } from "./client";

const mem = new Map<string, unknown>(); // último resultado de cada rota nesta aba (some ao recarregar a página)
export const msgErro = (e: unknown) => { const m = (e as Error)?.message || String(e); return m === "Failed to fetch" || m.includes("NetworkError") ? "Sem conexão com o servidor." : m; };
export const semRede = (erro: string) => erro === "Sem conexão com o servidor.";

// Lê uma rota GET guardando o último resultado. url null = não precisa ler.
export function useCarga<T>(url: string | null) {
  const chave = url ? `${sessao.token()}|${url}` : "";
  const [st, setSt] = useState<{ chave: string; d: T | undefined; erro: string }>(() => ({ chave, d: mem.get(chave) as T | undefined, erro: "" }));
  const [ocupado, setOcupado] = useState(false);
  const atual = useRef(chave); atual.current = chave;
  const ler = useCallback(async () => {
    if (!url) return;
    setOcupado(true);
    try { const d = await api<T>(url); mem.set(chave, d); if (atual.current === chave) setSt({ chave, d, erro: "" }); }
    catch (e) { if (atual.current === chave) setSt((s) => ({ chave, d: s.chave === chave ? s.d : (mem.get(chave) as T | undefined), erro: msgErro(e) })); }
    finally { if (atual.current === chave) setOcupado(false); }
  }, [url, chave]);
  useEffect(() => { ler(); }, [ler]);
  const valido = st.chave === chave, d = valido ? st.d : (mem.get(chave) as T | undefined);
  // pronto: já tem dado (mesmo antigo) ou já respondeu com erro
  return { d, erro: valido ? st.erro : "", ocupado, pronto: !url || d !== undefined || (valido && !!st.erro), ler };
}

// Tempo desde que começou a esperar: esqueleto (0,2 s), tres (3 s), lento (8 s). Zera quando para de esperar.
export function useEspera(esperando: boolean) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!esperando) { setT(0); return; }
    const ts = [setTimeout(() => setT(1), 200), setTimeout(() => setT(2), 3000), setTimeout(() => setT(3), 8000)];
    return () => ts.forEach(clearTimeout);
  }, [esperando]);
  return { esqueleto: esperando && t >= 1, tres: esperando && t >= 2, lento: esperando && t >= 3 };
}
