import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
test("synthetic check observes the deployed map and alerts only on failure", async () => {
  const yaml = await workflow("synthetic-check.yml");
  assert.match(yaml, /cron: "37 \*\/6 \* \* \*"/);
  assert.match(yaml, /diagnostics\.data_mode/);
  assert.match(yaml, /"\$mode" != "live"/);
  assert.match(yaml, /"\$mode" != "last_good"/);
  assert.match(yaml, /data\.deals \| length/);
  assert.match(yaml, /-lt 1/);
  assert.match(yaml, /if: failure\(\)/);
  assert.match(yaml, /webhook not configured — alert skipped/);
  assert.match(yaml, /synthetic_check_failed/);
});

// 배치 알림: 잡 실패(daily_batch_failed)와 조인 비율 미달(deal_join_ratio_below_min) 2축.
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
