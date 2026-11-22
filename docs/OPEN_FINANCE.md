# Bancos pela Pluggy: como funciona no Cruzado

## Situação

| Item | Estado |
| --- | --- |
| Leitura de contas, saldos, transações e cartões | **Implementado**, validado com provedor simulado no contrato documentado (`tests/integration/open-finance.test.ts`, `tests/integration/pluggy-sync.test.ts`) |
| Widget oficial (Pluggy Connect), webhook e fila | **Implementado**, validado com simulador de contrato |
| Sandbox da Pluggy | **Não testado**: depende de credenciais |
| API real, banco real, widget real no navegador | **Não testado** |
| Publicado | Sim, em 31/10/2026, com a migração `0007_pluggy_sync.sql` aplicada. Sem credenciais da Pluggy configuradas; modo pessoal escolhido |
| Pagamentos, Pix, empréstimos, investimentos | **Não existem**, por decisão de projeto |

O Cruzado nunca recebe a senha do banco. Ele não é participante do Open Finance Brasil.

## Qual modo usar

Os dois modos mantêm a regra atual: **só a conta `PLUGGY_OWNER_USER_ID` conecta bancos, e ela precisa de verificação em duas etapas.** Trocar de modo não libera outros usuários.

| | Pessoal (`PLUGGY_MODE=personal`, padrão) | Connect (`PLUGGY_MODE=connect`) |
| --- | --- | --- |
| Contrato | Meu Pluggy, para os dados da própria pessoa | Pluggy para desenvolvedores |
| Preço consultado em 31/10/2026 | Gratuito, até 5 conexões, sem SLA | Dados a partir de R$ 2.500/mês, com até 500 conexões ativas; teste de 15 dias |
| Como conecta | Autoriza em meu.pluggy.ai e cola o Item ID | Widget oficial, com instituições Open Finance |
| Reautorizar | No Meu Pluggy | Pelo widget, no Cruzado |
| Webhook | Não necessário | Recomendado |

