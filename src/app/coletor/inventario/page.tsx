"use client";
// Coletor (Android pelo navegador). Barra inferior com 4 abas:
//   Contar (tela de foco: ler / digitar quantidade) · Lista (o que contar, com filtros e grupos) · Leituras · Ajustes.
// As abas ficam montadas o tempo todo: trocar de aba ou lançar um item não perde filtros nem a posição da lista.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, CircleAlert, Delete, History, Keyboard, KeyboardOff, Layers, ListChecks, LogOut, MapPin, Package, RefreshCw,
  ScanBarcode, Search, Settings2, SlidersHorizontal, Undo2, Volume2, VolumeX, Warehouse, Wifi, WifiOff, X,
} from "lucide-react";
import { sair } from "@/components/acesso";
import { Button, cx } from "@/components/ui";
import { Campo, campoCol } from "@/components/coletor";
import { Observacao } from "@/components/observacao";
import { usePode } from "@/components/topo";
import { FinalizarEtapa } from "@/components/finalizar-etapa";
import { NOME_ETAPA, api, chave, fq, frs, ls, nomeFator, r4, sessao, type Row } from "@/lib/client";

type Leitura = { uid: string; inv: number; etapa: number; local: string; codigo: string; codpro: string; nome: string; un: string; qtd: number; em: string; erro?: string };
type Catalogo = { id: number; descricao: string; etapa: string; etapaNum: number; prods: Record<string, [string, string, string]>; codigos: Record<string, string>; fatores?: Record<string, number> };
type Prod = { fator: number; codpro: string; nome: string; un: string; sit: string; codigo: string };
type Aba = "contar" | "lista" | "leituras" | "ajustes";

const agoraStr = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const novoUid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

// ---------- quantidade: soma de termos, cada termo pode ser multiplicação (5×40 + 3×12 + 7) ----------
const termos = (expr: string) => expr.replace(/,/g, ".").split("+").filter((t) => t !== "");
function valorTermo(t: string) {
  const f = t.split("*");
  if (f.some((x) => x === "" || isNaN(Number(x)))) return NaN;
  return f.reduce((m, x) => m * Number(x), 1);
}
function total(expr: string) {
  if (!expr) return NaN;
  const ts = termos(expr);
  if (!ts.length || /[+*]$/.test(expr)) return NaN;
  return Math.round(ts.reduce((a, t) => a + valorTermo(t), 0) * 1e4) / 1e4;
}
const bonito = (t: string) => t.replace(/\*/g, " × ").replace(/\./g, ",");

let ac: AudioContext | undefined, somLigado = true;
function bip(ok: boolean) {
  if (somLigado) try {
    ac = ac || new AudioContext(); const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = ok ? 1600 : 280; o.connect(g); g.connect(ac.destination); g.gain.value = 0.15; o.start(); o.stop(ac.currentTime + (ok ? 0.07 : 0.35));
  } catch {}
  try { navigator.vibrate?.(ok ? 35 : [140, 70, 140]); } catch {}
}

export default function Coletor() {
  const [pronto, setPronto] = useState(false), [invId, setInvId] = useState<number | null>(null);
  useEffect(() => { setInvId(ls.get("invId", null)); setPronto(true); }, []);
  const escolher = (i: number | null) => { ls.set("invId", i); setInvId(i); };
  if (!pronto) return null;
  if (!invId) return <Entrada entrar={escolher} />;
  return <App key={invId} invId={invId} trocar={escolher} />;
}

// ---------- escolha do inventário ----------
function useInventarios() {
  const [invs, setInvs] = useState<Row[] | null>(null), [erro, setErro] = useState("");
  const carregar = useCallback(() => api("info").then((i) => { setInvs(i.inventarios); setErro(""); }).catch((e) => { setErro("Sem conexão com o servidor. " + e.message); setInvs([]); }), []);
  useEffect(() => { carregar(); }, [carregar]);
  return { invs, erro, carregar };
}
function Entrada({ entrar }: { entrar: (inv: number) => void }) {
  const { invs, erro, carregar } = useInventarios(), u = sessao.usuario(), pode = usePode()(["inventario_avulso"]), [abrindo, setAbrindo] = useState(false);
  return (
    <div className="min-h-dvh bg-brand-900 text-white">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-6 pt-8">
        <div className="flex items-center gap-3">
          <Link href="/coletor" className="grid size-11 place-items-center rounded-xl bg-white/10" title="Voltar aos módulos"><ArrowLeft className="size-6" /></Link>
          <div className="flex-1"><div className="text-lg font-semibold">Coletor de inventário</div><div className="text-sm text-brand-100/70">Olá, {u?.nome}</div></div>
          <button onClick={sair} className="grid size-10 place-items-center rounded-lg bg-white/10" title="Sair"><LogOut className="size-5" /></button>
        </div>
        {abrindo ? <AbrirAvulso entrar={entrar} voltar={() => setAbrindo(false)} /> : <>
        <div className="mt-8 flex items-center justify-between text-sm font-medium text-brand-100"><span>Escolha o inventário</span>
          <button onClick={carregar} className="grid size-9 place-items-center rounded-lg bg-white/10"><RefreshCw className="size-4" /></button></div>
        <ListaInventarios invs={invs} erro={erro} atual={null} escolher={entrar} escuro />
        <button disabled={!pode} onClick={() => setAbrindo(true)} className="mt-4 h-14 w-full rounded-xl bg-brand-500 text-[16px] font-semibold disabled:opacity-40">Abrir inventário avulso</button>
        {!pode && <p className="mt-2 text-[13px] text-brand-100/70">Seu usuário não tem a liberação &quot;Inventário: abrir avulso&quot;.</p>}
        </>}
      </div>
    </div>
  );
}
function AbrirAvulso({ entrar, voltar }: { entrar: (inv: number) => void; voltar: () => void }) {
  const [nome, setNome] = useState(() => `Avulso ${new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }).replace(",", "")} ${sessao.usuario()?.nome || ""}`.trim());
  const [emp, setEmp] = useState<Row | null>(null), [obs, setObs] = useState(""), [erro, setErro] = useState(""), [oc, setOc] = useState(false), uid = useRef(novoUid());
  useEffect(() => { api("inventarios/avulso/empresa").then(setEmp).catch((e) => setErro((e as Error).message)); }, []);
  async function abrir() { setOc(true); setErro(""); try { entrar((await api("inventarios/avulso", { uid: uid.current, descricao: nome, obs })).id); } catch (e) { setErro((e as Error).message); setOc(false); } }
  return (
    <div className="mt-6 space-y-3 bg-white p-4 text-ink">
      <Campo nome="Nome"><input className={campoCol} maxLength={140} value={nome} onChange={(e) => setNome(e.target.value)} /></Campo>
      <Campo nome="Empresa"><input className={campoCol} disabled readOnly value={emp ? `${emp.codemp} · ${emp.nomemp}` : erro ? "—" : "Carregando…"} /></Campo>
      <Observacao valor={obs} mudar={setObs} cabe={0} />
      <Button size="lg" className="w-full" disabled={!emp || !nome.trim() || oc} onClick={abrir}>{oc ? "Congelando saldos…" : "Abrir e começar a contar"}</Button>
      <Button size="lg" variant="secondary" className="w-full" disabled={oc} onClick={voltar}>Voltar</Button>
      {erro && <p className="bg-rose-50 p-3 text-sm text-rose-800">{erro}</p>}
    </div>
  );
}
function ListaInventarios({ invs, erro, atual, escolher, escuro }: { invs: Row[] | null; erro: string; atual: number | null; escolher: (id: number) => void; escuro?: boolean }) {
  const cor = ["", "bg-sky-500", "bg-amber-500", "bg-rose-500"];
  return (
    <div className="mt-2 space-y-2">
      {invs === null && <div className={cx("h-16 animate-pulse rounded-xl", escuro ? "bg-white/10" : "bg-slate-200")} />}
      {invs?.map((i) => {
        const n = { CONTAGEM: 1, RECONTAGEM: 2, AUDITORIA: 3 }[i.etapa as string] || 0, sel = atual === i.id;
        return (
          <button key={i.id} onClick={() => escolher(i.id)} className={cx("flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left transition",
            escuro ? "bg-white text-ink active:bg-brand-50" : sel ? "bg-brand-50 ring-2 ring-brand-600" : "bg-white ring-1 ring-line active:bg-slate-50")}>
            <span className={cx("h-10 w-1.5 shrink-0 rounded-full", cor[n])} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[16px] font-semibold">{i.descricao}</span><span className="text-[13px] text-muted">#{i.id} · {NOME_ETAPA[i.etapa]}{i.avulso ? " · avulso" : ""}</span></span>
            {sel ? <Check className="size-5 text-brand-700" /> : <ArrowRight className="size-5 text-muted" />}
          </button>
        );
      })}
      {invs?.length === 0 && !erro && <p className={cx("rounded-xl px-4 py-3 text-sm", escuro ? "bg-white/10" : "bg-white")}>Nenhum inventário aberto para contagem.</p>}
      {erro && <p className="rounded-xl bg-rose-500/20 px-4 py-3 text-sm text-rose-50">{erro}</p>}
    </div>
  );
}

