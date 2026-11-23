import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { Logo } from "@/components/logo";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await currentUser()) redirect("/inicio");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      {/* The banknote of the landing page, small: deep green, a quiet guilloché, the coin. Decorative only. */}
      <div className="relative mb-6 overflow-hidden rounded-3xl bg-hero px-6 py-7 text-hero-fg">
        {/* eslint-disable-next-line @next/next/no-img-element -- decorative SVG, already the right size */}
        <img src="/landing/guilloche.svg" alt="" aria-hidden width={920} height={920} decoding="async" className="pointer-events-none absolute -right-40 -top-24 w-[26rem] max-w-none opacity-80" />
        <div className="relative flex flex-col gap-3">
          <Logo />
          <p className="max-w-[18rem] text-lg font-semibold leading-snug tracking-tight">Seu dinheiro, com a prova de cada número.</p>
          <p className="text-sm text-hero-muted">Nunca pedimos a senha do seu banco.</p>
        </div>
      </div>
      {children}
      <footer className="mt-8 flex flex-wrap gap-x-4 gap-y-2 text-meta text-muted">
        <Link className="underline underline-offset-2" href="/">Sobre o Cruzado</Link>
        <a className="underline underline-offset-2" href="/privacidade">Privacidade (rascunho)</a>
        <a className="underline underline-offset-2" href="/termos">Termos (rascunho)</a>
        <span>Licença Apache-2.0</span>
      </footer>
    </main>
  );
}
