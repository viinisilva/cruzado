// The app's destinations, shared by the navigation (client.tsx) and the "Mais" page, which is a Server Component.
import { ArrowLeftRight, Bell, BellRing, CreditCard, Home, MessageCircle, PieChart, Repeat, Settings, Wallet } from "lucide-react";

/**
 * One navigation for the whole app, the same on a phone and on a computer: four places people go every day, and "Mais"
 * for the rest. On a phone it is the bottom bar; on a computer the sidebar shows the same four and lists "Mais" open.
 * Big labels, no abbreviations, nothing repeated in tabs at the top of the page.
 */
export const NAV = [
  { href: "/inicio", label: "Início", icon: Home },
  { href: "/transacoes", label: "Transações", icon: ArrowLeftRight },
  { href: "/cartoes", label: "Cartões", icon: CreditCard },
  { href: "/chat", label: "Perguntar", icon: MessageCircle },
] as const;

/** What "Mais" holds. Also the sidebar's second group. */
export const MORE = [
  { href: "/agentes", label: "Meus avisos", description: "As regras que você escolhe: do que quer ser avisado", icon: BellRing },
  { href: "/alertas", label: "Notificações", description: "O que os seus avisos já encontraram", icon: Bell },
  { href: "/contas", label: "Contas", description: "Saldos e origem de cada conta", icon: Wallet },
  { href: "/categorias", label: "Categorias", description: "Para onde vai o dinheiro", icon: PieChart },
  { href: "/recorrentes", label: "Recorrentes", description: "Assinaturas e contas do mês", icon: Repeat },
  { href: "/configuracoes", label: "Configurações", description: "Conta, segurança e integrações", icon: Settings },
] as const;

