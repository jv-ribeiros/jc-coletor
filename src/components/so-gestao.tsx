"use client";
// Telas da gestão: só abrem com a liberação "gestao" (o servidor também recusa os dados). Sem ela, vai para o coletor.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { api } from "@/lib/client";

export function SoGestao({ children }: { children: React.ReactNode }) {
  const router = useRouter(), [ok, setOk] = useState(false), [erro, setErro] = useState("");
  const ver = useCallback(() => {
    setErro("");
    api("sessao").then((u) => { const pode = !!u?.admin || !!u?.rotinas?.includes("gestao"); setOk(pode); if (!pode) router.replace("/coletor"); }).catch((e) => setErro((e as Error).message));
  }, [router]);
  useEffect(() => { ver(); window.addEventListener("sessao", ver); const t = setInterval(ver, 120_000); return () => { window.removeEventListener("sessao", ver); clearInterval(t); }; }, [ver]);
  if (ok) return <>{children}</>;
  return <div className="grid min-h-dvh place-items-center text-sm text-muted">{erro ? <button className="underline" onClick={ver}>{erro} — tentar de novo</button> : <LoaderCircle className="size-6 animate-spin" />}</div>;
}
