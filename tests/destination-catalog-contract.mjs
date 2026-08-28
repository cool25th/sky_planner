import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getDestinationList } from "../lib/mock-market.ts";

// 목적지 카탈로그 동기화 계약: UI가 아는 목적지(시드)와 수집기가 수용하는 목적지(매니페스트
// places_lookup)는 항상 같은 집합이어야 한다 — 어느 한쪽만 추가되면 "UI에 있는데 데이터가 없는
// 목적지" 또는 "데이터가 오는데 표시 못 하는 목적지"가 생긴다.
const manifestPath = new URL("../configs/collector-source-manifest.travelpayouts.json", import.meta.url);

test("seed destinations and collector manifest places lookup stay in sync", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  const lookup = manifest.sources[0].config.response_mapping.places_lookup;
  assert.equal(lookup.drop_unmatched, true, "drop_unmatched stays true so unknown cities are ignored");

  const seedCodes = new Set(getDestinationList().map((destination) => destination.code));
  const lookupCodes = new Set(Object.keys(lookup.entries));

  const missingInLookup = [...seedCodes].filter((code) => !lookupCodes.has(code));
  const missingInSeed = [...lookupCodes].filter((code) => !seedCodes.has(code));
  assert.deepEqual(
    { missingInLookup, missingInSeed },
    { missingInLookup: [], missingInSeed: [] },
    "목적지를 추가할 때는 lib/mock-market.ts 시드와 매니페스트 places_lookup 양쪽에 함께 추가한다",
  );

  for (const [code, entry] of Object.entries(lookup.entries)) {
    assert.match(entry.display_name_ko, /\S/, `${code} display_name_ko required`);
    assert.match(entry.country_code, /^[A-Z]{2}$/, `${code} country_code must be ISO-2`);
    assert.ok(typeof entry.latitude === "number" && typeof entry.longitude === "number", `${code} coords required`);
  }
});
