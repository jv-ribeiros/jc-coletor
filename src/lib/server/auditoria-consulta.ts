// Consulta da auditoria (só leitura).
import { db } from "./db";
import { Erro } from "./comum";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ESTADO = `(SELECT CASE WHEN COUNT(*) = 0 THEN '' WHEN SUM(t.tx IS NULL OR t.estado = 'INCERTO') > 0 THEN 'SEM CONFIRMACAO' WHEN SUM(t.estado = 'ROLLBACK') > 0 THEN 'DESFEITO' ELSE 'GRAVADO' END
  FROM auditoria_erp e LEFT JOIN auditoria_tx t ON t.tx = e.tx WHERE e.trace = a.trace)`;

export function listar(q: URLSearchParams) {
  const w: string[] = ["a.em >= ?", "a.em < ?"], dia = /^\d{4}-\d{2}-\d{2}$/, hoje = new Date().toLocaleDateString("sv-SE");
  const de = dia.test(q.get("de") || "") ? q.get("de")! : hoje, ate = dia.test(q.get("ate") || "") ? q.get("ate")! : hoje, args: (string | number)[] = [de, ate + "~"];
  if (q.get("usuario")) { w.push("a.usuario = ?"); args.push(q.get("usuario")!); }
  if (q.get("rota")) { w.push("a.rota = ?"); args.push(q.get("rota")!); }
  const r = q.get("resultado");
  if (r === "erro") w.push("(f.status >= 400 OR EXISTS (SELECT 1 FROM auditoria_erp e JOIN auditoria_tx t ON t.tx = e.tx WHERE e.trace = a.trace AND t.estado = 'ROLLBACK'))");
  if (r === "semconf") w.push(`(f.trace IS NULL OR ${ESTADO} = 'SEM CONFIRMACAO')`);
  const b = (q.get("q") || "").trim();
  if (b) {
    const k = `%${b.replace(/[!%_]/g, "!$&")}%`;
    w.push("(a.ref LIKE ? ESCAPE '!' OR a.dados LIKE ? ESCAPE '!' OR f.resultado LIKE ? ESCAPE '!' OR f.erro LIKE ? ESCAPE '!' OR EXISTS (SELECT 1 FROM auditoria_erp e WHERE e.trace = a.trace AND (e.params LIKE ? ESCAPE '!' OR e.antes LIKE ? ESCAPE '!')))");
    args.push(k, k, k, k, k, k);
  }
  const from = `FROM auditoria a LEFT JOIN auditoria_fim f ON f.trace = a.trace WHERE ${w.join(" AND ")}`;
  const total = (db().prepare(`SELECT COUNT(*) n ${from}`).get(...args) as Row).n as number;
  const por = Math.min(5000, Math.max(1, Number(q.get("por")) || 50)), paginas = Math.max(1, Math.ceil(total / por)), pagina = Math.min(paginas, Math.max(1, Number(q.get("pag")) || 1));
  const linhas = db().prepare(`SELECT a.trace, a.em, a.origem, a.rota, a.ref, a.codfun, a.usuario, a.ip, a.dispositivo, f.status, f.erro, f.ms,
    (SELECT COUNT(*) FROM auditoria_erp e WHERE e.trace = a.trace) erp, ${ESTADO} estado ${from} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...args, por, (pagina - 1) * por);
  const dist = (c: string) => (db().prepare(`SELECT DISTINCT ${c} v FROM auditoria WHERE ${c} <> '' ORDER BY 1`).all() as Row[]).map((x) => x.v as string);
  return { total, paginas, pagina, linhas, usuarios: dist("usuario"), rotas: dist("rota") };
}

export function obter(trace: string) {
  const acao = db().prepare("SELECT * FROM auditoria WHERE trace = ?").get(trace) as Row | undefined;
  if (!acao) throw new Erro("Registro não encontrado.", 404);
  return { acao, fim: db().prepare("SELECT * FROM auditoria_fim WHERE trace = ?").get(trace) ?? null,
    eventos: db().prepare("SELECT em, modulo, ref, usuario, acao, detalhe FROM eventos WHERE trace = ? ORDER BY id").all(trace),
    erp: db().prepare("SELECT e.*, t.estado, t.em estado_em, t.erro estado_erro FROM auditoria_erp e LEFT JOIN auditoria_tx t ON t.tx = e.tx WHERE e.trace = ? ORDER BY e.id").all(trace) };
}
