// The landing page at "/": a static Server Component. Only five small islands run in the browser: the phone tilt,
// the bill story, the chat, the light on the feature tiles and the pause button. Every amount and name is invented (content.ts).
import Image from "next/image";
import Link from "next/link";
import { Bell, Eye, FileUp, KeyRound, Landmark, Lock, Plug, Plus, Trash2 } from "lucide-react";
import { Logo } from "@/components/logo";
import shot from "./img/inicio-celular.png";
import { BentoGlow } from "./bento-glow";
import { BillStory } from "./bill-story";
import { ChatDemo } from "./chat-demo";
import { ARCHITECTURE_URL, DEMO_URL, FAQ, GITHUB_PROFILE_URL, LINKEDIN_URL, README_URL, REPO_URL, SCREENS, TESTS, WHY } from "./content";
import { MotionToggle } from "./motion-toggle";
import { Tilt } from "./tilt";

const HEADLINE = "Seu dinheiro, com a prova de cada número.";
const MICROPRINT = "CRUZADO SOMENTE LEITURA CADA NÚMERO COM A PROVA ".repeat(14);
const TOTAL_TESTS = TESTS.unitAndIntegration + TESTS.endToEnd;

const STACK = ["Next.js 16", "React 19", "TypeScript", "PostgreSQL", "PGlite", "Drizzle ORM", "Zod", "Tailwind CSS 4", "Motion", "Vitest", "Playwright", "Vercel", "Open Finance (Pluggy)", "Model Context Protocol"];

function Coin({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden focusable="false">
      <circle cx="16" cy="16" r="15" fill="#123524" />
      <circle cx="16" cy="16" r="11.5" fill="#c6f36a" />
      <path d="M20.3 12.4A5.6 5.6 0 1 0 20.3 19.6" fill="none" stroke="#123524" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  );
}

function Rosette({ priority = false }: { priority?: boolean }) {
  return (
    <div className="lp-note-bg" aria-hidden>
      <div className="lp-aurora" />
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative SVG, already the right size */}
      <img className="lp-rosette" src="/landing/guilloche.svg" alt="" width={920} height={920} decoding="async" loading={priority ? "eager" : "lazy"} />
    </div>
  );
}

function Count({ to, from = 0, digits, suffix = "" }: { to: number; from?: number; digits: number; suffix?: string }) {
  return <span className="lp-count" aria-hidden style={{ "--to": to, "--from": from, "--digits": digits, "--suffix": JSON.stringify(suffix) } as React.CSSProperties} />;
}

function Hero() {
  const words = HEADLINE.split(" ");
  return (
    <section className="lp-hero" aria-labelledby="hero-title">
      <div className="lp-note" data-tilt-area>
        <Rosette priority />
        <div className="lp-hero-grid">
          <div className="lp-hero-copy">
            <h1 id="hero-title" className="lp-display">
              {words.map((w, i) => (
                <span key={i}>
                  <span className="lp-word" style={{ "--i": i } as React.CSSProperties}>
                    {w}
                  </span>
                  {i < words.length - 1 ? " " : null}
                </span>
              ))}
            </h1>
            <p className="lp-lead">
              O Cruzado lê suas contas e cartões pelo Open Finance, confere cada fatura com o banco e responde suas perguntas em português. Só
              leitura: não movimenta dinheiro e nunca vê a senha do banco.
            </p>
            <div className="lp-actions">
              <a className="lp-btn lp-btn-primary" href={DEMO_URL}>
                <Coin className="lp-coin" />
                Ver demonstração
              </a>
              <a className="lp-btn lp-btn-ghost" href={REPO_URL}>
                Ver no GitHub
              </a>
            </div>
            <p className="lp-hero-note">A demonstração usa dados de exemplo. Sem cadastro, e nada do que você fizer lá é salvo.</p>
          </div>
          <div className="lp-phone-stage">
            <Tilt>
              <div className="lp-phone-float">
                <div className="lp-phone">
                  <div className="lp-phone-screen">
                    <Image
                      src={shot}
                      alt="Tela inicial do Cruzado no celular, com dados de exemplo: saldo disponível, cartões em aberto e pontos de atenção do mês."
                      sizes="(min-width: 900px) 280px, 260px"
                      priority
                      placeholder="empty"
                    />
                  </div>
                </div>
              </div>
            </Tilt>
          </div>
        </div>
        <div className="lp-wrap" style={{ paddingBottom: "3.5rem", maxWidth: "var(--lp-max)" }}>
          <div className="lp-stats">
            <p className="lp-stat">
              <span className="lp-stat-value">
                <Count to={0} from={9} digits={1} />
              </span>
              <span className="lp-stat-label">
                <span className="sr-only">0 </span>senhas de banco guardadas
              </span>
            </p>
            <p className="lp-stat">
              <span className="lp-stat-value">
                <Count to={100} digits={4} suffix="%" />
              </span>
              <span className="lp-stat-label">
                <span className="sr-only">100% </span>só leitura: nenhum Pix, pagamento ou transferência
              </span>
            </p>
            <p className="lp-stat">
              <span className="lp-stat-value">Ao centavo</span>
              <span className="lp-stat-label">cada fatura conferida com o total que o banco informou</span>
            </p>
          </div>
        </div>
        <p className="lp-microprint" aria-hidden>
          {MICROPRINT}
        </p>
        <MotionToggle />
      </div>
    </section>
  );
}

