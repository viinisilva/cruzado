import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { AlertTriangle, Info } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { alertText, plural } from "@/lib/text";
import { Badge, Button, ButtonLink, EmptyState, PageHeader, cx } from "@/components/ui";
import { SensitiveText } from "@/components/client";
import { markNotificationsReadAction } from "../../actions/agents";

export const metadata: Metadata = { title: "Notificações" };

const NEXT_STEP: Record<string, string> = {
  possible_duplicate: "Confira as transações abaixo. É uma suspeita, não confirmação de fraude; só o seu banco pode dizer se a cobrança é indevida.",
  daily_spend_limit: "Veja o que entrou no dia. O limite pode ser ajustado em Meus avisos.",
  weekly_summary: "Abra as transações para ver o detalhe da semana.",
  monthly_comparison: "Compare as categorias que mais mudaram.",
};

export default async function AlertsPage() {
  const user = await requireUser();
  const db = await getDb();
  const items = await db.select().from(s.notifications).where(eq(s.notifications.userId, user.id)).orderBy(desc(s.notifications.createdAt)).limit(100);
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <>
      <PageHeader
        title="Notificações"
        description={`${plural(unread, "não lida", "não lidas")}. Chegam quando um dos seus avisos encontra algo; as regras ficam em Meus avisos.`}
        action={
          unread ? (
            <form action={markNotificationsReadAction}>
              <Button variant="secondary" type="submit">Marcar todos como lidos</Button>
            </form>
          ) : null
        }
      />
      {items.length ? (
        <ul className="flex max-w-4xl flex-col gap-4">
          {items.map((n) => (
            <li key={n.id} className={cx("flex gap-4 rounded-2xl border bg-surface p-5 shadow-card", !n.readAt ? "border-border-strong/50" : "border-border")}>
              <span aria-hidden className={cx("hidden size-11 shrink-0 items-center justify-center rounded-xl sm:flex", n.severity === "info" ? "bg-primary-soft text-primary" : n.severity === "risk" ? "bg-risk-soft text-risk" : "bg-attention-soft text-attention")}>
                {n.severity === "info" ? <Info size={20} /> : <AlertTriangle size={20} />}
              </span>
              <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone={n.severity === "info" ? "info" : n.severity}>{n.severity === "info" ? "Informativo" : n.severity === "attention" ? "Atenção" : "Risco"}</Badge>
                {!n.readAt ? <Badge>Novo</Badge> : null}
                <span className="text-meta text-muted">{n.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>
              </div>
              <h2 className="break-words text-lg font-semibold leading-snug"><SensitiveText>{n.title}</SensitiveText></h2>
              <p className="mt-1 max-w-prose break-words text-[0.9375rem]"><SensitiveText>{alertText(n.body)}</SensitiveText></p>
              {NEXT_STEP[n.kind] ? <p className="mt-3 max-w-prose rounded-xl bg-surface-2 p-3 text-sm text-muted"><span className="font-semibold text-text">Próximo passo: </span>{NEXT_STEP[n.kind]}</p> : null}
              {n.links.length ? (
                <ul className="mt-2 flex flex-wrap gap-x-5">
                  {n.links.map((l) => (
                    <li key={l.href + l.label}>
                      <Link href={l.href} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-2">
                        <SensitiveText>{l.label}</SensitiveText>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              {!n.readAt ? (
                <form action={markNotificationsReadAction} className="mt-1">
                  <input type="hidden" name="id" value={n.id} />
                  <Button variant="ghost" size="sm" type="submit" className="-ml-3">Marcar como lido</Button>
                </form>
              ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nenhum alerta" action={<ButtonLink href="/agentes" variant="secondary">Conhecer os agentes</ButtonLink>}>
          Quando um agente encontrar algo, o aviso aparece aqui.
        </EmptyState>
      )}
    </>
  );
}
