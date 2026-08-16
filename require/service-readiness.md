# 서비스 가능 수준 Readiness Gate

## 목적

서비스 사용 가능 여부를 UI 완성도가 아니라 실제 운영 증거로 판단한다. 기준은 실제 데이터 공급, 예약 전환 신뢰성, 운영 모니터링, 사용자 경험, 서비스 정책, 런칭 운영이다.

## 1. 실제 데이터 공급

- `DATABASE_URL`이 운영 read model에 연결되어야 한다.
- `DATABASE_URL`이 없으면 read model queryable 상태도 통과로 인정하지 않는다.
- `batch_state.last_batch.status`는 `success`여야 한다.
- `last_batch_at`은 `SOURCE_MAX_STALE_HOURS` 이내여야 한다.
- 최신 `batch_state.last_batch.source_flags`는 env-enabled source와 운영 manifest 활성 source 전체를 포함해야 한다.
- 검색 가능한 source는 2개 이상이어야 한다.
- 운영 manifest 또는 env-enabled scope에 포함된 모든 `source_id`는 source policy catalog에 등록되어 `env_flag`, `default_enabled`, `booking_source_keys`를 가져야 한다.
- `source_jobs.parser_version`은 `local-mock`이 아닌 승인 collector 버전이어야 한다.
- 승인 collector 성공 이력은 `runtime/collector-artifacts/` 계열 `artifact_prefix`를 함께 남겨야 한다.
- `live_collector_success` 실패 시 내부 readiness JSON은 source별 최신 job의 실패 사유(`missing_job`, `latest_job_not_success`, `mock_parser_version`, `missing_live_artifact_ref`)를 남겨 운영자가 다음 배치 조치를 바로 판단할 수 있어야 한다.
- 활성 source credential secret이 있어야 한다.
  - `SKYSCANNER_FEED_API_KEY`
  - `KOREAN_AIR_FEED_API_KEY`
  - `ASIANA_FEED_API_KEY`
  - `replace-me`, `test`, `test-token`, `test-secret`, `example` 같은 placeholder 값이나 16자 미만 값은 서비스 준비 상태로 인정하지 않는다.
  - 단, `source_type=promo_page`인 공개 프로모션 source는 manifest에 `auth.token_env`가 없어도 credential 누락으로 보지 않는다.
- credential, 예약 링크 coverage, live collector 성공 이력, 7일 성공률은 검색 가능 source만이 아니라 env로 활성화된 source 전체와 운영 manifest의 활성 source 전체를 기준으로 검증해야 하며, 런타임 readiness API와 `scripts/service-readiness-smoke.mjs`의 DB 조회도 같은 source scope를 사용해야 한다.

## 2. 예약 전환 신뢰성

- 활성 offer에서 booking deeplink 샘플을 확보해야 한다.
- 활성 source마다 booking deeplink 샘플을 1개 이상 확보해야 한다.
- 활성 source마다 유효한 고유 booking deeplink 샘플을 5건 이상 확보해야 하며, 샘플 수는 전체 결과 상위 N개가 아니라 source별 독립 샘플링으로 계산해야 한다. 고유성은 hash와 일반 추적 파라미터(`utm_*`, `gclid`, `fbclid` 등)를 제거한 canonical URL 기준으로 판단한다.
- deeplink는 HTTPS여야 한다.
- `localhost`, `example.*`, `.test` host는 서비스 준비 상태로 인정하지 않는다.
- 예약처 이동 후 최종 가격/좌석 가능 여부가 바뀔 수 있음을 정책 페이지에 고지한다.

## 3. 운영 모니터링

