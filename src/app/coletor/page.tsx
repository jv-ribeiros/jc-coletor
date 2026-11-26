"use client";
// Coletor: tarefas primeiro. O que a pessoa deixou aberto, depois o que espera, depois as rotinas.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, Check, ChevronRight, Factory, LogOut, Settings, PackageOpen, PackageX, ClipboardCheck, ShieldAlert, Tags, Undo2, Shuffle, Warehouse } from "lucide-react";
import { sair } from "@/components/acesso";
import { Cabecalho } from "@/components/coletor";
import { useConformidade, usePode } from "@/components/topo";
import { NOME_ETAPA, api, fq, ls, sessao, type Row } from "@/lib/client";

const MODULOS = [
  { href: "/coletor/conferencia", icone: ClipboardCheck, nome: "Conferência", rotina: "conferencia" },
  { href: "/coletor/inventario", icone: Warehouse, nome: "Inventário", rotina: "inventario" },
  { href: "/coletor/producao", icone: Factory, nome: "Produção", rotina: "producao" },
  { href: "/coletor/transferencia", icone: ArrowRightLeft, nome: "Transferência", rotina: "transferencia" },
  { href: "/coletor/transformacao", icone: Shuffle, nome: "Transformação", rotina: "transformacao" },
  { href: "/coletor/retorno", icone: Undo2, nome: "Retorno", rotina: "retorno" },
  { href: "/coletor/perda", icone: PackageX, nome: "Perdas", rotina: "perda" },
  { href: "/coletor/kit", icone: PackageOpen, nome: "Kit", rotina: "kit" },
  { href: "/coletor/cadastro", icone: Tags, nome: "Cadastro", rotina: "cadastro" },
];

export default function ColetorInicio() {
  const u = sessao.usuario(), conf = useConformidade(), pode = usePode(), liberados = MODULOS.filter((m) => pode([m.rotina]));
  const cf = pode(["conferencia"]), iv = pode(["inventario"]);
  const [abertas, setAbertas] = useState<Row[]>([]), [fila, setFila] = useState<Row[] | null>(null), [inv, setInv] = useState<Row | null>(null), [erro, setErro] = useState(""), [dia, setDia] = useState("");
  const ler = useCallback(() => {
    setErro("");
    const falhou = (e: unknown) => setErro((e as Error).message === "Failed to fetch" ? "Sem conexão com o servidor." : (e as Error).message);
    if (cf) { api<Row[]>("conferencia/minhas").then(setAbertas).catch(falhou); api<Row[]>("conferencia/fila").then((l) => setFila(l.filter((x) => !x.conferencia))).catch(falhou); }
    if (iv) { const id = ls.get<number | null>("invId", null); if (id) api("info").then((i) => setInv(i.inventarios.find((x: Row) => x.id === id) || null)).catch(falhou); }
  }, [cf, iv]);
  useEffect(() => { ler(); }, [ler]);
  useEffect(() => { const d = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }); setDia(d[0].toUpperCase() + d.slice(1)); }, []);
  const c = abertas[0];
  return (
    <div className="tela">
      <Cabecalho titulo={u?.nome || "Coletor"} sub={dia} dir={<><Link href="/coletor/ajustes" className="ic" title="Ajustes" aria-label="Ajustes"><Settings /></Link><button className="ic" onClick={sair} title="Sair" aria-label="Sair"><LogOut /></button></>} />
      <main className="corpo">
        {erro && <div className="aviso-e">{erro}<button className="bt2 mt-3 w-full !bg-white" onClick={ler}>Tentar de novo</button></div>}
        {c ? <Link href={`/coletor/conferencia?id=${c.id}`} className="heroi"><small>Você parou aqui</small><b>{c.pedido ? `Pedido ${c.pedido}` : `Romaneio ${c.romaneio}`}</b><small>{c.cliente}</small><div className="barra"><i style={{ width: `${c.total ? (c.feito / c.total) * 100 : 0}%` }} /></div><div className="ir">Continuar<span className="tabular">{fq(c.feito)} / {fq(c.total)}</span></div></Link>
          : inv ? <Link href={`/coletor/inventario?id=${inv.id}`} className="heroi"><small>Você parou aqui</small><b>{inv.descricao}</b><small>Inventário · {NOME_ETAPA[inv.etapa]}</small><div className="ir">Continuar<ChevronRight /></div></Link> : null}
        {cf && fila && (fila.length ? <>
          <div className="secao">Próximos pedidos</div>
          <Link href="/coletor/conferencia" className="linha"><div><b>{fila.length} {fila.length === 1 ? "pedido esperando" : fila.length >= 300 ? "ou mais esperando" : "pedidos esperando"}</b><small>Próximo: {fila[0].pedido} · {fila[0].cliente}</small></div><ChevronRight /></Link></>
          : !c && <div className="vazio"><Check /><b>Nada pendente</b>Nenhum pedido esperando.</div>)}
        {pode.pronto && !liberados.length && <div className="vazio"><b>Nenhuma rotina liberada</b>Peça a um administrador.</div>}
        {liberados.length > 0 && <div className="secao">Rotinas</div>}
        <div className="grade">{liberados.map((m) => {
          const r = conf?.rotinas?.find((x: Row) => x.id === m.rotina), bloq = r && !r.ok;
          return <Link key={m.nome} href={m.href} className="modulo"><m.icone strokeWidth={1.8} />{m.nome}{bloq && <span><ShieldAlert />Bloqueado</span>}</Link>;
        })}</div>
      </main>
    </div>
  );
}
