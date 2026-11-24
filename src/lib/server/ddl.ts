// Guarda de conformidade do banco do Lieto.
//
// Cada rotina declara os objetos do Firebird de que depende (tabelas, procedures, generators).
// De cada objeto tiramos uma "impressão digital" (texto canônico da estrutura + SHA-256):
//   tabela    -> colunas (tipo, tamanho, escala, precisão, charset, NOT NULL), chaves/índices e triggers (com o fonte)
//   procedure -> parâmetros + fonte
//   generator -> existência
// A estrutura homologada fica em ddl-homologado.json. No startup (e antes de cada gravação, com cache curto)
// o sistema compara a estrutura atual com a homologada. Se divergir, a rotina fica BLOQUEADA para gravação no Lieto
// e a gestão mostra o alerta com o que mudou. Só um administrador (config.admins) homologa a nova estrutura.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type * as FB from "node-firebird";
import { comConexao, consultar, lerBlob, num, txt } from "./fb";

export type Rotina = { id: string; nome: string; tabelas: string[]; procedures?: string[]; generators?: string[] };

// Tabelas lidas no cálculo de saldo (mesma regra da SP_ESTOQUE)
const SALDO = ["EMPRESAS", "PRODUTOS", "MESTOQUE", "ENTRADAS1", "ENTRADAS2", "DEVOLUCOES1", "DEVOLUCOES2", "NOTAS1", "NOTAS2", "PEDIDOS1", "PEDIDOS2", "CUPOM"];

export const ROTINAS: Rotina[] = [
  { id: "acesso", nome: "Acesso (login com usuário do Lieto)", tabelas: ["FUNCIONARIOS"] },
  { id: "inventario", nome: "Inventário", tabelas: [...SALDO, "GRUPOS", "SUBGRUPOS", "TERGRUPOS"], procedures: ["SP_ESTOQUE"], generators: ["GEN_MESTOQUE"] },
  { id: "producao", nome: "Produção", tabelas: [...SALDO, "PRODUCOES", "CONJUNTOS", "LOTESENTRADAS", "FUNCIONARIOS"], generators: ["GEN_MESTOQUE"] },
  { id: "transferencia", nome: "Transferência", tabelas: ["MESTOQUE", "PRODUTOS", "CCUSTOS"], generators: ["GEN_MESTOQUE"] },
  { id: "transformacao", nome: "Transformação (CX ↔ UN)", tabelas: [...SALDO, "PRODUCOES", "CONJUNTOS"], generators: ["GEN_MESTOQUE"] },
  { id: "xml", nome: "Importação de XML", tabelas: [...SALDO, "CLIENTES", "CIDADES", "TIPOSCLIENTES", "VENDEDORES", "CONDICOES", "CORRENTISTAS", "OPERACOES", "NBM", "TRIBUTACAOCBS", "PEDIDOS3", "PEDIDOS4", "NOTAS3", "RECEBER", "RECEBIMENTOS", "FLUXO"],
    generators: ["GEN_PEDIDOS1", "GEN_PEDIDOS2", "GEN_PEDIDOS4", "GEN_NOTAS2", "GEN_RECEBER", "GEN_RECEBIMENTOS", "GEN_FLUXO"] },
  { id: "cadastro", nome: "Cadastro (coletor)", tabelas: ["PRODUTOS", "PRODUTOSSIMILARES", "JCLOG_PRODUTOS", "CONJUNTOS"] },
  { id: "retorno", nome: "Retorno de mercadorias", tabelas: ["MESTOQUE", "PRODUTOS", "PRODUTOSSIMILARES", "RETORNOS1", "RETORNOS2", "MOTORISTAS", "MOTIVOS", "CCUSTOS", "PEDIDOS1", "PEDIDOS2", "ROMANEIOS"], generators: ["GEN_MESTOQUE", "GEN_RETORNOS1"] },
  { id: "conferencia", nome: "Conferência de expedição", tabelas: ["CONFERENCIAS", "CONFERENCIAS1", "PEDIDOS1", "PEDIDOS2", "PRODUTOS", "PRODUTOSSIMILARES", "CLIENTES"], generators: ["GEN_CONFERENCIAS"] },
  { id: "perda", nome: "Perdas", tabelas: ["MESTOQUE", "PRODUTOS", "MOTIVOS"], generators: ["GEN_MESTOQUE"] },
  { id: "kit", nome: "Kit", tabelas: ["MESTOQUE", "PRODUTOS"], generators: ["GEN_MESTOQUE"] },
];

const ARQ = () => process.env.OPS_DDL || path.join(process.cwd(), "ddl-homologado.json");
type Objeto = { hash: string; texto: string };
type Homologado = { versaoLieto: number; homologadoEm: string; homologadoPor: string; objetos: Record<string, Objeto> };

const h = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const chaves = () => {
  const s = new Set<string>();
  for (const r of ROTINAS) {
    r.tabelas.forEach((t) => s.add("TABLE " + t));
    r.procedures?.forEach((p) => s.add("PROCEDURE " + p));
    r.generators?.forEach((g) => s.add("GENERATOR " + g));
  }
  return [...s].sort();
};

