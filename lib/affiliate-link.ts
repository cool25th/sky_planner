// 완료정의[4]: 제휴 딥링크 추적 파라미터.
// sub_id에는 페이지유형·픽 식별·신선도 등급만 실는다 — 개인정보·세션·검색어 금지.
// TP 리포트가 전환 로그가 되게 하되, 고지(관측가·관측시각·제휴 링크)는 숨기지 않는다.
export interface AffiliateTrackingContext {
  surface: string;
  pickId?: string | null;
  freshness?: string | null;
}

const SUB_ID_MAX_LENGTH = 64;

export function trackingSubId(context: AffiliateTrackingContext): string {
  return [context.surface, context.pickId ?? null, context.freshness ?? null]
    .filter(Boolean)
    .join("_")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, SUB_ID_MAX_LENGTH);
}

// 파싱 불가·빈 링크는 원문 그대로(추적이 CTA를 깨뜨리면 안 된다).
export function withAffiliateTracking(deepLink: string | null | undefined, context: AffiliateTrackingContext): string {
  if (!deepLink) return deepLink ?? "";
  try {
    const url = new URL(deepLink);
    url.searchParams.set("sub_id", trackingSubId(context));
    return url.toString();
  } catch {
    return deepLink;
  }
}
