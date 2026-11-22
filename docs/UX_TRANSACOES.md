# Transações: decisões de UX

Pesquisa documental em páginas oficiais, em 31/10/2026. Não houve auditoria visual dos produtos autenticados. Usamos padrões de interação; marca, textos e código continuam do Cruzado.

## O problema observado

Com dados sintéticos, antes do redesenho:

| Largura | Controles antes da lista | Primeira linha da lista |
| --- | --- | --- |
| 390 px | 17 | y = 552 |
| 768 px | 18 | y = 496 |
| 1440 px | 18 | y = 496 |

Busca, cinco períodos, tipos, filtros avançados, cadastro manual, importação e aviso de conciliação disputavam o topo. A soma do filtro aparecia solta, e detalhes de origem competiam com a lista. O agrupamento por data, a paginação e a URL como fonte de verdade funcionavam, e foram mantidos.

Medidas depois do redesenho: `docs/redesign/transacoes/depois/medidas.txt`. Capturas: `docs/redesign/transacoes/antes` e `depois`.

## Três áreas

A divisão Movimentações, Revisar e Importações é proposta nossa, não cópia de um produto. Ela separa três intenções: consultar o dinheiro, resolver pendências e trazer dados.

| Referência | Padrão | Como resolveu o problema aqui |
| --- | --- | --- |
| [Actual Budget: filtros](https://actualbudget.org/docs/transactions/filters/) | Filtros combináveis | Busca à vista, demais filtros em painel e filtros ativos como etiquetas removíveis. Visões salvas ficaram para depois. |
| [Monarch: revisão](https://www.monarch.com/blog/transaction-review) | Estado de revisão com critérios | Revisar lista só tarefas reais, com contagem na aba. |
| [Monarch: melhorias](https://www.monarch.com/blog/quicker-and-easier-transaction-review-and-more) | Lista enxuta, ações no detalhe | A linha mostra descrição, valor, categoria e conta. Origem, parcela, texto do banco e observação ficam no detalhe. |
| [YNAB: conciliação](https://support.ynab.com/en_us/reconciling-accounts-a-guide-BJFE3fHys) | Conferência explícita com o banco | Sincronizar, classificar e conciliar são coisas separadas. Importar nunca declara nada como conciliado. |

## Decisões

- **Período único.** Um seletor compacto, com setas de mês, substitui os cinco chips. Períodos rápidos e datas livres ficam dentro dele.
- **Padrão: mês atual.** Busca ou filtro sem datas olham 12 meses, para não esconder um lançamento do mês passado.
- **Resumo.** Entradas, Saídas e Resultado do período somam todo o filtro, não a página. Seguem as regras do painel: sem transferências nem pagamento de fatura, e estorno reduz gasto. Compras pendentes no cartão entram. O texto avisa que não é saldo.
- **Adicionar é uma rota** (`/transacoes/novo`). Tem endereço próprio, não ocupa a lista e não perde o formulário. Links antigos com `?novo=1` são redirecionados.
- **Painéis com `<dialog>` nativo.** Foco contido, Escape e retorno do foco vêm do navegador, sem biblioteca. Clicar fora não fecha.
- **Voltar do detalhe** restaura filtros, período e página pelo parâmetro `volta`, aceito apenas para caminhos de Transações.
- **Revisar não duplica tarefa.** Um lançamento em possível duplicidade não aparece também como sem categoria.
- **Aguardando o banco não é tarefa.** Fica como informação, fora da contagem: não há nada a fazer.
- **Conciliação única.** Revisar reaproveita o mesmo cartão e as mesmas ações de `/transacoes/conciliar`, que segue como histórico do que foi conciliado.
- **Importações.** Reúne arquivo, bancos e histórico. Mostra só o que existe de fato: importadas, ignoradas e total. Não há registro de falhas por arquivo, porque a importação é tudo ou nada.
- **Valores.** Sinal e rótulo, nunca só cor.

## Fora desta entrega

Visões salvas, ações em lote, drawer de detalhe, tabela no desktop e detecção automática de transferências entre contas próprias sem a categoria do provedor.
