// DATA-20260906-001 2층(완료정의[2]): 노출 가격의 단일 진실원 계약.
// "live offer" = 사용자에게 보여줄 수 있는 오퍼 — 4개 품질 가드(UX-20260905-001)와
// 72h 신선도(lib/fare-freshness HIDDEN_AFTER_HOURS와 짝)를 한 곳에 정의하고
// map/offers/calendar/search 조회, 수집 재계산, 스테일 스윕, 배치 조인 비율이 전부 공유한다.
// deals_current 캐시 최저가는 정렬 힌트일 뿐 표시 가격으로 쓰지 않는다.
// server-only가 아니어야 수집 스크립트(scripts/*.mjs)도 같은 계약을 import할 수 있다.
export const LIVE_OFFER_MAX_AGE_HOURS = 72;

// 별칭 o(offers)를 전제한다 — 모든 사용처가 offers를 o로 참조한다.
export const LIVE_OFFER_VISIBILITY_SQL = `
      o.is_active = true
      AND o.depart_date >= CURRENT_DATE
      AND o.last_seen_at >= now() - interval '${LIVE_OFFER_MAX_AGE_HOURS} hours'
      AND COALESCE(o.bookability_status, 'available') <> 'sold_out'
      AND COALESCE(o.price_status, 'active') <> 'sold_out'
      AND COALESCE(o.price_anomaly_status, 'normal') = 'normal'
      AND COALESCE(o.quality_bucket, 'preferred') <> 'excluded'`;

// 배치 성공의 정의(완료정의[2]): "소스 N개 수집"이 아니라 딜–오퍼 조인 후 노출 가능 비율.
// 스윕 이후 정상 상태는 ~1.0이며 0.80은 피드 일부 공백 여유 — 미달은 부분 성공+경보(전체 실패 아님).
export const MIN_DEAL_OFFER_JOIN_RATIO = 0.8;
