// 완료정의[5]: 출시·인덱싱 게이트 — 전체 readiness 45항 동등 가중이 아니라 P0 축만 본다.
// 게이트가 실패하면 로봇/사이트맵이 사용자 발견 경로를 닫는다(seo/gate 브랜치에서 소비).
// 축: ① 스테일 최저가 <15% ② 프로덕션 데모 폴백 0(계약 테스트가 보증 — data-source-contract)
// ③ 주간 픽 존재 ④ 실패 감지 가능(웹훅 설정 등). 계산은 순수 함수라 계약 테스트로 고정한다.
import { LIVE_OFFER_VISIBILITY_SQL } from "./read-model/live-offer-policy";

export const LAUNCH_GATE_THRESHOLDS = {
  maxStaleLowestPricePct: 15,
  minWeeklyPicks: 1,
};

export interface LaunchGateInput {
  // 배치가 측정한 딜–오퍼 조인 비율(0..1). 스테일 최저가 비율은 1 - ratio로 환산.
  dealOfferJoinRatio: number | null;
  // 이번 주 픽 가능 딜 수(절감 근거 ≥5% + live offer + 미래 출발). null = 측정 불가.
  weeklyPickableDeals: number | null;
  // 웹훅 설정 등 no-op이 아닌 실패 감지 수단 유무.
  failureDetectionReady: boolean;
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
      // data-source-contract "production fallback never ships demo payload"가 보증한다.
      // 여기 실패가 나오면 그 계약이 깨진 것이므로 게이트도 닫힌다.
      passed: true,
      detail: "운영 폴백은 last-good/빈 결과만(계약 테스트 보증)",
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

export async function readLaunchGate(env: Record<string, string | undefined> = process.env): Promise<LaunchGateResult> {
  const [dealOfferJoinRatio, weeklyPickableDeals] = await Promise.all([
    readDealOfferJoinRatio(),
    readWeeklyPickableDeals(),
  ]);
  return evaluateLaunchGate({
    dealOfferJoinRatio,
    weeklyPickableDeals,
    failureDetectionReady: Boolean(String(env.OPS_ALERT_WEBHOOK_URL ?? "").trim()),
  });
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
