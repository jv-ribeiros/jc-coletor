"use client";
// Sistema › Impressoras (design/pages/impressoras_v1.html). Onde cada impressora está (no USB de um PC, compartilhada no Windows dele,
// ou na rede com IP), qual faz o adesivo de volume, e o teste. A senha de um PC vai para o cofre do Windows do servidor, nunca para o banco.
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Field, Modal, cx, inputCls, useConfirm, useToast } from "@/components/ui";
import { api, type Row } from "@/lib/client";

type Form = { id?: number; nome: string; onde: "PC" | "REDE"; pc: string; fila: string; ip: string; porta: string; tipo: "ZPL" | "A4"; dpi: string; largura: string; altura: string };
const VAZIO: Form = { nome: "", onde: "PC", pc: "", fila: "", ip: "", porta: "9100", tipo: "ZPL", dpi: "203", largura: "100", altura: "62" };
const quando = (s?: string | null) => {
  if (!s) return "";
  const hoje = new Date().toLocaleDateString("sv-SE");
  return `${s.slice(0, 10) === hoje ? "hoje" : `${s.slice(8, 10)}/${s.slice(5, 7)}`} ${s.slice(11, 16)}`;
};
const tag = (cls: string, t: string) => <span className={cx("inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset", cls)}>{t}</span>;
const OK = "bg-emerald-50 text-emerald-800 ring-emerald-200", ER = "bg-rose-50 text-rose-800 ring-rose-200", CZ = "bg-slate-100 text-slate-700 ring-slate-200";

