// API única: um roteador pequeno sobre a catch-all route do Next.
import { db, getConfig } from "@/lib/server/db";
import * as A from "@/lib/server/auditoria";
import * as AC from "@/lib/server/auditoria-consulta";
import * as LP from "@/lib/server/auditoria-limpeza";
import * as AL from "@/lib/server/alertas";
import * as erp from "@/lib/server/erp";
import * as I from "@/lib/server/inventario";
import * as S from "@/lib/server/sessao";
import * as ddl from "@/lib/server/ddl";
import * as M from "@/lib/server/movimentos";
import * as XI from "@/lib/server/xmlimport";
import * as X from "@/lib/server/xml";
import * as C from "@/lib/server/cadastro";
import * as PM from "@/lib/server/permissoes";
import * as PD from "@/lib/server/perda";
import * as EM from "@/lib/server/empresas";
import * as RT from "@/lib/server/retorno";
import * as CF from "@/lib/server/conferencia";
import * as RC from "@/lib/server/receita";
import * as RB from "@/lib/server/recebimento";
import * as P from "@/lib/server/producao";
import { Erro } from "@/lib/server/comum";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Ctx = { p: string[]; q: URLSearchParams; body: Row; usuario: S.Usuario | null; token: string | null };
type Handler = (c: Ctx) => unknown;

