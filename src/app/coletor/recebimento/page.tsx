"use client";
// Coletor › Recebimento de compra (desenho: design/pages/recebimento_v2.html).
//   Cega (sem "Recebimento: ver quantidade do pedido"): bipou, contou. O número grande é quanto VOCÊ contou, nunca quanto o pedido
//   tem, e a barra é de produtos lidos. O que divergir é recontado do zero, sem ver a 1ª contagem.
//   Com quantidade: vê quanto o pedido tem e quanto falta; leu a mais, avisa e conta (o fornecedor pode mandar a mais). Sem recontagem.
// Validade na 1ª leitura de cada produto: só números, a tela põe as barras; vale para as próximas leituras dele (a tarja preta).
// Fora do pedido pergunta e conta marcado; código sem cadastro anota e segue. Nada disto vai para o Lieto: a nota é ligada no painel.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, ChevronLeft, CircleCheck, Delete, Menu, PackageOpen, ScanBarcode, X } from "lucide-react";
import { cx, useConfirm, useToast } from "@/components/ui";
import { bip, novoUid } from "@/components/movimentos";
import { BotaoG, Cabecalho, Esqueleto, Tela } from "@/components/coletor";
import { ApiErro, api, chave, fatorLido, fq, ls, r4, type Row } from "@/lib/client";
import { mascaraValidade, validadeIso, validadeTexto, validadeVencida } from "@/lib/paletes";

export default function Pagina() { return <Suspense><Inicio /></Suspense>; }

const dm = (s?: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : "");
const hm = (s?: string) => (s ? s.slice(11, 16) : "");
const hojeIso = () => new Date().toLocaleDateString("sv-SE");
const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const somaVals = (v: Record<string, number>) => r4(Object.values(v).reduce((s, x) => s + x, 0));
const chaveDanfe = (s: string) => s.replace(/\D/g, "");
// "2027-03|L23" -> "Val. 03/2027 · L23"
const nomeVal = (k: string) => { const [v, l] = k.split("|"); return [v ? `Val. ${validadeTexto(v)}` : "Sem validade", l && `Lote ${l}`].filter(Boolean).join(" · "); };

function quando(x: Row): [string, boolean] {
  if (x.aberto) return [x.aberto.meu ? "com você" : `com ${x.aberto.usuario}`, false];
  if (x.restante) return ["restante a chegar", false];
  if (!x.previsto) return [x.emissao ? `pedido de ${dm(x.emissao)}` : "", false];
  const h = hojeIso(), n = dias(x.previsto, h);
  return x.previsto < h ? [`atrasado ${n} ${n === 1 ? "dia" : "dias"}`, true] : x.previsto === h ? ["hoje", false] : [dm(x.previsto), false];
}

function Inicio() {
  const pedir = Number(useSearchParams().get("id") || 0), toast = useToast();
  const [c, setC] = useState<Row | null>(null), [ficha, setFicha] = useState<number | null>(null), [b, setB] = useState(""), [danfe, setDanfe] = useState("");
  const [l, setL] = useState<Row[] | null>(null), [erro, setErro] = useState(""), [oc, setOc] = useState(false);
  const ler = useCallback(async () => {
    setErro("");
    try { setL(await api<Row[]>(`recebimento/fila${b.trim() ? `?q=${encodeURIComponent(b.trim())}` : ""}`)); } catch (e) { setErro((e as Error).message); setL((x) => x ?? []); }
  }, [b]);
  useEffect(() => { if (pedir) api(`recebimento/${pedir}`).then(setC).catch((e) => setErro((e as Error).message)); }, [pedir]);
  useEffect(() => { if (!c && ficha == null) { const t = setTimeout(ler, b ? 400 : 0); return () => clearTimeout(t); } }, [ler, c, ficha, b]);
  // bipou a DANFE na busca: acha o fornecedor e a chave segue para a abertura
  useEffect(() => { const d = chaveDanfe(b); if (d.length === 44 && d === b.trim()) setDanfe(d); }, [b]);
  async function comecar(x: Row, ch: string) {
    if (oc) return; setOc(true);
    try { setC(x.aberto ? await api(`recebimento/${x.aberto.id}`) : await api("recebimento", { pedido: x.pedido, chave: ch })); setFicha(null); }
    catch (e) { toast((e as Error).message, "erro"); bip(false); } finally { setOc(false); }
  }
  const sair = () => { setC(null); setFicha(null); setB(""); setDanfe(""); if (pedir) history.replaceState(null, "", "/coletor/recebimento"); };
  if (c) return <Contagem key={c.id} inicial={c} sair={sair} />;
  if (ficha != null) return <Ficha n={ficha} danfe={danfe} voltar={() => setFicha(null)} comecar={comecar} oc={oc} />;
  const busca = b.trim();
  return (
    <Tela titulo="Receber" sub={l ? (l.length ? `${l.length}${l.length >= 300 ? "+" : ""} ${l.length === 1 ? "pedido" : "pedidos"} de compra` : "Nenhum pedido esperando") : "Carregando…"}>
      {!(l?.length === 0 && !busca && !erro) && <div className="campo-ic"><ScanBarcode /><input enterKeyHint="search" placeholder="Pedido, fornecedor ou nota" value={b} onChange={(e) => setB(e.target.value)} />
        {b && <button className="-mr-2 grid size-14 shrink-0 place-items-center" aria-label="Limpar" onClick={() => { setB(""); setDanfe(""); }}><X /></button>}</div>}
      {danfe && <div className="aviso-a">Nota bipada. Escolha o pedido: a nota vai junto para o recebimento.</div>}
      {erro && <div className="aviso-e">{erro}<button className="bt2 mt-3 w-full !bg-white" onClick={ler}>Tentar de novo</button></div>}
      {l === null && !erro && <Esqueleto n={5} />}
      {l?.length === 0 && !erro && (busca ? <div className="vazio"><Check /><b>Nenhum pedido</b>{danfe ? "Nenhum pedido aberto deste fornecedor." : "Confira o número, o nome ou a nota."}</div>
        : <div className="vazio"><PackageOpen /><b>Nada para receber</b>Os pedidos de compra aparecem aqui quando estão liberados no Lieto e ainda não foram entregues.</div>)}
      {l?.map((x) => { const [q, atr] = quando(x); return (
        <button key={x.pedido} className="linha" onClick={() => setFicha(x.pedido)}>
          <div><b>Pedido {fq(x.pedido)}</b><small className={cx(atr && "am")}>{[x.fornecedor, x.recebido ? "já recebido" : q].filter(Boolean).join(" · ")}</small></div>
          <span className={cx("pilula", x.aberto?.meu && "eu")}>{x.aberto?.meu ? "Continuar" : `${x.itens} ${x.itens === 1 ? "item" : "itens"}`}</span></button>); })}
    </Tela>
  );
}

