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
import { BotaoG, Cabecalho, Tela } from "@/components/coletor";
import { ApiErro, api, chave, fatorLido, fq, ls, r4, type Row } from "@/lib/client";

export default function Pagina() { return <Suspense><Fila /></Suspense>; }

function Fila() {
  const pedir = Number(useSearchParams().get("id") || 0), toast = useToast();
  const [c, setC] = useState<Row | null>(null), [fila, setFila] = useState<Row[] | null>(null), [b, setB] = useState(""), [rm, setRm] = useState<Row | null>(null), [oc, setOc] = useState(false), [erro, setErro] = useState("");
  const ler = useCallback(async (n = "") => {
    setErro("");
    try {
      if (!n) { setRm(null); setFila(await api<Row[]>("conferencia/fila")); return; }
      // o número pode ser de pedido ou de romaneio: mostra o que existir
      const [p, r] = await Promise.all([api<Row[]>(`conferencia/fila?pedido=${n}`), api<Row[]>(`conferencia/fila?romaneio=${n}`)]);
      setRm(r.length ? await api(`conferencia/romaneio/${n}`) : null);
      setFila([...p, ...r.filter((x) => !p.some((y) => y.pedido === x.pedido))]);
    } catch (e) { setErro((e as Error).message); setFila((f) => f ?? []); }
  }, []);
  useEffect(() => { if (pedir) api(`conferencia/${pedir}`).then(setC).catch((e) => { setErro((e as Error).message); ler(); }); else ler(); }, [pedir, ler]);
  async function abrir(f: () => Promise<Row>) { if (oc) return; setOc(true); try { setC(await f()); } catch (e) { toast((e as Error).message, "erro"); ler(b); } finally { setOc(false); } }
  if (c) return <Contagem inicial={c} sair={() => { setC(null); setB(""); ler(); if (pedir) history.replaceState(null, "", "/coletor/conferencia"); }} />;
  return (
    <Tela titulo="Pedidos" sub={fila ? `${fila.length} na lista` : "Carregando…"}>
      <form className="campo-ic" onSubmit={(e) => { e.preventDefault(); ler(b); }}><ScanBarcode /><input inputMode="numeric" enterKeyHint="search" placeholder="Pedido ou romaneio" value={b} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setB(v); if (!v) ler(); }} /></form>
      {erro && <div className="aviso-e">{erro}<button className="bt2 mt-3 w-full !bg-white" onClick={() => ler(b)}>Tentar de novo</button></div>}
      {rm && <button className="linha" disabled={oc || (!rm.aberta && !rm.entram.length)} onClick={() => abrir(async () => api("conferencia/romaneio", { romaneio: rm.romaneio }))}>
        <div><b>Romaneio {rm.romaneio}</b><small>{rm.aberta ? `Continuar · ${rm.aberta.usuario}` : `${rm.entram.length} pedido(s) juntos`}</small></div><span className="pilula">Inteiro</span></button>}
      {rm && rm.fora.length > 0 && <div className="aviso-a"><b>{rm.fora.length} pedido(s) ficam de fora:</b> {rm.fora.map((x: Row) => `${x.pedido} (${x.motivo})`).join(", ")}</div>}
      {fila === null && <div className="linha animate-pulse" />}
      {fila?.length === 0 && !erro && <div className="vazio"><Check /><b>Nenhum pedido</b>{b ? "Confira o número." : "Nada esperando."}</div>}
      {fila?.map((x) => { const fora = !["PED", "FAT"].includes(x.situacao), viva = ["EM ANDAMENTO", "AGUARDA GESTÃO"].includes(x.conferencia), feito = !!x.conferencia && !viva;
        return <button key={x.pedido} className="linha" disabled={oc || feito || fora || x.noRomaneio} onClick={() => abrir(async () => (x.id ? api(`conferencia/${x.id}`) : api("conferencia", { pedido: x.pedido })))}>
          <div><b>{x.pedido}</b><small>{x.cliente}</small>{(x.conferencia || fora || x.romaneio > 0) && <small>{x.conferencia ? `${x.conferencia.toLowerCase()}${x.usuario ? ` · ${x.usuario}` : ""}` : fora ? `situação ${x.situacao}` : `romaneio ${x.romaneio}`}</small>}</div><span className="pilula">{x.itens} {x.itens === 1 ? "item" : "itens"}</span></button>; })}
    </Tela>
  );
}

// Leitura guardada no aparelho até o servidor confirmar. O uid impede contar duas vezes se a rede cair no meio.
type Leitura = { uid: string; codpro: string; qtd: number; modo: "soma" | "fixa" };
const naCegaZero = (c: Row) => c.status === "RECONTANDO";

function Contagem({ inicial, sair }: { inicial: Row; sair: () => void }) {
  const [c, setC] = useState(inicial), [fila, setFila] = useState<Leitura[]>([]), [off, setOff] = useState(false);
  const [sel, setSel] = useState(""), [tela, setTela] = useState<"contar" | "lista" | "teclado">("contar"), [num, setNum] = useState(""), [msg, setMsg] = useState<{ t: string; k: "" | "ok" | "er" }>({ t: "", k: "" });
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
  async function fechar() {
    const zero = itens.length - lidos;
    if (!(await confirmar(sep ? { titulo: comFalta ? "Concluir com falta?" : "Concluir?", texto: comFalta ? "O pedido vai esperar a gestão." : "Grava a conferência no Lieto." } : { titulo: rec ? "Fechar a reconferência?" : "Fechar a contagem?", texto: zero ? `${zero} item(ns) ainda sem quantidade.` : "O que divergir volta para reconferência." }))) return;
    setOc(true);
    try { await drena(); const r = await api(`conferencia/${c.id}/fechar`, { obs }); setC(r); setSel(""); setMsg({ t: "", k: "" }); setTela("contar"); if (!sep && r.divergentes) toast(`${r.divergentes} item(ns) para reconferir.`, "erro"); else bip(true); }
    catch (e) { bip(false); setMsg({ t: (e as Error).message, k: "er" }); toast((e as Error).message, "erro"); } finally { setOc(false); }
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
      <div className="rodape"><BotaoG tom={sep && !restam && !comFalta ? "ok" : undefined} disabled={oc || (sep && restam > 0)} onClick={fechar}>{oc ? "Aguarde…" : !sep ? (rec ? "Fechar reconferência" : "Fechar contagem") : restam ? `Faltam ${restam} ${restam > 1 ? "itens" : "item"}` : comFalta ? "Concluir com falta" : "Concluir"}</BotaoG></div>
      {dialogo}
    </div>
  );
}
