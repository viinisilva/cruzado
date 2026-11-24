// Public copy of the code for GitHub (docs/USO_COMPARTILHADO.md, seção 2.4 e decisão 5).
//
//   npx tsx scripts/export-public.ts --check            only scans; prints file:line of every problem, writes nothing
//   npx tsx scripts/export-public.ts <pasta-de-destino>  scans, then writes the copy with a brand-new Git history
//   npx tsx scripts/export-public.ts --update <clone> [mensagem]
//                                                       scans, then replaces the files of a clean clone of the public
//                                                       repository and commits on top of its history (never pushes)
//
// Commits are signed by PUBLIC_AUTHOR, the anonymous GitHub address, never by `git config user.email`.
//
// The copy is taken from the last commit (HEAD), never from uncommitted files. It leaves out the private paths below
// and then refuses to write anything if what is left contains:
//   - an amount from the private corpus of real bills (tests/corpus), in any usual spelling;
//   - an entry of .private/denylist.txt (one per line, gitignored: names, e-mails, addresses you want kept out);
//   - the e-mail of `git config user.email`;
//   - something that looks like a secret (keys, tokens, connection strings with a password);
//   - any image, PDF or other binary file (screenshots can show real data and cannot be read by this check),
//     except the PNGs of docs/readme/, which are generated only from the public demo (cruzado-demo.vercel.app).
// Problems are reported by file and line, never by the value found, so the report itself can be shared.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Never in the public copy. Prefixes end with "/"; the rest are exact paths or simple * patterns. */
export const EXCLUDED = [
  "tests/corpus/",
  ".claude/",
  ".data/",
  ".private/",
  "docs/redesign/",
  "docs/hermes/",
  "docs/superpowers/",
  "docs/HANDOFF.md",
  "docs/DIAGNOSTICO_*",
  "docs/AUDITORIA_*",
  "docs/DEPLOY_*",
  "docs/AUTOCONCILIACAO.md",
  "docs/CALIBRACAO_CARTAO.md",
  "docs/BANCOS_*",
  // Lock file of the developer's Claude Code skills: says nothing about the app.
  "skills-lock.json",
  // Security review with open risks and pending manual steps, and the plan for guests with its pending items.
  "docs/SECURITY_REVIEW.md",
  "docs/USO_COMPARTILHADO.md",
  // Tests written from the owner's real bills (they keep their values locally, by decision 5).
  "tests/integration/card-bill-of.test.ts",
  "tests/integration/corpus.test.ts",
  "tests/unit/card-calibration.test.ts",
  "tests/unit/card-check.test.ts",
  "tests/unit/classify.test.ts",
  "tests/unit/reconciliation-report-elo.test.ts",
];

export function isExcluded(file: string): boolean {
  return EXCLUDED.some((p) => (p.endsWith("/") ? file.startsWith(p) : p.includes("*") ? new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(file) : file === p));
}

const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|otf|mp4|mov|sqlite|db)$/i;

/** Screenshots of the public demo, for the README (docs/readme/) and the landing page (src/components/landing/img/). Flat, PNG only. */
export function isReviewedImage(file: string): boolean {
  return /^(docs\/readme|src\/components\/landing\/img)\/[a-z0-9][a-z0-9-]*\.png$/.test(file);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const isPng = (buf: Buffer) => buf.subarray(0, 8).equals(PNG_SIGNATURE);

/** Author and committer of every public commit (the account's GitHub no-reply address). */
export const PUBLIC_AUTHOR = { name: "viinisilva", email: "142683452+viinisilva@users.noreply.github.com" };

export type Finding = { file: string; line: number; kind: string };

/** Every amount in the corpus, in cents. */
export function corpusAmounts(dir = path.join(ROOT, "tests/corpus/banks")): number[] {
  const out = new Set<number>();
  if (!existsSync(dir)) return [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === "number" && /^(amount|totalAmount|minimumPaymentAmount|balance|creditLimit|availableCreditLimit)$|Cents$/.test(k)) out.add(Math.abs(Math.round(/Cents$/.test(k) ? x : x * 100)));
        else walk(x);
      }
  };
  for (const bank of readdirSync(dir)) for (const f of readdirSync(path.join(dir, bank))) walk(JSON.parse(readFileSync(path.join(dir, bank, f), "utf8")));
  return [...out].filter((c) => c > 0).sort((a, b) => a - b);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * Spellings of one amount: 1.021,57 · 1021,57 · 1021.57 · 102157 (cents). Only amounts with centavos, from R$ 10,00 up, are
 * checked (below that, 9,99 or 4,24 are common prices and look like version numbers such as 4.24.0):
 * round ones (R$ 100, R$ 5.000) show up in every example and identify no one, while 47,93 does.
 */
