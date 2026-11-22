# Cartões: decisões de UX

Referência de organização: capturas do Pierre enviadas pelo dono do projeto em 01/11/2026. Usamos a arquitetura da informação (Faturas, Parcelas e Limites, filtro por cartão, blocos no início). Marca, textos, cores e código são do Cruzado. Capturas: `docs/redesign/cartoes/antes` e `depois`.

## O que mudou

- **Rota `/cartoes?cartao=&aba=`.** O estado fica na URL, então voltar, avançar e links internos restauram a tela. Sem sexta aba no celular: a entrada é pelo Início, por `/contas` e, no computador, pelo menu lateral.
- **Filtro de cartão acima das abas**, porque vale para as três. Até 4 cartões são chips que quebram linha; acima disso, um `select` nativo, que traz busca por digitação e o seletor do telefone. Um id que não é do usuário vale como "Todos os cartões".
- **Início nesta ordem:** saldo e cartões em aberto, pontos de atenção, atalhos, blocos de cartão, contas, recentes e gráficos. A pergunta ao assistente fica como atalho no topo e como formulário no fim.
- **`src/lib/finance/cards.ts`** concentra os cálculos, em funções puras e testadas. O total de cada fatura segue `creditCardSummary`, e a lista aberta por "Ver lançamentos" usa `fluxo=1`: o Resultado da lista é o total da fatura com o sinal invertido.

## O que os dados permitem afirmar

| Informação | Regra | O que a tela diz |
| --- | --- | --- |
| Ciclo e vencimento | Dias cadastrados em `credit_cards`. A sincronização usa 1 e 10 quando o banco não informa, e o cadastro inicial estima o fechamento | "Estimativa" no rodapé de Faturas |
| Valor | Soma do lançado no ciclo, sem pagamentos de fatura e transferências, descontando estornos | "Total lançado", nunca "valor da fatura" |
| Aberta ou fechada | Só a data: hoje depois do fechamento | Selo "Aberta" ou "Fechada" |
| Paga | Não existe vínculo entre pagamento e fatura | Nunca "Paga". Mostra pagamentos lançados entre o fechamento e o próximo fechamento, ou "Nenhum pagamento lançado neste cartão" |
| Parcelas | `installment_number` e `installment_total`; compras separadas pelo mês de início, e meses vizinhos se juntam quando nenhum número de parcela repete. "Próximas cobranças" e o chat usam a mesma regra | "Já lançado", não "Pago". O restante repete a última parcela |
| Limite | `credit_cards.limit_cents`; uso é o saldo do cartão | "Sobra estimada", não "Disponível", e parcelas futuras ao lado, sem descontar: um saldo vindo do banco pode já incluí-las |

Limite zero significa "não informado" e nenhuma conta é feita com ele.

## Fora desta entrega: depende de migração

Nada foi aplicado. Cada item precisa de decisão própria.

| Proposta | Mudança | Risco | Como desfazer |
| --- | --- | --- | --- |
| Final do cartão | Coluna `card_last4` em `accounts`, preenchida pela Pluggy | Guardar mais um dado bancário; revisar privacidade e a exportação | Remover a coluna |
| Disponível do banco | Coluna para `availableCreditLimit`, que o conector ainda não lê | Mostrar um número antigo se a sincronização falhar; exige data da atualização | Remover a coluna e voltar à sobra estimada |
| Fatura real | Tabela de faturas alimentada pela Pluggy, para ter valor, status e pagamento confirmados | Ainda não testado contra o serviço real; muda a fonte de verdade da tela | Voltar ao cálculo por ciclo, que continua existindo |
| Origem dos dias do cartão | Marcar se fechamento e vencimento vieram do banco, do usuário ou de estimativa | Baixo | Remover a coluna |

## Limites conhecidos

- A posição das parcelas depende da data informada pelo banco. Não foi testado com dados reais da Pluggy.
- Na demonstração, os pagamentos cobrem o mês civil e o ciclo vai do dia 2 ao dia 1, então pagamento e total diferem um pouco. A seed não foi alterada.
- Duas compras iguais, na mesma loja, com o mesmo valor e iniciadas no mesmo mês, não têm como ser separadas e aparecem como uma.
- A tabela `recurring_transactions` guarda uma linha por estabelecimento. Com duas compras na mesma loja, a exportação mostra só uma; telas e chat mostram as duas.
