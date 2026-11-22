import next from "eslint-config-next";

const config = [
  { ignores: [".next/**", ".next-old-*/**", ".claude/**", "node_modules/**", ".tools/**", ".data/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
  ...next,
];

export default config;
