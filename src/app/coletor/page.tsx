"use client";
// Coletor: escolha do módulo. Cada módulo tem sua tela própria, otimizada para leitor de código de barras.
import Link from "next/link";
import { ArrowRightLeft, Factory, LogOut, PackageOpen, PackageX, ClipboardCheck, ShieldAlert, Tags, Undo2, Shuffle, Warehouse } from "lucide-react";
import { BotoesApp } from "@/components/instalar";
import { sair } from "@/components/acesso";
import { useConformidade, usePode } from "@/components/topo";
import { sessao, type Row } from "@/lib/client";

const MODULOS = [
  { href: "/coletor/inventario", icone: Warehouse, nome: "Inventário", texto: "Contagem, recontagem e auditoria", rotina: "inventario" },
  { href: "/coletor/producao", icone: Factory, nome: "Produção", texto: "Apontar o que foi produzido", rotina: "producao" },
  { href: "/coletor/transferencia", icone: ArrowRightLeft, nome: "Transferência", texto: "Entre centros de estoque", rotina: "transferencia" },
  { href: "/coletor/transformacao", icone: Shuffle, nome: "Transformação", texto: "CX em UN e UN em CX", rotina: "transformacao" },
  { href: "/coletor/conferencia", icone: ClipboardCheck, nome: "Conferência", texto: "Expedição por pedido ou romaneio", rotina: "conferencia" },
  { href: "/coletor/retorno", icone: Undo2, nome: "Retorno", texto: "Mercadoria que voltou da entrega", rotina: "retorno" },
  { href: "/coletor/cadastro", icone: Tags, nome: "Cadastro", texto: "Dados, barras, receita e palete", rotina: "cadastro" },
  { href: "/coletor/kit", icone: PackageOpen, nome: "Kit", texto: "Entra o kit, saem os itens", rotina: "kit" },
  { href: "/coletor/perda", icone: PackageX, nome: "Perdas", texto: "Avaria, vencido, uso e consumo", rotina: "perda" },
];

export default function ColetorInicio() {
  const u = sessao.usuario(), conf = useConformidade(), pode = usePode(), liberados = MODULOS.filter((m) => pode([m.rotina]));
  return (
    <div className="min-h-dvh bg-brand-900 text-white">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1"><div className="text-lg font-semibold">Coletor</div><div className="truncate text-sm text-brand-100/70">{u?.nome}</div></div>
          <button onClick={sair} className="grid size-11 place-items-center bg-white/10" title="Sair" aria-label="Sair"><LogOut className="size-5" /></button>
        </div>
        {pode.pronto && !liberados.length && <p className="bg-white/10 p-4 text-sm">Nenhuma rotina liberada para o seu usuário. Peça a um administrador.</p>}
        <div className="grid grid-cols-2 gap-2">
          {liberados.map((m) => {
            const r = conf?.rotinas?.find((x: Row) => x.id === m.rotina), bloq = r && !r.ok;
            return (
              <Link key={m.nome} href={m.href} className="relative flex aspect-[5/4] flex-col items-center justify-center gap-2.5 bg-white p-2 text-center text-ink active:bg-brand-100">
                <m.icone className="size-9 text-brand-700" strokeWidth={1.75} />
                <span className="text-[15px] font-semibold leading-tight">{m.nome}</span>
                {bloq && <span className="absolute inset-x-0 top-0 flex items-center justify-center gap-1 bg-rose-700 py-0.5 text-[10px] font-semibold text-white"><ShieldAlert className="size-3" />Bloqueado</span>}
              </Link>
            );
          })}
        </div>
        <div className="mt-auto space-y-3"><BotoesApp />{pode(["gestao"]) && <Link href="/" className="block py-1 text-center text-[13px] text-brand-100/60 underline underline-offset-2">Abrir a gestão</Link>}</div>
      </div>
    </div>
  );
}
