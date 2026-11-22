import Link from "next/link";
import { cx } from "@/components/ui";

const TABS = [
  { id: "movimentacoes", href: "/transacoes", label: "Movimentações" },
  { id: "revisar", href: "/transacoes/revisar", label: "Revisar" },
  { id: "importacoes", href: "/transacoes/importacoes", label: "Importações" },
] as const;

export function TxTabs({ current, reviewCount }: { current: (typeof TABS)[number]["id"]; reviewCount: number }) {
  return (
    <nav aria-label="Áreas de transações" className="-mx-4 mb-6 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
      <ul className="flex gap-6">
        {TABS.map((t) => (
          <li key={t.id}>
            <Link
              href={t.href}
              aria-current={t.id === current ? "page" : undefined}
              className={cx("-mb-px flex min-h-12 items-center gap-2 whitespace-nowrap border-b-[3px] text-[0.9375rem] transition-colors", t.id === current ? "border-primary font-semibold text-primary" : "border-transparent font-medium text-muted hover:border-border-strong hover:text-text")}
            >
              {t.label}
              {t.id === "revisar" && reviewCount > 0 ? (
                <span className="rounded-full bg-attention-soft px-2 text-meta font-semibold tabular-nums text-attention">
                  <span className="sr-only">, </span>
                  {reviewCount.toLocaleString("pt-BR")}
                  <span className="sr-only"> pendentes</span>
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
