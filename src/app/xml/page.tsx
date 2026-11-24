"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Topo } from "@/components/topo";
import { TabelaVincular } from "@/components/vincular-tabela";
import { BuscaProduto, campo, numero, useProdutos } from "@/components/movimentos";
import { Abas, Badge, Button, Card, Carregando, Gaveta, Modal, Paginacao, inputCls, useConfirm, usePaginacao, useToast } from "@/components/ui";
import { Observacao } from "@/components/observacao";
import { api, fdata, fq, frs, type Row } from "@/lib/client";

type Aba = "notas" | "vincular" | "config";
export default function Pagina() {
  const [aba, setAba] = useState<Aba>("notas"), [s, setS] = useState<Row | null>(null), [admin, setAdmin] = useState(false), [semVinculo, setSem] = useState(0), [versao, setVersao] = useState(0); const toast = useToast();
  const ler = useCallback(() => api("xml").then(setS).catch((e) => toast(e.message, "erro")), [toast]);
  const mudou = useCallback(() => { ler(); setVersao((v) => v + 1); }, [ler]);
  useEffect(() => { ler(); api("sessao").then((u) => setAdmin(!!u?.admin)).catch(() => {}); const t = setInterval(ler, 10_000); return () => clearInterval(t); }, [ler]);
  useEffect(() => { api("xml/itens").then((r) => setSem(r.itens.length)).catch(() => {}); }, [versao, s?.contagem?.PENDENTE, s?.contagem?.ERRO]);
  if (!s) return <><Topo /><Carregando /></>;
  return (
    <><Topo /><main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold">Importação de XML</h1>
      <Abas<Aba> className="mt-4" ativa={aba} mudar={setAba} abas={[{ k: "notas", n: "Notas" }, { k: "vincular", n: "Vincular itens", cont: semVinculo, alerta: true }, { k: "config", n: "Configurações" }]} />
      {aba === "notas" && <Notas s={s} admin={admin} mudou={mudou} />}
      {aba === "vincular" && <Vincular admin={admin} versao={versao} pendentes={s.contagem.PENDENTE} mudou={mudou} />}
      {/* fica montada: trocar de aba não perde o que está sendo preenchido */}
      <div className={aba === "config" ? "" : "hidden"}><Pastas s={s} admin={admin} ler={ler} />{admin && <Config cfg={s.config} salvo={mudou} />}</div>
    </main></>
  );
}

