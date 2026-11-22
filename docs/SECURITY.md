# Segurança

Este documento descreve os controles do MVP e seus limites conhecidos. Não é uma certificação.

## Modelo de ameaças resumido

| Ameaça | Controle | Onde |
| --- | --- | --- |
| Acesso a dados de outro usuário (IDOR) | Todas as consultas filtram por `userId` do servidor; ids vindos do cliente/LLM passam por `ownedIds`; ações de update/delete usam `WHERE id = ? AND user_id = ?` | `src/lib/data/repo.ts`, `src/app/actions/*`, `src/lib/agents/service.ts` |
| CSRF | Server Actions (verificação de origem nativa do Next.js); Route Handlers mutáveis exigem `Origin` igual ao host; cookie `SameSite=Lax` | `src/lib/auth/session.ts` (`assertSameOrigin`) |
| XSS | React escapa tudo; nenhum `dangerouslySetInnerHTML` com dados (só o script fixo de tema); cabeçalhos `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` | `next.config.ts` |
| Roubo de sessão | Token aleatório de 256 bits só no cookie `HttpOnly`; banco guarda apenas SHA-256; `Secure` quando `APP_URL` é https; expiração de 7 dias | `src/lib/auth/users.ts` |
| Força bruta | scrypt (N=2^17), 2FA opcional e rate limit em login/cadastro/demo | `src/lib/auth/crypto.ts`, `src/lib/rate-limit.ts` |
| Prompt injection via descrições | Descrições são sanitizadas (controle removido, tamanho limitado) e enviadas como dados; prompt de sistema manda ignorar instruções em resultados; o modelo só pode chamar ferramentas de leitura e `createAgentDraft` (rascunho que exige confirmação humana); entradas de ferramentas validadas por Zod | `src/lib/text.ts`, `src/lib/chat/engine.ts`, `src/lib/tools` |
| LLM criando automação perigosa | Agentes são `AgentRule` estrito (sem SQL, código ou cron); sempre nascem como rascunho | `src/lib/agents/rule.ts` |
| Exportação de dados alheios | `/api/export` só seleciona linhas do usuário da sessão | `src/app/api/export/route.ts` |
| MCP com escrita ou vazamento | Tokens `read` têm apenas 8 ferramentas de leitura; tokens `capture` só lançam e não leem dados; token revogável por usuário, guardado como SHA-256; servidor MCP construído por requisição já ligado ao `userId` e ao escopo do token | `src/lib/mcp/*` |
| Segredos no repositório | `.env` ignorado; `.env.example` sem valores reais; tokens MCP mostrados uma única vez | `.gitignore` |
| Tokens de conectores | AES-256-GCM com `APP_ENCRYPTION_KEY` (preparado para Open Finance) | `encryptSecret` |
| Abuso de recursos | Rate limit em chat, importação, exportação e MCP; arquivo de importação limitado a 2 MB e 5.000 linhas | `src/lib/rate-limit.ts`, `src/lib/importer.ts` |

## Autenticação e ações sensíveis

- Verificação em duas etapas (TOTP, RFC 6238) com bloqueio de reutilização do código. Obrigatória para conectar bancos.
- Senha nova encerra todas as sessões e revoga os tokens MCP. Sessões duram 7 dias, sem renovação.
- Excluir a conta, criar token MCP, conectar banco, trocar a senha, confirmar o WhatsApp e excluir histórico pedem a senha de novo e, com a verificação em duas etapas ativa, também o código, com limite de tentativas.
- Ativar ou desativar a verificação em duas etapas encerra as outras sessões.
- Tokens MCP valem 90 dias, com no máximo 5 ativos por usuário.
- scrypt `N=2^17, r=8, p=1`; hashes antigos são atualizados no login seguinte.
- Com `PLUGGY_OWNER_USER_ID` definido, cadastro e demonstração começam fechados, nas telas e nas actions. `ALLOW_SIGNUP` e `ALLOW_DEMO` aceitam `0` (fecha) e `1` (abre).
- Deployments Preview e Development nunca aplicam migrações.

## Conteúdo de terceiros

Qualquer pessoa pode escrever em uma descrição de transação enviando um Pix. Por isso `sanitizeUntrusted` remove caracteres de controle e invisíveis (`\p{Cf}`), e os resultados de ferramentas no chat e no MCP levam um aviso de conteúdo não confiável. No chat, `createAgentDraft` só existe quando a mensagem do próprio usuário pede um agente, o que é decidido no servidor. `/chat?q=` apenas preenche o campo: nada é enviado sem um clique.

