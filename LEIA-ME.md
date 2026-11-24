# Operações · Lieto

Rotinas operacionais (coletor + gestão web) integradas ao ERP Lieto (Firebird).
Next.js + SQLite local (`data/operacoes.db`), gravando direto no banco do Lieto.

| Módulo | Situação | Grava no Lieto |
|---|---|---|
| Inventário | pronto (trazido de `~/dev/inventario`) | `MESTOQUE` (ajustes) |
| Produção | pronto | `PRODUCOES` + `MESTOQUE` |
| Transferência entre centros (CCUSTOS) | pronto | `MESTOQUE` com `CODSET`; não altera o saldo |
| Transformação CX ↔ UN | pronto | `PRODUCOES` (CODMAP) + `MESTOQUE` OT-S/OT-E |
| Cadastro (coletor) | pronto | `PRODUTOS` (descrição, QNTCAI, pesos, local), `CONJUNTOS` (receita) e `PRODUTOSSIMILARES` (barras) |
| Retorno | pronto | `RETORNOS1/2` e 2 entradas por item na `MESTOQUE` |
| Conferência | pronto | `CONFERENCIAS1`, `CONFERENCIAS`, `PEDIDOS1.DATSEP` |
| Kit | pronto | `MESTOQUE`: entra o kit, saem os itens informados |
| Importação de XML (Shopee / ML) | pronto para teste | `CLIENTES`, `PEDIDOS1-4`, `NOTAS1-3`, `RECEBER` |

## Rodar
1. Node.js 22.13+ (usa `node:sqlite`).
2. Ajuste `config.json` (conexão Firebird, `codemp`, `admins`).
3. `iniciar.bat` (compila e sobe). Porta **3090**.
   - Gestão: `http://IP:3090` · Coletor: `http://IP:3090/coletor`
4. Primeira vez: entre com um usuário listado em `admins` e homologue a estrutura em **Sistema** (ver abaixo).

Acesso: só a senha do Lieto (`FUNCIONARIOS.SENFUN`); o código vem dela. Senha repetida entre ativos não entra. 15 erros em 5 min travam o login por 1 min. Demitido (`DATDEM`) não entra.

## Liberação de rotinas
Menu **Liberações** (só administrador): marca as rotinas por código do funcionário. Sem liberação não usa; a trava é no servidor
(`src/lib/server/permissoes.ts`). Rota nova não mapeada fica só para administrador.

## Conformidade do banco (checksum do DDL)
Cada rotina declara as tabelas, procedures e generators do Lieto de que depende (`src/lib/server/ddl.ts › ROTINAS`).
De cada objeto é tirada uma impressão digital: colunas (tipo, tamanho, escala, charset, NOT NULL), índices/chaves,
triggers (inclusive o fonte) e, nas procedures, parâmetros + fonte. A versão homologada fica em `ddl-homologado.json`.

- **No startup** o servidor confere e escreve no console se algo mudou; depois reconfere a cada 10 min.
- **Antes de toda gravação** no Lieto a rotina reconfere (cache de 60 s). Divergiu → gravação **bloqueada** (HTTP 423),
  faixa vermelha na gestão e aviso no coletor. Leituras continuam funcionando.
- **Sistema › Conformidade do banco** mostra o diff (linha a linha) de cada objeto alterado.
- Só administrador (`config.admins`) homologa a nova estrutura, digitando HOMOLOGAR. A anterior vira `ddl-homologado.<data>.bak.json`.

Ao criar uma rotina nova que grava no Lieto: inclua-a em `ROTINAS` e chame `ddl.exigir("<id>")` antes de gravar.

## Estoque gerencial
Todos os movimentos gravam `PEDENT = 'V'` (gerencial), configurável em `estoque.pedent`.
O saldo exibido segue a regra da `SP_ESTOQUE` (MODEST 0); no servidor Firebird 2.0 a procedure não executa
("Invalid request BLR") e o mesmo cálculo é feito em SQL (`estoque.calculo: auto`).

## Produção
Coletor › Produção: lê o código do produto (barras, DUN, EAN tributável ou código), informa quantidade, lote e data.
Só aparecem produtos com ficha técnica (`CONJUNTOS` com `BAIEST = 'S'`).

Lançamento (igual ao Lieto, quantidades conferidas em 2.586 produções desde jun/2026):
- `PRODUCOES`: `NUMIDE = max+1` (o Lieto não usa generator; em colisão tenta o próximo), `PEDENT`, `BAIEST = 'S'`,
  `NUMLOT`, `DATPRO/DATFAB`, `HORPRO`, `PRECUS` = custo unitário, `OBSPRO = "[OPS <uid>] obs"`.
- `MESTOQUE`: uma saída por insumo (`SAÍDA PARA PRODUÇÃO <lote>  - <numide>`) e uma entrada do produzido
  (`PRODUÇÃO <lote>  - <numide>`), com `IDEPRO`, `CODINT`, `CODFUN` do operador.
  - quantidade do insumo = qtd × `QNTCON` (ou × `QNTCON / QNTVEN` quando `QNTVEN > 0`, ex. 1 CX = 12 UN)
  - `PRECUS` do insumo = custo do insumo × `QNTCON`; do produzido = soma.
- Não altera `PRODUTOS.PRECUS` (o Lieto também não).
- Tudo numa transação. A marca `[OPS <uid>]` impede lançamento em dobro: se cair a conexão depois do commit, o reenvio só reconcilia.
- `producao.lancamentoAutomatico` (padrão `true`): lança ao apontar. Se falhar (Lieto fora, banco bloqueado), fica
  PENDENTE/ERRO e a gestão reenvia em **Produção › Reenviar pendentes**. Estorno de produção lançada: no Lieto.
- Lote: só os cadastrados para o produto em `LOTESENTRADAS` e não vencidos (ou sem lote).
- `producao.bloquearSaldoNegativo`: recusa o apontamento se faltar insumo.

## Testes sem tocar na base real
```
set OPS_CONFIG=C:\caminho\config-teste.json   (firebird.database apontando para uma cópia)
set OPS_DATA=C:\caminho\data-teste
set OPS_DDL=C:\caminho\ddl-teste.json
set NEXT_DIST=.next-teste
```

## Migrar dados do inventário antigo
Pare os dois sistemas e copie `~/dev/inventario/data/inventario.db` para `data/operacoes.db`
(as tabelas novas são criadas sozinhas na primeira execução).
