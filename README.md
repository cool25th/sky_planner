# Sky Planner Atlas

한국 출발 항공 특가 서비스를 mock 데이터로 구현한 MVP입니다. 현재는 `require/` 문서 기준으로 `Next.js App Router + same-origin BFF + 일 1회 배치 아티팩트` 구조를 갖추고 있고, 기존 Python 프로토타입도 함께 남겨두었습니다.

## 포함 내용
- [`app/`](/Users/cool-m1-max/MyDev/Codex/sky_planner/app): Next.js 15 App Router 웹앱과 `/api/*` route handler
- [`lib/mock-market.ts`](/Users/cool-m1-max/MyDev/Codex/sky_planner/lib/mock-market.ts): mock market feed, BFF 집계 로직, 응답 envelope
- [`scripts/batch.mjs`](/Users/cool-m1-max/MyDev/Codex/sky_planner/scripts/batch.mjs): 로컬 batch-state / manifest 생성 스크립트
- [`runtime/batch-state.json`](/Users/cool-m1-max/MyDev/Codex/sky_planner/runtime/batch-state.json): 마지막 배치 시각 mock 아티팩트
- [`require/prd.md`](/Users/cool-m1-max/MyDev/Codex/sky_planner/require/prd.md): 제품 요구사항 문서
- [`backend.py`](/Users/cool-m1-max/MyDev/Codex/sky_planner/backend.py): 기존 Python mock 프로토타입
- [`server.py`](/Users/cool-m1-max/MyDev/Codex/sky_planner/server.py): 기존 Python 정적 서버
- [`legacy_static/index.html`](/Users/cool-m1-max/MyDev/Codex/sky_planner/legacy_static/index.html): 기존 atlas UI

