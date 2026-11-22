import type { Metadata } from "next";
import { Notice } from "@/components/ui";

export const metadata: Metadata = { title: "Política de privacidade (rascunho)" };

export default function PrivacyPage() {
  return (
    <>
      <h1>Política de privacidade — rascunho</h1>
      <Notice tone="attention" title="Rascunho para revisão jurídica">
        Este texto é um ponto de partida para quem hospeda o Cruzado. Ele não foi revisado por advogado e não declara conformidade com a LGPD ou com qualquer norma. Quem opera a instância é o controlador dos dados e deve adaptá-lo.
      </Notice>
      <h2>O que guardamos</h2>
      <ul>
        <li>Conta: nome, e-mail e hash da senha (scrypt). Nunca a senha em texto. Se você ativar a verificação em duas etapas, a chave fica cifrada.</li>
        <li>Dados financeiros que você importa, cadastra ou conecta: contas, cartões, categorias, transações, agentes, alertas e conversas. Descrições podem conter nomes de terceiros, como remetentes de Pix.</li>
        <li>Conexão bancária, se usada: identificador do Pluggy, cifrado, e a validade da autorização. Números de conta não são guardados.</li>
        <li>Importações: nome do arquivo, data, quantidade de linhas e o hash SHA-256 do arquivo. O arquivo em si não é guardado.</li>
        <li>Eventos de auditoria com metadados (tipo de ação, ids, contagens), sem valores nem descrições.</li>
      </ul>
      <h2>O que não fazemos</h2>
      <ul>
        <li>Não pedimos nem guardamos senhas de banco.</li>
        <li>Não movimentamos dinheiro, não fazemos Pix, pagamentos ou transferências.</li>
        <li>Não vendemos dados nem usamos telemetria de terceiros.</li>
      </ul>
      <h2>Inteligência artificial</h2>
      <p>
        No modo padrão (demonstração) nada sai do servidor. Se a instância usar um provedor externo (por exemplo, Anthropic), o chat só funciona depois do seu consentimento explícito e envia apenas a pergunta, nomes de contas e categorias e os resultados das ferramentas necessárias. Com Ollama local os dados ficam na sua infraestrutura.
      </p>
      <h2>Terceiros</h2>
      <p>
        O site roda na Vercel e os dados ficam no Neon. Se você conectar um banco, o Pluggy trata esses dados. Se usar um cliente MCP ou o agente de WhatsApp, o que você envia ou consulta passa pelo WhatsApp e pelo provedor de modelo desse cliente, nos termos de cada um.
      </p>
      <h2>Seus direitos</h2>
      <ul>
        <li>Exportar todos os seus dados em JSON, em Configurações.</li>
        <li>Excluir a conta: apaga todos os dados financeiros; a trilha de auditoria fica anonimizada.</li>
        <li>Revogar tokens MCP, conexões bancárias e o consentimento de IA a qualquer momento.</li>
      </ul>
    </>
  );
}
