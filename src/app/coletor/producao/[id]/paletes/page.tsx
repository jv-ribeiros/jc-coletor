"use client";
// Coletor › Produção › Folhas dos paletes. Desenho aprovado: design/pages/folha-palete_v4.html (opção A).
// Meia A4 por palete (duas por página, com linha de corte), para ler de longe no aéreo: PRODUTO em cima, VALIDADE | QUANTIDADE
// embaixo, e mais nada. Divide pela montagem do cadastro (Coletor › Cadastro › Palete: camadas × caixas por camada):
// N folhas cheias + a da sobra, todas iguais (só muda a quantidade).
// Validade: a da última impressão desta produção; senão a do lote no Lieto; sempre alterável. Sem validade (e sem marcar
// "Produto sem validade") não imprime: folha sem validade no aéreo é o erro que a folha existe para evitar.
// Quem imprime é o coletor (impressora do Android); a gestão abre esta mesma tela pelo detalhe da produção.
import { useParams, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, CircleAlert, LoaderCircle, Printer } from "lucide-react";
import { cx, useToast } from "@/components/ui";
import { api, fdata, fq, type Row } from "@/lib/client";
import { fontePalete } from "@/lib/fonte-palete";
import { dividir, mascaraValidade, validadeIso, validadeTexto, validadeVencida } from "@/lib/paletes";

const LIMITE = 200;
const so = (s: string) => s.replace(/\D/g, "").slice(0, 6);
const hoje = () => new Date().toLocaleDateString("sv-SE");

// tamanho das letras de cada folha, em pt: o nome e, por quantidade, data e quantidade (as duas com o mesmo tamanho)
type Tam = { nm: number; vl: Record<string, number> };