// ---------- leitura da estrutura atual ----------
async function lerEstrutura(db: FB.Database): Promise<{ versaoLieto: number; objetos: Record<string, Objeto> }> {
  const ks = chaves();
  const tabs = ks.filter((k) => k.startsWith("TABLE ")).map((k) => k.slice(6));
  const procs = ks.filter((k) => k.startsWith("PROCEDURE ")).map((k) => k.slice(10));
  const gens = ks.filter((k) => k.startsWith("GENERATOR ")).map((k) => k.slice(10));
  const inList = (xs: string[]) => xs.map((x) => `'${x}'`).join(",");
  const objetos: Record<string, Objeto> = {};

  const linhas = new Map<string, string[]>();
  const add = (k: string, l: string) => { if (!linhas.has(k)) linhas.set(k, []); linhas.get(k)!.push(l); };

  if (tabs.length) {
    const cols = await consultar(db, `select rf.rdb$relation_name t, rf.rdb$field_name c, f.rdb$field_type tp, f.rdb$field_sub_type st,
        f.rdb$field_length ln, f.rdb$field_scale sc, f.rdb$field_precision pr, f.rdb$character_set_id cs,
        coalesce(rf.rdb$null_flag, f.rdb$null_flag, 0) nn
      from rdb$relation_fields rf join rdb$fields f on f.rdb$field_name = rf.rdb$field_source
      where rf.rdb$relation_name in (${inList(tabs)})`);
    for (const c of cols) add("TABLE " + txt(c.T), `COL ${txt(c.C)} ${num(c.TP)}/${num(c.ST)} len=${num(c.LN)} sc=${num(c.SC)} pr=${num(c.PR)} cs=${num(c.CS)}${num(c.NN) ? " NOT NULL" : ""}`);
    const idx = await consultar(db, `select i.rdb$relation_name t, i.rdb$index_name n, coalesce(i.rdb$unique_flag, 0) u, coalesce(i.rdb$index_inactive, 0) ina, s.rdb$field_name f, s.rdb$field_position p
      from rdb$indices i left join rdb$index_segments s on s.rdb$index_name = i.rdb$index_name
      where i.rdb$relation_name in (${inList(tabs)}) order by i.rdb$index_name, s.rdb$field_position`);
    const porIdx = new Map<string, { t: string; u: number; ina: number; fs: string[] }>();
    for (const x of idx) {
      const n = txt(x.N);
      if (!porIdx.has(n)) porIdx.set(n, { t: txt(x.T), u: num(x.U), ina: num(x.INA), fs: [] });
      if (x.F != null) porIdx.get(n)!.fs.push(txt(x.F));
    }
    // nomes de índices automáticos (RDB$...) mudam a cada backup/restore: identifica pelo conteúdo
    for (const [n, x] of porIdx) add("TABLE " + x.t, `IDX ${n.startsWith("RDB$") ? "(auto)" : n} (${x.fs.join(",")})${x.u ? " UNIQUE" : ""}${x.ina ? " INATIVO" : ""}`);
    const trg = await consultar(db, `select rdb$relation_name t, rdb$trigger_name n, rdb$trigger_type tp, rdb$trigger_sequence sq,
        coalesce(rdb$trigger_inactive, 0) ina, rdb$trigger_source src
      from rdb$triggers where rdb$relation_name in (${inList(tabs)}) and coalesce(rdb$system_flag, 0) = 0`);
    for (const x of trg) {
      const fonte = (await lerBlob(x.SRC)).replace(/\s+/g, " ").trim();
      add("TABLE " + txt(x.T), `TRIGGER ${txt(x.N)} tipo=${num(x.TP)} pos=${num(x.SQ)}${num(x.INA) ? " INATIVO" : ""} fonte=${h(fonte)}`);
    }
    for (const t of tabs) if (!linhas.has("TABLE " + t)) add("TABLE " + t, "(TABELA NÃO EXISTE)");
  }

  for (const p of procs) {
    const r = (await consultar(db, "select rdb$procedure_source src from rdb$procedures where rdb$procedure_name = ?", [p]))[0];
    if (!r) { add("PROCEDURE " + p, "(PROCEDURE NÃO EXISTE)"); continue; }
    const pars = await consultar(db, `select pp.rdb$parameter_name n, pp.rdb$parameter_type io, f.rdb$field_type tp, f.rdb$field_length ln, f.rdb$field_scale sc
      from rdb$procedure_parameters pp join rdb$fields f on f.rdb$field_name = pp.rdb$field_source where pp.rdb$procedure_name = ? order by pp.rdb$parameter_type, pp.rdb$parameter_number`, [p]);
    for (const x of pars) add("PROCEDURE " + p, `PARAM ${num(x.IO) ? "OUT" : "IN"} ${txt(x.N)} ${num(x.TP)} len=${num(x.LN)} sc=${num(x.SC)}`);
    add("PROCEDURE " + p, `FONTE ${h((await lerBlob(r.SRC)).replace(/\s+/g, " ").trim())}`);
  }

  if (gens.length) {
    const g = new Set((await consultar(db, `select rdb$generator_name n from rdb$generators where rdb$generator_name in (${inList(gens)})`)).map((x) => txt(x.N)));
    for (const n of gens) add("GENERATOR " + n, g.has(n) ? "EXISTE" : "(GENERATOR NÃO EXISTE)");
  }

  for (const [k, ls] of linhas) { const texto = ls.sort().join("\n"); objetos[k] = { hash: h(texto), texto }; }
  const versaoLieto = num((await consultar(db, "select max(versao) v from versao"))[0]?.V);
  return { versaoLieto, objetos };
}