export function ImpressorasSistema({ admin }: { admin: boolean }) {
  const [d, setD] = useState<Row | null>(null), [erro, setErro] = useState(""), [f, setF] = useState<Form | null>(null), [testando, setTestando] = useState(0);
  const [ad, setAd] = useState<{ impressora: string; auto: boolean }>({ impressora: "", auto: true }), [ped, setPed] = useState(""), [oc, setOc] = useState(""), toast = useToast();
  const por = useCallback((r: Row) => { setD(r); setAd({ impressora: r.adesivo.impressora ? String(r.adesivo.impressora) : "", auto: r.adesivo.auto }); }, []);
  const ler = useCallback(() => api("sistema/impressoras").then(por).catch((e) => setErro((e as Error).message)), [por]);
  useEffect(() => { ler(); }, [ler]);

  async function testar(i: Row) {
    setTestando(i.id);
    try { const r = await api<Row>("sistema/impressoras/teste", { id: i.id }); toast(r.ok ? r.msg : r.erro, r.ok ? undefined : "erro"); await ler(); }
    catch (e) { toast((e as Error).message, "erro"); } finally { setTestando(0); }
  }
  async function salvarAdesivo() {
    setOc("ad"); try { por(await api("sistema/impressoras/adesivo", { impressora: Number(ad.impressora) || null, auto: ad.auto })); toast("Adesivo de volume salvo."); }
    catch (e) { toast((e as Error).message, "erro"); } finally { setOc(""); }
  }
  async function imprimirPedido() {
    setOc("ped");
    try { const r = await api<Row>("conferencia/adesivos", { pedidos: [Number(ped)] }); toast(r.ok ? `${r.n} adesivo(s) do pedido ${ped} enviados para ${r.impressora}.` : `Não saiu: ${r.erro}`, r.ok ? undefined : "erro"); await ler(); }
    catch (e) { toast((e as Error).message, "erro"); } finally { setOc(""); }
  }
  const zebras = (d?.impressoras || []).filter((i: Row) => i.tipo === "ZPL"), mudouAd = !!d && (String(d.adesivo.impressora || "") !== ad.impressora || d.adesivo.auto !== ad.auto);

  return (
    <Card className="mt-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">Impressoras</h2>
        {admin && <Button size="sm" className="ml-auto" onClick={() => setF({ ...VAZIO })}>+ Nova impressora</Button>}
      </div>
      <p className="mt-1 text-sm text-muted">O coletor pede e o servidor imprime. Cadastre onde cada impressora está: no USB de um computador (compartilhada no Windows dele) ou na rede, com IP.</p>
      {erro && <p className="mt-3 bg-rose-50 p-3 text-sm text-rose-800">{erro}</p>}
      {d && <>
        {!d.impressoras.length ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-muted">Nenhuma impressora cadastrada.{admin ? " Clique em + Nova impressora." : ""}</p>
          : <div className="mt-3 overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-[12px] text-muted"><th className="py-2 pr-3 font-medium">Impressora</th><th className="py-2 pr-3 font-medium">Onde está</th><th className="py-2 pr-3 font-medium">Tipo</th><th className="py-2 pr-3 font-medium">Situação</th><th /></tr></thead>
            <tbody>{d.impressoras.map((i: Row) => <tr key={i.id} className="border-b border-line align-top">
              <td className="py-2.5 pr-3 font-semibold">{i.nome}{d.adesivo.impressora === i.id && <span className="block text-[12px] font-normal text-muted">faz o adesivo de volume</span>}</td>
              <td className="py-2.5 pr-3">{i.onde === "PC" ? <>No USB do computador <b>{i.pc}</b></> : <>Na rede, IP <b>{i.ip}</b></>}<span className="block text-[12px] text-muted">{i.onde === "PC" ? i.caminho : `porta ${i.porta}`}</span></td>
              <td className="py-2.5 pr-3">{i.tipo === "ZPL" ? "Etiqueta Zebra" : "Folha A4"}<span className="block text-[12px] text-muted">{i.tipo === "ZPL" ? `${i.dpi} dpi · ${i.largura} × ${i.altura} mm` : "ainda não imprime nada"}</span></td>
              <td className="py-2.5 pr-3">{i.ultimo_em ? tag(i.ultimo_ok ? OK : ER, i.ultimo_ok ? (i.tipo === "ZPL" ? "Imprimiu" : "Respondeu") : "Falhou") : tag(CZ, "Sem teste")}
                {i.ultimo_em && <span className="block max-w-[280px] text-[12px] text-muted">{quando(i.ultimo_em)} · {i.ultimo_msg}</span>}</td>
              <td className="whitespace-nowrap py-2 text-right">{admin && <><Button size="sm" variant="secondary" loading={testando === i.id} onClick={() => testar(i)}>{i.tipo === "ZPL" ? "Imprimir teste" : "Testar conexão"}</Button>{" "}
                <Button size="sm" variant="secondary" onClick={() => setF({ id: i.id, nome: i.nome, onde: i.onde, pc: i.pc || "", fila: i.fila || "", ip: i.ip || "", porta: String(i.porta || 9100), tipo: i.tipo, dpi: String(i.dpi || 203), largura: String(i.largura || 100), altura: String(i.altura || 62) })}>Editar</Button></>}</td>
            </tr>)}</tbody></table></div>}

        <h3 className="mt-5 text-sm font-semibold">Adesivo de volume <span className="font-normal text-muted">· um por volume, no fim da conferência</span></h3>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <select className={inputCls + " !w-64"} disabled={!admin} value={ad.impressora} onChange={(e) => setAd((x) => ({ ...x, impressora: e.target.value }))}>
            <option value="">Nenhuma (não imprime)</option>{zebras.map((i: Row) => <option key={i.id} value={i.id}>{i.nome}</option>)}</select>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={!admin} checked={ad.auto} onChange={(e) => setAd((x) => ({ ...x, auto: e.target.checked }))} />Imprimir sozinho ao concluir os volumes</label>
          {admin && <Button size="sm" disabled={!mudouAd} loading={oc === "ad"} onClick={salvarAdesivo}>Salvar</Button>}
        </div>
        {!zebras.length && <p className="mt-1 text-[12.5px] text-muted">Cadastre a Zebra acima para escolher aqui.</p>}
        {admin && d.adesivo.impressora && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span>Imprimir os adesivos de um pedido:</span>
          <input className={inputCls + " !w-32"} inputMode="numeric" placeholder="nº do pedido" value={ped} onChange={(e) => setPed(e.target.value.replace(/\D/g, ""))} />
          <Button size="sm" variant="secondary" disabled={!ped} loading={oc === "ped"} onClick={imprimirPedido}>Imprimir</Button>
          <span className="text-[12.5px] text-muted">sai na {d.adesivo.nome}, com os volumes do pedido (1/N … N/N)</span>
        </div>}

        {d.recentes.length > 0 && <>
          <h3 className="mt-5 text-sm font-semibold">Últimas impressões</h3>
          <div className="mt-1 text-sm">{d.recentes.map((r: Row, k: number) => <div key={k} className="grid grid-cols-[90px_1fr_auto] gap-3 border-b border-line py-1.5 last:border-0">
            <span className="tabular text-muted">{quando(r.em)}</span><span>{r.oque}{r.msg && !r.ok ? <span className="block text-[12px] text-rose-700">{r.msg}</span> : null}<span className="block text-[12px] text-muted">{r.nome} · {r.usuario}</span></span>
            <span>{tag(r.ok ? OK : ER, r.ok ? "Saiu" : "Falhou")}</span></div>)}</div>
        </>}
        {!admin && <p className="mt-3 text-sm text-muted">Só o administrador altera.</p>}
      </>}
      {f && <Editor inicial={f} servico={d?.servico || ""} fechar={() => setF(null)} salvo={(r) => { por(r); setF(null); }} />}
    </Card>
  );
}

