// UX-20260910-003: 예약 직전 화면(/offers) 표시 품질 — 프로덕션 실측 3결함의 근원 수리.
//  1) 동일 상품이 ICN 행과 SEL 행으로 이중 노출 — Aviasales가 cheap 응답에서 실제 공항을
//     도시 코드 SEL로 정규화해 저장되고(활성 오퍼 5,948건 중 5,320건이 origin=SEL), 읽기의
//     서울 메트로 등가(queryOrigins)가 ICN 조회에 SEL 행을 함께 끌어온다. SEL행은 다리 시각·
//     소요시간이 전부 결측(관측: arrival 0%, duration 0%)이라 "정보 없는 복제본"이 된다.
//  2) 비행시간이 "4.833333333333333시간" 원시 float로 렌더 — duration_hours를 직접 삽입.
//  3) 딥링크 없는 오퍼도 카드로 렌더(현재 데이터 0건 — 방어로 강제).
// 순수 함수만 담는다(계약 테스트가 lib를 직접 import) — 서버 의존은 offers-query가 담당.
import { formatDurationMinutes } from "../format.ts";
import type { Offer } from "../mock-market.ts";

// SEL은 예약 불가능한 가상 도시 코드다 — 읽기 등가(SEL↔ICN/GMP)의 canonical은 ICN.
// GMP는 실제 별개 공항이라 그대로 둔다(활성 오퍼에 GMP 행은 현재 없음).
export function metroCanonicalOrigin(origin: string): string {
  return origin === "SEL" ? "ICN" : origin;
}

// 표시용 출발지: SEL 행은 사용자가 선택한 실제 공항(ICN 등)으로 정규화해 표시한다.
// 메트로 등가가 읽기에서 이미 동등 취급하므로 표시 정확성을 해치지 않는다.
export function displayOrigin(origin: string, queryOrigin: string): string {
  return origin === "SEL" && queryOrigin && queryOrigin !== "SEL" ? queryOrigin : origin;
}

function completenessRank(offer: Offer): number {
  return (
    (offer.outbound_departure_at ? 1 : 0) +
    (offer.outbound_arrival_at ? 1 : 0) +
    (offer.inbound_departure_at ? 1 : 0) +
    (offer.inbound_arrival_at ? 1 : 0) +
    (offer.duration_hours > 0 ? 1 : 0)
  );
}

// 결측 시간정보 수(격하/제외 판정) — 가는/오는 출발·도착 4필드 + 비행시간.
export function missingTimeFields(offer: Offer): number {
  return 5 - completenessRank(offer);
}

function dedupKey(offer: Offer): string {
  // dedup 키에서 출발시각을 의도적으로 제외한다: 피드별로 시각 제공 여부가 달라(cheap=결측,
  // calendar=제공) 동일 상품이 "null시각 SEL행 vs 19:10 ICN행"으로 분할되는 것이 관측된 이중
  // 노출의 근원이다. 동일 (노선·일정·항공사·캐빈·가격)의 시각차 행은 예약처 딥링크가 대표한다.
  return [
    metroCanonicalOrigin(offer.origin),
    offer.destination_code,
    offer.depart_date,
    offer.return_date,
    offer.cabin_group,
    offer.airline_code,
    offer.price_total,
  ].join("|");
}

// 3결함 일괄 정규화: 딥링크 강제 → dedup(완전한 행 우선) → 표시 출발지 정규화 →
// 결측 과반(>50%) 제외·잔여 결측 격하 플래그. 입력을 변경하지 않고 새 배열을 반환한다.
export function normalizeOffersForDisplay(offers: Offer[], queryOrigin: string): Offer[] {
  const byKey = new Map<string, Offer>();
  for (const offer of offers) {
    if (!offer.deep_link) continue; // (3) 예약 딥링크 없는 오퍼는 카드를 내리지 않고 응답에서 제외한다
    const key = dedupKey(offer);
    const incumbent = byKey.get(key);
    // (1) 동일 상품이면 정보가 완전한 행(시각·시간 보유)을 대표로 남긴다 — SEL 복제행 제거.
    if (
      !incumbent ||
      completenessRank(offer) > completenessRank(incumbent) ||
      (completenessRank(offer) === completenessRank(incumbent) && offer.outbound_departure_at < incumbent.outbound_departure_at)
    ) {
      byKey.set(key, offer);
    }
  }

  const normalized: Offer[] = [];
  for (const offer of byKey.values()) {
    // 결측 비율: 시간정보 5필드 중 과반(3+) 결측이면 예약 판단 재료로서 신뢰 불가 — 제외.
    const missing = missingTimeFields(offer);
    if (missing > 2) continue;
    normalized.push({
      ...offer,
      origin: displayOrigin(offer.origin, queryOrigin),
      origin_label: displayOrigin(offer.origin, queryOrigin),
      // 라벨은 표시 직전에 duration_hours에서 재계산한다(수집 시점 값에 의존하지 않는다).
      duration_label: formatDurationMinutes(offer.duration_hours > 0 ? Math.round(offer.duration_hours * 60) : 0),
      // 1~2필드 결측은 격하+배지로 정보 부족을 고지한다(완전 결측과 구분).
      info_partial: missing > 0,
    });
  }

  // 격하: 결측 행은 정렬 기준과 무관하게 목록 하단으로(가격 오름차순은 동일 순서 유지).
  return normalized.sort((left, right) => {
    const partialGap = (left.info_partial ? 1 : 0) - (right.info_partial ? 1 : 0);
    return partialGap || left.price_total - right.price_total;
  });
}
