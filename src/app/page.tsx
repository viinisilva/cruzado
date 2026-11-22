// "/" is the landing page: static, with no database and no session on the server. The app's login stays at /entrar, which
// sends anyone already signed in straight to /inicio. The public demonstration never reaches this page: its build
// redirects "/" to its own opening screen (next.config.ts).
import type { Metadata } from "next";
import "@/components/landing/landing.css";
import { LandingPage } from "@/components/landing/landing-page";

export const dynamic = "force-static";

const TITLE = "Cruzado: seu dinheiro, com a prova de cada número";
const DESCRIPTION =
  "Agente de finanças pessoais somente leitura e de código aberto. Lê contas e cartões pelo Open Finance, confere cada fatura com o banco e responde em português, com a evidência de cada número.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  // The rest of the app stays out of search engines (layout.tsx); this page is meant to be found.
  robots: { index: true, follow: true },
  openGraph: { type: "website", locale: "pt_BR", siteName: "Cruzado", title: TITLE, description: DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function Home() {
  return <LandingPage />;
}
