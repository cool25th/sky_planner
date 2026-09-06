import test from "node:test";
import assert from "node:assert/strict";
import { availableWeeks, currentWeekStart, isoWeekCode } from "../lib/mock-market.ts";

// UX-20260907-001: 기본 주간은 KST(UTC+9) '오늘' 기준이어야 한다.
// UTC 날짜 판정 시 KST 월요일 00:00~08:59에 지난 주간이 기본 조회로 노출됐다(2026-09-07 실측).
test("currentWeekStart follows the KST day boundary, not UTC", () => {
  // KST 일요일 23:59:59.999 → 아직 지난주
  assert.equal(isoWeekCode(currentWeekStart(new Date("2026-09-06T14:59:59.999Z"))), "2026-W36");
  // KST 월요일 00:00:00.000 → 다음 주로 전환
  assert.equal(isoWeekCode(currentWeekStart(new Date("2026-09-06T15:00:00.000Z"))), "2026-W37");
  // KST 월요일 새벽 04:00 — 이 계약을 낸 실측 사례 시각(당일 기본 /map이 W36을 내린 사건)
  assert.equal(isoWeekCode(currentWeekStart(new Date("2026-09-06T19:00:00Z"))), "2026-W37");
});

// 1월 1일 날짜산술 근사 대신 목요일 ISO 연도 기준 — 연말 주 코드가 실제 ISO 주차와 일치해야 한다.
test("isoWeekCode is correct across the ISO year rollover", () => {
  assert.equal(isoWeekCode(new Date(Date.UTC(2026, 11, 28))), "2026-W53"); // 2026-12-28(월)
  assert.equal(isoWeekCode(new Date(Date.UTC(2027, 0, 4))), "2027-W01"); // 2027-01-04(월)
  assert.equal(isoWeekCode(new Date(Date.UTC(2026, 8, 7))), "2026-W37"); // 2026-09-07(월)
});

test("availableWeeks starts at the current KST week and stays consecutive", () => {
  const weeks = availableWeeks(3);
  const monday = currentWeekStart();
  assert.equal(weeks[0].code, isoWeekCode(monday));
  assert.equal(weeks[0].start_date, monday.toISOString().slice(0, 10));
  const nextMonday = new Date(monday);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  assert.equal(weeks[1].code, isoWeekCode(nextMonday));
  const weekAfter = new Date(nextMonday);
  weekAfter.setUTCDate(weekAfter.getUTCDate() + 7);
  assert.equal(weeks[2].code, isoWeekCode(weekAfter));
  assert.ok(weeks[0].natural_range.length > 0);
});
