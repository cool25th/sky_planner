# 운영 문서 — 항공 특가 지도 서비스

## 문서 정보
| 항목 | 내용 |
|------|------|
| 버전 | v4.0 |
| 기준일 | 2026-05-29 |
| 적용 범위 | 서비스 출시 전 운영 gate / GitHub Actions collector / PostgreSQL read model |

> **v4.0 운영 기준**: 서비스 가능 여부는 UI 완성도가 아니라 PostgreSQL read model, 승인 source collector, 실제 alert/support 채널, readiness smoke, launch audit evidence로 판단한다.

---

## 1. 배포 토폴로지

```text
Vercel (Hobby)
  └── Next.js 15 BFF
        ├── /api/deals/map
        ├── /api/deals/calendar
        ├── /api/offers
        ├── /api/ops/source-health
        └── /api/ops/service-readiness

GitHub Actions
  └── collect-fares.yml
        ├── service launch audit
        ├── runtime/service env preflight
        ├── ops alert smoke
        ├── approved source collector ingest
        ├── production readiness smoke
        ├── service readiness smoke
        ├── collector artifact upload
        ├── launch audit evidence upload
        └── Vercel Revalidation Webhook 호출

PostgreSQL
  ├── places
  ├── offers
  ├── deals_current
  ├── source_jobs
  ├── source_health
  └── batch_state
```

### 환경

| 환경 | 용도 |
|---|---|
| `dev` | 로컬 기능 검증 |
| `staging` | GitHub Actions 수동 실행 및 readiness artifact 검증 |
| `prod` | 승인 source 기반 운영 |

---

## 2. 스케줄러 및 실행 시간

### GitHub Actions 스케줄

| 작업 | 방식 | 시각 |
|---|---|---|
| `collect-fares.yml` | `cron` + `workflow_dispatch` | `17 18 * * *` UTC (`KST 03:17`) |

### 실행 원칙

- GitHub Actions가 승인 source 수집의 배치 런타임이다.
- `audit:service-launch --verify-release-gates --run-collector`가 계약 테스트, production build, preflight, alert, collector, readiness smoke를 같은 증거 JSON에 남긴다.
- 실패가 발생해도 `--continue-on-failure`로 후속 gate를 실행해 원인별 증거 JSON을 남긴다.
- runtime/service preflight가 실패한 상태에서는 DB write가 있는 collector step을 실행하지 않고 `skipped` / `failed_prerequisite`로 기록한다.
- `runtime/collector-artifacts`와 `runtime/service-launch-audits`를 GitHub Actions artifact로 보존한다.
- `collector-artifacts`는 30일, `service-launch-audit`는 90일 보존하며, artifact 또는 보존 계약 누락 시 workflow/readiness gate 실패로 처리한다.
- launch audit report는 step별 command, 필수 env, 실행 시간, stdout/stderr tail, JSON summary를 남긴다.
- service readiness JSON의 `operator_actions`는 launch audit report와 action plan에 보존해 source별 env 조치와 phase/priority를 잃지 않는다.
- 목표 실행 시간은 **30분 이내**이며 workflow timeout도 30분으로 제한한다.

---

## 3. 무료 티어 제약과 운영 기준

### 3.1 Vercel Hobby 제약

- Route Handler는 **짧은 읽기 처리만 수행**한다.
- Playwright, 장시간 스크래핑, 대용량 바이너리 배포는 금지한다.
- 핵심 운임 화면과 API는 운영 read model/source readiness를 매 요청 평가한다.
- `/`, `/fare-board`, `/map`, `/offers`, `/destination/[placeId]`와 검색/지도/캘린더/오퍼 API route는 `force-dynamic`이다.
- `/api/meta`처럼 장애 판정에 직접 관여하지 않는 보조 응답만 장기 캐시할 수 있다.

### 3.2 PostgreSQL read model 기준