// ---------- aplicativo ----------
function App({ invId, trocar }: { invId: number; trocar: (i: number | null) => void }) {
  const op = sessao.usuario()?.nome || "";
  const [aba, setAba] = useState<Aba>("contar");
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [online, setOnline] = useState(true);
  const [local, setLocal] = useState(""), [editLocal, setEditLocal] = useState(false);
  const [bipagem, setBipagem] = useState(false), [teclado, setTeclado] = useState(true), [som, setSom] = useState(true);
  const [busca, setBusca] = useState("");
  const [prod, setProd] = useState<Prod | null>(null), [veioDa, setVeioDa] = useState<Aba>("contar");
  const [expr, setExpr] = useState("");
  const [palete, setPalete] = useState<null | { p: string; c: string; l: string }>(null), [campoPal, setCampoPal] = useState<"p" | "c" | "l">("p");
  const virgem = useRef(true); // 1ª tecla num campo do palete substitui o valor sugerido
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [fila, setFila] = useState<Leitura[]>([]), [rejeitadas, setRejeitadas] = useState<Leitura[]>([]), [minhas, setMinhas] = useState<Row[]>([]);
  const [lista, setLista] = useState<Row[] | null>(null);
  const [exigirLocal, setExigirLocal] = useState(false);
  const [disp, setDisp] = useState(""), [trocando, setTrocando] = useState(false);
  const refBusca = useRef<HTMLInputElement>(null), refLocal = useRef<HTMLInputElement>(null), refQtd = useRef<HTMLInputElement>(null);
  const filaRef = useRef<Leitura[]>([]), enviando = useRef(false), refContar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocal(ls.get("local", "")); setBipagem(ls.get("bipagem", false)); setTeclado(ls.get("teclado", true));
    const s = ls.get("som", true); setSom(s); somLigado = s;
    const f = ls.get<Leitura[]>("fila", []); filaRef.current = f; setFila(f); setRejeitadas(ls.get("rej", []));
    let d = ls.get("disp", ""); if (!d) { d = "COL-" + Math.random().toString(36).slice(2, 6).toUpperCase(); ls.set("disp", d); } setDisp(d);
  }, []);
  const gravarFila = (f: Leitura[]) => { filaRef.current = f; setFila(f); ls.set("fila", f); };

  // cada aba tem a própria rolagem (painéis sobrepostos); trocar de aba não mexe na posição das outras
  const irPara = useCallback((a: Aba) => setAba(a), []);
  // confirmação de leitura some sozinha; erro fica até fechar
  useEffect(() => { if (aviso?.tipo !== "ok") return; const t = setTimeout(() => setAviso(null), 4000); return () => clearTimeout(t); }, [aviso]);

  const carregarCat = useCallback(async () => {
    try { const c = await api<Catalogo>(`inventarios/${invId}/catalogo`); ls.set("cat" + invId, c); setCat(c); setOnline(true); return c; }
    catch { setOnline(false); const c = ls.get<Catalogo | null>("cat" + invId, null); if (c) setCat(c); return c; }
  }, [invId]);
  useEffect(() => { carregarCat(); api("info").then((i) => setExigirLocal(i.exigirLocal)).catch(() => {}); }, [carregarCat]);

  const indice = useMemo(() => cat ? Object.entries(cat.prods).map(([codpro, [nome, un, sit]]) => ({ codpro, nome, un, sit, hay: norm(`${nome} ${codpro}`) })) : [], [cat]);

  // lista de trabalho (contagem: o que contar, sem quantidade; recontagem: cega; auditoria: com diferença)
  const carregarLista = useCallback(async () => {
    try { const p = await api<Row[]>(`inventarios/${invId}/pendentes`); setLista(p); ls.set("lista" + invId, p); }
    catch { setLista((l) => l ?? ls.get<Row[] | null>("lista" + invId, null) ?? []); }
  }, [invId]);
  useEffect(() => { if (!cat?.etapaNum) return; carregarLista(); const t = setInterval(() => { if (!document.hidden) carregarLista(); }, 15000); return () => clearInterval(t); }, [cat?.etapaNum, carregarLista]);

  const sincronizar = useCallback(async () => {
    if (enviando.current) return;
    enviando.current = true;
    try {
      const lote = filaRef.current.filter((l) => l.inv === invId).slice(0, 50);
      if (lote.length) {
        const r = await api<{ resultados: Row[] }>(`inventarios/${invId}/leituras`, { dispositivo: disp, leituras: lote });
        const res = new Map(r.resultados.map((x) => [x.uid, x]));
        const rej: Leitura[] = [];
        gravarFila(filaRef.current.filter((l) => { const x = res.get(l.uid); if (!x) return true; if (!x.ok) rej.push({ ...l, erro: x.erro }); return false; }));
        if (rej.length) { bip(false); setRejeitadas((a) => { const n = [...rej, ...a]; ls.set("rej", n); return n; }); }
        if (cat?.etapaNum === 3) carregarLista(); // auditoria: o final muda com a leitura
      }
      setMinhas(await api<Row[]>(`inventarios/${invId}/leituras?usuario=${encodeURIComponent(op)}&etapa=${cat?.etapaNum ?? 0}`));
      setOnline(true);
    } catch { setOnline(false); }
    enviando.current = false;
  }, [invId, op, disp, cat?.etapaNum, carregarLista]);
  useEffect(() => { if (!cat) return; sincronizar(); const t = setInterval(sincronizar, 4000); return () => clearInterval(t); }, [cat, sincronizar]);
  useEffect(() => { // mudança de etapa feita pela gestão
    const t = setInterval(async () => {
      try { const i = await api("info"); const x = i.inventarios.find((v: Row) => v.id === invId);
        if (cat && (!x || x.etapa !== cat.etapa)) { const c = await carregarCat(); bip(false); setAviso({ tipo: "erro", texto: c && x ? `O inventário passou para: ${NOME_ETAPA[c.etapa]}.` : "Inventário encerrado." }); carregarLista(); }
      } catch {}
    }, 15000);
    return () => clearInterval(t);
  }, [cat, invId, carregarCat, carregarLista]);

  useEffect(() => { if (aba !== "contar") return; setTimeout(() => (editLocal ? refLocal : prod ? refQtd : refBusca).current?.focus(), 40); }, [editLocal, prod, aba]);

  const erro = (texto: string) => { bip(false); setAviso({ tipo: "erro", texto }); };

  // ---- busca ----
  const termo = busca.trim();
  const porCodigo = termo && cat ? cat.codigos[chave(termo)] : undefined;
  const sugestoes = useMemo(() => {
    if (!termo || porCodigo || termo.length < 2) return [];
    const toks = norm(termo).split(/\s+/).filter(Boolean);
    const achou = indice.filter((p) => toks.every((t) => p.hay.includes(t)));
    const t0 = toks[0];
    return achou.sort((a, b) => Number(!norm(a.nome).startsWith(t0)) - Number(!norm(b.nome).startsWith(t0)) || a.nome.length - b.nome.length).slice(0, 40);
  }, [termo, porCodigo, indice]);

  function escolher(codpro: string, codigo: string, origem: Aba = "contar") {
    if (!cat) return;
    const p = cat.prods[codpro];
    if (!cat.etapaNum) return erro(`Inventário em ${NOME_ETAPA[cat.etapa]}: não aceita leituras.`);
    if (exigirLocal && !local) { irPara("contar"); setEditLocal(true); return erro("Informe o local antes de contar."); }
    if (p[2] === "DESCONSIDERADO") return erro(`${p[0]} foi desconsiderado deste inventário.`);
    if (cat.etapaNum === 2 && p[2] !== "RECONTAR") return erro(`${p[0]} não está na lista de recontagem.`);
    if (cat.etapaNum === 3 && !["AUDITAR", "AUDITADO"].includes(p[2])) return erro(`${p[0]} não está na lista de auditoria.`);
    const pr = { fator: cat.fatores?.[chave(codigo)] || 1, codpro, nome: p[0], un: p[1], sit: p[2], codigo };
    setBusca("");
    if (bipagem && cat.etapaNum !== 3) { enfileirar(pr, r4(pr.fator)); return; }
    bip(true); setAviso(null); setProd(pr); setExpr(""); setPalete(null); setVeioDa(origem);
    refContar.current?.scrollTo(0, 0);
    if (origem !== "contar") setAba("contar");
  }
  function enter() {
    if (!termo) return;
    if (porCodigo) return escolher(porCodigo, termo);
    if (sugestoes.length === 1) return escolher(sugestoes[0].codpro, sugestoes[0].codpro);
    if (!sugestoes.length) { setBusca(""); return erro(/^\d+$/.test(termo) ? `Código ${termo} não encontrado neste inventário.` : `Nada encontrado para “${termo}”.`); }
    bip(false);
  }
  function fecharProduto() { setProd(null); setExpr(""); setPalete(null); if (veioDa !== "contar") irPara(veioDa); }

  // ---- quantidade ----
  const tecla = (k: string) => {
    if (palete) { // com o palete aberto, o mesmo teclado digita no campo marcado
      if (k === "×") { proximoPal(); return; }
      if (!/^\d$/.test(k) && k !== "⌫" && k !== "C") return;
      const novo = virgem.current; virgem.current = false;
      setPalete((v) => v && { ...v, [campoPal]: k === "C" ? "" : k === "⌫" ? v[campoPal].slice(0, -1) : (novo ? "" : v[campoPal]) + k });
      return;
    }
    setExpr((v) => {
      if (k === "⌫") return v.slice(0, -1);
      if (k === "C") return "";
      if (k === "×" || k === "+") { const o = k === "×" ? "*" : "+"; return !v || /[+*]$/.test(v) ? v : v + o; }
      if (k === "," && /(^|[+*])[^+*]*[.,][^+*]*$/.test(v)) return v;
      return v + k;
    });
    refQtd.current?.focus();
  };
  function proximoPal() { setCampoPal((c) => (c === "p" ? "c" : "l")); virgem.current = true; }
  function fecharPalete() { setPalete(null); refQtd.current?.focus(); }
  function abrirPalete() {
    if (!prod) return;
    if (palete) return fecharPalete();
    setCampoPal("p"); virgem.current = true;
    // montagem cadastrada (Coletor › Cadastro) vale para todos os aparelhos; sem rede, usa a última deste aparelho
    const cod = prod.codpro;
    api(`cadastro/${encodeURIComponent(cod)}/palete`).then((m) => { if (m.camadas && prodRef.current === cod) setPalete((v) => v && (v.c || v.l ? v : { ...v, c: String(m.camadas), l: String(m.caixas) })); }).catch(() => {});
    const salvo = ls.get<{ c: string; l: string } | null>("pal." + prod.codpro, null);
    setPalete({ p: "1", c: salvo?.c ?? "", l: salvo?.l ?? "" });
  }
  function adicionarPalete() {
    if (!palete || !prod) return;
    if (campoPal !== "l") return proximoPal();
    const [p, c, l] = [palete.p, palete.c, palete.l].map((x) => x.replace(",", "."));
    if (![p, c, l].every((x) => x && !isNaN(Number(x)) && Number(x) > 0)) return erro("Preencha paletes, camadas e caixas por camada.");
    ls.set("pal." + prod.codpro, { c: palete.c, l: palete.l });
    setExpr((v) => (v && !/[+*]$/.test(v) ? v + "+" : v) + `${p}*${c}*${l}`);
    setPalete(null); refQtd.current?.focus();
  }
  function gravar() {
    if (!prod) return;
    const v = r4(total(expr) * prod.fator);
    if (isNaN(v) || v < 0) return erro("Quantidade inválida.");
    enfileirar(prod, v); fecharProduto();
  }
  function enfileirar(p: Prod, q: number) {
    if (!cat) return;
    gravarFila([...filaRef.current, { uid: novoUid(), inv: invId, etapa: cat.etapaNum, local, codigo: p.codigo, codpro: p.codpro, nome: p.nome, un: p.un, qtd: q, em: agoraStr() }]);
    // marca como feito na lista na hora (o servidor confirma na próxima atualização)
    setLista((l) => l && l.map((x) => (x.codpro === p.codpro ? { ...x, feito: true } : x)));
    bip(true); setAviso({ tipo: "ok", texto: `${cat.etapaNum === 3 ? "Final: " : "+"}${fq(q)} ${p.un} · ${p.nome}` }); sincronizar();
  }
  async function cancelar(l: Row) {
    if (!confirm(`Cancelar ${fq(l.qtd)} ${l.unipro} de ${l.nompro}?`)) return;
    try { await api(`leituras/${l.uid}/cancelar`, {}); sincronizar(); carregarLista(); } catch (e) { erro((e as Error).message); }
  }

  // ---- somatórios ----
  const pend = fila.filter((l) => l.inv === invId), rej = rejeitadas.filter((l) => l.inv === invId);
  const validas = useMemo(() => [
    ...pend.map((l) => ({ codpro: l.codpro, nome: l.nome, un: l.un, local: l.local, qtd: l.qtd })),
    ...minhas.filter((m) => !m.cancelada).map((m) => ({ codpro: m.codpro, nome: m.nompro, un: m.unipro, local: m.local, qtd: m.qtd })),
  ], [pend, minhas]);
  const jaAqui = prod ? validas.filter((l) => l.codpro === prod.codpro && l.local === local).reduce((a, l) => a + l.qtd, 0) : 0;
  const jaTotal = prod ? validas.filter((l) => l.codpro === prod.codpro).reduce((a, l) => a + l.qtd, 0) : 0;

  const mapaLista = useMemo(() => new Map((lista || []).map((x) => [x.codpro, x])), [lista]);
  const infoAud = prod && cat?.etapaNum === 3 ? mapaLista.get(prod.codpro) : undefined;
  const nPend = (lista || []).filter((x) => !x.feito).length;
  const prodRef = useRef<string | null>(null); prodRef.current = prod?.codpro ?? null;
  const vTotal = r4(total(expr) * (prod?.fator || 1)), ts = termos(expr);
  const corEtapa = ["bg-slate-500", "bg-sky-500", "bg-amber-500", "bg-rose-500"][cat?.etapaNum ?? 0];
  const salvarLocal = (l: string) => { const v = l.trim().toUpperCase(); if (exigirLocal && !v) return erro("Informe o local."); setLocal(v); ls.set("local", v); setEditLocal(false); setAviso(null); };

  return (
    <div className="flex h-dvh flex-col bg-slate-100">
      {/* ---------- topo ---------- */}
      <header className="z-20 shrink-0 bg-brand-900 px-3 py-2.5 text-white shadow-lg">
        <div className="flex items-center gap-2">
          <Link href="/coletor" aria-label="Voltar ao menu" onClick={(e) => { if (expr && !confirm("Há uma quantidade digitada e não gravada. Sair mesmo assim?")) e.preventDefault(); }} className="grid size-10 shrink-0 place-items-center bg-white/10"><ArrowLeft className="size-5" /></Link>
          <button onClick={() => setTrocando(true)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            <span className="min-w-0"><span className="block truncate text-[15px] font-semibold">{cat ? cat.descricao : "Carregando…"}</span>
              <span className="block text-[12px] text-brand-100/70">{op}{bipagem && cat?.etapaNum !== 3 ? " · bipagem +1" : ""}</span></span>
            <ChevronDown className="size-4 shrink-0 text-brand-100/70" />
          </button>
          <span className={cx("rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide", corEtapa)}>{cat ? NOME_ETAPA[cat.etapa] : "—"}</span>
          <span className={cx("flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold", online ? "bg-white/10" : "bg-rose-600")}>
            {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}{pend.length > 0 ? pend.length : online ? "" : "off"}
          </span>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
      {aviso && (
        <div className={cx("absolute inset-x-3 z-30", aba === "contar" ? "top-2" : "bottom-3")}>
          <div className={cx("anim-entra mx-auto flex max-w-xl items-start gap-2.5 rounded-xl px-4 py-3 text-[15px] font-semibold shadow-xl", aviso.tipo === "ok" ? "bg-brand-600 text-white" : "bg-rose-600 text-white")}>
            {aviso.tipo === "ok" ? <Check className="mt-0.5 size-5 shrink-0" /> : <CircleAlert className="mt-0.5 size-5 shrink-0" />}<span className="flex-1">{aviso.texto}</span>
            <button onClick={() => setAviso(null)}><X className="size-5 opacity-70" /></button>
          </div>
        </div>
      )}

      {/* ---------- CONTAR (foco) ---------- */}
      <div ref={refContar} className={cx("absolute inset-0 overflow-y-auto overscroll-contain", aba !== "contar" && "invisible")}>
      <main className={cx("mx-auto max-w-xl space-y-3 px-3 pb-6 pt-3", aviso && "pt-[84px]")}>
        {!prod && (
          editLocal ? (
            <form onSubmit={(e) => { e.preventDefault(); salvarLocal(local); }} className="rounded-2xl bg-white p-3 shadow-sm">
              <div className="mb-2 text-[13px] font-semibold text-muted">Local / setor / rua {exigirLocal ? "" : "(opcional)"}</div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <MapPin className="pointer-events-none absolute left-3 top-3.5 size-5 text-brand-700" />
                  <input ref={refLocal} value={local} onChange={(e) => setLocal(e.target.value.toUpperCase())} placeholder="Ex.: RUA 02" enterKeyHint="done"
                    className="h-12 w-full rounded-xl border-2 border-brand-600 pl-10 pr-3 text-lg font-bold uppercase outline-none" autoComplete="off" />
                </div>
                <button className="h-12 rounded-xl bg-brand-600 px-5 font-semibold text-white">OK</button>
              </div>
              {!exigirLocal && <button type="button" onClick={() => salvarLocal("")} className="mt-2 h-10 w-full rounded-lg bg-slate-100 text-[14px] font-medium text-muted">Contar sem local</button>}
            </form>
          ) : (
            <button onClick={() => setEditLocal(true)} className="flex h-10 items-center gap-2 rounded-full bg-white px-3.5 text-[14px] shadow-sm ring-1 ring-line">
              <MapPin className="size-4 text-brand-700" /><span className={cx("font-semibold", !local && "text-muted")}>{local || "Sem local"}</span><span className="text-[12px] font-medium text-brand-700">trocar</span>
            </button>
          )
        )}

        {!editLocal && !prod && (
          <section className="rounded-2xl bg-white p-3 shadow-sm">
            <form onSubmit={(e) => { e.preventDefault(); enter(); }} className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-[18px] size-6 text-muted" />
              <input ref={refBusca} value={busca} onChange={(e) => setBusca(e.target.value)} inputMode={teclado ? "search" : "none"} enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
                placeholder="Bipe ou digite o produto"
                className="h-[60px] w-full rounded-xl border-2 border-brand-600 bg-brand-50/40 pl-12 pr-24 text-xl font-semibold outline-none placeholder:text-[15px] placeholder:font-normal focus:ring-4 focus:ring-brand-500/20" />
              <div className="absolute right-2 top-2 flex gap-1">
                {busca && <button type="button" onClick={() => { setBusca(""); refBusca.current?.focus(); }} className="grid size-11 place-items-center rounded-lg text-muted"><X className="size-5" /></button>}
                <button type="button" onClick={() => { const v = !teclado; setTeclado(v); ls.set("teclado", v); refBusca.current?.blur(); setTimeout(() => refBusca.current?.focus(), 60); }}
                  className="grid size-11 place-items-center rounded-lg text-muted">{teclado ? <Keyboard className="size-5" /> : <KeyboardOff className="size-5" />}</button>
              </div>
            </form>
            {termo.length >= 2 && !porCodigo && (
              <ul className="mt-2 max-h-[55vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
                {sugestoes.map((p) => {
                  const bloqueado = p.sit === "DESCONSIDERADO" || (cat?.etapaNum === 2 && p.sit !== "RECONTAR") || (cat?.etapaNum === 3 && !["AUDITAR", "AUDITADO"].includes(p.sit));
                  return (
                    <li key={p.codpro}>
                      <button onClick={() => escolher(p.codpro, p.codpro)} className={cx("flex w-full items-center gap-3 px-3 py-3 text-left active:bg-brand-50", bloqueado && "opacity-40")}>
                        <Package className="size-5 shrink-0 text-muted" />
                        <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold leading-snug">{p.nome}</span><span className="text-[12px] text-muted">Cód. {p.codpro} · {p.un}</span></span>
                      </button>
                    </li>
                  );
                })}
                {!sugestoes.length && <li className="px-3 py-4 text-center text-[14px] text-muted">Nada encontrado. Confira o código ou tente outra palavra.</li>}
              </ul>
            )}
            {!termo && cat?.etapaNum ? (
              <button onClick={() => irPara("lista")} className="mt-3 flex w-full items-center gap-3 rounded-xl bg-slate-50 px-3 py-3 text-left active:bg-slate-100">
                <ListChecks className="size-5 text-brand-700" />
                <span className="flex-1 text-[14px]"><b>{lista ? nPend : "…"}</b> {cat.etapaNum === 3 ? "itens com diferença para conferir" : cat.etapaNum === 2 ? "itens para recontar" : "itens ainda sem contagem"}</span>
                <ChevronRight className="size-5 text-muted" />
              </button>
            ) : null}
          </section>
        )}

        {prod && (
          <section className="anim-entra overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[17px] font-bold leading-tight">{prod.nome}</div>
                <div className="mt-0.5 text-[12px] text-muted">Cód. {prod.codpro} · {prod.un}{local ? <> · <MapPin className="-mt-0.5 inline size-3" /> {local}</> : null}</div>
              </div>
              <button onClick={fecharProduto} className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-muted"><X className="size-5" /></button>
            </div>
            <div className="p-3">
              <div className="rounded-xl border-2 border-brand-600 px-3 py-2">
                <input ref={refQtd} value={bonito(expr)} inputMode="none" autoComplete="off"
                  onChange={(e) => setExpr(e.target.value.replace(/[x×]/gi, "*").replace(/\s/g, "").replace(/[^\d.,+*]/g, "").replace(/\./g, ","))}
                  onKeyDown={(e) => { if (palete) { e.preventDefault(); if (e.key === "Enter") adicionarPalete(); else if (e.key === "Escape") fecharPalete(); else if (e.key === "Backspace") tecla("⌫"); else tecla(e.key); return; }
                    if (e.key === "Enter") { e.preventDefault(); gravar(); } if (e.key === "Escape") fecharProduto(); }}
                  placeholder="0" className="h-7 w-full bg-transparent text-right font-mono text-[18px] text-muted outline-none" />
                <div className="flex h-10 items-baseline justify-end gap-2 overflow-hidden whitespace-nowrap">
                  {prod.fator !== 1 && <span className="mr-auto self-center bg-amber-100 px-2 py-0.5 text-[13px] font-bold text-amber-900">{nomeFator(prod.fator)}</span>}
                  <span className="font-mono text-[34px] font-bold leading-none tabular">{isNaN(vTotal) ? (expr ? "…" : "0") : fq(vTotal)}</span>
                  <span className="text-lg font-semibold text-muted">{prod.un}</span>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {["7", "8", "9", "×", "4", "5", "6", "+", "1", "2", "3", "⌫", ",", "0", "C"].map((k) => (
                  <button key={k} onClick={() => tecla(k)}
                    className={cx("h-[52px] touch-manipulation select-none rounded-xl text-2xl font-semibold active:brightness-90", /[\d,]/.test(k) ? "bg-slate-100" : k === "×" || k === "+" ? "bg-brand-100 text-brand-800" : "bg-slate-200 text-slate-700")}>
                    {k === "⌫" ? <Delete className="mx-auto size-6" /> : k}
                  </button>
                ))}
                <button onClick={abrirPalete} className="flex h-[52px] flex-col items-center justify-center touch-manipulation select-none rounded-xl bg-amber-100 text-amber-900 active:brightness-90"><Layers className="size-5" /><span className="text-[11px] font-bold">PALETE</span></button>
              </div>
              {palete ? (
                <button onClick={adicionarPalete} className="mt-2 h-14 w-full rounded-xl bg-brand-700 text-xl font-bold text-white transition active:scale-[.98]">{campoPal === "l" ? "Somar paletes" : "Próximo"}</button>
              ) : (
              <button onClick={gravar} disabled={isNaN(vTotal)}
                className="mt-2 h-14 w-full rounded-xl bg-brand-600 text-xl font-bold text-white transition active:scale-[.98] disabled:bg-slate-300 disabled:text-slate-500">
                {cat?.etapaNum === 3 ? "Gravar final" : "Gravar"} {isNaN(vTotal) ? "" : `${fq(vTotal)} ${prod.un}`}
              </button>
              )}
              {/* tudo que é só visual fica ABAIXO do teclado: ele nunca muda de lugar durante a digitação */}
              {palete && (
                <div className="mt-2 rounded-xl bg-brand-50 p-3 ring-1 ring-brand-200">
                  <div className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-brand-800"><Layers className="size-4" />Palete<button onClick={fecharPalete} className="ml-auto rounded-lg bg-white px-3 py-1.5 text-[13px] font-medium text-ink">Cancelar</button></div>
                  <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-end gap-1.5">
                    {([["p", "Paletes"], ["c", "Camadas"], ["l", "Cx/camada"]] as const).map(([k, n], i) => (
                      <div key={k} className="contents">
                        {i > 0 && <span className="pb-3 text-center text-lg font-bold text-muted">×</span>}
                        <button onClick={() => { setCampoPal(k); virgem.current = true; }}><span className="block text-[11px] font-medium text-muted">{n}</span>
                          <span className={cx("flex h-12 w-full items-center justify-center rounded-lg border-2 bg-white text-xl font-bold", campoPal === k ? "border-brand-600" : "border-line")}>{palete[k] || " "}</span></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {ts.length > 1 || (ts[0] || "").includes("*") ? (
                <div className="mt-2 space-y-1 rounded-xl bg-slate-50 px-3 py-2 font-mono text-[14px]">
                  {ts.map((t, i) => <div key={i} className="flex justify-between"><span className="text-muted">{bonito(t)}</span><span className="font-semibold">{isNaN(valorTermo(t)) ? "…" : fq(valorTermo(t))}</span></div>)}
                </div>
              ) : null}
            </div>
            {infoAud && (
              <div className="border-b border-rose-200 bg-rose-50 px-3 py-2.5">
                <div className="grid grid-cols-[1fr_1fr_1fr_1.25fr] gap-1 text-center">
                  {([["Sistema", infoAud.saldo], ["Contagem", infoAud.c1], ["Recont.", infoAud.c2]] as const).map(([n, v]) => (
                    <div key={n}><div className="text-[11px] font-semibold uppercase text-rose-900/60">{n}</div><div className="break-all text-[15px] font-bold leading-tight tabular-nums text-ink">{fq(v)}</div></div>
                  ))}
                  <div className="rounded-lg bg-white/70"><div className="text-[11px] font-semibold uppercase text-rose-900/60">Diferença</div>
                    <div className={cx("break-all text-[15px] font-bold leading-tight tabular-nums", (infoAud.dif ?? 0) < 0 ? "text-rose-700" : "text-brand-700")}>{infoAud.dif > 0 ? "+" : ""}{fq(infoAud.dif)}</div></div>
                </div>
                <div className="mt-1.5 text-center text-[12px] text-rose-900/80">
                  {infoAud.final != null ? <>Final atual: <b>{fq(infoAud.final)} {prod.un}</b> · </> : null}O que você gravar é a <b>quantidade final</b>{infoAud.final != null ? " e substitui a atual" : ""}.
                </div>
              </div>
            )}
            {jaTotal > 0 && cat?.etapaNum !== 3 && <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[13px] font-semibold text-amber-900">Você já contou {fq(jaAqui)} {prod.un} {local ? "neste local" : "sem local"}{jaTotal !== jaAqui ? ` · ${fq(jaTotal)} no total` : ""}</div>}

          </section>
        )}
      </main>
      </div>

      {/* ---------- LISTA ---------- */}
      <div className={cx("absolute inset-0 overflow-y-auto overscroll-contain", aba !== "lista" && "invisible")}>
        <div className="mx-auto max-w-xl">
        {!cat?.etapaNum ? <p className="p-6 text-center text-muted">Inventário sem etapa de contagem ativa.</p>
          : <><div className="px-3 pt-3"><FinalizarEtapa invId={invId} etapa={cat.etapa} naoEnviadas={pend.length} feito={() => { carregarCat(); carregarLista(); }} /></div><ListaItens itens={lista} etapa={cat.etapaNum} local={local} escolher={(c) => escolher(c, c, "lista")} atualizar={carregarLista} /></>}
        </div>
      </div>

      {/* ---------- LEITURAS ---------- */}
      <div className={cx("absolute inset-0 overflow-y-auto overscroll-contain", aba !== "leituras" && "invisible")}>
      <div className="mx-auto max-w-xl px-3 pb-6 pt-3">
        <MinhasLeituras rej={rej} pend={pend} minhas={minhas} validas={validas} cancelar={cancelar}
          descartar={(uid) => setRejeitadas((a) => { const n = a.filter((x) => x.uid !== uid); ls.set("rej", n); return n; })} />
      </div>
      </div>

      {/* ---------- AJUSTES ---------- */}
      <div className={cx("absolute inset-0 overflow-y-auto overscroll-contain", aba !== "ajustes" && "invisible")}>
      <div className="mx-auto max-w-xl space-y-3 px-3 pb-6 pt-3">
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-full bg-brand-100 text-[15px] font-bold text-brand-800">{op.slice(0, 2)}</span>
            <div className="min-w-0 flex-1"><div className="font-semibold">{op}</div><div className="truncate text-[12px] text-muted">{sessao.usuario()?.nomfun} · {disp}</div></div>
            <button onClick={() => { if (pend.length && !confirm(`${pend.length} leitura(s) ainda não enviadas ficam guardadas neste aparelho. Sair?`)) return; sair(); }}
              className="flex h-10 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[14px] font-medium"><LogOut className="size-4" />Sair</button>
          </div>
        </section>
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">Inventário</div>
          <button onClick={() => setTrocando(true)} className="mt-2 flex w-full items-center gap-2 rounded-xl bg-slate-50 px-3 py-3 text-left">
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{cat?.descricao}</span><span className="text-[12px] text-muted">#{invId} · {cat ? NOME_ETAPA[cat.etapa] : ""}</span></span>
            <span className="text-[14px] font-semibold text-brand-700">Trocar</span>
          </button>
        </section>
        <section className="divide-y divide-line rounded-2xl bg-white shadow-sm">
          <button onClick={() => { irPara("contar"); setEditLocal(true); }} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
            <MapPin className="size-5 text-brand-700" /><span className="flex-1"><span className="block text-[15px] font-semibold">Local</span><span className="text-[12px] text-muted">{exigirLocal ? "Obrigatório" : "Opcional"} · setor, rua ou corredor</span></span>
            <span className="font-semibold">{local || "—"}</span>
          </button>
          <Chave icone={<ScanBarcode className="size-5 text-brand-700" />} titulo="Bipagem (+1 por leitura)" texto={cat?.etapaNum === 3 ? "Não vale na auditoria: grava a quantidade final" : "Cada leitura soma 1, sem perguntar a quantidade"} ligado={bipagem}
            mudar={(v) => { setBipagem(v); ls.set("bipagem", v); }} />
          <Chave icone={<Keyboard className="size-5 text-brand-700" />} titulo="Teclado na busca" texto="Desligue se usar o leitor de código de barras" ligado={teclado}
            mudar={(v) => { setTeclado(v); ls.set("teclado", v); }} />
          <Chave icone={som ? <Volume2 className="size-5 text-brand-700" /> : <VolumeX className="size-5 text-brand-700" />} titulo="Som do bip" texto="A vibração continua mesmo sem som" ligado={som}
            mudar={(v) => { setSom(v); somLigado = v; ls.set("som", v); }} />
        </section>
        <button onClick={() => { carregarCat(); carregarLista(); sincronizar(); }} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-[14px] font-semibold shadow-sm">
          <RefreshCw className="size-4" />Atualizar dados do inventário</button>
      </div>
      </div>
      </div>

      {/* ---------- barra inferior ---------- */}
      <nav className="z-30 shrink-0 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-xl grid-cols-4">
          {([["contar", "Contar", ScanBarcode, 0], ["lista", cat?.etapaNum === 3 ? "Diferenças" : "Lista", ListChecks, nPend], ["leituras", "Leituras", History, rej.length || pend.length],
            ["ajustes", "Ajustes", Settings2, 0]] as const).map(([k, n, Ic, c]) => (
            <button key={k} onClick={() => { if (k === "contar" && aba === "contar" && !prod) { setBusca(""); refBusca.current?.focus(); } irPara(k); }}
              className={cx("relative flex h-[64px] flex-col items-center justify-center gap-0.5 text-[12px] font-semibold", aba === k ? "text-brand-700" : "text-slate-500")}>
              {aba === k && <span className="absolute inset-x-6 top-0 h-[3px] rounded-b-full bg-brand-600" />}
              <span className="relative"><Ic className="size-6" strokeWidth={aba === k ? 2.4 : 2} />
                {c > 0 && <span className={cx("absolute -right-3 -top-1.5 min-w-[18px] rounded-full px-1 text-center text-[10px] font-bold leading-[18px] text-white", k === "leituras" && rej.length ? "bg-rose-600" : "bg-ink")}>{c > 999 ? "999+" : c}</span>}
              </span>
              {n}
            </button>
          ))}
        </div>
      </nav>

      {trocando && <TrocarInventario atual={invId} fechar={() => setTrocando(false)} escolher={(i) => {
        if (i === invId) return setTrocando(false);
        if (pend.length && !confirm(`${pend.length} leitura(s) deste inventário ainda não foram enviadas. Elas ficam guardadas e são enviadas quando você voltar a ele. Trocar?`)) return;
        trocar(i);
      }} />}
    </div>
  );
}

function Chave({ icone, titulo, texto, ligado, mudar }: { icone: React.ReactNode; titulo: string; texto: string; ligado: boolean; mudar: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 px-4 py-3.5">
      {icone}<span className="flex-1"><span className="block text-[15px] font-semibold">{titulo}</span><span className="text-[12px] text-muted">{texto}</span></span>
      <input type="checkbox" checked={ligado} onChange={(e) => mudar(e.target.checked)} className="peer sr-only" />
      <span className="relative h-7 w-12 shrink-0 rounded-full bg-slate-300 transition peer-checked:bg-brand-600 after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" />
    </label>
  );
}

function Folha({ titulo, fechar, children, rodape }: { titulo: string; fechar: () => void; children: React.ReactNode; rodape?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && fechar()}>
      <div className="anim-entra flex max-h-[88dvh] flex-col rounded-t-3xl bg-slate-100 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center gap-3 px-4 pb-2 pt-3">
          <span className="flex-1 text-[17px] font-bold">{titulo}</span>
          <button onClick={fechar} className="grid size-10 place-items-center rounded-full bg-white"><X className="size-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {rodape && <div className="border-t border-line bg-white px-4 py-3">{rodape}</div>}
      </div>
    </div>
  );
}

function TrocarInventario({ atual, fechar, escolher }: { atual: number; fechar: () => void; escolher: (i: number) => void }) {
  const { invs, erro } = useInventarios();
  return <Folha titulo="Trocar inventário" fechar={fechar}><ListaInventarios invs={invs} erro={erro} atual={atual} escolher={escolher} /></Folha>;
}

// ---------- leituras ----------
function MinhasLeituras({ rej, pend, minhas, validas, cancelar, descartar }:
  { rej: Leitura[]; pend: Leitura[]; minhas: Row[]; validas: { codpro: string; nome: string; un: string; local: string; qtd: number }[]; cancelar: (l: Row) => void; descartar: (uid: string) => void }) {
  const [modo, setModo] = useState<"leituras" | "totais">("leituras"), [limite, setLimite] = useState(50), [busca, setBusca] = useState("");
  const totais = useMemo(() => {
    const m = new Map<string, { codpro: string; nome: string; un: string; qtd: number; n: number; locais: Map<string, number> }>();
    for (const l of validas) {
      const t = m.get(l.codpro) || { codpro: l.codpro, nome: l.nome, un: l.un, qtd: 0, n: 0, locais: new Map() };
      t.qtd += l.qtd; t.n++; t.locais.set(l.local, (t.locais.get(l.local) || 0) + l.qtd); m.set(l.codpro, t);
    }
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  }, [validas]);
  const b = norm(busca.trim());
  const minhasF = b ? minhas.filter((l) => norm(`${l.nompro} ${l.codpro} ${l.local}`).includes(b)) : minhas;
  const totaisF = b ? totais.filter((t) => norm(`${t.nome} ${t.codpro}`).includes(b)) : totais;
  const n = modo === "leituras" ? minhasF.length : totaisF.length;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-white p-1 shadow-sm">
        {([["leituras", `Leituras (${validas.length})`], ["totais", `Por item (${totais.length})`]] as const).map(([k, t]) => (
          <button key={k} onClick={() => { setModo(k); setLimite(50); }} className={cx("h-10 rounded-lg text-[14px] font-semibold", modo === k ? "bg-ink text-white" : "text-muted")}>{t}</button>
        ))}
      </div>
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-5 text-muted" />
        <input value={busca} onChange={(e) => { setBusca(e.target.value); setLimite(50); }} placeholder="Procurar nas minhas leituras" className="h-11 w-full rounded-xl border border-line bg-white pl-10 pr-3 text-[15px] outline-none focus:border-brand-600" /></div>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-white shadow-sm">
        {modo === "leituras" ? <>
          {rej.map((l) => (
            <li key={l.uid} className="flex items-center gap-3 bg-rose-50 px-4 py-3">
              <span className="w-16 text-right text-lg font-bold tabular text-rose-700">{fq(l.qtd)}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{l.nome}</span><span className="text-[12px] font-semibold text-rose-700">Recusada: {l.erro}</span></span>
              <button onClick={() => descartar(l.uid)} className="rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold">OK</button>
            </li>
          ))}
          {pend.map((l) => (
            <li key={l.uid} className="flex items-center gap-3 px-4 py-3 opacity-60">
              <span className="w-16 text-right text-lg font-bold tabular">{fq(l.qtd)}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{l.nome}</span><span className="text-[12px] text-muted">{l.local || "sem local"} · enviando…</span></span>
            </li>
          ))}
          {minhasF.slice(0, limite).map((l) => (
            <li key={l.uid} className={cx("flex items-center gap-3 px-4 py-3", l.cancelada && "opacity-40")}>
              <span className={cx("w-16 text-right text-lg font-bold tabular", l.cancelada && "line-through")}>{fq(l.qtd)}</span>
              <span className="min-w-0 flex-1"><span className={cx("block truncate text-[14px] font-medium", l.cancelada && "line-through")}>{l.nompro}</span>
                <span className="text-[12px] text-muted">{l.unipro} · {l.local || "sem local"} · {l.lido_em.slice(11, 16)}{l.cancelada ? " · cancelada" : ""}</span></span>
              {!l.cancelada && <button onClick={() => cancelar(l)} className="grid size-10 place-items-center rounded-lg text-rose-600"><Undo2 className="size-5" /></button>}
            </li>
          ))}
        </> : totaisF.slice(0, limite).map((t) => (
          <li key={t.codpro} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold leading-snug">{t.nome}</span><span className="text-[12px] text-muted">Cód. {t.codpro} · {t.n} leitura(s)</span></span>
              <span className="text-right"><span className="block text-xl font-bold tabular">{fq(t.qtd)}</span><span className="text-[12px] text-muted">{t.un}</span></span>
            </div>
            {t.locais.size > 1 && <div className="mt-1.5 flex flex-wrap gap-1.5">{[...t.locais].map(([l, q]) => <span key={l} className="rounded-md bg-slate-100 px-2 py-0.5 text-[12px] tabular"><b>{l || "—"}</b> {fq(q)}</span>)}</div>}
          </li>
        ))}
        {!n && !rej.length && !pend.length && <li className="px-4 py-8 text-center text-[14px] text-muted">{busca ? "Nada encontrado." : "Nenhuma leitura ainda."}</li>}
      </ul>
      {n > limite && <button onClick={() => setLimite(limite + 100)} className="h-12 w-full rounded-xl bg-white text-[14px] font-semibold text-brand-700 shadow-sm">Mostrar mais ({n - limite})</button>}
    </div>
  );
}

// ---------- lista de trabalho: busca, filtros, grupos ----------
const ORD_AUD = [["valor", "Maior valor (R$)"], ["dif", "Maior diferença (qtd)"], ["falta", "Maiores faltas"], ["sobra", "Maiores sobras"], ["nome", "Produto A–Z"], ["cod", "Código"], ["local", "Local / rua"]] as const;
const ORD_CONT = [["nome", "Produto A–Z"], ["cod", "Código"], ["local", "Local / rua"]] as const;
const AGRUPAR = [["", "Sem agrupar"], ["grupo", "Grupo"], ["subgrupo", "Subgrupo"], ["marca", "Marca"], ["local", "Local / rua"]] as const;
const separaLocais = (s: unknown) => String(s || "").split(",").map((x) => x.trim()).filter((x) => x && x !== "0");
type Filtros = { status: string; tipo: string; ord: string; loc: string; grupo: string; agrupar: string };

function ListaItens({ itens, etapa, local, escolher, atualizar }: { itens: Row[] | null; etapa: number; local: string; escolher: (codpro: string) => void; atualizar: () => Promise<void> }) {
  const aud = etapa === 3, chaveF = "lst" + etapa;
  const padrao: Filtros = { status: "pend", tipo: "", ord: aud ? "valor" : "nome", loc: "", grupo: "", agrupar: aud ? "" : "grupo" };
  const [f, setF] = useState<Filtros>(() => ({ ...padrao, ...ls.get<Partial<Filtros>>(chaveF, {}) }));
  const [busca, setBusca] = useState(""), [limite, setLimite] = useState(150), [painel, setPainel] = useState(false), [fechados, setFechados] = useState<Set<string>>(new Set());
  const [girando, setGirando] = useState(false);
  const refBarra = useRef<HTMLDivElement>(null), [altBarra, setAltBarra] = useState(150);
  useEffect(() => {
    const el = refBarra.current; if (!el) return;
    const ro = new ResizeObserver(() => setAltBarra(el.offsetHeight)); ro.observe(el); return () => ro.disconnect();
  }, []);
  const muda = (p: Partial<Filtros>) => { const n = { ...f, ...p }; setF(n); ls.set(chaveF, n); setLimite(150); };
  const todos = itens || [];

  const locais = useMemo(() => [...new Set(todos.flatMap((i) => separaLocais(i.locais)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [todos]);
  const gruposOpc = useMemo(() => [...new Set(todos.map((i) => i.grupo || "Sem grupo"))].sort(), [todos]);
  const nPend = todos.filter((i) => !i.feito).length;
  const lista = useMemo(() => {
    const t = norm(busca.trim()).split(/\s+/).filter(Boolean);
    const l = todos.filter((i) => {
      if (f.status === "pend" && i.feito) return false;
      if (f.status === "feito" && !i.feito) return false;
      if (aud && f.tipo === "falta" && !((i.dif ?? 0) < 0)) return false;
      if (aud && f.tipo === "sobra" && !((i.dif ?? 0) > 0)) return false;
      if (f.loc && !separaLocais(i.locais).includes(f.loc)) return false;
      if (f.grupo && (i.grupo || "Sem grupo") !== f.grupo) return false;
      if (t.length) { const h = norm(`${i.nompro} ${i.codpro} ${i.locais || ""} ${i.grupo} ${i.subgrupo} ${i.marca}`); if (!t.every((w) => h.includes(w))) return false; }
      return true;
    });
    const cmp: Record<string, (a: Row, b: Row) => number> = {
      valor: (a, b) => Math.abs(b.valor ?? 0) - Math.abs(a.valor ?? 0), dif: (a, b) => Math.abs(b.dif ?? 0) - Math.abs(a.dif ?? 0),
      falta: (a, b) => (a.valor ?? 0) - (b.valor ?? 0), sobra: (a, b) => (b.valor ?? 0) - (a.valor ?? 0),
      nome: (a, b) => a.nompro.localeCompare(b.nompro), cod: (a, b) => a.codpro.localeCompare(b.codpro, undefined, { numeric: true }),
      local: (a, b) => (separaLocais(a.locais)[0] || "~").localeCompare(separaLocais(b.locais)[0] || "~", undefined, { numeric: true }),
    };
    return l.sort((a, b) => (cmp[f.ord] || cmp.nome)(a, b) || a.nompro.localeCompare(b.nompro));
  }, [todos, busca, f, aud]);

  // agrupamento (grupo / subgrupo / marca / local), com total por grupo
  const secoes = useMemo(() => {
    if (!f.agrupar) return [{ k: "", itens: lista }];
    const m = new Map<string, Row[]>();
    for (const i of lista) {
      const ks = f.agrupar === "local" ? (separaLocais(i.locais).length ? [separaLocais(i.locais)[0]] : ["Sem local"]) : [i[f.agrupar] || `Sem ${f.agrupar}`];
      for (const k of ks) { if (!m.has(k)) m.set(k, []); m.get(k)!.push(i); }
    }
    const peso = (l: Row[]) => aud ? l.reduce((s, i) => s + Math.abs(i.valor ?? 0), 0) : 0;
    return [...m.entries()].map(([k, it]) => ({ k, itens: it })).sort((a, b) => peso(b.itens) - peso(a.itens) || a.k.localeCompare(b.k, undefined, { numeric: true }));
  }, [lista, f.agrupar, aud]);

  const ativos = [
    f.tipo && { k: "tipo", n: f.tipo === "falta" ? "Só faltas" : "Só sobras" }, f.grupo && { k: "grupo", n: f.grupo }, f.loc && { k: "loc", n: `Local ${f.loc}` },
  ].filter(Boolean) as { k: keyof Filtros; n: string }[];
  const ords = aud ? ORD_AUD : ORD_CONT;
  let mostrados = 0;

  return (
    <div>
      <div ref={refBarra} className="sticky top-0 z-10 space-y-2 border-b border-line bg-slate-100 px-3 pb-2 pt-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 size-5 text-muted" />
            <input value={busca} onChange={(e) => { setBusca(e.target.value); setLimite(150); }} placeholder="Procurar: nome, código, grupo, rua" autoComplete="off"
              className="h-11 w-full rounded-xl border border-line bg-white pl-10 pr-9 text-[15px] outline-none focus:border-brand-600" />
            {busca && <button onClick={() => setBusca("")} className="absolute right-1 top-1 grid size-9 place-items-center text-muted"><X className="size-5" /></button>}
          </div>
          <button onClick={() => setPainel(true)} className={cx("relative grid size-11 shrink-0 place-items-center rounded-xl", ativos.length || f.agrupar ? "bg-ink text-white" : "bg-white ring-1 ring-line")}>
            <SlidersHorizontal className="size-5" />
            {ativos.length > 0 && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-brand-500 text-[11px] font-bold text-white">{ativos.length}</span>}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-white p-1 ring-1 ring-line">
          {([["pend", "A fazer", nPend], ["feito", "Feitos", todos.length - nPend], ["todos", "Todos", todos.length]] as const).map(([k, n, c]) => (
            <button key={k} onClick={() => muda({ status: k })} className={cx("h-9 rounded-lg text-[13px] font-semibold", f.status === k ? "bg-ink text-white" : "text-muted")}>{n} <span className="tabular opacity-70">{c}</span></button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto text-[12px]">
          <button onClick={() => setPainel(true)} className="shrink-0 rounded-full bg-white px-2.5 py-1 font-medium text-ink ring-1 ring-line">↕ {ords.find(([k]) => k === f.ord)?.[1]}</button>
          {f.agrupar && <button onClick={() => muda({ agrupar: "" })} className="flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 font-medium ring-1 ring-line">Por {AGRUPAR.find(([k]) => k === f.agrupar)?.[1].toLowerCase()} <X className="size-3" /></button>}
          {ativos.map((a) => <button key={a.k} onClick={() => muda({ [a.k]: "" })} className="flex shrink-0 items-center gap-1 rounded-full bg-brand-700 px-2.5 py-1 font-medium text-white">{a.n} <X className="size-3" /></button>)}
          <span className="ml-auto shrink-0 tabular text-muted">{lista.length}{lista.length !== todos.length ? ` de ${todos.length}` : ""}</span>
          <button onClick={async () => { setGirando(true); await atualizar(); setGirando(false); }} className="grid size-7 shrink-0 place-items-center rounded-full bg-white ring-1 ring-line"><RefreshCw className={cx("size-3.5", girando && "animate-spin")} /></button>
        </div>
      </div>

      {itens === null ? <div className="px-4 py-10 text-center text-[14px] text-muted">Carregando lista…</div>
        : !lista.length ? <div className="px-4 py-10 text-center text-[14px] text-muted">{todos.length ? (f.status === "pend" && !nPend ? "Tudo feito por aqui." : "Nenhum item com esses filtros.") : "Lista vazia."}</div>
        : (
        <div className="pb-2">
          {secoes.map((s) => {
            if (mostrados >= limite) return null;
            const aberto = !fechados.has(s.k), pendS = s.itens.filter((i) => !i.feito).length, valS = aud ? s.itens.reduce((a, i) => a + (i.valor ?? 0), 0) : 0;
            const vis = aberto ? s.itens.slice(0, Math.max(0, limite - mostrados)) : [];
            mostrados += aberto ? vis.length : 1;
            return (
              <section key={s.k || "_"}>
                {f.agrupar && (
                  <button onClick={() => setFechados((x) => { const n = new Set(x); if (n.has(s.k)) n.delete(s.k); else n.add(s.k); return n; })}
                    style={{ top: altBarra }} className="sticky z-[5] flex w-full items-center gap-2 border-b border-line bg-slate-200 px-3 py-2 text-left">
                    {aberto ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold uppercase tracking-wide">{s.k}</span>
                    <span className="shrink-0 text-[12px] font-semibold tabular text-muted">{pendS ? `${pendS} a fazer` : "✓"} · {s.itens.length}</span>
                    {aud && <span className={cx("shrink-0 text-[12px] font-bold tabular", valS < 0 ? "text-rose-700" : "text-brand-700")}>{frs(valS)}</span>}
                  </button>
                )}
                <ul className="divide-y divide-line bg-white">
                  {vis.map((i) => <LinhaItem key={i.codpro} i={i} aud={aud} local={local} escolher={escolher} />)}
                </ul>
              </section>
            );
          })}
          {lista.length > limite && <button onClick={() => setLimite(limite + 200)} className="h-12 w-full border-t border-line bg-white text-[14px] font-semibold text-brand-700">Mostrar mais</button>}
        </div>
      )}

      {painel && (
        <Folha titulo="Filtros e ordem" fechar={() => setPainel(false)}
          rodape={<div className="flex gap-2">
            <button onClick={() => { setF(padrao); ls.set(chaveF, padrao); }} className="h-12 flex-1 rounded-xl bg-slate-100 text-[15px] font-semibold">Limpar</button>
            <button onClick={() => setPainel(false)} className="h-12 flex-[2] rounded-xl bg-brand-600 text-[15px] font-bold text-white">Ver {lista.length} itens</button>
          </div>}>
          <Bloco titulo="Ordenar por">
            <div className="grid grid-cols-2 gap-2">{ords.map(([k, n]) => <Opcao key={k} ativo={f.ord === k} onClick={() => muda({ ord: k })}>{n}</Opcao>)}</div>
          </Bloco>
          <Bloco titulo="Agrupar por">
            <div className="grid grid-cols-3 gap-2">{AGRUPAR.map(([k, n]) => <Opcao key={k} ativo={f.agrupar === k} onClick={() => muda({ agrupar: k })}>{n}</Opcao>)}</div>
          </Bloco>
          {aud && (
            <Bloco titulo="Diferença">
              <div className="grid grid-cols-3 gap-2">{([["", "Todas"], ["falta", "Faltas"], ["sobra", "Sobras"]] as const).map(([k, n]) => <Opcao key={k} ativo={f.tipo === k} onClick={() => muda({ tipo: k })}>{n}</Opcao>)}</div>
            </Bloco>
          )}
          <Bloco titulo="Grupo">
            <select value={f.grupo} onChange={(e) => muda({ grupo: e.target.value })} className="h-12 w-full rounded-xl border border-line bg-white px-3 text-[15px] font-medium">
              <option value="">Todos os grupos</option>{gruposOpc.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Bloco>
          {locais.length > 0 && (
            <Bloco titulo="Local / rua">
              <select value={locais.includes(f.loc) ? f.loc : ""} onChange={(e) => muda({ loc: e.target.value })} className="h-12 w-full rounded-xl border border-line bg-white px-3 text-[15px] font-medium">
                <option value="">Todos os locais</option>{locais.map((x) => <option key={x} value={x}>{x === local ? `${x} (meu local)` : x}</option>)}
              </select>
            </Bloco>
          )}
        </Folha>
      )}
    </div>
  );
}
const Bloco = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
  <div className="mt-4 first:mt-1"><div className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">{titulo}</div>{children}</div>
);
const Opcao = ({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} className={cx("min-h-11 rounded-xl px-2 py-2 text-[14px] font-semibold leading-tight", ativo ? "bg-ink text-white" : "bg-white text-ink ring-1 ring-line")}>{children}</button>
);

function LinhaItem({ i, aud, local, escolher }: { i: Row; aud: boolean; local: string; escolher: (c: string) => void }) {
  const locs = separaLocais(i.locais);
  return (
    <li>
      <button onClick={() => escolher(i.codpro)} className={cx("flex w-full items-center gap-3 px-3 py-3 text-left active:bg-brand-50", i.feito && "bg-slate-50")}>
        <span className={cx("grid size-7 shrink-0 place-items-center rounded-full", i.feito ? "bg-brand-600 text-white" : "border-2 border-slate-300")}>{i.feito && <Check className="size-4" strokeWidth={3} />}</span>
        <span className="min-w-0 flex-1">
          <span className={cx("line-clamp-2 text-[14px] font-semibold leading-snug", i.feito && "text-slate-500")}>{i.nompro}</span>
          <span className="block truncate text-[12px] text-muted">Cód. {i.codpro} · {i.unipro}{locs.length ? <> · <MapPin className={cx("-mt-0.5 inline size-3", locs.includes(local) && "text-brand-700")} /> {locs.join(", ")}</> : null}</span>
          {aud && <span className="mt-0.5 block text-[12px] tabular-nums text-muted">Sist. <b className="text-ink">{fq(i.saldo)}</b> · Cont. <b className="text-ink">{fq(i.c1)}</b> · Rec. <b className="text-ink">{fq(i.c2)}</b>{i.final != null && <> · Final <b className="text-brand-700">{fq(i.final)}</b></>}</span>}
        </span>
        {aud ? (
          i.dif == null ? <span className="shrink-0 text-[12px] text-muted">sem contagem</span> : (
          <span className={cx("shrink-0 rounded-lg px-2 py-1 text-right tabular-nums", i.dif < 0 ? "bg-rose-50 text-rose-700" : "bg-brand-50 text-brand-700")}>
            <span className="block text-[16px] font-bold leading-tight">{i.dif > 0 ? "+" : ""}{fq(i.dif)}</span>
            <span className="block text-[11px] font-semibold opacity-75">{frs(i.valor)}</span>
          </span>)
        ) : <ChevronRight className="size-5 shrink-0 text-slate-300" />}
      </button>
    </li>
  );
}
