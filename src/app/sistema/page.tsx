"use client";
import { useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Database, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { EmpresasRotina } from "@/components/empresas-rotina";
import { ModoConferencia } from "@/components/modo-conferencia";
import { Topo } from "@/components/topo";
import { Badge, Button, Card, Carregando, cx, useConfirm, useToast } from "@/components/ui";
import { api, fdata, sessao, type Row } from "@/lib/client";

export default function Sistema() {
  const [s, setS] = useState<Row | null>(null), [ocupado, setOcupado] = useState(false), [eventos, setEventos] = useState<Row[]>([]);
  const [admin, setAdmin] = useState(false);
  const toast = useToast(), { confirmar, dialogo } = useConfirm();
  const carregar = useCallback(async (agora = false) => {
    setOcupado(true);
    try { setS(await api(`sistema/ddl${agora ? "?agora=1" : ""}`)); setEventos(await api<Row[]>("sistema/eventos?modulo=sistema")); }
    catch (e) { toast((e as Error).message, "erro"); } finally { setOcupado(false); }
  }, [toast]);
  useEffect(() => { carregar(); api("sessao").then((u) => setAdmin(!!u?.admin)).catch(() => {}); }, [carregar]);

  async function homologar() {
    const ok = await confirmar({
      titulo: "Homologar a estrutura atual do banco?",
      texto: "A estrutura que está no Lieto agora passa a ser a referência. Só faça isso depois de conferir que as rotinas continuam gravando corretamente com as mudanças listadas (de preferência numa base de teste).",
      acao: "Homologar", palavra: "HOMOLOGAR", perigo: true,
    });
    if (!ok) return;
    try { await api("sistema/ddl/homologar", { confirmacao: "HOMOLOGAR" }); toast("Estrutura homologada."); await carregar(); }
    catch (e) { toast((e as Error).message, "erro"); }
  }

  if (!s) return <><Topo /><Carregando /></>;
  const ruins = s.rotinas.filter((r: Row) => !r.ok);
  return (
    <>
      <Topo />
      <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Sistema</h1>
        <EmpresasRotina admin={admin} />
        <ModoConferencia admin={admin} />
        <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Conformidade do banco do Lieto</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Toda rotina que grava no Lieto confere, antes de gravar, se as tabelas, triggers, procedures e generators de que depende continuam
              iguais aos homologados. Se algo mudou (atualização do Lieto, campo novo, trigger novo), a rotina fica bloqueada até a revisão.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" loading={ocupado} onClick={() => carregar(true)}><RefreshCw className="size-4" />Verificar agora</Button>
            {admin && <Button variant="dark" onClick={homologar}><ShieldCheck className="size-4" />Homologar estrutura atual</Button>}
          </div>
        </div>

        <div className={cx("mt-5 flex items-start gap-3 rounded-2xl px-5 py-4 ring-1",
          s.erro || !s.homologado || ruins.length ? "bg-rose-50 text-rose-900 ring-rose-200" : "bg-brand-50 text-brand-900 ring-brand-200")}>
          {s.erro || !s.homologado || ruins.length ? <ShieldAlert className="mt-0.5 size-5 shrink-0" /> : <ShieldCheck className="mt-0.5 size-5 shrink-0" />}
          <div className="text-sm">
            <div className="font-semibold">
              {s.erro ? "Não foi possível ler a estrutura do banco." : !s.homologado ? "Nenhuma estrutura homologada ainda."
                : ruins.length ? `${ruins.length} rotina(s) bloqueada(s) para gravação.` : "Tudo em conformidade."}
            </div>
            <div className="mt-0.5 opacity-80">
              {s.erro ? s.erro : <>Versão do Lieto no banco: <b>{s.versaoLieto ?? "—"}</b> · homologada: <b>{s.versaoHomologada ?? "—"}</b>
                {s.homologadoEm && <> · por {s.homologadoPor} em {fdata(s.homologadoEm)}</>} · verificado em {fdata(s.verificadoEm)}</>}
            </div>
            {!s.homologado && !s.erro && <div className="mt-1">{admin ? "Confira a lista abaixo e clique em Homologar estrutura atual." : "Peça a um administrador para homologar."}</div>}
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {s.rotinas.map((r: Row) => {
            const mapa = ((s.mapa || []) as Row[]).find((m) => m.id === r.id) || {};
            const objs = [...(mapa.tabelas || []), ...(mapa.procedures || []).map((p: string) => p + " (procedure)"), ...(mapa.generators || []).map((g: string) => g + " (generator)")];
            return (
              <Card key={r.id} className="p-5">
                <div className="flex items-center gap-2">
                  {r.ok ? <CircleCheck className="size-5 text-brand-600" /> : <CircleAlert className="size-5 text-rose-600" />}
                  <h2 className="font-semibold">{r.nome}</h2>
                  <Badge v={r.ok ? "LANCADA" : "ERRO"}>{r.ok ? "Liberada" : "Bloqueada"}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {objs.map((o: string) => {
                    const nome = o.replace(/ \(.*/, ""), dif = r.diferencas.some((d: Row) => d.objeto.endsWith(" " + nome));
                    return <span key={o} className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-inset",
                      dif ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-slate-50 text-slate-600 ring-slate-200")}><Database className="size-3" />{o}</span>;
                  })}
                </div>
                {r.diferencas.filter((d: Row) => d.tipo !== "SEM BASE").map((d: Row) => (
                  <div key={d.objeto} className="mt-3 overflow-hidden rounded-xl ring-1 ring-rose-200">
                    <div className="bg-rose-50 px-3 py-1.5 text-[12px] font-semibold text-rose-800">{d.objeto} — alterado desde a homologação</div>
                    <pre className="max-h-64 overflow-auto bg-white px-3 py-2 font-mono text-[11.5px] leading-relaxed">
                      {d.removido.map((l: string) => <div key={"-" + l} className="text-rose-700">- {l}</div>)}
                      {d.incluido.map((l: string) => <div key={"+" + l} className="text-brand-700">+ {l}</div>)}
                    </pre>
                  </div>
                ))}
              </Card>
            );
          })}
        </div>

        {eventos.length > 0 && (
          <Card className="mt-5 p-5">
            <h2 className="font-semibold">Histórico</h2>
            <ul className="mt-2 space-y-1 text-[13px]">
              {eventos.map((e) => <li key={e.id} className="text-muted"><span className="tabular">{fdata(e.em)}</span> · <b className="text-ink">{e.usuario}</b> · {e.acao} {e.detalhe && `(${e.detalhe})`}</li>)}
            </ul>
          </Card>
        )}
        <p className="mt-4 text-[12px] text-muted">Usuário atual: {sessao.usuario()?.nome}{admin ? " (administrador)" : ""}. Administradores são definidos em config.json › admins.</p>
      </main>
      {dialogo}
    </>
  );
}