- `DATABASE_URL`이 없으면 서비스 준비 상태가 아니다.
- read model은 `places`, `offers`, `deals_current`, `source_jobs`, `source_health`, `batch_state`를 포함해야 한다.
- `batch_state.status = success`이고 `last_batch_at`이 freshness 기준 안에 있어야 한다.
- mock seed와 local artifact만으로는 운영 준비 상태를 통과하지 않는다.

### 3.3 외부 비용 기준

- partner/API feed 비용, alert 도구, Postgres hosting, Vercel 사용량은 실제 운영 환경 기준으로 별도 관리한다.
- 무료/저비용 운영을 목표로 하되, readiness gate는 비용 절감을 이유로 완화하지 않는다.

---

## 4. 배치 실행 흐름

1. GitHub Actions가 `audit:service-launch --verify-release-gates --run-collector`를 실행한다.
2. `npm test`와 `python3 -m unittest discover -s tests`가 release gate로 서비스 계약 테스트를 검증한다.
3. `npm run build`가 release gate로 Next production build를 검증한다.
4. runtime env와 service env preflight로 DB, manifest, alert, support, revalidate, source secret을 검증한다.
5. `smoke:ops-alert`가 실제 webhook JSON 전송을 검증한다.
6. 승인 source manifest의 enabled source를 순차 수집한다.
7. source별 raw payload와 normalized batch를 `runtime/collector-artifacts`에 저장한다.
8. 성공한 source는 PostgreSQL `offers`, `fare_snapshots`, `deals_current`, `source_jobs`, `source_health`, `batch_state`에 반영한다.
9. 모든 활성 source가 실패 없이 성공하면 Vercel Revalidation Webhook을 호출한다.
10. `smoke:prod-readiness`와 `smoke:service-readiness --notify`로 출시 gate를 검증한다.
11. `runtime/collector-artifacts`와 `runtime/service-launch-audits`를 GitHub Actions artifact로 업로드한다.

### 핵심 방어 원칙

- 승인되지 않은 source, 누락된 운영 manifest, 누락된 revalidation 설정, placeholder endpoint/revalidation URL, placeholder 또는 16자 미만 secret은 production-ready로 인정하지 않는다.
- 실패 source는 `source_jobs`와 `source_health`에 audit 기록을 남긴다.
- source 실패가 하나라도 있으면 partial write는 감사 증거로 남기되 Vercel revalidation은 건너뛰어 partial batch를 사용자 캐시로 승격하지 않는다.
- launch audit에서 alert delivery가 실패하면 `--continue-on-failure` 실행이어도 collector DB write는 `skipped`로 남긴다.
- 문제가 있는 source만 kill switch로 끄고 직전 성공 read model은 유지한다.
- 모든 `SOURCE_*_ENABLED` kill switch와 `SOURCE_MAX_STALE_HOURS`는 GitHub Actions/Vercel/local rehearsal에 명시한다. 누락이나 boolean 오타는 preflight 실패로 처리한다.
- 장애 중에는 직전 성공 read model을 유지하고, 캐시 가능한 보조 surface는 운영자가 명시적으로 갱신하기 전까지 안정적으로 유지한다.

---

## 5. 비용 및 할당량 방어

### 월간 목표 예산

| 항목 | 목표 상한 |
|---|---|
| Vercel Hobby | 0 KRW |
| PostgreSQL hosting | 운영 환경 정책에 따름 |
| GitHub Actions | 0 KRW |
| Alert/support tooling | 운영 환경 정책에 따름 |
| Partner/API feed | 계약 조건에 따름 |

### 읽기 방어 규칙

- `/api/*` 응답은 read model 중심으로 짧은 읽기만 수행한다.
- GitHub Actions 배치 완료 후에는 read model을 갱신하고, 캐시 가능한 보조 surface만 Revalidation Webhook 대상으로 둔다.
- DB-backed API 응답의 `diagnostics.read_model=postgres`, `fallback_used=false`를 운영 기준으로 본다.
- 운영 배포에서는 `SERVICE_REQUIRE_POSTGRES=true`로 mock fallback을 비활성화한다.
- `diagnostics.service_unavailable=true` 응답은 mock fare를 숨기고 503으로 처리되어야 한다.
- `SERVICE_REQUIRE_POSTGRES=true`인 검색/지도/캘린더/오퍼 API는 source readiness가 ready가 아니면 Postgres row가 있어도 503/no-store 응답으로 처리해야 한다.
- 검색/지도/캘린더/오퍼 API route는 `force-dynamic`과 공통 503/no-store 응답 정책을 유지해야 한다.
- `diagnostics.service_unavailable=true` 화면은 `/`를 포함해 빈 검색 결과가 아니라 서비스 일시 중단 안내와 readiness 링크를 보여야 한다.