- `/api/ops/source-health`가 `ready`를 반환해야 하며, 검색 가능한 승인 source가 2개 미만이면 `not_ready`로 판단해야 한다.
- `SERVICE_REQUIRE_POSTGRES=true`인 source readiness는 source kill switch 누락/오타 또는 `SOURCE_MAX_STALE_HOURS` 누락/오타를 `not_ready` blocker로 처리해 public API가 기본 source 정책으로 조용히 fallback하지 않게 해야 한다.
- `/api/ops/service-readiness`가 6개 서비스 축의 상태를 반환한다.
- `/api/ops/*`는 공개 요청에서 credential env 이름, collector artifact prefix, job error를 마스킹하고, 전체 JSON은 `OPS_READINESS_TOKEN` 인증 요청에만 반환해야 한다.
- `/api/ops/source-health`는 공개 응답에 민감정보 없는 `operator_actions`를 포함하고, 내부 응답에는 source별 block reason, env flag, 재검증 command를 포함해야 한다.
- `scripts/source-health-smoke.mjs`는 `DATABASE_URL` 또는 `--database-url` 없이 로컬 DB 기본값으로 통과하지 않아야 한다.
- source health 내부 operator action과 launch audit action plan은 source health smoke 재검증 시 명시적 DB 입력 방식(`--database-url [REDACTED_DATABASE_URL]` 또는 `DATABASE_URL`)을 안내해야 하며 실제 URL 값은 노출하지 않아야 한다.
- 최근 7일 `source_jobs` 기준 승인 collector 성공률은 95% 이상이어야 한다.
- 최근 7일 동안 활성 source마다 `local-mock`이 아니고 collector artifact ref가 있는 live collector 성공 이력이 있어야 한다.
- `OPS_ALERT_WEBHOOK_URL`은 실제 HTTPS webhook이어야 한다.
  - `localhost`, `example.*`, `.test`, non-HTTPS webhook은 서비스 준비 상태로 인정하지 않는다.
- `npm run smoke:ops-alert -- --event collector_ops_alert_smoke`가 실제 JSON payload 전송에 성공해야 한다.
- `npm run smoke:service-readiness -- --notify`가 배치 후 실행되어야 하며, 실패 알림에는 raw URL이나 host 없이 깨진 링크율, deeplink 샘플 수, 7일 collector 성공률 숫자가 포함되어야 한다.
- source별 stale, paused, circuit-open 상태가 launch blocker로 표면화되어야 한다.
- `/api/ops/service-readiness` 내부 응답은 `source_health_ready` 실패 시 source별 block reason과 readiness blocker를 포함해 운영자가 `/api/ops/source-health`를 다시 열지 않아도 1차 조치를 판단할 수 있어야 한다.
- 7일 운영 이력이 부족하거나 성공률이 95% 미만이면 launch blocker로 표면화되어야 한다.

## 4. 사용자 경험

- `/fare-board` 결과에는 read model, source health, eligible sources가 표시되어야 한다.
- read model 장애 시 `/`, `/fare-board`, `/map`, `/offers`, `/destination/[placeId]`는 빈 결과처럼 보이지 않고 서비스 일시 중단 안내를 표시해야 한다.
- `/service-readiness`에서 운영자가 launch blocker를 확인할 수 있어야 한다.
- `/service-readiness`는 public redaction을 유지하면서 launch blocker와 operator action을 잘라내지 않고 모두 표시해야 한다.
- `SUPPORT_EMAIL` 또는 `NEXT_PUBLIC_SUPPORT_EMAIL`을 실제 수신 가능한 이메일로 설정해 문의 채널을 공개한다.
  - `example.*`, `.test` 이메일 domain은 서비스 준비 상태로 인정하지 않는다.
- `/policies`는 support email이 없을 때 placeholder email을 노출하지 않아야 한다.
- 검색 재고가 0건이면 서비스 준비 상태가 아니다.

## 5. 서비스 정책

- `/policies`에서 가격, 예약 가능 여부, 제휴 링크, 데이터 갱신, 개인정보, 장애 문의 기준을 공개한다.
- 정책 페이지는 최종 결제 금액이 예약처 기준임을 명시한다.
- 제휴 링크가 포함될 수 있음을 명시한다.
- 문의 채널이 설정되지 않았을 때도 placeholder 이메일을 노출하지 않고 접수 기준을 설명한다.

## 6. 런칭 운영

