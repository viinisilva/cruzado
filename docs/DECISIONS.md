# Decisões e pendências

Registro das escolhas técnicas do MVP. Formato: decisão → motivo → consequência.

## Ambiente

- **Pasta vazia → projeto novo.** Nada existente foi preservado ou substituído.
- **Node.js portátil.** A máquina de desenvolvimento não tinha Node nem Docker. Foi usado o Node 22 LTS oficial (zip com SHA-256 verificado) em `.tools/` (ignorado pelo git). Consequência: Docker Compose e Dockerfile foram escritos, mas **não executados** neste ambiente.

## Stack

| Decisão | Motivo | Consequência |
| --- | --- | --- |
| Next.js 16 (App Router), React 19, TypeScript estrito (`noUncheckedIndexedAccess`) | Versão estável atual | RSC para páginas; Client Components só para interação (chat, importação, formulários, tema) |
| Tailwind CSS 4 + componentes próprios (`src/components/ui.tsx`) | Menos dependências que shadcn/ui; controle de acessibilidade (44 px, foco, labels) | Sem biblioteca de componentes externa |
| PostgreSQL (Docker) **ou PGlite** embutido | PGlite (Apache-2.0/PostgreSQL) roda o mesmo SQL do PostgreSQL sem Docker: demo local em um comando e testes de integração reais em memória | PGlite aceita um processo por diretório; para worker separado ou várias réplicas use PostgreSQL |
| Drizzle ORM **sem drizzle-kit**; migrations SQL escritas à mão em `drizzle/` + runner próprio (`src/db/migrate.ts`) | O `drizzle-kit` não instalou neste Windows (binário do esbuild aninhado ultrapassou o limite de 260 caracteres de caminho) | `schema.ts` e `drizzle/*.sql` precisam ser mantidos em sincronia manualmente; o runner aplica cada arquivo uma vez em transação, controlado pela tabela `_migrations` |
| Autenticação própria seguindo o guia do Lucia (sessões em banco, token aleatório, SHA-256 no banco, cookie HTTP-only) + `scrypt` do Node | O Lucia foi descontinuado como biblioteca e virou guia; Better Auth exigiria tabelas e fluxos próprios além do necessário para o MVP. `node:crypto` evita binários nativos | Sem OAuth, 2FA ou recuperação de senha por e-mail no MVP (ver ROADMAP) |
| Zod 4 para entradas, ferramentas e `AgentRule` | Validação única que também gera JSON Schema (`z.toJSONSchema`) para os provedores de IA | — |
| Fila em PostgreSQL própria (tabela `jobs`, `FOR UPDATE SKIP LOCKED`, chave de deduplicação) | pg-boss exige servidor PostgreSQL real e não roda sobre PGlite | Agendador simples: in-process (`ENABLE_INPROCESS_SCHEDULER=1`) ou `npm run worker` |
| MCP com `@modelcontextprotocol/sdk` e `WebStandardStreamableHTTPServerTransport` sem estado | Funciona direto em Route Handler do Next.js | Sem sessões MCP nem SSE de longa duração; cada requisição cria um servidor ligado ao usuário do token |
| Gráficos SVG próprios | Evita biblioteca de gráficos; garante tabela alternativa, legenda e padrão hachurado (não depende só de cor) | Gráficos simples por design |
| Ícones `lucide-react` (ISC), fonte IBM Plex Sans via `@fontsource` (OFL) | Licenças permissivas; fonte empacotada não depende de rede no build | — |
| PapaParse (MIT) para CSV; parser OFX próprio | Não há parser OFX mantido com licença permissiva e tipos; o formato usado (STMTTRN) é pequeno | Suporta OFX 1.x (SGML) e 2.x (XML), conta corrente e cartão |
| Vitest + Playwright | Pedido explícito | Playwright usa o Chromium instalado no perfil do usuário (`%LOCALAPPDATA%\ms-playwright`) |

## Produto e domínio

