// Manutenção de cadastro pelo coletor.
//   PRODUTOS            descrição, qtd por caixa, pesos e local (só estes campos; unidade, preço, custo e fiscal não)
//   PRODUTOSSIMILARES   códigos de barras adicionais. O principal (PRODUTOS.CODBAR) nunca é alterado aqui.
//                       CODFOR = a própria empresa, CODIMP = CODPRO, NUMIDE = max+1. QNTEMB + MULDIV = quanto vale 1 leitura:
//                       M 12 = 12 unidades do produto (caixa); D 10 = 1/10 da unidade do produto; 0/1/vazio = 1.
//   paletes (SQLite)    montagem do palete: o Lieto não tem campo para isso.
// Qtd por caixa = QNTCAI (livre em todos os produtos; cadastro.campoCaixa troca). LOTECO só aparece como sugestão e não é alterado;
// QNTEMB é a conversão de COMPRA.
import { db, getConfig } from "./db";
import * as ddl from "./ddl";
import { Erro, agora, chave, evento, r4, type Usuario } from "./comum";
import { comConexao, consultar, emTransacao, executar, num, txt, type Conexao, type Row } from "./fb";

const CAMPOS = {
  nompro: { col: "NOMPRO", tam: 50, nome: "Descrição" }, caixa: { get col() { return getConfig().cadastro?.campoCaixa === "LOTECO" ? "LOTECO" : "QNTCAI"; }, inteiro: true, nome: "Qtd por caixa" },
  pesbru: { col: "PESBRU", nome: "Peso bruto" }, pesliq: { col: "PESLIQ", nome: "Peso líquido" }, locpro: { col: "LOCPRO", tam: 20, nome: "Local" }, obspro: { col: "OBSPRO", tam: 100, nome: "Observação" },
} as Record<string, { col: string; tam?: number; inteiro?: boolean; nome: string }>;

// Fornecedor usado nos códigos adicionais: o próprio emitente (o que o Lieto já usa em todos os existentes)
async function fornecedor(t: Conexao) {
  const r = (await consultar(t, "select codfor, count(*) n from produtossimilares where codbar is not null and codbar <> '' group by codfor order by 2 desc"))[0];
  const f = getConfig().cadastro?.codfor ?? num(r?.CODFOR);
  if (!f) throw new Erro("Defina cadastro.codfor no config.json (fornecedor dos códigos de barras adicionais).");
  return f;
}

// Multiplicador do código
const multi = (b: Row) => { const n = num(b.QNTEMB), m = txt(b.MULDIV); return n > 1 && (m === "M" || m === "D") ? { qtd: n, muldiv: m } : { qtd: 1, muldiv: "M" }; };
export const fatorDe = (b: Row) => { const m = multi(b); return m.muldiv === "D" ? 1 / m.qtd : m.qtd; };
function lerMulti(b: Record<string, unknown>) {
  const qtd = r4(Number(String(b.qtd ?? 1).replace(",", "."))), muldiv = b.muldiv === "D" ? "D" : "M";
  if (!(qtd >= 1) || qtd > 99999) throw new Erro("Multiplicador inválido (de 1 a 99999).");
  return { qtd, muldiv: qtd === 1 ? "M" : muldiv };
}

// Onde um código já é usado (qualquer campo que os coletores leem)
async function donos(t: Conexao, cod: string) {
  const l = await consultar(t, `select p.codpro, p.nompro from produtos p where p.codpro = ? or p.codbar = ? or p.coddum = ? or p.eantri = ?
    or exists (select 1 from produtossimilares s where s.codpro = p.codpro and s.codbar = ? and s.proati = 'S')`, [cod.slice(0, 20), cod, cod.slice(0, 14), cod, cod]);
  return l.map((r) => ({ codpro: txt(r.CODPRO), nompro: txt(r.NOMPRO) }));
}

