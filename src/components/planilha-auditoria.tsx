"use client";
// Auditoria em formato de planilha: Final e Justificativa editáveis direto na grade,
// gravação automática ao sair da célula, navegação por Enter/setas, colar do Excel,
// ações em lote e "desconsiderar" itens que ninguém contou.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Ban, Check, CircleAlert, ClipboardPaste, LoaderCircle, RotateCcw, Search, ShieldCheck, X } from "lucide-react";
import { useResponsavel } from "@/components/topo";
import { Badge, Button, Vazio, cx, inputCls, useConfirm, usePaginacao, useToast } from "@/components/ui";
import { NUM_ETAPA, api, fq, frs, r4, type Row } from "@/lib/client";

export const DESC = "DESCONSIDERADO";
export const semLeitura = (i: Row) => !i.l[1] && !i.l[2] && !i.l[3];

const SUGESTOES = [
  "Recontagem física confirmada pelo auditor", "Erro na contagem", "Erro na recontagem", "Avaria / perda",
  "Saída sem baixa no sistema", "Entrada sem lançamento no sistema", "Produto em local não contado",
  "Unidade de medida divergente", "Mantido o saldo do sistema",
];

// "1.234,5" -> "1234.5" · "12,5" -> "12.5" · "" -> ""
const normaliza = (s: string) => { const t = String(s ?? "").trim().replace(/\s/g, ""); return t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t; };
const paraCelula = (n: unknown) => (n == null || n === "" ? "" : String(n).replace(".", ","));
const numOuNull = (s: string) => { const t = normaliza(s); if (t === "") return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };

// Desconsiderar / reconsiderar, com confirmação (usado aqui e na aba Itens)
export function useDesconsiderar(invId: number, recarregar: () => unknown) {
  const toast = useToast(), [usuario] = useResponsavel(), { confirmar, dialogo } = useConfirm();
  const executar = useCallback(async (codpros: string[], desfazer = false) => {
    if (!codpros.length) return false;
    const n = codpros.length, plural = n === 1 ? "item" : "itens";
    const ok = await confirmar(desfazer
      ? { titulo: `Reconsiderar ${n} ${plural}?`, texto: "Eles voltam para a lista da etapa atual e passam a contar nos indicadores.", acao: "Reconsiderar" }
      : { titulo: `Desconsiderar ${n} ${plural}?`, acao: "Desconsiderar",
          texto: "Itens sem nenhuma contagem saem do inventário: não geram ajuste no ERP (o saldo fica como está) e não entram na acuracidade. Dá para reconsiderar até o fim da auditoria." });
    if (!ok) return false;
    try {
      const r = await api(`inventarios/${invId}/desconsiderar`, { codpros, desfazer, usuario });
      toast(`${r.alterados} ${r.alterados === 1 ? "item" : "itens"} ${desfazer ? "reconsiderado(s)" : "desconsiderado(s)"}.` +
        (r.ignoradosComLeitura ? ` ${r.ignoradosComLeitura} ignorado(s) por já terem contagem.` : ""));
      await recarregar();
      return true;
    } catch (e) { toast((e as Error).message, "erro"); return false; }
  }, [invId, recarregar, confirmar, toast, usuario]);
  return { executar, dialogo };
}

type Edicao = { final?: string; just?: string };
type Status = "salvando" | "ok" | { erro: string };
type Col = "codpro" | "nompro" | "saldo" | "c1" | "c2" | "c3" | "final" | "dif" | "valor" | "situacao";
const FILTROS = [["pend", "Pendentes"], ["aud", "Auditados"], ["manter", "Manter"], ["recontar", "Recontagem"], ["sem", "Sem nenhuma contagem"], ["desc", "Desconsiderados"], ["", "Todos"]] as const;
const DECS = [["ACERTAR", "Acertar", "bg-brand-700"], ["MANTER", "Manter", "bg-slate-700"], ["RECONTAR", "Recontar", "bg-amber-600"]] as const;
const decDe = (i: Row) => (i.decisao as string) || "ACERTAR";