- **Nome e identidade originais: "Cruzado"** (moeda brasileira de 1986 a 1989). Até 21/11/2026 o app se chamava "Tostão"; o nome mudou porque já existem dois apps de finanças com ele. Logotipo SVG próprio (moeda com um "C"). Nenhum elemento do Pierre foi reutilizado.
- **O que manteve o nome antigo, de propósito:** cookies (`tostao_session`, `tostao-hide-values`), chave do tema no navegador (`tostao-theme`), prefixo do `clientUserId` na Pluggy (`tostao-`), prefixo dos tokens MCP, nomes do banco no `docker-compose.yml`, pasta do projeto, tabelas e variáveis de ambiente. Mudar esses nomes desconectaria quem já está logado, invalidaria tokens ou quebraria vínculos já criados. Os códigos do WhatsApp passam a começar com `CRUZADO-`, e `TOSTAO-` continua aceito.
- **Valores:** inteiros em centavos (`bigint` no banco, `number` seguro no JS, com `assertCents`). Percentuais em pontos-base inteiros. Divisão por 100 só na formatação.
- **Datas:** `YYYY-MM-DD` no calendário de America/Sao_Paulo; aritmética em UTC sobre essas strings.
- **Sinal:** despesa negativa, receita positiva. Categorias do tipo `transfer` (transferências e pagamento de fatura) ficam fora de receitas e despesas para não contar o gasto duas vezes (compra no cartão + pagamento da fatura).
- **Saldo de conta:** saldo inicial informado + soma das transações. Saldo consolidado exclui cartões; dívida de cartão aparece separada.
- **Período padrão:** quando a pergunta não traz período, as ferramentas usam o mês atual até hoje e **dizem isso** na resposta (`period.defaulted`).
- **Comparação mensal:** mês corrente até hoje contra o mesmo número de dias do mês anterior (evita comparar meio mês com mês inteiro).
- **Duplicidade:** mesma conta, mesmo estabelecimento normalizado, valores a até 1% e até 3 dias; parcelas diferentes da mesma compra nunca são pareadas. Texto sempre "suspeita", nunca "fraude".
- **Recorrência:** mesmo estabelecimento em ≥2 meses consecutivos, valor ±10%, dia ±5, última ocorrência nos últimos 45 dias. Parcelas: maior número/total visto.
- **Agendas de agentes:** presets fechados (`continuous`, `daily`, `weekly_monday` às 8h, `monthly_first` às 8h) em vez de cron. Período de idempotência derivado da agenda.
- **Criação por linguagem natural:** passa pela ferramenta `createAgentDraft`, que valida com Zod, descarta ids que o usuário não possui e grava como `draft`. Só `confirmAgent` (ação humana) ativa.
- **Modo demo:** cada clique em "modo demonstração" cria um usuário isolado com seed reproduzível relativo à data de hoje (para "neste mês" sempre ter dados). A seed também gera gastos do dia para disparar o agente de limite diário.
- **Provedor padrão `mock`:** responde perguntas comuns com um parser de intenções em pt-BR; não substitui um LLM para frases livres.
- **Anthropic:** modelo definido por `ANTHROPIC_MODEL` (padrão atual no código: `claude-opus-5-5`, trocável sem release). Usa `tool_choice: auto`, `output_config.effort` configurável e fallback no servidor em caso de recusa (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Blocos de conteúdo do assistente são reenviados sem alteração dentro do loop de ferramentas.
- **Cookie Secure:** ligado quando `APP_URL` começa com `https://` (ou `COOKIE_SECURE=1`), para funcionar em `http://localhost` sem configuração.

## Redesign de 30/10/2026

- **`/contas` é rota própria, sem sexta aba.** Leitura com link direto; a edição continua em Configurações, reaproveitando os formulários.
- **Período do início em `?periodo=`.** Saldo disponível, cartões em aberto e próximas cobranças não seguem o filtro e dizem isso na tela.
- **A lista de transações é dirigida pela URL (`src/lib/tx-query.ts`).** `fluxo=1` aplica as mesmas regras dos totais do início (sem transferências, estornos reduzem despesas), para que o número clicado bata com a soma da lista.
- **"Carregar mais" por `limite`.** O filtro continua no servidor sobre o período e os totais usam todas as linhas; só a renderização é limitada.
- **Ocultar valores é global e só muda a exibição.** Valores em texto livre são mascarados, e barras e formulários de edição saem da tela, porque revelariam os valores pelo tamanho ou pelo conteúdo. Por usar `localStorage`, os valores podem aparecer por um instante antes da hidratação.
- **Conexão real é só Open Finance.** A demonstração tem um registro interno de conexão, que nunca deve aparecer como banco conectado.

## Pendências conhecidas

- Docker Compose e imagem não foram executados aqui (sem Docker na máquina).
- `AnthropicProvider` e `OllamaProvider` não foram exercitados contra serviços reais (sem chave/servidor); são cobertos apenas por tipos. O caminho testado ponta a ponta é o `MockProvider`.
- Rate limit de chat, importação, exportação e MCP em memória (por instância); login, cadastro e demo usam PostgreSQL.
- Vercel: cron diário no plano gratuito, então agentes contínuos só rodam às 8h de Brasília ou após importar.
- Transferências entre contas próprias só são reconhecidas com termos explícitos ("entre contas", "mesma titularidade"); as demais podem aparecer como receita e despesa até o usuário recategorizar.
- Sem recuperação de senha, verificação de e-mail ou 2FA.
- Sem CSP estrita.
- Limpeza automática de usuários demo antigos não implementada.
- Edição de valor/data/conta de transação importada não é permitida (só descrição, categoria e observação), para manter a deduplicação consistente.

## WhatsApp pela API oficial

- **Fila no PostgreSQL**, em vez de serviço externo: a entrada, o estado da mensagem e a resposta entram na mesma transação, o que garante um lançamento por evento sem nova dependência.
- **Hobby da Vercel só tem cron diário.** `after()` acelera o caso comum; retentativas em segundos exigem agendador externo chamando `/api/cron/whatsapp`.
- **Leitor determinístico, sem IA nesta versão.** Cobre os casos do produto, não tem custo por mensagem e não envia dados a outro provedor.
- **Timeout no envio é estado incerto.** A resposta pode ser perdida; repetir poderia duplicar a mensagem.
- **Conciliação só sugere.** Sem ID comum, duas compras iguais são indistinguíveis de uma compra informada e importada; quem decide é a pessoa.
- **Depois de conciliar, a linha do banco é o registro.** O lançamento informado sai dos totais e pode voltar ao desfazer.
## Pluggy: modo pessoal e Connect

- **Modo pessoal continua o padrão.** O Connect existe no código, mas fica atrás de `PLUGGY_MODE` e não abre o produto a outros usuários: isso depende de contrato.
- **Webhook com cabeçalho próprio**, porque a Pluggy não assina entregas. Por isso o webhook é registrado pela API e não vai no Connect Token.
- **Sincronização por página, com cursor salvo**, e não uma leitura seguida de uma transação única: funções da Vercel têm tempo limitado e históricos podem ser longos.
- **Só uma leitura limpa pode remover lançamentos**, porque consentimento expirado responde com listas vazias, não com erro.
- **Uma dependência nova:** `pluggy-connect-sdk` (MIT), carregada só ao abrir o widget, porque a autorização precisa acontecer no ambiente oficial.

## Transações em três áreas

Decisões e referências em [UX_TRANSACOES.md](UX_TRANSACOES.md).

## Cartões

Faturas, parcelas e limites em `/cartoes`, sem migração: não há tabela de fatura, então o Cruzado nunca declara uma fatura paga. Regras e propostas em [UX_CARTOES.md](UX_CARTOES.md).

## Contas: entrada pelo banco, remoção com confirmação

- **Quem tem a integração não cria conta à mão.** `canAddAccountsManually` fecha o formulário de Configurações e o `/comecar`, na tela e nas Server Actions. Sem Pluggy e na demonstração o cadastro continua, porque seria o único jeito de ter uma conta. Editar contas existentes e lançar transações à mão seguem iguais.
- **Remover apaga a conta e seus lançamentos**, sem desfazer: pede a palavra EXCLUIR, a senha e o código de duas etapas, se ativo. Fica registrado na auditoria, só com id e quantidade.
- **Banco conectado precisa ser desconectado antes**, porque a sincronização recriaria a conta. Depois de desconectado, a remoção por conta funciona como em uma conta manual.
- **Conciliação:** lançamentos de outras contas ligados às linhas removidas voltam a contar (`releaseSuperseded`).
