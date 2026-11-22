# Roadmap

Itens fora do MVP, em ordem sugerida. Nada aqui inclui movimentação de dinheiro, Pix, pagamentos, compra de investimentos, recomendação individual de investimento ou análise de crédito.

## Curto prazo

- **Em andamento:** isolamento por usuário para receber convidados, com revisão de cada consulta, testes automatizados que provam que um usuário nunca vê os dados de outro e Row Level Security no banco.
- Rodar e endurecer o Docker Compose (healthcheck da app, usuário não-root já configurado, backup do volume do PostgreSQL).
- Testes de contrato do `AnthropicProvider` e do `OllamaProvider` com respostas gravadas.
- Rate limit persistente em PostgreSQL para várias réplicas.
- Limpeza agendada de usuários de demonstração antigos.
- Recuperação de senha por e-mail, verificação de e-mail e sessões ativas (encerrar em outros dispositivos).
- Content-Security-Policy com nonce.

## Médio prazo

- `OpenFinanceConnector` real por um agregador autorizado (ver `OPEN_FINANCE.md`), começando por um provedor e modo somente leitura.
- Regras de categorização editáveis pelo usuário (palavras-chave → categoria) e recategorização em lote.
- Metas e orçamentos por categoria como novos tipos de `AgentRule` (sempre presets validados).
- Lembretes de vencimento de fatura a partir de `credit_cards.due_day`.
- Notificações fora do app (e-mail, push web) com opt-in.
- Importação de faturas de cartão em PDF via parser dedicado (sem LLM nos números).
- Multi-moeda (hoje tudo é BRL).

## Longo prazo

- Contas compartilhadas (casal/família) com permissões por conta.
- OAuth 2.1 no MCP para clientes que suportam o fluxo.
- Aplicativo instalável (PWA) com modo offline de leitura.
