"use client";
// Coletor › Cadastro, em abas: Dados · Barras · Receita · Palete. Sem produto aberto, tudo aparece indisponível.
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, useConfirm, useToast } from "@/components/ui";
import { BuscaProduto, Rot, numero, useProdutos } from "@/components/movimentos";
import { Observacao } from "@/components/observacao";
import { Campo, Tela, campoCol } from "@/components/coletor";
import { usePode } from "@/components/topo";
import { api, fq, type Row } from "@/lib/client";

const NOMES: [string, string, "text" | "decimal"][] = [["nompro", "Descrição", "text"], ["caixa", "Qtd por caixa", "decimal"], ["pesbru", "Peso bruto (kg)", "decimal"], ["pesliq", "Peso líquido (kg)", "decimal"], ["locpro", "Local", "text"], ["obspro", "Observação", "text"]];

export default function Pagina() {
  const [b, setB] = useState(""), [l, setL] = useState<Row[]>([]), [p, setP] = useState<Row | null>(null), [aba, setAba] = useState("dados"); const toast = useToast(), ref = useRef<HTMLInputElement>(null);
  const abrir = async (c: string) => { try { setP(await api(`cadastro/${encodeURIComponent(c)}`)); setB(""); setL([]); } catch (e) { toast((e as Error).message, "erro"); } };
  async function buscar(e: React.FormEvent) {
    e.preventDefault(); if (!b.trim()) return;
    try { const r = await api<Row[]>(`cadastro?q=${encodeURIComponent(b)}`); if (r.length === 1) abrir(r[0].codpro); else { setL(r); if (!r.length) toast("Nada encontrado.", "erro"); } } catch (x) { toast((x as Error).message, "erro"); }
  }
  return (
    <Tela titulo="Cadastro" sub={p ? `${p.codpro} · ${p.valores.nompro}` : "Nenhum produto aberto"} abas={[{ k: "dados", n: "Dados" }, { k: "barras", n: "Barras" }, { k: "receita", n: "Receita" }, { k: "palete", n: "Palete" }]} aba={aba} mudar={setAba}>
      <form onSubmit={buscar} className="flex gap-2"><input ref={ref} autoFocus className={campoCol} placeholder="Leia o código ou digite o nome" value={b} onChange={(e) => setB(e.target.value)} /><Button size="lg" disabled={!b.trim()}>Buscar</Button></form>
      {l.length > 0 && <div className="border border-line bg-white">{l.map((x) => <button key={x.codpro} onClick={() => abrir(x.codpro)} className="block w-full border-b border-line p-3 text-left text-sm last:border-0"><b>{x.nompro}</b><span className="block text-muted">{x.codpro}</span></button>)}</div>}
      <div className={aba === "dados" ? "" : "hidden"}><Dados key={p?.codpro || "-"} p={p} mudou={setP} /></div>
      <div className={aba === "barras" ? "" : "hidden"}><Barras key={p?.codpro || "-"} p={p} mudou={setP} /></div>
      <div className={aba === "receita" ? "" : "hidden"}><Receita key={p?.codpro || "-"} p={p} /></div>
      <div className={aba === "palete" ? "" : "hidden"}><Palete key={p?.codpro || "-"} p={p} mudou={setP} /></div>
    </Tela>
  );
}
type Props = { p: Row | null; mudou: (p: Row) => void };
function useEnviar(p: Row | null, mudou: (p: Row) => void) {
  const [oc, setOc] = useState(false), toast = useToast();
  const enviar = async (url: string, body: Row, ok: string) => { setOc(true); try { const r = await api(`cadastro/${encodeURIComponent(p!.codpro)}${url}`, body); mudou(r); toast(ok); return r; } catch (e) { toast((e as Error).message, "erro"); return null; } finally { setOc(false); } };
  return { oc, enviar };
}

