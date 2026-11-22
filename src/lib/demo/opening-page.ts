// The public demonstration's front door (docs/DEPLOY_DEMO.md). The link people open is "/", which the demo build
// redirects here: a plain HTML file served by the CDN, with no function and no database behind it, so something shows
// up at once even when every instance is cold. It then opens /inicio; the browser keeps this page on screen until the
// app has something to paint, so the visitor never stares at a blank screen.
// Colors mirror globals.css (light and dark). No external resource: the CSP allows only this origin.

export const OPENING_PAGE_PATH = "/abrindo.html";
export const OPENING_TARGET = "/inicio";

export function openingPageHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="Demonstração do Cruzado, um app de finanças pessoais, com dados de exemplo.">
<meta property="og:title" content="Cruzado: demonstração">
<meta property="og:description" content="Um app de finanças pessoais, aberto para explorar com dados de exemplo.">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f3f5f3">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0b0e0c">
<title>Cruzado: demonstração</title>
<style>
:root{--bg:#f3f5f3;--surface:#fff;--border:#e1e6e2;--text:#111a14;--muted:#4b5a50;--primary:#0f7a52;--track:#e0f2e9;--hero:#123524;--accent:#b6e05a}
@media (prefers-color-scheme:dark){:root{--bg:#0b0e0c;--surface:#121613;--border:#232a26;--text:#ecf1ed;--muted:#a1aea6;--primary:#3ddc97;--track:#11281d;--hero:#123524;--accent:#c6f36a}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{min-height:100dvh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--text);font:18px/1.5 "IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:26rem;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:32px 28px}
.brand{display:flex;align-items:center;gap:10px;font-size:1.25rem;font-weight:600;letter-spacing:-.01em}
h1{margin:28px 0 6px;font-size:1.375rem;line-height:1.3;font-weight:600}
p{margin:0;color:var(--muted)}
.bar{margin-top:24px;height:6px;border-radius:99px;background:var(--track);overflow:hidden}
.bar span{display:block;height:100%;width:40%;border-radius:99px;background:var(--primary);animation:slide 1.4s ease-in-out infinite}
@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){.bar span{animation:none;width:100%;opacity:.5}}
a{color:var(--primary);font-weight:600}
noscript p{margin-top:20px}
</style>
</head>
<body>
<main>
<div class="brand">
<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="15" fill="var(--hero)"/><circle cx="16" cy="16" r="11.5" fill="var(--accent)"/><path d="M20.3 12.4A5.6 5.6 0 1 0 20.3 19.6" fill="none" stroke="var(--hero)" stroke-width="2.8" stroke-linecap="round"/></svg>
<span>Cruzado</span>
</div>
<div role="status">
<h1>Preparando a demonstração…</h1>
<p>Leva alguns segundos na primeira vez. Os dados são de exemplo e nada do que você fizer é salvo.</p>
</div>
<div class="bar" aria-hidden="true"><span></span></div>
<noscript><p><a href="${OPENING_TARGET}">Abrir a demonstração</a></p></noscript>
</main>
<script>requestAnimationFrame(function(){setTimeout(function(){location.replace(${JSON.stringify(OPENING_TARGET)})},0)})</script>
</body>
</html>
`;
}
