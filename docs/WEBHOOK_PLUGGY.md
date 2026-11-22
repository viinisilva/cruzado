# Ligar o webhook da Pluggy

Situação em 17/11/2026: **desligado**. O código está pronto e testado; falta só a configuração, que é sua. Nada aqui foi registrado ou alterado por mim.

## Por que ligar

Sem webhook, o Cruzado só fica sabendo de mudanças pelas sincronizações agendadas (`vercel.json`). A Pluggy avisa que ler por polling **perde mudanças de PENDING para POSTED** e não informa lançamentos apagados (pré-autorizações canceladas). Com o webhook:

- `transactions/created` e `transactions/updated` pedem uma sincronização a partir da data mais antiga afetada;
- `transactions/deleted` apaga o lançamento na hora e sincroniza de novo;
- `item/*` atualiza o estado da conexão.

Toda sincronização, venha do webhook, do cron ou do botão, termina com a calibração dos cartões. O caminho principal continua sendo o cron; o webhook só adianta.

## O que já existe no código

| Peça | Onde |
| --- | --- |
| Rota que recebe e só guarda o evento (responde em menos de 10 s) | `src/app/api/webhooks/pluggy/route.ts` |
| Fila durável e processamento | `src/lib/connectors/bank-work.ts` (`storeBankEvent`, `processBankWork`) |
| Script de registro (uma vez) | `scripts/pluggy-webhook.ts` |
| Drenagem da fila pelo cron | `/api/cron/agents` e `/api/cron/banks` |

A Pluggy não assina as entregas. A única prova de origem é o cabeçalho `Authorization: Bearer <segredo>`, que o script registra junto com a URL.

## O que você precisa fazer

1. **Gerar um segredo** longo e aleatório (por exemplo, 48 caracteres). Não reutilize nenhum outro.
2. **Na Vercel**, em Settings › Environment Variables do projeto, criar `PLUGGY_WEBHOOK_SECRET` com esse valor, só em *Production*.
3. **Fazer um deploy** (ou redeploy) para a variável valer. Antes disso a rota responde `503 not configured`, o que é o esperado.
4. **Registrar o webhook** uma única vez, numa máquina sua, com as credenciais de produção da Pluggy:

   ```bash
   PLUGGY_CLIENT_ID=... PLUGGY_CLIENT_SECRET=... PLUGGY_WEBHOOK_SECRET=... APP_URL=https://<seu-domínio> npx tsx scripts/pluggy-webhook.ts
   ```

   O script recusa URL sem `https://`. Rodar de novo cria um segundo webhook: confira no painel da Pluggy antes.
5. **Conferir**: no painel da Pluggy (Webhooks), o evento de teste deve receber `200 ok`. Um `401` significa segredo diferente entre a Vercel e o registro.

## Como desligar

- Apague o webhook no painel da Pluggy, ou
- remova `PLUGGY_WEBHOOK_SECRET` da Vercel e faça redeploy: a rota passa a responder `503` e a Pluggy desiste depois das tentativas.

Nada se perde ao desligar: o cron continua sincronizando.

## Cota do Open Finance

Cada sincronização de cartão faz duas leituras de transações. A cota é de 240 leituras de transações recentes por mês, por CPF e instituição. Com duas sincronizações agendadas por dia, cada cartão usa cerca de 120 por mês. Os eventos do webhook pedem sincronização, mas o pedido só é atendido pela próxima execução, então eventos em rajada não multiplicam as leituras. As faturas (`/bills`) continuam limitadas a uma leitura a cada 20 horas.
