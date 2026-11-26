// Regras do rito: CONTAGEM > RECONTAGEM > AUDITORIA > LANÇAMENTO + PARECER
import { db, tx, getConfig } from "./db";
import * as erp from "./erp";
import * as ddl from "./ddl";
import { empresaDe } from "./empresas";
import type { ProdutoErp } from "./erp";
import { ESCOPO_VAZIO, descreverEscopo, escopoAtivo, filtrarEscopo, type Escopo } from "@/lib/escopo";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export class Erro extends Error { constructor(msg: string, public status = 400) { super(msg); } }

export const NUM_ETAPA: Record<string, number> = { CONTAGEM: 1, RECONTAGEM: 2, AUDITORIA: 3 };
export const DESC = "DESCONSIDERADO";
export const DECISOES: string[] = ["ACERTAR", "MANTER", "RECONTAR"];
const SEM_AJUSTE = (i: Row) => i.situacao === DESC || i.decisao === "MANTER" || i.decisao === "RECONTAR";
const JUST_DECISAO: Record<string, string> = { MANTER: "Mantido sem ajuste (fica o saldo do sistema)", RECONTAR: "Enviado para nova recontagem" };
const ETAPAS_INICIO = ["CONTAGEM", "RECONTAGEM", "AUDITORIA"];
const pad = (n: number) => String(n).padStart(2, "0");
export const agora = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
export const r4 = (x: unknown) => Math.round((Number(x) || 0) * 1e4) / 1e4;
export const chave = (c: unknown) => String(c ?? "").trim().toUpperCase().replace(/^0+(?=.)/, "");
const nome = (u: unknown) => String(u ?? "").trim().toUpperCase() || "GESTÃO";
const dentro = (contado: number, ref: number, inv: Row) =>
  Math.abs(contado - ref) <= Math.max(inv.tol_qtd || 0, (Math.abs(ref) * (inv.tol_pct || 0)) / 100) + 1e-9;

export const log = (inv: number, usuario: string, acao: string, detalhe: unknown = "") =>
  db().prepare("INSERT INTO log (inv_id, em, usuario, acao, detalhe) VALUES (?,?,?,?,?)")
    .run(inv, agora(), usuario || "", acao, typeof detalhe === "string" ? detalhe : JSON.stringify(detalhe));

export function getInv(id: unknown): Row {
  const inv = db().prepare("SELECT * FROM inventarios WHERE id = ?").get(Number(id)) as Row | undefined;
  if (!inv) throw new Erro("Inventário não encontrado.", 404);
  return inv;
}

// Avulso: nada é relacionado antes; só entra no rito o item lido (o não lido não vira zero nem gera ajuste).
export const ehAvulso = (inv: Row) => !!inv.escopo && !!(JSON.parse(inv.escopo) as Escopo).avulso;

// Itens no escopo (saldo ≠ 0 ou com leitura) + somatórios ao vivo por etapa.
export function itensView(id: number): Row[] {
  const itens = db().prepare("SELECT * FROM itens WHERE inv_id = ?").all(id) as Row[];
  const somas = db().prepare(`SELECT codpro, etapa, SUM(qtd) q, COUNT(*) n, GROUP_CONCAT(DISTINCT local) locais
    FROM leituras WHERE inv_id = ? AND cancelada = 0 GROUP BY codpro, etapa`).all(id) as Row[];
  const m = new Map<string, Row>();
  for (const s of somas) {
    if (!m.has(s.codpro)) m.set(s.codpro, {});
    m.get(s.codpro)![s.etapa] = { q: r4(s.q), n: s.n, locais: s.locais || "" };
  }
  const avulso = ehAvulso(getInv(id));
  return itens.filter((i) => (!avulso && i.saldo !== 0) || m.has(i.codpro) || i.final != null || i.situacao).map((i) => ({ ...i, l: m.get(i.codpro) || {} }));
}

// ---------- abertura ----------
async function lerOrigem(body: Row) {
  if (body.origem === "csv") return { produtos: parseCsv(String(body.csv || "")), origem: "CSV", codemp: null as number | null, dataSaldo: agora().slice(0, 10) };
  const codemp = Number(body.codemp);
  if (!codemp) throw new Erro("Escolha a empresa.");
  const dataSaldo = String(body.dataSaldo || agora().slice(0, 10));
  const [a, m, d] = dataSaldo.split("-").map(Number);
  return { produtos: await erp.lerProdutos(codemp, new Date(a, m - 1, d)), origem: "ERP", codemp, dataSaldo };
}

// Catálogo resumido para montar a lista de itens na tela (sem gravar nada).
export async function previa(body: Row) {
  const { produtos } = await lerOrigem(body);
  return produtos.map((p) => [p.codpro, p.nompro, p.unipro, p.grupo, p.subgrupo, p.marca, p.tipo, r4(p.saldo), r4(p.precus), p.codbar, p.local_erp || ""]);
}

type Meta = { descricao: string; origem: string; codemp: number | null; nomemp: string; dataSaldo: string; usuario: string; escopo: Escopo | null; etapa: string; origemInv?: number | null };

// Abre já congelando o saldo, ou só programa (sem ler o ERP) para uma data futura.
export async function abrir(body: Row) {
  if (Array.isArray(body.partes) && body.partes.length) return abrirPartes(body);
  const descricao = String(body.descricao || "").trim();
  if (!descricao) throw new Erro("Informe a descrição do inventário.");
  const escopo = escopoAtivo(body.escopo) ? (body.escopo as Escopo) : null;
  const etapa = ETAPAS_INICIO.includes(body.etapa) ? String(body.etapa) : "CONTAGEM";
  const usuario = nome(body.usuario);
  if (body.programar) return programar(body, { descricao, escopo, etapa, usuario });
  const { produtos: todos, origem, codemp, dataSaldo } = await lerOrigem(body);
  const produtos = filtrarEscopo(todos, escopo);
  if (!produtos.length) throw new Erro(escopo ? "Nenhum produto atende aos critérios escolhidos." : "Nenhum produto encontrado na origem.");
  return tx(() => ({ id: gravarInventario({ descricao, origem, codemp, nomemp: String(body.nomemp || ""), dataSaldo, usuario, escopo, etapa, origemInv: body.origemInv ?? null }, produtos) }));
}