function Dados({ p, mudou }: Props) {
  const [v, setV] = useState<Row>(p?.valores || {}), { oc, enviar } = useEnviar(p, mudou);
  const mudados = p ? NOMES.filter(([k]) => String(v[k]).trim() !== String(p.valores[k])).map(([k]) => k) : [];
  return (
    <div className="space-y-3">
      {NOMES.map(([k, n, m]) => <Campo key={k} nome={n}><input className={campoCol + (m === "text" ? " uppercase" : "")} disabled={!p} inputMode={m} maxLength={k === "nompro" ? 50 : k === "obspro" ? 100 : 20} value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Campo>)}
      <Button size="lg" variant="secondary" className="w-full" disabled={!p || !p.loteco || Number(v.caixa) === p.loteco} onClick={() => setV({ ...v, caixa: p!.loteco })}>Usar LOTECO como caixa{p?.loteco ? ` (${p.loteco})` : ""}</Button>
      <Campo nome="Unidade"><input className={campoCol} disabled value={p?.unipro || ""} readOnly /></Campo>
      <Campo nome="Embalagem de compra (só no Lieto)"><input className={campoCol} disabled value={p ? `${p.qntemb || "—"} ${p.unicom}` : ""} readOnly /></Campo>
      <Button size="lg" className="w-full" loading={oc} disabled={!mudados.length} onClick={async () => { const r = await enviar("", { antes: p!.valores, depois: Object.fromEntries(mudados.map((k) => [k, v[k]])) }, "Cadastro alterado."); if (r) setV(r.valores); }}>Salvar dados</Button>
    </div>
  );
}

function Barras({ p, mudou }: Props) {
  const [cod, setCod] = useState(""), [tipo, setTipo] = useState("1"), [n, setN] = useState(""), [ed, setEd] = useState<Row | null>(null), { oc, enviar } = useEnviar(p, mudou), { confirmar, dialogo } = useConfirm();
  const limpar = () => { setCod(""); setTipo("1"); setN(""); setEd(null); };
  const editar = (x: Row) => { setEd(x); setCod(x.codbar); setTipo(x.qtd > 1 ? x.muldiv : "1"); setN(x.qtd > 1 ? String(x.qtd).replace(".", ",") : ""); };
  const un = p?.unipro || "un", q = numero(n), ok = !!p && !!cod.trim() && (tipo === "1" || q > 1);
  async function salvar(e: React.FormEvent) { e.preventDefault(); if (!ok) return; const m = { muldiv: tipo === "D" ? "D" : "M", qtd: tipo === "1" ? 1 : q }; if (await enviar(ed ? "/barras/alterar" : "/barras", ed ? { numide: ed.numide, ...m } : { codbar: cod, ...m }, ed ? "Multiplicador alterado." : "Código incluído.")) limpar(); }
  return (
    <div className="space-y-3">
      <Campo nome="Principal (não altera aqui)"><input className={campoCol} disabled readOnly value={p?.principal || ""} /></Campo>
      <form onSubmit={salvar} className="space-y-3">
        <Campo nome={ed ? "Código (alterando)" : "Novo código adicional"}><input className={campoCol} disabled={!p || !!ed} value={cod} onChange={(e) => setCod(e.target.value)} /></Campo>
        <Campo nome="1 leitura deste código vale"><select className={campoCol} disabled={!p} value={tipo} onChange={(e) => { setTipo(e.target.value); if (e.target.value === "M" && !n && p?.valores.caixa > 1) setN(String(p?.valores.caixa)); }}><option value="1">1 {un}</option><option value="M">Várias {un}: caixa, fardo (multiplica)</option><option value="D">Parte de 1 {un} (divide)</option></select></Campo>
        <Campo nome={tipo === "D" ? `Quantos destes formam 1 ${un}` : `Quantas ${un} tem nele`}><input className={campoCol} inputMode="decimal" disabled={!p || tipo === "1"} value={tipo === "1" ? "" : n} onChange={(e) => setN(e.target.value)} /></Campo>
        <div className="min-h-9 border border-line bg-white p-2 text-[13px] text-muted">{ok ? (tipo === "1" ? `1 leitura = 1 ${un}` : tipo === "M" ? `1 leitura = ${fq(q)} ${un}` : `${fq(q)} leituras = 1 ${un}`) : "—"}</div>
        <div className="grid grid-cols-2 gap-2"><Button size="lg" loading={oc} disabled={!ok}>{ed ? "Salvar" : "Incluir"}</Button><Button type="button" size="lg" variant="secondary" disabled={!cod && !ed} onClick={limpar}>Limpar</Button></div>
      </form>
      <div className="border border-line bg-white">{!p?.barras.length && <p className="p-3 text-sm text-muted">Nenhum código adicional.</p>}{p?.barras.map((x: Row) => <div key={x.numide} className={"flex items-center justify-between gap-2 border-b border-line p-3 text-sm last:border-0 " + (ed?.numide === x.numide ? "bg-brand-50" : "")}><span className="tabular">{x.codbar}<span className="block text-[12px] text-muted">{x.qtd > 1 ? (x.muldiv === "D" ? `${fq(x.qtd)} leituras = 1 ${un}` : `1 leitura = ${fq(x.qtd)} ${un}`) : `1 leitura = 1 ${un}`}</span></span><span className="flex"><button className="px-3 py-2 underline" onClick={() => editar(x)}>Alterar</button><button className="px-3 py-2 text-rose-700" onClick={async () => { if (await confirmar({ titulo: "Remover código?", texto: x.codbar, perigo: true })) { limpar(); enviar("/barras/remover", { numide: x.numide }, "Código removido."); } }}>Remover</button></span></div>)}</div>
      {dialogo}
    </div>
  );
}

