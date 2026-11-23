// Small accessible primitives. Touch targets ≥ 44px, visible focus, real labels.
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const btn = {
  primary: "bg-primary text-primary-fg shadow-card hover:bg-primary-hover",
  secondary: "bg-surface text-text border border-border shadow-card hover:border-border-strong hover:bg-surface-2",
  ghost: "text-text hover:bg-surface-3",
  danger: "bg-surface text-risk border border-risk/70 hover:bg-risk-soft",
};
const btnBase = "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl font-semibold transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0";
const btnSize = { md: "px-4 text-[0.9375rem]", sm: "px-3 text-sm", lg: "min-h-12 px-5 text-base" };

type BtnProps = ComponentProps<"button"> & { variant?: keyof typeof btn; size?: keyof typeof btnSize };

export function Button({ variant = "primary", size = "md", className, ...props }: BtnProps) {
  return <button {...props} className={cx(btnBase, btnSize[size], btn[variant], className)} />;
}

export function ButtonLink({ variant = "primary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: keyof typeof btn; size?: keyof typeof btnSize }) {
  return <Link {...props} className={cx(btnBase, btnSize[size], btn[variant], className)} />;
}

/** Text link styled for actions inside cards ("Ver todas", "Editar"): same 44px target as a button. */
export const linkCls = "inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline";

export function Card({ className, children, ...props }: ComponentProps<"section">) {
  return (
    <section {...props} className={cx("rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6", className)}>
      {children}
    </section>
  );
}

/** A filter that is a link, so its state lives in the URL and works without JavaScript. */
export function ChipLink({ href, active, children, scroll = false }: { href: string; active?: boolean; children: ReactNode; scroll?: boolean }) {
  return (
    <Link
      href={href}
      scroll={scroll}
      aria-current={active ? "true" : undefined}
      className={cx(
        "inline-flex min-h-11 max-w-full shrink-0 items-center justify-center rounded-full border px-4 text-sm font-medium transition-colors",
        active ? "border-primary/50 bg-primary-soft font-semibold text-primary" : "border-border bg-surface text-text hover:border-border-strong hover:bg-surface-2",
      )}
    >
      {children}
    </Link>
  );
}

/**
 * The card every number lives in: a short label, a large figure with a qualifier beside it, an optional change badge,
 * then the detail. The label is the region's heading, so screen readers announce what the figure is.
 */
export function MetricCard({
  id,
  label,
  value,
  qualifier,
  delta,
  action,
  children,
  className,
  glow,
  size = "md",
  testId,
}: {
  id: string;
  label: ReactNode;
  value: ReactNode;
  qualifier?: ReactNode;
  delta?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  glow?: boolean;
  size?: "md" | "lg";
  testId?: string;
}) {
  return (
    <section aria-labelledby={id} className={cx("flex min-w-0 flex-col rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6", glow && "card-glow", className)}>
      <div className="flex items-start justify-between gap-3">
        <h2 id={id} className="text-sm font-medium text-muted">{label}</h2>
        {action ? <div className="-my-2.5 shrink-0">{action}</div> : null}
      </div>
      <p className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span data-testid={testId} className={cx("break-words font-semibold leading-tight tracking-tight tabular-nums", size === "lg" ? "text-[2.25rem] sm:text-[2.75rem]" : "text-[1.75rem] sm:text-[2rem]")}>{value}</span>
        {qualifier ? <span className="text-sm text-muted">{qualifier}</span> : null}
      </p>
      {delta ? <div className="mt-2.5">{delta}</div> : null}
      {children ? <div className="mt-5 flex min-w-0 flex-1 flex-col">{children}</div> : null}
    </section>
  );
}

export function CardTitle({ children, action, id, description }: { children: ReactNode; action?: ReactNode; id?: string; description?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-semibold leading-7 tracking-tight">
          {children}
        </h2>
        {description ? <p className="mt-0.5 text-meta text-muted">{description}</p> : null}
      </div>
      {action ? <div className="-my-1.5 shrink-0">{action}</div> : null}
    </div>
  );
}

/** Section heading with an icon, used where a plain title would make long settings pages hard to scan. */
export function SectionHeading({ icon, title, description, id }: { icon: ReactNode; title: string; description?: string; id?: string }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">{icon}</span>
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-semibold leading-7 tracking-tight">
          {title}
        </h2>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
    </div>
  );
}

export function PageHeader({ title, description, action, children }: { title: string; description?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 lg:mb-8">
      <div className="min-w-0 max-w-3xl">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-[2rem]">{title}</h1>
        {description ? <p className="mt-1.5 text-base text-muted">{description}</p> : null}
        {children}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  );
}

/** A labelled figure. `tone` colors only the value; the label always says what it is, so color is never the only cue. */
export function Stat({ label, value, hint, tone, className, size = "md" }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "positive" | "risk"; className?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <div className={cx("min-w-0", className)}>
      <dt className="text-sm font-medium text-muted">{label}</dt>
      <dd className={cx("mt-1 break-words font-semibold tracking-tight tabular-nums", size === "lg" ? "text-[1.75rem] leading-9" : size === "md" ? "text-[1.375rem] leading-8" : "text-base leading-6 sm:text-[1.375rem] sm:leading-8", tone === "positive" && "text-positive", tone === "risk" && "text-risk")}>{value}</dd>
      {hint ? <dd className="mt-1 text-meta text-muted">{hint}</dd> : null}
    </div>
  );
}

const inputCls =
  "min-h-11 w-full rounded-xl border border-border-strong/70 bg-surface px-3.5 text-base text-text shadow-[inset_0_1px_1px_rgb(0_0_0/0.03)] transition-colors placeholder:text-muted hover:border-border-strong aria-[invalid=true]:border-risk sm:text-[0.9375rem]";

export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="text-meta text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-sm font-medium text-risk">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cx(inputCls, className)} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={cx(inputCls, "pr-8", className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(inputCls, "py-2.5", className)} />;
}

const tones = {
  info: "bg-primary-soft text-primary",
  positive: "bg-positive-soft text-positive",
  attention: "bg-attention-soft text-attention",
  risk: "bg-risk-soft text-risk",
  neutral: "bg-surface-3 text-muted",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-meta font-semibold", tones[tone])}>{children}</span>;
}

const noticeEdge = { info: "border-primary/40", positive: "border-positive/40", attention: "border-attention/40", risk: "border-risk/40", neutral: "border-border" };

export function Notice({ tone = "info", title, children }: { tone?: keyof typeof tones; title?: string; children: ReactNode }) {
  return (
    <div className={cx("rounded-xl border p-3.5 text-sm", tones[tone], noticeEdge[tone])} role={tone === "risk" ? "alert" : "note"}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={cx("text-text", title && "mt-0.5")}>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="relative isolate flex flex-col items-start gap-3 overflow-hidden rounded-2xl border border-dashed border-border-strong/60 bg-surface-2 p-6 sm:flex-row sm:items-center">
      {/* A corner of the landing page's guilloché, faint: the same identity in empty places. Decorative. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative SVG */}
      <img src="/landing/guilloche.svg" alt="" aria-hidden width={920} height={920} loading="lazy" decoding="async" className="pointer-events-none absolute -bottom-40 -right-36 -z-10 w-80 max-w-none opacity-35" />
      {icon ? <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-surface text-primary shadow-card">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold">{title}</p>
        {children ? <div className="mt-0.5 max-w-prose text-sm text-muted">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-risk/40 bg-risk-soft p-3 text-sm font-medium text-risk">
      {message}
    </p>
  );
}
