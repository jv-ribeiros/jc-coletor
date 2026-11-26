// Liberação de rotinas por código do funcionário (FUNCIONARIOS.CODFUN). Sem liberação = não usa.
// A trava é no servidor, em cada rota da API; as telas só escondem o que não pode. Administradores (config.admins) podem tudo.
import { db, getConfig, tx } from "./db";
import * as erp from "./erp";
import { Erro, evento, type Usuario } from "./comum";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const ROTINAS = [
  { id: "gestao", nome: "Acessar a gestão (web)" },
  { id: "inventario", nome: "Inventário: contar" }, { id: "inventario_avulso", nome: "Inventário: abrir avulso" }, { id: "inventario_iniciar", nome: "Inventário: começar programado no coletor" }, { id: "inventario_finalizar", nome: "Inventário: finalizar etapa no coletor" }, { id: "inventario_gestao", nome: "Inventário: gestão e auditoria" }, { id: "inventario_lancar", nome: "Inventário: lançar ajustes no Lieto" },
  { id: "producao", nome: "Produção: apontar" }, { id: "producao_gestao", nome: "Produção: cancelar e reenviar" },
  { id: "transferencia", nome: "Transferência" }, { id: "transformacao", nome: "Transformação" }, { id: "kit", nome: "Kit" }, { id: "perda", nome: "Perdas" }, { id: "estornar", nome: "Estornar movimentos" },
  { id: "cadastro", nome: "Cadastro no coletor" }, { id: "receita", nome: "Cadastro: receita" }, { id: "retorno", nome: "Retorno de mercadorias" },
  { id: "conferencia", nome: "Conferência de expedição" }, { id: "conferencia_gestao", nome: "Conferência: ver divergência, encerrar e cancelar" }, { id: "xml", nome: "Importação de XML" }, { id: "auditoria", nome: "Auditoria: consultar" },
];
const IDS = new Set(ROTINAS.map((r) => r.id));

export const ehAdmin = (u: { codfun: number } | null) => !!u && (getConfig().admins || []).includes(u.codfun);
export const de = (u: { codfun: number }): string[] => (ehAdmin(u) ? [...IDS] : (db().prepare("SELECT rotina FROM permissoes WHERE codfun = ?").all(u.codfun) as Row[]).map((r) => r.rotina as string).filter((r) => IDS.has(r)));

// O que cada rota exige: todas as listas precisam ter ao menos uma rotina liberada ("admin" = só administrador; [] = qualquer um logado)
const INV = ["inventario", "inventario_gestao", "inventario_lancar"], GES = ["inventario_gestao"];
const LIVRES = new Set(["GET sessao", "POST sessao/sair", "GET info", "GET erp/empresas", "GET erp/usuarios", "GET sistema/ddl", "GET produtos", "GET centros", "GET centros/saldo", "GET cadastro/:cod/palete"]);
const FIXAS: Record<string, string[][]> = {
  "GET inventarios": [INV], "GET inventarios/:id": [INV], "GET inventarios/:id/catalogo": [INV], "GET inventarios/:id/leituras": [INV], "GET inventarios/:id/pendentes": [INV], "GET inventarios/:id/itens/:cod": [INV],
  "POST inventarios/avulso": [["inventario"], ["inventario_avulso"]], "GET inventarios/programados": [INV], "GET inventarios/:id/contar-programado": [["inventario_iniciar"]], "POST inventarios/:id/comecar": [["inventario"], ["inventario_iniciar"]], "GET inventarios/avulso/empresa": [["inventario"], ["inventario_avulso"]],
  "POST inventarios/:id/leituras": [["inventario", "inventario_gestao"]], "POST leituras/:uid/cancelar": [["inventario", "inventario_gestao"]],
  "GET inventarios/:id/ajustes": [["inventario_gestao", "inventario_lancar"]], "GET inventarios/:id/log": [["inventario_gestao", "inventario_lancar"]], "POST inventarios/:id/lancar": [["inventario_lancar"]],
  "GET inventarios/:id/fechamento": [["inventario_finalizar", "inventario_gestao"]], "POST inventarios/:id/avancar": [["inventario_finalizar", "inventario_gestao"]],
  "POST transferencia": [["transferencia"]], "POST transformacao": [["transformacao"]], "GET transformacao/opcoes": [["transformacao"]], "POST kit": [["kit"]], "GET perda/motivos": [["perda"]], "POST perda": [["perda"]], "GET sistema/empresas": [], "GET sistema/conferencia": [], "GET alertas": [], "GET auditoria": [["auditoria"]], "GET auditoria/:trace": [["auditoria"]],
  "POST producao/reprocessar": [["producao_gestao"]], "POST producao/:id/lancar": [["producao_gestao"]], "POST producao/:id/cancelar": [["producao_gestao"]],
  "POST producao": [["producao"]],
  "GET receita/:cod": [["cadastro", "receita"]], "GET receita/:cod/obs": [["cadastro", "receita"]], "GET conferencia": [["conferencia_gestao"]], "GET conferencia/:id/gestao": [["conferencia_gestao"]], "POST conferencia/:id/encerrar": [["conferencia_gestao"]], "POST conferencia/:id/cancelar": [["conferencia_gestao"]],
};
function exigidas(metodo: string, padrao: string, args: string[]): string[][] {
  const k = `${metodo} ${padrao}`;
  if (LIVRES.has(k)) return [];
  if (FIXAS[k]) return FIXAS[k];
  if (padrao === "movs/:tipo") return [[args[0]]];
  if (padrao.startsWith("mov/:id/")) {
    const m = db().prepare("SELECT tipo FROM movs WHERE id = ?").get(Number(args[0])) as Row | undefined;
    if (!m) throw new Erro("Movimento não encontrado.", 404);
    return padrao.endsWith("/estornar") ? [[m.tipo], ["estornar"]] : [[m.tipo]];
  }
  const raiz = padrao.split("/")[0];
  if (raiz === "inventarios") return [GES];
  if (raiz === "producao") return [["producao", "producao_gestao"]];
  if (raiz === "cadastro") return [["cadastro"]];
  if (raiz === "receita") return [["receita"]];
  if (raiz === "retorno") return [["retorno"]];
  if (raiz === "conferencia") return [["conferencia", "conferencia_gestao"]];
  if (raiz === "xml") return [["xml"]];
  return [["admin"]]; // rota não mapeada: só administrador
}