function BillSection() {
  return (
    <section className="lp-section" aria-labelledby="fatura-title">
      <div className="lp-wrap">
        <div className="lp-section-head lp-reveal">
          <h2 id="fatura-title" className="lp-h2">
            A fatura que bate com o banco
          </h2>
          <p className="lp-body">
            Somar compras é fácil. Difícil é chegar ao mesmo total que o banco: estornos, parcelas, pendentes que nunca são cobrados.
            O Cruzado confere lançamento por lançamento e mostra a conta inteira.
          </p>
        </div>
        <BillStory />
      </div>
    </section>
  );
}

function ChatSection() {
  return (
    <section className="lp-section" aria-labelledby="chat-title" style={{ background: "var(--surface-2)" }}>
      <div className="lp-wrap lp-chat-grid">
        <div className="lp-section-head lp-reveal" style={{ marginBottom: 0 }}>
          <h2 id="chat-title" className="lp-h2">
            Pergunte em português. Receba a conta e a prova.
          </h2>
          <p className="lp-body">
            A inteligência artificial entende a pergunta e escolhe a consulta. Quem calcula é o próprio app, em centavos. Cada resposta vem com o
            período, os filtros e as transações usadas, para você conferir.
          </p>
        </div>
        <ChatDemo />
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="lp-section" aria-labelledby="recursos-title">
      <div className="lp-wrap">
        <div className="lp-section-head lp-reveal">
          <h2 id="recursos-title" className="lp-h2">
            O que mais ele faz por você
          </h2>
        </div>
        <BentoGlow className="lp-bento">
          <article className="lp-tile lp-tile-agents">
            <span className="lp-glow" aria-hidden />
            <h3 className="lp-h3">Avisos automáticos</h3>
            <p className="lp-body">
              Limite de gasto no dia, resumo da semana, cobrança que parece duplicada e comparação com o mês anterior. Você cria um aviso
              escrevendo o que quer, e ele só começa depois que você confirma.
            </p>
            <div className="lp-tile-art">
              <div className="lp-toast">
                <Bell className="lp-bell" size={22} aria-hidden />
                <p>
                  <strong>Gastei mais de R$ 250 no dia</strong>
                  <span>Hoje foram R$ 287,40 em 4 compras.</span>
                </p>
              </div>
              <div className="lp-toast">
                <Bell className="lp-bell" size={22} aria-hidden />
                <p>
                  <strong>Cobranças duplicadas</strong>
                  <span>Restaurante Sabor Caseiro cobrou R$ 87,53 duas vezes, em dias seguidos.</span>
                </p>
              </div>
            </div>
          </article>

          <article className="lp-tile lp-tile-bank">
            <span className="lp-glow" aria-hidden />
            <Landmark size={26} aria-hidden style={{ color: "var(--primary)" }} />
            <h3 className="lp-h3">Open Finance, só leitura</h3>
            <p className="lp-body">Contas, saldos, cartões e faturas chegam pelo Open Finance. A permissão é só de leitura e você pode revogar quando quiser.</p>
            <div className="lp-tile-art lp-sync">
              <p className="lp-sync-row">
                <span>Banco Aurora (fictício)</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
                  <span className="lp-pulse" aria-hidden />
                  Atualizado
                </span>
              </p>
              <p className="lp-sync-row">
                <span>Ipê Cartões (fictício)</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
                  <span className="lp-pulse" aria-hidden />
                  Atualizado
                </span>
              </p>
              <p className="lp-sync-row">
                <span>Permissão</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontWeight: 600 }}>
                  <Lock size={14} aria-hidden />
                  Somente leitura
                </span>
              </p>
            </div>
          </article>

          <article className="lp-tile lp-tile-import">
            <span className="lp-glow" aria-hidden />
            <FileUp size={26} aria-hidden style={{ color: "var(--primary)" }} />
            <h3 className="lp-h3">Extratos em CSV e OFX</h3>
            <p className="lp-body">Sem Open Finance, importe o arquivo do banco. Você vê a prévia antes, e lançamentos repetidos não entram duas vezes.</p>
            <div className="lp-tile-art lp-files">
              <span className="lp-file">extrato-outubro.ofx</span>
              <span className="lp-file">fatura-ipe.csv</span>
            </div>
          </article>

          <article className="lp-tile lp-tile-hide">
            <span className="lp-glow" aria-hidden />
            <Eye size={26} aria-hidden style={{ color: "var(--primary)" }} />
            <h3 className="lp-h3">Ocultar valores</h3>
            <p className="lp-body">Um toque esconde os valores em todo o app, para abrir suas finanças em público sem mostrar quanto tem.</p>
            <div className="lp-tile-art lp-hide" aria-hidden>
              <span className="lp-hide-value lp-hide-sharp">R$ 12.840,17</span>
              <span className="lp-hide-value lp-hide-blur">R$ 12.840,17</span>
            </div>
          </article>

          <article className="lp-tile lp-tile-mcp">
            <span className="lp-glow" aria-hidden />
            <Plug size={26} aria-hidden style={{ color: "var(--primary)" }} />
            <h3 className="lp-h3">Seus dados no Claude</h3>
            <p className="lp-body">Pelo MCP, o Claude Code ou o Claude Desktop consultam suas finanças com um token só de leitura, que você revoga quando quiser.</p>
            <p className="lp-tile-art lp-code">Quanto gastei com assinaturas este mês?</p>
          </article>
        </BentoGlow>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { title: "Traga seus dados", text: "Conecte contas e cartões pelo Open Finance, ou importe extratos em CSV e OFX." },
    { title: "O Cruzado organiza e confere", text: "Categoriza, calibra o ciclo de cada cartão e confere as faturas com o total do banco." },
    { title: "Pergunte e receba avisos", text: "Converse sobre seus gastos e receba um aviso quando algo foge do normal." },
  ];
  return (
    <section className="lp-section" aria-labelledby="como-title" style={{ paddingTop: 0 }}>
      <div className="lp-wrap">
        <div className="lp-section-head lp-reveal">
          <h2 id="como-title" className="lp-h2">
            Como funciona
          </h2>
        </div>
        <div className="lp-steps-box">
          <span className="lp-steps-rail" aria-hidden />
          <span className="lp-steps-line" aria-hidden />
          <ol className="lp-steps">
            {steps.map((s, i) => (
              <li key={s.title} className="lp-step">
                <span className="lp-step-n" aria-hidden>
                  {i + 1}
                </span>
                <h3 className="lp-h3">{s.title}</h3>
                <p className="lp-body">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Security() {
  const items = [
    { icon: Eye, title: "Só leitura", text: "Não faz Pix, pagamentos nem transferências. Não existe botão para isso em lugar nenhum." },
    { icon: KeyRound, title: "Nunca vê a senha do banco", text: "Você autoriza no ambiente do próprio banco. O Cruzado recebe só a permissão de leitura." },
    { icon: Lock, title: "Dados protegidos", text: "Conexões bancárias e segredos são guardados cifrados, e o acesso tem verificação em duas etapas." },
    { icon: Trash2, title: "Apague tudo quando quiser", text: "Exporte seus dados ou exclua a conta inteira, com todos os lançamentos, a qualquer momento." },
  ];
  return (
    <section className="lp-section" aria-labelledby="seguranca-title" style={{ background: "var(--surface-2)" }}>
      <div className="lp-wrap lp-safe-grid">
        <div className="lp-section-head" style={{ marginBottom: 0 }}>
          <svg className="lp-lock" viewBox="0 0 64 64" aria-hidden focusable="false">
            <path className="lp-lock-shackle" d="M20 30V21a12 12 0 0 1 24 0v9" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
            <g className="lp-lock-body">
              <rect x="12" y="28" width="40" height="30" rx="8" fill="currentColor" />
              <circle cx="32" cy="41" r="4" fill="var(--surface-2)" />
              <rect x="30.5" y="43" width="3" height="7" rx="1.5" fill="var(--surface-2)" />
            </g>
          </svg>
          <h2 id="seguranca-title" className="lp-h2">
            Seguro por desenho, explicado sem jargão
          </h2>
          <p className="lp-body">O Cruzado foi feito para olhar, nunca para mexer no seu dinheiro.</p>
        </div>
        <ul className="lp-safe-list">
          {items.map(({ icon: Icon, title, text }) => (
            <li key={title} className="lp-safe-item">
              <Icon size={22} aria-hidden style={{ color: "var(--primary)" }} />
              <h3 className="lp-h3">{title}</h3>
              <p className="lp-body">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ForDevs() {
  return (
    <section className="lp-section" aria-labelledby="devs-title">
      <div className="lp-wrap">
        <div className="lp-dev lp-reveal">
          <div style={{ display: "grid", gap: "1.25rem", alignContent: "start" }}>
            <h2 id="devs-title" className="lp-h2">
              Para recrutadores e devs
            </h2>
            <p className="lp-body">
              Código aberto, com testes em cada camada. O modelo de IA nunca calcula: as contas são funções em TypeScript, em centavos inteiros,
              e cada número vem com a evidência.
            </p>
            <div className="lp-links">
              <a className="lp-link" href={REPO_URL}>
                Repositório no GitHub
              </a>
              <a className="lp-link" href={README_URL}>
                Ler o README
              </a>
              <a className="lp-link" href={ARCHITECTURE_URL}>
                Arquitetura
              </a>
            </div>
          </div>
          <div style={{ display: "grid", gap: "2rem", alignContent: "start" }}>
            <div className="lp-dev-numbers">
              <p className="lp-dev-number">
                <strong>
                  <Count to={TOTAL_TESTS} digits={3} />
                </strong>
                <span className="lp-body">
                  <span className="sr-only">{TOTAL_TESTS} </span>testes automatizados no total
                </span>
              </p>
              <p className="lp-dev-number">
                <strong>
                  <Count to={TESTS.unitAndIntegration} digits={3} />
                </strong>
                <span className="lp-body">
                  <span className="sr-only">{TESTS.unitAndIntegration} </span>testes de unidade e integração
                </span>
              </p>
              <p className="lp-dev-number">
                <strong>
                  <Count to={TESTS.endToEnd} digits={3} />
                </strong>
                <span className="lp-body">
                  <span className="sr-only">{TESTS.endToEnd} </span>testes de ponta a ponta, no celular e no computador
                </span>
              </p>
              <p className="lp-dev-number">
                <strong>
                  <Count to={SCREENS} digits={2} />
                </strong>
                <span className="lp-body">
                  <span className="sr-only">{SCREENS} </span>telas no app
                </span>
              </p>
            </div>
            <ul className="lp-pills" aria-label="Tecnologias">
              {STACK.map((s) => (
                <li key={s} className="lp-pill">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function WhyI() {
  return (
    <section className="lp-section lp-why" aria-labelledby="porque-title">
      <div className="lp-wrap lp-why-grid">
        <h2 id="porque-title" className="lp-h2">
          Por que eu criei o Cruzado
        </h2>
        <div className="lp-why-text">
          {WHY.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
          <p className="lp-why-sign">
            <Coin className="lp-why-coin" />
            Vinicius Silva
          </p>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section className="lp-section" aria-labelledby="faq-title">
      <div className="lp-wrap lp-faq-grid">
        <h2 id="faq-title" className="lp-h2">
          Perguntas frequentes
        </h2>
        <div className="lp-faq">
          {FAQ.map((item) => (
            <details key={item.q} className="lp-faq-item">
              <summary>
                <span>{item.q}</span>
                <Plus className="lp-faq-icon" size={20} aria-hidden />
              </summary>
              <p className="lp-body">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Invite() {
  return (
    <section id="convite" className="lp-final" aria-labelledby="final-title" style={{ paddingInline: "0.5rem" }}>
      <div className="lp-note" style={{ maxWidth: "82rem", marginInline: "auto" }}>
        <Rosette />
        <div className="lp-final-inner">
          <h2 id="final-title" className="lp-h2">
            Quer usar o Cruzado?
          </h2>
          <p className="lp-lead" style={{ color: "var(--lp-note-muted)" }}>
            Por enquanto, o Cruzado é usado só por convite. Me chame no LinkedIn e conte um pouco de como você organiza suas finanças hoje.
          </p>
          <div className="lp-actions" style={{ justifyContent: "center" }}>
            <a className="lp-btn lp-btn-primary" href={LINKEDIN_URL}>
              <Coin className="lp-coin" />
              Pedir convite no LinkedIn
            </a>
            <a className="lp-btn lp-btn-ghost" href={DEMO_URL}>
              Ver demonstração
            </a>
          </div>
          <p className="lp-hero-note">Sem formulário: a conversa é pelo LinkedIn, e nada é guardado nesta página.</p>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="lp-wrap lp-footer">
      <div style={{ display: "grid", gap: "0.75rem" }}>
        <Logo />
        <p className="lp-body lp-small">
          Feito por Vinicius Silva. <a href={LINKEDIN_URL}>LinkedIn</a> <a href={GITHUB_PROFILE_URL}>GitHub</a>
        </p>
        <p className="lp-body lp-small">Código aberto sob a licença Apache-2.0. O nome vem do Cruzado, a moeda brasileira de 1986.</p>
      </div>
      <nav aria-label="Rodapé">
        <a href="/privacidade">Privacidade (rascunho)</a>
        <a href="/termos">Termos (rascunho)</a>
        <a href="/entrar">Entrar</a>
      </nav>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className="lp">
      <div className="lp-progress" aria-hidden />
      <a href="#conteudo" className="sr-only-focusable lp-link" style={{ position: "absolute", left: "1rem", top: "0.5rem", zIndex: 60 }}>
        Pular para o conteúdo
      </a>
      <header className="lp-wrap lp-header">
        <Link href="/" aria-label="Cruzado, página inicial" style={{ display: "inline-flex", minHeight: "2.75rem", alignItems: "center" }}>
          <Logo />
        </Link>
        <nav className="lp-nav" aria-label="Principal">
          <a className="lp-nav-wide" href={DEMO_URL}>
            Demonstração
          </a>
          <a className="lp-nav-wide" href={REPO_URL}>
            GitHub
          </a>
          <a href="#convite">Quero usar</a>
          <a className="lp-nav-login" href="/entrar">
            Entrar
          </a>
        </nav>
      </header>
      <main id="conteudo">
        <Hero />
        <BillSection />
        <WhyI />
        <ChatSection />
        <Features />
        <HowItWorks />
        <Security />
        <Faq />
        <ForDevs />
        <Invite />
      </main>
      <Footer />
    </div>
  );
}
