"use client";
// Pill tabs across the money views. Lives in the app layout so it survives route changes and the highlight can glide
// from the old tab to the new one. Off the money routes it renders nothing.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { ArrowLeftRight, CreditCard, LayoutDashboard, PieChart, Repeat } from "lucide-react";
import { cx } from "./ui";

export const FINANCE_TABS = [
  { href: "/inicio", label: "Visão geral", icon: LayoutDashboard },
  { href: "/transacoes", label: "Transações", icon: ArrowLeftRight },
  { href: "/cartoes", label: "Cartões", icon: CreditCard },
  { href: "/categorias", label: "Categorias", icon: PieChart },
  { href: "/recorrentes", label: "Recorrentes", icon: Repeat },
] as const;

/** Only the list pages get the tabs; a form or a detail page keeps its own back link. */
const isTabRoute = (path: string) => FINANCE_TABS.some((t) => path === t.href);

export function FinanceTabs() {
  const path = usePathname();
  const listRef = useRef<HTMLUListElement>(null);
  const [indicator, setIndicator] = useState<{ x: number; y: number; w: number } | null>(null);
  const active = FINANCE_TABS.find((t) => path === t.href)?.href;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    // Where the active pill sits inside the scroller. Re-read when sizes change (resize, breakpoint, zoom) and once the
    // web font arrives, or the highlight would drift onto a neighbour.
    const measure = () => {
      const item = list.querySelector<HTMLAnchorElement>('a[aria-current="page"]')?.parentElement;
      setIndicator(item ? { x: item.offsetLeft, y: item.offsetTop, w: item.offsetWidth } : null);
    };
    measure();
    list.querySelector('a[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    list.querySelectorAll("li:not([aria-hidden])").forEach((li) => observer.observe(li));
    let alive = true;
    document.fonts?.ready.then(() => alive && measure());
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [active]);

  if (!isTabRoute(path)) return null;
  return (
    <nav aria-label="Visões de finanças" className="-mx-4 mb-6 sm:-mx-6 lg:mx-0 lg:mb-8">
      <ul ref={listRef} className="scroll-fade relative flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 py-1 sm:scroll-px-6 sm:px-6 lg:flex-wrap lg:overflow-visible lg:px-0 lg:[mask-image:none]">
        {indicator ? (
          <li
            aria-hidden
            className="pointer-events-none absolute top-0 h-11 rounded-full border border-primary/50 bg-primary-soft transition-[transform,width] duration-200 ease-out motion-reduce:transition-none"
            style={{ left: 0, width: indicator.w, transform: `translate(${indicator.x}px, ${indicator.y}px)` }}
          />
        ) : null}
        {FINANCE_TABS.map(({ href, label, icon: Icon }) => {
          const on = href === active;
          return (
            <li key={href} className="relative shrink-0 snap-start">
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm transition-colors",
                  on ? "border-transparent font-semibold text-primary" : "border-border font-medium text-muted hover:border-border-strong hover:text-text",
                  on && !indicator && "border-primary/50 bg-primary-soft",
                )}
              >
                <Icon aria-hidden size={16} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
