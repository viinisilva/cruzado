// Generates THIRD_PARTY_LICENSES.md from package-lock.json and fails on copyleft licenses in runtime deps.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type LockPkg = { version?: string; license?: string; dev?: boolean; optional?: boolean };
const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as { packages: Record<string, LockPkg> };
const direct = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

function licenseOf(key: string, pkg: LockPkg): string {
  if (pkg.license) return pkg.license;
  try {
    const pj = JSON.parse(readFileSync(path.join(key, "package.json"), "utf8")) as { license?: string | { type: string } };
    return typeof pj.license === "string" ? pj.license : (pj.license?.type ?? "UNKNOWN");
  } catch {
    return "UNKNOWN";
  }
}

const rows = Object.entries(lock.packages)
  .filter(([k]) => k.startsWith("node_modules/"))
  .map(([k, p]) => ({ name: k.split("node_modules/").pop()!, version: p.version ?? "", license: licenseOf(k, p), dev: Boolean(p.dev) }));

const uniq = new Map<string, (typeof rows)[number]>();
for (const r of rows) uniq.set(`${r.name}@${r.version}`, r);
const all = [...uniq.values()].sort((a, b) => a.name.localeCompare(b.name));
const runtime = all.filter((r) => !r.dev);
const dev = all.filter((r) => r.dev);
const COPYLEFT = /(^|[^L])GPL|AGPL|SSPL|EUPL|CC-BY-SA/i;
const flagged = runtime.filter((r) => COPYLEFT.test(r.license) && !/LGPL/.test(r.license));

const count = (list: typeof all) => {
  const m = new Map<string, number>();
  for (const r of list) m.set(r.license, (m.get(r.license) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => `| ${l} | ${n} |`).join("\n");
};

const table = (list: typeof all) => list.map((r) => `| ${r.name} | ${r.version} | ${r.license} |`).join("\n");

const md = `# Licenças de terceiros

Gerado por \`npm run licenses\` a partir do \`package-lock.json\`. Não edite à mão.

Dependências diretas de runtime: ${Object.keys(direct.dependencies).sort().join(", ")}.

Fontes: IBM Plex Sans (SIL Open Font License 1.1), empacotada por @fontsource/ibm-plex-sans. Ícones: lucide-react (ISC).

## Resumo — dependências de runtime (${runtime.length} pacotes)

| Licença | Pacotes |
| --- | --- |
${count(runtime)}

${flagged.length ? `**Atenção — licenças copyleft encontradas em runtime:** ${flagged.map((f) => `${f.name} (${f.license})`).join(", ")}` : "Nenhuma licença GPL/AGPL/SSPL em dependências de runtime."}

## Resumo — dependências de desenvolvimento (${dev.length} pacotes, não distribuídas na imagem)

| Licença | Pacotes |
| --- | --- |
${count(dev)}

## Lista completa — runtime

| Pacote | Versão | Licença |
| --- | --- | --- |
${table(runtime)}

## Lista completa — desenvolvimento

| Pacote | Versão | Licença |
| --- | --- | --- |
${table(dev)}
`;

writeFileSync("THIRD_PARTY_LICENSES.md", md);
console.log(`THIRD_PARTY_LICENSES.md: ${runtime.length} runtime, ${dev.length} dev.`);
if (flagged.length) {
  console.error("Licenças copyleft em runtime:", flagged.map((f) => `${f.name}@${f.version} ${f.license}`).join(", "));
  process.exit(1);
}
