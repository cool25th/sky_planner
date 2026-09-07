import type { MetadataRoute } from "next";
import { readLaunchGate } from "@/lib/launch-gate";
import { siteUrl } from "@/lib/url";

// 완료정의[5]: 품질 게이트(스테일 최저가·데모 폴백·주간 픽·실패 감지)를 통과하기 전에는
// 검색 엔진이 가격 페이지를 기어가지 못하게 닫는다 — 스테일 가격이 인덱싱/공유되면
// 첫인상이 고착된다. 통과하면 기존 규칙(ops 경로만 차단)으로 돌아간다.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const gate = await readLaunchGate();
  if (!gate.passed) {
    return {
      rules: { userAgent: "*", disallow: "/" },
      sitemap: `${siteUrl}/sitemap.xml`,
    };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/ops/", "/api/revalidate"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
