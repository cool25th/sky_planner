import assert from "node:assert/strict";
import test from "node:test";

import { clusterDeals, dealMinFare } from "../lib/map-clustering.ts";

function deal(code, x, y, economy = 100, business = null) {
  return {
    destination_code: code,
    city: code,
    lat: y,
    lon: x,
    economy_min_total: economy,
    business_min_total: business,
  };
}

function projectByIndex(deals) {
  return (deal) => {
    const index = deals.indexOf(deal);
    return { x: index * 100, y: 0 };
  };
}

test("map clustering groups deals closer than the pixel threshold", () => {
  const deals = [
    deal("SEL", 0, 0, 300),
    deal("TYO", 30, 0, 250),
    deal("PAR", 400, 0, 900),
  ];
  const clusters = clusterDeals(deals, (d) => ({ x: d.lon, y: d.lat }), 56);

  assert.equal(clusters.length, 2);
  const [nearCluster, farCluster] = clusters;
  assert.deepEqual(nearCluster.deals.map((d) => d.destination_code).sort(), ["SEL", "TYO"]);
  assert.equal(nearCluster.min_fare, 250);
  assert.equal(nearCluster.representative.destination_code, "TYO");
  assert.deepEqual(farCluster.deals.map((d) => d.destination_code), ["PAR"]);
  assert.equal(farCluster.min_fare, 900);
});

test("map clustering keeps deals separate beyond the pixel threshold", () => {
  const deals = [deal("SEL", 0, 0), deal("TYO", 200, 0), deal("PAR", 400, 0)];
  const clusters = clusterDeals(deals, (d) => ({ x: d.lon, y: d.lat }), 56);

  assert.equal(clusters.length, 3);
  assert.ok(clusters.every((cluster) => cluster.deals.length === 1));
});

test("map clustering picks the lowest representative fare across cabins", () => {
  const deals = [
    deal("SEL", 0, 0, 500, 200),
    deal("TYO", 10, 0, 300, 900),
  ];
  const [cluster] = clusterDeals(deals, (d) => ({ x: d.lon, y: d.lat }), 56);

  assert.equal(cluster.representative.destination_code, "SEL");
  assert.equal(cluster.min_fare, 200);
  assert.equal(dealMinFare(deal("X", 0, 0, null, null)), null);
  assert.equal(dealMinFare(deal("X", 0, 0, null, 750)), 750);
});

test("map clustering falls back to first deal when no fares are present", () => {
  const deals = [
    deal("SEL", 0, 0, null, null),
    deal("TYO", 10, 0, null, null),
  ];
  const [cluster] = clusterDeals(deals, (d) => ({ x: d.lon, y: d.lat }), 56);

  assert.equal(cluster.deals.length, 2);
  assert.equal(cluster.representative.destination_code, "SEL");
  assert.equal(cluster.min_fare, null);
});

test("map clustering chains nearby deals into one cluster via any member", () => {
  const deals = [deal("A", 0, 0), deal("B", 50, 0), deal("C", 100, 0), deal("D", 150, 0)];
  const clusters = clusterDeals(deals, (d) => ({ x: d.lon, y: d.lat }), 56);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].deals.length, 4);
  assert.equal(clusterDeals([], projectByIndex(deals), 56).length, 0);
});
