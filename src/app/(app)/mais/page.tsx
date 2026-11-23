// "Mais" on the phone's bottom bar: everything that is not one of the four daily places, as big rows with a line that
// says what each one is for. On a computer the sidebar already lists these, so this page is mostly for phones.
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { isDemoInstance } from "@/lib/demo/instance-env";
import { MORE } from "@/components/nav-items";
import { PageHeader } from "@/components/ui";
import { logoutAction } from "../../actions/auth";

export const metadata: Metadata = { title: "Mais" };

export default async function MorePage() {
  await requireUser();
  const row = "flex min-h-16 w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-surface-3";
  return (
    <>
      <PageHeader title="Mais" />
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {MORE.map(({ href, label, description, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className={row}>
              <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <Icon size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">{label}</span>
                <span className="block text-sm text-muted">{description}</span>
              </span>
              <ChevronRight aria-hidden size={20} className="shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
      {isDemoInstance() ? null : (
        <form action={logoutAction} className="mt-4">
          <button className={`${row} rounded-2xl border border-border bg-surface font-semibold`}>
            <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-muted">
              <LogOut size={22} />
            </span>
            Sair
          </button>
        </form>
      )}
    </>
  );
}
