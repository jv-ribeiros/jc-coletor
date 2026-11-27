"use client";
// Coletor: tarefas primeiro. O que a pessoa deixou aberto, depois o que espera, depois as rotinas.
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRightLeft, Check, ChevronRight, Factory, LogOut, Settings, PackageOpen, PackageX, ClipboardCheck, PackageCheck, ShieldAlert, Tags, Undo2, Shuffle, Warehouse } from "lucide-react";
import { sair } from "@/components/acesso";
import { Cabecalho } from "@/components/coletor";
import { useConformidade, usePode } from "@/components/topo";
import { NOME_ETAPA, fq, ls, sessao, type Row } from "@/lib/client";
import { semRede, useCarga, useEspera } from "@/lib/carga";

const MODULOS = [
  { href: "/coletor/conferencia", icone: ClipboardCheck, nome: "Conferência", rotina: "conferencia" },
  { href: "/coletor/recebimento", icone: PackageCheck, nome: "Recebimento", rotina: "recebimento" },
  { href: "/coletor/inventario", icone: Warehouse, nome: "Inventário", rotina: "inventario" },
  { href: "/coletor/producao", icone: Factory, nome: "Produção", rotina: "producao" },
  { href: "/coletor/transferencia", icone: ArrowRightLeft, nome: "Transferência", rotina: "transferencia" },
  { href: "/coletor/transformacao", icone: Shuffle, nome: "Transformação", rotina: "transformacao" },
  { href: "/coletor/retorno", icone: Undo2, nome: "Retorno", rotina: "retorno" },
  { href: "/coletor/perda", icone: PackageX, nome: "Perdas", rotina: "perda" },
  { href: "/coletor/kit", icone: PackageOpen, nome: "Kit", rotina: "kit" },
  { href: "/coletor/cadastro", icone: Tags, nome: "Cadastro", rotina: "cadastro" },
];