export function PlanilhaAuditoria({ inv, it, recarregar, abrir }: { inv: Row; it: Row[]; recarregar: () => Promise<unknown> | void; abrir: (c: string) => void }) {
  const toast = useToast(), [usuario] = useResponsavel();
  const pode = inv.etapa === "AUDITORIA", podeDesc = !!NUM_ETAPA[inv.etapa];
  const { executar: desconsiderar, dialogo } = useDesconsiderar(inv.id, recarregar);

  const base = useMemo(() => it.filter((i) => ["AUDITAR", "AUDITADO", DESC].includes(i.situacao)), [it]);
  const mapa = useMemo(() => new Map(base.map((i) => [i.codpro, i])), [base]);
  const conta = useMemo(() => ({
    pend: base.filter((i) => i.situacao === "AUDITAR").length, aud: base.filter((i) => i.situacao === "AUDITADO").length,
    sem: base.filter((i) => i.situacao === "AUDITAR" && semLeitura(i)).length, desc: base.filter((i) => i.situacao === DESC).length, "": base.length,
    manter: base.filter((i) => i.situacao !== DESC && i.decisao === "MANTER").length, recontar: base.filter((i) => i.situacao !== DESC && i.decisao === "RECONTAR").length,
  }), [base]);

  const [filtro, setFiltro] = useState<string>(conta.pend ? "pend" : "");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<{ col: Col | null; dir: 1 | -1 }>({ col: null, dir: -1 });
  const [edits, setEdits] = useState<Record<string, Edicao>>({});
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [justLote, setJustLote] = useState("");
  const [versao, setVersao] = useState(0);
  const tabela = useRef<HTMLTableElement>(null);

  // A ordem das linhas é "congelada": salvar uma célula não faz a linha pular nem sumir do filtro.
  // Só muda quando o usuário troca filtro, busca ou ordenação.
  const [linhas, setLinhas] = useState<string[]>([]);
  const baseRef = useRef(base); baseRef.current = base;
  useEffect(() => {
    const b = busca.trim().toUpperCase();
    const ok = (i: Row) => (filtro === "pend" ? i.situacao === "AUDITAR" : filtro === "aud" ? i.situacao === "AUDITADO"
      : filtro === "sem" ? i.situacao === "AUDITAR" && semLeitura(i) : filtro === "desc" ? i.situacao === DESC
      : filtro === "manter" ? i.situacao !== DESC && i.decisao === "MANTER" : filtro === "recontar" ? i.situacao !== DESC && i.decisao === "RECONTAR" : true)
      && (!b || i.codpro.toUpperCase().includes(b) || i.nompro.toUpperCase().includes(b));
    const v = (i: Row, c: Col) => (c === "codpro" || c === "nompro" || c === "situacao" ? String(i[c] ?? "") : Number(i[c] ?? -Infinity));
    const peso = (s: string) => (s === "AUDITAR" ? 0 : s === "AUDITADO" ? 1 : 2);
    const l = baseRef.current.filter(ok).sort((a, c) => {
      if (ordem.col) { const x = v(a, ordem.col), y = v(c, ordem.col); return (x < y ? -1 : x > y ? 1 : 0) * ordem.dir; }
      return peso(a.situacao) - peso(c.situacao) || Math.abs(c.valor) - Math.abs(a.valor);
    });
    setLinhas(l.map((i) => i.codpro));
  }, [filtro, busca, ordem, versao, base.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const visiveis = useMemo(() => linhas.map((c) => mapa.get(c)).filter(Boolean) as Row[], [linhas, mapa]);
  const { itens: pagina, controles, inicio } = usePaginacao(visiveis, 100, `${filtro}|${busca}|${ordem.col}|${ordem.dir}`);

  const valorFinal = (i: Row) => edits[i.codpro]?.final ?? paraCelula(i.final);
  const valorJust = (i: Row) => edits[i.codpro]?.just ?? (i.situacao === DESC ? "" : i.justificativa || "");

  // ---------- gravação ----------
  const salvar = useCallback(async (rows: { codpro: string; final: string; justificativa: string; decisao?: string }[]) => {
    if (!rows.length) return;
    setStatus((s) => { const n = { ...s }; for (const r of rows) n[r.codpro] = "salvando"; return n; });
    try {
      const { resultados } = await api<{ resultados: Row[] }>(`inventarios/${inv.id}/auditar`, { itens: rows, usuario });
      await recarregar();
      const enviados = new Map(rows.map((r) => [r.codpro, r]));
      setEdits((e) => {
        const n = { ...e };
        for (const r of resultados) {
          const env = enviados.get(r.codpro), ed = n[r.codpro];
          // só limpa a edição local se o usuário não digitou outra coisa enquanto salvava
          if (r.ok && ed && normaliza(ed.final ?? env!.final) === normaliza(env!.final) && (ed.just ?? env!.justificativa).trim() === env!.justificativa.trim()) delete n[r.codpro];
        }
        return n;
      });
      setStatus((s) => { const n = { ...s }; for (const r of resultados) n[r.codpro] = r.ok ? "ok" : { erro: r.erro }; return n; });
      const erros = resultados.filter((r) => !r.ok);
      if (erros.length) toast(`${erros.length} linha(s) não gravada(s): ${erros[0].erro}`, "erro");
    } catch (e) {
      setStatus((s) => { const n = { ...s }; for (const r of rows) n[r.codpro] = { erro: (e as Error).message }; return n; });
      toast((e as Error).message, "erro");
    }
  }, [inv.id, usuario, recarregar, toast]);

  const linhaPara = (i: Row, e?: Edicao) => {
    const f = e?.final ?? valorFinal(i), j = e?.just ?? valorJust(i);
    return { codpro: i.codpro, final: normaliza(f), justificativa: j.trim() };
  };
  const mudou = (i: Row, r: { final: string; justificativa: string }) =>
    (r.final === "" ? null : Number(r.final)) !== (i.final ?? null) || r.justificativa !== (i.justificativa || "").trim();

  function confirmarLinha(codpro: string) {
    const i = mapa.get(codpro), e = edits[codpro];
    if (!i || !e || i.situacao === DESC) return;
    const r = linhaPara(i);
    if (r.final !== "" && !Number.isFinite(Number(r.final))) { setStatus((s) => ({ ...s, [codpro]: { erro: "Número inválido" } })); return; }
    if (!mudou(i, r)) { setEdits((x) => { const n = { ...x }; delete n[codpro]; return n; }); return; }
    salvar([r]);
  }

  // ---------- teclado / colar ----------
  const focar = (r: number, c: number) => {
    const el = tabela.current?.querySelector<HTMLInputElement>(`[data-cel="${r}:${c}"]`);
    if (el) { el.focus(); el.select(); }
  };
  function teclas(e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number, codpro: string) {
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); focar(r + 1, c); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focar(r - 1, c); }
    else if (e.key === "Escape") { setEdits((x) => { const n = { ...x }; if (n[codpro]) { n[codpro] = { ...n[codpro], [c === 0 ? "final" : "just"]: undefined }; } return n; }); }
    else if (c === 0 && e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length) { e.preventDefault(); focar(r, 1); }
    else if (c === 1 && e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) { e.preventDefault(); focar(r, 0); }
  }
  function colar(e: React.ClipboardEvent<HTMLInputElement>, r: number, c: number) {
    const txt = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(txt.trim())) return; // valor simples: colagem normal
    e.preventDefault();
    const lin = txt.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    const novos: Record<string, Edicao> = {}, rows: ReturnType<typeof linhaPara>[] = [];
    lin.forEach((cols, k) => {
      const i = visiveis[r + k];
      if (!i || i.situacao === DESC) return;
      const ed: Edicao = { ...edits[i.codpro] };
      if (c === 0) { ed.final = cols[0] ?? ""; if (cols.length > 1) ed.just = cols[1]; } else ed.just = cols[0] ?? "";
      novos[i.codpro] = ed;
      const row = linhaPara(i, ed);
      if (row.final === "" || Number.isFinite(Number(row.final))) rows.push(row);
    });
    setEdits((x) => ({ ...x, ...novos }));
    salvar(rows);
    toast(`${rows.length} linha(s) coladas.`);
  }

  // ---------- lote ----------
  const selRows = visiveis.filter((i) => sel.has(i.codpro));
  const selAtivos = selRows.filter((i) => i.situacao !== DESC), selDesc = selRows.filter((i) => i.situacao === DESC);
  const selSemLeitura = selAtivos.filter(semLeitura);
  function preencher(fonte: "c3" | "c2" | "c1" | "saldo") {
    const rows = selAtivos.filter((i) => i[fonte] != null).map((i) => linhaPara(i, { ...edits[i.codpro], final: paraCelula(i[fonte]) }));
    setEdits((x) => { const n = { ...x }; for (const r of rows) n[r.codpro] = { ...n[r.codpro], final: paraCelula(r.final) }; return n; });
    salvar(rows);
  }
  function aplicarJust() {
    if (!justLote.trim()) return;
    const rows = selAtivos.map((i) => linhaPara(i, { ...edits[i.codpro], just: justLote }));
    setEdits((x) => { const n = { ...x }; for (const r of rows) n[r.codpro] = { ...n[r.codpro], just: justLote }; return n; });
    salvar(rows);
  }
  function decidir(rows: Row[], decisao: string) {
    const lista = rows.filter((i) => i.situacao !== DESC).map((i) => ({ ...linhaPara(i), decisao }));
    // ao trocar a decisão, a justificativa automática da decisão anterior não deve ir junto
    for (const r of lista) if (["Mantido sem ajuste (fica o saldo do sistema)", "Enviado para nova recontagem"].includes(r.justificativa)) r.justificativa = "";
    setEdits((x) => { const n = { ...x }; for (const r of lista) delete n[r.codpro]; return n; });
    salvar(lista);
  }
  const todosSel = visiveis.length > 0 && visiveis.every((i) => sel.has(i.codpro));
  const alternarTodos = () => setSel(todosSel ? new Set() : new Set(visiveis.map((i) => i.codpro)));
  const alternar = (c: string) => setSel((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  async function desc(cods: string[], desfazer = false) { if (await desconsiderar(cods, desfazer)) { setSel(new Set()); setVersao((v) => v + 1); } }

  if (!base.length) return <Vazio icone={<ShieldCheck className="size-6" />} titulo="Nada para auditar"
    texto={NUM_ETAPA[inv.etapa] < 3 ? "Os itens aparecem aqui quando contagem e recontagem divergirem." : "Contagem e recontagem resolveram todas as divergências."} />;

  const totValor = visiveis.reduce((s, i) => s + (i.situacao === DESC || decDe(i) !== "ACERTAR" ? 0 : difDe(i, valorFinal(i)).valor), 0);
  const Th = ({ c, children, dir }: { c: Col; children: React.ReactNode; dir?: "r" }) => (
    <th className={cx("cursor-pointer select-none hover:text-ink", dir === "r" && "text-right")}
      onClick={() => setOrdem((o) => (o.col === c ? (o.dir === -1 ? { col: c, dir: 1 } : { col: null, dir: -1 }) : { col: c, dir: -1 }))}>
      <span className={cx("inline-flex items-center gap-1", dir === "r" && "flex-row-reverse")}>{children}
        {ordem.col === c && (ordem.dir === -1 ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}</span>
    </th>
  );

  return (
    <div className="space-y-3">
      {/* barra superior */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
          <input className={cx(inputCls, "pl-9")} placeholder="Buscar código ou produto" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTROS.map(([k, n]) => (conta[k] > 0 || k === "" || k === "pend") && (
            <button key={k} onClick={() => { setFiltro(k); setSel(new Set()); }} className={cx("h-8 rounded-full px-3 text-[12px] font-medium transition",
              filtro === k ? "bg-ink text-white" : "bg-slate-100 text-muted hover:text-ink")}>{n} <span className="tabular opacity-60">{conta[k]}</span></button>
          ))}
        </div>
      </div>

      {podeDesc && conta.sem > 0 && !sel.size && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-100 px-4 py-2.5 text-[13px]">
          <Ban className="size-4 text-slate-500" />
          <span className="flex-1"><b>{conta.sem}</b> {conta.sem === 1 ? "item está" : "itens estão"} na auditoria sem nenhuma contagem nem recontagem. Se não fazem parte do inventário, desconsidere-os: não geram ajuste.</span>
          <Button size="sm" variant="secondary" onClick={() => desc(base.filter((i) => i.situacao === "AUDITAR" && semLeitura(i)).map((i) => i.codpro))}>Desconsiderar os {conta.sem}</Button>
          {filtro !== "sem" && <Button size="sm" variant="ghost" onClick={() => setFiltro("sem")}>Ver quais</Button>}
        </div>
      )}

      {/* barra de lote */}
      {sel.size > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl bg-ink px-3 py-2 text-[13px] text-white shadow-lg">
          <span className="px-1 font-semibold">{sel.size} selecionado(s)</span>
          {pode && selAtivos.length > 0 && <>
            <span className="mx-1 h-5 w-px bg-white/20" />
            <span className="text-white/60">Decisão:</span>
            {DECS.map(([k, n]) => <button key={k} onClick={() => decidir(selAtivos, k)} className="h-7 rounded-md bg-white/10 px-2.5 font-medium hover:bg-white/20">{n}</button>)}
            <span className="mx-1 h-5 w-px bg-white/20" />
            <span className="text-white/60">Final =</span>
            {([["c3", "Auditor"], ["c2", "Recont."], ["c1", "Contagem"], ["saldo", "Sistema"]] as const).map(([f, n]) => (
              <button key={f} onClick={() => preencher(f)} className="h-7 rounded-md bg-white/10 px-2.5 font-medium hover:bg-white/20">{n}</button>
            ))}
            <span className="mx-1 h-5 w-px bg-white/20" />
            <input list="just-sugestoes" value={justLote} onChange={(e) => setJustLote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && aplicarJust()}
              placeholder="Justificativa para todos" className="h-7 w-64 rounded-md bg-white/10 px-2.5 text-white outline-none placeholder:text-white/40 focus:bg-white/20" />
            <button onClick={aplicarJust} disabled={!justLote.trim()} className="h-7 rounded-md bg-brand-600 px-2.5 font-medium hover:bg-brand-500 disabled:opacity-40">Aplicar</button>
          </>}
          {podeDesc && selSemLeitura.length > 0 && <button onClick={() => desc(selSemLeitura.map((i) => i.codpro))} className="h-7 rounded-md bg-white/10 px-2.5 font-medium hover:bg-white/20"><Ban className="mr-1 inline size-3.5" />Desconsiderar {selSemLeitura.length}</button>}
          {podeDesc && selDesc.length > 0 && <button onClick={() => desc(selDesc.map((i) => i.codpro), true)} className="h-7 rounded-md bg-white/10 px-2.5 font-medium hover:bg-white/20"><RotateCcw className="mr-1 inline size-3.5" />Reconsiderar {selDesc.length}</button>}
          <button onClick={() => setSel(new Set())} className="ml-auto rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white" title="Limpar seleção"><X className="size-4" /></button>
        </div>
      )}

      {pode && <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
        <span>Escolha a <b className="text-ink">Decisão</b> e digite direto em <b className="text-ink">Final</b> e <b className="text-ink">Justificativa</b>: grava ao sair da célula.</span>
        <span><kbd className="kbd">Enter</kbd>/<kbd className="kbd">↓</kbd> desce · <kbd className="kbd">Esc</kbd> desfaz</span>
        <span className="inline-flex items-center gap-1"><ClipboardPaste className="size-3.5" />Pode colar colunas do Excel (Final e Justificativa)</span>
      </p>}

      <div className="scroll-fino max-h-[68vh] overflow-auto rounded-xl border border-line bg-white">
        <table ref={tabela} className="planilha w-full min-w-[1240px] border-separate border-spacing-0 text-[13px]">
          <thead className="sticky top-0 z-10 bg-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <tr>
              <th className="w-9 text-center"><input type="checkbox" checked={todosSel} onChange={alternarTodos} className="size-3.5 accent-brand-700" /></th>
              <Th c="codpro">Código</Th><Th c="nompro">Produto</Th>
              <Th c="saldo" dir="r">Sistema</Th><Th c="c1" dir="r">Contagem</Th><Th c="c2" dir="r">Recont.</Th><Th c="c3" dir="r">Auditor</Th>
              <th className="w-[196px] bg-brand-50 text-center text-brand-800">Decisão</th>
              <th className="w-[110px] bg-brand-50 text-right text-brand-800">Final ✎</th>
              <Th c="dif" dir="r">Dif.</Th><Th c="valor" dir="r">Valor</Th>
              <th className="w-[24%] bg-brand-50 text-brand-800">Justificativa ✎</th>
              <Th c="situacao">Situação</Th><th className="w-8" />
            </tr>
          </thead>
          <tbody className="tabular">
            {pagina.map((i, k) => {
              const r = inicio + k, des = i.situacao === DESC, ro = !pode || des, st = status[i.codpro], dec = decDe(i), semAj = !des && dec !== "ACERTAR";
              const vf = valorFinal(i), vj = valorJust(i), { dif, valor, provisorio } = difDe(i, vf);
              const sujo = !!edits[i.codpro], invalido = Number.isNaN(numOuNull(vf));
              return (
                <tr key={i.codpro} className={cx("group", sel.has(i.codpro) ? "bg-brand-50/70" : des ? "bg-slate-50 text-slate-400" : "hover:bg-slate-50/80")}>
                  <td className="text-center"><input type="checkbox" checked={sel.has(i.codpro)} onChange={() => alternar(i.codpro)} className="size-3.5 accent-brand-700" /></td>
                  <td className="text-muted">{i.codpro}</td>
                  <td className="min-w-[240px] !whitespace-normal">
                    <button onClick={() => abrir(i.codpro)} className={cx("block max-w-full text-left font-medium hover:underline", des && "line-through")}>{i.nompro}</button>
                    <div className="truncate text-[11px] text-muted">{i.unipro} · custo {frs(i.precus)}{i.l[1]?.locais ? ` · ${i.l[1].locais}` : ""}</div>
                  </td>
                  <td className="text-right text-muted">{fq(i.saldo)}</td>
                  <td className="text-right">{i.l[1] ? fq(i.c1) : "—"}</td>
                  <td className="text-right">{i.l[2] ? fq(i.c2) : "—"}</td>
                  <td className="text-right font-medium">{fq(i.c3)}</td>
                  <td className="text-center">
                    {des ? <span className="text-muted">—</span> : (
                      <span className="inline-flex rounded-md bg-slate-100 p-0.5">
                        {DECS.map(([kk, n, cor]) => (
                          <button key={kk} disabled={ro} onClick={() => dec !== kk && decidir([i], kk)} title={kk === "ACERTAR" ? "Ajusta o estoque para o Final" : kk === "MANTER" ? "Não ajusta: fica o saldo do sistema" : "Abre um novo inventário de recontagem com este item"}
                            className={cx("h-6 rounded px-2 text-[11px] font-semibold transition", dec === kk ? `${cor} text-white` : "text-muted hover:text-ink disabled:hover:text-muted")}>{n}</button>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className={cx("cel-edit", sujo && "sujo", invalido && "invalido")}>
                    <input data-cel={`${r}:0`} disabled={ro} inputMode="decimal" value={vf} placeholder={ro ? "" : fq(i.c3 ?? i.c2 ?? i.c1 ?? null).replace("—", "")}
                      onChange={(e) => setEdits((x) => ({ ...x, [i.codpro]: { ...x[i.codpro], final: e.target.value } }))}
                      onBlur={() => confirmarLinha(i.codpro)} onKeyDown={(e) => teclas(e, r, 0, i.codpro)} onPaste={(e) => colar(e, r, 0)} onFocus={(e) => e.target.select()}
                      className="text-right font-semibold" />
                  </td>
                  <td className={cx("text-right font-medium", (provisorio || semAj) && "italic opacity-50", semAj && "line-through", dif > 0 && "text-brand-700", dif < 0 && "text-rose-700")}>{des ? "—" : `${dif > 0 ? "+" : ""}${fq(dif)}`}</td>
                  <td className={cx("text-right", (provisorio || semAj) && "italic opacity-50", semAj && "line-through", valor > 0 && "text-brand-700", valor < 0 && "text-rose-700")}>{des || !valor ? "—" : frs(valor)}</td>
                  <td className={cx("cel-edit", sujo && "sujo")}>
                    <input data-cel={`${r}:1`} disabled={ro} list="just-sugestoes" value={des ? i.justificativa || "" : vj} placeholder={ro ? "" : "obrigatória"}
                      onChange={(e) => setEdits((x) => ({ ...x, [i.codpro]: { ...x[i.codpro], just: e.target.value } }))}
                      onBlur={() => confirmarLinha(i.codpro)} onKeyDown={(e) => teclas(e, r, 1, i.codpro)} onPaste={(e) => colar(e, r, 1)} />
                  </td>
                  <td>
                    {des ? (podeDesc ? <button onClick={() => desc([i.codpro], true)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-white"><RotateCcw className="size-3" />Voltar</button> : <Badge v={DESC}>Desconsiderado</Badge>)
                      : <span className="inline-flex items-center gap-1.5"><Badge v={i.situacao}>{i.situacao !== "AUDITADO" ? "Pendente" : dec === "ACERTAR" ? "OK" : dec === "MANTER" ? "Mantido" : "→ Recontagem"}</Badge>
                        {i.situacao === "AUDITAR" && (i.final != null) !== !!i.justificativa && <span className="text-[11px] text-amber-700">{i.final == null ? "falta final" : "falta justif."}</span>}
                        {i.situacao === "AUDITAR" && semLeitura(i) && i.final == null && <span className="text-[11px] text-slate-400">sem contagem</span>}</span>}
                  </td>
                  <td className="text-center">
                    {st === "salvando" ? <LoaderCircle className="mx-auto size-3.5 animate-spin text-muted" />
                      : st === "ok" ? <Check className="mx-auto size-3.5 text-brand-600" />
                      : st ? <span title={st.erro}><CircleAlert className="mx-auto size-3.5 text-rose-600" /></span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 bg-slate-100 text-[12px] font-semibold">
            <tr>
              <td /><td colSpan={2}>{visiveis.length} linha(s){filtro === "pend" && conta.pend !== visiveis.filter((i) => i.situacao === "AUDITAR").length ? ` · ${conta.pend} ainda pendentes` : ""}</td>
              <td colSpan={7} /><td className={cx("text-right", totValor < 0 ? "text-rose-700" : totValor > 0 ? "text-brand-700" : "")}>{frs(totValor)}</td><td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
      {controles}
      <datalist id="just-sugestoes">{SUGESTOES.map((s) => <option key={s} value={s} />)}</datalist>
      {dialogo}
    </div>
  );
}

// diferença usando o valor digitado (ou, se vazio, a melhor contagem — mostrada como provisória)
function difDe(i: Row, celula: string) {
  const n = numOuNull(celula);
  const provisorio = n == null || Number.isNaN(n);
  const final = provisorio ? i.atual : (n as number);
  const dif = r4(final - i.saldo);
  return { dif, valor: r4(dif * i.precus), provisorio };
}
