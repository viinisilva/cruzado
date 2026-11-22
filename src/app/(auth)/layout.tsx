import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { Logo } from "@/components/logo";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await currentUser()) redirect("/inicio");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-start gap-3">
        <Logo />
        <p className="text-sm text-muted">Organize suas finanças e converse com seus dados. Nunca pedimos a senha do seu banco.</p>
      </div>
      {children}
      <footer className="mt-8 flex flex-wrap gap-x-4 gap-y-2 text-meta text-muted">
        <a className="underline underline-offset-2" href="/privacidade">Privacidade (rascunho)</a>
        <a className="underline underline-offset-2" href="/termos">Termos (rascunho)</a>
        <span>Licença Apache-2.0</span>
      </footer>
    </main>
  );
}
