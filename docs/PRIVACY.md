# Privacidade

> **Rascunho para revisão jurídica.** Este documento descreve o comportamento técnico do software. Ele não é uma política jurídica pronta, não foi revisado por advogado e não declara conformidade com a LGPD ou qualquer outra norma. Quem hospeda a instância é o controlador dos dados e deve adaptar o texto público em `/privacidade`.

## Dados tratados

| Dado | Finalidade | Retenção |
| --- | --- | --- |
| Nome, e-mail, hash da senha (scrypt) | Autenticação | Até a exclusão da conta |
| Segredo de verificação em duas etapas (cifrado) | Autenticação | Até desativar ou excluir a conta |
| Sessões (SHA-256 do token, expiração) | Manter login | 7 dias ou logout |
| Conexão bancária: Item ID do Pluggy (cifrado), nome do banco, validade da autorização | Sincronizar dados por Open Finance | Apagada ao desconectar |
| Contas e transações vindas do banco, incluindo descrições com nomes de terceiros (como remetentes de Pix) | Funcionalidade principal | Mantidas ao desconectar; apagadas ao excluir a conta ou os lançamentos |
| Contas, cartões, categorias, transações | Funcionalidade principal | Até a exclusão pelo usuário |
| Metadados de importação (nome do arquivo, contagens, SHA-256) | Rastreabilidade e deduplicação | Até a exclusão da conta |
| Arquivo de extrato bruto | **Não armazenado**: lido em memória e descartado | — |
| Agentes, execuções, alertas | Agentes proativos | Até a exclusão |
| Conversas do chat (texto + evidência) | Histórico do usuário | Até a exclusão da conta |
| Eventos de auditoria (sem conteúdo financeiro) | Segurança | Anonimizados na exclusão da conta |
| Consentimento de IA externa (data) | Base para envio ao provedor | Até revogação |
| Tokens MCP (SHA-256, prefixo) | Acesso de clientes MCP | Até revogação/exclusão |

Credenciais bancárias nunca são pedidas nem armazenadas. A autorização acontece no Meu Pluggy e no banco; o Pluggy é um terceiro que trata esses dados sob os próprios termos. Números de conta não são guardados: fica apenas um hash, usado para reconhecer a conta depois de reconectar.

## Inteligência artificial

| Modo | O que sai do servidor | Qualidade |
| --- | --- | --- |
| `mock` (padrão) | Nada | Respostas determinísticas para perguntas comuns; entende um conjunto limitado de frases |
| `ollama` local | Nada (o modelo roda na sua máquina/rede) | Depende do modelo; modelos pequenos podem escolher ferramentas erradas ou pedir esclarecimentos com mais frequência |
| `anthropic` | Pergunta, histórico curto (só texto), nomes de contas e categorias, resultado das ferramentas chamadas (incluindo descrições de transações relevantes) | Melhor compreensão de linguagem natural; sujeito aos termos e à política de retenção do provedor |

Com provedor externo, o chat fica bloqueado até o usuário clicar em "Autorizar envio" em Configurações; a autorização pode ser revogada. Nunca são enviados senhas, tokens, chaves ou identificadores de sessão. Os cálculos continuam no servidor: o provedor não recebe a base inteira, só o que cada ferramenta retornou.

## Direitos do titular (implementação técnica)

- **Acesso/portabilidade:** `Configurações › Exportar meus dados` gera JSON com todos os registros do usuário.
- **Eliminação:** `Configurações › Excluir minha conta` apaga o usuário e, por `ON DELETE CASCADE`, contas, cartões, categorias, transações, importações, recorrências, agentes, execuções, alertas, conversas, mensagens, conexões e tokens. Eventos de auditoria permanecem com `user_id` nulo.
- **Revogação:** consentimento de IA e tokens MCP podem ser revogados a qualquer momento. Desconectar um banco interrompe as atualizações e remove a conexão no provedor; excluir a conta faz o mesmo antes de apagar os dados. A documentação da Pluggy consultada não garante que isso encerre o consentimento na instituição: faça isso também no Meu Pluggy e no app do banco.

## Dados de demonstração

Todos os nomes, instituições, estabelecimentos e valores do seed são fictícios. Não há CPFs no modelo de dados.

## WhatsApp

Opcional e desligado por padrão. As mensagens passam pelos servidores da Meta. No Cruzado, texto e número ficam cifrados e o texto é apagado quando a mensagem é resolvida. Na fila de saída, o número cifrado e os IDs de evento ficam por 30 dias para impedir duplicidade por reentrega, e depois são removidos. Desconectar apaga o número do vínculo. A tela mostra só o número mascarado.
## Bancos

Conexão opcional, somente leitura e por consentimento. Identificadores do provedor ficam cifrados ou como hash. Desconectar interrompe atualizações e mantém o histórico; excluir o histórico é uma ação separada, com confirmação. Eventos de webhook são apagados depois de 30 dias. Esta integração não envia transações a modelos externos. A revogação do consentimento na instituição deve ser conferida também no app do banco.
