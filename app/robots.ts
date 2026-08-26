import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/ops/", "/api/revalidate"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
