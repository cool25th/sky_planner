import assert from "node:assert/strict";
import test from "node:test";

import {
  ORIGIN_COORDS,
  STAY_BUCKET_LABELS,
  formatFareShort,
  interpolateGreatCircle,
  originCoordFor,
} from "../lib/map-geo.ts";

function closeTo(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${actual} to be close to ${expected}`,
  );
}

test("interpolateGreatCircle keeps endpoints and honors point count", () => {
  const start = ORIGIN_COORDS.SEL;
  const end = ORIGIN_COORDS.CJU;
  const arc = interpolateGreatCircle(start, end, 10);

  assert.equal(arc.length, 11);
  closeTo(arc[0][0], start[0]);
  closeTo(arc[0][1], start[1]);
  closeTo(arc[10][0], end[0]);
  closeTo(arc[10][1], end[1]);
});

test("interpolateGreatCircle midpoint sits between endpoints for short hops", () => {
  const [startLon, startLat] = ORIGIN_COORDS.SEL;
  const [endLon, endLat] = ORIGIN_COORDS.CJU;
  const [midLon, midLat] = interpolateGreatCircle(ORIGIN_COORDS.SEL, ORIGIN_COORDS.CJU, 2)[1];

  assert.ok(midLat < startLat && midLat > endLat, `mid latitude ${midLat} out of range`);
  assert.ok(midLon < startLon && midLon > endLon, `mid longitude ${midLon} out of range`);
});

test("interpolateGreatCircle returns pair unchanged for identical endpoints", () => {
  const point = ORIGIN_COORDS.GMP;
  assert.deepEqual(interpolateGreatCircle(point, point), [point, point]);
});

test("formatFareShort renders man/cheon units with dash for null", () => {
  assert.equal(formatFareShort(null), "-");
  assert.equal(formatFareShort(10000), "1만");
  assert.equal(formatFareShort(20000), "2만");
  assert.equal(formatFareShort(25000), "2.5만");
  assert.equal(formatFareShort(312000), "31.2만");
  assert.equal(formatFareShort(4000), "4천");
  assert.equal(formatFareShort(9000), "9천");
});

test("originCoordFor falls back to ICN for unknown origin codes", () => {
  assert.deepEqual(originCoordFor("SEL"), ORIGIN_COORDS.SEL);
  assert.deepEqual(originCoordFor("NOT_A_CODE"), ORIGIN_COORDS.ICN);
});

test("stay bucket labels cover the three MVP buckets in Korean", () => {
  assert.deepEqual(Object.keys(STAY_BUCKET_LABELS).sort(), ["3_4", "5_7", "8_14"]);
  for (const label of Object.values(STAY_BUCKET_LABELS)) {
    assert.match(label, /박$/);
  }
});
