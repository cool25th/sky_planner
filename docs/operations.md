# 운영 가이드 (Operations Runbook)

배치 수집, read model 구성, 출시 gate 등 운영 관련 상세 절차를 다룬다.
애플리케이션 개요와 실행 방법은 [README](../README.md)를 참고한다.

## 데이터 백엔드 구성 (중요)

- **PostgreSQL read model이 canonical 데이터 경로다.** 검색/지도/캘린더/오퍼 API는 `DATABASE_READ_URL` 또는 `DATABASE_URL`로 read model을 조회하고(`lib/read-model/`), 실패 시에만 mock으로 fallback한다. 운영에서는 반드시 `SERVICE_REQUIRE_POSTGRES=true`로 mock fallback을 차단해 503을 반환해야 한다.
- **Firestore는 감사(audit) sink다.** `scripts/publish-firestore-batch.mjs`가 배치를 적재하면 `smoke-firestore-read`, `cleanup-old-batches`가 이를 검증/정리하고 quota audit(`scripts/audit-firestore-quota.mjs`)이 무료 한도 사용량을 감시한다. 앱 런타임은 Firestore를 조회하지 않는다(구 repository 계층은 제거됨).
- 진위 판별은 응답의 `diagnostics`로 한다: `read_model: "postgres"`, `fallback_used: false`, `source_readiness.status: "ready"`여야 실제 read model 응답이다.

## PostgreSQL read model

```bash
docker compose up -d db
npm run db:seed
DATABASE_URL=postgresql://sky_planner:sky_planner_dev@localhost:5433/sky_planner npm run dev
```

`npm run db:seed`는 deterministic mock market을 `places`, `offers`, `fare_snapshots`, `deals_current`, `source_health`, `batch_state`에 적재한다. DDL은 `sql/init/*.sql`이며 `npm run db:migrate`가 `DATABASE_MIGRATION_URL`로 적용한다.

### DB 계정 분리 (REQ-DB-002)

`sql/init/002_roles.sql`이 `sky_planner_read`(조회 전용), `sky_planner_ingest`(적재 제한 쓰기), `sky_planner_migration`(DDL) 롤을 만들고 소유권을 migration 롤로 이전한다. 운영 연결은 `DATABASE_READ_URL` / `DATABASE_INGEST_URL` / `DATABASE_MIGRATION_URL` 세 개로 분리한다. `npm run smoke:prod-readiness`의 `db_roles` 체크가 실제 프로브 트랜잭션으로 read 쓰기 차단, ingest DDL 차단, migration DDL 허용을 검증한다.

## Collector batch ingest

```bash
npm run collector:ingest -- --input tests/fixtures/collector-batch.sample.json --dry-run
npm run smoke:collector   # 실제 DB 트랜잭션 실행 후 rollback
```

`collector:ingest`는 `sky_collector`가 생성하는 normalized batch JSON(`collector.normalized_batch.v1`)을 검증한 뒤 PostgreSQL `places`, `offers`, `fare_snapshots`, `deals_current`, `source_jobs`, `source_health`, `batch_state`에 반영한다. `SERVICE_REQUIRE_POSTGRES=true` 환경에서는 `DATABASE_URL` 또는 `--database-url` 없이 로컬 fallback하지 않는다.

## Authorized source feed collector

운영 승인된 제휴/API JSON feed를 HTTP로 받아 normalized batch로 정규화하고 artifact를 남긴다.

```bash
npm run collector:source -- --config path/to/source.json --dry-run
npm run collector:source -- --config path/to/source.json --ingest
npm run collector:sources -- --manifest path/to/manifest.json --ingest --audit-failure --allow-partial
npm run collector:sources -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON --ingest
```

동작 규칙:

- `--ingest`를 붙이면 같은 실행에서 PostgreSQL writer까지 연결, `--rollback`은 트랜잭션 검증 후 되돌린다. 운영 쓰기에는 `DATABASE_URL` 또는 `--database-url`이 필요하다.
- `collector:sources`는 일부 source 실패 시 성공분은 유지하고, `--audit-failure`면 실패 source를 `source_jobs`, `source_health`에 기록한다. run 단위 `batch_state.last_batch`에 `source_flags`, `manifest_source_ids`, 성공/실패 목록을 남긴다.
- 모든 활성 source가 성공하고 revalidate 설정이 있으면 마지막에 `/api/revalidate`를 POST한다. 실패 source가 하나라도 있으면 `--allow-partial`이라도 cache revalidation을 건너뛰어 partial batch가 사용자 캐시로 승격되지 않게 한다. secret은 query string이 아닌 `x-revalidate-secret` 헤더로만 전달한다.

### Source config 형식

```json
{
  "schema_version": "collector.authorized_feed_source.v1",
  "source_id": "authorized_partner_feed",
  "source_type": "meta_search",
  "parser_version": "authorized-json-feed-v1",
  "endpoint": "https://feeds.partner-air.example-prod.com/fares",
  "method": "GET",
  "query": { "origin": "ICN", "destination": "TYO", "cabin": "ALL" },
  "auth": { "header_name": "x-api-key", "token_env": "PARTNER_FEED_API_KEY" }
}
```

응답이 normalized shape가 아니면 `response_mapping.adapter=json_path_mapping`으로 원본 JSON 경로를 매핑할 수 있다.

