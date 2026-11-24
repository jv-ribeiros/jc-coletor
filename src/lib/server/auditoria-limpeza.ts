// Limpeza manual da auditoria (só administrador): cópia obrigatória, 90 dias protegidos, e o que não tem confirmação do Lieto não sai.
// O registro da limpeza (auditoria_limpeza) nunca é apagado.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { db, tx } from "./db";
import { Erro, agora, type Usuario } from "./comum";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const pasta = () => path.join(process.env.OPS_DATA || path.join(process.cwd(), "data"), "auditoria-copias");
const limite = () => new Date(Date.now() - 90 * 864e5).toLocaleDateString("sv-SE");
function corte(v: unknown) {
  const d = String(v || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Erro("Informe a data.");
  if (d > limite()) throw new Erro("Os últimos 90 dias não podem ser limpos.");
  return d;
}
const INC = "SELECT e.trace FROM auditoria_erp e LEFT JOIN auditoria_tx t ON t.tx = e.tx WHERE e.em < ? AND (t.tx IS NULL OR t.estado NOT IN ('COMMIT','ROLLBACK'))";
const ACOES = `auditoria WHERE em < ? AND trace IN (SELECT trace FROM auditoria_fim) AND trace NOT IN (${INC})`;
// gravações das ações que saem, e as sem ação que já terminaram
const ERP = `auditoria_erp WHERE em < ? AND tx IN (SELECT tx FROM auditoria_tx WHERE estado IN ('COMMIT','ROLLBACK')) AND (trace = '' OR trace IN (SELECT trace FROM ${ACOES}))`;
const conta = (d: string) => ({ acoes: (db().prepare(`SELECT COUNT(*) n FROM ${ACOES}`).get(d, d) as Row).n as number, erp: (db().prepare(`SELECT COUNT(*) n FROM ${ERP}`).get(d, d, d) as Row).n as number });

export const previa = (d: unknown) => { const c = corte(d); return { antes: c, limite: limite(), ...conta(c) }; };
export const limites = () => ({ limite: limite() });

export function copiar(b: Row) {
  const d = corte(b.antes), l: string[] = [];
  const junta = (tabela: string, sql: string, ...a: string[]) => { for (const r of db().prepare(sql).all(...a) as Row[]) l.push(JSON.stringify({ _t: tabela, ...r })); };
  junta("auditoria", `SELECT * FROM ${ACOES} ORDER BY id`, d, d);
  junta("auditoria_fim", `SELECT * FROM auditoria_fim WHERE trace IN (SELECT trace FROM ${ACOES})`, d, d);
  junta("auditoria_erp", `SELECT * FROM ${ERP} ORDER BY id`, d, d, d);
  junta("auditoria_tx", `SELECT * FROM auditoria_tx WHERE tx IN (SELECT tx FROM ${ERP})`, d, d, d);
  if (!l.length) throw new Erro("Nada anterior a esta data.");
  const conteudo = l.join("\n") + "\n", sha = createHash("sha256").update(conteudo).digest("hex"), nome = `auditoria_antes_${d}_${sha.slice(0, 12)}.jsonl`;
  fs.mkdirSync(pasta(), { recursive: true });
  fs.writeFileSync(path.join(pasta(), nome), conteudo); // fica também no servidor
  return { nome, sha, antes: d, ...conta(d) };
}
const arquivo = (nome: unknown) => {
  const n = String(nome || "");
  if (!/^auditoria_antes_\d{4}-\d{2}-\d{2}_[0-9a-f]{12}\.jsonl$/.test(n) || !fs.existsSync(path.join(pasta(), n))) throw new Erro("Cópia não encontrada. Baixe de novo.", 404);
  return { nome: n, conteudo: fs.readFileSync(path.join(pasta(), n), "utf8") };
};
export const baixar = (nome: unknown) => arquivo(nome);

export function limpar(b: Row, u: Usuario) {
  const d = corte(b.antes), motivo = String(b.motivo || "").trim().slice(0, 500), a = arquivo(b.nome), sha = createHash("sha256").update(a.conteudo).digest("hex");
  if (!motivo) throw new Erro("Informe o motivo.");
  if (String(b.confirmacao || "").trim().toUpperCase() !== "LIMPAR AUDITORIA") throw new Erro("Digite LIMPAR AUDITORIA para confirmar.");
  if (!a.nome.startsWith(`auditoria_antes_${d}_`) || sha !== b.sha) throw new Erro("A cópia não confere com esta limpeza. Baixe de novo.");
  return tx(() => {
    const n = conta(d), copia = { acoes: 0, erp: 0 };
    for (const x of a.conteudo.split("\n")) { if (x.startsWith('{"_t":"auditoria",')) copia.acoes++; else if (x.startsWith('{"_t":"auditoria_erp",')) copia.erp++; }
    if (copia.acoes !== n.acoes || copia.erp !== n.erp) throw new Erro("Os registros mudaram depois da cópia. Baixe de novo.", 409);
    // a trava abre e volta dentro da mesma transação
    const tg = db().prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name IN ('auditoria_nao_delete','auditoria_fim_nao_delete','auditoria_erp_nao_delete','auditoria_tx_nao_delete')").all() as { name: string; sql: string }[];
    for (const t of tg) db().exec(`DROP TRIGGER ${t.name}`);
    db().prepare(`DELETE FROM auditoria_tx WHERE tx IN (SELECT tx FROM ${ERP})`).run(d, d, d);
    // o tx já saiu: apaga as gravações sem tx que pertencem às ações da cópia
    const ids = a.conteudo.split("\n").filter((x) => x.startsWith('{"_t":"auditoria_erp",')).map((x) => Number(JSON.parse(x).id));
    const de = db().prepare("DELETE FROM auditoria_erp WHERE id = ?"), da = db().prepare("DELETE FROM auditoria WHERE trace = ?"), df = db().prepare("DELETE FROM auditoria_fim WHERE trace = ?");
    for (const i of ids) de.run(i);
    for (const x of a.conteudo.split("\n")) if (x.startsWith('{"_t":"auditoria",')) { const t = JSON.parse(x).trace; df.run(t); da.run(t); }
    for (const t of tg) db().exec(t.sql);
    db().prepare("INSERT INTO auditoria_limpeza (em, codfun, usuario, antes, acoes, erp, motivo, copia, sha) VALUES (?,?,?,?,?,?,?,?,?)").run(agora(), u.codfun, u.nome, d, n.acoes, n.erp, motivo, a.nome, sha);
    return { ...n, em: agora(), usuario: u.nome };
  });
}
