"use client";
// Coletor › Conferência de expedição.
//   Com separação: diz ONDE ir; confirma o produto (bipando, se liberado em Sistema, ou na tela), digita a quantidade e passa ao próximo.
//   Cega: bipou, contou. Só mostra o último lido.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, ChevronLeft, CloudOff, Delete, List, ScanBarcode } from "lucide-react";
import { cx, useConfirm, useToast } from "@/components/ui";
import { bip, novoUid } from "@/components/movimentos";
import { Observacao } from "@/components/observacao";
import { BotaoG, Cabecalho, Esqueleto, Tela } from "@/components/coletor";
import { ApiErro, api, chave, fatorLido, fq, ls, r4, sessao, type Row } from "@/lib/client";

export default function Pagina() { return <Suspense><Fila /></Suspense>; }

// Pedidos e romaneios. Tocar no pedido abre a FICHA (não começa nada); romaneio é filtro e cada pedido é separado sozinho.
type Vista = { t: "lista" } | { t: "romaneio"; n: number } | { t: "ficha"; n: number; de?: number } | { t: "volumes"; n: number };
const dm = (s?: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : "");
const hojeIso = () => new Date().toLocaleDateString("sv-SE");
function Entrega({ d }: { d: string }) {
  if (!d) return null;
  const h = hojeIso();
  return <span className={cx("ent", d < h && "atr", d === h && "hj")}>{d === h ? "Entrega hoje" : `Entrega ${dm(d)}`}</span>;
}
function Etapa({ x }: { x: Row }) {
  if (x.conferencia === "EM ANDAMENTO" || x.conferencia === "AGUARDA GESTÃO") return <span className="tag sep">{x.id && x.usuario === sessao.usuario()?.nome ? "Com você" : `Com ${x.usuario}`}{x.feito ? ` · ${fq(x.feito.feito)} de ${fq(x.feito.total)}` : ""}{x.conferencia === "AGUARDA GESTÃO" ? " · falta" : ""}</span>;
  if (x.conferencia === "CONFERIDA") return <span className="tag ok">Conferido{x.pcp.con ? ` ${dm(x.pcp.con)}` : ""}{x.usuario ? ` · ${x.usuario}` : ""}{x.volumes ? ` · ${x.volumes} vol.` : ""}</span>;
  if (x.conferencia) return <span className="tag">{x.conferencia.toLowerCase()}</span>;
  // empresa com PCP (Sistema › Conferência): espera a liberação no Lieto. Nas outras, pedido pendente já é para separar.
  if (x.aguardaPcp) return <span className="tag am">Aguardando liberação no PCP</span>;
  return <span className={cx("tag", x.pcp.pcp && "pcp")}>{x.pcp.pcp ? `Liberado no PCP ${dm(x.pcp.pcp)}` : "A separar"}</span>;
}
function Cartao({ x, abrir, rom }: { x: Row; abrir: () => void; rom?: boolean }) {
  const fora = !["PED", "FAT"].includes(x.situacao), outro = (x.conferencia && !x.id) || x.noRomaneio;
  return (
    <button className={cx("pd", x.aguardaPcp && "ap")} disabled={fora || !!outro} onClick={abrir}>
      <div className="l1"><b>{x.pedido}</b>{rom ? x.ordem > 0 && <span className="tag">{x.ordem}º na carga</span> : x.romaneio > 0 && <span className="tag">Rom. {x.romaneio}</span>}<Entrega d={x.entrega} /></div>
      <div className="cl">{x.cliente}</div>
      <div className="in">{[x.cidade, `${x.itens} ${x.itens === 1 ? "item" : "itens"}`, x.volumes > 0 && `${x.volumes} vol.`, x.peso > 0 && `${fq(Math.round(x.peso))} kg`].filter(Boolean).join(" · ")}</div>
      <div className="ft">{fora ? <span className="tag er">Situação {x.situacao}</span> : <Etapa x={x} />}</div>
    </button>
  );
}

