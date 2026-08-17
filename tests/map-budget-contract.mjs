import assert from "node:assert/strict";
import test from "node:test";

import { getMapData, parseMapQuery } from "../lib/mock-market.ts";

test("map budget filter keeps only destinations within budget", () => {
  const query = parseMapQuery({ origin: "ICN", budget: "400000" });
  const deals = getMapData(query).deals;
  assert.ok(deals.length > 0);
  assert.ok(deals.length < getMapData(parseMapQuery({ origin: "ICN" })).deals.length);
  assert.ok(
    deals.every((deal) => (deal.economy_min_total ?? deal.business_min_total ?? Infinity) <= 400000),
  );
});

test("map budget filter respects selected cabin", () => {
  const query = parseMapQuery({ origin: "ICN", cabin: "BUSINESS", budget: "1000000" });
  const deals = getMapData(query).deals;
  assert.ok(deals.every((deal) => deal.business_min_total === null || deal.business_min_total <= 1000000));
});

test("invalid budget values fall back to no limit", () => {
  assert.equal(parseMapQuery({ origin: "ICN", budget: "abc" }).budget, null);
  assert.equal(parseMapQuery({ origin: "ICN", budget: "-5" }).budget, null);
  assert.equal(parseMapQuery({ origin: "ICN", budget: "400000.7" }).budget, 400000);
});

test("seoul-wide search attributes each deal's best fare to ICN or GMP", () => {
  const deals = getMapData(parseMapQuery({ origin: "SEL" })).deals;
  assert.ok(deals.length > 0);
  for (const deal of deals) {
    assert.ok(
      deal.best_origin_by_cabin.ECONOMY === "ICN" || deal.best_origin_by_cabin.ECONOMY === "GMP",
      `${deal.destination_code} best economy origin missing`,
    );
  }
  assert.ok(deals.length >= getMapData(parseMapQuery({ origin: "ICN" })).deals.length);
});
