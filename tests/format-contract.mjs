import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  formatCompactDate,
  formatDate,
  formatMoney,
  formatTime,
  formatWeekNatural,
  isPastWeek,
  stamp,
  weekStartDate,
} from "../lib/format.ts";
import { availableWeeks } from "../lib/mock-market.ts";

test("formatMoney renders KRW currency or dash for null", () => {
  assert.equal(formatMoney(312000), "₩312,000");
  assert.equal(formatMoney(null), "-");
});

test("stamp renders short datetime or dash for invalid input", () => {
  assert.equal(stamp("not-a-date"), "-");
  assert.match(stamp("2026-08-17T11:30"), /8월 17일/);
});

test("stamp and formatTime render timestamps in KST regardless of runtime timezone", () => {
  // 2026-08-28T15:17Z = 2026-08-29 00:17 KST — SSR(TZ=UTC)에서 날짜가 전날로 어긋나던 회귀 방어.
  // 오전/오후 토큰은 런타임 ICU에 따라 AM/PM으로 렌더되므로 날짜·시각(타임존 변환)만 고정한다.
  const stamped = stamp("2026-08-28T15:17:04.439Z");
  assert.match(stamped, /8월 29일/);
  assert.match(stamped, /12:17/);
  assert.match(formatTime("2026-08-24T09:05:00Z"), /06:05/);
});

test("formatWeekNatural renders natural month-day ranges", () => {
  assert.equal(formatWeekNatural("2026-W34"), "8월 17일 ~ 23일");
  assert.equal(formatWeekNatural("2026-W01"), "12월 29일 ~ 1월 4일");
  assert.equal(formatWeekNatural("bad-code"), "bad-code");
});

test("weekStartDate resolves ISO week codes to their Monday", () => {
  assert.equal(weekStartDate("2026-W34")?.toISOString().slice(0, 10), "2026-08-17");
  assert.equal(weekStartDate("bad-code"), null);
});

test("isPastWeek flags weeks before the current week only", () => {
  assert.equal(isPastWeek("2026-W13"), true);
  const [thisWeek, nextWeek] = availableWeeks(2).map((week) => week.code);
  assert.equal(isPastWeek(thisWeek), false);
  assert.equal(isPastWeek(nextWeek), false);
});

test("formatTime degrades to a label instead of throwing on missing leg times", () => {
  // UX-20260831-001: live 오퍼의 departure/arrival 시각 결측(row-mapper "" 정규화)이
  // /offers SSR 전체를 RangeError로 죽이던 회귀 방어.
  assert.equal(formatTime(""), "시간 미정");
  assert.equal(formatTime("not-a-date"), "시간 미정");
});

test("date helpers render compact and full dates", () => {
  assert.equal(formatCompactDate("2026-08-24"), "8/24 (월)");
  assert.equal(formatDate("2026-08-24"), "8. 24. (월)");
  assert.ok(formatTime("2026-08-24T09:05").length > 0);
});

test("app and component code format money only via lib/format", () => {
  const offenders = ["app", "components"].flatMap(function scan(dir) {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? scan(full) : /\.tsx?$/.test(name) ? [full] : [];
    });
  }).filter((file) => readFileSync(file, "utf8").includes("Intl.NumberFormat"));
  assert.deepEqual(offenders, [], `direct Intl.NumberFormat construction: ${offenders.join(", ")}`);
});