export default function FolhasPaletes() {
  const { id } = useParams<{ id: string }>(), router = useRouter(), toast = useToast();
  const [d, setD] = useState<Row | null>(null), [erro, setErro] = useState("");
  const [por, setPor] = useState(""), [cam, setCam] = useState(""), [cx_, setCx] = useState(""), [salvar, setSalvar] = useState(true), [comSobra, setComSobra] = useState(true), [oc, setOc] = useState(false);
  const [val, setVal] = useState(""), [semVal, setSemVal] = useState(false);

  useEffect(() => {
    api(`producao/${id}/paletes`).then((r) => {
      setD(r);
      if (r.palete) setPor(String(r.palete.camadas * r.palete.caixas));
      const v = r.validade || r.validade_lote;
      if (v === "sem") setSemVal(true); else if (v) setVal(validadeTexto(v));
    }).catch((e) => setErro((e as Error).message));
  }, [id]);

  const cad = d?.palete as { camadas: number; caixas: number } | null | undefined;
  // com cadastro: "por palete" editável só nesta impressão. Sem: camadas × caixas digitados aqui.
  const porPalete = cad ? Number(por) : Number(cam) * Number(cx_);
  const div = d ? dividir(Number(d.qtd), porPalete) : null;
  const folhas = div ? div.folhas.filter((f) => comSobra || !f.sobra || !div.cheios) : [];
  const demais = !!div && div.cheios > LIMITE;
  const mudouPor = !!cad && porPalete !== cad.camadas * cad.caixas;

  const iso = semVal ? "sem" : validadeIso(val);
  const textoVal = semVal ? "" : iso ? validadeTexto(iso) : "—";
  const falta = !d ? "" : !folhas.length ? (cad ? "Informe quantos vão por palete" : "Informe a montagem do palete")
    : demais ? `Mais de ${LIMITE} folhas: confira o “por palete”` : !iso ? (val ? "Validade incompleta" : "Informe a validade para imprimir") : "";
  // as folhas diferentes entre si (a cheia e a da sobra): a prévia e a medida das letras usam uma de cada
  const tipos = [...new Map(folhas.map((f) => [f.qtd, { qtd: f.qtd, n: folhas.filter((g) => g.qtd === f.qtd).length }])).values()];
  const { ref: medida, tam } = useTamanhos(`${d?.nompro}|${d?.unipro}|${textoVal}|${tipos.map((t) => t.qtd).join(",")}`);

  function voltar() { if (window.history.length > 1) router.back(); else router.push("/coletor/producao"); }
  async function imprimir() {
    if (!d || falta || !iso) return;
    setOc(true);
    try {
      if (!cad && salvar) {
        try { await api(`cadastro/${encodeURIComponent(d.codpro)}/palete`, { camadas: Number(cam), caixas: Number(cx_) }); setD((x) => x && { ...x, palete: { camadas: Number(cam), caixas: Number(cx_) } }); setPor(String(Number(cam) * Number(cx_))); toast("Montagem salva no cadastro."); }
        catch (e) { toast(`Não salvou no cadastro: ${(e as Error).message} As folhas saem do mesmo jeito.`, "erro"); }
      }
      // guarda a validade na produção (a reimpressão já vem com ela) e registra a impressão no histórico
      try { await api(`producao/${id}/paletes`, { validade: iso, folhas: folhas.length }); setD((x) => x && { ...x, validade: iso }); }
      catch (e) { toast(`Não guardou a validade: ${(e as Error).message} As folhas saem do mesmo jeito.`, "erro"); }
    } finally { setOc(false); }
    // dá tempo de o React desenhar as folhas antes de abrir a impressão
    setTimeout(() => window.print(), 50);
  }

  // dica embaixo do campo: de onde veio a validade, ou o que falta
  const dicaVal: [string, boolean] = semVal ? ["A folha sai sem a validade; a quantidade ocupa a parte de baixo.", false]
    : val && !iso ? ["Validade incompleta. Use dia/mês/ano ou mês/ano (03/2028).", true]
    : iso && validadeVencida(iso, hoje()) ? ["Esta validade já passou. Confira antes de imprimir.", true]
    : iso && iso === d?.validade ? ["Usada na última impressão desta produção. Pode alterar.", false]
    : iso && iso === d?.validade_lote ? [`Do lote ${d?.lote} no Lieto. Pode alterar.`, false]
    : iso ? ["Fica guardada nesta produção para a próxima impressão.", false]
    : d?.lote ? [`O lote ${d.lote} não tem validade no Lieto. Digite a validade (dia/mês/ano ou mês/ano).`, true]
    : ["A produção não tem lote com validade. Digite a validade (dia/mês/ano ou mês/ano).", true];

  const folha = (qtd: number, t?: Tam | null) => d && <MeiaFolha nome={String(d.nompro || d.codpro)} unidade={String(d.unipro || "")} qtd={qtd} validade={textoVal} tam={t} />;

  return (
    <>
      {/* a impressão usa A4 sem margem só nesta tela (as outras impressões continuam com a margem padrão) */}
      <style>{"@media print { @page { size: A4 portrait; margin: 0; } }"}</style>
      <div className="tela no-print">
        <header className="cabec">
          <button onClick={voltar} className="ic" aria-label="Voltar"><ArrowLeft /></button>
          <div><b>Folhas dos paletes</b><small>{d ? `${d.codpro} · ${d.nompro}` : "Carregando…"}</small></div>
        </header>
        <main className="corpo">
          {erro && <div className="flex items-start gap-2 rounded-3xl bg-rose-100 px-4 py-4 text-[16px] text-rose-800"><CircleAlert className="mt-0.5 size-5 shrink-0" />{erro}</div>}
          {!d && !erro && <LoaderCircle className="mx-auto mt-8 size-7 animate-spin text-muted" />}
          {d && <>
            {/* a conta fica à vista antes de imprimir: quem aponta confere se 3 + 40 é o que está no chão */}
            <div className={cx("rounded-3xl px-4 py-4", div?.folhas.length ? "bg-brand-700 text-white" : "bg-white")}>
              <div className="text-[19px] font-bold leading-tight">{fq(d.qtd)} {d.unipro}{div?.folhas.length ? ` = ${div.cheios ? `${div.cheios} ${div.cheios === 1 ? "palete" : "paletes"} de ${fq(porPalete)}` : "palete incompleto"}${div.cheios && div.sobra ? ` + ${fq(div.sobra)}` : ""}` : ""}</div>
              <div className="mt-1 text-[14px] opacity-90">{d.numide ? `Produção nº ${d.numide}` : `Apontamento nº ${d.id}, ainda não lançado no Lieto`} · {fdata(d.data)} · {d.lote ? `lote ${d.lote}` : "sem lote"}</div>
            </div>

            {/* validade primeiro: é o que mais importa na folha e o Lieto quase nunca tem */}
            <label className="block"><span className="mb-1 block text-[14px] font-semibold text-muted">Validade</span>
              <input inputMode="numeric" autoComplete="off" placeholder="dd/mm/aaaa" disabled={semVal} value={semVal ? "" : val} onChange={(e) => setVal(mascaraValidade(e.target.value))}
                className={cx("w-full bg-white text-center text-[26px] font-bold tabular disabled:opacity-50", !semVal && !iso && "ring-2 ring-brand-700")} /></label>
            <p className={cx("px-1 text-[14px]", dicaVal[1] ? "text-amber-800" : "text-muted")}>{dicaVal[0]}</p>
            <label className="flex min-h-[60px] items-center gap-3 rounded-3xl bg-white px-4 text-[16px]"><input type="checkbox" className="size-6" checked={semVal} onChange={(e) => setSemVal(e.target.checked)} />Produto sem validade</label>

            {cad ? <>
              <label className="block"><span className="mb-1 block text-[14px] font-semibold text-muted">Por palete ({d.unipro})</span>
                <input inputMode="numeric" value={por} onChange={(e) => setPor(so(e.target.value))} className="w-full bg-white text-center text-[26px] font-bold tabular" /></label>
              <p className="px-1 text-[14px] text-muted">Cadastro: {cad.camadas} camadas × {cad.caixas} = {cad.camadas * cad.caixas} {d.unipro}.{mudouPor ? " Mudado só para esta impressão; o cadastro continua igual." : " Mudar aqui vale só para esta impressão."}</p>
            </> : <>
              {/* sem montagem: pede ali mesmo, em vez de mandar para o Cadastro e voltar */}
              <div className="rounded-3xl bg-amber-100 px-4 py-4 text-[15px] text-amber-900"><b>Este produto não tem a montagem do palete cadastrada.</b> Informe as camadas e quantos {d.unipro} vão em cada camada.</div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="mb-1 block text-[14px] font-semibold text-muted">Camadas</span><input inputMode="numeric" value={cam} onChange={(e) => setCam(so(e.target.value))} className="w-full bg-white text-center text-[22px] font-bold tabular" /></label>
                <label className="block"><span className="mb-1 block text-[14px] font-semibold text-muted">{d.unipro} por camada</span><input inputMode="numeric" value={cx_} onChange={(e) => setCx(so(e.target.value))} className="w-full bg-white text-center text-[22px] font-bold tabular" /></label>
              </div>
              <label className="flex min-h-[60px] items-center gap-3 rounded-3xl bg-white px-4 text-[16px]"><input type="checkbox" className="size-6" checked={salvar} onChange={(e) => setSalvar(e.target.checked)} />Salvar no cadastro do produto</label>
            </>}

            {div && div.sobra > 0 && div.cheios > 0 && <label className="flex min-h-[60px] items-center gap-3 rounded-3xl bg-white px-4 text-[16px]"><input type="checkbox" className="size-6" checked={comSobra} onChange={(e) => setComSobra(e.target.checked)} />Imprimir a folha dos {fq(div.sobra)} {d.unipro} que sobram</label>}
            {demais && <div className="rounded-3xl bg-rose-100 px-4 py-4 text-[15px] text-rose-800">Dá mais de {LIMITE} folhas. Confira o “por palete”.</div>}

            {!demais && tipos.map((t) => (
              <div key={t.qtd}>
                <div className="mb-1 px-1 text-[13px] font-semibold text-muted">{t.n} {t.n === 1 ? "folha" : "folhas"} de {fq(t.qtd)} {d.unipro}</div>
                <Previa>{folha(t.qtd, tam)}</Previa>
              </div>
            ))}
          </>}
        </main>
        {d && (
          <div className="rodape">
            <button onClick={imprimir} disabled={!!falta || oc} className="bt1 flex items-center justify-center gap-2">
              {oc ? <LoaderCircle className="size-6 animate-spin" /> : falta || <><Printer className="size-6" />Imprimir {folhas.length} {folhas.length === 1 ? "folha" : "folhas"}</>}
            </button>
          </div>
        )}
      </div>

      {/* medida das letras: uma folha de cada tipo, em tamanho real, fora da tela */}
      {d && !demais && <div ref={medida} className={cx("fpal fpal-medida", fontePalete.variable)} aria-hidden>{tipos.map((t) => <div key={t.qtd}>{folha(t.qtd)}</div>)}</div>}

      {/* papel: A4 em pé, duas meias folhas de 210 × 148,5 mm. Só aparece na impressão. */}
      {d && !demais && !falta && (
        <div className={cx("fpal fpal-papel", fontePalete.variable)}>
          {Array.from({ length: Math.ceil(folhas.length / 2) }, (_, k) => (
            <div key={k} className="a4">{folhas.slice(2 * k, 2 * k + 2).map((f) => <div key={f.sobra ? "s" : f.n}>{folha(f.qtd, tam)}</div>)}</div>
          ))}
        </div>
      )}
    </>
  );
}

