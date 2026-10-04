#!/usr/bin/env node
// UX-20260910-007: 무인 실측 루프(6시간 합성 체크)의 실질화 — 제품 수치 측정 + 관측 증거 기록.
//
// 역할(완료정의[3]/H7 분리 유지): "방문자가 지금 가짜/빈 화면을 보는가"에 제품 회귀 축을 더한다.
//   ① /map 기본 뷰 도시 수 ≥ 5(launch-gate 제5축과 같은 하한)
//   ② /offers 샘플 dedup 위반 = 0(동일 (depart,return,price,carrier) 조합 2건 이상 금지)
//   ③ 홈 주간 픽 가능 딜 ≥ 1(launch-gate 주간 픽 축과 동일)
// 측정 결과는 batch_state 'synthetic_check' 하트비트로 Neon에 기록된다 — launch-gate 4축
// "실패 감지 가능"의 관측 증거(12h 내 실행)가 이 기록이다. 임계 미달은 exit 1(회귀 인식).
// 웹훅 알림은 기존대로 실패 시에만(워크플로 마지막 스텝).
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import pg from "pg";

const { Client } = pg;
const SITE_URL = process.env.SITE_URL ?? "https://skyplanner-kappa.vercel.app";
const MAP_API = `${SITE_URL}/api/deals/map?origin=ICN&region=ALL&cabin=ALL&stay_bucket=5_7&traveler=adt1`;

export const SYNTHETIC_PRODUCT_THRESHOLDS = {
  minMapCities: 5,
  maxOffersDedupViolations: 0,
  minWeeklyPickableDeals: 1,
  maxSitemapBrokenUrls: 0,
};

// 외부 검토 2026-10-04(P0): 색인 진입 URL이 오류 화면을 렌더하는지 게이트가 전혀 안 봤다 —
// 사이트맵 전 URL을 JS 없이 받아 사용자가 볼 오류 문구를 검사한다.
const SITEMAP_ERROR_MARKERS = [
  "목적지 정보를 불러올 수 없습니다", // 베어 /destination이 목적지 셸 대신 오류 문구로 떨어짐
  "운임 데이터를 표시할 수 없습니다", // /offers가 조건 안내 대신 장애 안내로 떨어짐
];

export async function findBrokenSitemapUrls(fetchImpl = ((url, init) => fetch(url, init)), limit = 30) {
  const response = await fetchImpl(`${SITE_URL}/sitemap.xml`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`sitemap.xml → HTTP ${response.status}`);
  const xml = await response.text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]).slice(0, limit);
  const broken = [];
  for (const url of urls) {
    try {
      const page = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
      const html = await page.text();
      if (!page.ok) broken.push(`${url} → HTTP ${page.status}`);
      else {
        const marker = SITEMAP_ERROR_MARKERS.find((text) => html.includes(text));
        if (marker) broken.push(`${url} → 오류 문구 "${marker}"`);
      }
    } catch (error) {
      broken.push(`${url} → ${error?.message ?? error}`);
    }
  }
  return broken;
}

async function fetchJson(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.json();
}

