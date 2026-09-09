import type { MetadataRoute } from "next";
import { liveOfferDestinationIds, readLaunchGate } from "@/lib/launch-gate";
import { getDestinationList } from "@/lib/mock-market";
import { siteUrl } from "@/lib/url";

// 완료정의[5]: 게이트 통과 전에는 정적 안내 문서만 사이트맵에 남긴다(대량 딜 URL 제외).
// 통과 후에도 오퍼 0장 목적지 허브는 올리지 않는다 — 빈 허브가 색인되면 커버리지가 사기가 된다.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: siteUrl,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${siteUrl}/map`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/offers`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/policies`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${siteUrl}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const gate = await readLaunchGate();
  if (!gate.passed) return staticPages;

  const liveDestinations = new Set(await liveOfferDestinationIds());
  const destinationPages: MetadataRoute.Sitemap = getDestinationList()
    .filter((dest) => liveDestinations.has(dest.code))
    .map((dest) => ({
      url: `${siteUrl}/destination/${dest.code}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    }));

  return [...staticPages, ...destinationPages];
}
