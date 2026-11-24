"use client";
// Auditoria: só consulta. Cada ação, da tela até a gravação no Lieto.
import { useCallback, useEffect, useState } from "react";
import { LimpezaAuditoria } from "@/components/limpeza-auditoria";
import { Topo, usePode } from "@/components/topo";
import { Button, Card, Carregando, Gaveta, cx, inputCls, useToast } from "@/components/ui";
import { api, baixarCsv, type Row } from "@/lib/client";

const hoje = () => new Date().toLocaleDateString("sv-SE");
const quando = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11)}` : "");
const ROTA: Record<string, string> = { "POST sessao/entrar": "Entrar", "POST sessao/sair": "Sair", "POST perda": "Registrou perda", "POST kit": "Registrou kit", "POST transferencia": "Registrou transferência", "POST transformacao": "Registrou transformação", "POST retorno": "Registrou retorno",
  "POST producao": "Apontou produção", "POST producao/:id/lancar": "Lançou produção", "POST producao/:id/cancelar": "Cancelou produção", "POST mov/:id/lancar": "Lançou movimento", "POST mov/:id/cancelar": "Cancelou movimento", "POST mov/:id/estornar": "Estornou movimento",
  "POST conferencia": "Abriu conferência", "POST conferencia/:id/contar": "Contou na conferência", "POST conferencia/:id/fechar": "Fechou conferência", "POST conferencia/:id/encerrar": "Encerrou conferência", "POST conferencia/:id/cancelar": "Cancelou conferência",
  "POST inventarios": "Abriu inventário", "POST inventarios/avulso": "Abriu inventário avulso", "POST inventarios/:id/leituras": "Contou no inventário", "POST inventarios/:id/avancar": "Finalizou etapa do inventário", "POST inventarios/:id/auditar": "Auditou item", "POST inventarios/:id/lancar": "Lançou ajustes do inventário",
  "POST xml/:chave/importar": "Importou XML", "xml/importar": "Importou XML", "xml/recebido": "Recebeu XML", "POST permissoes/:codfun": "Alterou liberações", "POST sistema/empresas": "Alterou empresa por rotina", "POST sistema/ddl/homologar": "Homologou estrutura", "POST cadastro/:cod": "Alterou cadastro" };
const acao = (r: string) => ROTA[r] || r.replace(/^POST /, "");
const aparelho = (x: Row) => [x.origem === "AUTOMATICO" ? "Servidor" : /Android|Mobile/i.test(x.dispositivo || "") ? "Aparelho móvel" : "Computador", x.ip].filter(Boolean).join(" · ");
const resultado = (x: Row): [string, boolean] => x.status == null ? ["Sem conclusão", true] : x.estado === "SEM CONFIRMACAO" ? ["Sem confirmação do Lieto", true] : x.status >= 400 ? [`Recusado: ${x.erro || x.status}`, true] : x.estado === "DESFEITO" ? ["Desfeito no Lieto", true] : [x.estado === "GRAVADO" ? "Gravado" : "Concluído", false];

export default function Pagina() {
  const pode = usePode(), toast = useToast(), [f, setF] = useState<Row | null>(null), [d, setD] = useState<Row | null>(null), [erro, setErro] = useState(""), [sel, setSel] = useState(""), [limpa, setLimpa] = useState(false);
  useEffect(() => { const q = new URLSearchParams(location.search); setF({ de: hoje(), ate: hoje(), usuario: "", rota: "", resultado: q.get("resultado") || "", q: "", pag: 1 }); setSel(q.get("trace") || ""); }, []);
  const url = useCallback((extra: Row = {}) => "auditoria?" + new URLSearchParams(Object.entries({ ...f, ...extra }).map(([k, v]) => [k, String(v)])), [f]);
  const livre = pode.pronto && pode(["auditoria"]);
  useEffect(() => { if (!f || !livre) return; const t = setTimeout(() => api(url()).then((r) => { setD(r); setErro(""); }).catch((e) => setErro((e as Error).message)), 300); return () => clearTimeout(t); }, [f, livre, url]);
  const muda = (x: Row) => setF({ ...f, pag: 1, ...x });
  async function csv() {
    try {
      const r = await api(url({ por: 5000, pag: 1 }));
      baixarCsv(`auditoria_${f!.de}_${f!.ate}.csv`, ["Quando", "Código", "Usuário", "De onde", "Ação", "Referência", "Gravações no Lieto", "Resultado", "Registro"], r.linhas.map((x: Row) => [quando(x.em), x.codfun, x.usuario, aparelho(x), acao(x.rota), x.ref, x.erp, resultado(x)[0], x.trace]));
      if (r.total > 5000) toast(`O arquivo tem os 5.000 mais recentes de ${r.total}. Reduza o período.`, "erro");
    } catch (e) { toast((e as Error).message, "erro"); }
  }
  if (!pode.pronto || !f) return <><Topo /><Carregando /></>;
  if (!livre) return <><Topo /><main className="mx-auto max-w-[900px] p-6"><Card className="p-6 text-sm">Seu usuário não tem a liberação &quot;Auditoria: consultar&quot;.</Card></main></>;
  const ic = inputCls + " !w-auto";
  return (
    <><Topo /><main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold">Auditoria</h1>
      <div className="mt-4 flex flex-wrap gap-2">
        <input type="date" className={ic} value={f.de} onChange={(e) => muda({ de: e.target.value })} /><input type="date" className={ic} value={f.ate} onChange={(e) => muda({ ate: e.target.value })} />
        <select className={ic} value={f.usuario} onChange={(e) => muda({ usuario: e.target.value })}><option value="">Todos os usuários</option>{d?.usuarios.map((x: string) => <option key={x}>{x}</option>)}</select>
        <select className={ic + " max-w-[260px]"} value={f.rota} onChange={(e) => muda({ rota: e.target.value })}><option value="">Todas as ações</option>{d?.rotas.map((x: string) => <option key={x} value={x}>{acao(x)}</option>)}</select>
        <select className={ic} value={f.resultado} onChange={(e) => muda({ resultado: e.target.value })}><option value="">Todos os resultados</option><option value="erro">Com erro</option><option value="semconf">Sem confirmação</option></select>
        <input className={inputCls + " min-w-[200px] !w-auto flex-1"} placeholder="Pedido, produto, nota, CODIDE" value={f.q} onChange={(e) => muda({ q: e.target.value })} /><Button variant="secondary" disabled={!d?.total} onClick={csv}>CSV</Button>{pode(["admin"]) && <Button variant="danger" onClick={() => setLimpa(true)}>Limpar…</Button>}
      </div>
      {erro && <p className="mt-4 bg-rose-50 p-3 text-sm text-rose-800">Não foi possível ler a auditoria: {erro}</p>}
      {!d ? !erro && <Carregando /> : <Card className="mt-4">
        <div className="scroll-fino overflow-x-auto"><table className="w-full text-[13px]"><thead className="text-left text-[12px] text-muted"><tr className="border-b border-line">{["Quando", "Quem", "De onde", "Ação", "Referência", "Lieto", "Resultado"].map((h) => <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>{d.linhas.map((x: Row) => { const [t, ruim] = resultado(x); return <tr key={x.trace} onClick={() => setSel(x.trace)} className="cursor-pointer border-b border-line last:border-0 hover:bg-slate-50"><td className="whitespace-nowrap px-4 py-2.5 tabular">{quando(x.em).slice(0, 19)}</td><td className="whitespace-nowrap px-4 py-2.5">{x.usuario ? `${x.codfun ?? ""} · ${x.usuario}` : "—"}</td><td className="whitespace-nowrap px-4 py-2.5">{aparelho(x)}</td><td className="px-4 py-2.5">{acao(x.rota)}</td><td className="max-w-[160px] truncate px-4 py-2.5" title={x.ref}>{x.ref}</td><td className="whitespace-nowrap px-4 py-2.5">{x.erp ? `${x.erp} gravação(ões)` : "—"}</td><td className={cx("max-w-[280px] truncate px-4 py-2.5", ruim && "text-rose-700")} title={t}>{t}</td></tr>; })}</tbody></table></div>
        {!d.total && <p className="p-8 text-center text-sm text-muted">{d.usuarios.length || d.rotas.length ? "Nenhum registro com esse filtro." : "Nenhum registro ainda. A auditoria começa quando esta versão entra no ar."}</p>}
        <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[13px] text-muted"><span>{d.total} registro(s)</span><span className="flex items-center gap-2"><Button size="sm" variant="secondary" disabled={d.pagina <= 1} onClick={() => setF({ ...f, pag: d.pagina - 1 })}>Anterior</Button>{d.pagina} de {d.paginas}<Button size="sm" variant="secondary" disabled={d.pagina >= d.paginas} onClick={() => setF({ ...f, pag: d.pagina + 1 })}>Próxima</Button></span></div>
      </Card>}
      {limpa && <LimpezaAuditoria fechar={() => setLimpa(false)} limpou={() => muda({})} />}
      <Gaveta aberto={!!sel} onClose={() => setSel("")}>{sel && <Detalhe key={sel} trace={sel} />}</Gaveta>
    </main></>
  );
}

const json = (s: string | null) => { try { return JSON.parse(s || "null"); } catch { return s; } };
const txt = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
// divide por vírgula fora de parênteses e aspas
function partes(s: string) { const o: string[] = []; let n = 0, asp = false, c = ""; for (const ch of s) { if (ch === "'") asp = !asp; if (!asp && ch === "(") n++; if (!asp && ch === ")") n--; if (ch === "," && !n && !asp) { o.push(c.trim()); c = ""; } else c += ch; } if (c.trim()) o.push(c.trim()); return o; }
// [campo, valor] do que foi enviado ao Lieto
function enviado(x: Row): [string, string][] {
  const ps = json(x.params), v = Array.isArray(ps) ? [...ps] : null;
  if (!v) return [["SQL", x.sql], ["Dados", txt(ps)]];
  const val = (e: string) => e.replace(/\?/g, () => txt(v.shift()));
  const i = /^insert into \S+ ?\((.*?)\) values \((.*)\)(?: returning .*)?$/i.exec(x.sql), u = /^update \S+ set (.*) where (.*)$/i.exec(x.sql);
  if (i) { const cs = partes(i[1]), vs = partes(i[2]); return cs.map((c, k) => [c.toUpperCase(), val(vs[k] ?? "")]); }
  if (u) return [...partes(u[1]).map((p): [string, string] => { const k = p.indexOf("="); return [p.slice(0, k).trim().toUpperCase(), val(p.slice(k + 1).trim())]; }), ["ONDE", val(u[2])]];
  return [["SQL", val(x.sql)]];
}
const Tab = ({ l }: { l: [string, string][] }) => <div className="mt-1 max-h-72 overflow-auto bg-slate-50 p-2 font-mono text-[12px]">{l.map(([k, v], n) => <div key={n} className="break-words"><span className="text-muted">{k}</span> {v}</div>)}</div>;
const Passo = ({ em, titulo, ruim, children }: { em?: string; titulo: string; ruim?: boolean; children?: React.ReactNode }) => <div className={cx("border-l-[3px] pb-4 pl-4", ruim ? "border-rose-600" : "border-brand-600")}><b className={ruim ? "text-rose-800" : ""}>{titulo}</b>{em && <span className="ml-2 text-[12px] text-muted tabular">{em.slice(11)}</span>}{children}</div>;

function Detalhe({ trace }: { trace: string }) {
  const [d, setD] = useState<Row | null>(null), [erro, setErro] = useState("");
  useEffect(() => { api(`auditoria/${trace}`).then(setD).catch((e) => setErro((e as Error).message)); }, [trace]);
  if (erro) return <p className="p-6 text-sm text-rose-800">{erro}</p>;
  if (!d) return <Carregando />;
  const a = d.acao, dados = json(a.dados), txs = [...new Set((d.erp as Row[]).map((x) => x.tx))];
  return (
    <div className="p-6 text-sm">
      <h2 className="text-xl font-semibold">{acao(a.rota)}</h2>
      <p className="mb-4 text-muted">{a.usuario ? `${a.codfun ?? ""} · ${a.usuario}` : "Sem usuário"} · {aparelho(a)} · {quando(a.em)}<span className="block break-all text-[12px]">{a.dispositivo}</span><span className="block break-all text-[12px]">Registro {a.trace}</span></p>
      <Passo em={a.em} titulo={a.origem === "AUTOMATICO" ? "Iniciado pelo servidor" : "Enviado pela tela"}><Tab l={dados && typeof dados === "object" ? Object.entries(dados).map(([k, v]) => [k, txt(v)]) : [["Dados", txt(dados)]]} /></Passo>
      {d.eventos.map((e: Row, k: number) => <Passo key={"e" + k} em={e.em} titulo={`Registrado aqui: ${e.modulo} ${e.ref} · ${e.acao}`}>{e.detalhe && <p className="break-words text-[13px] text-muted">{e.detalhe}</p>}</Passo>)}
      {txs.map((t) => { const l = (d.erp as Row[]).filter((x) => x.tx === t), u = l[0]; return <div key={t}>
        {l.map((x) => { const an = json(x.antes); return <Passo key={x.id} em={x.em} titulo={`Lieto · ${x.operacao} em ${x.tabela}`}>
          {x.operacao !== "INSERT" && <><p className="mt-1 text-[12px] text-muted">Antes</p>{Array.isArray(an) && an.length ? an.map((r: Row, k: number) => <Tab key={k} l={Object.entries(r).filter(([, v]) => v !== null && v !== "").map(([c, v]) => [c, txt(v)])} />) : <Tab l={[["", txt(an && an.length !== 0 ? an : "nenhum registro")]]} />}</>}
          <p className="mt-1 text-[12px] text-muted">{x.operacao === "DELETE" ? "Exclusão" : "Enviado ao Lieto"}</p><Tab l={enviado(x)} /></Passo>; })}
        {u.estado === "COMMIT" ? <Passo em={u.estado_em} titulo="Lieto confirmou" /> : u.estado === "ROLLBACK" ? <Passo em={u.estado_em} titulo="Desfeito: nada ficou gravado no Lieto" ruim><p>{u.estado_erro}</p></Passo> : <Passo em={u.estado_em} titulo="Sem confirmação" ruim><p>O servidor parou ou o Lieto não respondeu. Confira no Lieto antes de repetir. {u.estado_erro}</p></Passo>}
      </div>; })}
      {d.fim ? <Passo em={d.fim.em} titulo={d.fim.status >= 400 ? `Recusado: ${d.fim.erro}` : `Concluído em ${d.fim.ms} ms`} ruim={d.fim.status >= 400} /> : <Passo titulo="Sem conclusão registrada" ruim />}
    </div>
  );
}
