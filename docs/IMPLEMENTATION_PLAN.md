# Plano de implementação

Status: ✅ feito e testado · 🟡 feito, sem teste contra serviço real · ⏳ pendente

| # | Etapa | Entregas | Status |
| --- | --- | --- | --- |
| 1 | Inspeção e arquitetura | Pasta vazia; stack definida em `DECISIONS.md`; `ARCHITECTURE.md` | ✅ |
| 2 | Bootstrap, banco, auth, seed | Next.js 16 + TS estrito; schema Drizzle + `drizzle/0001_init.sql` + runner; PGlite/PostgreSQL; cadastro, login, sessões, logout; modo demo com seed reproduzível | ✅ |
| 3 | Contas, transações, categorias, importação, dashboard | CRUD manual; CSV (mapeamento, codificação, prévia) e OFX; deduplicação idempotente; dashboard com saldo ocultável, receitas/despesas, fluxo semanal com tabela, ranking, alertas, próximas cobranças | ✅ |
| 4 | Funções financeiras determinísticas | `src/lib/finance/core.ts` + testes de borda (centavos, estornos, transferências, períodos, fatura, recorrência, duplicidade) | ✅ |
| 5 | Chat com ferramentas e provedores | 11 ferramentas com Zod e evidência; `AIProvider` Mock/Ollama/Anthropic; consentimento para provedor externo; aviso regulatório | ✅ Mock · 🟡 Ollama/Anthropic |
| 6 | Agentes, agendador, notificações, auditoria | 4 avaliadores; rascunho → confirmação; pausar/retomar/editar/excluir/executar agora; fila `jobs`; central de alertas; `audit_events` | ✅ |
| 7 | MCP somente leitura | `/api/mcp` com 8 ferramentas; tokens revogáveis; exemplos para Claude Code e Claude Desktop | ✅ |
| 8 | Segurança, acessibilidade, responsividade, docs | CSRF, IDOR, rate limit, cabeçalhos; WCAG AA nos tokens; teclado/foco; 375/768/1024/1440 px; documentação completa | ✅ |
| 9 | Qualidade | `lint`, `typecheck`, `test` (Vitest), `test:e2e` (Playwright desktop + mobile), `build` | ✅ |
| 10 | Docker | `Dockerfile` multi-stage, `docker-compose.yml` (PostgreSQL + app + worker opcional) | 🟡 não executado (sem Docker no ambiente) |

## Como validar localmente

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```
