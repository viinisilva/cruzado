import { isDemoInstance } from "@/lib/demo/instance-env";

// Shown while a page loads: the database can take a moment to wake up after being idle. In the public demonstration the
// first visit also builds the invented data, so the wait gets words instead of a blank screen.
export default function Loading() {
  const demo = isDemoInstance();
  return (
    <div role="status" aria-label={demo ? undefined : "Carregando"} className="flex flex-col gap-4">
      {demo ? <p className="text-base font-medium text-muted">Preparando a demonstração…</p> : null}
      <div className="skeleton h-8 w-48" />
      <div className="skeleton h-36 w-full" />
      <div className="skeleton h-56 w-full" />
    </div>
  );
}
