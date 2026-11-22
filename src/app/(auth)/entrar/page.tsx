import type { Metadata } from "next";
import { demoOpen, signupOpen } from "@/lib/auth/access";
import { publicDemoUrl } from "@/lib/demo/instance-env";
import { ButtonLink, Card, Notice } from "@/components/ui";
import { DemoButton, LoginForm } from "../forms";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const demoUrl = publicDemoUrl();
  return (
    <div className="flex flex-col gap-4">
      {sp["conta-excluida"] ? <Notice tone="positive">Sua conta e todos os seus dados foram excluídos.</Notice> : null}
      {sp.erro === "limite" ? <Notice tone="attention">Muitas contas de demonstração criadas em pouco tempo. Tente de novo em alguns minutos.</Notice> : null}
      <Card>
        <h1 className="mb-4 text-xl font-semibold">Entrar</h1>
        <LoginForm canSignup={signupOpen()} />
      </Card>
      {demoUrl ? (
        <Card>
          <h2 className="mb-1 font-semibold">Só quer conhecer?</h2>
          <p className="mb-3 text-sm text-muted">Veja o Cruzado funcionando com dados de exemplo. Sem cadastro.</p>
          <ButtonLink href={demoUrl} variant="secondary">
            Ver demonstração
          </ButtonLink>
        </Card>
      ) : demoOpen() ? (
        <Card>
          <h2 className="mb-1 font-semibold">Só quer conhecer?</h2>
          <p className="mb-3 text-sm text-muted">Cria uma conta temporária com três meses de dados fictícios. Não precisa de chave de IA.</p>
          <DemoButton />
        </Card>
      ) : null}
    </div>
  );
}