const ATIVAS = "('CONTAGEM','RECONTAGEM','AUDITORIA')";
const PUBLICAS = new Set(["POST sessao/entrar", "GET info"]);
const ehAdmin = PM.ehAdmin;
const exigirAdmin = (u: S.Usuario | null) => { if (!ehAdmin(u)) throw new Erro("Somente administradores (config.admins) podem fazer isso.", 403); };
const rotas: [string, string, Handler][] = [
  ["POST", "sessao/entrar", ({ body }) => S.entrar(body)],
  ["GET", "sessao", ({ usuario }) => usuario && { ...usuario, admin: ehAdmin(usuario), rotinas: PM.de(usuario) }],
  ["POST", "sessao/sair", ({ token }) => S.sair(token)],
  ["GET", "erp/usuarios", () => erp.usuariosAtivos()],
  ["GET", "info", () => ({
    empresa: getConfig().empresa, exigirLocal: !!getConfig().regras.exigirLocal,
    inventarios: db().prepare(`SELECT id, descricao, etapa, nomemp, COALESCE(escopo LIKE '%"avulso":true%', 0) avulso FROM inventarios WHERE etapa IN ${ATIVAS} ORDER BY id DESC`).all(),
  })],
  ["POST", "erp/testar", () => erp.testar()],
  ["GET", "erp/empresas", () => erp.empresas()],
  ["GET", "erp/saldo-metodo", ({ q }) => erp.metodoSaldo(Number(q.get("codemp")))],

  ["GET", "inventarios", () => {
    I.conferirFixas();
    const invs = db().prepare("SELECT * FROM inventarios ORDER BY id DESC").all() as Row[];
    const st = db().prepare(`SELECT inv_id, COUNT(*) n, COUNT(DISTINCT usuario) ops, MAX(lido_em) ultima FROM leituras WHERE cancelada = 0 GROUP BY inv_id`).all() as Row[];
    const itens = db().prepare(`SELECT inv_id, SUM(saldo <> 0) comsaldo, SUM(saldo * precus) valor FROM itens GROUP BY inv_id`).all() as Row[];
    return invs.map((i) => ({ ...i, leituras: st.find((s) => s.inv_id === i.id) ?? null, resumo: I.ehAvulso(i)
      ? db().prepare("SELECT COUNT(*) comsaldo, SUM(saldo * precus) valor FROM itens WHERE inv_id = ? AND codpro IN (SELECT codpro FROM leituras WHERE inv_id = ? AND cancelada = 0)").get(i.id, i.id)
      : itens.find((s) => s.inv_id === i.id) ?? null }));
  }],
  ["POST", "inventarios", ({ body }) => I.abrir(body)],
  ["GET", "inventarios/programados", () => I.programados()],
  ["GET", "inventarios/fixas", () => I.fixas()],
  ["POST", "inventarios/fixas/:id", ({ p, body }) => I.editarFixa(Number(p[0]), body)],
  ["POST", "inventarios/fixas/:id/encerrar", ({ p, body }) => I.encerrarFixa(Number(p[0]), body)],
  ["GET", "inventarios/:id/contar-programado", ({ p }) => I.contarProgramado(Number(p[0]))],
  ["POST", "inventarios/:id/comecar", ({ p, usuario }) => I.comecarNoColetor(Number(p[0]), usuario!.nome)],
  ["POST", "inventarios/avulso", ({ body }) => I.abrirAvulso(body)],
  ["GET", "inventarios/avulso/empresa", () => I.empresaAvulso()],
  ["POST", "inventarios/previa", ({ body }) => I.previa(body)],

  ["GET", "inventarios/:id", ({ p }) => {
    const inv = I.getInv(p[0]);
    return {
      inv, regras: getConfig().regras, itens: I.itensView(inv.id),
      totalItens: I.ehAvulso(inv) ? I.itensView(inv.id).length : (db().prepare("SELECT COUNT(*) n FROM itens WHERE inv_id = ?").get(inv.id) as Row).n,
      operadores: db().prepare("SELECT etapa, usuario, COUNT(*) n, MIN(lido_em) primeira, MAX(lido_em) ultima, COUNT(DISTINCT codpro) itens FROM leituras WHERE inv_id = ? AND cancelada = 0 GROUP BY etapa, usuario ORDER BY etapa, n DESC").all(inv.id),
      lancamentos: db().prepare("SELECT * FROM lancamentos WHERE inv_id = ?").all(inv.id),
    };
  }],
  ["GET", "inventarios/:id/catalogo", ({ p }) => {
    const inv = I.getInv(p[0]);
    const prods: Record<string, [string, string, string]> = {};
    for (const x of db().prepare("SELECT codpro, nompro, unipro, situacao FROM itens WHERE inv_id = ?").all(inv.id) as Row[]) prods[x.codpro] = [x.nompro, x.unipro, x.situacao || ""];
    const codigos: Record<string, string> = {}, fatores: Record<string, number> = {};
    for (const c of db().prepare("SELECT chave, codpro, fator FROM codigos WHERE inv_id = ?").all(inv.id) as Row[]) { codigos[c.chave] = c.codpro; if (c.fator && c.fator !== 1) fatores[c.chave] = c.fator; }
    return { id: inv.id, descricao: inv.descricao, etapa: inv.etapa, etapaNum: I.NUM_ETAPA[inv.etapa] || 0, prods, codigos, fatores };
  }],
  ["POST", "inventarios/:id/leituras", ({ p, body }) => ({ resultados: I.registrarLeituras(Number(p[0]), body) })],
  ["GET", "inventarios/:id/leituras", ({ p, q }) => {
    const id = Number(p[0]);
    if (q.get("usuario")) return db().prepare(`SELECT l.uid, l.local, l.codpro, l.qtd, l.lido_em, l.cancelada, i.nompro, i.unipro FROM leituras l
      JOIN itens i ON i.inv_id = l.inv_id AND i.codpro = l.codpro WHERE l.inv_id = ? AND l.usuario = ? AND l.etapa = ? ORDER BY l.id DESC LIMIT 3000`)
      .all(id, q.get("usuario")!.toUpperCase(), Number(q.get("etapa")));
    return db().prepare(`SELECT l.*, i.nompro, i.unipro FROM leituras l JOIN itens i ON i.inv_id = l.inv_id AND i.codpro = l.codpro WHERE l.inv_id = ? ORDER BY l.id`).all(id);
  }],
  // Lista de trabalho do coletor. Contagem e recontagem são cegas (sem quantidades);
  // na auditoria o auditor vê a diferença para ir atrás dela.
  ["GET", "inventarios/:id/pendentes", ({ p }) => {
    const inv = I.getInv(p[0]), etapa = I.NUM_ETAPA[inv.etapa];
    if (!etapa) return [];
    const entra = (i: Row) => etapa === 1 ? i.situacao !== I.DESC : etapa === 2 ? i.situacao === "RECONTAR" : ["AUDITAR", "AUDITADO"].includes(i.situacao);
    return I.itensView(inv.id).filter(entra)
      .map((i) => {
        const base = { codpro: i.codpro, nompro: i.nompro, unipro: i.unipro, grupo: i.grupo || "", subgrupo: i.subgrupo || "", marca: i.marca || "",
          locais: i.l[etapa]?.locais || i.l[1]?.locais || i.local_erp || "", feito: !!i.l[etapa] };
        if (etapa !== 3) return base;
        const c1 = i.l[1] ? i.c1 ?? i.l[1].q : null, c2 = i.l[2] ? i.c2 ?? i.l[2].q : null, ref = c2 ?? c1;
        const dif = ref == null ? null : I.r4(ref - i.saldo);
        return { ...base, saldo: i.saldo, c1, c2, c3: i.l[3]?.q ?? null, final: i.final ?? null, dif, valor: dif == null ? null : I.r4(dif * (i.precus || 0)), situacao: i.situacao };
      })
      .sort((a: Row, b: Row) => Number(a.feito) - Number(b.feito) || Math.abs(b.valor ?? 0) - Math.abs(a.valor ?? 0) || a.nompro.localeCompare(b.nompro));
  }],
  ["POST", "inventarios/:id/programacao", ({ p, body }) => I.editarProgramacao(Number(p[0]), body)],
  ["POST", "inventarios/:id/excluir", ({ p }) => I.excluirProgramacao(Number(p[0]))],
  ["POST", "inventarios/:id/iniciar", ({ p, body }) => I.iniciar(Number(p[0]), body)],
  ["GET", "inventarios/:id/itens/:cod", ({ p }) => ({
    item: db().prepare("SELECT * FROM itens WHERE inv_id = ? AND codpro = ?").get(Number(p[0]), p[1]),
    leituras: db().prepare("SELECT * FROM leituras WHERE inv_id = ? AND codpro = ? ORDER BY id").all(Number(p[0]), p[1]),
  })],
  ["GET", "inventarios/:id/fechamento", ({ p }) => I.fechamento(Number(p[0]))],
  ["POST", "inventarios/:id/avancar", ({ p, body }) => I.avancar(Number(p[0]), body)],
  ["POST", "inventarios/:id/auditar", ({ p, body }) => ({ resultados: I.auditar(Number(p[0]), body) })],
  ["POST", "inventarios/:id/desconsiderar", ({ p, body }) => I.desconsiderar(Number(p[0]), body)],
  ["GET", "inventarios/:id/ajustes", ({ p }) => I.ajustes(Number(p[0]))],
  ["POST", "inventarios/:id/lancar", ({ p, body }) => I.lancar(Number(p[0]), body)],
  ["POST", "inventarios/:id/parecer", ({ p, body }) => I.salvarParecer(Number(p[0]), body)],
  ["POST", "inventarios/:id/encerrar", ({ p, body }) => I.encerrar(Number(p[0]), body)],
  ["POST", "inventarios/:id/cancelar", ({ p, body }) => I.cancelar(Number(p[0]), body)],
  ["GET", "inventarios/:id/log", ({ p }) => db().prepare("SELECT * FROM log WHERE inv_id = ? ORDER BY id DESC").all(Number(p[0]))],
  ["POST", "leituras/:uid/cancelar", ({ p, body }) => I.cancelarLeitura(p[0], body)],

  // ---------- sistema: conformidade do banco do Lieto ----------
  ["GET", "sistema/ddl", async ({ q }) => ({ ...(await (q.get("agora") ? ddl.verificar() : ddl.status())), mapa: ddl.ROTINAS })],
  ["POST", "sistema/ddl/homologar", async ({ usuario, body }) => {
    exigirAdmin(usuario);
    if (String(body.confirmacao || "").trim().toUpperCase() !== "HOMOLOGAR") throw new Erro("Digite HOMOLOGAR para confirmar.");
    const r = await ddl.homologar(`${usuario!.nome} (${usuario!.codfun})`);
    db().prepare("INSERT INTO eventos (em, modulo, ref, codfun, usuario, acao, detalhe) VALUES (datetime('now','localtime'), 'sistema', 'ddl', ?, ?, 'HOMOLOGOU ESTRUTURA DO BANCO', ?)")
      .run(usuario!.codfun, usuario!.nome, `versão Lieto ${r.versaoLieto}`);
    return r;
  }],
  ["GET", "sistema/eventos", ({ q }) => db().prepare(`SELECT * FROM eventos ${q.get("modulo") ? "WHERE modulo = ?" : ""} ORDER BY id DESC LIMIT 500`).all(...(q.get("modulo") ? [q.get("modulo")] : []))],

  // ---------- transferência, transformação e kit ----------
  ["GET", "produtos", () => M.produtos()],
  ["GET", "centros", () => M.centros()],
  ["GET", "centros/saldo", ({ q }) => M.saldoCentros(String(q.get("codpro") || ""))],
  ["GET", "movs/:tipo", ({ p }) => M.listar(p[0] as M.Tipo)],
  ["POST", "transferencia", ({ body, usuario }) => M.transferir(body, usuario!)],
  ["GET", "transformacao/opcoes", ({ q }) => M.opcoes(String(q.get("codpro") || ""))],
  ["POST", "kit", ({ body, usuario }) => M.montarKit(body, usuario!)],
  ["POST", "transformacao", ({ body, usuario }) => M.transformar(body, usuario!)],
  ["POST", "mov/:id/lancar", ({ p, usuario }) => M.lancar(Number(p[0]), usuario!)],
  ["POST", "mov/:id/cancelar", ({ p, body, usuario }) => M.cancelar(Number(p[0]), usuario!, body.obs)],
  ["POST", "mov/:id/estornar", ({ p, body, usuario }) => M.estornar(Number(p[0]), usuario!, body.obs)],

  // ---------- importação de XML ----------
  ["GET", "xml", () => X.situacao()],
  ["POST", "xml/pasta", ({ body, usuario }) => { exigirAdmin(usuario); X.definirPastas(body.pastas, usuario!); X.varrer().catch((e) => console.error("[XML]", e)); }],
  ["POST", "xml/enviar", ({ body }) => X.enviar(body)],
  ["POST", "xml/vincular", ({ body, usuario }) => X.vincular(body, usuario!)],
  ["GET", "xml/pastas", ({ q, usuario }) => { exigirAdmin(usuario); return X.navegar(q.get("p") || ""); }],
  ["GET", "xml/notas", ({ q }) => X.notas(q)],
  ["GET", "xml/itens", () => X.itensSemVinculo()],
  ["GET", "xml/vinculos", () => X.vinculos()],
  ["POST", "xml/desvincular", ({ body, usuario }) => X.desvincular(body, usuario!)],
  ["GET", "xml/impacto", ({ q }) => XI.impacto(q)],
  ["POST", "xml/corrigir", ({ body, usuario }) => { exigirAdmin(usuario); return XI.corrigir(body, usuario!); }],
  ["GET", "xml/opcoes", () => XI.opcoes()],
  ["POST", "xml/config", ({ body, usuario }) => { exigirAdmin(usuario); return XI.salvarConfig(body, usuario!); }],
  ["POST", "xml/produto", ({ body, usuario }) => { exigirAdmin(usuario); return XI.cadastrarProduto(body, usuario!); }],
  ["POST", "xml/:chave/importar", ({ p, body, usuario }) => XI.importar(p[0], usuario!, body.obs)],
  ["GET", "xml/:chave", ({ p }) => X.detalhe(p[0])],

  // ---------- cadastro (coletor) ----------
  ["GET", "cadastro", ({ q }) => C.buscar(q.get("q") || "")],
  ["GET", "cadastro/:cod", ({ p }) => C.obter(p[0])],
  ["GET", "cadastro/:cod/palete", ({ p }) => C.palete(p[0]) || {}],
  ["POST", "cadastro/:cod", ({ p, body, usuario }) => C.alterar(p[0], body, usuario!)],
  ["POST", "cadastro/:cod/barras", ({ p, body, usuario }) => C.incluirBarras(p[0], body, usuario!)],
  ["POST", "cadastro/:cod/barras/alterar", ({ p, body, usuario }) => C.alterarBarras(p[0], body, usuario!)],
  ["POST", "cadastro/:cod/barras/remover", ({ p, body, usuario }) => C.removerBarras(p[0], Number(body.numide), usuario!)],
  ["POST", "cadastro/:cod/palete", ({ p, body, usuario }) => C.salvarPalete(p[0], body, usuario!)],

  // ---------- liberação de rotinas ----------
  ["GET", "permissoes", ({ usuario }) => { exigirAdmin(usuario); return PM.listar(); }],
  ["POST", "permissoes/:codfun", ({ p, body, usuario }) => { exigirAdmin(usuario); return PM.salvar(Number(p[0]), body, usuario!); }],

  // ---------- receita ----------
  ["GET", "receita/:cod", ({ p }) => RC.obter(p[0])],
  ["GET", "receita/:cod/obs", ({ p }) => RC.observacoes(p[0])],
  ["POST", "receita/:cod", ({ p, body, usuario }) => RC.salvar(p[0], body, usuario!)],
  ["POST", "receita/:cod/remover", ({ p, body, usuario }) => RC.remover(p[0], body, usuario!)],

  // ---------- alertas e auditoria (só consulta) ----------
  ["GET", "alertas", ({ usuario }) => AL.listar(usuario!)],
  ["GET", "auditoria", ({ q }) => AC.listar(q)],
  ["GET", "auditoria/limpeza/limite", ({ usuario }) => { exigirAdmin(usuario); return LP.limites(); }],
  ["GET", "auditoria/limpeza/previa", ({ q, usuario }) => { exigirAdmin(usuario); return LP.previa(q.get("antes")); }],
  ["GET", "auditoria/limpeza/arquivo", ({ q, usuario }) => { exigirAdmin(usuario); return LP.baixar(q.get("nome")); }],
  ["POST", "auditoria/limpeza/copia", ({ body, usuario }) => { exigirAdmin(usuario); return LP.copiar(body); }],
  ["POST", "auditoria/limpeza", ({ body, usuario }) => { exigirAdmin(usuario); return LP.limpar(body, usuario!); }],
  ["GET", "auditoria/:trace", ({ p }) => AC.obter(p[0])],

  // ---------- perdas ----------
  ["GET", "perda/motivos", () => PD.motivos()],
  ["POST", "perda", ({ body, usuario }) => PD.registrar(body, usuario!)],

  // ---------- empresa por rotina ----------
  ["GET", "sistema/empresas", () => EM.listar()],
  ["POST", "sistema/empresas", ({ body, usuario }) => { exigirAdmin(usuario); return EM.salvar(body, usuario!); }],

  // ---------- retorno ----------
  ["GET", "retorno/opcoes", () => RT.opcoes()],
  ["GET", "retorno/origem/:tipo/:n", ({ p }) => RT.origem(p[0], Number(p[1]))],
  ["POST", "retorno", ({ body, usuario }) => RT.registrar(body, usuario!)],

  // ---------- conferência de expedição ----------
  ["GET", "conferencia/fila", ({ q }) => CF.fila(q)],
  ["GET", "conferencia", () => CF.listar()],
  ["GET", "conferencia/minhas", ({ usuario }) => CF.minhas(usuario!)],
  ["POST", "conferencia/:id/falta", ({ p, body, usuario }) => CF.falta(Number(p[0]), body, usuario!)],
  ["POST", "conferencia/:id/voltar", ({ p, usuario }) => CF.voltar(Number(p[0]), usuario!)],
  ["GET", "sistema/conferencia", () => CF.opcoes()],
  ["POST", "sistema/conferencia", ({ body, usuario }) => { exigirAdmin(usuario); return CF.salvarModo(body, usuario!); }],
  ["GET", "conferencia/romaneio/:n", ({ p }) => CF.romaneio(Number(p[0]))],
  ["GET", "conferencia/romaneios", () => CF.romaneios()],
  ["GET", "conferencia/pedido/:n", ({ p }) => CF.ficha(Number(p[0]))],
  ["GET", "conferencia/romaneio/:n/volumes", ({ p }) => CF.volumes(Number(p[0]))],
  ["POST", "conferencia/romaneio/:n/volumes", ({ p, body, usuario }) => CF.conferirVolume(Number(p[0]), body, usuario!)],
  ["POST", "conferencia/romaneio", ({ body, usuario }) => CF.abrirRomaneio(body, usuario!)],
  ["GET", "conferencia/:id", ({ p }) => CF.obter(Number(p[0]), false)],
  ["GET", "conferencia/:id/gestao", ({ p }) => CF.obter(Number(p[0]), true)],
  ["POST", "conferencia", ({ body, usuario }) => CF.abrir(body, usuario!)],
  ["POST", "conferencia/:id/contar", ({ p, body, usuario }) => CF.contar(Number(p[0]), body, usuario!)],
  ["POST", "conferencia/:id/fechar", ({ p, body, usuario }) => CF.fechar(Number(p[0]), usuario!, body.obs, body.volumes)],
  ["POST", "conferencia/:id/encerrar", ({ p, body, usuario }) => CF.encerrar(Number(p[0]), usuario!, body.obs)],
  ["POST", "conferencia/:id/cancelar", ({ p, body, usuario }) => CF.cancelar(Number(p[0]), usuario!, body.obs)],

  // ---------- recebimento de compra ----------
  ["GET", "recebimento/fila", ({ q, usuario }) => RB.fila(q, usuario!)],
  ["GET", "recebimento/minhas", ({ usuario }) => RB.minhas(usuario!)],
  ["GET", "recebimento/pedido/:n", ({ p, usuario }) => RB.ficha(Number(p[0]), usuario!)],
  ["GET", "recebimento", () => RB.listar()],
  ["POST", "recebimento", ({ body, usuario }) => RB.abrir(body, usuario!)],
  ["GET", "sistema/recebimento", () => RB.opcoes()],
  ["POST", "sistema/recebimento", ({ body, usuario }) => { exigirAdmin(usuario); return RB.salvarOpcoes(body, usuario!); }],
  ["GET", "recebimento/:id", ({ p }) => RB.obter(Number(p[0]))],
  ["GET", "recebimento/:id/gestao", ({ p }) => RB.gestao(Number(p[0]))],
  ["GET", "recebimento/:id/codigo/:cod", ({ p }) => RB.codigo(Number(p[0]), p[1])],
  ["GET", "recebimento/:id/notas", ({ p, q }) => RB.notas(Number(p[0]), q)],
  ["POST", "recebimento/:id/leituras", ({ p, body, usuario }) => RB.contar(Number(p[0]), body, usuario!)],
  ["POST", "recebimento/:id/falta", ({ p, body, usuario }) => RB.falta(Number(p[0]), body, usuario!)],
  ["POST", "recebimento/:id/fechar", ({ p, usuario }) => RB.fechar(Number(p[0]), usuario!)],
  ["POST", "recebimento/:id/encerrar", ({ p, body, usuario }) => RB.encerrar(Number(p[0]), body, usuario!)],
  ["POST", "recebimento/:id/recontar", ({ p, usuario }) => RB.recontar(Number(p[0]), usuario!)],
  ["POST", "recebimento/:id/cancelar", ({ p, body, usuario }) => RB.cancelar(Number(p[0]), body, usuario!)],
  ["POST", "recebimento/:id/nota", ({ p, body, usuario }) => RB.vincular(Number(p[0]), body, usuario!)],
  ["POST", "recebimento/:id/nota/remover", ({ p, usuario }) => RB.desvincular(Number(p[0]), usuario!)],

  // ---------- produção ----------
  ["GET", "producao/catalogo", () => P.catalogo()],
  ["GET", "producao/lotes", ({ q }) => P.lotes(String(q.get("codpro") || ""))],
  ["GET", "producao/simular", ({ q }) => P.simular(String(q.get("codpro") || ""), Number(q.get("qtd") || 1))],
  ["GET", "producao", ({ q }) => P.listar(q)],
  ["GET", "producao/minhas", ({ usuario }) => P.minhas(usuario!)],
  ["POST", "producao", ({ body, usuario }) => P.apontar(body, usuario!)],
  ["POST", "producao/reprocessar", ({ usuario }) => P.reprocessar(usuario!)],
  ["GET", "producao/:id/paletes", ({ p }) => P.paletes(Number(p[0]))],
  ["POST", "producao/:id/paletes", ({ p, body, usuario }) => P.imprimirPaletes(Number(p[0]), body, usuario!)],
  ["GET", "producao/:id", ({ p }) => ({ ...P.obter(Number(p[0])), historico: P.historico(Number(p[0])) })],
  ["POST", "producao/:id/lancar", ({ p, usuario }) => P.lancar(Number(p[0]), usuario!)],
  ["POST", "producao/:id/cancelar", ({ p, body, usuario }) => P.cancelar(Number(p[0]), body, usuario!)],
];

