// Acesso ao banco do Lieto (Firebird 2.x). Conexão curta por operação; escrita sempre em transação única.
import * as FB from "node-firebird";
import * as A from "./auditoria";
import { getConfig } from "./db";

// node-firebird é CommonJS: dependendo do bundler o módulo vem em .default ou direto
export const Firebird = ((FB as unknown as { default?: typeof FB }).default ?? FB) as typeof FB;

export type Row = Record<string, unknown>;
export type Conexao = FB.Database | FB.Transaction;

export function conectar(): Promise<FB.Database> {
  const fb = getConfig().firebird;
  const opt = {
    host: fb.host, port: fb.port, database: fb.database, user: fb.user, password: fb.password,
    encoding: fb.encoding || "WIN1252", lowercase_keys: false,
    pluginName: Firebird.AUTH_PLUGIN_LEGACY, wireCrypt: Firebird.WIRE_CRYPT_DISABLE,
  } as FB.Options;
  return new Promise((ok, erro) => Firebird.attach(opt, (e, db) => (e ? erro(new Error("ERP: " + e.message)) : ok(db))));
}

const bruto = (db: Conexao, sql: string, params: unknown[] = []) =>
  new Promise<Row[]>((ok, erro) => db.query(sql, params as never[], (e, r) => (e ? erro(new Error("ERP: " + e.message)) : ok((r as unknown as Row[]) || []))));

export async function consultar(db: Conexao, sql: string, params: unknown[] = []): Promise<Row[]> {
  if (A.ehEscrita(sql)) await A.escrita(db, sql, params, (s, p) => bruto(db, s, p));
  return bruto(db, sql, params);
}

// Toda gravação passa por aqui: textos vão em MAIÚSCULO, como no Lieto.
// INSERT ... RETURNING devolve um objeto (não uma lista)
export async function executar(db: Conexao, sql: string, params: unknown[] = []): Promise<Row | null> {
  const ps = params.map((p) => (typeof p === "string" ? p.toUpperCase() : p));
  if (A.ehEscrita(sql)) await A.escrita(db, sql, ps, (s, p) => bruto(db, s, p)); // antes de gravar: sem auditoria não grava
  return new Promise<Row | null>((ok, erro) => db.query(sql, ps as never[], (e, r) => (e ? erro(new Error("ERP: " + e.message)) : ok((r as unknown as Row) || null))));
}

export async function comConexao<T>(fn: (db: FB.Database) => Promise<T>): Promise<T> {
  const db = await conectar();
  try { return await fn(db); } finally { db.detach(); }
}

// Transação única: ou grava tudo, ou nada.
export async function emTransacao<T>(fn: (t: FB.Transaction) => Promise<T>): Promise<T> {
  const db = await conectar();
  const t = await new Promise<FB.Transaction>((ok, erro) => db.transaction(Firebird.ISOLATION_READ_COMMITTED, (e, tr) => (e ? erro(e) : ok(tr))));
  A.iniciarTx(t);
  let noCommit = false;
  try {
    const r = await fn(t);
    noCommit = true;
    await new Promise<void>((ok, erro) => t.commit((e) => (e ? erro(new Error("ERP: " + e.message)) : ok())));
    A.fimTx(t, "COMMIT");
    return r;
  } catch (e) {
    await new Promise<void>((ok) => t.rollback(() => ok()));
    A.fimTx(t, noCommit ? "INCERTO" : "ROLLBACK", (e as Error).message); // erro no commit: pode ter gravado
    throw e;
  } finally { db.detach(); }
}

// Campos BLOB chegam como função de leitura no node-firebird.
export function lerBlob(v: unknown): Promise<string> {
  if (v == null) return Promise.resolve("");
  if (typeof v !== "function") return Promise.resolve(String(v));
  return new Promise((ok, erro) => (v as (cb: (e: Error | null, n: string, ev: NodeJS.EventEmitter) => void) => void)((e, _n, ev) => {
    if (e) return erro(e);
    const partes: Buffer[] = [];
    ev.on("data", (c: Buffer) => partes.push(c));
    ev.on("end", () => ok(Buffer.concat(partes).toString("latin1")));
    ev.on("error", erro);
  }));
}

export const txt = (v: unknown) => (v == null ? "" : String(v).trim());
export const num = (v: unknown) => (v == null ? 0 : Number(v));
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const hoje = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
export const dataDe = (s: string) => { const [a, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(a, m - 1, d); };
