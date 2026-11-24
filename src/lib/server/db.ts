import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

// Configuração lida a cada chamada: editar o config.json não exige rebuild.
export type Config = {
  empresa: string;
  admins?: number[];
  firebird: { host: string; port: number; database: string; user: string; password: string; encoding?: string };
  estoque: { modest: number; calculo?: "auto" | "procedure" | "sql"; pedent?: string };
  cadastro?: { codfor?: number; aceitarSemTrigger?: boolean; campoCaixa?: "QNTCAI" | "LOTECO" };
  xml?: { importadas?: string };
  producao?: { lancamentoAutomatico?: boolean; bloquearSaldoNegativo?: boolean };
  regras: { toleranciaQtd: number; toleranciaPct: number; exigirLocal: boolean; exigirEquipeDiferente: boolean };
  lancamento: { codfun: number | null; obs: string };
};
// OPS_CONFIG: outro arquivo de configuração (ex.: base de teste) sem mexer no config.json
export const getConfig = (): Config => JSON.parse(fs.readFileSync(process.env.OPS_CONFIG || path.join(process.cwd(), "config.json"), "utf8"));

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS inventarios (
  id INTEGER PRIMARY KEY, descricao TEXT NOT NULL, etapa TEXT NOT NULL DEFAULT 'CONTAGEM',
  origem TEXT, codemp INTEGER, nomemp TEXT, data_saldo TEXT, snapshot_em TEXT, criado_por TEXT,
  tol_qtd REAL, tol_pct REAL, parecer TEXT, parecer_por TEXT, parecer_em TEXT,
  lancado_em TEXT, lancado_por TEXT, lancado_modo TEXT, encerrado_em TEXT, encerrado_por TEXT);
CREATE TABLE IF NOT EXISTS itens (
  inv_id INTEGER, codpro TEXT, codint TEXT, nompro TEXT, unipro TEXT, codbar TEXT, coddum TEXT, eantri TEXT,
  grupo TEXT, subgrupo TEXT, local_erp TEXT, precus REAL, saldo REAL,
  c1 REAL, c2 REAL, c3 REAL, final REAL, situacao TEXT, justificativa TEXT, auditado_por TEXT, auditado_em TEXT,
  PRIMARY KEY (inv_id, codpro));
CREATE TABLE IF NOT EXISTS codigos (inv_id INTEGER, chave TEXT, codpro TEXT, PRIMARY KEY (inv_id, chave));
CREATE TABLE IF NOT EXISTS leituras (
  id INTEGER PRIMARY KEY, uid TEXT UNIQUE, inv_id INTEGER, etapa INTEGER, local TEXT, codpro TEXT, codigo TEXT,
  qtd REAL, usuario TEXT, dispositivo TEXT, lido_em TEXT, recebido_em TEXT,
  cancelada INTEGER DEFAULT 0, cancelada_por TEXT, cancelada_em TEXT);
CREATE INDEX IF NOT EXISTS ix_leit ON leituras (inv_id, etapa, codpro);
CREATE TABLE IF NOT EXISTS lancamentos (
  id INTEGER PRIMARY KEY, inv_id INTEGER, codpro TEXT, saldo REAL, atual REAL, final REAL,
  ajuste REAL, entsai TEXT, precus REAL, valor REAL, codide INTEGER, em TEXT, usuario TEXT);
CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY, inv_id INTEGER, em TEXT, usuario TEXT, acao TEXT, detalhe TEXT);
CREATE TABLE IF NOT EXISTS eventos (id INTEGER PRIMARY KEY, em TEXT, modulo TEXT, ref TEXT, codfun INTEGER, usuario TEXT, acao TEXT, detalhe TEXT);
CREATE INDEX IF NOT EXISTS ix_eventos ON eventos (modulo, ref);
CREATE TABLE IF NOT EXISTS producoes (
  id INTEGER PRIMARY KEY, uid TEXT UNIQUE, codpro TEXT NOT NULL, nompro TEXT, unipro TEXT, qtd REAL NOT NULL, lote TEXT, data TEXT NOT NULL, obs TEXT,
  status TEXT NOT NULL DEFAULT 'PENDENTE', erro TEXT, insumos TEXT, custo REAL,
  codfun INTEGER, usuario TEXT, dispositivo TEXT, criado_em TEXT,
  numide INTEGER, lancado_em TEXT, lancado_por TEXT, tentativas INTEGER DEFAULT 0,
  cancelado_em TEXT, cancelado_por TEXT, motivo_cancel TEXT);
CREATE INDEX IF NOT EXISTS ix_prod_status ON producoes (status, data);
CREATE TABLE IF NOT EXISTS movs (
  id INTEGER PRIMARY KEY, uid TEXT UNIQUE, tipo TEXT NOT NULL, resumo TEXT, linhas TEXT NOT NULL, pedido INTEGER, item INTEGER, qtd REAL, estorno_de INTEGER,
  status TEXT NOT NULL, erro TEXT, codfun INTEGER, usuario TEXT, criado_em TEXT, lancado_em TEXT);