async function handle(req: Request, ctx: { params: Promise<{ rota: string[] }> }) {
  const partes = (await ctx.params).rota.map(decodeURIComponent);
  for (const [metodo, padrao, fn] of rotas) {
    const pp = padrao.split("/");
    if (metodo !== req.method || pp.length !== partes.length) continue;
    const args: string[] = [];
    if (!pp.every((x, i) => (x.startsWith(":") ? (args.push(partes[i]), true) : x === partes[i]))) continue;
    try {
      // acesso: código e senha do Lieto. Quem faz a ação é sempre o usuário da sessão (não o que vier no corpo).
      const token = req.headers.get("x-sessao"), usuario = S.validar(token);
      const acao = { origem: "TELA", rota: `${metodo} ${padrao}`, ref: args.join("/"), codfun: usuario?.codfun ?? null, usuario: usuario?.nome ?? "", ip: req.headers.get("x-forwarded-for") || "", dispositivo: req.headers.get("user-agent") || "" };
      if (!usuario && !PUBLICAS.has(`${metodo} ${padrao}`)) { if (metodo === "POST") A.marco(acao, 401, "Sem sessão"); return Response.json({ erro: "Entre com sua senha do Lieto." }, { status: 401 }); }
      if (usuario) try { PM.exigir(usuario, metodo, padrao, args); } catch (e) { if (metodo === "POST") A.marco(acao, 403, (e as Error).message); throw e; }
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      if (usuario) { body.usuario = usuario.nome; body.codfun = usuario.codfun; }
      const rodar = async () => fn({ p: args, q: new URL(req.url).searchParams, body, usuario, token });
      // toda ação (POST) é auditada; consultas não
      const r = metodo === "POST" ? await A.auditar({ ...acao, dados: body }, rodar) : await rodar();
      return Response.json(r ?? { ok: true });
    } catch (e) {
      const err = e as I.Erro;
      if (!err.status) console.error(e);
      return Response.json({ erro: err.message }, { status: err.status || 500 });
    }
  }
  return Response.json({ erro: "Rota não encontrada." }, { status: 404 });
}
export { handle as GET, handle as POST };