- `.env.example`은 운영 필수 환경 변수 템플릿을 포함해야 한다.
- `npm run preflight:runtime-env`는 Vercel 런타임 필수 환경 변수 검증 gate다.
- GitHub Actions launch workflow는 `audit:service-launch --verify-release-gates` 안에서 `npm test`와 `python3 -m unittest discover -s tests`를 통과해야 하며, launch operations readiness는 이 계약 테스트 gate가 launch evidence에 포함되는지 검증해야 한다.
- GitHub Actions launch workflow는 `audit:service-launch --verify-release-gates` 안에서 `npm run build`를 통과해야 하며, launch operations readiness는 이 production build gate가 launch evidence에 포함되는지 검증해야 한다.
- 운영 배포는 `SERVICE_REQUIRE_POSTGRES=true`로 public 검색/지도/오퍼 API의 mock fallback을 비활성화해야 한다.
- `SERVICE_REQUIRE_POSTGRES=true` 상태에서 PostgreSQL read model을 사용할 수 없으면 public 검색/지도/캘린더/오퍼 API는 mock fare가 아니라 503, `Cache-Control: no-store`, 빈 결과를 반환해야 한다.
- service readiness의 launch operations 축은 public 검색/지도/캘린더/오퍼 API route가 공통 `apiStatusForResponse`/`apiHeadersForResponse` 정책을 사용하고 data-source가 `suppressMockFallback`을 유지하는지 artifact로 검증해야 한다.
- `SERVICE_REQUIRE_POSTGRES=true`인 public 검색/지도/캘린더/오퍼 API는 source readiness가 ready가 아니면 Postgres row가 조회되어도 `service_unavailable=true`와 503/no-store로 응답해야 한다.
- `/`, `/fare-board`, `/map`, `/offers`, `/destination/[placeId]`는 `force-dynamic`으로 read model/source readiness를 매 요청 평가하고, service unavailable notice를 렌더링할 때 `noStore()`로 장애 화면이 캐시에 남지 않게 해야 한다.
- `configs/collector-source-manifest.production.example.json`은 실제 partner endpoint로 치환 가능한 production manifest 템플릿이어야 한다.
- `.github/workflows/collect-fares.yml`은 `audit:service-launch --verify-release-gates --run-collector`로 release gate와 배치 전후 gate를 한 번의 감사 실행에 묶어야 한다.
  - `preflight:runtime-env`
  - `preflight:service-env`
  - `smoke:ops-alert`
  - `collector:sources`
  - `smoke:prod-readiness`
  - `smoke:service-readiness`
