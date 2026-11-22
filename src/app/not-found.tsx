import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";
import { Logo } from "@/components/logo";

export const metadata: Metadata = { title: "Página não encontrada" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-10">
      <Logo />
      <h1 className="text-2xl font-semibold tracking-tight">Página não encontrada</h1>
      <p className="text-sm text-muted">O endereço pode estar errado, ou este item foi excluído.</p>
      <div>
        <ButtonLink href="/inicio">Voltar para o início</ButtonLink>
      </div>
    </main>
  );
}
