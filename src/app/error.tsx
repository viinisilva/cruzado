"use client";
import { Button, ButtonLink } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Algo deu errado</h1>
      <p className="text-sm text-muted">Não foi culpa sua, e seus dados não foram alterados. Tente de novo em alguns segundos.</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={reset}>Tentar de novo</Button>
        <ButtonLink href="/inicio" variant="secondary">
          Voltar para o início
        </ButtonLink>
      </div>
      {error.digest ? <p className="text-meta text-muted">Código do erro: {error.digest}</p> : null}
    </main>
  );
}
