"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ArrowRightLeft, Factory, FileCode2, ClipboardCheck, PackageOpen, ShieldAlert, Undo2, ShieldCheck, Shuffle, Warehouse } from "lucide-react";
import { Topo, useConformidade, usePode } from "@/components/topo";
import { Alertas } from "@/components/alertas";
import { Card, cx } from "@/components/ui";
import { api, fq, type Row } from "@/lib/client";

export default function Painel() {
  const conf = useConformidade(), pode = usePode();
  const [inv, setInv] = useState<Row[] | null>(null), [prod, setProd] = useState<Row | null>(null);
  useEffect(() => {
    api<Row[]>("inventarios").then(setInv).catch(() => setInv([]));
    const hoje = new Date().toLocaleDateString("sv-SE");
    api(`producao?de=${hoje}&ate=${hoje}`).then(setProd).catch(() => setProd(null));
  }, []);
  const rot = (id: string) => conf?.rotinas?.find((r: Row) => r.id === id);
  const prodHoje = (prod?.producoes || []) as Row[];
  const pend = (prod?.pendentes || []) as Row[];
  const nPend = pend.reduce((s, p) => s + p.n, 0);

  const modulos = [
    { href: "/inventario", icone: Warehouse, nome: "Inventário", texto: "Contagem, recontagem, auditoria e ajuste de estoque.", rotina: "inventario",
      info: inv ? `${inv.filter((i) => !["ENCERRADO", "CANCELADO", "PROGRAMADO"].includes(i.etapa)).length} em andamento · ${inv.filter((i) => i.etapa === "PROGRAMADO").length} programado(s)` : "…" },
    { href: "/producao", icone: Factory, nome: "Produção", texto: "Acompanhar o que foi apontado no coletor.", rotina: "producao",
      info: prod ? `Hoje: ${prodHoje.filter((p) => p.status === "LANCADA").length} lançada(s), ${fq(prodHoje.filter((p) => p.status === "LANCADA").reduce((s, p) => s + p.qtd, 0))} un.` : "…",
      alerta: nPend ? `${nPend} aguardando lançamento` : "" },
    { href: "/movimentos", icone: ArrowRightLeft, nome: "Movimentos do coletor", texto: "Transferência, transformação, kit, retorno e perdas: acompanhar e tratar pendência.", rotina: "movimentos" },
    { href: "/conferencia", icone: ClipboardCheck, nome: "Conferência de expedição", texto: "Acompanhar, ver divergência e encerrar.", rotina: "conferencia" },
    { href: "/xml", icone: FileCode2, nome: "Importação de XML", texto: "Vendas Shopee e Mercado Livre: cliente, pedido, nota, fiscal e financeiro.", rotina: "xml" },
  ];

  return (
    <>
      <Topo />
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Painel</h1>
        <p className="mt-1 text-sm text-muted">Rotinas operacionais integradas ao Lieto. Login e permissões com o usuário do Lieto.</p>
        <Alertas />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {modulos.filter((m) => pode(m.rotina === "inventario" ? ["inventario", "inventario_gestao", "inventario_lancar"] : m.rotina === "producao" ? ["producao", "producao_gestao"] : m.rotina === "movimentos" ? ["transferencia", "transformacao", "kit", "retorno", "perda"] : m.rotina === "conferencia" ? ["conferencia_gestao"] : [m.rotina])).map((m) => {
            const r = m.rotina ? rot(m.rotina) : null, bloqueado = r && !r.ok;
            const corpo = (
              <Card className={cx("flex h-full flex-col p-5 transition", m.href && "group-hover:shadow-md group-hover:ring-1 group-hover:ring-brand-200")}>
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-700"><m.icone className="size-5" /></span>
                  {r ? (bloqueado
                      ? <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200"><ShieldAlert className="size-3.5" />Gravação bloqueada</span>
                      : <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-200"><ShieldCheck className="size-3.5" />Banco conforme</span>) : null}
                </div>
                <div className="mt-4 text-[17px] font-semibold tracking-tight">{m.nome}</div>
                <p className="mt-1 flex-1 text-sm text-muted">{m.texto}</p>
                {m.info && <div className="mt-4 text-[13px] font-medium tabular">{m.info}</div>}
                {m.alerta && <div className="mt-1 text-[13px] font-semibold text-amber-700">{m.alerta}</div>}
                {m.href && <div className="mt-3 flex items-center gap-1 text-[13px] font-semibold text-brand-700">Abrir <ArrowRight className="size-4 transition group-hover:translate-x-0.5" /></div>}
              </Card>
            );
            return m.href ? <Link key={m.nome} href={m.href} className="group">{corpo}</Link> : <div key={m.nome}>{corpo}</div>;
          })}
        </div>
      </main>
    </>
  );
}
