#!/usr/bin/env node
// OPS-20260911-002: Neon 무료 티어(스토리지 0.5GB) 지속 사용 — expire_at 계약의 소비자.
// 2026-09-04(DATA-20260904-001)·09-10(INT-20260904-001)까지 쓰기 경로만 있었던 만료 스탬프의
// 삭제 주체가 없어 행이 단조 증가했다(2026-09-11 mock 오퍼 131,712행 청소의 교훈: 아무 정책도
// 수명을 소유하지 않으면 전환 잔여가 공간으로 남는다).
//
// 삭제 대상(전부 소량·일일 만료분 — §16의 대규모 DELETE가 아니다):
//   source_jobs      완료+30일(INT-20260904-001 계약) — 첫 만료 2026-10-10
//   fare_snapshots   수집+90일(DATA-20260904-001 계약)   — 첫 만료 2026-12-02
//   offers           60일 무관측(last_seen_at) — 표시는 72h live 조인이 지배해 고가치 없음.
//                    지문은 수신분 PK 조회(2026-09-11)로 offers 테이블만 보므로, 같은 오퍼가
//                    보존 기간 뒤 돌아오면 "변경"으로 재적재된다(자기 치유 — 무해).
// FK가 없어 포인터 댕글링은 무해(deals best_offer_id는 표시에 사용하지 않는다 — DATA-20260906-001).
// 실패 정책: DB 오류는 경고 + exit 0(배치를 실패시키지 않는다) — 스토리지 추이는 루프가 매일 관측.
import { pathToFileURL } from "node:url";

import pg from "pg";

const { Client } = pg;

// 오퍼 무관측 보존 기간(일) — 72h 표시 창의 ~20배 여유. 스토리지 추이 관측 후 조정 지점.
export const OFFER_RETENTION_DAYS = 60;

export async function enforceRetention(client, now = new Date()) {
  const results = {};
  // expire_at IS NOT NULL 가드: 스탬프 전(역사) 행은 계약상 보존 — 신규 행부터 만료가 도래한다.
  const jobs = await client.query("DELETE FROM source_jobs WHERE expire_at IS NOT NULL AND expire_at < $1", [now]);
  results.source_jobs_deleted = jobs.rowCount ?? 0;
  const snaps = await client.query("DELETE FROM fare_snapshots WHERE expire_at IS NOT NULL AND expire_at < $1", [now]);
  results.fare_snapshots_deleted = snaps.rowCount ?? 0;
  const offers = await client.query(
    "DELETE FROM offers WHERE last_seen_at IS NOT NULL AND last_seen_at < $1",
    [new Date(now.getTime() - OFFER_RETENTION_DAYS * 24 * 60 * 60 * 1000)],
  );
  results.offers_deleted = offers.rowCount ?? 0;
  return results;
}

function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_INGEST_URL ?? process.env.DATABASE_URL ?? "",
  });
  client
    .connect()
    .then(() => enforceRetention(client))
    .then((results) => {
      console.log(JSON.stringify({ status: "ok", ...results }, null, 2));
      return client.end();
    })
    .catch((error) => {
      console.warn("[enforce-retention] 실패 — 배치를 실패시키지 않는다:", error?.message ?? error);
      client.end().catch(() => {});
      process.exit(0);
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