const SIT: Record<string, [string, string]> = { IMPORTADA: ["LANCADA", "Importada"], ERRO: ["ERRO", "Erro"], PENDENTE: ["PENDENTE", "Pendente"] };
function Notas({ s, admin, mudou }: { s: Row; admin: boolean; mudou: () => void }) {
  const [d, setD] = useState<Row | null>(null), [pag, setPag] = useState(1), [por, setPor] = useState(25), [status, setStatus] = useState(""), [b, setB] = useState(""), [q, setQ] = useState(""), [sel, setSel] = useState(""); const toast = useToast();
  useEffect(() => { const t = setTimeout(() => { setQ(b); setPag(1); }, 350); return () => clearTimeout(t); }, [b]);
  const pedido = useRef(0);
  const ler = useCallback(() => {
    const n = ++pedido.current;
    api(`xml/notas?pag=${pag}&por=${por}&status=${status}&q=${encodeURIComponent(q)}`).then((r) => { if (n === pedido.current) { setD(r); if (r.pagina !== pag) setPag(r.pagina); } }).catch((e) => toast(e.message, "erro"));
  }, [pag, por, status, q, toast]);
  useEffect(() => { ler(); const t = setInterval(ler, 15_000); return () => clearInterval(t); }, [ler]);
  async function enviar(fs: FileList | null) {
    let ok = 0, rep = 0;
    for (const f of Array.from(fs || [])) {
      try {
        const x = await f.arrayBuffer(), cab = new TextDecoder("latin1").decode(x.slice(0, 200));
        const r = await api("xml/enviar", { arquivo: f.name, conteudo: new TextDecoder(/encoding=["'](iso-8859-1|windows-1252)/i.test(cab) ? "windows-1252" : "utf-8").decode(x) });
        if (r.repetido) rep++; else ok++;
      } catch (e) { toast(`${f.name}: ${(e as Error).message}`, "erro"); }
    }
    if (ok || rep) toast(`${ok} recebido(s)${rep ? `, ${rep} repetido(s)` : ""}.`); ler(); mudou();
  }
  const filtros: [string, string][] = [["", "Todas"], ["PENDENTE", "Pendentes"], ["ERRO", "Com erro"], ["IMPORTADA", "Importadas"], ["CANCELADA", "Canceladas"]];
  return (
    <>
      {s.falhas.length > 0 && <Card className="mt-4 max-h-40 overflow-y-auto p-4 text-[13px]"><b>Arquivos recusados ({s.falhas.length})</b>{s.falhas.map((f: Row) => <div key={f.arquivo} className="text-rose-700">{f.arquivo}: {f.erro}</div>)}</Card>}
      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <input className={inputCls + " min-w-[220px] flex-1"} placeholder="Número, pedido, comprador, CPF, produto…" value={b} onChange={(e) => setB(e.target.value)} />
          <select className={inputCls + " !w-auto"} value={status} onChange={(e) => { setStatus(e.target.value); setPag(1); }}>{filtros.map(([k, n]) => <option key={k} value={k}>{n}{k && s.contagem[k] ? ` (${s.contagem[k]})` : ""}</option>)}</select>
          <label className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-line px-4 text-sm font-medium">Enviar arquivos<input type="file" multiple accept=".xml" className="hidden" onChange={(e) => { enviar(e.target.files); e.target.value = ""; }} /></label>
        </div>
        {!d ? <Carregando /> : !d.linhas.length ? <p className="p-8 text-center text-sm text-muted">Nenhuma nota.</p> : (
          <div className="scroll-fino overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-left text-[12px] text-muted"><tr className="border-b border-line">{["NF", "Emissão", "Canal", "Comprador", "Pedido canal", "Valor", "Situação", "Pedido Lieto", "Pendência"].map((h) => <th key={h} className={"whitespace-nowrap px-4 py-2.5 font-medium" + (h === "Valor" ? " text-right" : "")}>{h}</th>)}</tr></thead>
              <tbody>{d.linhas.map((n: Row) => { const [cor, nome] = SIT[n.status || "PENDENTE"]; return (
                <tr key={n.chave} onClick={() => setSel(n.chave)} className="cursor-pointer border-b border-line last:border-0 hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-2.5 font-semibold tabular">{n.numero}<span className="font-normal text-muted">/{n.serie}</span></td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular">{fdata(n.emissao)}</td><td className="whitespace-nowrap px-4 py-2.5">{n.canal || "—"}</td>
                  <td className="max-w-[220px] truncate px-4 py-2.5" title={n.dest}>{n.dest || "—"}</td><td className="max-w-[150px] truncate px-4 py-2.5">{n.ped || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular">{frs(n.valor)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5"><Badge v={cor}>{nome}</Badge>{n.cancelada ? <> <Badge v="CANCELADA">Cancelada</Badge></> : null}</td>
                  <td className="px-4 py-2.5 tabular">{n.pedido ?? "—"}</td><td className="max-w-[280px] truncate px-4 py-2.5 text-rose-700" title={n.motivo}>{n.motivo}</td>
                </tr>); })}</tbody>
            </table>
          </div>
        )}
        {d && d.total > 0 && <div className="border-t border-line px-4"><Paginacao pagina={d.pagina} paginas={d.paginas} total={d.total} por={d.por} mudar={setPag} mudarPor={(n) => { setPor(Math.min(100, n)); setPag(1); }} /></div>}
      </Card>
      <Gaveta aberto={!!sel} onClose={() => setSel("")}>{sel && <Detalhe key={sel} chave={sel} admin={admin} mudou={() => { ler(); mudou(); }} />}</Gaveta>
    </>
  );
}

function Vincular({ admin, versao, pendentes, mudou }: { admin: boolean; versao: number; pendentes?: number; mudou: () => void }) {
  const [d, setD] = useState<Row | null>(null), [v, setV] = useState<Row[]>([]), [sub, setSub] = useState<"falta" | "feitos">("falta"), [b, setB] = useState(""); const lista = useProdutos(), toast = useToast(), { confirmar, dialogo } = useConfirm();
  useEffect(() => { api("xml/itens").then(setD).catch((e) => toast(e.message, "erro")); api<Row[]>("xml/vinculos").then(setV).catch((e) => toast(e.message, "erro")); }, [versao, pendentes, toast]);
  const q = b.trim().toUpperCase(), bate = (t: string) => !q || t.toUpperCase().includes(q);
  const itens = ((d?.itens || []) as Row[]).filter((i) => bate(`${i.xProd} ${i.cProd} ${i.ean}`)), feitos = v.filter((x) => bate(`${x.cprod} ${x.codpro} ${x.nompro}`));
  const p1 = usePaginacao(itens, 25, q + sub), p2 = usePaginacao(feitos, 25, q + sub);
  async function remover(x: Row) { if (await confirmar({ titulo: "Remover vínculo?", texto: `${x.cprod} → ${x.codpro} ${x.nompro}. Notas já importadas não mudam.`, perigo: true })) try { await api("xml/desvincular", x); mudou(); } catch (e) { toast((e as Error).message, "erro"); } }
  if (!d) return <Carregando />;
  return (
    <Card className="mt-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <select className={inputCls + " !w-auto"} value={sub} onChange={(e) => setSub(e.target.value as "falta" | "feitos")}><option value="falta">Sem vínculo ({d.itens.length})</option><option value="feitos">Já vinculados ({v.length})</option></select>
        <input className={inputCls + " min-w-[220px] flex-1"} placeholder="Buscar item" value={b} onChange={(e) => setB(e.target.value)} />
      </div>
      {d.fora > 0 && sub === "falta" && <p className="mt-2 text-[12px] text-muted">{d.fora} nota(s) de outro CNPJ ou modelo não entram aqui.</p>}
      {sub === "falta" ? <>
        {!itens.length && <p className="p-8 text-center text-sm text-muted">Nenhum item para vincular.</p>}
        {itens.length > 0 && <div className="mt-3"><TabelaVincular itens={p1.itens} lista={lista} admin={admin} mudou={mudou} /></div>}{p1.controles}
      </> : <>
        <div className="scroll-fino mt-3 overflow-x-auto"><table className="w-full text-[13px]"><thead className="text-left text-[12px] text-muted"><tr className="border-b border-line">{["Emitente", "Código no XML", "Produto no Lieto", "Conversão", "Por", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>{p2.itens.map((x) => <tr key={[x.emitente, x.cprod, x.un].join("|")} className="border-b border-line last:border-0"><td className="px-3 py-2 tabular">{x.emitente}</td><td className="px-3 py-2">{x.cprod}</td><td className="px-3 py-2">{x.codpro} · {x.nompro}</td><td className="whitespace-nowrap px-3 py-2 tabular">1 {x.un} = {fq(x.fator)} {x.unipro}</td><td className="whitespace-nowrap px-3 py-2 text-muted">{x.por} · {fdata(x.em)}</td><td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => remover(x)}>Remover</Button></td></tr>)}</tbody></table></div>{p2.controles}
      </>}
      {dialogo}
    </Card>
  );
}

function Pastas({ s, admin, ler }: { s: Row; admin: boolean; ler: () => void }) {
  const [p, setP] = useState(""), [nav, setNav] = useState(false); const toast = useToast();
  async function salvar(l: string[]) { try { await api("xml/pasta", { pastas: l }); setP(""); toast("Pastas salvas."); ler(); } catch (e) { toast((e as Error).message, "erro"); } }
  const adicionar = (x: string) => salvar([...s.pastas.map((y: Row) => y.pasta), x]);
  return (
    <Card className="mt-4 space-y-3 p-4 text-sm">
      <b>Pastas onde vocês salvam os XMLs</b>
      {!admin && <p className="text-rose-700">Só administrador (config.json › admins) altera as pastas e os canais.</p>}
      {s.pastas.map((x: Row) => (
        <div key={x.pasta} className="flex flex-wrap items-center gap-3 border-b border-line pb-2"><span className="min-w-0 flex-1 break-all font-medium">{x.pasta}<span className={"block text-[12px] " + (x.erro ? "text-rose-700" : "text-muted")}>{x.erro || (x.lida ? `Vigiando com as subpastas · última leitura ${fdata(x.lida)}` : "Aguardando a primeira leitura")}</span></span>
          {admin && <Button size="sm" variant="ghost" onClick={() => salvar(s.pastas.map((y: Row) => y.pasta).filter((y: string) => y !== x.pasta))}>Remover</Button>}</div>
      ))}
      <div className="flex flex-wrap gap-2"><input className={inputCls + " min-w-[260px] flex-1"} disabled={!admin} placeholder="Ex.: D:\\XML Marketplace" value={p} onChange={(e) => setP(e.target.value)} />
        <Button variant="secondary" disabled={!admin} onClick={() => setNav(true)}>Procurar…</Button><Button disabled={!admin || !p.trim()} onClick={() => adicionar(p)}>Adicionar pasta</Button></div>
      {nav && <Navegador inicio={p} fechar={() => setNav(false)} escolher={(x) => { setNav(false); adicionar(x); }} />}
    </Card>
  );
}

function Detalhe({ chave, admin, mudou }: { chave: string; admin: boolean; mudou: () => void }) {
  const [d, setD] = useState<Row | null>(null), lista = useProdutos(), toast = useToast();
  const ler = useCallback(() => api(`xml/${chave}`).then(setD).catch((e) => toast(e.message, "erro")), [chave, toast]);
  useEffect(() => { ler(); }, [ler]);
  const [oc, setOc] = useState(false);
  const [obs, setObs] = useState<string | null>(null);
  async function importar() { setOc(true); try { const r = await api(`xml/${chave}/importar`, { obs: obs ?? d?.obs ?? "" }); toast(`Importada: pedido ${r.pedido}.`); } catch (e) { toast((e as Error).message, "erro"); } finally { setOc(false); ler(); mudou(); } }
  if (!d) return <Carregando />;
  const n = d.nota;
  return (
    <div className="space-y-4 p-6 text-sm">
      <h2 className="text-xl font-semibold">NF {n.numero} · série {n.serie}</h2>
      <div className="text-muted">{n.natOp} · emissão {fdata(n.emissao)} · emissor {n.verProc || "—"}<br />Intermediador: {n.intermediador || "não informado"} · Pedido: {n.pedidoMarket || "—"}</div>
      <div>{n.destNome || "Sem destinatário"} · {n.destCidade}/{n.destUf}<br /><span className="text-muted">{d.cliente ? `Cliente ${d.cliente.codcli} no Lieto` : "Cliente ainda não cadastrado no Lieto"}</span></div>
      {d.status === "IMPORTADA" ? <p className="rounded-xl bg-brand-50 p-3 text-brand-800">Importada: pedido {d.pedido} no Lieto.</p> : d.erros.length ? <ul className="list-disc rounded-xl bg-rose-50 py-3 pl-8 pr-3 text-rose-800">{d.erros.map((e: string) => <li key={e}>{e}</li>)}</ul> : <div className="space-y-3 rounded-xl bg-brand-50 p-3 text-brand-800"><Observacao valor={obs ?? d.obs ?? ""} mudar={setObs} /><Button loading={oc} onClick={importar}>Importar no Lieto</Button></div>}
      {d.status === "IMPORTADA" && d.obs && <p className="whitespace-pre-wrap"><b>Observação</b><br />{d.obs}</p>}
      {d.erroImportacao && <p className="text-rose-700">Último erro: {d.erroImportacao}</p>}
      {d.itens.map((i: Row) => <ItemXml key={i.n} i={i} emitente={n.emitente} lista={lista} mudou={() => { ler(); mudou(); }} chave={chave} admin={admin} />)}
      <div className="text-right tabular">Produtos {frs(n.vProd)} · desconto {frs(n.vDesc)} · frete {frs(n.vFrete)} · outros {frs(n.vOutros)}<br /><b>Total {frs(n.vNota)}</b></div>
    </div>
  );
}

function ItemXml({ i, emitente, lista, mudou, chave, admin }: { i: Row; emitente: string; lista: Row[] | null; mudou: () => void; chave: string; admin: boolean }) {
  const [p, setP] = useState<Row | null>(i.sugestao), [f, setF] = useState("1"), [edit, setEdit] = useState(!i.produto); const toast = useToast();
  async function ok() { try { await api("xml/vincular", { emitente, cProd: i.cProd, un: i.un, codpro: p!.codpro, fator: numero(f) }); setEdit(false); mudou(); } catch (e) { toast((e as Error).message, "erro"); } }
  async function cadastrar() { try { const r = await api("xml/produto", { chave, item: i.n, modelo: p!.codpro }); toast(`Produto ${r.codpro} cadastrado.`); setEdit(false); mudou(); } catch (e) { toast((e as Error).message, "erro"); } }
  return (
    <div className="rounded-xl p-3 ring-1 ring-line">
      <div className="flex justify-between gap-3"><span><b>{i.xProd}</b><span className="block text-[12px] text-muted">código no XML {i.cProd} · EAN {i.ean || "—"} · CFOP {i.cfop}</span></span><span className="tabular">{fq(i.qtd)} {i.un} × {frs(i.vUn)}</span></div>
      {i.produto && !edit ? <div className="mt-2 flex justify-between text-brand-800"><span>→ {i.produto.codpro} {i.produto.nompro}: {fq(i.produto.qtd)} {i.produto.unipro}</span><button className="underline" onClick={() => setEdit(true)}>Alterar</button></div> : (
        <div className="mt-2 space-y-2">{!p ? <BuscaProduto lista={lista} escolher={setP} /> : <>
          <div className="flex justify-between"><span>→ {p.codpro} {p.nompro}{i.sugestao?.codpro === p.codpro ? " (sugerido pelo EAN)" : ""}</span><button className="underline" onClick={() => setP(null)}>Trocar</button></div>
          <div className="flex items-center gap-2"><span>1 {i.un} do XML =</span><input className={campo + " !w-24"} value={f} onChange={(e) => setF(e.target.value)} /><span>{p.unipro}</span><Button size="sm" disabled={!(numero(f) > 0)} onClick={ok}>Vincular</Button>{admin && <Button size="sm" variant="secondary" onClick={cadastrar}>Cadastrar novo usando este como modelo</Button>}</div></>}</div>
      )}
    </div>
  );
}

function Config({ cfg, salvo }: { cfg: Row; salvo: () => void }) {
  const [op, setOp] = useState<Row | null>(null), [auto, setAuto] = useState<boolean>(cfg.auto), [cs, setCs] = useState<Row[]>(cfg.canais); const toast = useToast();
  useEffect(() => { api("xml/opcoes").then(setOp).catch((e) => toast(e.message, "erro")); }, [toast]);
  const muda = (k: number, v: Row) => setCs(cs.map((x, j) => (j === k ? { ...x, ...v } : x)));
  async function ok() { try { await api("xml/config", { auto, canais: cs }); toast("Configuração salva."); salvo(); } catch (e) { toast((e as Error).message, "erro"); } }
  const sel = (k: number, campoK: string, lista: string, nome: string) => <select className={inputCls} value={cs[k][campoK] || ""} onChange={(e) => muda(k, { [campoK]: Number(e.target.value) })}><option value="">{nome}</option>{op?.[lista]?.map((o: Row) => <option key={o.id} value={o.id}>{o.nome}</option>)}</select>;
  return (
    <Card className="mt-4 space-y-3 p-4 text-sm">
      <b>Canais</b>
      {cs.map((k, j) => (
        <div key={j} className="grid grid-cols-2 gap-2 border-b border-line pb-3 md:grid-cols-4">
          <input className={inputCls} placeholder="Nome (Shopee)" value={k.nome || ""} onChange={(e) => muda(j, { nome: e.target.value })} />
          <input className={inputCls} placeholder="CNPJ intermediador no XML" value={k.cnpj || ""} onChange={(e) => muda(j, { cnpj: e.target.value })} />
          <input className={inputCls} maxLength={1} placeholder="Série interna (1 caractere)" value={k.sernot || ""} onChange={(e) => muda(j, { sernot: e.target.value.toUpperCase() })} />
          {sel(j, "codven", "vendedores", "Vendedor")}{sel(j, "codcon", "condicoes", "Condição")}{sel(j, "codcor", "correntistas", "Conta")}{sel(j, "codtip", "tipos", "Tipo de cliente")}
          <Button variant="ghost" onClick={() => setCs(cs.filter((_, x) => x !== j))}>Remover</Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" onClick={() => setCs([...cs, {}])}>Adicionar canal</Button>
        <label className="flex items-center gap-2"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />Importar sozinho o que estiver sem pendência</label><Button onClick={ok}>Salvar</Button></div>
    </Card>
  );
}

function Navegador({ inicio, fechar, escolher }: { inicio: string; fechar: () => void; escolher: (p: string) => void }) {
  const [d, setD] = useState<Row | null>(null); const toast = useToast();
  const ir = useCallback((p: string) => api(`xml/pastas?p=${encodeURIComponent(p)}`).then(setD).catch((e) => { toast(e.message, "erro"); if (p) api("xml/pastas").then(setD).catch(() => {}); }), [toast]);
  useEffect(() => { ir(inicio); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal aberto onClose={fechar} titulo="Escolha a pasta" descricao="São as pastas do computador onde este sistema está rodando." largura="max-w-xl"
      rodape={<><Button variant="secondary" onClick={fechar}>Cancelar</Button><Button disabled={!d?.atual} onClick={() => escolher(d!.atual)}>Usar esta pasta</Button></>}>
      <div className="text-sm"><b>{d?.atual || "Discos"}</b>{d?.atual && <span className="text-muted"> · {d.xmls} XML aqui</span>}</div>
      <div className="mt-2 max-h-80 overflow-y-auto rounded-lg ring-1 ring-line">
        {d?.acima != null && <button className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => ir(d.acima)}>↑ Voltar</button>}
        {d?.pastas.map((x: string) => <button key={x} className="block w-full border-t border-line px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => ir(x)}>📁 {x.split("\\").filter(Boolean).pop()}</button>)}
      </div>
    </Modal>
  );
}
