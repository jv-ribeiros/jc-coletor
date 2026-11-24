// Roda uma vez quando o servidor sobe: confere a estrutura do banco do Lieto antes de qualquer rotina.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const ddl = await import("@/lib/server/ddl");
  const s = await ddl.verificar();
  const ruins = s.rotinas.filter((r) => !r.ok);
  if (s.erro) console.error("\n[CONFORMIDADE] Não foi possível ler a estrutura do Lieto:", s.erro, "\n");
  else if (!s.homologado) console.warn("\n[CONFORMIDADE] Estrutura do banco ainda NÃO homologada. Gravações no Lieto bloqueadas até homologar em /sistema.\n");
  else if (ruins.length) {
    console.error("\n" + "!".repeat(70) + "\n[CONFORMIDADE] O BANCO DO LIETO MUDOU. Rotinas BLOQUEADAS para gravação:");
    for (const r of ruins) console.error(`  - ${r.nome}: ${r.diferencas.map((d) => d.objeto).join(", ")}`);
    console.error("Confira em /sistema antes de homologar.\n" + "!".repeat(70) + "\n");
  } else console.log(`[CONFORMIDADE] OK: estrutura do Lieto (versão ${s.versaoLieto}) igual à homologada.`);
  // pasta de XML (com subpastas): lê a cada 10 s (sem pasta definida, não faz nada)
  const xml = await import("@/lib/server/xml");
  const imp = await import("@/lib/server/xmlimport");
  setInterval(() => { xml.varrer().catch((e) => console.error("[XML]", e)).then(() => imp.processar()).catch((e) => console.error("[XML]", e)); }, 10_000).unref?.();
  // reconfere a cada 10 minutos (alguém pode atualizar o Lieto com o sistema no ar)
  setInterval(() => ddl.verificar().catch(() => {}), 10 * 60_000).unref?.();
}