// Cada texto cresce até encher a célula: o nome até 60 pt (nome curto não vira letreiro), data e quantidade até 100 pt, numa
// linha só e com o mesmo tamanho. Mede nas folhas fora da tela, depois de a fonte carregar (senão mede a fonte reserva).
function useTamanhos(chave: string) {
  const ref = useRef<HTMLDivElement>(null), [tam, setTam] = useState<Tam | null>(null), [fonte, setFonte] = useState(false);
  useEffect(() => {
    const f = fontePalete.style.fontFamily;
    Promise.all([document.fonts.load(`700 40pt ${f}`), document.fonts.load(`400 10pt ${f}`)]).catch(() => {}).finally(() => setFonte(true));
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !fonte) return;
    const vl: Record<string, number> = {};
    for (const fo of el.querySelectorAll<HTMLElement>(".fo")) vl[fo.dataset.q!] = Math.min(...[...fo.querySelectorAll<HTMLElement>(".valor")].map((v) => caber(v, 100, true)));
    const nm = el.querySelector<HTMLElement>(".nm");
    setTam({ nm: nm ? caber(nm, 60, false) : 60, vl });
  }, [chave, fonte]);
  return { ref, tam };
}

// maior tamanho (pt) que cabe. Linha única mede só a largura: com altura de linha < 1, o navegador conta a parte de baixo da
// letra como transbordo e a medida de altura mentiria (o teto de 100 pt já cabe na altura da célula).
function caber(el: HTMLElement, max: number, linha: boolean) {
  const passa = (pt: number) => { el.style.fontSize = `${pt}pt`; return el.scrollWidth > el.clientWidth + 1 || (!linha && el.scrollHeight > el.clientHeight + 1); };
  if (!passa(max)) return max;
  let ok = 12, ruim = max;
  while (ruim - ok > 1) { const m = (ok + ruim) >> 1; if (passa(m)) ruim = m; else ok = m; }
  el.style.fontSize = `${ok}pt`;
  return ok;
}