function Fila() {
  const pedir = Number(useSearchParams().get("id") || 0), toast = useToast();
  const [c, setC] = useState<Row | null>(null), [v, setV] = useState<Vista>({ t: "lista" }), [aba, setAba] = useState<"pedidos" | "romaneios">("pedidos"), [filtro, setFiltro] = useState("hoje");
  const [b, setB] = useState(""), [l, setL] = useState<Row[] | null>(null), [roms, setRoms] = useState<Row[] | null>(null), [erro, setErro] = useState(""), [oc, setOc] = useState(false);
  const ler = useCallback(async () => {
    setErro("");
    try {
      if (aba === "romaneios") { setRoms(await api<Row[]>("conferencia/romaneios")); return; }
      setL(await api<Row[]>(`conferencia/fila?${b.trim() ? `q=${encodeURIComponent(b.trim())}` : `filtro=${filtro}`}`));
    } catch (e) { setErro((e as Error).message); setL((x) => x ?? []); setRoms((x) => x ?? []); }
  }, [aba, b, filtro]);
  useEffect(() => { if (pedir) api(`conferencia/${pedir}`).then(setC).catch((e) => setErro((e as Error).message)); }, [pedir]);
  useEffect(() => { if (v.t === "lista" && !c) { const t = setTimeout(ler, b ? 400 : 0); return () => clearTimeout(t); } }, [ler, v, c, b]);
  async function abrir(f: () => Promise<Row>) { if (oc) return; setOc(true); try { setC(await f()); } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); } }
  const voltar = () => { setC(null); if (pedir) history.replaceState(null, "", "/coletor/conferencia"); };
  if (c) return <Contagem inicial={c} sair={voltar} />;
  if (v.t === "ficha") return <Ficha n={v.n} voltar={() => setV(v.de ? { t: "romaneio", n: v.de } : { t: "lista" })} comecar={(x) => abrir(async () => (x.id ? api(`conferencia/${x.id}`) : api("conferencia", { pedido: x.pedido })))} oc={oc} />;
  if (v.t === "romaneio") return <Romaneio n={v.n} voltar={() => setV({ t: "lista" })} ficha={(p) => setV({ t: "ficha", n: p, de: v.n })} volumes={() => setV({ t: "volumes", n: v.n })} abrirJunto={() => abrir(async () => api("conferencia/romaneio", { romaneio: v.n }))} oc={oc} />;
  if (v.t === "volumes") return <VolumesRomaneio n={v.n} voltar={() => setV({ t: "romaneio", n: v.n })} />;
  const filtros: [string, string][] = [["hoje", "Entrega até hoje"], ["amanha", "Amanhã"], ["todos", "Todos"], ["andamento", "Em andamento"]];
  return (
    <Tela titulo="Conferência" sub={aba === "pedidos" ? (l ? `${l.length}${l.length >= 300 ? "+" : ""} pedido(s)` : "Carregando…") : roms ? `${roms.length} romaneio(s)` : "Carregando…"}>
      <div className="abas2"><button className={cx(aba === "pedidos" && "sel")} onClick={() => setAba("pedidos")}>Pedidos</button><button className={cx(aba === "romaneios" && "sel")} onClick={() => setAba("romaneios")}>Romaneios</button></div>
      {aba === "pedidos" ? <>
        <div className="campo-ic"><ScanBarcode /><input enterKeyHint="search" placeholder="Pedido, cliente ou romaneio" value={b} onChange={(e) => setB(e.target.value)} /></div>
        {!b.trim() && <div className="chips">{filtros.map(([k, n]) => <button key={k} className={cx(filtro === k && "sel")} onClick={() => setFiltro(k)}>{n}</button>)}</div>}
        {erro && <div className="aviso-e">{erro}<button className="bt2 mt-3 w-full !bg-white" onClick={ler}>Tentar de novo</button></div>}
        {l === null && !erro && <Esqueleto classe="pd" altura={150} n={3} />}
        {l?.length === 0 && !erro && <div className="vazio"><Check /><b>Nenhum pedido</b>{b ? "Confira o número ou o nome." : filtro === "hoje" ? "Nada com entrega até hoje. Veja \"Todos\"." : "Nada aqui."}</div>}
        {l?.map((x) => <Cartao key={x.pedido} x={x} abrir={() => setV({ t: "ficha", n: x.pedido })} />)}
      </> : <>
        {erro && <div className="aviso-e">{erro}<button className="bt2 mt-3 w-full !bg-white" onClick={ler}>Tentar de novo</button></div>}
        {roms === null && !erro && <Esqueleto classe="pd" altura={130} n={3} />}
        {roms?.length === 0 && !erro && <div className="vazio"><Check /><b>Nenhum romaneio</b>Nenhum romaneio nos últimos 30 dias.</div>}
        {roms?.map((r) => <button key={r.romaneio} className="pd" onClick={() => setV({ t: "romaneio", n: r.romaneio })}>
          <div className="l1"><b>Romaneio {r.romaneio}</b><span className="ent">saída {dm(r.saida)}</span></div>
          {(r.rotas || r.caminhao || r.motorista) && <div className="in">{[r.rotas, r.caminhao, r.motorista].filter(Boolean).join(" · ")}</div>}
          <div className="in">{r.pedidos} pedido(s) · {r.conferidos} conferido(s){r.andamento ? ` · ${r.andamento} em andamento` : ""}</div>
          <div className="barra mt-2"><i style={{ width: `${(r.conferidos / r.pedidos) * 100}%` }} /></div>
        </button>)}
      </>}
    </Tela>
  );
}