## 실행
### Next.js 앱
```bash
npm install
npm run batch
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 를 열면 됩니다.

### PostgreSQL read model 확인
```bash
docker compose up -d db
npm run db:seed
DATABASE_URL=postgresql://sky_planner:sky_planner_dev@localhost:5433/sky_planner npm run dev
```

`npm run db:seed`는 deterministic mock market을 PostgreSQL `places`, `offers`, `deals_current`, `source_health`, `batch_state`에 적재합니다. 앱은 `DATABASE_URL`이 있으면 PostgreSQL read model을 먼저 사용하고, 실패하거나 데이터가 없으면 mock BFF로 fallback합니다.

### DB 계정 분리 (REQ-DB-002)
`docker compose up -d db`는 `sql/init/002_roles.sql`로 `sky_planner_read`(BFF 조회 전용), `sky_planner_ingest`(배치 적재 테이블 제한 쓰기), `sky_planner_migration`(DDL) 롤을 만들고 테이블 소유권을 migration 롤로 이전합니다. 운영에서는 `DATABASE_READ_URL` / `DATABASE_INGEST_URL` / `DATABASE_MIGRATION_URL` 세 연결을 분리해 사용하고, `npm run db:migrate`는 `DATABASE_MIGRATION_URL`로 `sql/init/*.sql` DDL을 적용합니다. `npm run smoke:prod-readiness`의 `db_roles` 체크가 read 계정 쓰기 차단, ingest 계정 DDL 차단, migration 계정 DDL 허용을 실제 프로브 트랜잭션으로 검증합니다.

### Collector batch ingest 계약 확인
```bash
npm run collector:ingest -- --input tests/fixtures/collector-batch.sample.json --dry-run
npm run smoke:collector
```

`collector:ingest`는 `sky_collector`가 생성할 normalized batch JSON을 검증한 뒤 PostgreSQL `places`, `offers`, `fare_snapshots`, `deals_current`, `source_jobs`, `source_health`, `batch_state`에 반영하는 쓰기 계약입니다. 운영 모드에서 `SERVICE_REQUIRE_POSTGRES=true`가 켜져 있으면 `DATABASE_URL` 또는 `--database-url` 없이 로컬 기본 DB로 fallback하지 않습니다. `smoke:collector`는 실제 DB 트랜잭션을 실행한 뒤 rollback해서 스키마 정합성을 검증합니다.

### Authorized source feed collector
```bash
npm run collector:source -- --config path/to/authorized-feed-source.json --dry-run
npm run collector:source -- --config path/to/authorized-feed-source.json --ingest
npm run collector:sources -- --manifest path/to/collector-source-manifest.json --ingest --audit-failure --allow-partial
npm run collector:sources -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON --ingest --audit-failure --allow-partial
npm run collector:sources -- --manifest path/to/collector-source-manifest.json --ingest --revalidate-url https://your-app.vercel.app/api/revalidate
npm run preflight:runtime-env
npm run preflight:service-env -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON
npm run smoke:ops-alert -- --event collector_ops_alert_smoke
npm run smoke:prod-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON
npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON --notify
npm run audit:service-launch -- --dry-run --verify-release-gates
npm run audit:service-launch -- --dry-run --verify-release-gates --output-dir runtime/service-launch-audits
npm run audit:service-launch -- --verify-release-gates --run-collector
npm run audit:service-launch -- --verify-release-gates --run-collector --output-dir runtime/service-launch-audits
```

운영 secret을 구성할 때는 [`.env.example`](/Users/cool-m1-max/MyDev/Codex/sky_planner/.env.example)과 [`configs/collector-source-manifest.production.example.json`](/Users/cool-m1-max/MyDev/Codex/sky_planner/configs/collector-source-manifest.production.example.json)을 시작점으로 사용합니다. manifest의 `.example` endpoint와 `https://your-app.vercel.app/api/revalidate` revalidation URL은 템플릿 값이라 readiness gate를 통과하지 않으며, 승인된 실제 partner/API endpoint와 배포 origin으로 교체해야 합니다. `artifact_root`는 GitHub Actions가 업로드하는 `runtime/collector-artifacts` 아래에 유지해야 합니다.

`preflight:runtime-env`는 Vercel 런타임에 필요한 `DATABASE_URL`, `SERVICE_REQUIRE_POSTGRES=true`, `OPS_ALERT_WEBHOOK_URL`, support email, `OPS_READINESS_TOKEN`, `VERCEL_REVALIDATE_SECRET`, `SOURCE_MAX_STALE_HOURS`, source kill switch 값을 먼저 검증합니다. 모든 `SOURCE_*_ENABLED` 값은 운영자가 의도한 true/false를 명시해야 하며, 오타나 누락은 기본값 fallback으로 통과하지 않습니다. `preflight:service-env`는 DB 쓰기나 source 호출 없이 운영 설정과 collector manifest까지 검증합니다. `DATABASE_URL`이 로컬/placeholder가 아닌 PostgreSQL URL인지, public API가 mock fallback을 막도록 `SERVICE_REQUIRE_POSTGRES`가 켜졌는지, `OPS_ALERT_WEBHOOK_URL`이 실제 HTTPS webhook인지, 지원 이메일과 ops/readiness token 및 partner secret 값이 placeholder가 아니고 최소 16자 이상인지, source manifest endpoint와 revalidation 설정 및 secret 참조가 운영 형태인지 확인합니다. source manifest가 `config_path`로 source config를 분리해도 실제 config를 resolve한 `auth.token_env` 기준으로 partner secret을 검증합니다. `smoke:ops-alert`는 같은 webhook에 실제 JSON payload를 POST해서 알림 전달 자체를 검증합니다.

`collector:source`는 운영 승인된 제휴/API JSON feed를 HTTP로 받아 `collector.normalized_batch.v1`로 정규화하고 raw payload와 normalized batch artifact를 저장합니다. `--ingest`를 붙이면 같은 실행에서 PostgreSQL writer까지 연결하고, `--rollback`을 붙이면 DB 트랜잭션 검증 후 되돌립니다. 운영 쓰기에서는 `DATABASE_URL` 환경 변수나 `--database-url`을 명시해야 합니다.

`collector:sources`는 여러 source config를 manifest로 묶어 순차 실행합니다. 일부 source가 실패해도 성공한 source의 artifact/write는 유지하고, `--audit-failure`를 붙이면 실패 source를 `source_jobs`, `source_health`에 기록합니다. DB ingest 실행은 source별 write 후 마지막에 run 단위 `batch_state.last_batch`를 다시 기록해 `source_flags`, `manifest_source_ids`, 실패/성공 source 목록을 남깁니다. 모든 활성 source가 실패 없이 성공했고 `revalidate` 설정이나 `--revalidate-url`이 있으면 collector run 마지막에 `/api/revalidate`를 POST로 호출합니다. 실패 source가 하나라도 있으면 `--allow-partial` 실행이어도 cache revalidation은 `source_failures_present`로 건너뛰어 partial batch가 사용자 캐시로 승격되지 않게 합니다. revalidation secret은 query string이 아니라 `x-revalidate-secret` 헤더로만 전달됩니다. 운영 배치에서는 `--manifest-env COLLECTOR_SOURCE_MANIFEST_JSON`로 secret에 저장된 inline manifest를 읽을 수 있습니다. `SERVICE_REQUIRE_POSTGRES=true`인 collector DB 쓰기는 `DATABASE_URL` 또는 `--database-url`을 요구합니다. 기본적으로 실패 source나 revalidation 실패가 있으면 non-zero exit이며, 스케줄 실행에서 부분 성공을 허용하려면 `--allow-partial`을 명시합니다.

`smoke:service-readiness`는 `DATABASE_URL` 또는 `--database-url`로 지정된 read model만 검사합니다. DB URL이 없으면 로컬 DB를 암묵적으로 사용하지 않고 DB 연결/조회 가능성을 launch blocker로 보고합니다. 이 smoke는 최근 7일 `source_jobs`에서 활성 source별 live collector 성공 이력과 95% 이상 성공률도 확인합니다. live 성공은 `local-mock`이 아닌 parser version과 `runtime/collector-artifacts/` 계열 artifact ref가 함께 남아 있어야 인정합니다. source credential은 `--manifest-env`가 가리키는 manifest의 inline `config` 또는 `config_path`를 해석한 실제 `auth.token_env` 기준으로 검사하고, placeholder나 16자 미만 secret은 실패로 처리합니다. manifest secret 자체가 없으면 `collector_manifest_configured` launch blocker로 실패합니다. 예약 링크와 7일 이력 조회도 검색 가능한 source만이 아니라 env-enabled source와 manifest active source 전체를 기준으로 확인합니다. 최신 `last_batch.source_flags`도 같은 source scope 전체를 포함해야 합니다. manifest active source는 `SOURCE_POLICY_CATALOG`에 등록되어 env flag와 booking source alias를 가져야 합니다. 또한 활성 source마다 예약 deeplink 샘플이 있는지와 source별 유효한 canonical 고유 샘플이 5건 이상인지, public API mock fallback이 비활성화됐는지, `SOURCE_MAX_STALE_HOURS`와 모든 `SOURCE_*_ENABLED` kill switch가 명시적인 운영 값인지, `.env.example`, production manifest 템플릿, 수집 workflow, prod/service/alert smoke gate가 실제로 남아 있는지 검증합니다. canonical 고유 샘플은 hash와 일반 추적 파라미터(`utm_*`, `gclid`, `fbclid` 등)를 제거한 URL 기준입니다. CLI JSON에는 내부 운영자가 바로 처리할 수 있는 `operator_actions`가 `priority`와 `phase` 순서로 포함됩니다. `--notify` 실패 알림에는 raw URL이나 host 없이 깨진 링크율, deeplink 샘플 수, 7일 collector 성공률 숫자만 포함합니다. 따라서 mock seed나 단발성 성공만으로는 서비스 출시 준비 상태가 되지 않습니다.

Readiness manifest 검증은 `collector.source_manifest.v1`, 1개 이상의 source, source별 `config` 또는 `config_path` 단일 지정, resolved `config.source_id` 존재, 활성 source의 고유한 `source_id`를 요구합니다. 이 조건이 깨지면 `/api/ops/service-readiness`와 `smoke:service-readiness` 모두 `collector_manifest_configured` 실패로 처리합니다.

`SERVICE_REQUIRE_POSTGRES=true`인 운영 런타임에서는 source readiness도 `SOURCE_MAX_STALE_HOURS`와 모든 `SOURCE_*_ENABLED` 값을 엄격히 봅니다. 누락이나 boolean 오타가 있으면 `/api/ops/source-health`는 `not_ready` blocker를 남기고, public 검색/지도/캘린더/오퍼 API는 source readiness guard를 통해 mock/default source fallback 대신 503/no-store 경로로 내려갑니다.

`audit:service-launch`는 런칭 직전 운영자가 같은 순서를 로컬 또는 CI에서 재현하는 오케스트레이션입니다. `-- --dry-run` 결과에는 각 step이 요구하는 운영 env와 값 없는 `env_checklist`, release gate/alert/collector/7일 이력/deeplink/report 보존 증거를 분리한 `evidence_checklist`, redacted `rerun_command`, `launch_decision`이 함께 표시되며, `-- --output path/to/report.json` 또는 `-- --output-dir runtime/service-launch-audits`를 붙이면 cutover 증거 JSON을 남깁니다. 실행 report에는 step별 command, 필수 env, 시작/종료 시각, duration, stdout/stderr tail, JSON summary가 포함됩니다. production/service readiness step의 JSON summary는 단순 `status`뿐 아니라 axes/checks/database/manifest 같은 구조화 evidence와 `operator_actions`를 보존하므로 7일 collector 성공률, deeplink 샘플 수, source별 coverage, source별 정확한 env 조치까지 report에서 다시 확인할 수 있습니다. 실패 report에는 check별 필요한 운영 env, 조치, 재검증 command를 묶은 `action_plan`도 포함되며, service readiness가 제공한 `operator_actions`가 있으면 generic remediation보다 우선 사용합니다. `-- --verify-release-gates`를 붙이면 `npm test`, `python3 -m unittest discover -s tests`, `npm run build`가 launch audit report 안에 release gate 증거로 기록됩니다. `launch_decision.ready_to_launch`는 release gate가 포함되어 모두 통과하고, runtime/service env preflight JSON이 통과 상태이며, production readiness JSON summary가 `status=ready`이고, ops alert JSON summary가 `sent=true`이고, `--run-collector`가 포함되어 있고, collector JSON summary가 `status=success`, `succeeded>0`, `failed=0`을 증명하며, service readiness JSON summary가 `status=ready`이고, non-dry-run 실행에서 `report_path`가 남아 cutover evidence JSON 저장이 증명되고, `evidence_checklist_status=present`일 때만 `true`가 됩니다. dry-run이 아닌 실행은 `ready_to_launch=true`일 때만 exit code 0으로 종료하므로, step exit code가 모두 0이어도 `release_gates_missing`, `cutover_audit_required`, `blocked`, `evidence_report_missing`, 또는 `evidence_checklist_not_present`이면 CI에서 실패로 처리됩니다. `launch_decision.decision_blockers`는 최종 cutover 차단 근거를 값 없이 남기며, 실패 check가 없더라도 `collector_audit_missing` 같은 차단 근거는 `action_plan` 조치로 표면화됩니다. `action_plan.env_checklist`는 필요한 env 이름, 설정 대상, 값 형태, 관련 check를 값 없이 묶어 보여주며, `--env-file`/`--database-url` 입력을 쓴 리허설은 값이 redacted된 `rerun_command`로 같은 조건을 재현할 수 있습니다. 로컬/스테이징 리허설에서는 `-- --env-file path/to/service.env`와 `-- --database-url postgresql://...`를 사용할 수 있습니다. DB-backed step은 npm의 URL credential 마스킹을 피하는 direct node runner로 DB URL을 전달해 read model smoke를 재현하고, report의 command에는 `[REDACTED_DATABASE_URL]`만 남깁니다. 기본 실행은 preflight/alert/readiness gate만 돌립니다. 실제 source 수집과 DB write까지 포함하려면 `-- --run-collector`를 명시하고, cutover 가능 판정에는 `-- --verify-release-gates`도 필요합니다. `-- --continue-on-failure`를 붙여도 runtime/service preflight, release gate, 또는 ops alert delivery가 실패하면 DB write가 있는 collector step은 `skipped`로 기록되고 후속 non-mutating readiness gate만 계속 실행됩니다.

source config 형식은 아래와 같습니다.

```json
{
  "schema_version": "collector.authorized_feed_source.v1",
  "source_id": "authorized_partner_feed",
  "source_type": "meta_search",
  "parser_version": "authorized-json-feed-v1",
  "endpoint": "https://feeds.partner-air.example-prod.com/fares",
  "method": "GET",
  "query": {
    "origin": "ICN",
    "destination": "TYO",
    "cabin": "ALL"
  },
  "auth": {
    "header_name": "x-api-key",
    "token_env": "PARTNER_FEED_API_KEY"
  }
}
```

partner/API 응답이 이미 위 normalized shape가 아니라면 `response_mapping.adapter=json_path_mapping`으로 원본 JSON 경로를 매핑할 수 있습니다.

```json
{
  "schema_version": "collector.authorized_feed_source.v1",
  "source_id": "partner_feed",
  "source_type": "meta_search",
  "endpoint": "https://feeds.partner-air.example-prod.com/raw-fares",
  "response_mapping": {
    "adapter": "json_path_mapping",
    "collected_at_path": "meta.collectedAt",
    "offers_path": "data.quotes",
    "defaults": {
      "traveler": "adt1",
      "currency": "KRW",
      "tax_included": true,
      "country_code": "JP",
      "region": "JAPAN"
    },
    "fields": {
      "id": "quoteId",
      "origin_airport": "from",
      "destination_airport": "toAirport",
      "destination_city_id": "toCity",
      "destination_display_name": "toNameKo",
      "depart_date": "depart",
      "return_date": "return",
      "airline_code": "airline.code",
      "airline_name": "airline.name",
      "booking_source": "bookingSource",
      "source_type": "sourceType",
      "deep_link": "bookingUrl",
      "cabin_group": "cabin",
      "total_price": "totalKrw",
      "stop_count": "stops"
    }
  }
}
```

GitHub Actions에서는 [collect-fares.yml](/Users/cool-m1-max/MyDev/Codex/sky_planner/.github/workflows/collect-fares.yml)이 `COLLECTOR_SOURCE_MANIFEST_JSON`, `DATABASE_URL`, `VERCEL_REVALIDATE_SECRET`, `OPS_READINESS_TOKEN`, partner API key secrets를 읽어 매일 승인 source를 수집합니다. workflow는 `SOURCE_MAX_STALE_HOURS`와 모든 `SOURCE_*_ENABLED` kill switch를 명시해 preflight가 기본값 fallback 없이 실제 운영 의도를 검증하게 합니다. workflow는 `audit:service-launch --verify-release-gates --run-collector`로 `npm test`, `python3 -m unittest discover -s tests`, `npm run build`, runtime/service env preflight, ops alert smoke, collector ingest, production readiness, service readiness를 한 번의 감사 실행과 증거 JSON으로 묶고, 실행마다 `runtime/collector-artifacts`를 `collector-artifacts` artifact로 30일, `runtime/service-launch-audits`를 `service-launch-audit` artifact로 90일 보존합니다. `collector-artifacts` 또는 `service-launch-audit` artifact가 없거나 보존 기간 계약이 빠지면 workflow/readiness gate가 실패합니다. 이 gate는 `DATABASE_URL`이 없으면 로컬 DB 기본값으로 대체하지 않고 실패하며, 기본적으로 누락된 revalidation 설정, `localhost`, `example.*`, `.test`, `your-app.vercel.app`, non-HTTPS feed/revalidation URL과 placeholder 또는 16자 미만 secret을 production-ready로 인정하지 않습니다.

`smoke:prod-readiness`와 `smoke:service-readiness`는 모두 deeplink 샘플에서 깨진 링크율과 최대 허용 비율을 evidence detail로 남깁니다. `service-readiness --notify` 실패 알림은 raw URL이나 host 없이 이 수치와 7일 collector 성공률만 전달합니다.

source manifest 형식은 아래와 같습니다.

```json
{
  "schema_version": "collector.source_manifest.v1",
  "artifact_root": "runtime/collector-artifacts",
  "revalidate": {
    "url": "https://your-app.vercel.app/api/revalidate",
    "secret_env": "VERCEL_REVALIDATE_SECRET"
  },
  "sources": [
    { "config_path": "sources/skyscanner-feed.json" },
    { "config_path": "sources/korean-air-feed.json" },
    { "enabled": false, "config_path": "sources/paused-source.json" }
  ]
}
```

### Production-like 확인
```bash
npm run build
npm run start
```

### Python legacy 프로토타입
```bash
python3 server.py
```

브라우저에서 [http://127.0.0.1:8000](http://127.0.0.1:8000) 를 열면 됩니다.

## API
- `/api/meta`
- `/api/search?q=Tokyo&origin=ICN&days=7&flex=1&cabin=ALL`
- `/api/search?q=일본&origin=ICN&days=7&flex=1&cabin=ALL` — 국가/지역 입력은 매칭되는 여러 목적지를 함께 비교합니다.
- `/api/deals/map?origin=ICN&week=2026-W13&region=ALL&cabin=ALL&stay_bucket=5_7&traveler=adt1`
- `/api/deals/calendar?origin=ICN&week=2026-W13&destination=TPE&cabin=ALL&stay_bucket=5_7&traveler=adt1`
- `/api/offers?origin=ICN&week=2026-W13&destination=TPE&depart=2026-03-23&return=2026-03-30&cabin=ALL&traveler=adt1`
- `/api/ops/source-health` — Postgres `source_health`, latest `source_jobs`, `batch_state` 기반 collector readiness 상태와 source별 `operator_actions`; 검색 가능한 승인 source가 2개 미만이면 `not_ready`
- `/api/ops/service-readiness` — 실제 데이터 공급, 예약 전환, 모니터링, UX, 정책, 런칭 운영 6개 축의 서비스 출시 gate

`/api/ops/*`는 기본적으로 공개 상태 확인에 필요한 요약과 민감정보 없는 `operator_actions`만 반환하고 `Cache-Control: no-store`를 붙입니다. `/api/ops/service-readiness`와 `npm run smoke:service-readiness` JSON의 `operator_actions`는 `priority`와 `phase`를 포함해 런타임/DB → Source 설정 → Collector 증거 → 예약 전환 → Launch gate 순서로 정렬됩니다. 전체 job error, artifact prefix, credential env 이름, source별 env flag가 필요한 경우 `OPS_READINESS_TOKEN`과 같은 값으로 `Authorization: Bearer <token>` 또는 `x-ops-readiness-token` 헤더를 보내야 합니다.

`/api/ops/source-health`의 내부 operator action과 launch audit action plan은 source health 재검증 명령을 `npm run smoke:source-health -- --database-url [REDACTED_DATABASE_URL]` 형태로 안내합니다. 실제 DB URL 값은 응답이나 감사 JSON에 남기지 않고, 운영자 리허설에서는 `DATABASE_URL` 또는 `--database-url`로만 주입합니다.

모든 API는 아래 envelope을 공통으로 반환합니다.

```json
{
  "request_id": "...",
  "generated_at": "2026-03-24T11:30",
  "last_batch_at": "2026-03-24T02:00",
  "warning_flags": ["daily_batch_cached", "final_price_check_on_booking_source"],
  "source_flags": ["skyscanner_affiliate", "korean_air_official", "asiana_official"],
  "data": {}
}
```

DB-backed API 응답에는 운영 판별용 `diagnostics`도 포함됩니다. `diagnostics.read_model`이 `postgres`, `diagnostics.fallback_used`가 `false`, `diagnostics.source_readiness.status`가 `ready`여야 실제 read model 기반 응답으로 볼 수 있습니다.

운영 배포에서는 `SERVICE_REQUIRE_POSTGRES=true`를 설정해야 합니다. 이 값이 켜져 있으면 검색/지도/캘린더/오퍼 API는 PostgreSQL read model을 사용할 수 없거나 source readiness가 ready가 아닐 때 deterministic mock fare를 반환하지 않고 빈 결과와 `diagnostics.service_unavailable=true`를 포함한 503 응답을 반환합니다.
서비스 readiness의 launch operations 축은 `/api/search`, `/api/deals/map`, `/api/deals/calendar`, `/api/offers`가 공통 `apiStatusForResponse`/`apiHeadersForResponse`를 사용하고 `lib/data-source.ts`가 `serviceApiReadinessBlockReason`/`suppressMockFallback`을 유지하는지도 정적 artifact로 확인합니다.
`/`, `/fare-board`, `/map`, `/offers`, `/destination/[placeId]`는 `force-dynamic`으로 운영 read model/source readiness를 매 요청 평가하고, service unavailable notice를 렌더링할 때 `noStore()`로 장애 화면의 캐시 고착을 막습니다.

`source_flags`는 단순 표시값이 아니라 검색 후보 필터에도 적용됩니다. 기본 활성 소스는 `skyscanner_affiliate`, `korean_air_official`, `asiana_official`이며, `SOURCE_SKYSCANNER_ENABLED=false`처럼 source-policy 환경 변수를 끄면 해당 예약처는 최저가 랭킹과 상세 목록에서 제외됩니다. 검토 전 source인 `SOURCE_GOOGLE_FLIGHTS_ENABLED`, `SOURCE_KAYAK_ENABLED`, `SOURCE_PROMO_PAGES_ENABLED`는 기본 템플릿에서 꺼져 있으며, 운영 manifest와 live evidence가 준비된 뒤에만 켭니다.

## 테스트
```bash
python3 -m unittest discover -s tests
npm run test:search
npm run test:collector
npm run test:collector-source
npm run test:collector-sources
npm run test:prod-readiness
npm run test:read-model-source-filter
npm run test:service-env
npm run test:service-contact
npm run test:ops-visibility
npm run test:revalidate-auth
npm run test:service-readiness
npm run test:service-mode
npm run test:source-health
npm run smoke:collector
npm run smoke:db
npm run preflight:runtime-env
npm run preflight:service-env -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON
npm run smoke:ops-alert -- --event collector_ops_alert_smoke
npm run smoke:prod-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON
DATABASE_URL=postgresql://sky_planner:sky_planner_dev@localhost:5433/sky_planner npm run smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON
npm run audit:service-launch -- --dry-run --verify-release-gates
npm run audit:service-launch -- --dry-run --verify-release-gates --output-dir runtime/service-launch-audits
npm run smoke:source-health -- --database-url postgresql://sky_planner:sky_planner_dev@localhost:5433/sky_planner
npm run build
```

## 현재 한계
- 운영 승인된 JSON feed collector runner, GitHub Actions 스케줄, production-readiness/service-readiness gate, launch audit artifact 보존은 추가됐지만, 실제 partner credential과 live endpoint manifest secret은 아직 주입 전입니다. `COLLECTOR_SOURCE_MANIFEST_JSON`이 비어 있으면 service readiness도 출시 준비 상태로 인정하지 않습니다.
- `/service-readiness`는 mock seed만으로는 서비스 출시 준비 상태를 `ready`로 인정하지 않습니다. `source_jobs.parser_version`이 `local-mock`이 아닌 승인 collector 성공 이력과 `collector-artifacts` 증거를 요구합니다.
- `sky_collector`의 사이트별 XHR/GraphQL 캡처 어댑터는 아직 구현 전이며, 현재는 normalized batch ingest 계약과 DB writer를 먼저 검증했습니다.
- 가격, 할인율, 공식 특가 배지는 deterministic mock 데이터입니다.
- 지도는 MapLibre 대신 SVG atlas 기반 mock UI로 먼저 구현했습니다.
- 운영 read model은 PostgreSQL 기준이며, collector evidence는 GitHub Actions artifact로 보존합니다.
- `TanStack Query`, `Zustand`, `Tailwind`, `shadcn/ui`는 아직 붙이지 않았고, 현재 단계는 App Router/BFF 골격과 탐색 흐름 구현이 우선입니다.