Preços e termos mudam: confirme em [pluggy.ai/precos](https://www.pluggy.ai/precos) antes de contratar. A API pessoal não vira serviço multiusuário por remover uma condição do código. Abrir para outras pessoas exige contrato, revisão jurídica (LGPD e Resolução Conjunta nº 21/2026) e uma decisão explícita de arquitetura.

Por que não conectar direto aos bancos: as APIs do Open Finance Brasil só atendem instituições autorizadas pelo Banco Central, com certificados e auditoria. Um app independente precisa de um participante regulado no meio.

## Variáveis

Todas ficam só no servidor, nunca com `NEXT_PUBLIC_`.

| Variável | Uso |
| --- | --- |
| `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` | Autenticação no servidor |
| `PLUGGY_OWNER_USER_ID` | A conta autorizada a conectar bancos |
| `PLUGGY_MODE` | `personal` ou `connect`. Também é lida no build: define se a CSP libera `https://connect.pluggy.ai` |
| `PLUGGY_WEBHOOK_SECRET` | Valor enviado pela Pluggy no cabeçalho `Authorization` |
| `PLUGGY_INCLUDE_SANDBOX` | `1` mostra conectores de teste. Nunca em produção |
| `CRON_SECRET` | Protege `/api/cron/banks` e `/api/cron/agents` |

## Roteiro: ativar o modo pessoal

É o caminho mais simples para uso pessoal. Não precisa de widget, webhook nem agendador externo: o cron diário e o botão **Atualizar agora** bastam, porque o Meu Pluggy atualiza a cada 24 horas.

1. Publique o Cruzado com `APP_ENCRYPTION_KEY` definida, que criptografa a conexão bancária.
2. Crie sua conta no Cruzado e ative a verificação em duas etapas em **Configurações › Segurança**.
3. Copie seu ID de usuário. Ele aparece em **Configurações › Integrações** enquanto `PLUGGY_OWNER_USER_ID` estiver vazio.
4. Em [meu.pluggy.ai](https://meu.pluggy.ai), autorize cada banco.
5. No [painel da Pluggy](https://dashboard.pluggy.ai), crie uma aplicação, confirme o conector **MeuPluggy** habilitado e conecte-o em **Applications › Demo**. Anote `Client ID`, `Client Secret` e o **Item ID** de cada banco.
6. Configure as variáveis, uma por vez, e publique de novo:

```bash
npx vercel@latest env add PLUGGY_CLIENT_ID production
```

```bash
npx vercel@latest env add PLUGGY_CLIENT_SECRET production
```

```bash
npx vercel@latest env add PLUGGY_OWNER_USER_ID production
```

```bash
npx vercel@latest deploy --prod
```

7. Em **Configurações › Integrações**, cole o Item ID e confirme sua senha do Cruzado.
8. Confira contas, saldos, datas e sinais com o app do banco, e se a fatura não aparece como gasto.

Depois de criar sua conta, considere `ALLOW_SIGNUP=0` e `ALLOW_DEMO=0`, ou uma instância separada para a demonstração: isso reduz quem consegue se autenticar no banco que guarda seus dados.

Limites do Meu Pluggy consultados em 31/10/2026: até 5 conexões, sem SLA, sem categorização e só com os dados que você conectou lá. Sem a categorização da Pluggy, fatura e transferências dependem das regras locais de descrição: confira esse ponto no passo 8.

## Roteiro: testar no sandbox

Precisa de credenciais do painel da Pluggy; use só dados de teste.

1. Crie a conta no Cruzado local, ative a verificação em duas etapas e defina `PLUGGY_OWNER_USER_ID`.
2. Defina `PLUGGY_MODE=connect`, `PLUGGY_INCLUDE_SANDBOX=1` e as credenciais no `.env.local`.
3. Gere a build com essas variáveis, pois a CSP é definida no build.
4. Em **Configurações › Integrações**, conecte com o conector sandbox.
5. Use `user-ok` e `password-ok`. Para Open Finance, o CPF `761.092.776-73`.
6. Repita com `user-error`, `user-locked` e o CPF `163.511.711-99` para ver os erros.
7. Confira contas, saldos, datas e sinais.

Pontos que só o sandbox confirma, e que os testes simulados não cobrem:

- o widget abre com a CSP atual;
- o nome real dos campos de `onSuccess` e `onError`;
- o parâmetro `isOpenFinance` em `GET /connectors`;
- os nomes das categorias `Credit card payment` e `Same person transfer`;
- o sinal e a data das transações reais.

## Roteiro: ativar em produção

Cada passo depende de você.

1. Decida o modo e contrate o plano, se for Connect.
2. Faça backup do banco. No Neon, crie um branch antes de migrar.
3. Defina as variáveis na Vercel. Sem `PLUGGY_INCLUDE_SANDBOX`.
4. Publique. A migração `0007` roda na primeira conexão do app, salvo com `SKIP_AUTO_MIGRATE=1`, caso em que use `npm run db:migrate`.
5. Com Connect, registre o webhook uma vez, com as variáveis definidas no ambiente:

```bash
npx tsx scripts/pluggy-webhook.ts
```

6. Configure um agendador externo, conforme a próxima seção.
7. Conecte um banco real e confira o saldo com o app do banco.

**Reversão:** `0007` só adiciona colunas e tabelas, sem apagar nada. A versão anterior do app ignora essas colunas e continua funcionando. Para remover, depois de voltar o código, apague as tabelas `bank_webhook_events` e `bank_connect_attempts` e as colunas novas. Isso descarta o estado de sincronização e os textos originais guardados, então só faça com backup.

## Sincronização

```text
Pluggy → POST /api/webhooks/pluggy → confere o segredo → grava em bank_webhook_events → 200
                                                   ↓
                     after() · /api/cron/banks · cron diário
                                                   ↓
              relê o item e as contas na Pluggy → grava página a página
```

- **O evento é só um aviso.** O dado confiável vem de uma nova consulta à Pluggy. Evento repetido ou fora de ordem chega ao mesmo resultado.
- **Autenticação do webhook:** a Pluggy não assina as entregas. A documentação oferece cabeçalho próprio, por isso o registro pela API com `Authorization`. Sem o segredo, a rota responde 503; com o segredo errado, 401.
- **Retomada:** cada página fica gravada com um cursor. Uma execução interrompida continua de onde parou, sem refazer o que já leu.
- **Concorrência:** uma execução por conexão, por uma reserva com expiração de 5 minutos, recuperável se o processo morrer.
- **Falhas temporárias e 429:** nova tentativa com espera crescente, respeitando `RateLimit-Reset`.
- **Primeira leitura:** todo o histórico que a Pluggy entrega.
- **Depois:** relê 45 dias, ou mais, quando um evento aponta lançamento antigo.

Quando acontece de verdade: o cron diário da Vercel (`vercel.json`) drena a fila uma vez ao dia. O `after()` acelera o caso comum, mas não garante nada. Para retentativas em minutos, um agendador externo precisa chamar a rota:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://SEU-DOMINIO/api/cron/banks
```

## Estados

| Na tela | Significa | O que fazer |
| --- | --- | --- |
| Processando | Vínculo criado, primeira leitura em andamento | Aguardar |
| Conectada | Última leitura concluída | Nada |
| Reautorização necessária | Consentimento expirado ou revogado, ou o banco pede ação | Reautorizar |
| Erro | Falha na leitura, ou o banco respondeu em parte | Aguardar a nova tentativa ou atualizar |
| Desconectada | Atualizações interrompidas | Reconectar, ou excluir o histórico |

Em qualquer falha, os dados anteriores continuam visíveis e a "última atualização concluída" não avança.

## Integridade financeira

- **Vazio não é zero.** Consentimento expirado devolve listas vazias, sem erro. Isso vira "Reautorização necessária" e nada é apagado. Saldo ausente mantém o último valor; conta que veio vazia não perde lançamentos.
- **Exclusão só com leitura completa.** Remover o que sumiu exige item `UPDATED`/`SUCCESS`.
- **Saldo:** o valor do banco fica em `bank_balance_cents`. O saldo inicial é ajustado para que saldo inicial + transações seja igual a ele.
- **Pendente → efetivada:** continua a mesma linha, com os novos dados, mesmo que o banco passe a informar `providerId`.
- **Seus dados:** categoria, observação e descrição editada sobrevivem à sincronização. O texto do banco fica em `provider_description`.
- **Datas:** valores sem horário ou à meia-noite UTC são tratados como data de calendário. Horários reais são convertidos para Brasília, como pede a documentação.
- **Cartão:** valor positivo é compra. Conta corrente: a direção vem de `type`.
- **Fatura e transferências:** `Credit card payment` e `Same person transfer` ficam em categorias de transferência e não entram em entradas nem saídas.
- **Parcelas:** cada parcela guarda o próprio valor. Parcelas futuras não entram.
- **Moeda:** só BRL. Conta em outra moeda é ignorada, com aviso; compra estrangeira usa o valor na moeda da conta, ou é ignorada se ele faltar.
- **Duplicidade:** sem identificador comum, entrada manual, WhatsApp e arquivo contra banco viram sugestão em **Revisar**. Nada é apagado por ter mesmo dia e valor.
- **IA:** esta integração não envia transações a nenhum modelo externo.

## Desconectar e excluir

São ações separadas.

- **Desconectar** interrompe as atualizações, apaga o identificador guardado e remove o item na Pluggy. O histórico fica.
- **Excluir histórico** só existe depois de desconectar. Pede `EXCLUIR` e sua senha, e apaga apenas os lançamentos vindos do banco.

A documentação consultada **não garante** que apagar o item revoga o consentimento na instituição. Por isso a tela orienta conferir também no app do banco. Vale confirmar com a Pluggy.

## Propriedade e segurança

| Risco | Controle |
| --- | --- |
| Item de outra pessoa enviado pelo navegador | Cada abertura do widget gera uma tentativa ligada à sessão. O servidor relê o item e exige que `clientUserId` seja a referência dessa tentativa |
| Callback repetido | A tentativa é consumida uma vez, de forma atômica |
| Conexão de outra conta | Toda leitura, atualização e exclusão filtra por `userId` |
| Segredos no navegador | Ele recebe só o Connect Token, de 30 minutos e com acesso limitado |
| Sessão roubada vincular um banco | 2FA obrigatório e nova senha |
| Vazamento do banco | Item ID cifrado com AES-256-GCM; eventos guardam hash de item e de transações |
| Injeção em caminho ou SSRF | IDs validados, URL base fixa, sem redirecionamentos; do `next` só o cursor é usado |
| Texto de Pix como prompt injection | Descrições sanitizadas ao entrar |
| Webhook falso | Segredo comparado em tempo constante; o conteúdo do evento nunca é tratado como dado do banco |

## Observabilidade e diagnóstico

Sem revelar segredos:

```sql
SELECT status, count(*), max(last_error) FROM bank_webhook_events GROUP BY status;
SELECT label, status, failure_count, last_attempt_at, last_sync_at, next_attempt_at FROM financial_connections WHERE connector = 'open_finance';
```

| Sintoma | Verifique |
| --- | --- |
| Webhook responde 503 | `PLUGGY_WEBHOOK_SECRET` ou `PLUGGY_CLIENT_ID` ausentes |
| Webhook responde 401 | Segredo diferente do registrado; registre de novo |
| Evento parado em `received` | Agendador; `last_error` traz o motivo |
| Conexão parada em Erro | `failure_count`, `next_attempt_at` e os logs `[bank-sync]` |
| Widget não abre | CSP: a build foi feita com `PLUGGY_MODE=connect`? |

Eventos e tentativas são removidos depois de 30 dias pelo cron diário.

## Limites conhecidos

- Um lançamento que o banco reemite com novo `id` e novo `providerId` perde categoria e observação. A documentação diz que a maioria das mudanças mantém o `id`.
- A meia-noite UTC exata de um horário real seria lida como data de calendário. É raro, mas confira as datas na primeira sincronização real.
- A chave da conta usa o nome do banco informado pela Pluggy. Confira se ele não é um rótulo genérico.
- Faturas fechadas (`/bills`) não são lidas; o ciclo vem das transações e dos dados do cartão.
