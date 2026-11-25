"use client";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { api, fdata, fq, frs, type Row } from "@/lib/client";

// Só lotes cadastrados para o produto no Lieto
export function SelectLote({ codpro, valor, mudar, className }: { codpro: string; valor: string; mudar: (v: string) => void; className: string }) {
  const [l, setL] = useState<Row[] | null>(null);
  useEffect(() => {
    let vivo = true; setL(null); mudar("");
    api<Row[]>(`producao/lotes?codpro=${encodeURIComponent(codpro)}`).then((x) => vivo && setL(x)).catch(() => vivo && setL([]));
    return () => { vivo = false; };
  }, [codpro]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <select className={className} value={valor} onChange={(e) => mudar(e.target.value)} disabled={!l?.length}>
      <option value="">{l === null ? "Carregando…" : l.length ? "Sem lote" : "Nenhum lote cadastrado"}</option>
      {l?.map((x) => <option key={x.lote} value={x.lote}>{x.lote}{x.validade ? ` · val. ${fdata(x.validade)}` : ""}</option>)}
    </select>
  );
}

export function TabelaInsumos({ sim }: { sim: Row }) {
  return (
    <div>
      {sim.aviso && <p className="mb-2 text-[12px] text-amber-700">{sim.aviso}</p>}
      <table className="w-full text-[13px]">
        <thead className="text-left text-[12px] text-muted"><tr className="border-b border-line"><th className="py-1.5 pr-3">Código</th><th>Insumo (sai do estoque)</th><th>Qtd</th><th>Saldo atual</th></tr></thead>
        <tbody>{sim.insumos.map((i: Row) => (
          <tr key={i.codpro} className="border-b border-line">
            <td className="py-1.5 pr-3 tabular">{i.codpro}</td><td className="font-medium">{i.nompro}</td>
            <td className="tabular">{fq(i.qtd)} {i.unipro}</td>
            <td className={cx("tabular", i.saldo != null && i.saldo < i.qtd && "font-semibold text-rose-700")}>{i.saldo == null ? "—" : fq(i.saldo)}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className="mt-2 text-right text-[13px]">Custo unitário estimado: <b>{frs(sim.custo)}</b></div>
    </div>
  );
}
