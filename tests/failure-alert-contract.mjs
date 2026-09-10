import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  failureAlertFieldsFromSummary,
  sendFailureAlert,
} from "../scripts/ops-failure-alert.mjs";

// 완료정의[3]: 실패-only 웹훅 + 합성 체크 계약.
// URL 없으면 조용히 스킵, 있으면 실패 시 1회 핑. 페이로드는 한 줄 지표만(시크릿·개인정보 금지).

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function workflow(name) {
  return readFileSync(join(repoRoot, ".github/workflows", name), "utf8");
}

test("failure alert skips quietly when the webhook URL is absent", async () => {
  const result = await sendFailureAlert(
    { event: "daily_batch_failed", status: "failed" },
    { webhookUrl: "" },
  );
  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "missing");
});

test("failure alert posts a one-line summary payload when configured", async () => {
  let request = null;
  const result = await sendFailureAlert(
    {
      event: "deal_join_ratio_below_min",
      ...failureAlertFieldsFromSummary({
        status: "success",
        sources_total: 30,
        succeeded: 28,
        failed: 2,
        deal_join: {
          active_deals: 1036,
          active_deals_with_live_offers: 695,
          deal_offer_join_ratio: 0.6708,
          below_threshold: true,
        },
        revalidation_status: "revalidated",
      }),
    },
    {
      webhookUrl: "https://hooks.skyplanner.co.kr/service",
      fetchImpl: async (url, options) => {
        request = { url, options };
        return { ok: true, status: 204 };
      },
    },
  );
  assert.equal(result.sent, true);
  const body = JSON.parse(request.options.body);
  assert.equal(body.event, "deal_join_ratio_below_min");
  assert.equal(body.active_deals, 1036);
  assert.equal(body.deal_offer_join_ratio, 0.6708);
  assert.equal(body.deal_join_ratio_below_min, true);
  assert.equal(body.revalidation_status, "revalidated");
  // 원본 summary 통째로 전송 금지 — 결과 배열·아티팩트 경로 등은 실리지 않는다.
  assert.equal(body.results, undefined);
  assert.equal(body.deal_join, undefined);
});

// 합성 체크: 방문자 높이에서 live 딜 수>0을 6시간 주기로 관측하고 실패 시에만 웹훅.
// H7: 역할 분리 — 합성=사용자 높이(demo/unavailable/unreachable/0딸 실패, last_good 성공),
// 배치 전멸 감지는 daily-batch 알림 몫(주기 단축으로 Actions 분을 태우지 않는다).
test("synthetic check observes the deployed map and alerts only on failure", async () => {
  const yaml = await workflow("synthetic-check.yml");
  assert.match(yaml, /cron: "37 \*\/6 \* \* \*"/);
  // UX-20260910-007: 관측 로직은 스크립트가 담당(제품 수치+하트비트) — 워크플로는 실행·알림만.
  assert.match(yaml, /node scripts\/ops-synthetic-check\.mjs/);
  assert.match(yaml, /if: failure\(\)/);
  assert.match(yaml, /webhook not configured — alert skipped/);
  assert.match(yaml, /synthetic_check_failed/);
  // 역할 분리가 주석과 계약에 명시돼 있다.
  assert.match(yaml, /방문자가 지금 가짜\/빈 화면을 보는가/, "합성 체크의 역할 정의가 사라졌다");
  assert.match(yaml, /배치 전멸 감지.*daily-batch/, "전멸 감지가 배치 알림 몫이라는 분리 명시가 없다");

  const script = readFileSync("scripts/ops-synthetic-check.mjs", "utf8");
  assert.match(script, /data_mode/, "모드 관측이 스크립트에 산다");
  assert.match(script, /last_good/, "last_good 완화 경로 유지");
  assert.match(script, /no displayable deals/);
  assert.match(script, /synthetic_check/, "하트비트 기록 키");
});