function Editor({ inicial, servico, fechar, salvo }: { inicial: Form; servico: string; fechar: () => void; salvo: (r: Row) => void }) {
  const [f, setF] = useState<Form>(inicial), [filas, setFilas] = useState<Row[] | null>(null), [senha, setSenha] = useState<{ usuario: string; senha: string } | null>(null);
  const [msg, setMsg] = useState<{ t: string; k: "ok" | "er" | "am" } | null>(null), [oc, setOc] = useState(""), toast = useToast(), { confirmar, dialogo } = useConfirm();
  const m = (p: Partial<Form>) => { setF((x) => ({ ...x, ...p })); setMsg(null); };
  const corpo = () => ({ ...f, porta: Number(f.porta), dpi: Number(f.dpi), largura: Number(f.largura), altura: Number(f.altura) });

  async function procurar() {
    if (!f.pc.trim()) return;
    setOc("procurar"); setMsg(null); setFilas(null);
    try {
      const r = await api<Row>(`sistema/impressoras/procurar?pc=${encodeURIComponent(f.pc.trim())}`);
      if (r.erro) { setMsg({ t: r.erro, k: r.precisaSenha ? "am" : "er" }); if (r.precisaSenha) setSenha({ usuario: "", senha: "" }); return; }
      setSenha(null); setFilas(r.filas);
      if (!r.filas.length) setMsg({ t: `${f.pc.trim().toUpperCase()} não tem impressora compartilhada. No computador da impressora: Configurações › Impressoras › a impressora › Propriedades › Compartilhamento › "Compartilhar esta impressora".`, k: "am" });
      else if (r.filas.length === 1 && !f.fila) m({ fila: r.filas[0].nome });
    } catch (e) { setMsg({ t: (e as Error).message, k: "er" }); } finally { setOc(""); }
  }
  async function entrar() {
    if (!senha) return;
    setOc("senha");
    try {
      const r = await api<Row>("sistema/impressoras/acesso", { pc: f.pc.trim(), usuario: senha.usuario, senha: senha.senha });
      setSenha(null);
      if (r.erro) { setMsg({ t: r.erro, k: "er" }); return; }
      setFilas(r.filas); setMsg({ t: `Acesso a ${f.pc.trim().toUpperCase()} guardado.${r.aviso ? " " + r.aviso : ""}`, k: "ok" });
      if (r.filas.length === 1 && !f.fila) setF((x) => ({ ...x, fila: r.filas[0].nome }));
    } catch (e) { setMsg({ t: (e as Error).message, k: "er" }); } finally { setOc(""); }
  }
  async function testar() {
    setOc("teste"); setMsg(null);
    try { const r = await api<Row>("sistema/impressoras/teste", corpo()); setMsg(r.ok ? { t: r.msg, k: "ok" } : { t: r.erro, k: "er" }); if (r.precisaSenha) setSenha({ usuario: "", senha: "" }); }
    catch (e) { setMsg({ t: (e as Error).message, k: "er" }); } finally { setOc(""); }
  }
  async function salvar() {
    setOc("salvar");
    try { salvo(await api("sistema/impressoras", corpo())); toast("Impressora salva."); }
    catch (e) { setMsg({ t: (e as Error).message, k: "er" }); } finally { setOc(""); }
  }
  async function excluir() {
    if (!f.id || !(await confirmar({ titulo: `Excluir ${inicial.nome}?`, texto: "Se ela faz o adesivo de volume, o adesivo para de sair até você escolher outra.", acao: "Excluir", perigo: true }))) return;
    setOc("excluir");
    try { salvo(await api(`sistema/impressoras/${f.id}/excluir`, {})); toast("Impressora excluída."); }
    catch (e) { setMsg({ t: (e as Error).message, k: "er" }); } finally { setOc(""); }
  }
  const opcao = (sel: boolean, t: string, s: string, on: () => void) => <button type="button" onClick={on} className={cx("rounded-lg border p-3 text-left text-sm", sel ? "border-brand-600 bg-brand-50 ring-2 ring-brand-500/20" : "border-line bg-white hover:bg-slate-50")}><b className="block">{t}</b><span className="text-[12.5px] text-muted">{s}</span></button>;
  const pronto = !!f.nome.trim() && (f.onde === "PC" ? !!f.pc.trim() && !!f.fila : !!f.ip.trim());

  return (
    <Modal aberto onClose={fechar} largura="max-w-xl" titulo={f.id ? inicial.nome : "Nova impressora"}
      rodape={<div className="flex w-full flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={!pronto} loading={oc === "teste"} onClick={testar}>{f.tipo === "ZPL" ? "Imprimir teste" : "Testar conexão"}</Button>
        {f.id && <Button variant="danger" loading={oc === "excluir"} onClick={excluir}>Excluir</Button>}
        <span className="flex-1" /><Button variant="secondary" onClick={fechar}>Cancelar</Button><Button disabled={!pronto} loading={oc === "salvar"} onClick={salvar}>Salvar</Button></div>}>
      <div className="grid gap-4">
        <Field label="Nome"><input className={inputCls} value={f.nome} placeholder="ex.: Zebra da expedição" onChange={(e) => m({ nome: e.target.value })} /></Field>
        <div><span className="mb-1.5 block text-[13px] font-medium">Onde ela está</span><div className="grid grid-cols-2 gap-2">
          {opcao(f.onde === "PC", "No USB de um computador", "Compartilhada no Windows daquele computador", () => m({ onde: "PC" }))}
          {opcao(f.onde === "REDE", "Na rede, com IP", "Tem cabo de rede ou wi-fi e um IP", () => m({ onde: "REDE" }))}</div></div>
        {f.onde === "PC" ? <>
          <Field label="Computador onde ela está ligada" hint="Só o nome do computador, sem as barras. No Windows dele: Configurações › Sistema › Sobre › Nome do dispositivo.">
            <div className="flex gap-2"><input className={inputCls} value={f.pc} placeholder="ex.: EXPEDICAO-PC" onChange={(e) => { m({ pc: e.target.value, fila: "" }); setFilas(null); setSenha(null); }} onKeyDown={(e) => e.key === "Enter" && procurar()} />
              <Button variant="secondary" disabled={!f.pc.trim()} loading={oc === "procurar"} onClick={procurar}>Procurar</Button></div></Field>
          {senha && <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="grid grid-cols-2 gap-3"><Field label={`Usuário em ${f.pc.trim().toUpperCase()}`}><input className={inputCls} autoComplete="off" value={senha.usuario} onChange={(e) => setSenha({ ...senha, usuario: e.target.value })} /></Field>
              <Field label="Senha"><input className={inputCls} type="password" autoComplete="new-password" value={senha.senha} onChange={(e) => setSenha({ ...senha, senha: e.target.value })} onKeyDown={(e) => e.key === "Enter" && entrar()} /></Field></div>
            <p className="text-[12.5px] text-amber-900">É o usuário que entra no Windows daquele computador. A senha fica guardada criptografada no Windows do servidor, para o usuário do serviço ({servico}), como a da pasta dos XML. O sistema não guarda senha.</p>
            <div><Button size="sm" disabled={!senha.usuario || !senha.senha} loading={oc === "senha"} onClick={entrar}>Entrar e procurar</Button></div></div>}
          {filas && filas.length > 0 && <div><span className="mb-1.5 block text-[13px] font-medium">Impressoras compartilhadas em {f.pc.trim().toUpperCase()}</span>
            <div className="grid gap-1.5">{filas.map((q) => <label key={q.nome} className={cx("flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-sm", f.fila === q.nome ? "border-brand-600 bg-brand-50" : "border-line")}>
              <input type="radio" checked={f.fila === q.nome} onChange={() => m({ fila: q.nome })} /><b>{q.nome}</b><span className="text-muted">{q.obs}</span></label>)}</div></div>}
          {!filas && f.fila && <p className="text-sm">Compartilhamento: <b>\\{f.pc.trim().toUpperCase()}\{f.fila}</b> <span className="text-muted">· Procurar de novo para trocar</span></p>}
        </> : <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="IP" hint="O IP precisa ser fixo, no roteador ou na impressora. Se ele mudar, a impressão para."><input className={inputCls} value={f.ip} placeholder="ex.: 192.168.0.40" onChange={(e) => m({ ip: e.target.value })} /></Field>
          <Field label="Porta"><input className={inputCls} inputMode="numeric" value={f.porta} onChange={(e) => m({ porta: e.target.value.replace(/\D/g, "") })} /></Field></div>}
        <div><span className="mb-1.5 block text-[13px] font-medium">O que ela imprime</span><div className="grid grid-cols-2 gap-2">
          {opcao(f.tipo === "ZPL", "Etiqueta Zebra (ZPL)", "ZD220, ZD230, GC420 e outras Zebra", () => m({ tipo: "ZPL" }))}
          {opcao(f.tipo === "A4", "Folha A4", "laser ou jato de tinta (ainda não imprime nada)", () => m({ tipo: "A4" }))}</div></div>
        {f.tipo === "ZPL" && <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Resolução"><select className={inputCls} value={f.dpi} onChange={(e) => m({ dpi: e.target.value })}><option value="203">203 dpi (a ZD220 é 203)</option><option value="300">300 dpi</option><option value="600">600 dpi</option></select></Field>
          <Field label="Tamanho da etiqueta (mm)"><div className="flex items-center gap-2"><input className={inputCls + " !w-20"} inputMode="decimal" value={f.largura} onChange={(e) => m({ largura: e.target.value.replace(",", ".") })} />×<input className={inputCls + " !w-20"} inputMode="decimal" value={f.altura} onChange={(e) => m({ altura: e.target.value.replace(",", ".") })} /></div></Field></div>}
        {msg && <div className={cx("rounded-lg p-3 text-sm", msg.k === "ok" ? "bg-emerald-50 text-emerald-900" : msg.k === "am" ? "bg-amber-50 text-amber-900" : "bg-rose-50 text-rose-800")}>{msg.t}
          {msg.k === "ok" && f.tipo === "ZPL" && /Teste enviado/.test(msg.t) && <span className="mt-1 block text-[12.5px]">Se a moldura saiu cortada, o tamanho ou a calibração está errado. Para calibrar a ZD220: com etiqueta colocada, segure o botão até piscar duas vezes e solte.</span>}</div>}
        {f.onde === "PC" && <p className="text-[12.5px] text-muted">No computador da impressora, uma vez só: Configurações › Impressoras › a impressora › Propriedades › Compartilhamento › &quot;Compartilhar esta impressora&quot;. Ele precisa estar ligado para imprimir.</p>}
      </div>
      {dialogo}
    </Modal>
  );
}