// ---------- comparação ----------
export type Diferenca = { objeto: string; tipo: "ALTERADO" | "NOVO" | "SEM BASE"; removido: string[]; incluido: string[] };
export type StatusRotina = { id: string; nome: string; ok: boolean; diferencas: Diferenca[] };
export type Status = {
  verificadoEm: string; erro: string | null; homologado: boolean; homologadoEm?: string; homologadoPor?: string;
  versaoLieto: number | null; versaoHomologada: number | null; rotinas: StatusRotina[];
};

function lerHomologado(): Homologado | null {
  try { return JSON.parse(fs.readFileSync(ARQ(), "utf8")); } catch { return null; }
}

function comparar(atual: Record<string, Objeto>, base: Homologado | null): Map<string, Diferenca> {
  const difs = new Map<string, Diferenca>();
  for (const k of chaves()) {
    const a = atual[k], b = base?.objetos[k];
    if (!b) { difs.set(k, { objeto: k, tipo: "SEM BASE", removido: [], incluido: [] }); continue; }
    if (a && a.hash === b.hash) continue;
    const la = new Set((a?.texto || "").split("\n")), lb = new Set(b.texto.split("\n"));
    difs.set(k, { objeto: k, tipo: "ALTERADO", removido: [...lb].filter((x) => x && !la.has(x)), incluido: [...la].filter((x) => x && !lb.has(x)) });
  }
  return difs;
}

const g = globalThis as unknown as { __ddl?: { status: Status; em: number } };
const agoraTxt = () => new Date().toLocaleString("sv-SE").replace("T", " ");

export async function verificar(): Promise<Status> {
  const base = lerHomologado();
  let status: Status;
  try {
    const { versaoLieto, objetos } = await comConexao(lerEstrutura);
    const difs = comparar(objetos, base);
    const rotinas = ROTINAS.map((r) => {
      const ks = [...r.tabelas.map((t) => "TABLE " + t), ...(r.procedures || []).map((p) => "PROCEDURE " + p), ...(r.generators || []).map((x) => "GENERATOR " + x)];
      const diferencas = ks.map((k) => difs.get(k)).filter(Boolean) as Diferenca[];
      return { id: r.id, nome: r.nome, ok: !!base && diferencas.length === 0, diferencas };
    });
    status = { verificadoEm: agoraTxt(), erro: null, homologado: !!base, homologadoEm: base?.homologadoEm, homologadoPor: base?.homologadoPor,
      versaoLieto, versaoHomologada: base?.versaoLieto ?? null, rotinas };
  } catch (e) {
    status = { verificadoEm: agoraTxt(), erro: (e as Error).message, homologado: !!base, versaoLieto: null, versaoHomologada: base?.versaoLieto ?? null,
      rotinas: ROTINAS.map((r) => ({ id: r.id, nome: r.nome, ok: false, diferencas: [] })) };
  }
  g.__ddl = { status, em: Date.now() };
  return status;
}

export async function status(maxIdadeMs = 60_000): Promise<Status> {
  if (g.__ddl && Date.now() - g.__ddl.em < maxIdadeMs) return g.__ddl.status;
  return verificar();
}

export class Bloqueio extends Error { status = 423; }

// Chamar antes de QUALQUER gravação no Lieto. Reconfere a estrutura (cache de 60 s).
export async function exigir(rotina: string) {
  const s = await status();
  const r = s.rotinas.find((x) => x.id === rotina);
  if (!r) throw new Bloqueio(`Rotina "${rotina}" sem mapeamento de DDL: gravação bloqueada.`);
  if (s.erro) throw new Bloqueio("Não foi possível conferir a estrutura do banco do Lieto: " + s.erro);
  if (!s.homologado) throw new Bloqueio("Estrutura do banco ainda não homologada. Um administrador precisa homologar em Sistema › Conformidade do banco.");
  if (!r.ok) throw new Bloqueio(`O banco do Lieto mudou e não está em conformidade com a rotina "${r.nome}" (${r.diferencas.map((d) => d.objeto).join(", ")}). Gravação bloqueada até a homologação.`);
}

// Grava a estrutura atual como a homologada (ação de administrador).
export async function homologar(usuario: string) {
  const { versaoLieto, objetos } = await comConexao(lerEstrutura);
  const anterior = lerHomologado();
  if (anterior) fs.copyFileSync(ARQ(), ARQ().replace(/\.json$/, `.${Date.now()}.bak.json`));
  const novo: Homologado = { versaoLieto, homologadoEm: agoraTxt(), homologadoPor: usuario, objetos };
  fs.writeFileSync(ARQ(), JSON.stringify(novo, null, 1));
  return verificar();
}