// Aberto pelo coletor, sem relacionar itens. A empresa vem de Sistema › Empresa por rotina.
const nomemp = async (codemp: number) => { const e = (await erp.empresas()).find((x) => Number(x.codemp) === codemp); if (!e) throw new Erro(`Empresa ${codemp} não existe no Lieto.`); return String(e.nomemp); };
export async function empresaAvulso() { const codemp = empresaDe("inventario_avulso"); return { codemp, nomemp: await nomemp(codemp) }; }
const abrindoAvulso = new Map<string, Promise<{ id: number }>>();
export function abrirAvulso(body: Row): Promise<{ id: number }> {
  const descricao = String(body.descricao || "").trim().slice(0, 140), usuario = nome(body.usuario), uid = String(body.uid || "").replace(/[^\w-]/g, "").slice(0, 40);
  if (!descricao) throw new Erro("Informe o nome.");
  if (!uid) throw new Erro("Identificador ausente.");
  // reenvio (rede caiu, toque duplo): não abre outro
  const ja = db().prepare("SELECT id FROM inventarios WHERE uid = ?").get(uid) as { id: number } | undefined;
  if (ja) return Promise.resolve(ja);
  const em = abrindoAvulso.get(uid);
  if (em) return em;
  const p = (async () => {
    const e = await empresaAvulso(), { produtos, origem, codemp, dataSaldo } = await lerOrigem({ origem: "erp", codemp: e.codemp });
    if (!produtos.length) throw new Erro("Nenhum produto encontrado no Lieto.");
    return tx(() => {
      const id = gravarInventario({ descricao, origem, codemp, nomemp: e.nomemp, dataSaldo, usuario, escopo: { ...ESCOPO_VAZIO, avulso: true }, etapa: "CONTAGEM" }, produtos);
      db().prepare("UPDATE inventarios SET uid = ?, obs = ? WHERE id = ?").run(uid, String(body.obs || "").trim().slice(0, 500) || null, id);
      return { id };
    });
  })().finally(() => abrindoAvulso.delete(uid));
  abrindoAvulso.set(uid, p);
  return p;
}