CREATE INDEX IF NOT EXISTS ix_movs ON movs (tipo, item);
CREATE TABLE IF NOT EXISTS auditoria (id INTEGER PRIMARY KEY, trace TEXT UNIQUE, em TEXT, origem TEXT, rota TEXT, ref TEXT, codfun INTEGER, usuario TEXT, ip TEXT, dispositivo TEXT, dados TEXT);
CREATE TABLE IF NOT EXISTS auditoria_fim (trace TEXT PRIMARY KEY, em TEXT, status INTEGER, erro TEXT, resultado TEXT, ms INTEGER);
CREATE TABLE IF NOT EXISTS auditoria_erp (id INTEGER PRIMARY KEY, tx TEXT, trace TEXT, em TEXT, origem TEXT, codfun INTEGER, usuario TEXT, operacao TEXT, tabela TEXT, sql TEXT, params TEXT, antes TEXT);
CREATE TABLE IF NOT EXISTS auditoria_tx (tx TEXT PRIMARY KEY, em TEXT, estado TEXT, erro TEXT);
CREATE INDEX IF NOT EXISTS ix_aud_em ON auditoria (em);
CREATE INDEX IF NOT EXISTS ix_aud_erp ON auditoria_erp (trace);
CREATE INDEX IF NOT EXISTS ix_aud_tx ON auditoria_erp (tx);
CREATE TRIGGER IF NOT EXISTS auditoria_nao_update BEFORE UPDATE ON auditoria BEGIN SELECT RAISE(ABORT, 'Auditoria não pode ser alterada nem apagada'); END;
CREATE TRIGGER IF NOT EXISTS auditoria_nao_delete BEFORE DELETE ON auditoria BEGIN SELECT RAISE(ABORT, 'Auditoria não pode ser alterada nem apagada'); END;
CREATE TRIGGER IF NOT EXISTS auditoria_fim_nao_update BEFORE UPDATE ON auditoria_fim BEGIN SELECT RAISE(ABORT, 'Auditoria não pode ser alterada nem apagada'); END;
CREATE TRIGGER IF NOT EXISTS auditoria_fim_nao_delete BEFORE DELETE ON auditoria_fim BEGIN SELECT RAISE(ABORT, 'Auditoria não pode ser alterada nem apagada'); END;
CREATE TRIGGER IF NOT EXISTS auditoria_erp_nao_update BEFORE UPDATE ON auditoria_erp BEGIN SELECT RAISE(ABORT, 'Auditoria não pode ser alterada nem apagada'); END;
CREATE TRIGGER IF NOT EXISTS auditoria_erp_nao_delete BEFORE DELETE ON auditoria_erp BEGIN SELECT RAISE(ABORT, 'Auditoria não pode ser alterada nem apagada'); END;
CREATE TRIGGER IF NOT EXISTS auditoria_tx_nao_update BEFORE UPDATE ON auditoria_tx BEGIN SELECT RAISE(ABORT, 'Auditoria não pode ser alterada nem apagada'); END;
CREATE TRIGGER IF NOT EXISTS auditoria_tx_nao_delete BEFORE DELETE ON auditoria_tx BEGIN SELECT RAISE(ABORT, 'Auditoria não pode ser alterada nem apagada'); END;
CREATE TABLE IF NOT EXISTS auditoria_limpeza (id INTEGER PRIMARY KEY, em TEXT, codfun INTEGER, usuario TEXT, antes TEXT, acoes INTEGER, erp INTEGER, motivo TEXT, copia TEXT, sha TEXT);
CREATE TRIGGER IF NOT EXISTS auditoria_limpeza_nao_update BEFORE UPDATE ON auditoria_limpeza BEGIN SELECT RAISE(ABORT, 'Auditoria não pode ser alterada nem apagada'); END;
CREATE TRIGGER IF NOT EXISTS auditoria_limpeza_nao_delete BEFORE DELETE ON auditoria_limpeza BEGIN SELECT RAISE(ABORT, 'Auditoria não pode ser alterada nem apagada'); END;
CREATE TABLE IF NOT EXISTS observacoes (id INTEGER PRIMARY KEY, modulo TEXT, ref TEXT, texto TEXT, por TEXT, em TEXT);
CREATE TABLE IF NOT EXISTS opcoes (chave TEXT PRIMARY KEY, valor TEXT);
CREATE TABLE IF NOT EXISTS xmls (chave TEXT PRIMARY KEY, arquivo TEXT, conteudo TEXT, numero INTEGER, serie TEXT, emissao TEXT, valor REAL, recebido_em TEXT);
CREATE TABLE IF NOT EXISTS xml_cancelados (chave TEXT PRIMARY KEY, em TEXT);
CREATE TABLE IF NOT EXISTS xml_depara (emitente TEXT, cprod TEXT, un TEXT, codpro TEXT, fator REAL, por TEXT, em TEXT, PRIMARY KEY (emitente, cprod, un));
CREATE TABLE IF NOT EXISTS paletes (codpro TEXT PRIMARY KEY, camadas INTEGER, caixas INTEGER, obs TEXT, por TEXT, em TEXT);
CREATE TABLE IF NOT EXISTS permissoes (codfun INTEGER, rotina TEXT, PRIMARY KEY (codfun, rotina));
CREATE TABLE IF NOT EXISTS conferencias (id INTEGER PRIMARY KEY, pedido INTEGER, romaneio INTEGER, cliente TEXT, itens TEXT NOT NULL, status TEXT NOT NULL, erro TEXT, numide INTEGER,
  codfun INTEGER, usuario TEXT, criado_em TEXT, fim_em TEXT, fim_por TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS ux_conf_aberta ON conferencias (pedido) WHERE status IN ('CONTANDO','RECONTANDO');
CREATE UNIQUE INDEX IF NOT EXISTS ux_conf_rom ON conferencias (romaneio) WHERE pedido IS NULL AND status IN ('CONTANDO','RECONTANDO');
CREATE TABLE IF NOT EXISTS conf_leituras (uid TEXT PRIMARY KEY, conf_id INTEGER, codpro TEXT, qtd REAL, modo TEXT, usuario TEXT, em TEXT);
CREATE TABLE IF NOT EXISTS sessoes (token TEXT PRIMARY KEY, codfun INTEGER, nome TEXT, nomfun TEXT, criado_em TEXT, visto_em TEXT);
`;

// colunas adicionadas depois da 1ª versão (bancos existentes são atualizados)
const COLUNAS = ["ALTER TABLE eventos ADD COLUMN trace TEXT", "ALTER TABLE inventarios ADD COLUMN uid TEXT", "ALTER TABLE movs ADD COLUMN obs TEXT", "ALTER TABLE movs ADD COLUMN obs_fim TEXT", "ALTER TABLE conferencias ADD COLUMN obs TEXT", "ALTER TABLE conferencias ADD COLUMN obs_fim TEXT", "ALTER TABLE xmls ADD COLUMN obs TEXT", "ALTER TABLE inventarios ADD COLUMN obs_lanc TEXT", "ALTER TABLE movs ADD COLUMN codemp INTEGER", "ALTER TABLE producoes ADD COLUMN codemp INTEGER", "ALTER TABLE codigos ADD COLUMN fator REAL DEFAULT 1", "ALTER TABLE conferencias ADD COLUMN pedidos TEXT", "ALTER TABLE conferencias ADD COLUMN numides TEXT", "ALTER TABLE movs ADD COLUMN extra TEXT", "ALTER TABLE xmls ADD COLUMN status TEXT", "ALTER TABLE xmls ADD COLUMN arquivado TEXT", "ALTER TABLE xmls ADD COLUMN erro TEXT", "ALTER TABLE xmls ADD COLUMN pedido INTEGER", "ALTER TABLE xmls ADD COLUMN importado_em TEXT", "ALTER TABLE inventarios ADD COLUMN escopo TEXT", "ALTER TABLE itens ADD COLUMN marca TEXT", "ALTER TABLE itens ADD COLUMN tipo TEXT", "ALTER TABLE itens ADD COLUMN sit_ant TEXT",
      "ALTER TABLE itens ADD COLUMN decisao TEXT", "ALTER TABLE inventarios ADD COLUMN data_prevista TEXT", "ALTER TABLE inventarios ADD COLUMN responsavel TEXT",
      "ALTER TABLE inventarios ADD COLUMN obs TEXT", "ALTER TABLE inventarios ADD COLUMN etapa_inicial TEXT", "ALTER TABLE inventarios ADD COLUMN origem_inv INTEGER"];

const g = globalThis as unknown as { __invDb?: DatabaseSync; __invSchema?: string };
export function db(): DatabaseSync {
  if (!g.__invDb) {
    // getBuiltinModule evita que o bundler tente empacotar o node:sqlite
    const { DatabaseSync: Db } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
    const dir = process.env.OPS_DATA || path.join(process.cwd(), "data"); // OPS_DATA: SQLite separado para testes
    fs.mkdirSync(dir, { recursive: true });
    g.__invDb = new Db(path.join(dir, "operacoes.db"));
  }
  // Aplica tabelas e colunas novas ao abrir E quando mudam: no servidor de desenvolvimento a conexão sobrevive ao hot reload.
  const versao = SCHEMA + COLUNAS.join();
  if (g.__invSchema !== versao) {
    g.__invDb.exec(SCHEMA);
    for (const sql of COLUNAS) { try { g.__invDb.exec(sql); } catch (e) { if (!/duplicate column/i.test((e as Error).message)) throw e; } }
    g.__invSchema = versao;
  }
  return g.__invDb;
}

export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try { const r = fn(); d.exec("COMMIT"); return r; } catch (e) { d.exec("ROLLBACK"); throw e; }
}
