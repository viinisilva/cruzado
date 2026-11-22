// Original mark: a coin with a "C", for Cruzado. Not derived from any other brand. The coin is where the lime accent lives.
export function Logo({ withText = true }: { withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden focusable="false">
        <circle cx="16" cy="16" r="15" fill="var(--hero)" />
        <circle cx="16" cy="16" r="11.5" fill="var(--accent)" />
        <path d="M20.3 12.4A5.6 5.6 0 1 0 20.3 19.6" fill="none" stroke="var(--hero)" strokeWidth="2.8" strokeLinecap="round" />
      </svg>
      {withText ? <span className="text-xl font-semibold tracking-tight">Cruzado</span> : null}
    </span>
  );
}
