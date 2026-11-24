"use client";
// Coletor › Inventário: finalizar contagem, recontagem ou auditoria. Só aparece para quem tem a liberação.
import { useState } from "react";
import { Flag } from "lucide-react";
import { Button, useConfirm, useToast } from "@/components/ui";
import { usePode } from "@/components/topo";
import { ApiErro, NOME_ETAPA, api, fdata, type Row } from "@/lib/client";

const NOME: Record<string, string> = { CONTAGEM: "contagem", RECONTAGEM: "recontagem", AUDITORIA: "auditoria" };

export function FinalizarEtapa({ invId, etapa, naoEnviadas, feito }: { invId: number; etapa: string; naoEnviadas: number; feito: () => void }) {
  const pode = usePode()(["inventario_finalizar", "inventario_gestao"]), [oc, setOc] = useState(false), toast = useToast(), { confirmar, dialogo } = useConfirm();
  if (!pode || !NOME[etapa]) return null;
  async function finalizar() {
    if (naoEnviadas) return toast(`Há ${naoEnviadas} leitura(s) deste aparelho ainda não enviadas.`, "erro");
    setOc(true);
    try {
      const s: Row = await api(`inventarios/${invId}/fechamento`);
      if (s.etapa !== etapa) { toast(`O inventário já está em ${NOME_ETAPA[s.etapa] || s.etapa}.`, "erro"); return feito(); }
      const texto = (
        <span className="block space-y-2">
          <span className="block"><b>{s.feitos}</b> de <b>{s.total}</b> item(ns) com leitura.</span>
          {s.faltam > 0 && <span className="block font-semibold text-rose-700">{s.faltam} sem leitura: {etapa === "CONTAGEM" ? "serão tratados como ZERO e vão para recontagem se tiverem saldo." : etapa === "RECONTAGEM" ? "vão direto para a auditoria." : "a auditoria não fecha com item sem decisão."}</span>}
          {s.ativos.length > 0 && <span className="block font-semibold text-amber-800">Leram nos últimos 10 min: {s.ativos.map((a: Row) => `${a.usuario} (${fdata(a.ultima).slice(11)})`).join(", ")}. O que ainda não enviaram será recusado.</span>}
          <span className="block">Não dá para reabrir a etapa depois.</span>
        </span>
      );
      if (!(await confirmar({ titulo: `Finalizar a ${NOME[etapa]}?`, texto, acao: "Finalizar", palavra: "FINALIZAR", perigo: true }))) return;
      const enviar = (forcar: boolean) => api(`inventarios/${invId}/avancar`, { etapa, forcar });
      let r: Row;
      try { r = await enviar(etapa === "RECONTAGEM" && s.faltam > 0); }
      catch (e) { // apareceu item sem recontagem entre a conferência e o envio
        if (!(e instanceof ApiErro && e.status === 409 && etapa === "RECONTAGEM" && /sem recontagem/.test(e.message)) || !(await confirmar({ titulo: "Continuar?", texto: e.message, perigo: true }))) throw e;
        r = await enviar(true);
      }
      toast(`Finalizada. Agora: ${NOME_ETAPA[r.etapa] || r.etapa}${r.recontar ? ` (${r.recontar} para recontar)` : r.auditar ? ` (${r.auditar} para auditar)` : ""}.`);
      feito();
    } catch (e) { toast((e as Error).message, "erro"); feito(); } finally { setOc(false); }
  }
  return <><Button size="lg" variant="dark" className="w-full" loading={oc} onClick={finalizar}><Flag className="size-5" />Finalizar {NOME[etapa]}</Button>{dialogo}</>;
}
