import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "./globals.css";

export const metadata: Metadata = {
  // Absolute links for the preview image of "/" (opengraph-image.tsx).
  metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
  title: { default: "Cruzado", template: "%s · Cruzado" },
  description: "Agente de finanças pessoais open source, self-hosted e somente leitura.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e0c" },
  ],
};

// Applies the saved theme before paint (no flash). Storage may be unavailable: ignore errors.
const themeScript = `try{var t=localStorage.getItem("tostao-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