function Romaneio({ n, voltar, ficha, volumes, abrirJunto, oc }: { n: number; voltar: () => void; ficha: (p: number) => void; volumes: () => void; abrirJunto: () => void; oc: boolean }) {
  const [l, setL] = useState<Row[] | null>(null), [r, setR] = useState<Row | null>(null), [cab, setCab] = useState<Row | null>(null), [vol, setVol] = useState<Row | null>(null), [erro, setErro] = useState("");
  useEffect(() => {
    Promise.all([api<Row[]>(`conferencia/fila?romaneio=${n}`), api(`conferencia/romaneio/${n}`), api<Row[]>("conferencia/romaneios"), api(`conferencia/romaneio/${n}/volumes`)])
      .then(([a, b, c, d]) => { setL([...a].sort((x, y) => (x.ordem || 999) - (y.ordem || 999) || x.pedido - y.pedido)); setR(b); setCab(c.find((x) => x.romaneio === n) || null); setVol(d); }).catch((e) => setErro((e as Error).message));
  }, [n]);
  const conf = l?.filter((x) => ["CONFERIDA", "ENCERRADA"].includes(x.conferencia)).length ?? 0, faltaVol = vol?.pedidos.filter((x: Row) => !x.conferido).length ?? 0;
  return (
    <Tela titulo={`Romaneio ${n}`} sub={cab ? [cab.saida && `Saída ${dm(cab.saida)}`, cab.rotas].filter(Boolean).join(" · ") : ""} voltar={voltar}
      rodape={r && <><BotaoG disabled={oc || (!r.aberta && !r.entram.length)} onClick={abrirJunto}>{r.aberta ? `Continuar o romaneio · ${r.aberta.usuario}` : r.entram.length ? `Separar os ${r.entram.length} restantes juntos` : "Nada para separar junto"}</BotaoG>
        {vol && vol.pedidos.length > 0 && <button className="bt2 mt-2 w-full" onClick={volumes}>{faltaVol ? `Conferir volumes dos ${vol.pedidos.length} já separados` : "Volumes conferidos"}</button>}</>}>
      {erro && <div className="aviso-e">{erro}</div>}
      {l && <div className="rc">{(cab?.caminhao || cab?.motorista) && <small>{[cab.caminhao, cab.motorista].filter(Boolean).join(" · ")}</small>}<b>{conf} de {l.length} pedidos conferidos</b><div className="barra mt-3"><i style={{ width: `${l.length ? (conf / l.length) * 100 : 0}%` }} /></div></div>}
      {l === null && !erro && <Esqueleto classe="pd" altura={150} n={3} />}
      {l?.map((x) => <Cartao key={x.pedido} x={x} rom abrir={() => ficha(x.pedido)} />)}
      {r && r.fora.length > 0 && <div className="aviso-a">Fora da separação junta: {r.fora.map((x: Row) => `${x.pedido} (${x.motivo})`).join(", ")}</div>}
    </Tela>
  );
}

