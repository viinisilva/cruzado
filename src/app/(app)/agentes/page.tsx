import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, CalendarDays, Copy, Wallet } from "lucide-react";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { listAgents } from "@/lib/agents/service";
import { AgentRuleSchema, KIND_LABEL, describeRule } from "@/lib/agents/rule";
import { loadAccounts, loadCategories } from "@/lib/data/repo";
import { formatBRL } from "@/lib/money";
import { Badge, Button, Card, CardTitle, EmptyState, PageHeader, cx, linkCls } from "@/components/ui";
import { ConfirmSubmit, PrivateBlock, SensitiveText } from "@/components/client";
import { confirmAgentAction, deleteAgentAction, pauseAgentAction, resumeAgentAction, runAgentNowAction } from "../../actions/agents";
import { AgentRuleForm, NaturalLanguageAgentForm } from "./forms";

export const metadata: Metadata = { title: "Agentes" };

const STATUS = { draft: { label: "Rascunho — aguardando confirmação", tone: "attention" }, active: { label: "Ativo", tone: "positive" }, paused: { label: "Pausado", tone: "neutral" } } as const;

// Goals people recognize. Each one only fills the form: the agent is created as a draft for review.
const TEMPLATES = [
  { id: "gastos-do-dia", icon: Wallet, title: "Controlar gastos do dia", text: "Avisa quando as despesas do dia passam do limite que você definir.", kind: "daily_spend_limit", name: "Limite de gastos do dia", threshold: "200,00" },
  { id: "resumo-semanal", icon: CalendarDays, title: "Receber resumo semanal", text: "Toda segunda, um resumo das despesas da semana anterior.", kind: "weekly_summary", name: "Resumo da semana" },
  { id: "cobrancas-repetidas", icon: Copy, title: "Conferir cobranças repetidas", text: "Aponta possíveis duplicidades para você conferir.", kind: "possible_duplicate", name: "Cobranças repetidas" },
  { id: "comparar-meses", icon: BarChart3, title: "Comparar meus meses", text: "Compara os gastos do mês com o mês anterior.", kind: "monthly_comparison", name: "Comparação mensal" },
] as const;

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ rascunho?: string; modelo?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = await getDb();
  const [agents, categories, accounts] = await Promise.all([listAgents(db, user.id), loadCategories(db, user.id), loadAccounts(db, user.id)]);
  const names = { accounts: new Map(accounts.map((a) => [a.id, a.name])), categories: new Map(categories.map((c) => [c.id, c.name])) };
  const expenseCats = categories.filter((c) => c.kind === "expense");
  const drafts = agents.filter((a) => a.status === "draft");
  const others = agents.filter((a) => a.status !== "draft");
  const template = TEMPLATES.find((t) => t.id === sp.modelo);

  const renderAgent = (a: (typeof agents)[number]) => {
    const rule = AgentRuleSchema.parse(a.rule);
    const highlight = sp.rascunho === a.id;
    return (
      <li key={a.id}>
        <Card className={cx("flex h-full flex-col", highlight && "border-2 border-primary")} aria-labelledby={`ag-${a.id}`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 id={`ag-${a.id}`} className="text-lg font-semibold leading-snug">
              <SensitiveText>{a.name}</SensitiveText>
            </h3>
            <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
          </div>
          <p className="mb-3 text-meta text-muted">
            {KIND_LABEL[a.kind]}
            {a.origin === "natural_language" ? " · criado a partir de linguagem natural" : ""}
            {a.lastRunAt ? ` · última execução ${a.lastRunAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}
          </p>
          {a.sourceText ? <p className="mb-2 text-sm italic text-muted">Pedido: “<SensitiveText>{a.sourceText}</SensitiveText>”</p> : null}
          <ul className="mb-4 flex flex-col gap-1 rounded-xl bg-surface-2 p-3.5 pl-8 text-[0.9375rem] list-disc marker:text-primary">
            {describeRule(rule, names, { draft: a.status === "draft" }).map((l) => (
              <li key={l}><SensitiveText>{l}</SensitiveText></li>
            ))}
          </ul>
          <div className="mt-auto flex flex-wrap gap-2">
            {a.status === "draft" ? (
              <form action={confirmAgentAction}>
                <input type="hidden" name="id" value={a.id} />
                <Button type="submit">Confirmar e ativar</Button>
              </form>
            ) : null}
            {a.status === "active" ? (
              <>
                <form action={runAgentNowAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <Button type="submit" variant="secondary">Executar agora</Button>
                </form>
                <form action={pauseAgentAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <Button type="submit" variant="secondary">Pausar</Button>
                </form>
              </>
            ) : null}
            {a.status === "paused" ? (
              <form action={resumeAgentAction}>
                <input type="hidden" name="id" value={a.id} />
                <Button type="submit" variant="secondary">Retomar</Button>
              </form>
            ) : null}
            <form action={deleteAgentAction}>
              <input type="hidden" name="id" value={a.id} />
              {a.status === "draft" ? <Button type="submit" variant="danger">Descartar</Button> : <ConfirmSubmit confirmLabel="Sim, excluir agente">Excluir</ConfirmSubmit>}
            </form>
          </div>
          <details className="mt-3">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-primary">Editar</summary>
            <div className="mt-3">
              <PrivateBlock fallback="Mostre os valores para editar este agente.">
                <AgentRuleForm
                  categories={expenseCats}
                  accounts={accounts}
                  initial={{
                    id: a.id,
                    name: a.name,
                    kind: a.kind,
                    threshold: rule.thresholdCents ? formatBRL(rule.thresholdCents).replace("R$ ", "") : undefined,
                    schedule: rule.schedule,
                    categoryIds: rule.filters?.categoryIds,
                    accountIds: rule.filters?.accountIds,
                  }}
                />
              </PrivateBlock>
            </div>
          </details>
          {a.status !== "draft" ? (
            <Link href="/alertas" className={linkCls}>Ver alertas</Link>
          ) : null}
        </Card>
      </li>
    );
  };

  return (
    <>
      <PageHeader title="Agentes" description="Eles acompanham seus dados e avisam quando algo merece atenção. Nada é ativado sem a sua confirmação." />
      {drafts.length ? (
        <section className="mb-10" aria-labelledby="drafts">
          <h2 id="drafts" className="mb-4 text-xl font-semibold tracking-tight">Para revisar</h2>
          <ul className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3">{drafts.map(renderAgent)}</ul>
        </section>
      ) : null}

      <section className="mb-10" aria-labelledby="mine">
        <h2 id="mine" className="mb-4 text-xl font-semibold tracking-tight">Seus agentes</h2>
        {others.length ? (
          <ul className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3">{others.map(renderAgent)}</ul>
        ) : (
          <EmptyState title="Nenhum agente ativo ainda">Comece por um dos objetivos abaixo.</EmptyState>
        )}
      </section>

      <section className="mb-10" aria-labelledby="modelos">
        <h2 id="modelos" className="text-xl font-semibold tracking-tight">O que você quer acompanhar?</h2>
        <p className="mb-4 mt-1 text-sm text-muted">Escolha um objetivo. O formulário já vem preenchido e o agente nasce como rascunho.</p>
        <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          {TEMPLATES.map((t) => {
            const Icon = t.icon;
            return (
              <li key={t.id}>
                <Link href={`/agentes?modelo=${t.id}#novo`} aria-current={t.id === template?.id ? "true" : undefined} className={cx("flex h-full min-h-24 gap-3 rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-border-strong hover:bg-surface-2", t.id === template?.id && "border-primary bg-primary-soft outline-2 outline-primary")}>
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><Icon aria-hidden size={20} /></span>
                  <span>
                    <span className="block text-[0.9375rem] font-semibold">{t.title}</span>
                    <span className="block text-sm text-muted">{t.text}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {template ? (
        <Card id="novo" aria-labelledby="h-modelo" className="mb-6 max-w-4xl scroll-mt-20">
          <CardTitle id="h-modelo">{template.title}</CardTitle>
          <p className="mb-3 text-sm text-muted">Ajuste se quiser. Isto cria um rascunho: você revisa e confirma antes de ativar.</p>
          <AgentRuleForm key={template.id} categories={expenseCats} accounts={accounts} initial={{ name: template.name, kind: template.kind, threshold: "threshold" in template ? template.threshold : undefined }} />
        </Card>
      ) : null}

      <Card aria-labelledby="nl" className="mb-4 max-w-4xl">
        <CardTitle id="nl">Pedir com suas palavras</CardTitle>
        <p className="mb-3 text-sm text-muted">Você revisa o resumo antes de ativar.</p>
        <NaturalLanguageAgentForm />
      </Card>

      <details className="max-w-4xl rounded-2xl border border-border bg-surface px-5 py-1 shadow-card">
        <summary className="flex min-h-12 cursor-pointer items-center text-[0.9375rem] font-semibold">Criar do zero</summary>
        <section aria-label="Criar manualmente" className="py-3">
          <AgentRuleForm categories={expenseCats} accounts={accounts} />
        </section>
      </details>
    </>
  );
}
