// Só para o aparelho aceitar a instalação. Não guarda nada em cache: o coletor sempre usa a versão do servidor.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
