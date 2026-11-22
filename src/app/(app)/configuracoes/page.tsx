import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { and, eq, ne } from "drizzle-orm";
import {
  ArrowRight,
  Bot,
  Check,
  CreditCard,
  Database,
  KeyRound,
  Landmark,
  LaptopMinimal,
  MessageCircle,
  Palette,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Tags,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { initials } from "@/lib/banks";
import { loadAccounts, loadCategories, loadTransactions } from "@/lib/data/repo";
import { accountBalances } from "@/lib/finance/core";
import { formatBRL } from "@/lib/money";
import { todayInSaoPaulo } from "@/lib/dates";
import { configuredProviderName, providerIsExternal } from "@/lib/ai/provider";
import { listMcpTokens } from "@/lib/mcp/tokens";
import { Badge, Button, ButtonLink, Card, Notice, SectionHeading, cx } from "@/components/ui";
import { ConfirmSubmit, PrivateBlock, Sensitive, ThemeToggle } from "@/components/client";
import { bankLinkedAccountIds } from "@/lib/accounts";
import { canAddAccountsManually, canConnectBanks, isBankOwner, pluggyMode } from "@/lib/connectors/pluggy";
import { CONNECTION_STATUS, formatDateTimeBR } from "@/lib/connectors/status";
import { revokeMcpTokenAction, setAiConsentAction } from "../../actions/settings";
import { plural } from "@/lib/text";
import { currentLink, linkHealth } from "@/lib/whatsapp/link";
import { whatsappConfig } from "@/lib/whatsapp/config";
import { endSessionsAction } from "../../actions/security";
import { disconnectLinkAction } from "../../actions/whatsapp";
import { ConfirmLinkForm, LinkCodeForm, LinkSettingsForm } from "./whatsapp-forms";
import { AccountForm, CategoryForm, DeleteAccountForm, McpTokenForm, RemoveAccountForm } from "./forms";
import { BankActions, ConnectBankForm, ConnectWidgetForm, DeleteHistoryForm } from "./bank-forms";
import { isOwnerId } from "@/lib/auth/access";
import { ChangePasswordForm, DisableTotpForm, EnableTotpForm } from "./security-forms";

export const metadata: Metadata = { title: "Configurações" };
// Linking a bank reads the whole history in the same request.
export const maxDuration = 60;

const TABS = [
  { id: "contas", label: "Contas e cartões", icon: Wallet },
  { id: "categorias", label: "Categorias", icon: Tags },
  { id: "seguranca", label: "Segurança", icon: ShieldCheck },
  { id: "preferencias", label: "Preferências", icon: SlidersHorizontal },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "integracoes", label: "Integrações", icon: Plug },
  { id: "dados", label: "Seus dados", icon: Database },
] as const;
type TabId = (typeof TABS)[number]["id"];

