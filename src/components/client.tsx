"use client";
// Client-only interactive bits: navigation state, hide-values toggle, theme toggle.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Eye, EyeOff, Home, LayoutGrid, Minus, Moon, Sun, SunMoon, TrendingDown, TrendingUp } from "lucide-react";
import { MORE, NAV } from "./nav-items";
import { formatBasisPoints, maskMoney } from "@/lib/money";
import { Button, cx } from "./ui";

const within = (path: string, href: string) => path === href || path.startsWith(`${href}/`);
const inMore = (path: string) => path === "/mais" || MORE.some((m) => within(path, m.href));

function NavLink({ href, label, icon: Icon, active, variant }: { href: string; label: string; icon: typeof Home; active: boolean; variant: "side" | "bottom" }) {
  if (variant === "bottom") {
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cx("flex min-h-[4.25rem] flex-col items-center justify-center gap-1 text-sm", active ? "font-semibold text-primary" : "font-medium text-muted")}
      >
        <span className={cx("flex h-8 w-14 items-center justify-center rounded-full transition-colors", active && "bg-primary-soft")}>
          <Icon aria-hidden size={24} strokeWidth={active ? 2.3 : 1.9} />
        </span>
        <span>{label}</span>
      </Link>
    );
  }
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "relative flex min-h-12 items-center gap-3 rounded-xl px-3 text-base transition-colors",
        active ? "bg-primary-soft font-semibold text-primary before:absolute before:inset-y-2.5 before:-left-4 before:w-1 before:rounded-r-full before:bg-primary" : "font-medium text-muted hover:bg-surface-3 hover:text-text",
      )}
    >
      <Icon aria-hidden size={21} strokeWidth={active ? 2.25 : 1.9} />
      {label}
    </Link>
  );
}

export function SideNav() {
  const path = usePathname();
  return (
    <>
      <ul className="flex flex-col gap-1">
        {NAV.map((n) => (
          <li key={n.href}>
            <NavLink {...n} active={within(path, n.href)} variant="side" />
          </li>
        ))}
      </ul>
      <p className="mt-5 px-3 pb-1 text-sm font-semibold text-muted">Mais</p>
      <ul className="flex flex-col gap-1">
        {MORE.map((n) => (
          <li key={n.href}>
            <NavLink {...n} active={within(path, n.href)} variant="side" />
          </li>
        ))}
      </ul>
    </>
  );
}

export function BottomNav() {
  const path = usePathname();
  return (
    <ul className="mx-auto grid max-w-lg grid-cols-5">
      {NAV.map((n) => (
        <li key={n.href}>
          <NavLink {...n} active={within(path, n.href)} variant="bottom" />
        </li>
      ))}
      <li>
        <NavLink href="/mais" label="Mais" icon={LayoutGrid} active={inMore(path)} variant="bottom" />
      </li>
    </ul>
  );
}

/** Two-step submit for destructive actions: the first click only arms it, and it disarms by itself. */
export function ConfirmSubmit({ children, confirmLabel, size }: { children: ReactNode; confirmLabel: string; size?: "sm" | "md" }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);
  if (!armed) {
    return (
      <Button type="button" variant="danger" size={size} onClick={() => setArmed(true)}>
        {children}
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2" role="group" aria-label="Confirmação">
      <Button type="submit" variant="danger" size={size} autoFocus>
        {confirmLabel}
      </Button>
      <Button type="button" variant="ghost" size={size} onClick={() => setArmed(false)}>
        Cancelar
      </Button>
    </span>
  );
}

const PrivacyCtx = createContext<{ hidden: boolean; toggle: () => void }>({ hidden: false, toggle: () => {} });

export const HIDE_VALUES_COOKIE = "tostao-hide-values";

/** The server reads the cookie, so a page already renders masked: values never flash before hydration. */
export function PrivacyProvider({ children, initialHidden }: { children: ReactNode; initialHidden: boolean }) {
  const [hidden, setHidden] = useState(initialHidden);
  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${HIDE_VALUES_COOKIE}=${next ? "1" : "0"}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  };
  return <PrivacyCtx.Provider value={{ hidden, toggle }}>{children}</PrivacyCtx.Provider>;
}

