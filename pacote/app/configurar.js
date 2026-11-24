// Grava o config.json com os valores vindos do instalador (variavel de ambiente). Mantem o resto do que ja existir.
const fs = require("fs"), e = process.env, arq = __dirname + "/config.json", novo = !fs.existsSync(arq);
const m = JSON.parse(fs.readFileSync(novo ? __dirname + "/config.modelo.json" : arq, "utf8").replace(/^﻿/, ""));
if (e.L_HOST) Object.assign(m.firebird, { host: e.L_HOST, port: Number(e.L_PORT), database: e.L_DB, user: e.L_USER, password: e.L_PASS || "" });
if (novo) m.xml.importadas = __dirname.split(require("path").sep).join("/") + "/XML-importadas";
if (e.L_ADMINS !== undefined) {
  const a = [...new Set(e.L_ADMINS.split(/[^0-9]+/).filter(Boolean).map(Number))].filter((n) => n > 0);
  if (!a.length) { console.error("Informe ao menos um codigo."); process.exit(1); }
  m.admins = a;
  if (!m.lancamento.codfun) m.lancamento.codfun = a[0];
}
fs.writeFileSync(arq, JSON.stringify(m, null, 2));