function Ficha({ n, voltar, comecar, oc }: { n: number; voltar: () => void; comecar: (x: Row) => void; oc: boolean }) {
  const [d, setD] = useState<Row | null>(null), [erro, setErro] = useState("");
  useEffect(() => { api(`conferencia/pedido/${n}`).then(setD).catch((e) => setErro((e as Error).message)); }, [n]);
  const meu = d && d.id, outro = d && ((d.conferencia && !d.id) || d.noRomaneio), fora = d && !["PED", "FAT"].includes(d.situacao);
  // sem PCP na empresa, a etapa "Liberado no PCP" nunca acontece: sai da linha do tempo (a não ser que o Lieto tenha a data)
  const comPcp = !!d && (d.usaPcp || !!d.pcp.pcp);
  const etapas: [string, string, boolean][] = d ? [["Pedido", d.criado ? dm(String(d.criado).slice(0, 10)) : "", true], ...(comPcp ? [["Liberado no PCP", dm(d.pcp.pcp), !!d.pcp.pcp] as [string, string, boolean]] : []), ["Separação", dm(d.pcp.sep), !!d.pcp.sep], ["Conferência", dm(d.pcp.con), !!d.pcp.con], ["Faturado", dm(d.pcp.fat), !!d.pcp.fat], ["Expedido", dm(d.pcp.exp), !!d.pcp.exp]] : [];
  const prox = etapas.findIndex((e) => !e[2]);
  return (
    <Tela titulo={`Pedido ${n}`} sub={d ? [d.romaneio > 0 && `Romaneio ${d.romaneio}`, d.ordem > 0 && `${d.ordem}º na carga`].filter(Boolean).join(" · ") : ""} voltar={voltar}
      rodape={d && <BotaoG disabled={oc || !!outro || !!fora || d.aguardaPcp} onClick={() => comecar(d)}>{oc ? "Abrindo…" : meu ? (d.usuario === sessao.usuario()?.nome ? "Continuar a separar" : `Continuar · ${d.usuario}`) : outro ? `Com ${d.usuario}` : fora ? `Situação ${d.situacao}` : d.conferencia ? "Já conferido" : d.aguardaPcp ? "Aguardando liberação no PCP" : "Começar a separar"}</BotaoG>}>
      {erro && <div className="aviso-e">{erro}</div>}
      {!d && !erro && <div className="pd animate-pulse" style={{ height: 200 }} />}
      {d && <>
        <div className="cx"><h3>Cliente</h3><div className="text-[18px] font-semibold">{d.cliente}</div>
          <div className="kv">{d.cidade && <><span>Cidade</span><b>{d.cidade}</b></>}{d.entrega && <><span>Entrega</span><b><Entrega d={d.entrega} /></b></>}{d.vendedor && <><span>Vendedor</span><b>{d.vendedor}</b></>}{d.rota && <><span>Rota</span><b>{d.rota}</b></>}
            <span>Tamanho</span><b>{[`${d.itens} itens`, d.volumes > 0 && `${d.volumes} vol.`, d.peso > 0 && `${fq(Math.round(d.peso))} kg`].filter(Boolean).join(" · ")}</b></div></div>
        <div className="cx"><h3>{comPcp ? "PCP do Lieto" : "Andamento no Lieto"}</h3><div className="tm">{etapas.map(([nome, data, f], k) => <div key={nome} className={cx(f && "f1", k === prox && "ag")}><i />{nome}<small>{data || "—"}</small></div>)}</div></div>
        {d.obs && <div className="cx"><h3>Observação do pedido</h3><div className="whitespace-pre-wrap">{d.obs}</div></div>}
        <div className="cx"><h3>Itens · em ordem de local</h3>{!d.lista.length && <div>Sem itens.</div>}
          {(d.lista as Row[]).map((i) => <div key={i.codpro} className="it"><span>{i.local || "—"}</span><span>{i.nompro}</span><b>{fq(i.qtd)} {i.unipro}</b></div>)}</div>
      </>}
    </Tela>
  );
}

// Volumes no fim da separação: um pedido por vez (romaneio somado pergunta pedido a pedido).
function Volumes({ pedidos, voltar, concluir, oc }: { pedidos: number[]; voltar: () => void; concluir: (v: Record<string, number>) => void; oc: boolean }) {
  const [k, setK] = useState(0), [num, setNum] = useState(""), [vs, setVs] = useState<Record<string, number>>({}), p = pedidos[k], ultimo = k === pedidos.length - 1;
  function ok() { const n = Number(num); if (!(n >= 1)) return; const novo = { ...vs, [p]: n }; setVs(novo); setNum(""); if (ultimo) concluir(novo); else setK(k + 1); }
  return (
    <Tela titulo={pedidos.length > 1 ? `Volumes · ${k + 1} de ${pedidos.length}` : "Volumes"} sub={`Pedido ${p}`} voltar={() => (k ? (setK(k - 1), setNum(String(vs[pedidos[k - 1]] || ""))) : voltar())}
      rodape={<BotaoG tom="ok" disabled={!(Number(num) >= 1) || oc} onClick={ok}>{oc ? "Gravando…" : ultimo ? `Concluir com ${num || 0} volume(s)` : "Próximo pedido"}</BotaoG>}>
      <div className="secao">Quantos volumes tem o pedido {p}?</div>
      <div className="visor tabular">{num || "0"}<small>vol.</small></div>
      <div className="teclas">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map((t) => <button key={t} aria-label={t === "⌫" ? "Apagar" : t === "C" ? "Limpar" : t} onMouseDown={(e) => e.preventDefault()} onClick={() => setNum((x) => (t === "⌫" ? x.slice(0, -1) : t === "C" ? "" : (x + t).replace(/^0+/, "").slice(0, 4)))}>{t === "⌫" ? <Delete /> : t}</button>)}</div>
    </Tela>
  );
}