### 쓰기 방어 규칙

- delete-and-reinsert 금지
- collector ingest 외의 서비스 runtime에서 offer write 금지
- `SERVICE_REQUIRE_POSTGRES=true`인 collector DB write는 `DATABASE_URL` 누락 시 로컬 기본 DB로 fallback하지 않는다.
- source별 실패는 전체 read model을 지우지 않고 `source_jobs`, `source_health`에 남긴다.
- 문제가 있는 source는 kill switch로 제외한다.

### source 호출 방어 규칙

- 승인 partner/API endpoint만 운영 manifest에 넣는다.
- `localhost`, `example.*`, `.test`, non-HTTPS endpoint는 production-ready로 인정하지 않는다.
- 일부 source 실패 시 성공 source의 artifact/write는 유지하고 실패 source만 audit 처리한다.

---

## 6. 알람 및 출시 게이트

### 운영 알람

| 조건 | 임계값 | 알림 |
|---|---|---|
| 7일 승인 collector 성공률 | 95% 미만 | `OPS_ALERT_WEBHOOK_URL` |
| source stale/paused/circuit-open | 즉시 | `OPS_ALERT_WEBHOOK_URL` |
| readiness not_ready | 배치 후 | `OPS_ALERT_WEBHOOK_URL` |
| 깨진 링크율 | 5% 초과 | `OPS_ALERT_WEBHOOK_URL` |

### 출시 게이트

- `npm run preflight:service-env -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON` 통과
- `npm run preflight:runtime-env` 통과
- `npm test`와 `python3 -m unittest discover -s tests` 통과
- `npm run build` 통과
- `npm run smoke:ops-alert -- --event collector_ops_alert_smoke` 통과
- `npm run smoke:prod-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON` 통과
- `/api/ops/service-readiness`의 6개 서비스 축 모두 pass
- 운영 `DATABASE_URL`이 주입된 상태에서 `npm run smoke:service-readiness -- --notify` 통과. 실패 시 CLI JSON은 `operator_actions`를 priority/phase 순서로 포함하고, 알림 payload는 raw URL이나 host 없이 깨진 링크율, deeplink 샘플 수, 7일 collector 성공률 숫자를 포함해야 함
- `npm run audit:service-launch -- --verify-release-gates --run-collector --output-dir runtime/service-launch-audits` 통과 및 증거 JSON 보관
- launch audit `evidence_checklist`에서 release gate, alert delivery, collector cutover, 7일 collector history, source별 deeplink sample, persisted launch report 항목이 모두 `present`
- GitHub Actions run에 `collector-artifacts` 30일 보존 artifact와 `service-launch-audit` 90일 보존 artifact가 남아 있어야 하며, 둘 중 하나라도 없거나 보존 기간 계약이 빠지면 workflow/readiness gate가 실패해야 함
- 7일 연속 배치 성공률 95% 이상
- 활성 source마다 live collector 성공 이력과 collector artifact ref가 있어야 함
- 활성 source마다 hash와 일반 추적 파라미터를 제거한 canonical 기준의 유효한 고유 booking deeplink 샘플 5건 이상 검증 통과
- GitHub Actions 30분 timeout 내 운영 가능
- 자세한 판정 기준은 [`service-readiness.md`](./service-readiness.md)를 따른다.

---

## 7. 장애 대응 Runbook

### 7.1 GitHub Actions 실패

1. 해당 run의 실패 step 확인
2. source별 실패면 해당 source만 비활성화
3. 직전 성공 캐시는 유지
4. `workflow_dispatch`로 수동 재실행

