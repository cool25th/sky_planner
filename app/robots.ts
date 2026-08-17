import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://sky-planner-atlas.vercel.app";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/ops/", "/api/revalidate"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
