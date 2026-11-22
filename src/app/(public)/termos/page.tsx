import type { Metadata } from "next";
import { Notice } from "@/components/ui";

export const metadata: Metadata = { title: "Termos de uso (rascunho)" };

export default function TermsPage() {
  return (
    <>
      <h1>Termos de uso — rascunho</h1>
      <Notice tone="attention" title="Rascunho para revisão jurídica">
        Texto-modelo sem revisão de advogado. Não representa autorização do Banco Central, certificação ou vínculo com instituição financeira.
      </Notice>
      <h2>O que é o Cruzado</h2>
      <p>Software open source (Apache-2.0) para organizar e consultar dados financeiros pessoais. Ele nunca movimenta dinheiro: bancos são apenas lidos, e os lançamentos que você cria existem só dentro do Cruzado. A instância é operada por quem a hospeda.</p>
      <h2>Limites</h2>
      <ul>
        <li>Não é consultoria financeira, recomendação de investimento, análise de crédito ou promessa de resultado.</li>
        <li>Os números vêm dos dados importados; extratos e faturas oficiais prevalecem.</li>
        <li>Alertas de duplicidade são suspeitas para conferência, não confirmação de fraude.</li>
        <li>Bancos não são conectados diretamente. Quando disponível nesta instância, a leitura por Open Finance passa por um provedor terceiro (Pluggy), com a sua autorização, e segue os termos dele.</li>
        <li>O registro de lançamentos por mensagem depende de serviços de terceiros e do modelo de IA usado; confira o que foi lançado.</li>
      </ul>
      <h2>Responsabilidades</h2>
      <p>Você é responsável pelos arquivos que importa e pela guarda das suas credenciais de acesso e tokens MCP.</p>
    </>
  );
}