// Lista dividida em partes: cada parte vira um inventário com a sua lista fixa de produtos (agora ou programado, com data e responsável próprios).
type Parte = { descricao: string; produtos: string[]; dataPrevista?: string; responsavel?: string };
async function abrirPartes(body: Row) {
  const partes = (body.partes as Row[]).map((p): Parte => ({ descricao: String(p.descricao || "").trim().slice(0, 140), produtos: [...new Set((Array.isArray(p.produtos) ? p.produtos : []).map(String))], dataPrevista: String(p.dataPrevista || ""), responsavel: String(p.responsavel || "").trim().toUpperCase() }));
  if (partes.length > 50) throw new Erro("No máximo 50 partes.");
  for (const p of partes) { if (!p.descricao) throw new Erro("Informe o nome de cada parte."); if (!p.produtos.length) throw new Erro(`${p.descricao}: parte sem produtos.`); if (body.programar && !DATA_OK.test(p.dataPrevista!)) throw new Erro(`${p.descricao}: informe a data.`); }
  const etapa = ETAPAS_INICIO.includes(body.etapa) ? String(body.etapa) : "CONTAGEM", usuario = nome(body.usuario), rotulo = String(body.rotulo || "Lista").slice(0, 120), filtros = body.filtros ?? null;
  const esc = (p: Parte, k: number): Escopo => ({ ...ESCOPO_VAZIO, produtos: p.produtos, rotulo: partes.length > 1 ? `${rotulo} · parte ${k + 1}/${partes.length}` : rotulo, filtros });
  if (body.programar) {
    const codemp = Number(body.codemp); if (!codemp) throw new Erro("Escolha a empresa.");
    const cfg = getConfig();
    return tx(() => {
      const ids = partes.map((p, k) => {
        const id = Number(db().prepare(`INSERT INTO inventarios (descricao, etapa, origem, codemp, nomemp, criado_por, tol_qtd, tol_pct, escopo, etapa_inicial, data_prevista, responsavel, obs, antecipar)
          VALUES (?, 'PROGRAMADO', 'ERP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(p.descricao, codemp, String(body.nomemp || ""), usuario, cfg.regras.toleranciaQtd || 0, cfg.regras.toleranciaPct || 0,
          JSON.stringify(esc(p, k)), etapa, p.dataPrevista!, p.responsavel || null, String(body.obs || "").trim() || null, body.antecipar === false ? 0 : 1).lastInsertRowid);
        log(id, usuario, "PROGRAMOU INVENTÁRIO", { dataPrevista: p.dataPrevista, escopo: descreverEscopo(esc(p, k)), etapaInicial: etapa, parte: `${k + 1}/${partes.length}` });
        return id;
      });
      return { id: ids[0], ids, programado: true };
    });
  }
  const { produtos: todos, origem, codemp, dataSaldo } = await lerOrigem(body);
  return tx(() => {
    const ids = partes.map((p, k) => {
      const lista = filtrarEscopo(todos, esc(p, k));
      if (!lista.length) throw new Erro(`${p.descricao}: nenhum produto encontrado na origem.`);
      return gravarInventario({ descricao: p.descricao, origem, codemp, nomemp: String(body.nomemp || ""), dataSaldo, usuario, escopo: esc(p, k), etapa }, lista);
    });
    return { id: ids[0], ids };
  });
}

// Grava cabeçalho + itens + códigos (chamar dentro de tx). Com idExistente, inicia um programado.
function gravarInventario(m: Meta, produtos: ProdutoErp[], idExistente?: number) {
  const cfg = getConfig(), em = agora();
  let id = idExistente;
  if (id) {
    db().prepare("UPDATE inventarios SET etapa = ?, origem = ?, data_saldo = ?, snapshot_em = ?, tol_qtd = ?, tol_pct = ?, etapa_inicial = ? WHERE id = ?")
      .run(m.etapa, m.origem, m.dataSaldo, em, cfg.regras.toleranciaQtd || 0, cfg.regras.toleranciaPct || 0, m.etapa, id);
  } else {
    id = Number(db().prepare(`INSERT INTO inventarios (descricao, etapa, origem, codemp, nomemp, data_saldo, snapshot_em, criado_por, tol_qtd, tol_pct, escopo, etapa_inicial, origem_inv)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(m.descricao, m.etapa, m.origem, m.codemp, m.nomemp, m.dataSaldo, em, m.usuario, cfg.regras.toleranciaQtd || 0, cfg.regras.toleranciaPct || 0,
      m.escopo ? JSON.stringify(m.escopo) : null, m.etapa, m.origemInv ?? null).lastInsertRowid);
  }
  // começando direto na recontagem/auditoria: entram na lista os itens com saldo e os escolhidos um a um
  const avulsos = new Set(m.escopo?.produtos || []);
  const sitIni = (p: ProdutoErp) => m.etapa === "CONTAGEM" ? null : p.saldo !== 0 || avulsos.has(p.codpro) ? (m.etapa === "RECONTAGEM" ? "RECONTAR" : "AUDITAR") : null;
  const insI = db().prepare(`INSERT OR REPLACE INTO itens (inv_id, codpro, codint, nompro, unipro, codbar, coddum, eantri, grupo, subgrupo, marca, tipo, local_erp, precus, saldo, situacao)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insC = db().prepare("INSERT OR IGNORE INTO codigos (inv_id, chave, codpro, fator) VALUES (?,?,?,?)");
  for (const p of produtos) insI.run(id, p.codpro, p.codint, p.nompro, p.unipro, p.codbar, p.coddum, p.eantri, p.grupo, p.subgrupo, p.marca, p.tipo, p.local_erp, r4(p.precus), r4(p.saldo), sitIni(p));
  // prioridade na leitura: código de barras > DUN > EAN tributável > código do produto
  for (const campo of ["codbar", "coddum", "eantri", "codpro"] as const)
    for (const p of produtos) if (p[campo]) insC.run(id, chave(p[campo]), p.codpro, 1);
  for (const p of produtos) for (const c of p.extras || []) insC.run(id, chave(c.cod), p.codpro, c.fator);
  log(id, m.usuario, idExistente ? "INICIOU INVENTÁRIO PROGRAMADO" : "ABERTURA", { origem: m.origem, codemp: m.codemp, dataSaldo: m.dataSaldo, produtos: produtos.length,
    escopo: descreverEscopo(m.escopo), etapaInicial: m.etapa, ...(m.origemInv ? { origemInv: m.origemInv } : {}) });
  return id;
}

// ---------- programação ----------
const isoLocal = (x: Date) => x.toLocaleDateString("sv-SE");
const addDias = (iso: string, d: number) => { const [a, m, dd] = iso.split("-").map(Number); return isoLocal(new Date(a, m - 1, dd + d)); };
const addMeses = (iso: string, n: number) => {
  const [a, m, dd] = iso.split("-").map(Number), ult = new Date(a, m - 1 + n + 1, 0).getDate();
  return isoLocal(new Date(a, m - 1 + n, Math.min(dd, ult)));
};
const fdataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const DATA_OK = /^\d{4}-\d{2}-\d{2}$/;

function programar(body: Row, b: { descricao: string; escopo: Escopo | null; etapa: string; usuario: string }) {
  if (body.origem === "csv") throw new Erro("A programação usa o saldo do ERP (o CSV só pode ser lido na hora de abrir).");
  const codemp = Number(body.codemp);
  if (!codemp) throw new Erro("Escolha a empresa.");
  const data = String(body.dataPrevista || "");
  if (!DATA_OK.test(data)) throw new Erro("Informe a data prevista.");
  const vezes = Math.min(Math.max(Number(body.vezes) || 1, 1), 24), passo = String(body.repetir || "");
  const datas = Array.from({ length: vezes }, (_, k) =>
    passo === "mensal" ? addMeses(data, k) : passo === "trimestral" ? addMeses(data, 3 * k) : passo ? addDias(data, k * Number(passo)) : data);
  const cfg = getConfig();
  return tx(() => {
    const ids = datas.map((d) => {
      const desc = vezes > 1 ? `${b.descricao} — ${fdataBr(d)}` : b.descricao;
      const id = Number(db().prepare(`INSERT INTO inventarios (descricao, etapa, origem, codemp, nomemp, criado_por, tol_qtd, tol_pct, escopo, etapa_inicial, data_prevista, responsavel, obs, antecipar)
        VALUES (?, 'PROGRAMADO', 'ERP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(desc, codemp, String(body.nomemp || ""), b.usuario, cfg.regras.toleranciaQtd || 0, cfg.regras.toleranciaPct || 0,
        b.escopo ? JSON.stringify(b.escopo) : null, b.etapa, d, String(body.responsavel || "").trim().toUpperCase() || null, String(body.obs || "").trim() || null, body.antecipar === false ? 0 : 1).lastInsertRowid);
      log(id, b.usuario, "PROGRAMOU INVENTÁRIO", { dataPrevista: d, escopo: descreverEscopo(b.escopo), etapaInicial: b.etapa });
      return id;
    });
    return { id: ids[0], ids, programado: true };
  });
}

export function editarProgramacao(id: number, body: Row) {
  const inv = getInv(id), usuario = nome(body.usuario);
  if (inv.etapa !== "PROGRAMADO") throw new Erro("Só inventários programados podem ser editados.");
  const data = String(body.dataPrevista ?? inv.data_prevista);
  if (!DATA_OK.test(data)) throw new Erro("Data prevista inválida.");
  let descricao = String(body.descricao ?? inv.descricao).trim();
  if (!descricao) throw new Erro("Informe a descrição.");
  if (inv.data_prevista && descricao.endsWith(` — ${fdataBr(inv.data_prevista)}`)) descricao = descricao.slice(0, -fdataBr(inv.data_prevista).length) + fdataBr(data);
  const etapa = ETAPAS_INICIO.includes(body.etapa) ? body.etapa : inv.etapa_inicial;
  const antecipar = body.antecipar === undefined ? inv.antecipar ?? 1 : body.antecipar ? 1 : 0;
  db().prepare("UPDATE inventarios SET descricao = ?, data_prevista = ?, responsavel = ?, obs = ?, etapa_inicial = ?, antecipar = ? WHERE id = ?")
    .run(descricao, data, String(body.responsavel ?? inv.responsavel ?? "").trim().toUpperCase() || null, String(body.obs ?? inv.obs ?? "").trim() || null, etapa, antecipar, id);
  log(id, usuario, "EDITOU PROGRAMAÇÃO", { dataPrevista: data, responsavel: body.responsavel ?? inv.responsavel, etapaInicial: etapa, podeAntecipar: !!antecipar });
}

export function excluirProgramacao(id: number) {
  const inv = getInv(id);
  if (inv.etapa !== "PROGRAMADO") throw new Erro("Só inventários programados (ainda não iniciados) podem ser excluídos.");
  tx(() => { db().prepare("DELETE FROM inventarios WHERE id = ?").run(id); db().prepare("DELETE FROM log WHERE inv_id = ?").run(id); });
}

// Inicia um programado: lê o ERP agora, congela o saldo e libera os coletores.
// ---------- programados no coletor ----------
export const programados = () => (db().prepare("SELECT id, descricao, nomemp, data_prevista, responsavel, obs, escopo, etapa_inicial, COALESCE(antecipar, 1) antecipar FROM inventarios WHERE etapa = 'PROGRAMADO' ORDER BY data_prevista, id").all() as Row[])
  .map(({ escopo, ...i }) => ({ ...i, itens: descreverEscopo(escopo ? JSON.parse(escopo) : null), hoje: agora().slice(0, 10) }));
// Quantos produtos entram (lê o Lieto, sem gravar nada)
export async function contarProgramado(id: number) {
  const inv = getInv(id);
  if (inv.etapa !== "PROGRAMADO") return { produtos: null, iniciado: true };
  const { produtos } = await lerOrigem({ origem: "erp", codemp: inv.codemp });
  return { produtos: filtrarEscopo(produtos, inv.escopo ? JSON.parse(inv.escopo) : null).length, iniciado: false };
}
// Começar pelo coletor: congela o saldo agora. Se outro aparelho começou junto, entra no mesmo.
const comecando = new Map<number, Promise<Row>>();
export function comecarNoColetor(id: number, usuario: string) {
  const ja = comecando.get(id); if (ja) return ja;
  const p = (async () => {
    const inv = getInv(id);
    if (inv.etapa !== "PROGRAMADO") return { id, etapa: inv.etapa, jaIniciado: true };
    const hoje = agora().slice(0, 10);
    if (inv.data_prevista > hoje && !(inv.antecipar ?? 1)) throw new Erro(`Este inventário só pode começar em ${fdataBr(inv.data_prevista)}.`);
    const r = await iniciar(id, { usuario });
    if (inv.data_prevista !== hoje) log(id, usuario, inv.data_prevista > hoje ? "ANTECIPOU PELO COLETOR" : "INICIOU ATRASADO PELO COLETOR", { dataPrevista: inv.data_prevista, iniciadoEm: hoje });
    return r;
  })().finally(() => comecando.delete(id));
  comecando.set(id, p);
  return p;
}

export async function iniciar(id: number, body: Row) {
  const inv = getInv(id), usuario = nome(body.usuario);
  if (inv.etapa !== "PROGRAMADO") throw new Erro("Este inventário já foi iniciado.");
  const escopo = inv.escopo ? (JSON.parse(inv.escopo) as Escopo) : null;
  const etapa = ETAPAS_INICIO.includes(body.etapa) ? String(body.etapa) : inv.etapa_inicial || "CONTAGEM";
  const { produtos: todos, origem, codemp, dataSaldo } = await lerOrigem({ origem: "erp", codemp: inv.codemp, dataSaldo: body.dataSaldo });
  const produtos = filtrarEscopo(todos, escopo);
  if (!produtos.length) throw new Erro("Nenhum produto atende aos critérios deste inventário.");
  tx(() => {
    if ((getInv(id) as Row).etapa !== "PROGRAMADO") throw new Erro("Este inventário já foi iniciado.");
    gravarInventario({ descricao: inv.descricao, origem, codemp, nomemp: inv.nomemp, dataSaldo, usuario, escopo, etapa }, produtos, id);
  });
  return { id, etapa };
}

// Itens que a auditoria mandou recontar viram um inventário novo, já na recontagem.
async function abrirRecontagem(inv: Row, codpros: string[], usuario: string): Promise<number> {
  const descricao = `Recontagem - #${inv.id} ${inv.descricao}`.slice(0, 140);
  const escopo: Escopo = { ...ESCOPO_VAZIO, produtos: codpros };
  if (inv.origem === "ERP" && inv.codemp) {
    const r = await abrir({ descricao, origem: "erp", codemp: inv.codemp, nomemp: inv.nomemp, escopo, etapa: "RECONTAGEM", usuario, origemInv: inv.id });
    return (r as Row).id;
  }
  // inventário de CSV: reaproveita a foto do original
  const set = new Set(codpros);
  const produtos = (db().prepare("SELECT * FROM itens WHERE inv_id = ?").all(inv.id) as Row[]).filter((i) => set.has(i.codpro)).map((i) => ({
    codpro: i.codpro, codint: i.codint || "", nompro: i.nompro, unipro: i.unipro, codbar: i.codbar || "", coddum: i.coddum || "", eantri: i.eantri || "",
    precus: i.precus, saldo: i.saldo, grupo: i.grupo || "", subgrupo: i.subgrupo || "", marca: i.marca || "", tipo: i.tipo || "", local_erp: i.local_erp || "",
  }) as ProdutoErp);
  return tx(() => gravarInventario({ descricao, origem: inv.origem, codemp: inv.codemp, nomemp: inv.nomemp, dataSaldo: inv.data_saldo, usuario, escopo, etapa: "RECONTAGEM", origemInv: inv.id }, produtos));
}

// CSV do relatório de estoque: CÓDIGO;PRODUTOS;UN;BARRAS;P.CUSTO;SALDO;...;GRUPOS;...;SUBGRUPOS
function parseCsv(texto: string): ProdutoErp[] {
  const n = (v: string) => Number(String(v || "0").replace(/\./g, "").replace(",", ".")) || 0;
  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) throw new Erro("Arquivo vazio.");
  const cab = linhas.shift()!.split(";").map((c) => c.trim().toUpperCase());
  const ix = (p: string) => cab.findIndex((c) => c.startsWith(p));
  const iCod = Math.max(0, ix("CÓD")), iNome = ix("PRODUTO"), iUn = ix("UN"), iBar = ix("BARRA"), iCus = ix("P.CUSTO"), iSal = ix("SALDO"), iGru = ix("GRUPO"), iSub = ix("SUBGRUPO");
  if (iNome < 0 || iSal < 0) throw new Erro("CSV não reconhecido: precisa das colunas PRODUTOS e SALDO.");
  const c = (l: string[], i: number) => (i >= 0 ? (l[i] || "").trim() : "");
  return linhas.map((l) => l.split(";")).filter((l) => c(l, iCod)).map((l) => ({
    codpro: c(l, iCod), codint: "", nompro: c(l, iNome), unipro: c(l, iUn), codbar: c(l, iBar), coddum: "", eantri: "",
    precus: n(c(l, iCus)), saldo: n(c(l, iSal)), grupo: c(l, iGru), subgrupo: c(l, iSub), marca: "", tipo: "", local_erp: "",
  }));
}

