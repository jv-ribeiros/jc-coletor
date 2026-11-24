// Acesso só com a senha do usuário no Lieto (tabela FUNCIONARIOS).
// A sessão é um token aleatório guardado no SQLite; o navegador manda no cabeçalho x-sessao.
import { randomBytes } from "node:crypto";
import { db } from "./db";
import * as erp from "./erp";
import { Erro, agora } from "./inventario";

export type Usuario = { codfun: number; nome: string; nomfun: string };

// Sem código não há como travar por usuário, e as senhas são curtas: trava global.
// 15 erros em 5 minutos (somando todos os aparelhos) => novas tentativas só depois de 1 minuto.
let erros: number[] = [], travadoAte = 0;

export async function entrar(body: Record<string, unknown>) {
  const senha = String(body.senha ?? "");
  if (!senha.trim()) throw new Erro("Informe a senha do Lieto.");
  if (Date.now() < travadoAte) throw new Erro(`Muitas tentativas. Aguarde ${Math.ceil((travadoAte - Date.now()) / 1000)}s.`, 429);
  // conta a tentativa ANTES de consultar: pedidos simultâneos não furam a trava
  const t = Date.now();
  erros = erros.filter((x) => t - x < 300_000); erros.push(t);
  if (erros.length >= 15) { travadoAte = t + 60_000; erros = []; }
  const r = await erp.validarSenha(senha);
  if (!r.ok) throw new Erro(r.erro, 401);
  const k = erros.indexOf(t); if (k >= 0) erros.splice(k, 1); // acerto não conta
  const token = randomBytes(24).toString("base64url"), em = agora();
  db().prepare("INSERT INTO sessoes (token, codfun, nome, nomfun, criado_em, visto_em) VALUES (?,?,?,?,?,?)").run(token, r.codfun, r.nome, r.nomfun, em, em);
  return { token, usuario: { codfun: r.codfun, nome: r.nome, nomfun: r.nomfun } };
}

const vistos = new Map<string, number>();
export function validar(token: string | null): Usuario | null {
  if (!token) return null;
  const s = db().prepare("SELECT codfun, nome, nomfun FROM sessoes WHERE token = ?").get(token) as Usuario | undefined;
  if (!s) return null;
  // atualiza "visto em" no máximo 1x por minuto
  if (Date.now() - (vistos.get(token) || 0) > 60_000) { vistos.set(token, Date.now()); db().prepare("UPDATE sessoes SET visto_em = ? WHERE token = ?").run(agora(), token); }
  return s;
}

export function sair(token: string | null) {
  if (token) db().prepare("DELETE FROM sessoes WHERE token = ?").run(token);
}
