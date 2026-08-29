import assert from "node:assert/strict";
import test from "node:test";

import {
  countryLabel,
  normalizeCabin,
  normalizeRegion,
  normalizeStayBucket,
  queryOrigins,
  regionLabel,
} from "../lib/read-model/labels.ts";

// 077c70f 계약: Aviasales가 origin을 SEL로 정규화해 저장하므로 서울 메트로 3코드는
// 어느 코드로 조회해도 동일한 3코드 집합과 매칭된다(양방향 등가). map/calendar/offers
// 전체 조회 경로의 SQL IN 절에 들어가는 값이라 회귀 시 전 쿼리 오염.
test("queryOrigins treats Seoul metro codes as bidirectionally equivalent", () => {
  assert.deepEqual(queryOrigins("SEL"), ["ICN", "GMP", "SEL"]);
  assert.deepEqual(queryOrigins("ICN"), ["ICN", "GMP", "SEL"]);
  assert.deepEqual(queryOrigins("GMP"), ["ICN", "GMP", "SEL"]);
});

test("queryOrigins passes non-metro origins through unchanged", () => {
  assert.deepEqual(queryOrigins("NRT"), ["NRT"]);
  assert.deepEqual(queryOrigins("CJU"), ["CJU"]);
});

test("normalizeRegion uppercases and defaults to ALL", () => {
  assert.equal(normalizeRegion(undefined), "ALL");
  assert.equal(normalizeRegion("japan"), "JAPAN");
});

test("regionLabel resolves known codes and falls back to raw input", () => {
  assert.equal(regionLabel("domestic"), "국내선");
  assert.equal(regionLabel(undefined), "전체");
  assert.equal(regionLabel("unknown-region"), "unknown-region");
});

test("countryLabel renders Korean names for ISO codes", () => {
  assert.equal(countryLabel("kr"), "대한민국");
  assert.equal(countryLabel(undefined), "");
});

test("normalizeCabin and normalizeStayBucket fall back to ALL/default bucket", () => {
  assert.equal(normalizeCabin("business"), "BUSINESS");
  assert.equal(normalizeCabin("first"), "ALL");
  assert.equal(normalizeStayBucket("3-4"), "3_4");
  assert.equal(normalizeStayBucket("2_3"), "5_7");
});
