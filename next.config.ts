import type { NextConfig } from "next";

// INT-20260821-001: readiness 정적 체크(lib/readiness-artifacts.ts, lib/service-readiness-runtime.ts)가
// 런타임에 소스 파일을 읽으므로 배포 번들이 이 파일들을 포함해야 한다. 체크가 읽는 파일 목록과 1:1로 유지.
const READINESS_STATIC_FILES = [
  "app/page.tsx",
  "app/map/page.tsx",
  "app/offers/page.tsx",
  "app/destination/**/page.tsx",
  "app/policies/page.tsx",
  "app/service-readiness/page.tsx",
  "app/api/ops/service-readiness/route.ts",
  "app/api/ops/source-health/route.ts",
  "app/api/search/route.ts",
  "app/api/deals/map/route.ts",
  "app/api/deals/calendar/route.ts",
  "app/api/offers/route.ts",
  "lib/service-unavailable.ts",
  "lib/data-source.ts",
  "lib/read-model/diagnostics.ts",
  "components/service-unavailable-notice.tsx",
  "require/ops.md",
  ".env.example",
  "package.json",
  "configs/collector-source-manifest.production.example.json",
  "scripts/service-env-preflight.mjs",
  "scripts/service-launch-audit.mjs",
  "scripts/prod-readiness-smoke.mjs",
  "scripts/service-readiness-smoke.mjs",
  "scripts/ops-alert-smoke.mjs",
  ".github/workflows/collect-fares.yml",
].map((file) => `./${file}`);

const nextConfig: NextConfig = {
  typedRoutes: false,
  outputFileTracingIncludes: {
    "/api/ops/service-readiness": READINESS_STATIC_FILES,
    "/api/ops/source-health": READINESS_STATIC_FILES,
    "/service-readiness": READINESS_STATIC_FILES,
  },
};

export default nextConfig;
