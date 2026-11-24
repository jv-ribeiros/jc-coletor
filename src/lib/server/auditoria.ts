// Auditoria: do pedido da tela até a gravação no Lieto, ligados pelo mesmo TRACE.
//   auditoria      cada ação (tela/coletor ou automática): quem, de onde, o que enviou    auditoria_fim  como terminou
//   auditoria_erp  cada INSERT/UPDATE/DELETE no Lieto, gravado ANTES do commit, com o antes  auditoria_tx   COMMIT / ROLLBACK / INCERTO
// Só inclusão: gatilhos do SQLite recusam alterar ou apagar. Ação sem auditoria_fim ou gravação sem auditoria_tx = servidor caiu no meio.
// Se não der para auditar, a gravação no Lieto não acontece.
import { randomUUID } from "node:crypto";
import { db } from "./db";

type Als = import("node:async_hooks").AsyncLocalStorage<Ctx>;
export type Ctx = { trace: string; origem: string; codfun: number | null; usuario: string };
const g = globalThis as unknown as { __audAls?: Als };
const als = (): Als => (g.__audAls ??= new (process.getBuiltinModule("node:async_hooks") as typeof import("node:async_hooks")).AsyncLocalStorage<Ctx>());
export const ctx = (): Ctx => als().getStore() ?? { trace: "", origem: "AUTOMATICO", codfun: null, usuario: "AUTOMÁTICO" };

const pad = (n: number, t = 2) => String(n).padStart(t, "0");
const agoraMs = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`; };

// Senhas e tokens nunca entram; textos enormes (XML, CSV) entram só com o tamanho.
const SEGREDO = /senha|password|token|secret/i;
export function limpo(v: unknown, max = 20_000): string {
  const s = JSON.stringify(v ?? null, (k, x) => (k && SEGREDO.test(k) ? "***" : typeof x === "function" ? "[texto longo]" : typeof x === "string" && x.length > 2000 ? `[${x.length} caracteres] ${x.slice(0, 200)}` : x)) ?? "null";
  return s.length > max ? `${s.slice(0, max)}… [${s.length} caracteres]` : s;
}

type Acao = { origem: string; rota: string; ref?: string; codfun?: number | null; usuario?: string; ip?: string; dispositivo?: string; dados?: unknown };
function abrir(a: Acao): Ctx {
  const c: Ctx = { trace: randomUUID(), origem: a.origem, codfun: a.codfun ?? null, usuario: a.usuario || "" };
  db().prepare("INSERT INTO auditoria (trace, em, origem, rota, ref, codfun, usuario, ip, dispositivo, dados) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(c.trace, agoraMs(), c.origem, a.rota, a.ref || "", c.codfun, c.usuario, a.ip || "", (a.dispositivo || "").slice(0, 200), limpo(a.dados));
  return c;
}
function fechar(c: Ctx, t0: number, status: number, resultado: unknown, erro: string) {
  try { db().prepare("INSERT INTO auditoria_fim (trace, em, status, erro, resultado, ms) VALUES (?,?,?,?,?,?)").run(c.trace, agoraMs(), status, erro || null, limpo(resultado, 2000), Date.now() - t0); }
  catch (e) { console.error("[AUDITORIA] fim:", (e as Error).message); } // a ação já aconteceu: fica como "sem fim"
}
// Roda a ação com a auditoria aberta: tudo que ela gravar no Lieto leva o mesmo trace.
export async function auditar<T>(a: Acao, fn: () => T | Promise<T>): Promise<T> {
  const c = abrir(a), t0 = Date.now();
  return als().run(c, async () => {
    try { const r = await fn(); fechar(c, t0, 200, r, ""); return r; }
    catch (e) { fechar(c, t0, (e as { status?: number }).status || 500, null, (e as Error).message); throw e; }
  });
}
// Fato pontual (ex.: acesso negado, XML recebido)
export function marco(a: Acao, status = 200, erro = "") { const c = abrir({ ...a, codfun: a.codfun ?? ctx().codfun, usuario: a.usuario ?? ctx().usuario }); fechar(c, Date.now(), status, null, erro); }

// ---------- gravações no Lieto ----------
const trans = new WeakMap<object, string>();
export const iniciarTx = (t: object) => { trans.set(t, randomUUID()); };
export const ehEscrita = (sql: string) => /^\s*(insert|update|delete|merge|execute)\b/i.test(sql);
type Ler = (sql: string, params: unknown[]) => Promise<unknown[]>;
export async function escrita(t: object, sql: string, params: unknown[], ler: Ler) {
  const c = ctx(), m = /^\s*(insert\s+into|update|delete\s+from)\s+([a-z0-9_$]+)/i.exec(sql), op = (m?.[1] || "EXECUTE").split(/\s/)[0].toUpperCase(), tabela = (m?.[2] || "").toUpperCase();
  let antes: string | null = null;
  if (op === "UPDATE" || op === "DELETE") {
    const i = sql.toLowerCase().lastIndexOf(" where ");
    if (i > 0) antes = limpo(await ler(`select first 20 * from ${tabela}${sql.slice(i)}`, params.slice((sql.slice(0, i).match(/\?/g) || []).length)));
  }
  db().prepare("INSERT INTO auditoria_erp (tx, trace, em, origem, codfun, usuario, operacao, tabela, sql, params, antes) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(trans.get(t) ?? "SEM TRANSACAO", c.trace, agoraMs(), c.origem, c.codfun, c.usuario, op, tabela, sql.replace(/\s+/g, " ").trim(), limpo(params), antes);
}
export function fimTx(t: object, estado: "COMMIT" | "ROLLBACK" | "INCERTO", erro = "") {
  const id = trans.get(t);
  if (!id) return;
  try { if (db().prepare("SELECT 1 FROM auditoria_erp WHERE tx = ? LIMIT 1").get(id)) db().prepare("INSERT INTO auditoria_tx (tx, em, estado, erro) VALUES (?,?,?,?)").run(id, agoraMs(), estado, erro || null); }
  catch (e) { console.error("[AUDITORIA] transação:", (e as Error).message); }
}
