import assert from "node:assert/strict";
import test from "node:test";

import { scoreDealForCuration } from "../lib/recommendation.ts";
import { holidayReason, holidaysInStay, seasonNoteFor } from "../lib/season-calendar.ts";

// RECO-20260828-003: 연휴·시즌 캘린더 계약 — 연휴는 시기 점수의 근거(+15),
// 시즌 노트는 우기·태풍 등 정직한 안내(점수 없음).

const TODAY = "2026-08-28";

test("holidaysInStay finds unique holidays inside the stay window", () => {
  // 2026 추석 연휴: 09-24(목) ~ 09-26(토)
  assert.deepEqual(holidaysInStay("2026-09-24", "2026-09-28"), ["추석 연휴", "추석", "추석 연휴"].filter((name, index, all) => all.indexOf(name) === index));
  assert.deepEqual(holidaysInStay("2026-10-08", "2026-10-12"), ["한글날"]);
  assert.deepEqual(holidaysInStay("2026-10-10", "2026-10-14"), []);
  assert.deepEqual(holidaysInStay(null, "2026-10-09"), []);
});

test("holidayReason collapses consecutive-day holidays into one phrase", () => {
  assert.equal(holidayReason(["추석 연휴", "추석", "추석 연휴"]), "추석 연휴 포함");
  assert.equal(holidayReason(["한글날"]), "한글날 포함");
  assert.equal(holidayReason(["설날", "설날 연휴"]), "설날 연휴 포함");
  assert.equal(holidayReason([]), null);
});

test("seasonNoteFor maps destination and departure month", () => {
  assert.equal(seasonNoteFor("DPS", "2026-11-20"), "발리 우기 시작");
  assert.equal(seasonNoteFor("CEB", "2026-08-05"), "세부 우기");
  assert.equal(seasonNoteFor("TYO", "2026-08-05"), null);
  assert.equal(seasonNoteFor("DPS", null), null);
});

test("curation counts holiday merit and shows season note without score", () => {
  const chuseok = scoreDealForCuration(
    {
      destination_code: "TYO",
      economy_min_total: 400000,
      economy_discount_pct: null,
      economy_best_depart_date: "2026-09-23",
      economy_best_return_date: "2026-09-28",
    },
    TODAY,
  );
  // 시기 30(D-26 예약 적기) + 연휴 15 + 주말 10(09-26 토 = 추석 연휴 마지막 날)
  assert.equal(chuseok.score, 30 + 15 + 10);
  assert.ok(chuseok.reasons.includes("추석 연휴 포함"));
  assert.ok(chuseok.reasons.includes("주말 포함"));

  // 12-07(월)~12-11(금): 주중이라 주말 없음, D-101이라 시기 +5 — 시즌 노트 외 점수원이 없는 고립 케이스.
  const rainySeason = scoreDealForCuration(
    {
      destination_code: "DPS",
      economy_min_total: 500000,
      economy_discount_pct: null,
      economy_best_depart_date: "2026-12-07",
      economy_best_return_date: "2026-12-11",
    },
    TODAY,
  );
  assert.ok(rainySeason.reasons.includes("발리 우기"));
  assert.equal(rainySeason.score, 5, "시즌 노트는 점수에 영향을 주지 않는다");
});