// ---------- leituras ----------
export function registrarLeituras(id: number, body: Row) {
  const inv = getInv(id), usuario = String(body.usuario || "").trim().toUpperCase();
  return (body.leituras || []).map((l: Row) => {
    try {
      if (!l.uid) throw new Erro("Leitura sem identificador.");
      const ja = db().prepare("SELECT codpro FROM leituras WHERE uid = ?").get(l.uid) as Row | undefined;
      if (ja) return { uid: l.uid, ok: true, codpro: ja.codpro }; // reenvio do coletor: idempotente
      return { uid: l.uid, ok: true, codpro: registrar(inv, l, usuario, body.dispositivo) };
    } catch (e) { return { uid: l.uid, ok: false, erro: (e as Error).message }; }
  });
}

function registrar(inv: Row, l: Row, usuario: string, dispositivo: string) {
  const cfg = getConfig(), etapa = NUM_ETAPA[inv.etapa];
  if (!etapa) throw new Erro(`Inventário em ${inv.etapa}: não aceita mais leituras.`);
  if (Number(l.etapa) !== etapa) throw new Erro(`Leitura da etapa ${l.etapa}, mas o inventário está em ${inv.etapa}.`);
  if (!usuario) throw new Erro("Operador não informado.");
  const local = String(l.local || "").trim().toUpperCase();
  if (cfg.regras.exigirLocal && !local) throw new Erro("Informe o local.");
  const qtd = Number(String(l.qtd).replace(",", "."));
  if (!Number.isFinite(qtd) || qtd < 0) throw new Erro("Quantidade inválida.");
  if (qtd > 999_999) throw new Erro("Quantidade acima do limite (999.999).");
  // item escolhido pela descrição/código no coletor vem com codpro; leitura de código de barras vem só com codigo
  const c = ((l.codpro && db().prepare("SELECT codpro FROM itens WHERE inv_id = ? AND codpro = ?").get(inv.id, String(l.codpro)))
    || db().prepare("SELECT codpro FROM codigos WHERE inv_id = ? AND chave = ?").get(inv.id, chave(l.codigo))) as Row | undefined;
  if (!c) throw new Erro(`Código ${l.codigo} não encontrado neste inventário.`);
  const item = db().prepare("SELECT situacao FROM itens WHERE inv_id = ? AND codpro = ?").get(inv.id, c.codpro) as Row;
  if (item.situacao === DESC) throw new Erro("Item desconsiderado deste inventário. Peça à gestão para reconsiderá-lo.");
  if (etapa === 2 && item.situacao !== "RECONTAR") throw new Erro("Item fora da lista de recontagem.");
  if (etapa === 3 && !["AUDITAR", "AUDITADO"].includes(item.situacao)) throw new Erro("Item fora da lista de auditoria.");
  if (etapa === 2 && cfg.regras.exigirEquipeDiferente) {
    const contou = db().prepare("SELECT 1 FROM leituras WHERE inv_id = ? AND etapa = 1 AND codpro = ? AND usuario = ? AND cancelada = 0").get(inv.id, c.codpro, usuario);
    if (contou) throw new Erro("Você contou este item. A recontagem deve ser feita por outra pessoa.");
  }
  // Auditoria grava a quantidade FINAL: a leitura mais nova do item substitui as anteriores (nunca soma).
  const lido = String(l.em || agora());
  let velha = false;
  if (etapa === 3) {
    velha = !!db().prepare("SELECT 1 FROM leituras WHERE inv_id = ? AND etapa = 3 AND codpro = ? AND cancelada = 0 AND lido_em > ?").get(inv.id, c.codpro, lido);
    if (!velha) db().prepare("UPDATE leituras SET cancelada = 1, cancelada_por = ?, cancelada_em = ? WHERE inv_id = ? AND etapa = 3 AND codpro = ? AND cancelada = 0").run(`${usuario} (nova quantidade final)`, agora(), inv.id, c.codpro);
  }
  db().prepare(`INSERT INTO leituras (uid, inv_id, etapa, local, codpro, codigo, qtd, usuario, dispositivo, lido_em, recebido_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(l.uid, inv.id, etapa, local, c.codpro, String(l.codigo || l.codpro).trim(), r4(qtd), usuario, dispositivo || "", l.em || agora(), agora());
  if (velha) db().prepare("UPDATE leituras SET cancelada = 1, cancelada_por = ?, cancelada_em = ? WHERE uid = ?").run("leitura mais antiga que a final", agora(), l.uid);
  if (etapa === 3) finalDoAuditor(inv.id, c.codpro, usuario);
  return c.codpro;
}

// Auditoria pelo coletor: a última leitura do item é a quantidade final (só há uma ativa por item).
// A justificativa padrão só é usada se o escritório ainda não escreveu outra.
const JUST_COLETOR = "Contagem física do auditor (coletor)";
function finalDoAuditor(invId: number, codpro: string, usuario: string) {
  const c3 = (db().prepare("SELECT SUM(qtd) q FROM leituras WHERE inv_id = ? AND codpro = ? AND etapa = 3 AND cancelada = 0").get(invId, codpro) as Row).q;
  const it = db().prepare("SELECT justificativa, decisao FROM itens WHERE inv_id = ? AND codpro = ?").get(invId, codpro) as Row;
  if (it.decisao === "MANTER" || it.decisao === "RECONTAR") { // decisão do escritório prevalece: só registra a contagem
    db().prepare("UPDATE itens SET c3 = ?, final = ? WHERE inv_id = ? AND codpro = ?").run(c3 == null ? null : r4(c3), c3 == null ? null : r4(c3), invId, codpro);
    return;
  }
  const padrao = !it.justificativa || it.justificativa === JUST_COLETOR;
  if (c3 == null) {
    db().prepare(`UPDATE itens SET c3 = NULL${padrao ? ", final = NULL, justificativa = NULL, situacao = 'AUDITAR'" : ""} WHERE inv_id = ? AND codpro = ?`).run(invId, codpro);
    return;
  }
  db().prepare(`UPDATE itens SET c3 = ?, final = ?, situacao = 'AUDITADO', justificativa = ?, auditado_por = ?, auditado_em = ? WHERE inv_id = ? AND codpro = ?`)
    .run(r4(c3), r4(c3), padrao ? JUST_COLETOR : it.justificativa, usuario, agora(), invId, codpro);
}

export function cancelarLeitura(uid: string, body: Row) {
  const l = db().prepare("SELECT * FROM leituras WHERE uid = ?").get(uid) as Row | undefined;
  if (!l) throw new Erro("Leitura não encontrada.", 404);
  const inv = getInv(l.inv_id), usuario = nome(body.usuario);
  if (!body.gestao && l.usuario !== usuario) throw new Erro("Só quem registrou pode cancelar pelo coletor.", 403);
  if (NUM_ETAPA[inv.etapa] !== l.etapa) throw new Erro("A etapa desta leitura já foi encerrada.");
  db().prepare("UPDATE leituras SET cancelada = 1, cancelada_por = ?, cancelada_em = ? WHERE id = ?").run(usuario, agora(), l.id);
  if (l.etapa === 3) finalDoAuditor(inv.id, l.codpro, usuario);
  log(inv.id, usuario, body.gestao ? "CANCELOU LEITURA (GESTÃO)" : "CANCELOU LEITURA", { codpro: l.codpro, qtd: l.qtd, local: l.local, operador: l.usuario });
}

// ---------- etapas ----------
// Resumo para quem vai finalizar a etapa no coletor (sem quantidades: a contagem é cega)
export function fechamento(id: number) {
  const inv = getInv(id), n = NUM_ETAPA[inv.etapa];
  if (!n) return { etapa: inv.etapa, total: 0, feitos: 0, faltam: 0, ativos: [] };
  const alvo = itensView(id).filter((i) => (n === 1 ? i.situacao !== DESC : n === 2 ? i.situacao === "RECONTAR" : ["AUDITAR", "AUDITADO"].includes(i.situacao)));
  const feitos = alvo.filter((i) => (n === 3 ? i.situacao === "AUDITADO" : !!i.l[n])).length;
  const d = new Date(Date.now() - 600_000), lim = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const ativos = db().prepare("SELECT usuario, MAX(recebido_em) ultima FROM leituras WHERE inv_id = ? AND etapa = ? AND cancelada = 0 AND recebido_em >= ? GROUP BY usuario ORDER BY 2 DESC").all(id, n, lim);
  return { etapa: inv.etapa, total: alvo.length, feitos, faltam: alvo.length - feitos, ativos };
}

export async function avancar(id: number, body: Row) {
  // quem finaliza informa a etapa que está vendo: dois toques ao mesmo tempo não fecham duas etapas
  const vendo = getInv(id).etapa;
  if (body.etapa && body.etapa !== vendo) throw new Erro(`Esta etapa já foi finalizada: o inventário está em ${vendo}.`, 409);
  const inv = getInv(id), usuario = nome(body.usuario), itens = itensView(id).filter((i) => i.situacao !== DESC);
  const upd = db().prepare("UPDATE itens SET c1 = COALESCE(?, c1), c2 = COALESCE(?, c2), final = ?, situacao = ? WHERE inv_id = ? AND codpro = ?");
  const setEtapa = (e: string) => db().prepare("UPDATE inventarios SET etapa = ? WHERE id = ?").run(e, id);
  if (inv.etapa === "CONTAGEM") {
    if (ehAvulso(inv) && !itens.length) throw new Erro("Nenhum item lido ainda.");
    return tx(() => {
      let rec = 0;
      for (const i of itens) {
        const c1 = i.l[1]?.q ?? 0, ok = dentro(c1, i.saldo, inv);
        if (!ok) rec++;
        upd.run(c1, null, ok ? c1 : null, ok ? "OK" : "RECONTAR", id, i.codpro);
      }
      const etapa = rec ? "RECONTAGEM" : "LANCAMENTO";
      setEtapa(etapa);
      const r = { itens: itens.length, recontar: rec };
      log(id, usuario, "FECHOU CONTAGEM", r);
      return { etapa, ...r };
    });
  }
  if (inv.etapa === "RECONTAGEM") {
    const alvo = itens.filter((i) => i.situacao === "RECONTAR"), sem = alvo.filter((i) => !i.l[2]);
    if (sem.length && !body.forcar) throw new Erro(`${sem.length} item(ns) ainda sem recontagem. Se continuar, eles vão direto para a auditoria.`, 409);
    return tx(() => {
      let aud = 0;
      for (const i of alvo) {
        const c2 = i.l[2] ? i.l[2].q : null; // sem recontagem => auditoria
        const ok = c2 != null && ((i.c1 != null && dentro(c2, i.c1, inv)) || dentro(c2, i.saldo, inv));
        if (!ok) aud++;
        upd.run(null, c2, ok ? c2 : null, ok ? "OK" : "AUDITAR", id, i.codpro);
      }
      const etapa = aud ? "AUDITORIA" : "LANCAMENTO";
      setEtapa(etapa);
      const r = { recontados: alvo.length - sem.length, semRecontagem: sem.length, auditar: aud };
      log(id, usuario, "FECHOU RECONTAGEM", r);
      return { etapa, ...r };
    });
  }
  if (inv.etapa === "AUDITORIA") {
    const pend = itens.filter((i) => i.situacao === "AUDITAR").length;
    if (pend) throw new Erro(`${pend} item(ns) ainda aguardando decisão da auditoria.`);
    const feitos = itens.filter((i) => i.situacao === "AUDITADO");
    const reenviar = feitos.filter((i) => i.decisao === "RECONTAR").map((i) => i.codpro);
    const novo = reenviar.length ? await abrirRecontagem(inv, reenviar, usuario) : null;
    setEtapa("LANCAMENTO");
    log(id, usuario, "FECHOU AUDITORIA", { acertar: feitos.filter((i) => !SEM_AJUSTE(i)).length, mantidos: feitos.filter((i) => i.decisao === "MANTER").length,
      reenviados: reenviar.length, ...(novo ? { novoInventario: novo } : {}) });
    return { etapa: "LANCAMENTO", novoInventario: novo, reenviados: reenviar.length };
  }
  throw new Erro("Use o lançamento e o parecer para encerrar.");
}

// Planilha da auditoria: grava várias linhas de uma vez. Final + justificativa => AUDITADO;
// só um dos dois fica salvo como rascunho e o item continua pendente (AUDITAR).
export function auditar(id: number, body: Row) {
  const inv = getInv(id), usuario = nome(body.usuario);
  if (inv.etapa !== "AUDITORIA") throw new Erro("O inventário não está em auditoria.");
  const linhas: Row[] = Array.isArray(body.itens) ? body.itens : [body];
  const get = db().prepare("SELECT situacao, decisao, justificativa FROM itens WHERE inv_id = ? AND codpro = ?");
  const somaC3 = db().prepare("SELECT SUM(qtd) q FROM leituras WHERE inv_id = ? AND codpro = ? AND etapa = 3 AND cancelada = 0");
  const upd = db().prepare(`UPDATE itens SET final = ?, c3 = ?, situacao = ?, justificativa = ?, decisao = ?, auditado_por = ?, auditado_em = ? WHERE inv_id = ? AND codpro = ?`);
  return tx(() => linhas.map((l) => {
    const codpro = String(l.codpro);
    try {
      const it = get.get(id, codpro) as Row | undefined;
      if (!it) throw new Erro("Item não encontrado.");
      if (!["AUDITAR", "AUDITADO"].includes(it.situacao)) throw new Erro("Item fora da lista de auditoria.");
      const txt = String(l.final ?? "").trim(), q = txt === "" ? null : Number(txt.replace(",", "."));
      if (q != null && (!Number.isFinite(q) || q < 0 || q > 999_999)) throw new Erro("Quantidade final inválida (até 999.999).");
      // Decisão: ACERTAR (ajusta para o final) · MANTER (sem ajuste) · RECONTAR (vai para um novo inventário de recontagem)
      const dec = l.decisao == null || l.decisao === "" ? it.decisao || "ACERTAR" : DECISOES.includes(l.decisao) ? String(l.decisao) : "ACERTAR";
      let just = String(l.justificativa ?? it.justificativa ?? "").trim();
      if (dec === "ACERTAR" && Object.values(JUST_DECISAO).includes(just)) just = "";
      if (dec !== "ACERTAR" && !just) just = JUST_DECISAO[dec];
      const sit = dec !== "ACERTAR" || (q != null && just) ? "AUDITADO" : "AUDITAR";
      const c3 = (somaC3.get(id, codpro) as Row).q;
      upd.run(q == null ? null : r4(q), c3 == null ? null : r4(c3), sit, just || null, dec, usuario, agora(), id, codpro);
      log(id, usuario, sit === "AUDITADO" ? "AUDITOU ITEM" : "RASCUNHO AUDITORIA", { codpro, decisao: dec, final: q == null ? null : r4(q), justificativa: just });
      return { codpro, ok: true, situacao: sit };
    } catch (e) { return { codpro, ok: false, erro: (e as Error).message }; }
  }));
}

// Tira do inventário itens que ninguém contou (nem contagem, nem recontagem, nem auditoria):
// não geram ajuste e saem dos indicadores. "desfazer" devolve o item ao fluxo.
export function desconsiderar(id: number, body: Row) {
  const inv = getInv(id), usuario = nome(body.usuario);
  if (!NUM_ETAPA[inv.etapa]) throw new Erro("Só é possível desconsiderar itens até a auditoria.");
  const cods: string[] = (body.codpros || []).map(String);
  if (!cods.length) throw new Erro("Nenhum item selecionado.");
  const get = db().prepare("SELECT situacao, sit_ant FROM itens WHERE inv_id = ? AND codpro = ?");
  const leu = db().prepare("SELECT 1 FROM leituras WHERE inv_id = ? AND codpro = ? AND cancelada = 0 LIMIT 1");
  const upd = db().prepare("UPDATE itens SET situacao = ?, sit_ant = ?, final = NULL, decisao = NULL, justificativa = ?, auditado_por = ?, auditado_em = ? WHERE inv_id = ? AND codpro = ?");
  // ao reconsiderar, o item volta para a lista da etapa em que o inventário está
  const volta = (ant: string | null) => inv.etapa === "CONTAGEM" ? null
    : inv.etapa === "RECONTAGEM" ? (ant === "OK" ? "OK" : "RECONTAR")
    : ant === "OK" ? "OK" : "AUDITAR";
  let n = 0, comLeitura = 0;
  tx(() => {
    for (const c of cods) {
      const it = get.get(id, c) as Row | undefined;
      if (!it) continue;
      if (body.desfazer) {
        if (it.situacao !== DESC) continue;
        upd.run(volta(it.sit_ant), null, null, null, null, id, c); n++;
      } else {
        if (it.situacao === DESC) continue;
        if (leu.get(id, c)) { comLeitura++; continue; }
        upd.run(DESC, it.situacao ?? null, String(body.motivo || "").trim() || "Desconsiderado: sem contagem", usuario, agora(), id, c); n++;
      }
    }
    if (n) log(id, usuario, body.desfazer ? "RECONSIDEROU ITENS" : "DESCONSIDEROU ITENS", { itens: n, codpros: cods.slice(0, 200) });
  });
  return { alterados: n, ignoradosComLeitura: comLeitura };
}

// ---------- ajustes / lançamento ----------
export async function ajustes(id: number) {
  const inv = getInv(id);
  if (!["LANCAMENTO", "ENCERRADO"].includes(inv.etapa)) throw new Erro("Disponível após encerrar as etapas de contagem.");
  let atuais: Map<string, number> | null = null, aviso: string | null = null;
  if (inv.codemp) {
    try { atuais = await erp.saldosAtuais(inv.codemp); } catch (e) { aviso = "Não foi possível consultar o saldo atual no ERP: " + (e as Error).message; }
  }
  const lista = itensView(id).filter((i) => !SEM_AJUSTE(i)).map((i) => {
    const final = i.final ?? i.saldo, atual = atuais?.has(i.codpro) ? r4(atuais.get(i.codpro)) : null;
    const ajuste = r4(final - i.saldo);
    return { codpro: i.codpro, nompro: i.nompro, unipro: i.unipro, grupo: i.grupo, saldo: i.saldo, final, atual,
      movimentou: atual != null && atual !== i.saldo, ajuste, precus: i.precus, valor: r4(ajuste * i.precus),
      situacao: i.situacao, justificativa: i.justificativa || "" };
  }).filter((a) => a.ajuste !== 0 || a.movimentou);
  lista.sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  return { aviso, ajustes: lista, podeGravarErp: !!inv.codemp };
}

export async function lancar(id: number, body: Row) {
  const inv = getInv(id), usuario = nome(body.usuario);
  if (inv.etapa !== "LANCAMENTO") throw new Erro("O inventário não está na etapa de lançamento.");
  if (inv.lancado_em) throw new Erro(`Ajustes já registrados em ${inv.lancado_em} por ${inv.lancado_por}.`);
  if (String(body.confirmacao || "").trim().toUpperCase() !== "CONFIRMAR") throw new Erro("Digite CONFIRMAR para prosseguir.");
  const efetivos = (await ajustes(id)).ajustes.filter((a) => a.ajuste !== 0);
  let codides = new Map<string, number | null>();
  if (body.modo === "ERP") {
    if (!inv.codemp) throw new Erro("Inventário aberto por CSV: sem empresa do ERP para gravar.");
    await ddl.exigir("inventario");
    codides = new Map((await erp.gravarAjustes(inv.codemp, id, efetivos, body.codfun ? Number(body.codfun) : null, body.obs)).map((o) => [o.codpro, o.codide]));
  }
  tx(() => {
    const ins = db().prepare(`INSERT INTO lancamentos (inv_id, codpro, saldo, atual, final, ajuste, entsai, precus, valor, codide, em, usuario)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const em = agora();
    for (const a of efetivos) ins.run(id, a.codpro, a.saldo, a.atual, a.final, a.ajuste, a.ajuste > 0 ? "E" : "S", a.precus, a.valor, codides.get(a.codpro) ?? null, em, usuario);
    db().prepare("UPDATE inventarios SET lancado_em = ?, lancado_por = ?, lancado_modo = ?, obs_lanc = ? WHERE id = ?").run(em, usuario, body.modo === "ERP" ? "ERP" : "MANUAL", String(body.obs || "").trim().slice(0, 500) || null, id);
    log(id, usuario, body.modo === "ERP" ? "GRAVOU AJUSTES NA MESTOQUE" : "REGISTROU LANÇAMENTO MANUAL", { itens: efetivos.length });
  });
  return { itens: efetivos.length };
}

export function salvarParecer(id: number, body: Row) {
  const inv = getInv(id), usuario = nome(body.usuario);
  if (inv.etapa === "ENCERRADO") throw new Erro("Inventário encerrado.");
  db().prepare("UPDATE inventarios SET parecer = ?, parecer_por = ?, parecer_em = ? WHERE id = ?").run(String(body.texto || ""), usuario, agora(), id);
  log(id, usuario, "SALVOU PARECER");
}

export function encerrar(id: number, body: Row) {
  const inv = getInv(id), usuario = nome(body.usuario);
  if (inv.etapa !== "LANCAMENTO") throw new Erro("O inventário não está na etapa de lançamento.");
  if (!inv.lancado_em) throw new Erro("Registre o lançamento dos ajustes antes de encerrar.");
  if (!String(inv.parecer || "").trim()) throw new Erro("Escreva e salve o parecer antes de encerrar.");
  db().prepare("UPDATE inventarios SET etapa = 'ENCERRADO', encerrado_em = ?, encerrado_por = ? WHERE id = ?").run(agora(), usuario, id);
  log(id, usuario, "ENCERROU INVENTÁRIO");
}