- `.github/workflows/collect-fares.yml`은 매 실행마다 `runtime/service-launch-audits`를 `service-launch-audit` artifact로 업로드해야 한다.
- `.github/workflows/collect-fares.yml`은 live collector 증거를 추적할 수 있도록 `runtime/collector-artifacts`를 `collector-artifacts` artifact로 업로드해야 한다.
- production source manifest의 `artifact_root`는 workflow artifact 업로드 대상인 `runtime/collector-artifacts` 아래여야 한다.
- `scripts/prod-readiness-smoke.mjs`는 출시 전 필수 gate이며, `DATABASE_URL` 누락, 누락된 revalidation 설정, placeholder source endpoint, placeholder revalidation URL, placeholder 또는 16자 미만 source/revalidate secret을 production-ready로 인정하지 않아야 한다.
- `scripts/prod-readiness-smoke.mjs`는 booking deeplink production shape 실패 시 깨진 링크율, 최대 허용 비율, 샘플 수를 evidence detail로 남겨야 한다.
- revalidation secret은 URL query string에 넣지 않고 `Authorization: Bearer` 또는 `x-revalidate-secret` 헤더로만 전달해야 한다.
- collector source run은 실패 source가 하나라도 있으면 `--allow-partial` 실행이어도 Vercel revalidation을 건너뛰어 partial batch가 사용자 캐시로 승격되지 않게 해야 한다.
- `scripts/ops-alert-smoke.mjs`는 운영 알림 채널 전달 검증 gate다.
- `scripts/service-readiness-smoke.mjs`는 mock seed, 누락 credential, 알림/문의 채널 누락을 출시 blocker로 실패시킨다.
- `scripts/service-readiness-smoke.mjs`는 `--manifest-env`가 가리키는 manifest의 inline `config`와 `config_path`를 해석한 `auth.token_env` 기준으로 source credential을 검증해야 하며, manifest env가 비어 있으면 `collector_manifest_configured` launch blocker로 실패해야 한다.
- `/api/ops/service-readiness`는 `COLLECTOR_SOURCE_MANIFEST_JSON`의 실제 manifest inline `config`와 `config_path`를 해석한 `auth.token_env` 기준으로 source credential을 검증해야 하며, manifest env가 없거나 malformed이면 ready로 인정하지 않아야 한다.
- readiness manifest 검증은 `collector.source_manifest.v1`, 1개 이상의 source, source별 `config` 또는 `config_path` 단일 지정, `config.source_id` 존재, 활성 source의 고유한 `source_id`를 요구해야 한다.
- `scripts/service-readiness-smoke.mjs`는 `DATABASE_URL`이 없을 때 로컬 DB 기본값으로 통과시키지 않고 DB 미설정 blocker를 반환해야 한다.
- `scripts/service-readiness-smoke.mjs`와 service env preflight는 `OPS_READINESS_TOKEN` 누락 또는 placeholder 값을 출시 blocker로 처리해야 한다.
- `SERVICE_REQUIRE_POSTGRES=true`인 collector DB write는 `DATABASE_URL` 누락 시 로컬 기본 DB로 fallback하지 않아야 한다.
- `scripts/service-launch-audit.mjs`는 `--verify-release-gates` 실행에서 JS/Python 계약 테스트와 production build를 증거화하고, preflight, alert, collector, prod/service readiness gate를 한 순서로 실행할 수 있어야 하며, dry-run plan에 step별 필수 운영 env를 표시하고 cutover 증거 JSON을 파일로 저장할 수 있어야 한다.
- service launch audit는 runtime/service preflight, release gate, 또는 ops alert delivery가 실패하면 `--continue-on-failure` 실행에서도 collector DB write step을 `skipped`로 기록해야 한다.
- service launch audit dry-run은 값 없는 `env_checklist`와 redacted `rerun_command`를 포함해 운영자가 실행 전에 필요한 secret/env를 확인할 수 있어야 한다.
- service launch audit 증거 JSON은 step별 command, 필수 env, 시작/종료 시각, duration, stdout/stderr tail, JSON summary를 포함해야 한다.
- service launch audit 증거 JSON은 `launch_decision`을 포함해야 하며, 모든 gate가 통과하더라도 `--run-collector`가 포함되지 않은 non-mutating audit은 `ready_to_launch=true`로 인정하지 않아야 한다.
- service launch audit의 `ready_to_launch=true`는 `--verify-release-gates` 포함 및 release gate 전체 통과, runtime/service env preflight JSON summary의 통과 상태, production readiness JSON summary의 `status=ready`, ops alert JSON summary의 `sent=true`, `--run-collector` 포함, collector JSON summary의 `status=success`, `succeeded>0`, `failed=0`, service readiness JSON summary의 `status=ready`, non-dry-run 실행의 persisted `report_path`, `evidence_checklist_status=present`를 모두 요구해야 한다.
- `runServiceLaunchAudit()` 같은 programmatic 실행 결과도 기본적으로 persisted `report_path`와 `evidence_checklist_status=present` 없이는 `ready_to_launch=true`를 반환하지 않아야 한다.
- `collector-artifacts`와 `service-launch-audit` GitHub Actions artifact는 모두 `if-no-files-found: error`로 보존 실패를 workflow 실패로 처리해야 한다.
- service launch audit CLI는 dry-run이 아닌 실행에서 `ready_to_launch=true`일 때만 exit code 0을 반환해야 하며, step exit code가 모두 0이어도 `release_gates_missing`, `cutover_audit_required` 또는 `blocked`이면 non-zero로 종료해야 한다.
- service launch audit의 `launch_decision`은 최종 cutover 차단 근거를 `decision_blockers`로 남겨야 하며, production readiness JSON이 `not_ready`이면 step exit code와 무관하게 `ready_to_launch=true`로 인정하지 않아야 한다.
- service launch audit `action_plan`은 실패 check가 없더라도 `release_gates_missing`, `release_gates_not_pass`, `collector_audit_missing`, `production_readiness_not_ready`, `ops_alert_not_sent`, `evidence_report_missing` 같은 `decision_blockers`를 운영 조치와 재검증 command로 표면화해야 한다.
- service launch audit `launch_decision`은 `evidence_checklist` 항목 중 `present`가 아닌 항목이 있으면 `evidence_checklist_not_present`를 blocker로 남겨야 한다.
- service launch audit 증거 JSON은 실패 check별 필요한 운영 env, 조치, 재검증 command를 담은 `action_plan`을 포함해야 한다.
- service launch audit 증거 JSON과 dry-run은 운영 env와 별개로 release gate, runtime/service env preflight, alert delivery, collector cutover, production/service readiness, 7일 collector history, source별 deeplink sample, persisted launch report를 `evidence_checklist`에 분리해 표시해야 한다.
- service launch audit `action_plan`은 실패 check에서 요구된 운영 env를 중복 제거한 `env_checklist`로 묶고, env 이름, 설정 대상, 값 형태, 관련 check를 값 없이 표시해야 한다.
- service launch audit `action_plan`은 `--env-file`과 `--database-url` 입력 방식을 redacted rerun command로 남겨 같은 리허설 조건을 재현할 수 있어야 한다.
- service launch audit는 운영 리허설용 `--env-file` 입력을 child process env로 전달하고 `--database-url` 입력은 DB-backed direct runner에만 전달하되, 증거 JSON에는 값이 아닌 env 이름과 입력 방식만 남겨야 한다.
- service launch audit의 DB-backed step은 `--database-url`이 제공되면 npm의 URL credential 마스킹 경로를 피한 direct node runner로 값을 전달해 로컬/스테이징 리허설에서도 read model smoke를 재현하되, 증거 JSON의 command에는 `[REDACTED_DATABASE_URL]`만 남겨야 한다.
- service launch audit 콘솔 출력과 증거 JSON은 DB URL, bearer token, secret/token query string, env-file secret 값, JSON `secret`/`token` 필드 값을 redaction해야 하며, `token_env` 같은 env 이름은 값 없이 유지할 수 있어야 한다.
- `scripts/service-launch-audit.mjs`는 `--continue-on-failure` 실행에서도 runtime/service preflight가 실패하면 DB write가 있는 collector step을 skip하고 증거에 `failed_prerequisite`로 남겨야 한다.
- `scripts/service-env-preflight.mjs`는 배치 실행 전 운영 secret과 source manifest의 production shape를 검증하고, inline `config`와 `config_path`를 해석한 `auth.token_env` 기준으로 source credential 누락을 차단한다.
- `scripts/service-env-preflight.mjs`, `scripts/service-readiness-smoke.mjs`, `/api/ops/source-health`, public API source readiness guard, launch audit는 `SOURCE_MAX_STALE_HOURS`가 양의 정수인지, source별 kill switch가 모두 명시적인 true/false 값인지 검증해야 한다. 오타나 누락은 source policy 기본값 fallback으로 통과하지 않는다.
- source별 kill switch는 환경 변수로 제어한다.
  - `SOURCE_SKYSCANNER_ENABLED`
  - `SOURCE_KOREAN_AIR_ENABLED`
  - `SOURCE_ASIANA_ENABLED`
  - `SOURCE_GOOGLE_FLIGHTS_ENABLED`
  - `SOURCE_KAYAK_ENABLED`
  - `SOURCE_PROMO_PAGES_ENABLED`
- 장애 시 직전 성공 캐시는 유지하고 문제가 있는 source만 비활성화한다.
- `/api/deals/map`과 `/api/deals/calendar`은 `deals_current` 캐시를 유지하더라도 read 시점의 source health/kill switch 기준으로 비정상 source가 대표가와 날짜 매트릭스에 노출되지 않도록 필터링해야 한다.

## 판정

- `ready`: 모든 check가 `pass`.
- `not_ready`: 하나 이상의 `fail` 존재.
- mock seed만 있는 상태는 기능 검증용으로만 인정하고 서비스 출시 준비 상태로 인정하지 않는다.

## 설정 템플릿

- 환경 변수 기준은 [`.env.example`](../.env.example)을 사용한다.
- 운영 source manifest 시작점은 [`configs/collector-source-manifest.production.example.json`](../configs/collector-source-manifest.production.example.json)을 복사해 실제 partner endpoint로 교체한다.
- example endpoint는 production-ready로 인정하지 않는다.
- secret 값을 `replace-me`, `test`, `test-token`, `test-secret`, `example` 같은 placeholder로 두거나 16자 미만으로 둔 상태는 production-ready로 인정하지 않는다.
