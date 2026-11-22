# WhatsApp (API oficial da Meta)

Registra gastos e receitas por mensagem, usando a WhatsApp Business Cloud API. É opcional: sem as variáveis abaixo, o webhook responde 503 e a aba mostra "Ainda não ativado".

## Situação

| Etapa | Estado |
| --- | --- |
| Implementado | Sim |
| Testado localmente com simulador e fixtures | Sim |
| Testado com a Meta real | **Não.** Depende das credenciais e de uma mensagem real |
| Publicado | Sim, em 31/10/2026, ainda sem credenciais da Meta configuradas |

Só considere a integração operacional depois de concluir o [roteiro de ativação](#roteiro-de-ativação) com uma mensagem real.

## Como funciona

```text
Meta → POST /api/whatsapp/webhook → assinatura → grava em whatsapp_inbox → 200
                                                     ↓
                  after() · /api/cron/whatsapp · npm run worker
                                                     ↓
          uma transação: lançamento + estado da mensagem + resposta na fila
                                                     ↓
                      whatsapp_outbox → POST /{PHONE_NUMBER_ID}/messages
```

- **Uma mensagem, um lançamento.** A chave é `provedor + número de destino + wamid`, com índice único no banco. Reentregas, mesmo dias depois, não duplicam nada.
- **Duas mensagens iguais com IDs diferentes são duas compras.** Não há janela de tempo no WhatsApp.
- **Falha no processamento** desfaz a transação inteira. A mensagem volta para a fila com espera crescente; depois de 5 tentativas, o usuário é avisado de que nada foi registrado.
- **Falha no envio** nunca recria o lançamento. Código 429 ou 5xx tenta de novo com espera crescente; timeout vira estado `unknown` e não é reenviado, porque a Meta pode ter aceitado a mensagem.
- **Ordem:** mensagens do mesmo remetente são processadas uma por vez, na ordem do evento.
- **Data:** vem do horário do evento da Meta, em America/Sao_Paulo, e não do horário do processamento.
- **Janela de 24 horas:** respostas fora da janela ficam como `expired`.

O leitor de mensagens é determinístico e em português. Esta versão não usa IA nem chama nada com o texto recebido.

## Variáveis

Configure apenas no servidor, nunca com `NEXT_PUBLIC_`.

| Variável | Uso | Obrigatória para |
| --- | --- | --- |
| `WHATSAPP_APP_SECRET` | Valida `X-Hub-Signature-256` | Receber |
| `WHATSAPP_VERIFY_TOKEN` | Valor que você escolhe para o handshake | Receber |
| `WHATSAPP_PHONE_NUMBER_ID` | Número de destino aceito | Receber e responder |
| `WHATSAPP_ACCESS_TOKEN` | Token de sistema para enviar mensagens | Responder |
| `META_GRAPH_API_VERSION` | Versão da Graph API, sem valor padrão de propósito | Responder |
| `WHATSAPP_WABA_ID` | Identifica a conta; fica para diagnóstico | Opcional |
| `WHATSAPP_DISPLAY_NUMBER` | Só dígitos, para o link wa.me em Configurações | Opcional |
| `CRON_SECRET` | Protege `/api/cron/whatsapp` | Agendador |

`APP_ENCRYPTION_KEY` e `APP_URL` já são exigidas pelo app. Sem o token de acesso, os lançamentos funcionam e as respostas aguardam na fila.

## Roteiro de ativação

Depois de publicar o código e aplicar a migração `0006_whatsapp.sql`:

1. Na Meta for Developers, crie um app do tipo Business com o produto WhatsApp.
2. Copie o App Secret e o Phone Number ID; gere um token de usuário do sistema com `whatsapp_business_messaging`.
3. Defina as variáveis na Vercel e faça um novo deploy.
4. Configure o webhook, com a URL de callback `https://SEU-DOMINIO/api/whatsapp/webhook` e o verify token escolhido.
5. Assine o campo `messages`.
6. Configure o agendador, conforme a próxima seção.
7. No app, abra Configurações › WhatsApp, gere o código e envie-o pelo WhatsApp.
8. Volte ao app, confira o número mascarado e confirme com a senha.
9. Envie `gastei 1 no pix no teste`, confira o lançamento e toque em **Desfazer**.

## Fila e agendador

O `after()` do webhook processa a fila logo depois da resposta, mas isso é só uma aceleração. Para retentativas, algo precisa chamar a fila regularmente:

- **Vercel Hobby:** o cron nativo roda uma vez por dia, o que não basta para retentativas. Use um agendador externo que chame a rota a cada minuto:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://SEU-DOMINIO/api/cron/whatsapp
```

- **Vercel Pro:** adicione a rota aos crons do `vercel.json`, com frequência de um minuto.
- **Servidor próprio:** `npm run worker` verifica a fila a cada 5 segundos.

O cron diário também drena a fila, apenas como rede de segurança. Sem agendador, uma mensagem cujo processamento falhou pode esperar até o dia seguinte; ela não se perde.

## Vincular um número

1. A sessão autenticada gera um código `CRUZADO-XXXXXXXX`, válido por 10 minutos e de uso único. Só o hash fica no banco.
2. O usuário envia o código ao número oficial. O servidor consome o código de forma atômica, com limite de tentativas por remetente.
3. O vínculo fica pendente. Só depois de confirmar no app, vendo o número mascarado e informando a senha, a escrita é liberada.

Um número não pode servir a dois usuários. Desconectar apaga o número do vínculo, cancela rascunhos e bloqueia na hora as mensagens que ainda estão na fila.

## O que o bot entende

| Mensagem | Resultado |
| --- | --- |
| `gastei 60 no pix no mercado` | Registra, ou pede confirmação no modo de revisão |
| `gastei 60 no pix` | Guarda valor e forma de pagamento e pergunta a descrição |
| `paguei 60 no almoço ontem pelo Nubank` | Usa a conta citada e a data de ontem; não presume Pix |
| `recebi 200 de um freela` | Receita |
| `recebi 200 no pix do João` | Pede confirmação; pode ser devolução ou dinheiro entre contas próprias |
| `vou gastar 60 amanhã` · `quanto gastei?` | Não registra |
| `transferi 60 entre minhas contas` | Não registra; não é gasto |
| `60 mercado e 20 estacionamento` | Pede uma mensagem por lançamento |
| `corrigir para 65` · `desfazer` | Age se houver um único candidato nas últimas 24 horas; com mais de um, pede o botão da mensagem certa |
| Áudio, imagem, documento | Responde que só lê texto |

Pix é forma de pagamento, nunca conta ou categoria. Crédito só vai para cartão; Pix e débito, para conta bancária; dinheiro, para conta do tipo dinheiro. Sem conta compatível única, o bot pergunta.

Desfazer e corrigir valem por 24 horas, apenas para lançamentos criados pela própria conversa e ainda não conciliados.

## Conciliação com o extrato

Quando CSV, OFX ou Open Finance traz um lançamento com mesma conta, mesmo valor e data até 2 dias de diferença, ele aparece em **Transações › Possíveis correspondências**. Nada é unido sozinho.

Ao confirmar, a linha do banco passa a ser o registro. O lançamento informado sai dos totais, mas continua guardado, e a ação pode ser desfeita. Dispensar impede que o mesmo par seja sugerido de novo. Em conta conectada, o saldo exibido é o do banco.

## Privacidade e retenção

- As mensagens passam pelos servidores da Meta; a aba avisa isso antes do vínculo.
- O texto e o número ficam cifrados e são apagados da caixa de entrada quando a mensagem é resolvida.
- O remetente é identificado por HMAC com chave do servidor; a tela só recebe o número mascarado.
- O número cifrado na fila de saída e os IDs de evento ficam por 30 dias, acima da janela de reentrega. A limpeza roda no cron diário.
- Os logs guardam apenas a primeira linha do erro, sem texto da mensagem. `last_error` mascara sequências longas de dígitos.

## Diagnóstico sem revelar segredos

| Sintoma | Verifique |
| --- | --- |
| Verificação do webhook falha | `WHATSAPP_VERIFY_TOKEN` e o ambiente do deploy; a rota responde 403 |
| Rota responde 401 | `WHATSAPP_APP_SECRET` diferente do app que envia os eventos |
| Rota responde 503 | Variáveis obrigatórias ausentes nesse ambiente |
| Mensagem chega e nada acontece | `whatsapp_inbox` por `status`, `attempts` e `last_error`; confira o agendador |
| Lançamento criado, sem resposta | `whatsapp_outbox` por `status`, `last_error` e `delivery_status`; confira token e versão |
| `unknown` na saída | Timeout no envio. O lançamento existe; confira no app |

Nunca compartilhe valores de variáveis nem as colunas `*_encrypted`. Estas consultas são seguras:

```sql
SELECT status, count(*), max(last_error) FROM whatsapp_inbox GROUP BY status;
SELECT status, delivery_status, count(*) FROM whatsapp_outbox GROUP BY 1, 2;
```

## Teste local

O simulador assina o evento com o mesmo segredo do servidor e só aceita `localhost`. Não existe rota que dispense a assinatura.

```bash
npx tsx scripts/whatsapp-sim.ts "gastei 60 no pix no mercado"
```

Testes automatizados: `tests/unit/whatsapp-parser.test.ts`, `tests/integration/whatsapp.test.ts` e `tests/e2e/whatsapp.spec.ts`.
