#!/usr/bin/env node
// 완료정의[3]: 실패-only 운영 알림.
// 트리거: 배치 전멸(잡 실패)·딜–오퍼 조인 비율 미달(부분 성공)·합성 체크 실패·collect-fares 실패.
// OPS_ALERT_WEBHOOK_URL이 없으면 조용히 스킵(exit 0) — 알림 부재가 배치 잡을 실패시키지 않는다.
// URL이 있는데 전송에 실패하면 exit 1(잡 로그·GitHub 실패 메일로 표면화).
// 페이로드는 한 줄 수준(상태·노출 가능 딜 수·스테일 비율 대행 지표·마지막 성공)만 — 시크릿·개인정보 금지.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { sendOpsAlert, validateOpsAlertWebhookUrl } from "./ops-alert-smoke.mjs";

export async function sendFailureAlert(payload, options = {}) {
  const webhookUrl = options.webhookUrl ?? process.env.OPS_ALERT_WEBHOOK_URL;
  const validation = validateOpsAlertWebhookUrl(webhookUrl);
  if (!validation.ok) {
    return { sent: false, skipped: true, reason: validation.reason };
  }
  return sendOpsAlert(payload, { ...options, webhookUrl });
}

// 러너 summary(JSON)에서 알림에 실을 한 줄 지표만 추린다 — 원본 통째로 전송 금지.
export function failureAlertFieldsFromSummary(summary) {
  const dealJoin = summary?.deal_join ?? {};
  return {
    status: summary?.status ?? null,
    sources_total: summary?.sources_total ?? null,
    succeeded: summary?.succeeded ?? null,
    failed: summary?.failed ?? null,
    active_deals: dealJoin.active_deals ?? null,
    active_deals_with_live_offers: dealJoin.active_deals_with_live_offers ?? null,
    deal_offer_join_ratio: dealJoin.deal_offer_join_ratio ?? null,
    deal_join_ratio_below_min: dealJoin.below_threshold ?? null,
    revalidation_status: summary?.revalidation_status ?? null,
  };
}

function parseArgs(argv) {
  const args = { event: "", summaryFile: "", message: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--event") {
      args.event = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--summary-file") {
      args.summaryFile = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--message") {
      args.message = argv[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.event) throw new Error("--event must not be empty");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = args.summaryFile
    ? JSON.parse(await readFile(args.summaryFile, "utf8"))
    : null;
  const output = await sendFailureAlert({
    event: args.event,
    ...(args.message ? { message: args.message } : {}),
    ...(summary ? failureAlertFieldsFromSummary(summary) : {}),
  });
  console.log(JSON.stringify(output, null, 2));
  if (!output.skipped && !output.sent) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Ops failure alert failed.");
    console.error(err);
    process.exit(1);
  });
}
