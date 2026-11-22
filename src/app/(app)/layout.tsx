import { cookies } from "next/headers";
import Link from "next/link";
import { and, count, eq, isNull } from "drizzle-orm";
import { Bell, LogOut } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { initials } from "@/lib/banks";
import { BottomNav, HideValuesButton, PrivacyProvider, SideNav } from "@/components/client";
import { logoutAction } from "../actions/auth";
import { Logo } from "@/components/logo";
import { FinanceTabs } from "@/components/finance-tabs";
import { Suspense } from "react";
import { DemoBanner } from "@/components/demo-banner";
import { isDemoInstance } from "@/lib/demo/instance-env";

function AlertsLink({ unread }: { unread: number }) {
  return (
    <Link
      href="/alertas"
      className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-3 hover:text-text"
      aria-label={unread ? `Alertas: ${unread} não lidos` : "Alertas"}
    >
      <Bell aria-hidden size={20} />
      {unread ? (
        <span aria-hidden className="absolute right-1 top-1 min-w-5 rounded-full bg-attention px-1 text-center text-[11px] font-bold leading-5 text-[var(--bg)]">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}

// Streams in after the frame: the frame (and the page's loading state) must not wait for the database to wake up.
async function UnreadAlertsLink({ userId }: { userId: string }) {
  const db = await getDb();
  const [{ unread } = { unread: 0 }] = await db
    .select({ unread: count() })
    .from(s.notifications)
    .where(and(eq(s.notifications.userId, userId), isNull(s.notifications.readAt)));
  return <AlertsLink unread={unread} />;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const publicDemo = isDemoInstance();

  return (
    <PrivacyProvider initialHidden={(await cookies()).get("tostao-hide-values")?.value === "1"}>
      <a href="#conteudo" className="sr-only-focusable fixed left-2 top-2 z-50 rounded-xl bg-primary px-4 py-2 font-semibold text-primary-fg">
        Pular para o conteúdo
      </a>
      <div className="lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-r lg:border-border lg:bg-bg lg:px-4 lg:py-5">
          <Link href="/inicio" className="mb-7 flex min-h-11 items-center gap-2 px-3" aria-label="Cruzado, ir para o início">
            <Logo />
          </Link>
          <nav aria-label="Principal">
            <SideNav />
          </nav>
          <div className="mt-auto flex flex-col gap-1 border-t border-border pt-4">
            <div className="flex items-center gap-3 px-3 py-2">
              <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">{initials(user.name)}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{user.name}</span>
                {user.isDemo ? <span className="block text-meta font-medium text-attention">Modo demonstração</span> : null}
              </span>
            </div>
            {publicDemo ? null : (
              <form action={logoutAction}>
                <button className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-muted transition-colors hover:bg-surface-3 hover:text-text">
                  <LogOut aria-hidden size={18} /> Sair
                </button>
              </form>
            )}
          </div>
        </aside>

        <div className="flex min-h-dvh min-w-0 flex-col">
          {user.isDemo ? (
            <Suspense fallback={null}>
              <DemoBanner readOnly={publicDemo} />
            </Suspense>
          ) : null}
          <header className="sticky top-0 z-20 border-b border-border/70 bg-bg/85 backdrop-blur-md lg:border-transparent">
            <div className="mx-auto flex w-full max-w-[1480px] items-center justify-between gap-2 px-4 py-1.5 sm:px-6 lg:justify-end lg:px-10">
              <Link href="/inicio" className="flex min-h-11 items-center lg:hidden" aria-label="Cruzado, ir para o início">
                <Logo />
              </Link>
              <div className="flex items-center gap-1">
                {user.isDemo ? (
                  <span className="rounded-full bg-attention-soft px-2.5 py-0.5 text-meta font-semibold text-attention lg:hidden">
                    <span aria-hidden className="min-[400px]:hidden">Demo</span>
                    <span className="max-[399px]:sr-only">Demonstração</span>
                  </span>
                ) : null}
                <HideValuesButton />
                <Suspense fallback={<AlertsLink unread={0} />}>
                  <UnreadAlertsLink userId={user.id} />
                </Suspense>
                {publicDemo ? null : (
                  <form action={logoutAction} className="lg:hidden">
                    <button className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-muted hover:bg-surface-3" aria-label="Sair">
                      <LogOut aria-hidden size={20} />
                    </button>
                  </form>
                )}
              </div>
            </div>
          </header>
          <main id="conteudo" className="mx-auto w-full max-w-[1480px] flex-1 px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 lg:px-10 lg:pb-14 lg:pt-2">
            <FinanceTabs />
            {children}
          </main>
        </div>
      </div>
      <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <BottomNav />
      </nav>
    </PrivacyProvider>
  );
}