**Combinar o MCP com outras ferramentas é arriscado.** Um cliente MCP com acesso a web, e-mail ou arquivos pode ser induzido por um texto de Pix a enviar seus dados para fora. O aviso reduz esse risco, mas não o elimina: use o MCP do Cruzado em clientes com poucas ferramentas e exija confirmação manual.

## Canal de lançamentos

Tokens MCP têm escopo. `read` só consulta; `capture` só registra e desfaz lançamentos e não acessa nenhum dado financeiro. Os dois conjuntos de ferramentas nunca aparecem juntos. Detalhes e limites em [MCP.md](MCP.md).

## Auditoria

`audit_events` registra login (sucesso/falha), cadastro, importação, criação/edição/exclusão de transações e contas, ciclo de vida de agentes, consentimento de IA, tokens MCP, exportação e exclusão de conta. O campo `meta` guarda apenas ids, contagens e flags — nunca valores, descrições, senhas ou tokens. Na exclusão da conta os eventos são anonimizados (`user_id = NULL`).

## Logs e telemetria

Não há telemetria. Erros passam por `errorSummary` (`src/lib/log.ts`): só a primeira linha, sem parâmetros de query e com identificadores, e-mails e tokens mascarados. Só mensagens das nossas próprias regras chegam ao usuário. `NEXT_TELEMETRY_DISABLED=1` na imagem Docker.

## Limites conhecidos (MVP)

- Login, cadastro, demo, chat, importação e sincronização usam rate limit em PostgreSQL (`rateLimitShared`), válido entre instâncias. Exportação, MCP e criação de agente em linguagem natural usam contadores em memória, por instância: freiam abuso, mas não são cota global. O limite por IP do MCP fica em memória de propósito, para filtrar antes de consultar o banco.
- Não há recuperação de senha por e-mail nem verificação de e-mail. Quem perder a senha ou o autenticador perde o acesso.
- A CSP bloqueia origens externas, mas mantém `'unsafe-inline'` em scripts, porque páginas estáticas não recebem nonce. Ela limita a saída de dados de um XSS, não impede a execução dele.
- Não há expiração por inatividade nem tela que liste as sessões ativas; há o botão "Encerrar outras sessões".
- Isolamento entre usuários depende de `WHERE user_id` no código: não há Row Level Security, e o papel do banco em runtime também aplica migrations.
- Criptografia de segredos usa uma única chave, no mesmo ambiente de `DATABASE_URL`, sem rotação automática nem KMS.
- O limite de 20 tentativas por e-mail permite que alguém que saiba seu e-mail atrase seu login por períodos de 10 minutos.
- Antes de ligar IA externa (`AI_PROVIDER=anthropic`): teste prompt injection com o modelo real, defina cota diária de custo e desligue a IA para contas demo. Nada disso foi testado.
- O MCP é stateless e não implementa OAuth; o token Bearer deve trafegar apenas por HTTPS fora de `localhost`.
- Contas de demonstração são apagadas após 48 h por `/api/cron/agents`; sem cron (Docker), chame essa rota com `CRON_SECRET` ou agende a limpeza.

## Como reportar vulnerabilidades

Abra um aviso privado de segurança no repositório (GitHub Security Advisories) em vez de uma issue pública.

## WhatsApp

- O webhook valida `X-Hub-Signature-256` com HMAC-SHA256 sobre os bytes brutos, em tempo constante, antes de interpretar o JSON. Não existe rota que dispense a assinatura.
- Eventos de outro `phone_number_id` são descartados. Confirmações de entrega só atualizam a fila de saída.
- O texto recebido é dado não confiável: o leitor é determinístico e não executa nada com ele.
- Escrever exige código de uso único gerado na sessão, enviado do telefone, e confirmação no app com senha.
- Vínculo e conta são relidos dentro da transação de cada mensagem. Desconectar vale para o que já está na fila.
- Desfazer e corrigir só alcançam lançamentos criados pelo próprio vínculo.

Detalhes em [WHATSAPP.md](WHATSAPP.md).
## Bancos pela Pluggy

- A Pluggy não assina webhooks. A rota exige o segredo registrado no cabeçalho `Authorization`, comparado em tempo constante, e trata o evento só como aviso: o dado vem de nova consulta ao provedor.
- Um item recebido do navegador nunca prova posse. O servidor relê o item e exige o `clientUserId` da tentativa aberta por aquela sessão, consumida uma única vez.
- Conectar exige ser o dono configurado, 2FA e senha, nos dois modos.
- O navegador recebe apenas o Connect Token. A origem do widget só entra na CSP com `PLUGGY_MODE=connect`.

Detalhes em [OPEN_FINANCE.md](OPEN_FINANCE.md).
