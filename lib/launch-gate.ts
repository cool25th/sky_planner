// 완료정의[5]: 출시·인덱싱 게이트 — 전체 readiness 45항 동등 가중이 아니라 P0 축만 본다.
// 게이트가 실패하면 로봇/사이트맵이 사용자 발견 경로를 닫는다(seo/gate 브랜치에서 소비).
// 축: ① 스테일 최저가 <15% ② 프로덕션 데모 폴백 0(계약 테스트가 보증 — data-source-contract)
// ③ 주간 픽 존재 ④ 실패 감지 가능(웹훅 설정 등). 계산은 순수 함수라 계약 테스트로 고정한다.
import { LIVE_OFFER_VISIBILITY_SQL } from "./read-model/live-offer-policy";
import { siteUrl } from "./url";

export const LAUNCH_GATE_THRESHOLDS = {
  maxStaleLowestPricePct: 15,
  minWeeklyPicks: 1,
  // UX-20260910-004: 기본 뷰(현재 주차·5_7·ICN 메트로)의 live 도시 수 하한 — 죽어가는 주차에
  // 지도가 퇴화하면 첫인상이 고착된다(다른 4축과 같은 맥락). fail-closed 색인 축에 포함한다.
  minDefaultViewCities: 5,
};

export interface LaunchGateInput {
  // 배치가 측정한 딜–오퍼 조인 비율(0..1). 스테일 최저가 비율은 1 - ratio로 환산.
  dealOfferJoinRatio: number | null;
  // 이번 주 픽 가능 딜 수(절감 근거 ≥5% + live offer + 미래 출발). null = 측정 불가.
  weeklyPickableDeals: number | null;
  // 웹훅 설정 등 no-op이 아닌 실패 감지 수단 유무.
  failureDetectionReady: boolean;
  // H6: 배포된 map API의 data_mode가 'demo'로 런타임 관측됐는가. null = 관측 실패(fail-closed).
  demoObserved: boolean | null;
  // 기본 뷰(ICN·현재 주차·5_7·adt1)의 live 도시 수. null = 측정 불가(fail-closed).
  defaultViewCities: number | null;
}

export interface LaunchGateCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface LaunchGateResult {
  passed: boolean;
  stale_lowest_price_pct: number | null;
  checks: LaunchGateCheck[];
}

export function evaluateLaunchGate(input: LaunchGateInput): LaunchGateResult {
  const stalePct = input.dealOfferJoinRatio === null
    ? null
    : Number(((1 - input.dealOfferJoinRatio) * 100).toFixed(1));
  const checks: LaunchGateCheck[] = [
    {
      id: "stale_lowest_price_under_threshold",
      label: `스테일 최저가 < ${LAUNCH_GATE_THRESHOLDS.maxStaleLowestPricePct}%`,
      passed: stalePct !== null && stalePct < LAUNCH_GATE_THRESHOLDS.maxStaleLowestPricePct,
      detail: stalePct === null ? "딜–오퍼 조인 비율 미측정" : `스테일 최저가 ${stalePct}%`,
    },
    {
      id: "demo_fallback_absent",
      label: "프로덕션 데모 폴백 0",
      // H6: 고무도장 대신 런타임 관측 — map API data_mode가 'demo'면 실패, 관측 실패는 fail-closed.
      passed: input.demoObserved === false,
      detail: input.demoObserved === null
        ? "map API 관측 실패(fail-closed)"
        : input.demoObserved
          ? "map API가 demo 모드로 관측됨"
          : "map API data_mode가 demo가 아님(런타임 관측)",
    },
    {
      id: "weekly_picks_present",
      label: `주간 픽 존재(≥${LAUNCH_GATE_THRESHOLDS.minWeeklyPicks})`,
      passed: input.weeklyPickableDeals !== null && input.weeklyPickableDeals >= LAUNCH_GATE_THRESHOLDS.minWeeklyPicks,
      detail: input.weeklyPickableDeals === null ? "픽 가능 딜 수 미측정" : `픽 가능 딜 ${input.weeklyPickableDeals}건`,
    },
    {
      id: "failure_detection_ready",
      label: "실패 감지 가능(웹훅 등)",
      passed: input.failureDetectionReady,
      detail: input.failureDetectionReady ? "실패-only 알림 채널 구성됨" : "OPS_ALERT_WEBHOOK_URL 미설정",
    },
    {
      id: "default_view_city_floor",
      label: `기본 뷰 도시 ≥ ${LAUNCH_GATE_THRESHOLDS.minDefaultViewCities}`,
      passed: input.defaultViewCities !== null && input.defaultViewCities >= LAUNCH_GATE_THRESHOLDS.minDefaultViewCities,
      detail: input.defaultViewCities === null
        ? "기본 뷰 도시 수 미측정"
        : `기본 뷰 ${input.defaultViewCities}개 도시`,
    },
  ];
  return { passed: checks.every((check) => check.passed), stale_lowest_price_pct: stalePct, checks };
}