// Conferência de volumes do romaneio: os pedidos separados antes dele. Contou diferente: pergunta se corrige o QNTVOL no Lieto.
function VolumesRomaneio({ n, voltar }: { n: number; voltar: () => void }) {
  const [d, setD] = useState<Row | null>(null), [sel, setSel] = useState<Row | null>(null), [num, setNum] = useState(""), [dif, setDif] = useState<Row | null>(null), [oc, setOc] = useState(false), [erro, setErro] = useState(""), toast = useToast();
  useEffect(() => { api(`conferencia/romaneio/${n}/volumes`).then(setD).catch((e) => setErro((e as Error).message)); }, [n]);
  async function enviar(corrigir = false) {
    setOc(true);
    try { const r = await api(`conferencia/romaneio/${n}/volumes`, { pedido: sel!.pedido, contado: Number(num), corrigir }); if (r.diferente) { setDif(r); bip(false); } else { setD(r); setSel(null); setDif(null); setNum(""); bip(true); } }
    catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); }
  }
  if (sel) return (
    <Tela titulo={`Pedido ${sel.pedido}`} sub={sel.cliente} voltar={() => { setSel(null); setDif(null); setNum(""); }}
      rodape={dif ? <><BotaoG disabled={oc} onClick={() => enviar(true)}>Corrigir para {dif.contado} volume(s)</BotaoG><button className="bt2 mt-2 w-full" onClick={() => { setDif(null); setNum(""); }}>Contar de novo</button></>
        : <BotaoG disabled={num === "" || oc} onClick={() => enviar()}>Conferir</BotaoG>}>
      {dif ? <div className="aviso-e"><b>Contou {dif.contado}, o pedido tem {dif.esperado}.</b> Procure o volume. Se a contagem estiver certa, corrija: o Lieto passa a ter {dif.contado} volume(s) neste pedido.</div> : <>
        <div className="secao">Quantos volumes deste pedido estão na doca?</div>
        <div className="visor tabular">{num || "0"}<small>vol.</small></div>
        <div className="teclas">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map((t) => <button key={t} aria-label={t === "⌫" ? "Apagar" : t === "C" ? "Limpar" : t} onMouseDown={(e) => e.preventDefault()} onClick={() => setNum((x) => (t === "⌫" ? x.slice(0, -1) : t === "C" ? "" : (x + t).replace(/^0+(?=\d)/, "").slice(0, 4)))}>{t === "⌫" ? <Delete /> : t}</button>)}</div></>}
    </Tela>
  );
  const ps = (d?.pedidos || []) as Row[], feitos = ps.filter((x) => x.conferido).length;
  return (
    <Tela titulo={`Volumes · Romaneio ${n}`} sub="Pedidos separados antes do romaneio" voltar={voltar}>
      {erro && <div className="aviso-e">{erro}</div>}
      {d && <div className="rc"><small>Conte os volumes de cada pedido na doca</small><b>{feitos} de {ps.length} conferidos</b><div className="barra mt-3"><i style={{ width: `${ps.length ? (feitos / ps.length) * 100 : 0}%` }} /></div></div>}
      {d && !ps.length && <div className="vazio"><Check /><b>Nada para conferir</b>Nenhum pedido deste romaneio foi separado antes.</div>}
      {ps.map((x) => { const c = x.conferido; return (
        <button key={x.pedido} className={cx("vl", c && (c.corrigido ? "er" : "ok"))} onClick={() => { setSel(x); setNum(""); setDif(null); }}>
          <div><b>{x.pedido} · {x.cliente}</b><small>{c ? `${c.corrigido ? `Corrigido de ${c.esperado} · ` : ""}${c.usuario} ${fdataHora(c.em)}` : `Separado${x.por ? ` por ${x.por}` : ""} · esperado ${x.esperado}`}</small></div>
          <span className="q">{c ? c.contado : "—"} / {c ? c.esperado : x.esperado}</span></button>); })}
    </Tela>
  );
}
const fdataHora = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`;

// Leitura guardada no aparelho até o servidor confirmar. O uid impede contar duas vezes se a rede cair no meio.
type Leitura = { uid: string; codpro: string; qtd: number; modo: "soma" | "fixa" };
const naCegaZero = (c: Row) => c.status === "RECONTANDO";

function Contagem({ inicial, sair }: { inicial: Row; sair: () => void }) {
  const [c, setC] = useState(inicial), [fila, setFila] = useState<Leitura[]>([]), [off, setOff] = useState(false);
  const [sel, setSel] = useState(""), [tela, setTela] = useState<"contar" | "lista" | "teclado" | "volumes">("contar"), [num, setNum] = useState(""), [msg, setMsg] = useState<{ t: string; k: "" | "ok" | "er" }>({ t: "", k: "" });
  const [oc, setOc] = useState(false), [obs, setObs] = useState<string>(inicial.obs || ""), [busca, setBusca] = useState("");
  const { confirmar, dialogo } = useConfirm(), toast = useToast(), leitor = useRef<HTMLInputElement>(null), filaRef = useRef<Leitura[]>([]), enviando = useRef(false), vivo = useRef(true), avancar = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sep = c.modo === "SEPARACAO", rec = naCegaZero(c), fim = !["CONTANDO", "RECONTANDO"].includes(c.status) || c.aguarda, guarda = `conf.${c.id}`;
  const gravarFila = useCallback((f: Leitura[]) => { filaRef.current = f; setFila(f); ls.set(guarda, f); }, [guarda]);

  // o que a pessoa vê = servidor + leituras ainda não confirmadas
  const itens: Row[] = useMemo(() => c.itens.map((i: Row) => { let n = i.contado, f = i.falta; for (const l of fila) if (l.codpro === i.codpro) { n = l.modo === "fixa" ? l.qtd : r4(n + l.qtd); f = false; } return { ...i, contado: n, falta: f }; }), [c, fila]);
  const pronto = (i: Row) => sep && (i.falta || i.contado >= i.qtd), at: Row | undefined = itens.find((i) => i.codpro === sel) || (sep ? itens.find((i) => !pronto(i)) || itens[0] : undefined);
  const restam = itens.filter((i) => !pronto(i)).length, comFalta = itens.some((i) => i.falta), lidos = itens.filter((i) => i.contado > 0).length;
  const feito = sep ? r4(itens.reduce((s, i) => s + i.contado, 0)) : lidos, tot = sep ? r4(itens.reduce((s, i) => s + i.qtd, 0)) : itens.length;

  const enviar = useCallback(async () => {
    if (enviando.current) return;
    enviando.current = true;
    try {
      while (vivo.current && filaRef.current.length) {
        const l = filaRef.current[0];
        try { const r = await api(`conferencia/${inicial.id}/contar`, { uid: l.uid, codigo: l.codpro, qtd: l.qtd, modo: l.modo }); setOff(false); setC(r); gravarFila(filaRef.current.slice(1)); }
        catch (e) {
          // só descarta o que o servidor recusou; sem rede, servidor fora ou sessão vencida fica guardado
          if (e instanceof ApiErro && e.status >= 400 && e.status < 500 && ![401, 403, 408, 429].includes(e.status)) { gravarFila(filaRef.current.slice(1)); bip(false); setMsg({ t: e.message, k: "er" }); api(`conferencia/${inicial.id}`).then((r) => vivo.current && setC(r)).catch(() => {}); }
          else { setOff(true); break; }
        }
      }
    } finally { enviando.current = false; }
  }, [inicial.id, gravarFila]);
  useEffect(() => {
    vivo.current = true;
    const f = ls.get<Leitura[]>(`conf.${inicial.id}`, []); filaRef.current = f; setFila(f); enviar();
    const t = setInterval(enviar, 3000); return () => { vivo.current = false; clearInterval(t); clearTimeout(avancar.current); };
  }, [inicial.id, enviar]);
  // o leitor escreve num campo invisível, sempre com foco e sem abrir o teclado
  useEffect(() => { if (tela !== "contar" || fim) return; const f = () => { if (!document.querySelector("[data-modal]")) leitor.current?.focus({ preventScroll: true }); }; f(); const t = setInterval(f, 400); return () => clearInterval(t); }, [tela, fim]);

  // conta olhando filaRef (não o estado): duas leituras seguidas não se atropelam
  const agora = (cod: string) => { let n = 0; const i = c.itens.find((x: Row) => x.codpro === cod); n = i.contado; for (const l of filaRef.current) if (l.codpro === cod) n = l.modo === "fixa" ? l.qtd : r4(n + l.qtd); return n; };
  function contar(i: Row, q: number, modo: "soma" | "fixa", txt: string) {
    const n = modo === "fixa" ? q : r4(agora(i.codpro) + q);
    clearTimeout(avancar.current); setSel(i.codpro);
    if (sep && n > i.qtd) { bip(false); setMsg({ t: modo === "fixa" ? `Passa do pedido: são ${fq(i.qtd)}` : agora(i.codpro) >= i.qtd ? "Este item já está completo" : `Passa do pedido: faltam ${fq(r4(i.qtd - agora(i.codpro)))}`, k: "er" }); return; }
    bip(true); gravarFila([...filaRef.current, { uid: novoUid(), codpro: i.codpro, qtd: q, modo }]);
    if (sep && n >= i.qtd) { setMsg({ t: "Completo", k: "ok" }); avancar.current = setTimeout(() => { setSel(""); setMsg({ t: "", k: "" }); }, 900); } else setMsg({ t: txt, k: "ok" });
    enviar();
  }
  function digitar(i: Row) { clearTimeout(avancar.current); setSel(i.codpro); setMsg({ t: "", k: "" }); setNum(""); setTela("teclado"); }
  function ler(cod: string) {
    if (!cod.trim()) return;
    const i = itens.find((x) => x.codigos.some((y: string) => chave(y) === chave(cod)));
    if (!i) { bip(false); clearTimeout(avancar.current); setMsg({ t: rec ? "Não precisa reconferir este" : c.pedidos ? "Não é deste romaneio" : "Não é deste pedido", k: "er" }); return; }
    if (sep) { bip(true); digitar(i); return; }
    const f = fatorLido(i, cod); contar(i, f, "soma", `+${fq(f)}`);
  }
  function pula() { const k = itens.findIndex((i) => i.codpro === at?.codpro); for (let n = 1; n <= itens.length; n++) { const x = itens[(k + n) % itens.length]; if (!pronto(x)) { setSel(x.codpro); break; } } setMsg({ t: "", k: "" }); }
  async function naoTem() {
    if (!at || oc) return;
    setOc(true);
    try { await drena(); setC(await api(`conferencia/${c.id}/falta`, { codpro: at.codpro })); setSel(""); setMsg({ t: "", k: "" }); } catch (e) { setMsg({ t: (e as Error).message, k: "er" }); } finally { setOc(false); }
  }
  async function drena() { for (let n = 0; n < 40 && filaRef.current.length; n++) { await enviar(); if (filaRef.current.length) await new Promise((r) => setTimeout(r, 150)); } if (filaRef.current.length) throw new Error("Há leituras não enviadas. Confira a rede e tente de novo."); }
  async function fechar(vols?: Record<string, number>) {
    const zero = itens.length - lidos;
    if (!vols && !(await confirmar(sep ? { titulo: comFalta ? "Concluir com falta?" : "Concluir?", texto: comFalta ? "O pedido vai esperar a gestão." : "Grava a conferência no Lieto." } : { titulo: rec ? "Fechar a reconferência?" : "Fechar a contagem?", texto: zero ? `${zero} item(ns) ainda sem quantidade.` : "O que divergir volta para reconferência." }))) return;
    setOc(true);
    try { await drena(); const r = await api(`conferencia/${c.id}/fechar`, { obs, volumes: vols }); setC(r); setSel(""); setMsg({ t: "", k: "" }); setTela("contar"); if (!sep && r.divergentes) toast(`${r.divergentes} item(ns) para reconferir.`, "erro"); else bip(true); }
    catch (e) { if (e instanceof ApiErro && e.status === 428) { setTela("volumes"); return; } bip(false); setMsg({ t: (e as Error).message, k: "er" }); toast((e as Error).message, "erro"); } finally { setOc(false); }
  }
  async function voltar() { setOc(true); try { setC(await api(`conferencia/${c.id}/voltar`, {})); } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); } }
  const titulo = c.pedidos ? `Romaneio ${c.romaneio}` : `Pedido ${c.pedido}`;

  if (fim) return (
    <Tela titulo={titulo} sub={c.cliente} voltar={sair} rodape={<BotaoG onClick={sair}>Próximo pedido</BotaoG>}>
      <div className="vazio">{c.aguarda ? <CloudOff className="!text-amber-600" /> : <Check />}<b>{c.aguarda ? "Esperando a gestão" : c.status === "CONFERIDA" ? "Conferido" : c.status}</b>
        {c.aguarda ? "Faltou produto. A gestão decide." : c.status === "CONFERIDA" ? (c.pedidos ? `${c.pedidos.length} pedido(s) gravados no Lieto.` : `Conferência nº ${c.numide} no Lieto.`) : ""}</div>
      {c.aguarda && <button className="bt2" disabled={oc} onClick={voltar}>Achei o produto: voltar a separar</button>}
    </Tela>
  );
  if (tela === "volumes") return <Volumes pedidos={c.pedidos || [c.pedido]} voltar={() => setTela("contar")} concluir={(v) => fechar(v)} oc={oc} />;
  if (tela === "teclado" && at) return (
    <Tela titulo="Quantidade" sub={at.nompro} voltar={() => setTela("contar")} rodape={<BotaoG disabled={num === "" || isNaN(Number(num.replace(",", ".")))} onClick={() => { const n = r4(Number(num.replace(",", "."))); setTela("contar"); contar(at, n, "fixa", sep ? `Salvo: ${fq(n)} de ${fq(at.qtd)}` : "Quantidade digitada"); }}>{sep ? "Salvar" : "Confirmar"}</BotaoG>}>
      <div className="visor tabular">{num || "0"}<small>{sep ? `/ ${fq(at.qtd)} ` : ""}{at.unipro}</small></div>
      <div className="teclas">{["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"].map((k) => <button key={k} aria-label={k === "⌫" ? "Apagar" : k} onMouseDown={(e) => e.preventDefault()} onClick={() => setNum((v) => (k === "⌫" ? v.slice(0, -1) : k === "," && (!v || v.includes(",")) ? v : (v + k).slice(0, 10)))}>{k === "⌫" ? <Delete /> : k}</button>)}</div>
    </Tela>
  );
  if (tela === "lista") { const q = busca.trim().toUpperCase().split(/\s+/); return (
    <Tela titulo="Itens" sub={sep ? `${itens.length - restam} de ${itens.length} prontos` : `${lidos} lidos`} voltar={() => setTela("contar")}>
      <div className="campo-ic"><ScanBarcode /><input placeholder="Procurar pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
      {[...itens].sort((a, b) => Number(pronto(a)) - Number(pronto(b))).filter((i) => q.every((w) => `${i.nompro} ${i.codpro}`.toUpperCase().includes(w))).map((i) => (
        <button key={i.codpro} className="linha" onClick={() => { clearTimeout(avancar.current); setSel(i.codpro); setMsg({ t: "", k: "" }); setTela("contar"); }}><div><b className="!text-[16px]">{i.nompro}</b><small>{sep ? `${i.local || "sem local"}${i.falta ? " · não tem" : ""}` : i.codpro}</small></div><span className={cx("pilula tabular", pronto(i) && !i.falta && "verde", i.falta && "rosa")}>{fq(i.contado)}{sep ? ` / ${fq(i.qtd)}` : ""}</span></button>))}
      <Observacao valor={obs} mudar={setObs} />
    </Tela>
  ); }
  return (
    <div className="tela">
      <Cabecalho titulo={titulo} sub={sep ? `${fq(feito)} de ${fq(tot)} · ${c.cliente}` : rec ? `Reconferir ${itens.length} item(ns)` : `${lidos} itens lidos`} esq={<button className="ic" aria-label="Voltar" onClick={sair}><ChevronLeft /></button>}
        dir={<button className="ic" aria-label="Lista de itens" onClick={() => { setBusca(""); setTela("lista"); }}><List /></button>} />
      {(!sep || c.bipar) && <form className="leitor" onSubmit={(e) => { e.preventDefault(); const v = leitor.current!.value; leitor.current!.value = ""; ler(v); }}><input ref={leitor} inputMode="none" autoComplete="off" aria-label="Leitor" /></form>}
      <div className="corpo">
        <div className="barra"><i style={{ width: `${tot ? Math.min(100, (feito / tot) * 100) : 0}%` }} /></div>
        {/* alturas fixas: o aviso troca de cor no mesmo lugar, nada empurra os botões */}
        <div className={cx("foco", msg.k)}>
          <div className="onde">{sep ? at?.local ? <><small>Vá até</small><b>{at.local}</b></> : <small>Sem local cadastrado</small> : <small>{at ? "Último lido" : "Nada lido ainda"}</small>}</div>
          <div className="nome">{at?.nompro || "Leia o primeiro produto"}</div>
          <div className="qtd tabular">{at ? fq(at.contado) : "—"}{sep && at && <i>/ {fq(at.qtd)}</i>}{at && <i>{at.unipro}</i>}</div>
          <div className="diz">{off ? `Sem rede: ${fila.length} guardada(s)` : msg.t || (!sep ? "Leia o código" : at && pronto(at) ? "Completo" : c.bipar ? "Bipe o produto" : "Confirme o produto")}</div>
        </div>
        {!sep && <div className="mais"><button className="bt2" aria-label="Menos um" disabled={!at || !at.contado} onClick={() => contar(at!, Math.max(0, r4(agora(at!.codpro) - 1)), "fixa", "Corrigido")}>−</button><button className="bt2" disabled={!at} onClick={() => { setNum(""); setTela("teclado"); }}>Digitar</button><button className="bt2" aria-label="Mais um" disabled={!at} onClick={() => contar(at!, 1, "soma", "+1")}>+</button></div>}
        {sep && <button className="bt2" disabled={!at} onClick={() => digitar(at!)}>{at && pronto(at) ? "Corrigir quantidade" : c.bipar ? "Confirmar sem bipar" : "Confirmar produto"}</button>}
        <div className="dois"><button className="bt2" disabled={!sep || !restam} onClick={pula}>Próximo item</button><button className="bt2" disabled={!sep || !at || pronto(at) || oc} onClick={naoTem}>Não tem</button></div>
      </div>
      <div className="rodape"><BotaoG tom={sep && !restam && !comFalta ? "ok" : undefined} disabled={oc || (sep && restam > 0)} onClick={() => fechar()}>{oc ? "Aguarde…" : !sep ? (rec ? "Fechar reconferência" : "Fechar contagem") : restam ? `Faltam ${restam} ${restam > 1 ? "itens" : "item"}` : comFalta ? "Concluir com falta" : "Concluir"}</BotaoG></div>
      {dialogo}
    </div>
  );
}