```json
{
  "schema_version": "collector.authorized_feed_source.v1",
  "source_id": "partner_feed",
  "endpoint": "https://feeds.partner-air.example-prod.com/raw-fares",
  "response_mapping": {
    "adapter": "json_path_mapping",
    "collected_at_path": "meta.collectedAt",
    "offers_path": "data.quotes",
    "defaults": { "traveler": "adt1", "currency": "KRW", "tax_included": true, "country_code": "JP", "region": "JAPAN" },
    "fields": {
      "id": "quoteId", "origin_airport": "from", "destination_airport": "toAirport",
      "destination_city_id": "toCity", "destination_display_name": "toNameKo",
      "depart_date": "depart", "return_date": "return",
      "airline_code": "airline.code", "airline_name": "airline.name",
      "booking_source": "bookingSource", "source_type": "sourceType",
      "deep_link": "bookingUrl", "cabin_group": "cabin", "total_price": "totalKrw", "stop_count": "stops"
    }
  }
}
```

### Manifest 형식

```json
{
  "schema_version": "collector.source_manifest.v1",
  "artifact_root": "runtime/collector-artifacts",
  "revalidate": { "url": "https://your-app.vercel.app/api/revalidate", "secret_env": "VERCEL_REVALIDATE_SECRET" },
  "sources": [
    { "config_path": "sources/skyscanner-feed.json" },
    { "enabled": false, "config_path": "sources/paused-source.json" }
  ]
}
```

Manifest 검증 요건: `collector.source_manifest.v1`, 1개 이상 source, source별 `config`/`config_path` 단일 지정, resolved `config.source_id` 존재, 활성 source 고유 `source_id`. 위반이면 `/api/ops/service-readiness`와 `smoke:service-readiness`가 `collector_manifest_configured` 실패 처리한다.

## Preflight / Smoke / Launch Audit

```bash
npm run preflight:runtime-env     # Vercel 런타임 env 검증
npm run preflight:service-env -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON
npm run preflight:firebase-env    # Firestore sink 설정 검증
npm run smoke:ops-alert -- --event collector_ops_alert_smoke
npm run smoke:prod-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON
DATABASE_URL=... npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON --notify
npm run audit:service-launch -- --dry-run --verify-release-gates
npm run audit:service-launch -- --verify-release-gates --run-collector
```

핵심 규칙:

- `preflight:service-env`는 DB 쓰기나 source 호출 없이 운영 설정과 manifest를 검증한다. placeholder가 아닌 PostgreSQL URL, `SERVICE_REQUIRE_POSTGRES=true`, 실제 HTTPS webhook, 16자 이상 secret, manifest endpoint/revalidate/secret 참조 형태를 확인한다.
- `smoke:service-readiness`는 최근 7일 `source_jobs` 기준 활성 source별 live collector 성공률 95% 이상, source별 유효 canonical 샘플 5건 이상, deeplink 깨진 링크율, public API mock 비활성화, kill switch 명시값을 검사한다. `local-mock` parser나 mock seed만으로는 ready가 되지 않는다.
- `audit:service-launch`는 preflight → alert → readiness gate(기본)를 순서대로 실행하는 오케스트레이션이다. `--verify-release-gates`(npm test, python unittest, build)와 `--run-collector`까지 포함해 모두 통과해야 `launch_decision.ready_to_launch=true`가 되고 non-dry-run에서 exit 0이다. 증거 JSON은 `runtime/service-launch-audits/`에 남긴다.
- `--continue-on-failure`에서도 runtime/service preflight, release gate, alert delivery 실패 시 collector step(DB write)은 skipped로 기록된다.

## GitHub Actions 스케줄

| Workflow | Cron (UTC) | 역할 |
|---|---|---|
| `daily-batch.yml` | 매일 17:00 | 일 1회 배치 publish |
| `collect-fares.yml` | 매일 18:17 | 승인 source 수집 + launch audit (`--verify-release-gates --run-collector`), artifact 보존(collector 30일 / audit 90일) |

두 워크플로우 모두 `COLLECTOR_SOURCE_MANIFEST_JSON` secret이 없으면 skip한다. `collect-fares.yml`의 Firebase preflight/quota/free-tier audit 단계는 자문(advisory) 체크로 실패 시 `::warning::` annotation으로 표면화되지만 하드 gate는 launch audit이 담당한다.

## Ops API

- `/api/ops/source-health` — `source_health`, 최신 `source_jobs`, `batch_state` 기반 collector readiness와 source별 `operator_actions`. 검색 가능한 승인 source가 2개 미만이면 `not_ready`.
- `/api/ops/service-readiness` — 데이터 공급, 예약 전환, 모니터링, UX, 정책, 런칭 운영 6개 축 출시 gate.

기본 응답은 민감정보 없는 요약과 `operator_actions`(priority/phase 정렬)만 포함하고 `Cache-Control: no-store`를 붙인다. 전체 job error, artifact prefix, credential env 이름은 `OPS_READINESS_TOKEN`과 같은 값의 `Authorization: Bearer <token>` 또는 `x-ops-readiness-token` 헤더로 요청해야 한다.

## Read model 소스 필터

`source_flags`는 표시값이 아니라 검색 후보 필터에 적용된다. 기본 활성 source는 `skyscanner_affiliate`, `korean_air_official`, `asiana_official`이며 `SOURCE_SKYSCANNER_ENABLED=false`처럼 끄면 해당 예약처는 최저가 랭킹과 상세 목록에서 제외된다. `SOURCE_GOOGLE_FLIGHTS_ENABLED`, `SOURCE_KAYAK_ENABLED`, `SOURCE_PROMO_PAGES_ENABLED`는 기본 꺼져 있으며 live evidence 준비 후 켠다.
