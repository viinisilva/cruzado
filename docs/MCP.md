# Servidor MCP (somente leitura)

O Cruzado expõe um endpoint [Model Context Protocol](https://modelcontextprotocol.io) em `POST /api/mcp` (Streamable HTTP, sem estado, respostas JSON), implementado com o SDK oficial em TypeScript.

## Ferramentas

| Ferramenta | O que faz |
| --- | --- |
| `get_accounts` | Contas e cartões com saldo atual |
| `get_balance` | Saldo consolidado e total em aberto nos cartões |
| `get_transactions` | Transações por período (`period.preset` ou `period.from/to`), conta, categoria, texto |
| `get_spending_by_category` | Gastos por categoria em um período |
| `compare_periods` | Comparação de gastos entre dois períodos |
| `get_recurring_transactions` | Assinaturas, parcelas e receitas recorrentes |
| `get_possible_duplicates` | Possíveis cobranças duplicadas (suspeitas, não fraude) |
| `list_notifications` | Alertas dos agentes |

Todas têm `readOnlyHint: true`. Não existem ferramentas de escrita, administração, pagamento, criação de agentes ou execução de SQL. Cada resposta traz `facts` (texto calculado), `data` e `evidence` (período, filtros e links).

## Token

1. Entre no Cruzado › **Configurações › Acesso MCP** › **Gerar token**.
2. Copie o token (`tst_mcp_…`). Ele aparece **uma única vez**; o banco guarda só o SHA-256.
3. Guarde-o em uma variável de ambiente, nunca em arquivo versionado:

```bash
export CRUZADO_MCP_TOKEN="cole-o-token-aqui"
```

O token é escopado ao seu usuário, vale 90 dias, exige sua senha para ser criado e pode ser revogado na mesma tela. Cada conta tem no máximo 5 tokens ativos. Fora de `localhost`, use sempre HTTPS.

**Cuidado com dados bancários reais.** Descrições de transações podem conter texto escrito por terceiros, e um Pix de centavos basta para isso. Se o cliente MCP também tiver web, e-mail, arquivos ou shell, esse texto pode tentar induzi-lo a enviar seus dados para fora. As respostas levam um aviso, mas só o próprio cliente pode impedir o ataque: use um cliente com poucas ferramentas ou exija confirmação manual de cada ação.

## Claude Code

Adicione o servidor HTTP lendo o token do ambiente:

```bash
claude mcp add --transport http cruzado http://localhost:3000/api/mcp --header "Authorization: Bearer ${CRUZADO_MCP_TOKEN}"
```

Ou, para compartilhar a configuração no projeto sem expor o token, use um `.mcp.json` com expansão de variável (o valor é lido do seu ambiente em tempo de execução):

```json
{
  "mcpServers": {
    "cruzado": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": { "Authorization": "Bearer ${CRUZADO_MCP_TOKEN}" }
    }
  }
}
```

Exemplo pronto: `examples/mcp/claude-code.mcp.json`.

## Claude Desktop

O arquivo `claude_desktop_config.json` aceita servidores locais por linha de comando. Uma forma comum de ligar um servidor HTTP remoto é a ponte [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) (projeto de terceiros, MIT), que roda via `npx` e repassa o cabeçalho:

```json
{
  "mcpServers": {
    "cruzado": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/api/mcp", "--header", "Authorization:Bearer ${CRUZADO_MCP_TOKEN}"],
      "env": { "CRUZADO_MCP_TOKEN": "defina-no-seu-ambiente-ou-substitua-localmente" }
    }
  }
}
```

Exemplo: `examples/mcp/claude-desktop.json`. O arquivo de configuração do Claude Desktop fica fora do repositório (no seu perfil de usuário); não faça commit dele com o token preenchido. Versões recentes do Claude Desktop também permitem adicionar conectores remotos pela interface; nesse caso use a URL do endpoint e o cabeçalho `Authorization`.

## Hermes Agent

O Hermes guarda o token no próprio `.env` (caminho em `hermes config env-path`) e o referencia no `config.yaml` (caminho em `hermes config path`). Salve o token:

```bash
hermes config set MCP_CRUZADO_API_KEY "cole-o-token-aqui"
```

Depois adicione ao `config.yaml`:

```yaml
mcp_servers:
  cruzado:
    url: http://localhost:3000/api/mcp
    headers:
      Authorization: Bearer ${MCP_CRUZADO_API_KEY}
    enabled: true
```

E confira a conexão:

```bash
hermes mcp test cruzado
```

O teste deve listar as 8 ferramentas. O app precisa estar rodando, e os dados consultados vão para o provedor de modelo configurado no Hermes.

## Lançar pelo WhatsApp (token "Lançar")

Ao gerar um token, a opção **Lançar** cria um acesso separado para registrar lançamentos. Ele só enxerga estas 4 ferramentas: `list_accounts`, `list_categories`, `record_transaction` e `undo_last_transaction`.

Esse token não vê saldos, transações nem alertas. É de propósito: um agente que escreve e também lê textos de terceiros seria alvo fácil de prompt injection. Com a separação, um texto malicioso não tem o que ler nem vazar; o pior caso é um lançamento errado, que pode ser desfeito em 24 horas.

Limites no servidor: 30 operações por hora, até R$ 100.000,00 por lançamento, data de até 90 dias atrás e nunca futura, e repetições iguais em 2 minutos contam como uma só. A confirmação do usuário é feita pelo agente (instruções em `examples/hermes/SOUL-cruzado-whatsapp.md`), e não pode ser garantida pelo servidor. Quem protege o canal é a lista de remetentes permitidos.

Esses lançamentos aparecem como "Assistente (WhatsApp)" e só existem no Cruzado: nada é enviado ao banco.

Para usar com o Hermes:
- Use um perfil exclusivo, sem web, terminal, navegador nem arquivos, e nunca o token "Consultar" nele.
- As ferramentas do Hermes são configuradas por plataforma: desativar no terminal não desativa no WhatsApp. Confira com `hermes -p NOME tools list --platform whatsapp`.
- A ponte de WhatsApp do Hermes não é oficial: use um número dedicado, defina `WHATSAPP_ALLOWED_USERS` só com o seu número e `whatsapp.unauthorized_dm_behavior: ignore`. Nunca use `*`.
- O agente roda no seu computador: desligado, ele não responde.
- As mensagens passam pelo provedor de modelo configurado no Hermes.

## Testar manualmente

```bash
curl -s http://localhost:3000/api/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -H "Authorization: Bearer $CRUZADO_MCP_TOKEN" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Sem token, com token inválido ou revogado, a resposta é `401`.

## Garantias testadas

`tests/integration/app.test.ts` verifica que: a lista contém apenas as 8 ferramentas de leitura; os dados retornados são só do dono do token; filtrar por conta de outro usuário não retorna nada; chamar uma ferramenta de escrita interna falha; tokens revogados ou falsos são recusados; um usuário não consegue revogar o token de outro.