// Rotas usadas pelo COLETOR. Todo o resto é da gestão e exige também "gestao" (além da rotina). Rota nova nasce fechada.
const COLETOR = new Set([...LIVRES, "POST inventarios/avulso", "GET inventarios/programados", "GET inventarios/:id/contar-programado", "POST inventarios/:id/comecar", "GET inventarios/avulso/empresa", "GET inventarios/:id/fechamento", "POST inventarios/:id/avancar", "GET inventarios/:id/catalogo", "GET inventarios/:id/pendentes", "POST inventarios/:id/leituras", "GET inventarios/:id/leituras", "POST leituras/:uid/cancelar",
  "GET producao/catalogo", "GET producao/lotes", "GET producao/simular", "GET producao/minhas", "POST producao", "POST transferencia", "POST transformacao", "GET transformacao/opcoes", "POST kit", "GET perda/motivos", "POST perda",
  "GET cadastro", "GET cadastro/:cod", "POST cadastro/:cod", "POST cadastro/:cod/barras", "POST cadastro/:cod/barras/alterar", "POST cadastro/:cod/barras/remover", "POST cadastro/:cod/palete",
  "GET receita/:cod", "GET receita/:cod/obs", "POST receita/:cod", "POST receita/:cod/remover", "GET retorno/opcoes", "GET retorno/origem/:tipo/:n", "POST retorno",
  "GET conferencia/fila", "GET conferencia/romaneios", "GET conferencia/pedido/:n", "GET conferencia/romaneio/:n/volumes", "POST conferencia/romaneio/:n/volumes", "GET conferencia/romaneio/:n", "POST conferencia/romaneio", "GET conferencia/:id", "POST conferencia", "POST conferencia/:id/contar", "GET conferencia/minhas", "POST conferencia/:id/falta", "POST conferencia/:id/voltar", "POST conferencia/:id/fechar"]);

export function exigir(u: Usuario, metodo: string, padrao: string, args: string[]) {
  const ex = [...(COLETOR.has(`${metodo} ${padrao}`) ? [] : [["gestao"]]), ...exigidas(metodo, padrao, args)];
  if (!ex.length || ehAdmin(u)) return;
  const tem = new Set(de(u)), falta = ex.find((l) => !l.some((r) => tem.has(r)));
  if (falta) throw new Erro(`Seu usuário (${u.codfun}) não tem liberação: ${falta.map((r) => ROTINAS.find((x) => x.id === r)?.nome || "administrador").join(" ou ")}.`, 403);
}

export async function listar() {
  const l = db().prepare("SELECT codfun, rotina FROM permissoes").all() as Row[], m = new Map<number, string[]>();
  for (const x of l) m.set(x.codfun, [...(m.get(x.codfun) || []), x.rotina]);
  return { rotinas: ROTINAS, usuarios: (await erp.usuariosAtivos()).map((u) => ({ ...u, admin: ehAdmin(u), rotinas: m.get(u.codfun) || [] })) };
}

export async function salvar(codfun: number, b: Row, u: Usuario) {
  if (!(await erp.usuariosAtivos()).some((x) => x.codfun === codfun)) throw new Erro("Funcionário não existe ou está desligado.");
  const rs = [...new Set((Array.isArray(b.rotinas) ? b.rotinas : []).map(String))];
  const ruim = rs.find((r) => !IDS.has(r));
  if (ruim) throw new Erro("Rotina desconhecida: " + ruim);
  tx(() => {
    db().prepare("DELETE FROM permissoes WHERE codfun = ?").run(codfun);
    const ins = db().prepare("INSERT INTO permissoes (codfun, rotina) VALUES (?, ?)");
    for (const r of rs) ins.run(codfun, r);
  });
  evento("permissoes", codfun, u, "ALTEROU LIBERAÇÕES", rs.join(", ") || "(nenhuma)");
}
