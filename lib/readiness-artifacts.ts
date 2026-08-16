import { readFile } from "node:fs/promises";
import path from "node:path";

export interface UserExperienceArtifactSnapshot {
  trustCues: boolean;
  serviceUnavailableUi: boolean;
}

export interface PolicyArtifactSnapshot {
  publicPolicyPage: boolean;
  affiliateDisclosure: boolean;
  dataAccuracyDisclosure: boolean;
  supportContactDisclosure: boolean;
  opsRunbook: boolean;
  readinessApi: boolean;
  readinessPage: boolean;
}

async function artifactContains(relativePath: string, requiredTokens: string[], baseDir = process.cwd()) {
  try {
    const contents = await readFile(path.join(baseDir, relativePath), "utf-8");
    return requiredTokens.every((token) => contents.includes(token));
  } catch {
    return false;
  }
}

export async function userExperienceArtifactSnapshot(baseDir = process.cwd()): Promise<UserExperienceArtifactSnapshot> {
  const [
    fareBoardTrustCues,
    serviceUnavailableHelper,
    serviceUnavailableComponent,
    homeUnavailableUi,
    fareBoardUnavailableUi,
    mapUnavailableUi,
    offersUnavailableUi,
    destinationUnavailableUi,
  ] = await Promise.all([
    artifactContains("app/fare-board/page.tsx", ["fb-trust-strip", "readModelLabel", "Source health", "Eligible sources"], baseDir),
    artifactContains("lib/service-unavailable.ts", ["isServiceUnavailableDiagnostics", "Read model unavailable"], baseDir),
    artifactContains("components/service-unavailable-notice.tsx", ["ServiceUnavailableNotice", "service-unavailable-panel"], baseDir),
    artifactContains("app/page.tsx", ["dynamic = \"force-dynamic\"", "ServiceUnavailableNotice", "isServiceUnavailableDiagnostics", "unstable_noStore", "noStore();"], baseDir),
    artifactContains("app/fare-board/page.tsx", ["dynamic = \"force-dynamic\"", "ServiceUnavailableNotice", "isServiceUnavailableDiagnostics", "unstable_noStore", "noStore();"], baseDir),
    artifactContains("app/map/page.tsx", ["dynamic = \"force-dynamic\"", "ServiceUnavailableNotice", "isServiceUnavailableDiagnostics", "unstable_noStore", "noStore();"], baseDir),
    artifactContains("app/offers/page.tsx", ["dynamic = \"force-dynamic\"", "ServiceUnavailableNotice", "isServiceUnavailableDiagnostics", "unstable_noStore", "noStore();"], baseDir),
    artifactContains("app/destination/[placeId]/page.tsx", ["dynamic = \"force-dynamic\"", "ServiceUnavailableNotice", "isServiceUnavailableDiagnostics", "unstable_noStore", "noStore();"], baseDir),
  ]);

  return {
    trustCues: fareBoardTrustCues,
    serviceUnavailableUi:
      serviceUnavailableHelper &&
      serviceUnavailableComponent &&
      homeUnavailableUi &&
      fareBoardUnavailableUi &&
      mapUnavailableUi &&
      offersUnavailableUi &&
      destinationUnavailableUi,
  };
}

export async function policyArtifactSnapshot(baseDir = process.cwd()): Promise<PolicyArtifactSnapshot> {
  const [
    publicPolicyPage,
    affiliateDisclosure,
    dataAccuracyDisclosure,
    supportContactDisclosure,
    opsRunbook,
    serviceReadinessApi,
    sourceHealthApi,
    readinessPage,
  ] = await Promise.all([
    artifactContains("app/policies/page.tsx", ["서비스 정책", "가격과 예약 가능 여부", "제휴 링크", "데이터 갱신", "개인정보", "문의와 장애"], baseDir),
    artifactContains("app/policies/page.tsx", ["제휴 링크", "제휴", "광고성 링크"], baseDir),
    artifactContains("app/policies/page.tsx", ["최종 결제 금액", "좌석 가능 여부", "예약처"], baseDir),
    artifactContains("app/policies/page.tsx", ["resolveSupportContact", "문의 채널 설정 후", "contact.email"], baseDir),
    artifactContains("require/ops.md", ["출시 게이트", "장애 대응 Runbook", "비밀 관리", "SERVICE_REQUIRE_POSTGRES", "COLLECTOR_SOURCE_MANIFEST_JSON", "OPS_READINESS_TOKEN", "SKYSCANNER_FEED_API_KEY", "KOREAN_AIR_FEED_API_KEY", "ASIANA_FEED_API_KEY"], baseDir),
    artifactContains("app/api/ops/service-readiness/route.ts", ["getServiceReadinessSnapshot", "resolveOpsRequestVisibility", "redactServiceReadinessSnapshot", "enrichInternalServiceReadinessSnapshot"], baseDir),
    artifactContains("app/api/ops/source-health/route.ts", ["buildSourceReadinessSnapshot", "resolveOpsRequestVisibility", "redactSourceReadinessSnapshot", "enrichInternalSourceReadinessSnapshot"], baseDir),
    artifactContains("app/service-readiness/page.tsx", ["Service Readiness", "Launch Blockers", "Action Queue", "operator_actions", "const blockers = [...new Set(snapshot.launch_blockers)];", "const operatorActions = snapshot.operator_actions;", "service_unavailable_ui_available"], baseDir),
  ]);

  return {
    publicPolicyPage,
    affiliateDisclosure,
    dataAccuracyDisclosure,
    supportContactDisclosure,
    opsRunbook,
    readinessApi: serviceReadinessApi && sourceHealthApi,
    readinessPage,
  };
}