export function postgresConfigured() {
  return Boolean(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
}

async function readDealOfferJoinRatio(): Promise<number | null> {
  if (!postgresConfigured()) return null;
  try {
    const { query } = await import("./db");
    const { rows } = await query("SELECT data FROM batch_state WHERE key = 'last_batch' LIMIT 1");
    const ratio = rows[0]?.data?.deal_join_ratio;
    return typeof ratio === "number" ? ratio : null;
  } catch {
    return null;
  }
}

// 픽 가능 딜(4필드 가드의 저렴한 상위 집합): live offer 보유 + 절감 근거 ≥5% + 미래 출발.
async function readWeeklyPickableDeals(): Promise<number | null> {
  if (!postgresConfigured()) return null;
  try {
    const { query } = await import("./db");
    const { rows } = await query(`
      SELECT count(*)::int AS pickable
      FROM deals_current d
      WHERE d.is_active = true
        AND COALESCE(d.economy_discount_pct, 0) >= 5
        AND COALESCE(d.economy_best_depart_date, '1970-01-01') >= to_char(CURRENT_DATE, 'YYYY-MM-DD')
        AND EXISTS (
          SELECT 1 FROM offers o
          WHERE o.origin_airport = d.origin
            AND o.destination_city_id = d.destination_city_id
            AND o.week = d.week
            AND o.stay_bucket = d.stay_bucket
            AND o.traveler = d.traveler
            AND o.cabin_group = 'economy'
            AND ${LIVE_OFFER_VISIBILITY_SQL}
        )
    `);
    return rows[0]?.pickable ?? null;
  } catch {
    return null;
  }
}

// H6: 배포된 자신의 map API를 관측해 data_mode가 'demo'인지 본다 — 문서가 아닌 사용자가 보는 상태.
// 도달 실패·비정상 응답은 null(fail-closed). unavailable(503 포함)은 데모가 아니지만 관측 실패로 닫는다.
async function probeMapDataMode(): Promise<boolean | null> {
  try {
    const response = await fetch(`${siteUrl}/api/deals/map?origin=ICN&region=ALL&cabin=ALL&stay_bucket=5_7&traveler=adt1`, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { diagnostics?: { data_mode?: string } };
    const mode = payload?.diagnostics?.data_mode;
    if (mode !== "live" && mode !== "last_good" && mode !== "demo") return null;
    return mode === "demo";
  } catch {
    return null;
  }
}

export async function readLaunchGate(env: Record<string, string | undefined> = process.env): Promise<LaunchGateResult> {
  const [dealOfferJoinRatio, weeklyPickableDeals, demoObserved, defaultViewCities] = await Promise.all([
    readDealOfferJoinRatio(),
    readWeeklyPickableDeals(),
    probeMapDataMode(),
    readDefaultViewCities(),
  ]);
  return evaluateLaunchGate({
    dealOfferJoinRatio,
    weeklyPickableDeals,
    failureDetectionReady: Boolean(String(env.OPS_ALERT_WEBHOOK_URL ?? "").trim()),
    demoObserved,
    defaultViewCities,
  });
}

// 기본 뷰 도시 수 — /map 기본 조회(현재 주차·5_7·ICN 메트로·live 조인)와 동일 의미론.
// 주간 자동 진행(UX-20260830-003: 0딸 → 다음 주간)을 미러링해 현재 주차 0개면 다음 주차로 잰다.
async function readDefaultViewCities(): Promise<number | null> {
  if (!postgresConfigured()) return null;
  try {
    const { query } = await import("./db");
    const { currentWeekStart, isoWeekCode } = await import("./mock-market");
    const { queryOrigins } = await import("./read-model/labels");
    const nextMonday = new Date(currentWeekStart().getTime() + 7 * 86_400_000);
    const countFor = async (week: string) => {
      const { rows } = await query(`
        WITH live AS (
          SELECT DISTINCT o.origin_airport, o.destination_city_id, o.week, o.stay_bucket, o.traveler
          FROM offers o
          WHERE o.origin_airport = ANY($1::text[])
            AND o.traveler = 'adt1'
            AND o.week = $2
            AND o.stay_bucket = '5_7'
            AND ${LIVE_OFFER_VISIBILITY_SQL}
        )
        SELECT count(DISTINCT d.destination_city_id)::int AS cities
        FROM deals_current d
        JOIN live l ON l.origin_airport = d.origin
          AND l.destination_city_id = d.destination_city_id
          AND l.week = d.week
          AND l.stay_bucket = d.stay_bucket
          AND l.traveler = d.traveler
        WHERE d.is_active = true
          AND d.origin = ANY($1::text[])
          AND d.week = $2
          AND d.traveler = 'adt1'
          AND d.stay_bucket = '5_7'
          AND GREATEST(COALESCE(d.economy_best_depart_date, '1970-01-01'), COALESCE(d.business_best_depart_date, '1970-01-01')) >= to_char(CURRENT_DATE, 'YYYY-MM-DD')
      `, [queryOrigins("ICN"), week]);
      return rows[0]?.cities ?? 0;
    };
    const current = await countFor(isoWeekCode(currentWeekStart()));
    return current > 0 ? current : await countFor(isoWeekCode(nextMonday));
  } catch {
    return null;
  }
}

// 오퍼 0장 목적지는 허브/사이트맵에 올리지 않는다(완료정의[4]/[7]).
export async function liveOfferDestinationIds(): Promise<string[]> {
  if (!postgresConfigured()) return [];
  try {
    const { query } = await import("./db");
    const { rows } = await query(`
      SELECT DISTINCT o.destination_city_id
      FROM offers o
      WHERE ${LIVE_OFFER_VISIBILITY_SQL}
      ORDER BY 1
    `);
    return rows.map((row) => String(row.destination_city_id ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}
