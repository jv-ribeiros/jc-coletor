// Alertas do Painel: erros, pendências e avisos. Calculados na hora; cada um some quando o problema é resolvido.
import { db } from "./db";
import * as ddl from "./ddl";
import * as PM from "./permissoes";
import * as X from "./xml";
import { listar as empresas } from "./empresas";
import { agora, type Usuario } from "./comum";
import { comConexao, consultar } from "./fb";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Alerta = { nivel: "E" | "P" | "A"; titulo: string; texto: string; em: string; href: string; rotinas: string[] };
const p2 = (n: number) => String(n).padStart(2, "0");
const ha = (ms: number) => { const d = new Date(Date.now() - ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
const H = 3_600_000, TIPOS = ["transferencia", "transformacao", "kit", "retorno", "perda"];
const NOME: Record<string, string> = { transferencia: "Transferência", transformacao: "Transformação", kit: "Kit", retorno: "Retorno", perda: "Perda" };
const todos = (sql: string, ...a: (string | number)[]) => db().prepare(sql).all(...a) as Row[];

export async function listar(u: Usuario) {
  const l: Alerta[] = [], falhas: string[] = [];
  const add = (nivel: Alerta["nivel"], titulo: string, texto: string, em: string, href: string, rotinas: string[]) => l.push({ nivel, titulo, texto, em: em || "", href, rotinas });
  const parte = async (nome: string, fn: () => void | Promise<void>) => { try { await fn(); } catch (e) { falhas.push(`${nome}: ${(e as Error).message}`); } };

  await parte("Lieto", async () => { await comConexao((c) => consultar(c, "select 1 n from rdb$database")); });
  await parte("estrutura do banco", async () => {
    const s = await ddl.status();
    if (s.erro) add("E", "Não foi possível conferir a estrutura do Lieto", s.erro, "", "/sistema", ["gestao"]);
    else if (!s.homologado) add("E", "Estrutura do Lieto não homologada", "Gravações bloqueadas.", "", "/sistema", ["gestao"]);
    else for (const r of s.rotinas.filter((x) => !x.ok)) add("E", `Gravação bloqueada: ${r.nome}`, r.diferencas.map((d) => d.objeto).join(", "), "", "/sistema", ["gestao"]);
  });
  await parte("produção", () => {
    for (const p of todos("SELECT id, nompro, erro, status, usuario, criado_em FROM producoes WHERE status IN ('ERRO','PENDENTE') ORDER BY id LIMIT 100"))
      add(p.status === "ERRO" ? "E" : "P", `Produção não lançada: ${p.nompro}`, [p.erro || "Aguardando lançamento", p.usuario].join(" · "), p.criado_em, "/producao", ["producao", "producao_gestao"]);
  });
  await parte("movimentos", () => {
    for (const m of todos("SELECT id, tipo, resumo, erro, status, usuario, criado_em FROM movs WHERE status IN ('ERRO','PENDENTE') ORDER BY id LIMIT 100"))
      add(m.status === "ERRO" ? "E" : "P", `${NOME[m.tipo] || m.tipo} nº ${m.id} não lançado(a)`, [m.erro || "Aguardando lançamento", m.resumo, m.usuario].join(" · "), m.criado_em, "/movimentos", TIPOS.includes(m.tipo) ? [m.tipo] : ["gestao"]);
  });
  await parte("XML", () => {
    const s = X.situacao();
    for (const x of todos("SELECT numero, serie, erro, recebido_em FROM xmls WHERE status = 'ERRO' AND chave NOT IN (SELECT chave FROM xml_cancelados) ORDER BY emissao LIMIT 50")) add("E", `XML da nota ${x.numero}/${x.serie} com erro`, x.erro || "", x.recebido_em, "/xml", ["xml"]);
    const n = todos("SELECT COUNT(*) n, MIN(recebido_em) em FROM xmls WHERE status IS NULL AND chave NOT IN (SELECT chave FROM xml_cancelados)")[0];
    if (n.n) add("P", `${n.n} nota(s) XML sem importar`, "Abra para ver o que falta em cada uma.", n.em, "/xml", ["xml"]);
    for (const x of s.pastas) if (x.erro) add("E", "Pasta de XML fora do ar", `${x.pasta} · ${x.erro}`, "", "/xml", ["xml"]);
    for (const f of s.falhas as Row[]) add("E", "Arquivo XML não lido", `${f.arquivo} · ${f.erro}`, f.em, "/xml", ["xml"]);
  });
  await parte("conferência", () => {
    for (const c of todos("SELECT pedido, romaneio, usuario, erro, criado_em, aguarda_em FROM conferencias WHERE status IN ('CONTANDO','RECONTANDO') AND (erro IS NOT NULL OR aguarda_em IS NOT NULL OR criado_em < ?) ORDER BY id", ha(24 * H)))
      add(c.erro ? "E" : "P", `Conferência ${c.erro ? "com erro" : c.aguarda_em ? "com falta, esperando decisão" : "aberta há mais de 24 horas"}: ${c.pedido ? `pedido ${c.pedido}` : `romaneio ${c.romaneio}`}`, [c.erro, c.usuario].filter(Boolean).join(" · "), c.criado_em, "/conferencia", ["conferencia_gestao"]);
  });
  await parte("inventário", () => {
    for (const i of todos("SELECT id, descricao, data_prevista FROM inventarios WHERE etapa = 'PROGRAMADO' AND data_prevista < ?", agora().slice(0, 10)))
      add("P", "Inventário programado atrasado", `#${i.id} ${i.descricao}`, i.data_prevista, "/inventario/programacao", ["inventario_gestao"]);
    for (const i of todos(`SELECT * FROM (SELECT i.id, i.descricao, i.etapa, MAX(COALESCE(i.snapshot_em, ''), COALESCE((SELECT MAX(recebido_em) FROM leituras l WHERE l.inv_id = i.id), ''), COALESCE((SELECT MAX(em) FROM log g WHERE g.inv_id = i.id), '')) ult
      FROM inventarios i WHERE i.etapa NOT IN ('PROGRAMADO','ENCERRADO','CANCELADO')) WHERE ult < ?`, ha(72 * H))) add("P", "Inventário parado há mais de 3 dias", `#${i.id} ${i.descricao} · ${i.etapa}`, i.ult, `/inventario/${i.id}`, ["inventario_gestao"]);
  });
  await parte("empresas", async () => { for (const r of (await empresas()).rotinas) if (!r.codemp) add("P", `Rotina sem empresa: ${r.nome}`, "Não grava até escolher em Sistema.", "", "/sistema", ["gestao"]); });
  await parte("auditoria", () => {
    const de = ha(7 * 24 * H);
    for (const x of todos(`SELECT e.trace, MIN(e.em) em, GROUP_CONCAT(DISTINCT e.tabela) tabs, MAX(e.usuario) usuario FROM auditoria_erp e LEFT JOIN auditoria_tx t ON t.tx = e.tx
      WHERE e.em >= ? AND e.em < ? AND (t.tx IS NULL OR t.estado = 'INCERTO') GROUP BY e.tx`, de, ha(120_000)))
      add("E", "Gravação no Lieto sem confirmação", `${x.tabs} · ${x.usuario} · confira no Lieto antes de repetir (some após 7 dias)`, x.em, x.trace ? `/auditoria?trace=${x.trace}` : "/auditoria", ["auditoria"]);
    for (const x of todos("SELECT a.trace, a.rota, a.em, a.usuario FROM auditoria a LEFT JOIN auditoria_fim f ON f.trace = a.trace WHERE f.trace IS NULL AND a.em >= ? AND a.em < ?", de, ha(600_000)))
      add("E", "Ação sem conclusão registrada", `${x.rota} · ${x.usuario} · o servidor parou no meio (some após 7 dias)`, x.em, `/auditoria?trace=${x.trace}`, ["auditoria"]);
    const n = todos("SELECT COUNT(*) n, MAX(em) em FROM auditoria_fim WHERE status IN (401, 403) AND erro <> 'Sem sessão' AND em >= ?", agora().slice(0, 10))[0];
    if (n.n) add("A", `${n.n} acesso(s) recusado(s) hoje`, "Senha inválida ou sem liberação.", n.em, "/auditoria?resultado=erro", ["auditoria"]);
  });
  const tem = new Set(PM.de(u)), ord = { E: 0, P: 1, A: 2 };
  const alertas = l.filter((a) => PM.ehAdmin(u) || a.rotinas.some((r) => tem.has(r))).sort((a, b) => ord[a.nivel] - ord[b.nivel] || (a.em || "9").localeCompare(b.em || "9"));
  return { em: agora(), alertas, falhas, parcial: !PM.ehAdmin(u) };
}
