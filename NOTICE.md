# NOTICE

Cruzado — agente de finanças pessoais open source
Copyright 2026 os contribuidores do Cruzado

Este produto é licenciado sob a Apache License 2.0 (veja `LICENSE`).

## Independência

O Cruzado é uma implementação independente. Ele se inspira apenas em padrões funcionais publicamente observáveis de produtos de finanças pessoais (leitura consolidada, perguntas em linguagem natural, ferramentas determinísticas, agentes que geram alertas). Nenhum código, marca, nome, mascote, texto, imagem, layout ou identidade visual de terceiros (incluindo o Pierre) foi copiado. Nome, logotipo e textos são originais deste projeto.

Não há afiliação com o Banco Central do Brasil, com a estrutura do Open Finance Brasil, com instituições financeiras ou com provedores de IA. Nenhuma certificação, autorização regulatória ou conformidade é declarada.

## Componentes de terceiros

O projeto depende de pacotes open source distribuídos sob suas próprias licenças; a lista completa, gerada a partir do `package-lock.json`, está em `THIRD_PARTY_LICENSES.md`. Destaques:

- Next.js, React, Drizzle ORM, Zod, PapaParse, node-postgres, lucide-react (MIT/ISC)
- PGlite (Apache-2.0 / PostgreSQL License)
- Model Context Protocol TypeScript SDK (MIT)
- Anthropic TypeScript SDK (MIT)
- IBM Plex Sans (SIL Open Font License 1.1), via @fontsource/ibm-plex-sans
- sharp / libvips (Apache-2.0 / LGPL-3.0-or-later): binários pré-compilados instalados como dependência opcional do Next.js para otimização de imagens, carregados dinamicamente e não modificados. O Cruzado não usa `next/image`.

Os dados de demonstração (nomes, instituições, estabelecimentos e valores) são fictícios.