const TYPE = { checking: "Conta corrente", savings: "Poupança", credit_card: "Cartão de crédito", cash: "Dinheiro" } as const;
const TYPE_ICON: Record<keyof typeof TYPE, LucideIcon> = { checking: Landmark, savings: Landmark, credit_card: CreditCard, cash: Wallet };
const KIND = { expense: "Despesa", income: "Receita", transfer: "Transferência" } as const;
const KIND_ORDER = ["expense", "income", "transfer"] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = await getDb();
  const [accounts, categories, txs, tokens, cards, connections, rules, link, bankLinked] = await Promise.all([
    loadAccounts(db, user.id),
    loadCategories(db, user.id),
    loadTransactions(db, user.id),
    listMcpTokens(db, user.id),
    db.select().from(s.creditCards).where(eq(s.creditCards.userId, user.id)),
    db
      .select({
        id: s.financialConnections.id,
        label: s.financialConnections.label,
        status: s.financialConnections.status,
        statusDetail: s.financialConnections.statusDetail,
        lastSyncAt: s.financialConnections.lastSyncAt,
        consentExpiresAt: s.financialConnections.consentExpiresAt,
        accessMode: s.financialConnections.accessMode,
      })
      .from(s.financialConnections)
      .where(and(eq(s.financialConnections.userId, user.id), eq(s.financialConnections.connector, "open_finance"))),
    db.select({ id: s.agentRules.id }).from(s.agentRules).where(and(eq(s.agentRules.userId, user.id), eq(s.agentRules.status, "active"))),
    currentLink(db, user.id),
    bankLinkedAccountIds(db, user.id),
  ]);
  const manual = canAddAccountsManually(user);
  const health =link?.status === "active" ? await linkHealth(db, link) : null;
  const balances = accountBalances(accounts, txs, todayInSaoPaulo());
  const provider = configuredProviderName();
  const external = providerIsExternal();
  const h = await headers();
  const baseUrl = process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;

  // MCP and WhatsApp are the administrator's only for now (docs/USO_COMPARTILHADO.md, decisão 6).
  const owner = !user.isDemo && isOwnerId(user.id);
  const tabs = TABS.filter((t) => (t.id !== "seguranca" || !user.isDemo) && (t.id !== "whatsapp" || owner));
  const active: TabId = tabs.find((t) => t.id === sp.aba)?.id ?? "contas";

  const checklist = [
    { label: "Cadastrar um banco", done: accounts.length > 0, href: "/comecar" },
    { label: "Importar um extrato", done: txs.length > 0, href: "/transacoes/importar" },
    { label: "Ativar um agente", done: rules.length > 0, href: "/agentes" },
    ...(user.isDemo ? [] : [{ label: "Proteger a conta com 2 etapas", done: Boolean(user.totpEnabledAt), href: "/configuracoes?aba=seguranca" }]),
  ];
  const doneCount = checklist.filter((c) => c.done).length;
  const pending = checklist.filter((c) => !c.done);

  return (
    <>
      <div className="mb-8 overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex flex-wrap items-center gap-4 p-5 sm:p-6">
          <span aria-hidden className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-lg font-bold text-primary">
            {initials(user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-[2rem]">{user.name}</h1>
            <p className="truncate text-[0.9375rem] text-muted">{user.isDemo ? "Conta de demonstração" : user.email}</p>
          </div>
          {user.isDemo ? null : user.totpEnabledAt ? <Badge tone="positive"><ShieldCheck aria-hidden size={14} /> Conta protegida</Badge> : <Badge tone="attention"><TriangleAlert aria-hidden size={14} /> Sem 2 etapas</Badge>}
        </div>
        {pending.length ? (
          <div className="border-t border-border bg-surface-2 p-4 sm:px-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Sua conta está {Math.round((doneCount / checklist.length) * 100)}% pronta</p>
              <div className="h-2 w-28 overflow-hidden rounded-full bg-surface-3 sm:w-40" aria-hidden>
                <div className="h-full rounded-full bg-primary" style={{ width: `${(doneCount / checklist.length) * 100}%` }} />
              </div>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {checklist.map((c) => (
                <li key={c.label}>
                  <Link href={c.href} className={cx("flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm hover:bg-surface-2", c.done && "text-muted")}>
                    <span className={cx("flex size-6 shrink-0 items-center justify-center rounded-full border", c.done ? "border-positive bg-positive-soft text-positive" : "border-border")}>
                      {c.done ? <Check aria-hidden size={14} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">{c.label}{c.done ? <span className="sr-only"> (concluído)</span> : null}</span>
                    {c.done ? null : <ArrowRight aria-hidden size={16} className="shrink-0 text-muted" />}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:items-start lg:gap-8">
        <nav aria-label="Seções das configurações" className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:sticky lg:top-20 lg:mx-0 lg:mb-0 lg:overflow-visible lg:px-0">
          <ul className="flex gap-2 lg:flex-col lg:gap-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <li key={id} className="shrink-0">
                <Link
                  href={`/configuracoes?aba=${id}`}
                  scroll={false}
                  aria-current={active === id ? "page" : undefined}
                  className={cx(
                    "flex min-h-11 items-center gap-2.5 whitespace-nowrap rounded-xl border px-3.5 text-[0.9375rem] transition-colors",
                    active === id ? "border-primary/30 bg-primary-soft font-semibold text-primary" : "border-border bg-surface font-medium text-muted hover:bg-surface-3 hover:text-text lg:border-transparent lg:bg-transparent",
                  )}
                >
                  <Icon aria-hidden size={18} /> {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 max-w-4xl flex-col gap-5">
          {active === "contas" ? (
            <>
              <Card aria-labelledby="h-contas">
                <SectionHeading id="h-contas" icon={<Wallet aria-hidden size={20} />} title="Contas e cartões" description="Toque em Editar para ajustar saldo, limite ou datas, ou para remover a conta." />
                {sp.removida ? <div className="mb-3"><Notice tone="positive">Conta removida.</Notice></div> : null}
                {balances.length ? (
                  <ul className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                    {balances.map((b) => {
                      const card = cards.find((c) => c.accountId === b.id);
                      const Icon = TYPE_ICON[b.type];
                      const used = card && card.limitCents > 0 ? Math.min(100, Math.round((Math.max(0, -b.balanceCents) / card.limitCents) * 100)) : null;
                      return (
                        <li key={b.id} className="rounded-2xl border border-border bg-surface p-4 shadow-card">
                          <div className="flex items-center gap-3">
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
                              <Icon aria-hidden size={20} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{b.name}</p>
                              <p className="truncate text-meta text-muted">{TYPE[b.type]}{b.institution !== b.name ? ` · ${b.institution}` : ""}</p>
                            </div>
                            <span className="shrink-0 font-semibold tabular-nums">
                              <Sensitive>{formatBRL(b.balanceCents)}</Sensitive>
                            </span>
                          </div>
                          {card ? (
                            <div className="mt-3">
                              {used !== null ? (
                                <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                                  <div className={cx("h-full rounded-full", used >= 80 ? "bg-attention" : "bg-primary")} style={{ width: `${used}%` }} />
                                </div>
                              ) : null}
                              <p className="text-meta text-muted">
                                {card.limitCents > 0 ? <>Limite <Sensitive>{formatBRL(card.limitCents)}</Sensitive> · </> : "Limite não informado · "}
                                fecha dia {card.closingDay}, vence dia {card.dueDay}
                              </p>
                            </div>
                          ) : null}
                          <details className="mt-1">
                            <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">Editar</summary>
                            <div className="mt-2">
                              <PrivateBlock fallback="Mostre os valores para editar esta conta.">
                                <AccountForm
                                  initial={{
                                    id: b.id,
                                    name: b.name,
                                    institution: b.institution,
                                    type: b.type,
                                    opening: formatBRL(b.openingBalanceCents).replace("R$ ", ""),
                                    limit: card ? formatBRL(card.limitCents).replace("R$ ", "") : undefined,
                                    closingDay: card?.closingDay,
                                    dueDay: card?.dueDay,
                                  }}
                                />
                              </PrivateBlock>
                              {bankLinked.has(b.id) ? (
                                <p className="mt-3 text-sm text-muted">
                                  Esta conta vem de um banco conectado. Para removê-la, <Link className="font-medium text-primary underline underline-offset-2" href="/configuracoes?aba=integracoes#bancos">desconecte o banco em Integrações</Link>.
                                </p>
                              ) : (
                                <RemoveAccountForm accountId={b.id} name={b.name} transactions={txs.filter((t) => t.accountId === b.id).length} askPassword={!user.isDemo} askCode={Boolean(user.totpEnabledAt)} />
                              )}
                            </div>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border p-5">
                    <p className="text-sm text-muted">Você ainda não tem contas. {manual ? "Escolha seus bancos em menos de um minuto." : "Conecte seu banco para trazer contas e cartões."}</p>
                    <ButtonLink href="/comecar">Começar</ButtonLink>
                  </div>
                )}
              </Card>
              {manual ? (
                <Card aria-labelledby="h-nova">
                  <details open={!balances.length ? false : undefined}>
                    <summary id="h-nova" className="inline-flex min-h-11 cursor-pointer items-center font-medium">Adicionar conta ou cartão</summary>
                    <div className="mt-3">
                      <AccountForm />
                    </div>
                  </details>
                </Card>
              ) : (
                <Card aria-labelledby="h-nova">
                  <h2 id="h-nova" className="font-medium">Adicionar conta ou cartão</h2>
                  <p className="mb-3 mt-1 text-sm text-muted">Contas e cartões novos entram pela conexão com o banco.</p>
                  <ButtonLink href="/configuracoes?aba=integracoes#bancos" variant="secondary">Conectar banco</ButtonLink>
                </Card>
              )}
            </>
          ) : null}

          {active === "categorias" ? (
            <Card aria-labelledby="h-cat">
              <SectionHeading id="h-cat" icon={<Tags aria-hidden size={20} />} title="Categorias" description="Usadas para organizar seus gastos e receitas." />
              <div className="mb-5 flex flex-col gap-4">
                {KIND_ORDER.map((kind) => {
                  const list = categories.filter((c) => c.kind === kind);
                  return list.length ? (
                    <div key={kind}>
                      <h3 className="mb-2 text-meta font-semibold uppercase tracking-wide text-muted">{KIND[kind]}</h3>
                      <ul className="flex flex-wrap gap-2">
                        {list.map((c) => (
                          <li key={c.id} className="rounded-full border border-border bg-surface-2 px-3 py-1 text-sm">
                            {c.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null;
                })}
              </div>
              <CategoryForm />
            </Card>
          ) : null}

          {active === "seguranca" && !user.isDemo ? (
            <>
              <Card aria-labelledby="h-2fa">
                <SectionHeading id="h-2fa" icon={<Smartphone aria-hidden size={20} />} title="Verificação em duas etapas" description="Pede um código do celular ao entrar. Obrigatória para conectar bancos." />
                {user.totpEnabledAt ? (
                  <>
                    <div className="mb-3">
                      <Notice tone="positive">Ativa desde {user.totpEnabledAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.</Notice>
                    </div>
                    <DisableTotpForm />
                  </>
                ) : (
                  <>
                    <p className="mb-3 text-sm text-muted">Sem o celular não há como recuperar o acesso: guarde a chave em lugar seguro.</p>
                    <EnableTotpForm />
                  </>
                )}
              </Card>
              <Card aria-labelledby="h-senha">
                <SectionHeading id="h-senha" icon={<KeyRound aria-hidden size={20} />} title="Senha" description="Trocar a senha encerra as outras sessões e revoga os tokens MCP." />
                <ChangePasswordForm askCode={Boolean(user.totpEnabledAt)} />
              </Card>
              <Card aria-labelledby="h-sessoes">
                <SectionHeading id="h-sessoes" icon={<LaptopMinimal aria-hidden size={20} />} title="Sessões" description="Cada sessão dura no máximo 7 dias." />
                <form action={endSessionsAction}>
                  <Button type="submit" variant="secondary">Encerrar outras sessões</Button>
                </form>
              </Card>
            </>
          ) : null}

          {active === "preferencias" ? (
            <>
              <Card aria-labelledby="h-ap">
                <SectionHeading id="h-ap" icon={<Palette aria-hidden size={20} />} title="Aparência" />
                <ThemeToggle />
              </Card>
              <Card aria-labelledby="h-ia">
                <SectionHeading id="h-ia" icon={<Sparkles aria-hidden size={20} />} title="Inteligência artificial" description={`Provedor: ${provider === "mock" ? "Demonstração (sem IA externa)" : provider === "anthropic" ? "Anthropic (Claude)" : "Ollama (local)"}`} />
                <ul className="mb-3 list-disc pl-5 text-sm text-muted">
                  <li>Os cálculos são sempre feitos aqui, por funções testadas; o modelo só escolhe ferramentas e redige a resposta.</li>
                  <li>Com provedor externo, são enviados apenas a pergunta, nomes de contas/categorias e o resultado das ferramentas usadas. Nunca senhas ou tokens.</li>
                  <li>Com Ollama local os dados não saem da sua máquina, mas a qualidade depende do modelo escolhido.</li>
                </ul>
                {external ? (
                  user.aiExternalConsentAt ? (
                    <form action={setAiConsentAction} className="flex flex-col gap-2">
                      <Notice tone="positive">Você autorizou o envio em {user.aiExternalConsentAt.toLocaleDateString("pt-BR")}.</Notice>
                      <input type="hidden" name="grant" value="0" />
                      <div>
                        <Button variant="secondary" type="submit">Revogar autorização</Button>
                      </div>
                    </form>
                  ) : (
                    <form action={setAiConsentAction} className="flex flex-col gap-2">
                      <Notice tone="attention">O chat fica bloqueado até você autorizar o envio dos dados mínimos ao provedor externo.</Notice>
                      <input type="hidden" name="grant" value="1" />
                      <div>
                        <Button type="submit">Autorizar envio ao provedor de IA</Button>
                      </div>
                    </form>
                  )
                ) : (
                  <Notice tone="info">Nenhum dado financeiro sai deste servidor com a configuração atual.</Notice>
                )}
              </Card>
            </>
          ) : null}

          {active === "whatsapp" ? (
            <Card aria-labelledby="h-wa">
              <SectionHeading id="h-wa" icon={<MessageCircle aria-hidden size={20} />} title="WhatsApp" description="Registre gastos por mensagem. O registro fica só no Cruzado: nada é enviado ao banco." />
              {user.isDemo ? (
                <Notice tone="info">Indisponível no modo demonstração. Crie uma conta para usar.</Notice>
              ) : !whatsappConfig() ? (
                <Notice tone="attention" title="Ainda não ativado neste servidor">Falta configurar a conta oficial da Meta. Veja docs/WHATSAPP.md.</Notice>
              ) : link?.status === "active" ? (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone="positive">Conectado</Badge>
                    <span>{link.phoneMasked}</span>
                    {link.lastActivityAt ? <span className="text-muted">Última mensagem em {link.lastActivityAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span> : null}
                  </div>
                  {health?.failed ? <Notice tone="attention" title="Erro ao processar mensagens">{plural(health.failed, "mensagem", "mensagens")} dos últimos 7 dias não foram registradas. Envie de novo, se precisar.</Notice> : null}
                  {health?.openDrafts ? <Notice tone="info">Há um lançamento aguardando sua resposta no WhatsApp.</Notice> : null}
                  <LinkSettingsForm accounts={accounts.filter((a) => !a.archived)} accountId={link.defaultAccountId} mode={link.mode} />
                  <div className="rounded-xl bg-surface-2 p-3 text-sm">
                    <p className="mb-1 font-medium">Experimente enviar</p>
                    <ul className="list-disc pl-5 text-muted">
                      <li>gastei 60 no Pix no restaurante</li>
                      <li>paguei 45 no almoço ontem</li>
                      <li>recebi 200 de um freela</li>
                    </ul>
                  </div>
                  <form action={disconnectLinkAction}>
                    <ConfirmSubmit confirmLabel="Sim, desconectar">Desconectar WhatsApp</ConfirmSubmit>
                  </form>
                </div>
              ) : link?.status === "pending" ? (
                accounts.some((a) => !a.archived && a.type !== "credit_card" && a.type !== "cash") ? (
                  <ConfirmLinkForm accounts={accounts.filter((a) => !a.archived)} phone={link.phoneMasked ?? ""} askPassword={!user.isDemo} askCode={Boolean(user.totpEnabledAt)} />
                ) : (
                  <Notice tone="attention">Cadastre uma conta corrente antes de confirmar o número.</Notice>
                )
              ) : (
                <div className="flex flex-col gap-3">
                  <ol className="list-decimal pl-5 text-sm text-muted">
                    <li>Gere um código aqui.</li>
                    <li>Envie o código pelo WhatsApp para o número do Cruzado.</li>
                    <li>Volte aqui e confirme o número.</li>
                  </ol>
                  <p className="text-meta text-muted">Suas mensagens passam pelos servidores da Meta. O texto é apagado depois de processado.</p>
                  <LinkCodeForm displayNumber={whatsappConfig()?.displayNumber} />
                </div>
              )}
            </Card>
          ) : null}

          {active === "integracoes" ? (
            <>
              <Card id="bancos" aria-labelledby="h-bancos">
                <SectionHeading id="h-bancos" icon={<Landmark aria-hidden size={20} />} title="Bancos conectados" description="Open Finance, somente leitura." />
                {isBankOwner(user) && !user.totpEnabledAt ? (
                  <Notice tone="attention">
                    Ative a <Link className="font-medium underline" href="/configuracoes?aba=seguranca">verificação em duas etapas</Link> para conectar bancos.
                  </Notice>
                ) : canConnectBanks(user) ? (
                  <>
                    <p className="mb-3 text-sm text-muted">Saldos, movimentações e cartões, com a sua autorização. O Cruzado nunca vê a senha do banco e não consegue movimentar dinheiro.</p>
                    {connections.length ? (
                      <ul className="mb-4 divide-y divide-border rounded-xl border border-border text-sm">
                        {connections.map((c) => (
                          <li key={c.id} className="p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-medium">{c.label}</p>
                              <Badge tone={CONNECTION_STATUS[c.status].tone}>{CONNECTION_STATUS[c.status].label}</Badge>
                            </div>
                            <p className="text-meta text-muted">
                              {c.lastSyncAt ? `Última atualização concluída: ${formatDateTimeBR(c.lastSyncAt)}` : "Nenhuma atualização concluída ainda"}
                              {c.consentExpiresAt ? ` · autorização até ${c.consentExpiresAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}
                            </p>
                            {c.statusDetail ? <p className="mt-1 text-sm text-attention">{c.statusDetail}</p> : null}
                            {c.status === "disconnected" ? <DeleteHistoryForm connectionId={c.id} askPassword={!user.isDemo} askCode={Boolean(user.totpEnabledAt)} /> : <BankActions connectionId={c.id} widget={c.accessMode === "connect"} attention={c.status === "reauth_required"} />}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {pluggyMode() === "connect" ? <ConnectWidgetForm /> : <ConnectBankForm />}
                  </>
                ) : user.isDemo || process.env.PLUGGY_OWNER_USER_ID ? (
                  <Notice tone="info">
                    A conexão automática ainda não está disponível para todas as contas. Por enquanto, <Link className="font-medium underline" href="/transacoes/importar">importe o extrato do seu banco</Link>.
                  </Notice>
                ) : (
                  <Notice tone="info">
                    Conexão com bancos ainda não configurada. Para ser o proprietário, defina <code>PLUGGY_OWNER_USER_ID={user.id}</code> no servidor (veja docs/OPEN_FINANCE.md).
                  </Notice>
                )}
              </Card>

              {owner ? (
              <Card id="mcp" aria-labelledby="h-mcp">
                <SectionHeading id="h-mcp" icon={<Bot aria-hidden size={20} />} title="Acesso MCP" description="Conecte Claude, Hermes ou outro cliente. Revogue quando quiser." />
                {tokens.length ? (
                  <ul className="mb-3 divide-y divide-border rounded-xl border border-border text-sm">
                    {tokens.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                        <div>
                          <p className="flex flex-wrap items-center gap-2 font-medium">
                            {t.name} <Badge tone={t.scope === "capture" ? "attention" : "neutral"}>{t.scope === "capture" ? "Lançar" : "Consultar"}</Badge>
                          </p>
                          <p className="text-meta text-muted">
                            <code>{t.prefix}…</code> · criado em {t.createdAt.toLocaleDateString("pt-BR")}
                            {t.lastUsedAt ? ` · usado em ${t.lastUsedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : " · nunca usado"}
                            {t.expiresAt ? ` · vale até ${t.expiresAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}
                          </p>
                        </div>
                        {t.revokedAt ? (
                          <Badge>Revogado</Badge>
                        ) : (
                          <form action={revokeMcpTokenAction}>
                            <input type="hidden" name="id" value={t.id} />
                            <ConfirmSubmit size="sm" confirmLabel="Sim, revogar">Revogar</ConfirmSubmit>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <McpTokenForm baseUrl={baseUrl} askPassword={!user.isDemo} askCode={Boolean(user.totpEnabledAt)} />
              </Card>
              ) : null}
            </>
          ) : null}

          {active === "dados" ? (
            <>
              <Card aria-labelledby="h-export">
                <SectionHeading id="h-export" icon={<Database aria-hidden size={20} />} title="Exportar" description="Baixe tudo o que o Cruzado guarda sobre você, em JSON." />
                <ButtonLink href="/api/export" variant="secondary" prefetch={false}>
                  Exportar meus dados
                </ButtonLink>
              </Card>
              <section aria-labelledby="h-excluir" className="rounded-2xl border border-risk/40 bg-surface p-4 shadow-sm sm:p-5">
                <div className="mb-4 flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-risk-soft text-risk">
                    <TriangleAlert aria-hidden size={20} />
                  </span>
                  <div>
                    <h2 id="h-excluir" className="text-base font-semibold">Excluir conta</h2>
                    <p className="text-sm text-muted">Remove definitivamente sua conta e todos os dados financeiros. Eventos de auditoria ficam anonimizados. Não dá para desfazer.</p>
                  </div>
                </div>
                <DeleteAccountForm askPassword={!user.isDemo} askCode={Boolean(user.totpEnabledAt)} />
              </section>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
