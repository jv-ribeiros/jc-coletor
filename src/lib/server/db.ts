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
CREATE TABLE IF NOT EXISTS xml_kit (emitente TEXT, cprod TEXT, un TEXT, codpro TEXT, qtd REAL, PRIMARY KEY (emitente, cprod, un, codpro));
CREATE TABLE IF NOT EXISTS xml_linhas (chave TEXT, n INTEGER, peds TEXT, PRIMARY KEY (chave, n));
CREATE TABLE IF NOT EXISTS paletes (codpro TEXT PRIMARY KEY, camadas INTEGER, caixas INTEGER, obs TEXT, por TEXT, em TEXT);
CREATE TABLE IF NOT EXISTS permissoes (codfun INTEGER, rotina TEXT, PRIMARY KEY (codfun, rotina));
CREATE TABLE IF NOT EXISTS conferencias (id INTEGER PRIMARY KEY, pedido INTEGER, romaneio INTEGER, cliente TEXT, itens TEXT NOT NULL, status TEXT NOT NULL, erro TEXT, numide INTEGER,
  codfun INTEGER, usuario TEXT, criado_em TEXT, fim_em TEXT, fim_por TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS ux_conf_aberta ON conferencias (pedido) WHERE status IN ('CONTANDO','RECONTANDO');
CREATE UNIQUE INDEX IF NOT EXISTS ux_conf_rom ON conferencias (romaneio) WHERE pedido IS NULL AND status IN ('CONTANDO','RECONTANDO');
CREATE TABLE IF NOT EXISTS conf_volumes (id INTEGER PRIMARY KEY, romaneio INTEGER, pedido INTEGER, esperado INTEGER, contado INTEGER, corrigido INTEGER, usuario TEXT, em TEXT);
CREATE TABLE IF NOT EXISTS conf_leituras (uid TEXT PRIMARY KEY, conf_id INTEGER, codpro TEXT, qtd REAL, modo TEXT, usuario TEXT, em TEXT);
-- recebimento de compra: a contagem fica aqui (nada é gravado no Lieto); a nota de entrada é vinculada depois, no painel
CREATE TABLE IF NOT EXISTS recebimentos (id INTEGER PRIMARY KEY, pedido INTEGER NOT NULL, codfor INTEGER, fornecedor TEXT, pedfor TEXT, itens TEXT NOT NULL, modo TEXT NOT NULL, status TEXT NOT NULL,
  codfun INTEGER, usuario TEXT, criado_em TEXT, fechado_em TEXT, rec_por TEXT, rec_em TEXT, fim_em TEXT, fim_por TEXT, obs_fim TEXT, restante INTEGER DEFAULT 0, origem INTEGER,
  chave_nfe TEXT, nota_numdoc INTEGER, nota TEXT, nota_como TEXT, nota_por TEXT, nota_em TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS ux_rec_aberto ON recebimentos (pedido) WHERE status IN ('CONTANDO','RECONTANDO');
CREATE UNIQUE INDEX IF NOT EXISTS ux_rec_nota ON recebimentos (nota_numdoc) WHERE nota_numdoc IS NOT NULL AND status <> 'CANCELADO';
CREATE TABLE IF NOT EXISTS rec_leituras (uid TEXT PRIMARY KEY, rec_id INTEGER, codpro TEXT, codigo TEXT, qtd REAL, modo TEXT, validade TEXT, lote TEXT, etapa INTEGER, usuario TEXT, em TEXT);
CREATE TABLE IF NOT EXISTS sem_validade (codpro TEXT PRIMARY KEY, por TEXT, em TEXT);
CREATE TABLE IF NOT EXISTS sessoes (token TEXT PRIMARY KEY, codfun INTEGER, nome TEXT, nomfun TEXT, criado_em TEXT, visto_em TEXT);
CREATE TABLE IF NOT EXISTS inv_fixas (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, regra TEXT NOT NULL, inicio TEXT NOT NULL, ultima TEXT, codemp INTEGER, nomemp TEXT, escopo TEXT,
  etapa TEXT, responsavel TEXT, antecipar INTEGER DEFAULT 1, obs TEXT, ativa INTEGER DEFAULT 1, criada_por TEXT, criada_em TEXT, encerrada_por TEXT, encerrada_em TEXT);
CREATE TABLE IF NOT EXISTS impressoras (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, onde TEXT NOT NULL, pc TEXT, fila TEXT, ip TEXT, porta INTEGER, tipo TEXT NOT NULL, dpi INTEGER, largura REAL, altura REAL,
  ultimo_em TEXT, ultimo_ok INTEGER, ultimo_msg TEXT, por TEXT, em TEXT);
CREATE TABLE IF NOT EXISTS impressoes (id INTEGER PRIMARY KEY, em TEXT, impressora INTEGER, nome TEXT, oque TEXT, n INTEGER, ok INTEGER, msg TEXT, usuario TEXT);
`;

// colunas adicionadas depois da 1ª versão (bancos existentes são atualizados)
const COLUNAS = ["ALTER TABLE conferencias ADD COLUMN modo TEXT", "ALTER TABLE conferencias ADD COLUMN aguarda_em TEXT", "ALTER TABLE eventos ADD COLUMN trace TEXT", "ALTER TABLE inventarios ADD COLUMN uid TEXT", "ALTER TABLE movs ADD COLUMN obs TEXT", "ALTER TABLE movs ADD COLUMN obs_fim TEXT", "ALTER TABLE conferencias ADD COLUMN obs TEXT", "ALTER TABLE conferencias ADD COLUMN obs_fim TEXT", "ALTER TABLE xmls ADD COLUMN obs TEXT", "ALTER TABLE inventarios ADD COLUMN obs_lanc TEXT", "ALTER TABLE movs ADD COLUMN codemp INTEGER", "ALTER TABLE producoes ADD COLUMN codemp INTEGER", "ALTER TABLE codigos ADD COLUMN fator REAL DEFAULT 1", "ALTER TABLE conferencias ADD COLUMN pedidos TEXT", "ALTER TABLE conferencias ADD COLUMN numides TEXT", "ALTER TABLE movs ADD COLUMN extra TEXT", "ALTER TABLE xmls ADD COLUMN status TEXT", "ALTER TABLE xmls ADD COLUMN arquivado TEXT", "ALTER TABLE xmls ADD COLUMN erro TEXT", "ALTER TABLE xmls ADD COLUMN pedido INTEGER", "ALTER TABLE xmls ADD COLUMN importado_em TEXT", "ALTER TABLE inventarios ADD COLUMN escopo TEXT", "ALTER TABLE itens ADD COLUMN marca TEXT", "ALTER TABLE itens ADD COLUMN tipo TEXT", "ALTER TABLE itens ADD COLUMN sit_ant TEXT",
      "ALTER TABLE itens ADD COLUMN decisao TEXT", "ALTER TABLE inventarios ADD COLUMN data_prevista TEXT", "ALTER TABLE inventarios ADD COLUMN antecipar INTEGER DEFAULT 1", "ALTER TABLE inventarios ADD COLUMN responsavel TEXT",
      "ALTER TABLE inventarios ADD COLUMN obs TEXT", "ALTER TABLE inventarios ADD COLUMN etapa_inicial TEXT", "ALTER TABLE inventarios ADD COLUMN origem_inv INTEGER",
      "ALTER TABLE inventarios ADD COLUMN motivo_cancel TEXT", "ALTER TABLE inventarios ADD COLUMN etapa_cancel TEXT", "ALTER TABLE inventarios ADD COLUMN fixa_id INTEGER", "ALTER TABLE producoes ADD COLUMN validade TEXT",
      "CREATE UNIQUE INDEX IF NOT EXISTS ux_fixa_pendente ON inventarios (fixa_id) WHERE etapa = 'PROGRAMADO' AND fixa_id IS NOT NULL"];

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
    migrar(g.__invDb);
    g.__invSchema = versao;
  }
  return g.__invDb;
}

// Migrações de dados, uma vez cada (marca em opcoes).
function migrar(d: DatabaseSync) {
  const feita = (k: string) => !!d.prepare("SELECT 1 FROM opcoes WHERE chave = ?").get(`migracao.${k}`);
  const marcar = (k: string) => d.prepare("INSERT OR IGNORE INTO opcoes (chave, valor) VALUES (?, datetime('now','localtime'))").run(`migracao.${k}`);
  // 1.2.9: o modo da expedição passa a ser do usuário ("ver quantidade e local"). Ninguém muda de modo: se o Sistema estava em
  // Separação (ou nunca foi mudado), quem confere ganha a liberação; se estava em Cega, ninguém ganha.
  if (!feita("conferencia_ver")) {
    const modo = (d.prepare("SELECT valor FROM opcoes WHERE chave = 'conferencia.modo'").get() as { valor?: string } | undefined)?.valor;
    d.exec("BEGIN IMMEDIATE");
    try {
      if (modo !== "CEGA") d.prepare("INSERT OR IGNORE INTO permissoes (codfun, rotina) SELECT codfun, 'conferencia_ver' FROM permissoes WHERE rotina = 'conferencia'").run();
      marcar("conferencia_ver"); d.exec("COMMIT");
    } catch (e) { d.exec("ROLLBACK"); throw e; }
  }
}

export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try { const r = fn(); d.exec("COMMIT"); return r; } catch (e) { d.exec("ROLLBACK"); throw e; }
}
