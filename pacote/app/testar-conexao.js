// So consulta: confere a conexao com o Lieto e mostra as empresas (ou os funcionarios).
const F = require("node-firebird"), c = JSON.parse(require("fs").readFileSync(__dirname + "/config.json", "utf8")).firebird;
const fun = process.argv[2] === "funcionarios";
setTimeout(() => { console.error("ERRO: sem resposta do banco."); process.exit(1); }, 20000);
F.attach({ ...c, pluginName: F.AUTH_PLUGIN_LEGACY, wireCrypt: F.WIRE_CRYPT_DISABLE }, (e, d) => {
  if (e) { console.error("ERRO:", e.message); process.exit(1); }
  d.query(fun ? "select codfun c, nomfun n from funcionarios order by codfun" : "select codemp c, nomemp n from empresas order by codemp", (x, r) => {
    if (x) { console.error("ERRO:", x.message); process.exit(1); }
    console.log(fun ? "Funcionarios do Lieto:" : "Conectado. Empresas:");
    for (const l of r) console.log("  " + l.C + " - " + String(l.N).trim());
    d.detach(() => process.exit(0));
  });
});
