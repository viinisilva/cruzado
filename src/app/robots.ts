// Crawlers may read the landing page. Every other page also says noindex in its own head (layout.tsx).
import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/"] } };
}