export async function buscar(q: string) {
  const b = q.trim().toUpperCase();
  if (!b) return [];
  return comConexao(async (t) => {
    const d = await donos(t, b);
    if (d.length) return d;
    const ps = b.split(/\s+/).slice(0, 5);
    return (await consultar(t, `select first 30 codpro, nompro from produtos where proati = 'S' and ${ps.map(() => "nompro containing ?").join(" and ")} order by nompro`, ps)).map((r) => ({ codpro: txt(r.CODPRO), nompro: txt(r.NOMPRO) }));
  });
}

export async function obter(codpro: string) {
  return comConexao(async (t) => {
    const p = (await consultar(t, `select codpro, nompro, unipro, unicom, codbar, coddum, eantri, ${Object.values(CAMPOS).map((c) => c.col).join(", ")}, loteco lotref, qntemb, proati from produtos where codpro = ?`, [codpro]))[0];
    if (!p) throw new Erro("Produto não encontrado.", 404);
    const barras = await consultar(t, "select numide, codbar, qntemb, muldiv from produtossimilares where codpro = ? and codbar is not null and codbar <> '' and proati = 'S' order by numide", [codpro]);
    const pal = db().prepare("SELECT camadas, caixas, obs, por, em FROM paletes WHERE codpro = ?").get(codpro) as Row | undefined;
    return {
      codpro: txt(p.CODPRO), unipro: txt(p.UNIPRO), unicom: txt(p.UNICOM), qntemb: num(p.QNTEMB), loteco: num(p.LOTREF), ativo: txt(p.PROATI) !== "N",
      principal: txt(p.CODBAR), outros: [txt(p.CODDUM), txt(p.EANTRI)].filter(Boolean),
      valores: { nompro: txt(p.NOMPRO), caixa: num(p[CAMPOS.caixa.col]), pesbru: num(p.PESBRU), pesliq: num(p.PESLIQ), locpro: txt(p.LOCPRO), obspro: txt(p.OBSPRO) } as Record<string, string | number>,
      barras: barras.map((b) => ({ numide: num(b.NUMIDE), codbar: txt(b.CODBAR), ...multi(b), fator: fatorDe(b) })), palete: pal ?? null,
    };
  });
}

// "antes" é o que o coletor mostrava: se alguém mudou no Lieto nesse meio-tempo, não sobrescreve.
export async function alterar(codpro: string, b: Record<string, unknown>, u: Usuario) {
  const antes = (b.antes || {}) as Row, depois = (b.depois || {}) as Row, sets: string[] = [], args: unknown[] = [], mud: string[] = [];
  const atual = await obter(codpro);
  for (const [k, c] of Object.entries(CAMPOS)) {
    if (!(k in depois)) continue;
    let v: string | number;
    if (c.tam) {
      v = String(depois[k] ?? "").trim().replace(/\s+/g, " ").toUpperCase();
      if (v.length > c.tam) throw new Erro(`${c.nome}: máximo de ${c.tam} caracteres.`);
      if (k === "nompro" && v.length < 3) throw new Erro("Informe a descrição.");
    } else {
      v = Number(String(depois[k] ?? "").replace(",", "."));
      if (!Number.isFinite(v) || v < 0 || v > 99999 || (c.inteiro && !Number.isInteger(v))) throw new Erro(`${c.nome}: valor inválido.`);
      v = r4(v);
    }
    if (v === atual.valores[k]) continue;
    if (String(antes[k] ?? "") !== String(atual.valores[k])) throw new Erro(`${c.nome} foi alterado por outra pessoa. Abra o produto de novo.`, 409);
    sets.push(`${c.col} = ?`); args.push(v); mud.push(`${c.nome}: ${atual.valores[k]} > ${v}`);
  }
  if (!sets.length) return atual;
  await ddl.exigir("cadastro");
  // Firebird 2.0 com base mais nova: a TRIGGER_PRODUTOS falha na 1ª vez e depois é PULADA em silêncio (sem gravar JCLOG_PRODUTOS).
  // Confere o log dentro da transação: sem ele, desfaz (a menos que cadastro.aceitarSemTrigger seja true).
  const SEM = "Este servidor Firebird não executa a trigger TRIGGER_PRODUTOS (criada numa versão mais nova): a alteração ficaria sem o log JCLOG_PRODUTOS. Nada foi alterado.";
  const aceitar = !!getConfig().cadastro?.aceitarSemTrigger;
  const gravar = () => emTransacao(async (t) => {
    const conta = async () => num((await consultar(t, "select count(*) n from jclog_produtos where codpro = ?", [codpro]))[0].N);
    const tem = (await consultar(t, "select rdb$trigger_name n from rdb$triggers where rdb$trigger_name = 'TRIGGER_PRODUTOS' and coalesce(rdb$trigger_inactive, 0) = 0")).length > 0;
    const n = tem ? await conta() : 0;
    await executar(t, `update produtos set ${sets.join(", ")} where codpro = ?`, [...args, codpro]);
    if (tem && !aceitar && (await conta()) <= n) throw new Erro(SEM, 409);
  });
  try { await gravar(); } catch (e) {
    if (!/Invalid request BLR/i.test((e as Error).message)) throw e;
    if (!aceitar) throw new Erro(SEM, 409);
    await gravar();
  }
  evento("cadastro", codpro, u, "ALTEROU CADASTRO", mud.join(" ; "));
  return obter(codpro);
}