// prévia na tela: a meia folha em tamanho real, reduzida para a largura do aparelho
function Previa({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null), [s, setS] = useState(0.42);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setS(el.clientWidth / 793.7)); // 210 mm a 96 dpi
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return <div ref={ref} className={cx("fpal overflow-hidden rounded-2xl bg-white shadow-[0_1px_0_var(--color-line)]", fontePalete.variable)} style={{ height: 561.3 * s }}><div style={{ transform: `scale(${s})`, transformOrigin: "0 0", width: "210mm" }}>{children}</div></div>;
}

// A folha (desenho: design/pages/folha-palete_v4.html). Sem validade ("Produto sem validade"), a quantidade ocupa o andar de baixo.
function MeiaFolha({ nome, unidade, qtd, validade, tam }: { nome: string; unidade: string; qtd: number; validade: string; tam?: Tam | null }) {
  const pt = (n?: number) => (tam && n ? { fontSize: `${n}pt` } : undefined), vl = pt(tam?.vl[String(qtd)]);
  return (
    <div className={cx("fo", !validade && "sv")} data-q={qtd}>
      <div className="g">
        <div className="pr"><span className="lb">Produto</span><div className="nm" style={pt(tam?.nm)}>{nome}</div></div>
        <div className="bx">
          {validade && <div className="va"><span className="lb">Validade</span><div className="valor" style={vl}><span>{validade}</span></div></div>}
          <div className="qt"><span className="lb">Quantidade</span><div className="valor" style={vl}><span>{fq(qtd)}<small>{unidade}</small></span></div></div>
        </div>
      </div>
    </div>
  );
}
