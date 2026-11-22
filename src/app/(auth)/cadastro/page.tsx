import type { Metadata } from "next";
import { signupOpen } from "@/lib/auth/access";
import { Card, Notice } from "@/components/ui";
import { SignupForm } from "../forms";

export const metadata: Metadata = { title: "Criar conta" };

export default function SignupPage() {
  if (!signupOpen()) return <Notice tone="info" title="Cadastro fechado">Esta instância não aceita novas contas.</Notice>;
  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold">Criar conta</h1>
      <p className="mb-4 text-sm text-muted">Nenhuma senha de banco é pedida ou guardada. Você importa extratos ou cadastra lançamentos.</p>
      <SignupForm />
    </Card>
  );
}