export async function incluirBarras(codpro: string, b: Record<string, unknown>, u: Usuario) {
  const cod = String(b.codbar || "").trim().toUpperCase();
  if (!/^[0-9A-Z.\-/]{4,50}$/.test(cod)) throw new Erro("Código de barras inválido.");
  const m = lerMulti(b);
  await ddl.exigir("cadastro");
  await emTransacao(async (t) => {
    const d = await donos(t, cod);
    if (d.some((x) => x.codpro === codpro)) throw new Erro("Este código já é deste produto.");
    if (d.length) throw new Erro(`Código já usado em ${d[0].codpro} ${d[0].nompro}.`);
    if (!(await consultar(t, "select codpro from produtos where codpro = ?", [codpro]))[0]) throw new Erro("Produto não encontrado.", 404);
    const n = num((await consultar(t, "select coalesce(max(numide), 0) + 1 n from produtossimilares"))[0].N);
    await executar(t, "insert into produtossimilares (codfor, codimp, codpro, qntemb, muldiv, codbar, proati, numide) values (?, ?, ?, ?, ?, ?, 'S', ?)", [await fornecedor(t), codpro, codpro, m.qtd, m.muldiv, cod, n]);
  });
  // vale na hora também para os inventários em andamento (o catálogo deles é uma foto da abertura)
  db().prepare(`INSERT OR IGNORE INTO codigos (inv_id, chave, codpro, fator) SELECT i.inv_id, ?, i.codpro, ? FROM itens i JOIN inventarios v ON v.id = i.inv_id
    WHERE i.codpro = ? AND v.etapa IN ('CONTAGEM','RECONTAGEM','AUDITORIA')`).run(chave(cod), m.muldiv === "D" ? 1 / m.qtd : m.qtd, codpro);
  evento("cadastro", codpro, u, "INCLUIU CÓDIGO DE BARRAS", `${cod} ${m.muldiv} ${m.qtd}`);
  return obter(codpro);
}