// 배치 알림: 잡 실패(daily_batch_failed)와 조인 비율 미달(deal_join_ratio_below_min) 2축.
// H3(2026-09-08 핫픽스): 재시도 성공=잡 성공, 쌍실패=baseline 스킵+알림 1회, 인자 한 줄 명령.
test("daily batch wires failure and join-ratio-breach alerts", async () => {
  const yaml = await workflow("daily-batch.yml");
  assert.match(yaml, /ops-failure-alert\.mjs/);
  assert.match(yaml, /--event daily_batch_failed/);
  assert.match(yaml, /--event deal_join_ratio_below_min/);
  assert.match(yaml, /\.deal_join\.below_threshold/);
  // 요약 캡처: pipefail 없이 tee하면 npm 실패가 잡 실패로 전파되지 않는다.
  assert.match(yaml, /set -o pipefail/);
  assert.match(yaml, /tee runtime\/collector-summary\.json/);
});

test("daily batch retry semantics: retry success is job success, double failure skips baseline", async () => {
  const yaml = await workflow("daily-batch.yml");

  // run: | 안에서 인자를 내려쓰면 별도 명령이 돼 유실된다 — 한 논리 명령이어야 한다.
  const command = "npm run collector:sources -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON --ingest --audit-failure --allow-partial | tee runtime/collector-summary.json";
  assert.ok(yaml.includes(command), "수집 커맨드가 한 줄로 존재해야 한다(인자 유실 방지)");
  assert.ok(!/\n\s+npm run collector:sources --\s*\n\s+--manifest-env/.test(yaml), "내려쓴 인자 라인이 남아 있으면 별도 명령으로 실행된다");

  // 첫 수집은 continue-on-error — 재시도 성공 시 잡이 성공해야 한다.
  assert.match(yaml, /continue-on-error: true/);
  // 재시도는 collect 실패 시에만.
  assert.match(yaml, /if: \$\{\{ steps\.collect\.outcome == 'failure' && env\.READY == 'true' \}\}/);
  // baseline/probe는 수집(또는 재시도) 성공 후에만 — 쌍실패 시 스테일 캐시 오염 방지.
  assert.match(yaml, /steps\.collect\.outcome == 'success' \|\| steps\.retry\.outcome == 'success'/);
  const baselineIndex = yaml.indexOf("Update price baselines");
  const baselineCondition = yaml.slice(baselineIndex, yaml.indexOf("run: npm run baseline:update"));
  assert.match(baselineCondition, /steps\.retry\.outcome == 'success'/, "baseline 조건에 재시도 성공이 포함돼야 한다");
  // 실패 알림은 쌍실패일 때만 1회 — 재시도 복구는 알림 없음.
  assert.match(yaml, /steps\.collect\.outcome == 'failure' && steps\.retry\.outcome != 'success'/);
  // 죽은 env 제거: 이 스텝 커맨드는 SOURCE_MAX_STALE_HOURS를 읽지 않는다(48 승인과 충돌 방지).
  assert.ok(!yaml.includes('SOURCE_MAX_STALE_HOURS: "24"'), "daily-batch에 24 하드코딩이 남으면 48 env 승인과 해석이 갈라진다");
});

// 워치독 개입(배치 20h 초과·판독 불가)도 알림 트리거다.
test("watchdog intervention alerts the ops channel", async () => {
  const yaml = await workflow("batch-watchdog.yml");
  assert.match(yaml, /batch_watchdog_intervened/);
  assert.match(yaml, /webhook not configured — alert skipped/);
});

// collect-fares 연속 실패(2026-09-08 기준 5연속)도 웹훅 트리거다.
test("collect-fares failure alerts the ops channel", async () => {
  const yaml = await workflow("collect-fares.yml");
  assert.match(yaml, /--event collect_fares_failed/);
  assert.match(yaml, /if: \$\{\{ failure\(\) && env\.READY == 'true' \}\}/);
});