### 7.2 PostgreSQL 또는 read model 장애

1. `/api/ops/source-health`와 `/api/ops/service-readiness` 확인
   - 내부 세부 JSON은 `OPS_READINESS_TOKEN`으로 인증해서 확인한다.
   - 공개 응답은 credential env 이름, collector artifact prefix, job error를 노출하지 않아야 한다.
   - `/api/ops/service-readiness`와 `smoke:service-readiness` JSON의 `operator_actions`는 `priority`/`phase` 순서대로 런타임/DB, Source 설정, Collector 증거, 예약 전환, Launch gate 조치를 처리한다.
   - `/api/ops/source-health`의 `operator_actions`에서 막힌 source와 재검증 command를 확인한다.
2. `DATABASE_URL` 연결과 DB 권한 확인
3. `batch_state`, `source_jobs`, `source_health`의 최신 상태 확인
4. 직전 성공 캐시 유지 여부 확인 후 collector 수동 재실행

### 7.3 source credential 또는 endpoint 장애

1. `preflight:service-env` 실패 원인을 확인한다.
2. 해당 source secret과 manifest endpoint를 교체한다.
3. 필요 시 source kill switch를 끈다.
4. `audit:service-launch --verify-release-gates --run-collector`를 수동 재실행한다.

### 7.4 revalidation 실패

1. `VERCEL_REVALIDATE_SECRET`과 manifest의 revalidate 설정 확인
2. `/api/revalidate` 호출은 query string secret이 아니라 `x-revalidate-secret` 또는 bearer header를 사용했는지 확인
2. revalidation 실패 source/job audit 확인
3. 서비스 화면의 `last_batch_at`과 cache 상태 확인

---

## 8. 비밀 관리

### GitHub Secrets

- `DATABASE_URL`
- `COLLECTOR_SOURCE_MANIFEST_JSON`
- `OPS_ALERT_WEBHOOK_URL`
- `OPS_READINESS_TOKEN`
- `SUPPORT_EMAIL`
- `SKYSCANNER_FEED_API_KEY`
- `KOREAN_AIR_FEED_API_KEY`
- `ASIANA_FEED_API_KEY`
- `VERCEL_REVALIDATE_SECRET`

### Vercel Environment Variables

- `DATABASE_URL`
- `SERVICE_REQUIRE_POSTGRES`
- `COLLECTOR_SOURCE_MANIFEST_JSON`
- `SOURCE_MAX_STALE_HOURS`
- `SOURCE_SKYSCANNER_ENABLED`
- `SOURCE_KOREAN_AIR_ENABLED`
- `SOURCE_ASIANA_ENABLED`
- `SOURCE_GOOGLE_FLIGHTS_ENABLED`
- `SOURCE_KAYAK_ENABLED`
- `SOURCE_PROMO_PAGES_ENABLED`
- `OPS_ALERT_WEBHOOK_URL`
- `OPS_READINESS_TOKEN`
- `SUPPORT_EMAIL`
- `NEXT_PUBLIC_SUPPORT_EMAIL`
- `VERCEL_REVALIDATE_SECRET`
- `SKYSCANNER_FEED_API_KEY`
- `KOREAN_AIR_FEED_API_KEY`
- `ASIANA_FEED_API_KEY`
- `NEXT_PUBLIC_MAPTILER_STYLE_URL`
- `NEXT_PUBLIC_ENABLED_SOURCES`

---

## 9. 일일 운영 점검

- 전일 GitHub Actions `collect-fares.yml` 성공 여부 확인
- `service-launch-audit` artifact 확인
- `collector-artifacts` artifact 확인
- Vercel Revalidation Webhook 성공 여부 확인
- `last_batch_at`이 화면/API에 정상 표시되는지 확인
- `/api/ops/service-readiness` 6개 축 상태 확인
- `/api/ops/source-health` blocked source 확인
- `SUPPORT_EMAIL` 수신 상태와 `OPS_ALERT_WEBHOOK_URL` 전달 상태 확인
