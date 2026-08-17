import assert from "node:assert/strict";
import test from "node:test";

import { fareFreshness, isHiddenFare } from "../lib/fare-freshness.ts";
import {
  availableWeeks,
  getMapData,
  getOffersData,
  parseMapQuery,
  parseOffersQuery,
} from "../lib/mock-market.ts";

const NOW = new Date("2026-08-17T12:00:00Z");

test("fare freshness applies 24/28/72 hour thresholds", () => {
  assert.equal(fareFreshness("2026-08-17T00:00", NOW).level, "fresh");
  assert.equal(fareFreshness("2026-08-16T10:00", NOW).level, "delayed");
  assert.equal(fareFreshness("2026-08-16T06:00", NOW).level, "cta_disabled");
  assert.equal(fareFreshness("2026-08-14T06:00", NOW).level, "hidden");
  assert.equal(isHiddenFare("not-a-date", NOW), true);
});

test("offers older than 72 hours are hidden from offers data", () => {
  const query = parseOffersQuery({ origin: "ICN", week: availableWeeks()[0].code, destination: "CJU" });
  assert.equal(getOffersData(query, "2026-08-14T00:00").offers.length, 0);
  assert.ok(getOffersData(query).offers.length > 0);
});

test("past departure weeks return no map deals or offers", () => {
  const mapQuery = parseMapQuery({ origin: "ICN", week: "2026-W13" });
  assert.equal(getMapData(mapQuery, "2026-08-17T02:00").deals.length, 0);

  const offersQuery = parseOffersQuery({
    origin: "ICN",
    week: "2026-W13",
    destination: "CJU",
    depart: "2026-03-23",
    return: "2026-03-28",
  });
  assert.equal(getOffersData(offersQuery, "2026-08-17T02:00").offers.length, 0);
});