export function countDedupViolations(offers) {
  const seen = new Map();
  let violations = 0;
  for (const offer of offers) {
    const key = `${offer.depart_date}|${offer.return_date}|${offer.price_total}|${offer.airline_code}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 2) violations += 1; // 조합당 1건 초과분부터 위반
  }
  return violations;
}

export async function runSyntheticCheck(options = {}) {
  const thresholds = { ...SYNTHETIC_PRODUCT_THRESHOLDS, ...(options.thresholds ?? {}) };
  const result = {
    ran_at: new Date().toISOString(),
    status: "fail",
    map_mode: null,
    live_deals: 0,
    map_cities: 0,
    week_depleted: false,
    offers_sample_size: 0,
    offers_dedup_violations: null,
    pickable_deals: null,
    sitemap_broken_urls: [],
    regressions: [],
  };

  try {
    // ① 지도 기본 뷰 — 기존 관측(가짜/빈 화면) + 도시 수 하한
    const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    const mapPayload = await fetchJson(options.mapApiUrl ?? MAP_API, fetchImpl);
    result.map_mode = mapPayload?.diagnostics?.data_mode ?? "missing";
    result.live_deals = mapPayload?.data?.deals?.length ?? 0;
    result.map_cities = result.live_deals; // deals = 목적지(도시) 단위
    if (result.map_mode !== "live" && result.map_mode !== "last_good") {
      result.regressions.push(`unexpected data_mode: ${result.map_mode}`);
    } else if (result.map_cities < thresholds.minMapCities) {
      // 외부 검토 2026-10-04(자가 인식 §5 수리): 주 말에는 이번 주 잔여 출발이 소진돼 도시 수가
      // 하한(0 포함) 미달이 된다(매주 금~일 반복·월요일 회복 관측). 다음 주 대안이 하한을 충족하면
      // 제품은 정상이다 — 소진 플래그만 남기고 회귀로 세지 않는다.
      const weekAlternative = (mapPayload?.data?.alternatives ?? []).find(
        (alt) => alt.kind === "week" && alt.cities >= thresholds.minMapCities,
      );
      if (weekAlternative) {
        result.week_depleted = true;
      } else {
        result.regressions.push(result.live_deals < 1
          ? "no displayable deals"
          : `map cities ${result.map_cities} < ${thresholds.minMapCities}`);
      }
    }

    // ② /offers 샘플 dedup 위반 — 지도 첫 딜의 최저가 날짜 조합으로 표본 조회
    const sample = mapPayload?.data?.deals?.[0];
    if (sample?.economy_best_depart_date && sample?.economy_best_return_date) {
      const offersUrl = `${SITE_URL}/api/offers?origin=ICN&destination=${sample.destination_code}&depart=${sample.economy_best_depart_date}&return=${sample.economy_best_return_date}`;
      const offersPayload = await fetchJson(offersUrl, fetchImpl);
      const offers = offersPayload?.data?.offers ?? [];
      result.offers_sample_size = offers.length;
      result.offers_dedup_violations = countDedupViolations(offers);
      if (result.offers_dedup_violations > thresholds.maxOffersDedupViolations) {
        result.regressions.push(`offers dedup violations ${result.offers_dedup_violations} > ${thresholds.maxOffersDedupViolations}`);
      }
    }

    // ③ 주간 픽 가능 딜 — launch-gate API의 픽 축 재사용(같은 SQL, 독립 실행).
    // 게이트 실패 시 라우트는 설계상 503으로 응답하지만 본문은 JSON이다 — 상태코드가 아니라
    // 본문의 축 값을 읽는다(관측과 판정은 별개다).
    const gateResponse = await fetchImpl(options.launchGateUrl ?? `${SITE_URL}/api/ops/launch-gate`, { signal: AbortSignal.timeout(30000) });
    const gatePayload = await gateResponse.json().catch(() => null);
    const pickable = gatePayload?.checks?.find((check) => check.id === "weekly_picks_present");
    const detailMatch = /픽 가능 딜 (\d+)건/.exec(pickable?.detail ?? "");
    if (detailMatch) {
      result.pickable_deals = Number(detailMatch[1]);
      if (result.pickable_deals < thresholds.minWeeklyPickableDeals) {
        result.regressions.push(`pickable deals ${result.pickable_deals} < ${thresholds.minWeeklyPickableDeals}`);
      }
    }

    // ④ 색인 진입 URL 크롤 — 외부 검토 2026-10-04(P0): 게이트가 "사용자가 보는 결과"를 안 봤다.
    if (options.crawlSitemap !== false) {
      result.sitemap_broken_urls = await findBrokenSitemapUrls(fetchImpl).catch((error) => [
        `sitemap crawl failed: ${error?.message ?? error}`,
      ]);
      if (result.sitemap_broken_urls.length > thresholds.maxSitemapBrokenUrls) {
        result.regressions.push(`sitemap broken urls ${result.sitemap_broken_urls.length} > ${thresholds.maxSitemapBrokenUrls}`);
      }
    }
  } catch (error) {
    result.regressions.push(`observation failed: ${error?.message ?? error}`);
  }

  result.status = result.regressions.length ? "fail" : "pass";
  return result;
}

// 관측 증거 기록 — 러너가 ingest 롤(DATABASE_INGEST_URL)로 batch_state에 직접 기록한다.
// BFF(read 롤)에 쓰기 경로를 만들지 않는다(ADR-006) — 워크플로가 npm install --no-save pg로 준비.
export async function recordSyntheticHeartbeat(result, options = {}) {
  const connectionString = options.connectionString ?? process.env.DATABASE_INGEST_URL ?? process.env.DATABASE_URL;
  if (!connectionString) return false;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      INSERT INTO batch_state (key, data)
      VALUES ('synthetic_check', $1::jsonb)
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `, [JSON.stringify(result)]);
    return true;
  } finally {
    await client.end();
  }
}

async function main() {
  const result = await runSyntheticCheck();
  const recorded = await recordSyntheticHeartbeat(result).catch((error) => {
    console.warn("heartbeat write failed:", error?.message ?? error);
    return false;
  });
  console.log(JSON.stringify({ ...result, heartbeat_recorded: recorded }, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.map_mode ?? "unreachable"}\ndeals=${result.live_deals}\ncities=${result.map_cities}\n`);
  }
  process.exit(result.status === "pass" ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
