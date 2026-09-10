import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MIN_CITIES_FOR_SUGGESTION } from "../lib/read-model/map-query.ts";
import { WEEKLY_PICK_BUCKET_RULES, weeklyPickPersona } from "../lib/recommendation.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// UX-20260910-004: /map 발견성 — 버킷 규칙 상수·매트릭스 임계·인접 조건 제안의 재발 방어.

function dealWithDates(depart, ret, overrides = {}) {
  return {
    destination_code: "TEST",
    economy_best_depart_date: depart,
    economy_best_return_date: ret,
    economy_discount_pct: 20,
    ...overrides,
  };
}

test("weekend warrior bucket requires 금–월 departure AND 1~3박 stay", () => {
  const rules = WEEKLY_PICK_BUCKET_RULES.weekend_warrior;
  assert.deepEqual([...rules.departWeekdays], [5, 6, 0, 1], "금–월 출발");
  assert.deepEqual([...rules.stayNights], [1, 3], "주말치기 체류 범위");

  // 2026-09-13 = 일요일 출발 7박(09-13 → 09-20): 2026-09-10 실측 결함 사례 — 주말치기여야 한다?
  const sundaySevenNights = weeklyPickPersona(dealWithDates("2026-09-13", "2026-09-20"), "2026-09-10");
  assert.notEqual(sundaySevenNights, "weekend_warrior", "일요일 출발 7박은 주말치기가 아니다");

  const fridayTwoNights = weeklyPickPersona(dealWithDates("2026-09-11", "2026-09-13"), "2026-09-10");
  assert.equal(fridayTwoNights, "weekend_warrior", "금요일 출발 2박은 주말치기");

  const sundayOneNight = weeklyPickPersona(dealWithDates("2026-09-13", "2026-09-14"), "2026-09-10");
  assert.equal(sundayOneNight, "weekend_warrior", "일요일 출발 1박(월 복귀)은 주말치기(하한 경계)");

  // 월요일 출발 단기는 체류에 주말가 없어 자격 상실 — "금–월"은 사실상 금/토/일 출발+주말 관통을 의미.
  const mondayThreeNights = weeklyPickPersona(dealWithDates("2026-09-14", "2026-09-17"), "2026-09-10");
  assert.notEqual(mondayThreeNights, "weekend_warrior", "월요일 출발 3박은 주말 미포함(주말 관통 조건)");

  const fridayFourNights = weeklyPickPersona(dealWithDates("2026-09-11", "2026-09-15"), "2026-09-10");
  assert.notEqual(fridayFourNights, "weekend_warrior", "4박부터는 주말치기가 아니다(상한 초과)");

  const tuesdayTwoNights = weeklyPickPersona(dealWithDates("2026-09-15", "2026-09-17"), "2026-09-10");
  assert.notEqual(tuesdayTwoNights, "weekend_warrior", "화요일 출발은 금–월 범위 밖");
});

test("home bucket sections hide when no pick matches the rule", async () => {
  const page = readFileSync(join(repoRoot, "app/page.tsx"), "utf8");
  // 규칙 불일치 딜이 버킷에 들어가지 않으면 섹션이 비고 — 카드 자체를 렌더하지 않는다.
  assert.match(page, /pickSections\.weekend\.length > 0 &&/, "주말치기 섹션은 매칭 픽이 있을 때만 렌더");
  assert.match(page, /pickSections\.earlyBird\.length > 0 &&/, "얼리버드 섹션도 동일");
  assert.match(page, /주말치기 · 금–월 출발 · 1~3박/, "섹션 라벨이 규칙(1~3박)과 일치");
});

test("destination matrix renders only with 4+ valid cells", async () => {
  const page = readFileSync(join(repoRoot, "app/destination/[placeId]/page.tsx"), "utf8");
  assert.match(page, /validCells\.length >= 4 &&/, "유효 셀 4미만(1×1 퇴화 매트릭스)은 렌더하지 않는다");
  assert.match(page, /UX-20260910-004/, "임계 근거가 주석에 있다");
});

test("map suggestion threshold and chip wiring are pinned", async () => {
  assert.equal(MIN_CITIES_FOR_SUGGESTION, 5, "도시 5개 미만이 제안 임계");
  const mapQuery = readFileSync(join(repoRoot, "lib/read-model/map-query.ts"), "utf8");
  assert.match(mapQuery, /countAdjacentMapCities/, "인접 조건(±1주·다른 버킷) 도시 수를 잰다");
  assert.match(mapQuery, /deals\.length > 0 && deals\.length < MIN_CITIES_FOR_SUGGESTION/, "제안은 결과가 얇을 때만 계산한다");
  const splitView = readFileSync(join(repoRoot, "components/map-split-view.tsx"), "utf8");
  assert.match(splitView, /조건을 바꾸면 더 많은 도시/, "제안 칩이 문구로 안내한다");
  // 정직성: 빈 상태 안내 문구는 제안이 대체하지 않는다(보완).
  assert.match(splitView, /선택한 조건에 맞는 목적지가 없습니다/, "빈 상태+사유는 유지된다");
});
