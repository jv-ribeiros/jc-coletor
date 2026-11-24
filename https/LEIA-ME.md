# HTTPS no servidor local (sem domínio)

1. Fixe o IP do servidor (no Windows ou reserva no roteador). Se mudar, rode o `instalar-https.bat` de novo.
2. Abra `instalar-https.bat` e aceite a permissão de administrador. O Caddy já vem junto. Se houver mais de uma rede, escolha a dos coletores.
3. No fim aparecem os dois endereços: o do certificado e o do sistema. Se a porta 443 ou 80 estiver ocupada, ele usa outra e mostra.

## Em cada coletor
1. **Sincronize as leituras no endereço antigo.** As não enviadas não passam para o novo.
2. Abra o endereço do certificado e baixe.
3. Configurações > Segurança > Criptografia e credenciais > Instalar certificado > **Certificado CA** (o caminho muda por marca). O Android pode exigir senha de tela.
4. Abra o endereço do sistema. Não pode aparecer aviso de segurança.
5. Entre, toque em **Instalar** e apague o atalho antigo.

Teste em UM coletor antes de fazer os outros.

## Depois que todos estiverem no HTTPS
Desative no Firewall do Windows a regra `Operacoes Lieto 3090`.

## Cuidados
- A pasta `dados` guarda a chave da autoridade: quem a tiver pode se passar por sites nos coletores. Não copie nem envie.
- Backup de `dados` só em local protegido. Sem ela, é preciso reinstalar o certificado em todos os coletores.
- Cada empresa gera a sua própria autoridade.