export function amountPatterns(cents: number): RegExp[] {
  if (cents % 100 === 0 || Math.abs(cents) < 1000) return [];
  const reais = Math.floor(cents / 100);
  const cc = String(cents % 100).padStart(2, "0");
  const forms = [`${thousands(reais)},${cc}`, `${reais},${cc}`, `${reais}.${cc}`];
  const out = [...new Set(forms)].map((f) => new RegExp(`(?<![\\d.,])${esc(f)}(?![\\d])`));
  // In code, cents are followed by "," or ")" all the time; only a decimal part makes it another amount.
  if (cents >= 1000) out.push(new RegExp(`(?<![\\d_]|\\d[.,])-?${cents}(?![\\d_]|[.,]\\d)`));
  return out;
}

const SECRETS: [string, RegExp][] = [
  ["chave privada", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["chave da Anthropic", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["token do GitHub", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["chave da AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["token do Slack", /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  ["senha do Neon", /\bnpg_[A-Za-z0-9]{8,}/],
  // A password written in the URL; ${VAR} placeholders are fine.
  ["URL de banco com senha", /postgres(?:ql)?:\/\/[^\s:@/]+:(?!\$\{)[^\s@/]{6,}@/],
];

/** A secret-looking value: long and mixing upper case, lower case and digits. Placeholders and phrases do not. */
const randomLooking = (v: string) => v.length >= 24 && /[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v);
const ASSIGNED = /(?:secret|token|password|senha|api[_-]?key)["']?\s*[:=]\s*["']([^"']+)["']/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Real ids are random; test ids such as 11111111-1111-4111-8111-111111111111 are not. */
const randomUuid = (u: string) => new Set(u.replace(/-/g, "")).size >= 10;

export function scanText(file: string, text: string, amounts: RegExp[], words: string[]): Finding[] {
  const out: Finding[] = [];
  const lower = words.map((w) => w.toLowerCase());
  text.split(/\r?\n/).forEach((line, i) => {
    const at = (kind: string) => out.push({ file, line: i + 1, kind });
    if (amounts.some((r) => r.test(line))) at("valor das faturas reais (corpus)");
    const l = line.toLowerCase();
    if (lower.some((w) => l.includes(w))) at("termo da lista privada");
    for (const [kind, r] of SECRETS) if (r.test(line)) at(kind);
    if ([...line.matchAll(ASSIGNED)].some((m) => randomLooking(m[1]!))) at("token de API genérico");
    if (/item|pluggy/i.test(line) && [...line.matchAll(UUID)].some((m) => randomUuid(m[0]))) at("Item ID da Pluggy");
  });
  return out;
}

function git(args: string[], cwd = ROOT, env?: Record<string, string>): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: env ? { ...process.env, ...env } : undefined });
}

const authorEnv = {
  GIT_AUTHOR_NAME: PUBLIC_AUTHOR.name,
  GIT_AUTHOR_EMAIL: PUBLIC_AUTHOR.email,
  GIT_COMMITTER_NAME: PUBLIC_AUTHOR.name,
  GIT_COMMITTER_EMAIL: PUBLIC_AUTHOR.email,
};

/**
 * Writes the public files to `dest` and commits them as PUBLIC_AUTHOR. Never pushes.
 * - New copy: `dest` must be empty or missing; it gets a fresh history on `main`.
 * - Update: `dest` must be a clean clone; everything but .git is replaced and committed on top of its history.
 * Returns false when the update changed nothing (no commit made).
 */
export function writePublicCopy(dest: string, contents: Map<string, Buffer>, opts: { update?: boolean; message?: string } = {}): boolean {
  if (opts.update) {
    if (!existsSync(path.join(dest, ".git"))) throw new Error("Para --update, o destino precisa ser um clone do repositório público.");
    if (git(["status", "--porcelain"], dest).trim()) throw new Error("O clone tem mudanças não salvas; deixe-o limpo antes do --update.");
    for (const entry of readdirSync(dest)) if (entry !== ".git") rmSync(path.join(dest, entry), { recursive: true, force: true });
  } else if (existsSync(dest) && readdirSync(dest).length) {
    throw new Error("O destino precisa ser uma pasta vazia ou inexistente.");
  }
  for (const [f, buf] of contents) {
    const target = path.join(dest, f);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, buf);
  }
  if (!opts.update) git(["init", "-q", "-b", "main"], dest);
  git(["add", "-A"], dest);
  if (opts.update && !git(["status", "--porcelain"], dest).trim()) return false;
  git(["commit", "-q", "-m", opts.message ?? (opts.update ? "Atualiza a versão pública" : "Versão pública inicial")], dest, authorEnv);
  return true;
}

function privateWords(): string[] {
  const words: string[] = [];
  try {
    const email = git(["config", "user.email"]).trim();
    if (email) words.push(email);
  } catch {
    // no e-mail configured
  }
  const file = path.join(ROOT, ".private/denylist.txt");
  if (existsSync(file)) words.push(...readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
  return words.filter((w) => w.length >= 4);
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Uso: npx tsx scripts/export-public.ts --check | --list | --history | <pasta-de-destino> | --update <clone> [mensagem]");
    process.exit(2);
  }
  const check = arg === "--check";
  const files = git(["ls-tree", "-r", "--name-only", "HEAD"]).split("\n").filter(Boolean);
  const kept = files.filter((f) => !isExcluded(f));
  if (arg === "--list") {
    console.log(kept.join("\n"));
    return;
  }
  if (arg === "--history") {
    // Secrets anywhere in this repository's history (real amounts are expected here: this history stays private).
    const log = git(["log", "--all", "-p", "--no-color", "--format=commit %h"]);
    let commit = "?";
    const hits: Finding[] = [];
    for (const line of log.split("\n")) {
      if (line.startsWith("commit ")) commit = line.slice(7);
      else if (line.startsWith("+") && !line.startsWith("+++")) hits.push(...scanText(`commit ${commit}`, line.slice(1), [], []));
    }
    console.log(hits.length ? hits.map((h) => `  ${h.file}  ${h.kind}`).join("\n") : "Histórico sem segredos reconhecíveis.");
    process.exit(hits.length ? 1 : 0);
  }
  const amounts = corpusAmounts().flatMap(amountPatterns);
  const words = privateWords();
  if (!amounts.length) console.warn("Aviso: tests/corpus não encontrado; só segredos e a lista privada serão verificados.");

  const findings: Finding[] = [];
  const contents = new Map<string, Buffer>();
  for (const f of kept) {
    if (BINARY.test(f) && !isReviewedImage(f)) {
      findings.push({ file: f, line: 0, kind: "arquivo binário (imagem, PDF…): não pode ser verificado" });
      continue;
    }
    const buf = execFileSync("git", ["show", `HEAD:${f}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    contents.set(f, buf);
    if (isReviewedImage(f)) {
      if (!isPng(buf)) findings.push({ file: f, line: 0, kind: "não é um PNG de verdade" });
      continue;
    }
    findings.push(...scanText(f, buf.toString("utf8"), amounts, words));
  }

  console.log(`${files.length} arquivos no último commit; ${files.length - kept.length} excluídos; ${kept.length} verificados.`);
  if (findings.length) {
    console.error(`\nBLOQUEADO: ${findings.length} problema(s). Nada foi escrito.\n`);
    for (const x of findings) console.error(`  ${x.file}${x.line ? `:${x.line}` : ""}  ${x.kind}`);
    process.exit(1);
  }
  if (check) {
    console.log("Verificação limpa.");
    return;
  }

  const update = arg === "--update";
  const target = update ? process.argv[3] : arg;
  if (!target) throw new Error("Informe a pasta do clone: --update <clone> [mensagem]");
  const dest = path.resolve(target);
  if (dest === ROOT || dest.startsWith(ROOT + path.sep)) throw new Error("O destino precisa ficar fora deste repositório.");
  if (!writePublicCopy(dest, contents, { update, message: update ? process.argv[4] : undefined })) {
    console.log(`Nada mudou em relação ao clone em ${dest}; nenhum commit foi feito.`);
  } else if (update) {
    console.log(`Commit novo em ${dest}, como ${PUBLIC_AUTHOR.email}. Confira com git show --stat e envie com git push (sem --force).`);
  } else {
    console.log(`Cópia pública criada em ${dest}, com um único commit de ${PUBLIC_AUTHOR.email} e sem o histórico deste repositório.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
