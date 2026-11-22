// Runs before `next build` (npm "prebuild"). Only the public demonstration (DEMO_INSTANCE=1) needs these files; every
// other build skips them. `--force` writes them anyway, for local tests of the demonstration.
//  - demo-snapshot/base.tgz: an empty database with every migration applied (src/lib/demo/snapshot.ts);
//  - public/abrindo.html: the static front door the demo's "/" redirects to (src/lib/demo/opening-page.ts).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDemoSnapshot, DEMO_SNAPSHOT_FILE } from "../src/lib/demo/snapshot";
import { OPENING_PAGE_PATH, openingPageHtml } from "../src/lib/demo/opening-page";

async function main() {
  if (process.env.DEMO_INSTANCE !== "1" && !process.argv.includes("--force")) {
    console.log("[demo-build] não é a demonstração; nada a gerar.");
    return;
  }
  const started = Date.now();
  const blob = await buildDemoSnapshot();
  await mkdir(path.dirname(DEMO_SNAPSHOT_FILE), { recursive: true });
  await writeFile(DEMO_SNAPSHOT_FILE, Buffer.from(await blob.arrayBuffer()));
  const opening = path.join(process.cwd(), "public", OPENING_PAGE_PATH.slice(1));
  await mkdir(path.dirname(opening), { recursive: true });
  await writeFile(opening, openingPageHtml());
  console.log("[demo-build] banco migrado e página de abertura salvos", JSON.stringify({ bytes: blob.size, ms: Date.now() - started }));
}

main().catch((e) => {
  console.error("[demo-build] falhou", e);
  process.exit(1);
});