// Abrir: confirma o pedido e (recomendado) bipa a DANFE, que liga o recebimento à nota quando ela for lançada no Lieto
function Ficha({ n, danfe, voltar, comecar, oc }: { n: number; danfe: string; voltar: () => void; comecar: (x: Row, ch: string) => void; oc: boolean }) {
  const [d, setD] = useState<Row | null>(null), [erro, setErro] = useState(""), [ch, setCh] = useState(danfe), campo = useRef<HTMLInputElement>(null);
  useEffect(() => { api(`recebimento/pedido/${n}`).then(setD).catch((e) => setErro((e as Error).message)); }, [n]);
  const dg = chaveDanfe(ch), okCh = dg.length === 44, ruim = !!dg && !okCh, ab = d?.aberto;
  const prev = d?.previsto ? (d.previsto === hojeIso() ? `Hoje, ${dm(d.previsto)}` : d.previsto < hojeIso() ? `${dm(d.previsto)} · atrasado` : dm(d.previsto)) : "—";
  return (
    <Tela titulo={`Pedido ${fq(n)}`} sub={d?.fornecedor || ""} voltar={voltar}
      rodape={d && <BotaoG disabled={oc || (!ab && !!d.bloqueio) || ruim} onClick={() => comecar(d, ab ? "" : dg)}>{oc ? "Abrindo…" : ab ? (ab.meu ? "Continuar a conferir" : `Continuar · ${ab.usuario}`) : d.bloqueio ? "Não dá para receber" : ruim ? "Bipe a nota de novo" : "Começar a conferir"}</BotaoG>}>
      {erro && <div className="aviso-e">{erro}</div>}
      {!d && !erro && <span className="sk linha" style={{ height: 230 }} />}
      {d && <>
        <div className="cx"><div className="kv !mt-0">
          <span>Pedido do fornecedor</span><b className="text-right">{d.pedfor || "—"}</b>
          <span>Previsto</span><b className={cx("text-right", d.previsto && d.previsto < hojeIso() && "text-amber-800")}>{prev}</b>
          <span>Produtos</span><b className="text-right">{d.produtos}{d.restante ? " ainda não chegaram" : ""}</b>
          {d.obs && <><span>Observação do pedido</span><b className="whitespace-pre-wrap text-right">{d.obs}</b></>}</div></div>
        {d.bloqueio && <div className="aviso-e">{d.bloqueio}</div>}
        {ab && <div className="aviso-a">{ab.meu ? "Você começou este recebimento. Continue de onde parou." : `${ab.usuario} começou este recebimento. Se continuar, as leituras somam na mesma contagem.`}{ab.recontagem ? " O escritório pediu nova contagem." : ""}</div>}
        {d.restante && !ab && <div className="aviso-a">Parte deste pedido já chegou. Agora confere só o que faltou.</div>}
        {!ab && !d.bloqueio && <>
          <span className="rotulo !-mb-1">Nota fiscal (recomendado)</span>
          <label className={cx("campo-ic danfe", okCh && "ok")}><ScanBarcode />
            <input ref={campo} autoFocus inputMode="none" autoComplete="off" placeholder="Bipe o código de barras da DANFE" value={okCh ? `Nota ${Number(dg.slice(25, 34)).toLocaleString("pt-BR")} · série ${Number(dg.slice(22, 25))}` : ch}
              onChange={(e) => !okCh && setCh(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} readOnly={okCh} />
            {ch && <button type="button" className="-mr-2 grid size-14 shrink-0 place-items-center" aria-label="Tirar a nota" onClick={() => { setCh(""); campo.current?.focus(); }}><X /></button>}</label>
          {ruim ? <div className="aviso-e">Leitura incompleta: a chave da nota tem 44 números. Apague e bipe de novo.</div>
            : !okCh && <p className="px-1 text-[14.5px] text-muted">Bipar a nota liga este recebimento à entrada quando o escritório lançar no Lieto. Sem ela, o escritório escolhe a nota no painel.</p>}
        </>}
      </>}
    </Tela>
  );
}

// Leitura guardada no aparelho até o servidor confirmar. O uid impede contar duas vezes se a rede cair no meio.
type Leitura = { uid: string; codpro: string; codigo: string; qtd: number; modo: "soma" | "fixa"; validade: string; lote: string; semValidade?: boolean };
type Val = { validade: string; lote: string; sem?: boolean };
type Pergunta = { tipo: "fora"; codigo: string; produto: Row; f: number } | { tipo: "semcad"; codigo: string };
type Pend = { i: Row; depois: (v: Val) => void; trocar?: boolean };
const chaveVal = (v: Val) => `${v.validade}|${v.lote}`;

function Contagem({ inicial, sair }: { inicial: Row; sair: () => void }) {
  const [c, setC] = useState(inicial), [fila, setFila] = useState<Leitura[]>([]), [off, setOff] = useState(false);
  const [sel, setSel] = useState(""), [tela, setTela] = useState<"contar" | "lista" | "teclado" | "validade" | "menu" | "codigo" | "recontar">(inicial.status === "RECONTANDO" ? "recontar" : "contar");
  const [num, setNum] = useState(""), [msg, setMsg] = useState<{ t: string; k: "" | "ok" | "er" }>({ t: "", k: "" }), [perg, setPerg] = useState<Pergunta | null>(null), [pend, setPend] = useState<Pend | null>(null);
  const [vals, setVals] = useState<Record<string, Val>>(() => ls.get(`rec.val.${inicial.id}.${inicial.status}`, {})), [oc, setOc] = useState(false), [busca, setBusca] = useState("");
  const { confirmar, dialogo } = useConfirm(), toast = useToast(), leitor = useRef<HTMLInputElement>(null), filaRef = useRef<Leitura[]>([]), enviando = useRef(false), vivo = useRef(true);
  const cq = c.modo === "COMQTD", rec = c.status === "RECONTANDO", fim = !["CONTANDO", "RECONTANDO"].includes(c.status), guarda = `rec.${c.id}`;
  const gravarFila = useCallback((f: Leitura[]) => { filaRef.current = f; setFila(f); ls.set(guarda, f); }, [guarda]);
  // validade em uso por produto: vale para as próximas leituras dele. Recontagem começa do zero (outra chave).
  useEffect(() => { setVals(ls.get(`rec.val.${c.id}.${c.status}`, {})); }, [c.id, c.status]);
  const usarVal = (codpro: string, v: Val) => setVals((x) => { const n = { ...x, [codpro]: v }; ls.set(`rec.val.${c.id}.${c.status}`, n); return n; });

  // o que a pessoa vê = servidor + leituras ainda não confirmadas
  const itens: Row[] = useMemo(() => c.itens.map((i: Row) => {
    const v: Record<string, number> = { ...i.vals }; let f = i.falta;
    for (const l of fila) if (l.codpro === i.codpro) { const k = `${l.validade}|${l.lote}`; v[k] = l.modo === "fixa" ? l.qtd : r4((v[k] || 0) + l.qtd); if (!v[k]) delete v[k]; if (l.qtd > 0) f = false; }
    return { ...i, vals: v, contado: somaVals(v), falta: f };
  }), [c, fila]);
  const ped = itens.filter((i) => !i.fora && !i.semcad), lidos = ped.filter((i) => i.contado > 0).length;
  const at: Row | undefined = itens.find((i) => i.codpro === sel) || (rec ? itens.find((i) => !i.contado) || itens[0] : undefined), kRec = rec && at ? itens.indexOf(at) : -1;
  const valDe = (i: Row): Val | null => vals[i.codpro] || (i.semcad || i.semValidade ? { validade: "", lote: "" } : Object.keys(i.vals).length ? (([v, l]) => ({ validade: v, lote: l || "" }))(Object.keys(i.vals).at(-1)!.split("|")) : null);
  const tot = cq ? r4(ped.reduce((s, i) => s + i.qtd, 0)) : rec ? itens.length : ped.length, feito = cq ? r4(ped.reduce((s, i) => s + Math.min(i.contado, i.qtd), 0)) : rec ? itens.filter((i) => i.contado > 0).length : lidos;

  const enviar = useCallback(async () => {
    if (enviando.current) return;
    enviando.current = true;
    try {
      while (vivo.current && filaRef.current.length) {
        const l = filaRef.current[0];
        try { const r = await api(`recebimento/${inicial.id}/leituras`, { uid: l.uid, codigo: l.codigo, qtd: l.qtd, modo: l.modo, validade: l.validade, lote: l.lote, semValidade: l.semValidade }); setOff(false); setC(r); gravarFila(filaRef.current.slice(1)); }
        catch (e) {
          // só descarta o que o servidor recusou; sem rede, servidor fora ou sessão vencida fica guardado
          if (e instanceof ApiErro && e.status >= 400 && e.status < 500 && ![401, 403, 408, 429].includes(e.status)) { gravarFila(filaRef.current.slice(1)); bip(false); setMsg({ t: e.message, k: "er" }); api(`recebimento/${inicial.id}`).then((r) => vivo.current && setC(r)).catch(() => {}); }
          else { setOff(true); break; }
        }
      }
    } finally { enviando.current = false; }
  }, [inicial.id, gravarFila]);
  useEffect(() => {
    vivo.current = true;
    const f = ls.get<Leitura[]>(`rec.${inicial.id}`, []); filaRef.current = f; setFila(f); enviar();
    const t = setInterval(enviar, 3000); return () => { vivo.current = false; clearInterval(t); };
  }, [inicial.id, enviar]);
  // o leitor escreve num campo invisível, sempre com foco e sem abrir o teclado
  useEffect(() => { if (tela !== "contar" || fim) return; const f = () => { if (!document.querySelector("[data-modal]")) leitor.current?.focus({ preventScroll: true }); }; f(); const t = setInterval(f, 400); return () => clearInterval(t); }, [tela, fim]);

  // quanto há desta validade, olhando filaRef (não o estado): duas leituras seguidas não se atropelam
  const agoraK = (i: Row, k: string) => { const s = c.itens.find((x: Row) => x.codpro === i.codpro); let n = s?.vals?.[k] || 0; for (const l of filaRef.current) if (l.codpro === i.codpro && `${l.validade}|${l.lote}` === k) n = l.modo === "fixa" ? l.qtd : r4(n + l.qtd); return n; };
  function contar(i: Row, v: Val, q: number, modo: "soma" | "fixa", txt: string) {
    setSel(i.codpro); setPerg(null);
    bip(true); gravarFila([...filaRef.current, { uid: novoUid(), codpro: i.codpro, codigo: i.codigos[0], qtd: q, modo, validade: v.validade, lote: v.lote, ...(v.sem && !v.validade ? { semValidade: true } : {}) }]);
    setMsg({ t: txt, k: "ok" });
    enviar();
  }
  // 1ª leitura do produto (nesta contagem) pede a validade antes de contar
  function comValidade(i: Row, depois: (v: Val) => void) { const v = valDe(i); if (v) depois(v); else { setPend({ i, depois }); setTela("validade"); } }
  function ler(cod: string) {
    if (!cod.trim()) return;
    setPerg(null);
    const k = chave(cod), i = itens.find((x) => x.codigos.some((y: string) => chave(y) === k));
    if (i) { const f = fatorLido(i, cod); comValidade(i, (v) => contar(i, v, f, "soma", `+${fq(f)} ${f === 1 ? "lido" : "lidos"}`)); return; }
    if (rec) { bip(false); setMsg({ t: "Este produto não está na recontagem", k: "er" }); return; }
    setOc(true);
    api(`recebimento/${c.id}/codigo/${encodeURIComponent(cod.trim())}`).then((r) => {
      bip(false);
      if (r.codpro) { api(`recebimento/${c.id}`).then(setC).catch(() => {}); setMsg({ t: "Leia de novo", k: "er" }); }
      else if (r.produto) setPerg({ tipo: "fora", codigo: cod.trim(), produto: r.produto, f: fatorLido(r.produto, cod) });
      else setPerg({ tipo: "semcad", codigo: cod.trim() });
    }).catch(() => { bip(false); setMsg({ t: "Sem rede para conferir este código", k: "er" }); }).finally(() => setOc(false));
  }
  // fora do pedido e sem cadastro vão direto ao servidor (precisam dele para entrar na lista)
  async function extra(p: Pergunta, v: Val | null) {
    setOc(true);
    try {
      await drena();
      const q = p.tipo === "fora" ? p.f : 1;
      const r = await api(`recebimento/${c.id}/leituras`, { uid: novoUid(), codigo: p.codigo, qtd: q, modo: "soma", validade: v?.validade || "", lote: v?.lote || "", ...(p.tipo === "fora" ? { fora: true, semValidade: !!v?.sem && !v.validade } : { semcad: true }) });
      setC(r); bip(true); setPerg(null);
      const novo = (r.itens as Row[]).find((x) => x.codigos.some((y: string) => chave(y) === chave(p.codigo)));
      if (novo) { setSel(novo.codpro); if (v) usarVal(novo.codpro, v); }
      setMsg({ t: p.tipo === "fora" ? "Contado fora do pedido" : "Anotado: separe e avise o escritório", k: "ok" });
    } catch (e) { bip(false); setMsg({ t: (e as Error).message, k: "er" }); } finally { setOc(false); }
  }
  async function naoVeio() {
    if (!at || oc) return;
    setOc(true);
    try { await drena(); setC(await api(`recebimento/${c.id}/falta`, { codpro: at.codpro })); const prox = ped.find((i) => i.codpro !== at.codpro && !i.falta && i.contado < i.qtd); setSel(prox?.codpro || ""); setMsg({ t: prox ? "Falta marcada. Próximo produto" : "Falta marcada", k: "ok" }); }
    catch (e) { setMsg({ t: (e as Error).message, k: "er" }); } finally { setOc(false); }
  }
  async function drena() { for (let n = 0; n < 40 && filaRef.current.length; n++) { await enviar(); if (filaRef.current.length) await new Promise((r) => setTimeout(r, 150)); } if (filaRef.current.length) throw new Error("Há leituras não enviadas. Confira a rede e tente de novo."); }
  async function fechar() {
    const zero = ped.filter((i) => !i.contado).length, faltas = ped.filter((i) => i.contado < i.qtd).length;
    const t = rec ? { titulo: "Fechar a recontagem?", texto: itens.some((i) => !i.contado) ? "Há produto sem leitura. O que continuar diferente vai para o escritório." : "O que continuar diferente vai para o escritório." }
      : cq ? { titulo: "Fechar a contagem?", texto: faltas ? `${faltas} produto(s) com menos do que o pedido. A diferença vai para o escritório.` : "Tudo bateu com o pedido." }
      : { titulo: "Fechar a contagem?", texto: zero ? `${zero} produto(s) do pedido sem leitura. O que não bater vai para recontagem.` : "O que não bater com o pedido vai para recontagem." };
    if (!(await confirmar(t))) return;
    setOc(true);
    try { await drena(); const r = await api(`recebimento/${c.id}/fechar`, {}); setC(r); setSel(""); setPerg(null); setMsg({ t: "", k: "" }); setTela(r.status === "RECONTANDO" ? "recontar" : "contar"); bip(r.status !== "RECONTANDO"); }
    catch (e) { bip(false); setMsg({ t: (e as Error).message, k: "er" }); toast((e as Error).message, "erro"); } finally { setOc(false); }
  }
  const titulo = rec ? "Recontagem" : `Pedido ${fq(c.pedido)}`;

  if (fim) { const ok = ["CONFERIDO", "DIFERENCA"].includes(c.status), ini = hm(c.criado_em), fimH = hm(c.rec_em || c.fechado_em); return (
    <Tela titulo={`Pedido ${fq(c.pedido)}`} sub={c.fornecedor} voltar={sair} rodape={<BotaoG onClick={sair}>Voltar para Receber</BotaoG>}>
      <div className="vazio"><CircleCheck /><b>{ok ? "Recebimento conferido" : c.status === "ENCERRADO" ? "Recebimento encerrado" : "Recebimento cancelado"}</b>
        {ok && <>{c.lidos} {c.lidos === 1 ? "produto lido" : "produtos lidos"}. {c.divergentes ? `${c.divergentes} ${c.divergentes === 1 ? "ficou" : "ficaram"} com diferença: o escritório já vê.` : "Tudo bateu com o pedido."}</>}</div>
      <div className="cx"><div className="kv !mt-0"><span>Conferido por</span><b className="text-right">{c.usuario}</b>{ini && <><span>Das</span><b className="text-right tabular">{ini}{fimH && ` às ${fimH}`}</b></>}<span>Nota</span><b className="text-right">{c.nota || "não bipada"}</b></div></div>
    </Tela>
  ); }

  if (tela === "recontar") return (
    <Tela titulo={`Pedido ${fq(c.pedido)}`} sub="Contagem fechada" voltar={sair} rodape={<BotaoG onClick={() => { setSel(itens.find((i) => !i.contado)?.codpro || itens[0]?.codpro || ""); setMsg({ t: "", k: "" }); setTela("contar"); }}>{itens.some((i) => i.contado) ? "Continuar a recontagem" : `Recontar ${itens.length === 1 ? "o produto" : `os ${itens.length}`}`}</BotaoG>}>
      <div className="aviso-a"><b className="block text-[18px]">{itens.length} {itens.length === 1 ? "produto para recontar" : "produtos para recontar"}</b>Conte de novo, do zero. Você não vê quanto deu antes.</div>
      {itens.map((i) => <div key={i.codpro} className="linha"><div><b className="!text-[16px]">{i.nompro}</b><small>Cód. {i.codpro} · {i.unipro}{i.contado ? " · recontado" : ""}</small></div></div>)}
    </Tela>
  );

  if (tela === "validade" && pend) return <Validade item={pend.i} voltar={() => { setPend(null); setTela("contar"); }}
    confirmar={(v) => { const p = pend; setPend(null); setTela("contar"); if (p.i.codpro) usarVal(p.i.codpro, v); p.depois(v); if (p.trocar) setMsg({ t: `Próximas leituras: ${nomeVal(chaveVal(v))}`, k: "ok" }); }} />;

  if (tela === "teclado" && at) { const v = valDe(at) || { validade: "", lote: "" }, k = chaveVal(v), outras = r4(at.contado - (at.vals[k] || 0)); return (
    <Tela titulo="Quantidade" sub={at.nompro} voltar={() => setTela("contar")}
      rodape={<BotaoG disabled={num === "" || isNaN(Number(num.replace(",", ".")))} onClick={() => { const n = r4(Number(num.replace(",", "."))); setTela("contar"); contar(at, v, n, "fixa", "Quantidade digitada"); }}>Confirmar</BotaoG>}>
      <div className="visor tabular">{num || "0"}<small>{cq ? `de ${fq(at.qtd)} ` : ""}{at.unipro}</small></div>
      {!at.semcad && <div className="secao !mt-0 text-center">{nomeVal(k)}{outras > 0 ? ` · mais ${fq(outras)} em outras validades` : ""}</div>}
      <div className="teclas">{["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"].map((t) => <button key={t} aria-label={t === "⌫" ? "Apagar" : t} onMouseDown={(e) => e.preventDefault()} onClick={() => setNum((x) => (t === "⌫" ? x.slice(0, -1) : t === "," && (!x || x.includes(",")) ? x : (x + t).slice(0, 10)))}>{t === "⌫" ? <Delete /> : t}</button>)}</div>
    </Tela>
  ); }

  if (tela === "codigo") return (
    <Tela titulo="Digitar o código" sub="Quando a etiqueta não lê" voltar={() => setTela("contar")}
      rodape={<BotaoG disabled={!num.trim()} onClick={() => { const v = num; setNum(""); setTela("contar"); ler(v); }}>Procurar</BotaoG>}>
      <div className="campo-ic"><ScanBarcode /><input autoFocus inputMode="numeric" placeholder="Código de barras ou do produto" value={num} onChange={(e) => setNum(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && num.trim()) { const v = num; setNum(""); setTela("contar"); ler(v); } }} /></div>
    </Tela>
  );

  if (tela === "menu") return (
    <Tela titulo={titulo} sub={c.fornecedor} voltar={() => setTela("contar")}>
      <button className="linha" onClick={() => { setNum(""); setTela("codigo"); }}><div><b>Digitar o código</b><small>Quando a etiqueta não lê</small></div></button>
      <button className="linha" onClick={() => { setBusca(""); setTela("lista"); }}><div><b>{cq ? "Ver pedido" : "Ver lidos"}</b><small>{cq ? "Pedido e contado de cada produto" : `${lidos} de ${ped.length} produtos lidos`}</small></div></button>
      <button className="linha" onClick={sair}><div><b>Sair e continuar depois</b><small>O que já foi lido fica guardado</small></div></button>
    </Tela>
  );

  if (tela === "lista") { const q = busca.trim().toUpperCase().split(/\s+/), l = (cq || rec ? itens : itens.filter((i) => i.contado > 0)).filter((i) => q.every((w) => `${i.nompro} ${i.codpro} ${i.codigos[0]}`.toUpperCase().includes(w)));
    const ok = (i: Row) => cq && !i.fora && !i.semcad && i.contado >= i.qtd; return (
    <Tela titulo={cq ? "Pedido" : rec ? "Recontagem" : "Lidos"} sub={cq ? `${fq(feito)} de ${fq(tot)} recebidos` : rec ? `${feito} de ${tot} recontados` : `${lidos} de ${ped.length} produtos lidos`} voltar={() => setTela("contar")}>
      <div className="campo-ic"><ScanBarcode /><input placeholder="Procurar pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
      {!l.length && <div className="vazio"><b>{busca ? "Nada com esse nome" : "Nada lido ainda"}</b>{busca ? "" : "Leia o primeiro produto."}</div>}
      {[...l].sort((a, b) => Number(ok(a)) - Number(ok(b))).map((i) => (
        <button key={i.codpro} className="linha" onClick={() => { setSel(i.codpro); setPerg(null); setMsg({ t: "", k: "" }); setTela("contar"); }}>
          <div><b className="!text-[16px]">{i.nompro}</b><small>{i.semcad ? `Sem cadastro · ${i.codigos[0]}` : [i.fora ? "fora do pedido" : i.codpro, i.falta && "não veio o resto", ...Object.keys(i.vals).map(nomeVal)].filter(Boolean).join(" · ")}</small></div>
          <span className={cx("pilula tabular", ok(i) && "verde", i.falta && "rosa")}>{fq(i.contado)}{cq && !i.fora && !i.semcad ? ` / ${fq(i.qtd)}` : ""}</span></button>))}
    </Tela>
  ); }

  // cartão da leitura: altura fixa, só troca a cor e o texto
  const vAt = at ? valDe(at) : null, nVal = at ? Object.keys(at.vals).length : 0, falta = at && cq && !at.fora && !at.semcad ? r4(at.qtd - at.contado) : null;
  // com quantidade, o que importa depois de ler é quanto falta (o "+1" já se vê no número)
  const diz = off ? `Sem rede: ${fila.length} guardada(s)` : (falta != null && msg.k !== "er" ? "" : msg.t) || (!at ? "Leia o código" : rec ? (at.contado ? (nVal > 1 ? `${nVal} validades` : "Leia o código") : "Leia o código")
    : falta != null ? (falta > 0 ? `Faltam ${fq(falta)}` : falta === 0 ? "Completo" : `Passou do pedido (+${fq(-falta)})`) : nVal > 1 ? `${nVal} validades` : "Leia o código");
  const tom = perg ? (perg.tipo === "fora" ? "am" : "er") : msg.k || (falta != null && falta < 0 ? "er" : "");
  return (
    <div className="tela">
      <Cabecalho titulo={titulo} sub={rec ? `${kRec + 1} de ${itens.length} ${itens.length === 1 ? "produto" : "produtos"}` : cq ? c.fornecedor : `${lidos} de ${ped.length} produtos lidos`}
        esq={<button className="ic" aria-label="Voltar" onClick={sair}><ChevronLeft /></button>} dir={<button className="ic" aria-label="Menu" onClick={() => setTela("menu")}><Menu /></button>} />
      <form className="leitor" onSubmit={(e) => { e.preventDefault(); const v = leitor.current!.value; leitor.current!.value = ""; ler(v); }}><input ref={leitor} inputMode="none" autoComplete="off" aria-label="Leitor" /></form>
      <div className="corpo">
        <div className="barra"><i style={{ width: `${tot ? Math.min(100, (feito / tot) * 100) : 0}%` }} /></div>
        {perg ? <div className={cx("foco", tom)}>
          <div className="rot">{perg.tipo === "fora" ? "Não está no pedido" : "Código sem cadastro no Lieto"}</div>
          <div className="nome">{perg.tipo === "fora" ? perg.produto.nompro : perg.codigo}</div>
          <div className="qtd tabular">{perg.tipo === "fora" ? "0" : "—"}{perg.tipo === "fora" && <i>{perg.produto.unipro}</i>}</div>
          <div className="vd vz" />
          <div className="diz">{perg.tipo === "fora" ? "Contar assim mesmo?" : "Separe e avise o escritório"}</div>
        </div> : <div className={cx("foco", tom)}>
          <div className="rot">{!at ? "Nada lido ainda" : rec ? "Conte este produto" : at.fora ? "Fora do pedido" : at.semcad ? "Sem cadastro" : "Último lido"}</div>
          <div className="nome">{at ? (at.semcad ? at.codigos[0] : at.nompro) : "Leia o primeiro produto"}</div>
          <div className="qtd tabular">{at ? fq(at.contado) : "—"}{falta != null && <i>de {fq(at!.qtd)}</i>}{at?.unipro && <i>{at.unipro}</i>}</div>
          <div className={cx("vd", (!at || at.semcad || !vAt) && "vz")}>{vAt ? nomeVal(chaveVal(vAt)) : "."}</div>
          <div className="diz">{diz}</div>
        </div>}
        {perg ? <div className="dois">
          {perg.tipo === "fora" ? <><button className="bt2 br" disabled={oc} onClick={() => { const p = perg; comValidade({ ...p.produto, vals: {} } as Row, (v) => extra(p, v)); }}>Contar</button><button className="bt2 br" onClick={() => { setPerg(null); setMsg({ t: "Não contado", k: "" }); }}>Não contar</button></>
            : <><button className="bt2 br" disabled={oc} onClick={() => extra(perg, null)}>Anotar e seguir</button><button className="bt2 br" onClick={() => { setPerg(null); setMsg({ t: "Leia de novo", k: "" }); }}>Ler de novo</button></>}
        </div> : <>
          <div className="mais">
            <button className="bt2" aria-label="Menos um" disabled={!at || !vAt || !agoraK(at, chaveVal(vAt))} onClick={() => contar(at!, vAt!, Math.max(0, r4(agoraK(at!, chaveVal(vAt!)) - 1)), "fixa", "Corrigido")}>−</button>
            <button className="bt2" disabled={!at} onClick={() => comValidade(at!, () => { setNum(""); setTela("teclado"); })}>Digitar</button>
            <button className="bt2" aria-label="Mais um" disabled={!at} onClick={() => comValidade(at!, (v) => contar(at!, v, 1, "soma", "+1 lido"))}>+</button>
          </div>
          {!rec && <div className="dois">{cq
            ? <><button className="bt2" disabled={!at || at.fora || at.semcad || at.contado >= at.qtd || at.falta || oc} onClick={naoVeio}>Não veio o resto</button><button className="bt2" onClick={() => { setBusca(""); setTela("lista"); }}>Ver pedido</button></>
            : <><button className="bt2" disabled={!at || at.semcad} onClick={() => { setPend({ i: at!, depois: () => {}, trocar: true }); setTela("validade"); }}>Outra validade</button><button className="bt2" onClick={() => { setBusca(""); setTela("lista"); }}>Ver lidos</button></>}</div>}
          {rec && cq && <div className="dois"><button className="bt2" disabled={!at || at.semcad} onClick={() => { setPend({ i: at!, depois: () => {}, trocar: true }); setTela("validade"); }}>Outra validade</button><button className="bt2" onClick={() => { setBusca(""); setTela("lista"); }}>Ver lista</button></div>}
        </>}
      </div>
      <div className="rodape">{rec && kRec < itens.length - 1
        ? <BotaoG tom="ok" disabled={oc} onClick={() => { setSel(itens[kRec + 1].codpro); setPerg(null); setMsg({ t: "", k: "" }); }}>Próximo produto</BotaoG>
        : <BotaoG tom="ok" disabled={oc} onClick={fechar}>{oc ? "Aguarde…" : rec ? "Fechar recontagem" : "Fechar contagem"}</BotaoG>}</div>
      {dialogo}
    </div>
  );
}

