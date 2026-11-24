"use client";
import { useEffect, useState } from "react";
import { Button, useToast } from "@/components/ui";
import { BuscaProduto, Rot, novoUid, numero, useProdutos } from "@/components/movimentos";
import { Observacao } from "@/components/observacao";
import { Campo, campoCol } from "@/components/coletor";
import { api, r4, type Row } from "@/lib/client";

export function FormPerda() {
  const lista = useProdutos(), toast = useToast();
  const [mots, setMots] = useState<Row[] | null>(null), [mot, setMot] = useState(0), [itens, setItens] = useState<{ p: Row; q: string }[]>([]);
  const [obs, setObs] = useState(""), [erro, setErro] = useState(""), [oc, setOc] = useState(false), [uid, setUid] = useState(novoUid);
  useEffect(() => { api<Row[]>("perda/motivos").then(setMots).catch((e) => setErro((e as Error).message)); }, []);
  const mudar = (f: (l: { p: Row; q: string }[]) => { p: Row; q: string }[]) => { setItens(f); setUid(novoUid()); setErro(""); };
  // ler de novo o mesmo item soma
  const ler = (p: Row) => mudar((l) => l.some((x) => x.p.codpro === p.codpro)
    ? l.map((x) => (x.p.codpro === p.codpro ? { ...x, q: String(r4((numero(x.q) || 0) + (p.fator || 1))) } : x)) : [...l, { p, q: String(r4(p.fator || 1)) }]);
  const falta = !mot ? "Escolha o motivo." : !itens.length ? "Inclua ao menos um item." : itens.some((x) => !(numero(x.q) > 0)) ? "Informe a quantidade de todos os itens." : "";
  async function ok() {
    setOc(true); setErro("");
    try {
      const r = await api("perda", { uid, obs, motivo: mot, itens: itens.map((x) => ({ codpro: x.p.codpro, qtd: numero(x.q) })) });
      if (r.status === "LANCADA") toast("Perda lançada no Lieto."); else setErro(`Registrada, mas não lançada: ${r.erro} Fica em Movimentos para lançar de novo.`);
      setMot(0); setItens([]); setObs(""); setUid(novoUid());
    } catch (e) { setErro((e as Error).message); } finally { setOc(false); }
  }
  return (
    <div className="space-y-3">
      {/* um motivo por lançamento: repetir em cada item só aumenta toque */}
      <Campo nome="Motivo"><select className={campoCol} disabled={!mots} value={mot} onChange={(e) => { setMot(Number(e.target.value)); setUid(novoUid()); }}><option value={0}>{mots ? "Escolha…" : "Carregando…"}</option>{mots?.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></Campo>
      <div><Rot n="Produto" /><BuscaProduto lista={lista} escolher={ler} /></div>
      <div><Rot n="Itens" /><div className="border border-line bg-white">{!itens.length && <p className="p-3 text-sm text-muted">Nenhum item.</p>}{itens.map((x) => (
        <div key={x.p.codpro} className="flex items-center gap-2 border-b border-line p-2 text-sm last:border-0"><span className="min-w-0 flex-1">{x.p.nompro}</span>
          <input inputMode="decimal" className={campoCol + " !w-24"} value={x.q} onChange={(e) => mudar((l) => l.map((y) => (y.p.codpro === x.p.codpro ? { ...y, q: e.target.value } : y)))} /><button onClick={() => mudar((l) => l.filter((y) => y.p.codpro !== x.p.codpro))} className="px-3 py-2" aria-label="Remover">✕</button></div>
      ))}</div></div>
      <Observacao valor={obs} mudar={(v) => { setObs(v); setUid(novoUid()); }} cabe={46} />
      <Button size="lg" className="w-full" loading={oc} disabled={!!falta} onClick={ok}>Gravar perda</Button>
      {falta && <p className="text-[12px] text-muted">{falta}</p>}
      {erro && <p className="bg-rose-50 p-3 text-sm text-rose-800">{erro}</p>}
    </div>
  );
}
