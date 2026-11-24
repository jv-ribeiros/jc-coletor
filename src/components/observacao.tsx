"use client";
// Observação, igual em todas as rotinas: sempre opcional. "cabe" = letras que o Lieto aceita (0 = fica só aqui; sem valor = texto longo).
import { Campo, campoCol } from "@/components/coletor";

export function Observacao({ valor, mudar, cabe, off, nome = "Observação" }: { valor: string; mudar: (v: string) => void; cabe?: number; off?: boolean; nome?: string }) {
  const t = valor.trim(), lieto = t.toUpperCase().replace(/\s+/g, " ");
  return (
    <div>
      <Campo nome={nome}><textarea className={campoCol + " !h-20 py-2.5"} maxLength={500} disabled={off} placeholder="Opcional" value={valor} onChange={(e) => mudar(e.target.value)} /></Campo>
      {t && <p className="mt-1 text-[12px] text-muted">{cabe === 0 ? "Fica só aqui: o Lieto não tem campo." : cabe && lieto.length > cabe ? <>No Lieto cabem {cabe} letras: &quot;{lieto.slice(0, cabe)}&quot;. O texto completo fica aqui.</> : "Vai também para o Lieto."}</p>}
    </div>
  );
}