// Validade: aparece sozinha na 1ª leitura de cada produto. Só números (26112028 = dia; 032027 = mês). Vencida ou curta avisa e deixa seguir.
function Validade({ item, voltar, confirmar }: { item: Row; voltar: () => void; confirmar: (v: Val) => void }) {
  const [d, setD] = useState(""), [lote, setLote] = useState(""), [comLote, setComLote] = useState(false), [sem, setSem] = useState(false);
  const m = mascaraValidade(d), v = validadeIso(m), h = hojeIso(), venc = !!v && validadeVencida(v, h), curta = !!v && !venc && dias(h, v.length === 7 ? `${v}-28` : v) < 30;
  const dica = sem ? "Fica lembrado para este produto" : venc ? "Vencida. Confira antes de seguir." : curta ? "Vence em menos de 30 dias." : "Só números: 26112028 (dia) ou 032027 (mês)";
  return (
    <Tela titulo="Validade" sub={item.nompro} voltar={voltar}
      rodape={<BotaoG tom="ok" disabled={!sem && !v} onClick={() => confirmar({ validade: sem ? "" : v!, lote: lote.trim().toUpperCase(), sem })}>{sem ? "Confirmar sem validade" : v ? `Confirmar ${validadeTexto(v)}` : "Digite a validade"}</BotaoG>}>
      <div className={cx("visor val tabular", (venc || curta) && !sem && "alerta")}>{sem ? "Sem validade" : m || "__/____"}<small>{dica}</small></div>
      {comLote && <div className="campo-ic"><input autoFocus placeholder="Lote (opcional)" value={lote} maxLength={20} onChange={(e) => setLote(e.target.value)} /></div>}
      <div className="teclas cp">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "Lote", "0", "⌫"].map((t) => <button key={t} disabled={sem && t !== "Lote"} className={cx(t === "Lote" && "!text-[17px]", t === "Lote" && comLote && "!bg-[var(--color-brand-800)] !text-white")} aria-label={t === "⌫" ? "Apagar" : t}
        onMouseDown={(e) => e.preventDefault()} onClick={() => (t === "Lote" ? setComLote((x) => !x) : setD((x) => (t === "⌫" ? x.slice(0, -1) : (x + t).slice(0, 8))))}>{t === "⌫" ? <Delete /> : t}</button>)}</div>
      <button className={cx("semval", sem && "on")} onClick={() => setSem((x) => !x)}><i>{sem && <Check />}</i>Produto sem validade</button>
    </Tela>
  );
}