export async function alterarBarras(codpro: string, b: Record<string, unknown>, u: Usuario) {
  const numide = Number(b.numide), m = lerMulti(b);
  await ddl.exigir("cadastro");
  const r = await emTransacao(async (t) => {
    const x = (await consultar(t, "select codbar, qntemb, muldiv from produtossimilares where numide = ? and codpro = ? and codfor = ? and codimp = ? and codbar <> ''", [numide, codpro, await fornecedor(t), codpro]))[0];
    if (!x) throw new Erro("Código não encontrado ou não pode ser alterado aqui.", 404);
    await executar(t, "update produtossimilares set qntemb = ?, muldiv = ? where numide = ? and codpro = ?", [m.qtd, m.muldiv, numide, codpro]);
    return { cod: txt(x.CODBAR), antes: multi(x) };
  });
  db().prepare("UPDATE codigos SET fator = ? WHERE chave = ? AND codpro = ? AND inv_id IN (SELECT id FROM inventarios WHERE etapa IN ('CONTAGEM','RECONTAGEM','AUDITORIA'))").run(m.muldiv === "D" ? 1 / m.qtd : m.qtd, chave(r.cod), codpro);
  evento("cadastro", codpro, u, "ALTEROU MULTIPLICADOR", `${r.cod}: ${r.antes.muldiv} ${r.antes.qtd} > ${m.muldiv} ${m.qtd}`);
  return obter(codpro);
}

// Só remove códigos adicionais da própria empresa (os incluídos por aqui/Lieto), nunca vínculo de compra de fornecedor.
export async function removerBarras(codpro: string, numide: number, u: Usuario) {
  await ddl.exigir("cadastro");
  const cod = await emTransacao(async (t) => {
    const r = (await consultar(t, "select codbar from produtossimilares where numide = ? and codpro = ? and codfor = ? and codimp = ? and codbar <> ''", [numide, codpro, await fornecedor(t), codpro]))[0];
    if (!r) throw new Erro("Código não encontrado ou não pode ser removido aqui.");
    await executar(t, "delete from produtossimilares where numide = ? and codpro = ?", [numide, codpro]);
    return txt(r.CODBAR);
  });
  db().prepare("DELETE FROM codigos WHERE chave = ? AND codpro = ? AND inv_id IN (SELECT id FROM inventarios WHERE etapa IN ('CONTAGEM','RECONTAGEM','AUDITORIA'))").run(chave(cod), codpro);
  evento("cadastro", codpro, u, "REMOVEU CÓDIGO DE BARRAS", cod);
  return obter(codpro);
}

export async function salvarPalete(codpro: string, b: Record<string, unknown>, u: Usuario) {
  const n = (v: unknown) => Number(String(v ?? "").replace(",", "."));
  const camadas = n(b.camadas), caixas = n(b.caixas);
  if (![camadas, caixas].every((x) => Number.isInteger(x) && x > 0 && x <= 999)) throw new Erro("Informe camadas e caixas por camada (números inteiros).");
  await obter(codpro);
  db().prepare("INSERT INTO paletes (codpro, camadas, caixas, obs, por, em) VALUES (?,?,?,?,?,?) ON CONFLICT(codpro) DO UPDATE SET camadas = excluded.camadas, caixas = excluded.caixas, obs = excluded.obs, por = excluded.por, em = excluded.em")
    .run(codpro, camadas, caixas, String(b.obs || "").trim().slice(0, 500), u.nome, agora());
  evento("cadastro", codpro, u, "MONTAGEM DE PALETE", `${camadas} x ${caixas}`);
  return obter(codpro);
}
export const palete = (codpro: string) => db().prepare("SELECT camadas, caixas FROM paletes WHERE codpro = ?").get(codpro) ?? null;

// Códigos adicionais de todos os produtos, para as leituras dos outros módulos
export type Adic = { cod: string; fator: number };
export async function adicionais(t: Conexao): Promise<Map<string, Adic[]>> {
  const m = new Map<string, Adic[]>();
  for (const r of await consultar(t, "select codpro, codbar, qntemb, muldiv from produtossimilares where codbar is not null and codbar <> '' and proati = 'S'")) {
    const k = txt(r.CODPRO); m.set(k, [...(m.get(k) || []), { cod: txt(r.CODBAR), fator: fatorDe(r) }]);
  }
  return m;
}
// Para as telas: lista de códigos e o fator de cada um que não vale 1
export const cods = (l?: Adic[]) => (l || []).map((x) => x.cod);
export const fatores = (l?: Adic[]) => Object.fromEntries((l || []).filter((x) => x.fator !== 1).map((x) => [chave(x.cod), x.fator]));