// Padrão Carregando (aprovado): cada bloco tem o lugar reservado desde a 1ª imagem; as rotinas vêm da última liberação guardada;
// a 1ª carga troca tudo de uma vez quando as respostas chegam (ou em 3 s); voltar mostra o último resultado na hora.
export default function ColetorInicio() {
  const u = sessao.usuario(), conf = useConformidade(), pode = usePode(), liberados = MODULOS.filter((m) => pode([m.rotina]));
  const cf = pode(["conferencia"]), rb = pode(["recebimento"]), iv = pode(["inventario"]);
  const [invId, setInvId] = useState<number | null>(null), [dia, setDia] = useState("");
  useEffect(() => { setInvId(ls.get<number | null>("invId", null)); const d = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }); setDia(d[0].toUpperCase() + d.slice(1)); }, []);
  const minhas = useCarga<Row[]>(cf ? "conferencia/minhas" : null), filaC = useCarga<Row[]>(cf ? "conferencia/fila" : null), info = useCarga<Row>(iv && invId ? "info" : null), minhasR = useCarga<Row[]>(rb ? "recebimento/minhas" : null);
  const cargas = [minhas, filaC, info, minhasR], todas = cargas.every((x) => x.pronto), esp = useEspera(!todas), mostrar = todas || esp.tres;
  const ler = () => cargas.forEach((x) => x.ler());
  const erro = cargas.map((x) => x.erro).find(Boolean) || "";
  const c = minhas.d?.[0], rc = minhasR.d?.[0], fila = filaC.d?.filter((x) => !x.conferencia), inv = invId ? (info.d?.inventarios as Row[] | undefined)?.find((x) => x.id === invId) : undefined;
  const vagaHeroi = cf || rb || (iv && !!invId), heroiPronto = mostrar && minhas.pronto && info.pronto && minhasR.pronto && !(minhas.erro && !minhas.d) && !(info.erro && !info.d) && !(minhasR.erro && !minhasR.d);
  const sk = esp.esqueleto ? "sk" : "sk espera";
  return (
    <div className="tela">
      {todas && cargas.some((x) => x.ocupado) && <div className="fino" />}
      <Cabecalho titulo={u?.nome || "Coletor"} sub={dia} dir={<><Link href="/coletor/ajustes" className="ic" title="Ajustes" aria-label="Ajustes"><Settings /></Link><button className="ic" onClick={sair} title="Sair" aria-label="Sair"><LogOut /></button></>} />
      <main className="corpo">
        {vagaHeroi && (heroiPronto ? (c ? <Link href={`/coletor/conferencia?id=${c.id}`} className="heroi"><small>Você parou aqui</small><b>{c.pedido ? `Pedido ${c.pedido}` : `Romaneio ${c.romaneio}`}</b><small>{c.cliente}</small><div className="barra"><i style={{ width: `${c.total ? (c.feito / c.total) * 100 : 0}%` }} /></div><span className="esp" /><div className="ir">Continuar<span className="tabular">{fq(c.feito)} / {fq(c.total)}</span></div></Link>
            : rc ? <Link href={`/coletor/recebimento?id=${rc.id}`} className="heroi"><small>Você parou aqui</small><b>Pedido {fq(rc.pedido)}</b><small>{rc.fornecedor} · {rc.recontagem ? "Recontagem" : "Recebimento"}</small><div className="barra"><i style={{ width: `${rc.total ? (rc.feito / rc.total) * 100 : 0}%` }} /></div><span className="esp" /><div className="ir">Continuar<span className="tabular">{rc.feito} / {rc.total}</span></div></Link>
            : inv ? <Link href={`/coletor/inventario?id=${inv.id}`} className="heroi"><small>Você parou aqui</small><b>{inv.descricao}</b><small>Inventário · {NOME_ETAPA[inv.etapa]}</small><span className="esp" /><div className="ir">Continuar<ChevronRight /></div></Link>
            : <div className="vazio vaga-heroi"><Check /><b>Nada pendente</b>Nada aberto com você.</div>)
          : erro ? <div className="aviso-e vaga-heroi"><div><b className="block text-[19px]">{semRede(erro) ? "Sem conexão com o servidor" : "Não foi possível carregar"}</b>{semRede(erro) ? "O que você já contou está guardado neste aparelho e vai quando a rede voltar." : erro}</div><button className="bt2 mt-3 w-full !bg-white" onClick={ler}>Tentar de novo</button></div>
          : esp.lento ? <div className="aviso-a vaga-heroi"><div><b className="block text-[19px]">O servidor está demorando</b>Continua tentando. As rotinas funcionam normalmente.</div><button className="bt2 mt-3 w-full !bg-white" onClick={ler}>Tentar de novo</button></div>
          : <span className={`${sk} vaga-heroi`} />)}
        {cf && <>
          <div className="secao">Próximos pedidos</div>
          {mostrar && fila ? (fila.length
            ? <Link href="/coletor/conferencia" className="linha"><div><b>{fila.length} {fila.length === 1 ? "pedido esperando" : fila.length >= 300 ? "ou mais esperando" : "pedidos esperando"}</b><small>Próximo: {fila[0].pedido} · {fila[0].cliente}</small></div><ChevronRight /></Link>
            : <Link href="/coletor/conferencia" className="linha"><div><b>Nenhum pedido esperando</b><small>A fila está vazia agora.</small></div><ChevronRight /></Link>)
            : filaC.erro && !fila ? <button className="linha" onClick={ler}><div><b>Pedidos não carregaram</b><small>Toque para tentar de novo.</small></div></button>
            : <span className={`${sk} linha`} />}</>}
        {pode.pronto && !liberados.length && <div className="vazio"><b>Nenhuma rotina liberada</b>Peça a um administrador.</div>}
        {(liberados.length > 0 || !pode.pronto) && <div className="secao">Rotinas</div>}
        <div className="grade">{pode.pronto ? liberados.map((m) => {
          const r = conf?.rotinas?.find((x: Row) => x.id === m.rotina), bloq = r && !r.ok;
          return <Link key={m.nome} href={m.href} className="modulo"><m.icone strokeWidth={1.8} />{m.nome}{bloq && <span><ShieldAlert />Bloqueado</span>}</Link>;
        }) : [0, 1, 2, 3].map((k) => <span key={k} className={`${sk} modulo`} />)}</div>
      </main>
    </div>
  );
}
