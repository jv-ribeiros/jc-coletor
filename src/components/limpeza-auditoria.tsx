"use client";
import { useEffect, useState } from "react";
import { Button, Field, Modal, inputCls } from "@/components/ui";
import { api, fdata, type Row } from "@/lib/client";

export function LimpezaAuditoria({ fechar, limpou }: { fechar: () => void; limpou: () => void }) {
  const [antes, setAntes] = useState(""), [lim, setLim] = useState(""), [p, setP] = useState<Row | null>(null), [c, setC] = useState<Row | null>(null), [f, setF] = useState<Row | null>(null), [motivo, setMotivo] = useState(""), [pal, setPal] = useState(""), [erro, setErro] = useState(""), [oc, setOc] = useState(false);
  useEffect(() => { api("auditoria/limpeza/limite").then((r) => { setLim(r.limite); setAntes(r.limite); }).catch((e) => setErro((e as Error).message)); }, []);
  useEffect(() => { let vivo = true; setP(null); setC(null); if (antes) api(`auditoria/limpeza/previa?antes=${antes}`).then((r) => { if (vivo) { setP(r); setErro(""); } }).catch((e) => { if (vivo) setErro((e as Error).message); }); return () => { vivo = false; }; }, [antes]);
  const faz = async (fn: () => Promise<void>) => { setOc(true); setErro(""); try { await fn(); } catch (e) { setErro((e as Error).message); } finally { setOc(false); } };
  const copiar = () => faz(async () => {
    const r = await api("auditoria/limpeza/copia", { antes }), a = await api(`auditoria/limpeza/arquivo?nome=${encodeURIComponent(r.nome)}`), el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob([a.conteudo], { type: "application/x-ndjson" })); el.download = a.nome; el.click(); URL.revokeObjectURL(el.href); setC(r);
  });
  const limpar = () => faz(async () => { setF(await api("auditoria/limpeza", { antes, nome: c!.nome, sha: c!.sha, motivo, confirmacao: pal })); limpou(); });
  const n = (x: number) => x.toLocaleString("pt-BR"), vazio = !!p && !p.acoes && !p.erp;
  return (
    <Modal aberto onClose={() => { if (!oc) fechar(); }} titulo="Limpar auditoria" rodape={f ? <Button onClick={fechar}>Fechar</Button> : <><Button variant="secondary" disabled={oc} onClick={fechar}>Voltar</Button>
      {!c ? <Button loading={oc} disabled={!p || vazio} onClick={copiar}>1. Baixar cópia</Button> : <Button variant="dark" loading={oc} disabled={!motivo.trim() || pal.trim().toUpperCase() !== "LIMPAR AUDITORIA"} onClick={limpar}>2. Apagar {n(c.acoes)} ações</Button>}</>}>
      {f ? <p className="text-sm">{n(f.acoes)} ações e {n(f.erp)} gravações apagadas por {f.usuario} em {fdata(f.em)}. Ficou registrado.</p> : <div className="space-y-3 text-sm">
        <Field label="Apagar o que for anterior a" hint="Os últimos 90 dias não podem ser limpos."><input type="date" className={inputCls} max={lim} disabled={oc} value={antes} onChange={(e) => setAntes(e.target.value)} /></Field>
        {!p && !erro && <p className="text-muted">Contando registros…</p>}
        {vazio && <p className="text-muted">Nada anterior a esta data.</p>}
        {p && !vazio && <p><b>Sai:</b> {n(p.acoes)} ações e {n(p.erp)} gravações no Lieto<br /><b>Fica:</b> de {fdata(antes)} em diante e o que está sem confirmação</p>}
        {c && <><p className="break-all">Cópia: {c.nome}</p><Field label="Motivo"><input className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field><Field label="Digite LIMPAR AUDITORIA"><input className={inputCls} value={pal} onChange={(e) => setPal(e.target.value)} /></Field></>}
        {erro && <p className="bg-rose-50 p-3 text-rose-800">{erro}</p>}
      </div>}
    </Modal>
  );
}
