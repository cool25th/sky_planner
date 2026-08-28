// RECO-20260828-002: 설명 가능한 추천 규칙 엔진 — 점수는 규칙의 합이고, 각 규칙은 문장으로 근거를 남긴다.
// 블랙박스 없음: 상위 노출의 이유는 항상 reasons 배열로 사용자에게 보여준다.
// 가격 근거(평균 대비 절감률)는 RECO-20260828-001의 표본 3일 이상 baseline에서만 존재한다.
// 연휴 근거(+15)는 RECO-20260828-003의 한국 공휴일 캘린더에서 온다. 시즌 노트는 점수 없는 정보 칩.

import { holidayReason, holidaysInStay, seasonNoteFor } from "./season-calendar.ts";

export interface CuratableDeal {
  destination_code: string;
  economy_min_total: number | null;
  economy_discount_pct?: number | null;
  economy_best_depart_date?: string | null;
  economy_best_return_date?: string | null;
}

export interface ScoredDeal<T extends CuratableDeal> {
  deal: T;
  score: number;
  reasons: string[];
}

const DAY_MS = 86400000;

export function daysUntilDeparture(departDate: string | null | undefined, todayIso: string): number | null {
  if (!departDate) return null;
  const target = Date.parse(`${String(departDate).slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  if (!Number.isFinite(target) || !Number.isFinite(today)) return null;
  return Math.round((target - today) / DAY_MS);
}

export function stayIncludesWeekend(departDate: string | null | undefined, returnDate: string | null | undefined): boolean {
  if (!departDate || !returnDate) return false;
  const start = Date.parse(`${String(departDate).slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${String(returnDate).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return false;
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const weekday = new Date(ms).getUTCDay();
    if (weekday === 0 || weekday === 6) return true;
  }
  return false;
}

function priceMerit(deal: CuratableDeal): { score: number; reason: string | null } {
  const pct = deal.economy_discount_pct ?? null;
  if (pct === null || pct < 5) return { score: 0, reason: null };
  if (pct >= 15) return { score: 40, reason: `30일 평균 대비 ${pct}% 저렴` };
  return { score: 20, reason: `평균 대비 ${pct}% 알뜰` };
}

function timingMerit(deal: CuratableDeal, todayIso: string): { score: number; reason: string | null } {
  const days = daysUntilDeparture(deal.economy_best_depart_date, todayIso);
  if (days === null || days < 0) return { score: 0, reason: null };
  if (days >= 14 && days <= 45) return { score: 30, reason: `출발 D-${days} · 예약 적기` };
  if ((days >= 7 && days <= 13) || (days >= 46 && days <= 60)) return { score: 15, reason: `출발 D-${days}` };
  return { score: 5, reason: null };
}

export function scoreDealForCuration<T extends CuratableDeal>(deal: T, todayIso: string): ScoredDeal<T> {
  const price = priceMerit(deal);
  const timing = timingMerit(deal, todayIso);
  const weekend = stayIncludesWeekend(deal.economy_best_depart_date, deal.economy_best_return_date);
  const holiday = holidayReason(holidaysInStay(deal.economy_best_depart_date, deal.economy_best_return_date));
  const season = seasonNoteFor(deal.destination_code, deal.economy_best_depart_date);
  const reasons = [
    price.reason,
    timing.reason,
    holiday,
    weekend ? "주말 포함" : null,
    season,
  ].filter((value): value is string => Boolean(value));
  return {
    deal,
    score: price.score + timing.score + (holiday ? 15 : 0) + (weekend ? 10 : 0),
    reasons,
  };
}

export function curateFeaturedDeals<T extends CuratableDeal>(deals: T[], todayIso: string, limit = 5): ScoredDeal<T>[] {
  return deals
    .map((deal) => scoreDealForCuration(deal, todayIso))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return (left.deal.economy_min_total ?? Number.MAX_SAFE_INTEGER) - (right.deal.economy_min_total ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, limit);
}
