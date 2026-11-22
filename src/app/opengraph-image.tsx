// Preview image for links to the landing page (LinkedIn, GitHub, messengers). Rendered once at build time.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Cruzado: seu dinheiro, com a prova de cada número. Finanças pessoais somente leitura, com Open Finance.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default async function OpenGraphImage() {
  const root = process.cwd();
  const [semibold, regular, rosette] = await Promise.all([
    readFile(path.join(root, "node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff")),
    readFile(path.join(root, "node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff")),
    readFile(path.join(root, "public/landing/guilloche.svg")),
  ]);
  const rosetteSrc = `data:image/svg+xml;base64,${rosette.toString("base64")}`;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden", background: "linear-gradient(135deg, #1a4630 0%, #123524 55%, #0c2619 100%)", color: "#f3f8f2", fontFamily: "Plex" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered by next/og, not by a browser */}
        <img src={rosetteSrc} width={900} height={900} alt="" style={{ position: "absolute", right: -260, top: -140 }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 80px", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <svg width="64" height="64" viewBox="0 0 32 32">
              <circle cx="16" cy="16" r="15" fill="#0c2619" />
              <circle cx="16" cy="16" r="11.5" fill="#c6f36a" />
              <path d="M20.3 12.4A5.6 5.6 0 1 0 20.3 19.6" fill="none" stroke="#123524" strokeWidth="2.8" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 44, fontWeight: 600, letterSpacing: -1 }}>Cruzado</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 820 }}>
            <span style={{ fontSize: 76, fontWeight: 600, lineHeight: 1.02, letterSpacing: -2.5 }}>Seu dinheiro, com a prova de cada número.</span>
            <span style={{ fontSize: 30, color: "#c2d6c7", lineHeight: 1.4 }}>Finanças pessoais somente leitura, com Open Finance e faturas que batem com o banco.</span>
          </div>
          <span style={{ fontSize: 26, color: "#c6f36a", fontWeight: 600 }}>Código aberto, com demonstração ao vivo</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Plex", data: semibold, weight: 600, style: "normal" },
        { name: "Plex", data: regular, weight: 400, style: "normal" },
      ],
    },
  );
}