function Receita({ p }: { p: Row | null }) {
  const lista = useProdutos(), toast = useToast(), pode = usePode()(["receita"]), { confirmar, dialogo } = useConfirm();
  const [its, setIts] = useState<Row[]>([]), [ed, setEd] = useState<Row | null>(null), [ins, setIns] = useState<Row | null>(null), [modo, setModo] = useState("CON"), [q, setQ] = useState(""), [r, setR] = useState(""), [obs, setObs] = useState(""), [notas, setNotas] = useState<Row[]>([]), [oc, setOc] = useState(false);
  const ler = useCallback(() => { if (p) api<Row[]>(`receita/${encodeURIComponent(p.codpro)}`).then(setIts).catch((e) => toast(e.message, "erro")); if (p) api<Row[]>(`receita/${encodeURIComponent(p.codpro)}/obs`).then(setNotas).catch(() => {}); }, [p, toast]);
  useEffect(() => { ler(); }, [ler]);
  const limpar = () => { setEd(null); setIns(null); setQ(""); setR(""); setModo("CON"); setObs(""); };
  const editar = (i: Row) => { setEd(i); setIns({ codpro: i.codcon, nompro: i.nompro, unipro: i.unipro }); setModo(i.qntven > 0 ? "VEN" : "CON"); setQ(String(i.qntcon).replace(".", ",")); setR(i.qntven > 0 ? String(i.qntven).replace(".", ",") : ""); };
  async function salvar() { setOc(true); try { setIts(await api<Row[]>(`receita/${encodeURIComponent(p!.codpro)}`, { obs, codcon: ins!.codpro, qntcon: numero(q), qntven: modo === "VEN" ? numero(r) : 0, antes: ed ? { qntcon: ed.qntcon, qntven: ed.qntven } : null })); toast("Receita salva."); limpar(); ler(); } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); } }
  async function remover() { if (!ed || !(await confirmar({ titulo: "Remover da receita?", texto: ed.nompro, perigo: true }))) return; setOc(true); try { setIts(await api<Row[]>(`receita/${encodeURIComponent(p!.codpro)}/remover`, { codcon: ed.codcon, obs })); limpar(); ler(); } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); } }
  const off = !p || !pode, custo = its.reduce((s, i) => s + (i.baixa ? (i.qntven > 0 ? (i.custo * i.qntcon) / i.qntven : i.custo * i.qntcon) : 0), 0);
  return (
    <div className="space-y-3">
      {!pode && <p className="border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Sem liberação para alterar receita: só consulta.</p>}
      <div className="border border-line bg-white">{!its.length && <p className="p-3 text-sm text-muted">{p ? "Produto sem receita." : "Abra um produto."}</p>}{its.map((i) => <button key={i.codcon} disabled={off} onClick={() => editar(i)} className={"block w-full border-b border-line p-3 text-left text-sm last:border-0 " + (ed?.codcon === i.codcon ? "bg-brand-50" : "")}><b>{i.nompro}</b><span className="block text-muted">{i.codcon} · {i.qntven > 0 ? `${fq(i.qntcon)} ${i.unipro} rende ${fq(i.qntven)} ${p?.unipro}` : `${fq(i.qntcon)} ${i.unipro} por ${p?.unipro}`}{i.baixa ? "" : " · não baixa estoque"}</span></button>)}</div>
      <div className="text-right text-sm text-muted">Custo por {p?.unipro || "unidade"}: <b className="text-ink">{custo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</b></div>
      <div><Rot n={ed ? "Insumo (alterando)" : "Insumo"} />{ins ? <div className="flex min-h-12 items-center justify-between gap-2 border border-line bg-white px-3 text-sm"><b>{ins.nompro}</b><button type="button" className="underline" onClick={limpar}>{ed ? "Cancelar" : "Trocar"}</button></div> : <BuscaProduto lista={lista} escolher={setIns} off={off} />}</div>
      <Campo nome="Como consome"><select className={campoCol} disabled={off || !ins} value={modo} onChange={(e) => setModo(e.target.value)}><option value="CON">Quantidade por unidade produzida</option><option value="VEN">Rende várias unidades (ex.: 1 CX = 12 UN)</option></select></Campo>
      <div className="grid grid-cols-2 gap-2"><Campo nome={`Quantidade ${ins ? ins.unipro : ""}`}><input className={campoCol} inputMode="decimal" disabled={off || !ins} value={q} onChange={(e) => setQ(e.target.value)} /></Campo><Campo nome={`Rende ${p?.unipro || ""}`}><input className={campoCol} inputMode="decimal" disabled={off || !ins || modo !== "VEN"} value={r} onChange={(e) => setR(e.target.value)} /></Campo></div>
      <Observacao valor={obs} mudar={setObs} cabe={0} off={off || !ins} />
      <div className="grid grid-cols-2 gap-2"><Button size="lg" loading={oc} disabled={off || !ins || !(numero(q) > 0) || (modo === "VEN" && !(numero(r) > 0))} onClick={salvar}>{ed ? "Salvar" : "Incluir"}</Button><Button size="lg" variant="danger" disabled={off || !ed || oc} onClick={remover}>Remover</Button></div>
      {notas.length > 0 && <div className="border border-line bg-white">{notas.map((x, k) => <p key={k} className="border-b border-line p-3 text-[13px] last:border-0">{x.texto}<span className="block text-muted">{x.por} · {x.em}</span></p>)}</div>}
      {dialogo}
    </div>
  );
}

function Palete({ p, mudou }: Props) {
  const [v, setV] = useState<Row>({ camadas: p?.palete?.camadas ?? "", caixas: p?.palete?.caixas ?? "", obs: p?.palete?.obs ?? "" }), { oc, enviar } = useEnviar(p, mudou), ok = Number(v.camadas) > 0 && Number(v.caixas) > 0;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">{[["camadas", "Camadas"], ["caixas", "Cx por camada"]].map(([k, n]) => <Campo key={k} nome={n}><input className={campoCol} disabled={!p} inputMode="numeric" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/\D/g, "") })} /></Campo>)}</div>
      <Campo nome="Palete fechado"><input className={campoCol} disabled readOnly value={p && ok ? `${Number(v.camadas) * Number(v.caixas)} ${p.unipro}` : ""} /></Campo>
      <Observacao valor={v.obs} mudar={(x) => setV({ ...v, obs: x })} cabe={0} off={!p} />
      <Button size="lg" className="w-full" loading={oc} disabled={!p || !ok} onClick={() => enviar("/palete", v, "Palete salvo.")}>Salvar palete</Button>
    </div>
  );
}