/** Wraps a sensitive value; shows dots when the user hides values. */
export function Sensitive({ children, className, shownClassName }: { children: ReactNode; className?: string; shownClassName?: string }) {
  const { hidden } = useContext(PrivacyCtx);
  // shownClassName carries cues that depend on the value (red for negative): they would leak the sign if kept while hidden.
  return hidden ? (
    <span className={className} aria-label="valor oculto">
      ••••••
    </span>
  ) : (
    <span className={cx(className, shownClassName)}>{children}</span>
  );
}

/** Free text that may mention amounts: alert bodies, chat answers, agent names. */
export function SensitiveText({ children }: { children: string }) {
  const { hidden } = useContext(PrivacyCtx);
  return <>{hidden ? maskMoney(children) : children}</>;
}

/** Content that reveals amounts by shape or by value (chart bars, edit forms) is replaced while values are hidden. */
export function PrivateBlock({ children, fallback }: { children: ReactNode; fallback?: string }) {
  const { hidden } = useContext(PrivacyCtx);
  if (!hidden) return <>{children}</>;
  return fallback ? <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">{fallback}</p> : null;
}

export function HideValuesButton() {
  const { hidden, toggle } = useContext(PrivacyCtx);
  return (
    <button type="button" onClick={toggle} aria-pressed={hidden} className={cx("inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-2.5 text-sm font-medium transition-colors sm:px-3", hidden ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-3 hover:text-text")}>
      {hidden ? <Eye aria-hidden size={18} /> : <EyeOff aria-hidden size={18} />}
      <span className="sr-only sm:not-sr-only">{hidden ? "Mostrar valores" : "Ocultar valores"}</span>
    </button>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem("tostao-theme");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a per-viewer preference after hydration
      if (t === "light" || t === "dark") setTheme(t);
    } catch {
      /* ignore */
    }
  }, []);
  const apply = (t: "system" | "light" | "dark") => {
    setTheme(t);
    try {
      if (t === "system") localStorage.removeItem("tostao-theme");
      else localStorage.setItem("tostao-theme", t);
    } catch {
      /* ignore */
    }
    const root = document.documentElement;
    if (t === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", t);
  };
  const opts = [
    { v: "system" as const, label: "Sistema", icon: SunMoon },
    { v: "light" as const, label: "Claro", icon: Sun },
    { v: "dark" as const, label: "Escuro", icon: Moon },
  ];
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="mb-2 text-sm font-medium">Tema</legend>
      {opts.map(({ v, label, icon: Icon }) => (
        <label key={v} className={cx("flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors", theme === v ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface hover:border-border-strong")}>
          <input type="radio" name="theme" value={v} checked={theme === v} onChange={() => apply(v)} className="size-4 accent-[var(--primary)]" />
          <Icon aria-hidden size={16} />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Change against a previous period. Arrow plus signed percent, green when the direction is good for the person and red
 * when it is not. Hidden values show only a mask: color and arrow would reveal the direction.
 */
export function DeltaChip({ bp, goodWhen, caption }: { bp: number | null; goodWhen: "up" | "down"; caption?: ReactNode }) {
  const { hidden } = useContext(PrivacyCtx);
  const neutral = "bg-surface-3 text-muted";
  let body: ReactNode;
  let tone = neutral;
  if (bp === null) body = "sem base de comparação";
  else if (hidden) body = <span aria-label="variação oculta">••%</span>;
  else {
    const Icon = bp === 0 ? Minus : bp > 0 ? TrendingUp : TrendingDown;
    if (bp !== 0) tone = (bp > 0) === (goodWhen === "up") ? "bg-positive-soft text-positive" : "bg-risk-soft text-risk";
    body = (
      <>
        <Icon aria-hidden size={14} strokeWidth={2.4} />
        {formatBasisPoints(bp)}
      </>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className={cx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-meta font-semibold tabular-nums", tone)}>{body}</span>
      {caption ? <span className="text-muted">{caption}</span> : null}
    </span>
  );
}
