# Backend 설계 문서 — 항공 특가 지도 서비스

## 문서 정보
| 항목 | 내용 |
|------|------|
| 버전 | v3.1 |
| 기준 PRD | v3.1 (2026-03-25) |
| 플랫폼 | Vercel Hobby + Firestore Spark + Firebase Storage + GitHub Actions |
| 런타임 | Next.js 15 BFF · GitHub Actions Ubuntu + Python 3.12 + Playwright |
| 스케줄 | GitHub Actions Cron |
| 비밀 관리 | Vercel Environment Variables + GitHub Secrets |
| 모니터링 | Vercel Logs + GitHub Actions Logs + Firebase Usage |
| 수집 모듈 | `sky_collector` 별도 Python 패키지 ([collector_plan.md](./module/collector_plan.md), [xhr_interception.md](./module/xhr_interception.md)) |

> **⚠️ v3.1 무료 티어 전환 유지**: Firebase/GCP 상의 서버 컴퓨팅을 제거하고, 웹/BFF는 `Vercel Hobby`, 일 배치는 `GitHub Actions`, 데이터는 `Firestore Spark`에 둔다. 무거운 스크래핑과 dirty check는 GitHub Actions에서만 수행한다.
>
> **모듈 분리**: 수집 기능은 `sky_collector`라는 별도 Python 모듈로 분리한다. 메인 서비스(Next.js/TypeScript)와 collector(Python/Playwright)는 Firestore 스키마, Storage artifact/manifest, Revalidation Webhook만을 계약으로 공유한다.

---

## 1. 아키텍처 개요

### 1.1 단일 공개 경계

- 공개 클라이언트는 **Next.js Route Handler**만 호출한다.
- Firestore 읽기와 in-memory filtering은 Vercel 위의 BFF가 담당한다.
- 브라우저는 Firestore, Firebase Storage, GitHub Actions를 직접 호출하지 않는다.
- Playwright와 residential proxy는 **GitHub Actions 배치 런타임에서만** 사용한다.

### 1.2 전체 구조

```text
Browser
  │
  ▼
Next.js 15 on Vercel (Hobby)
  ├── GET /api/deals/map
  ├── GET /api/deals/calendar
  └── GET /api/offers
          │
          └── Firestore read on cache miss only

Vercel Data Cache / ISR (24h)
  └── GitHub Actions batch 완료 후 On-Demand Revalidation

GitHub Actions (매일 KST 02:00)
  └── python -m sky_collector.pipelines.run_daily_batch
        ├── 1) KEXIM 환율 로드
        ├── 2) Firebase Storage에서 전일 hash manifest 다운로드
        ├── 3) 승인 source 스크래핑 (Playwright + proxy)
        ├── 4) Dirty Check
        ├── 5) Firestore 변경분만 write + source_jobs/source_health 갱신
        ├── 6) deal_baselines 재계산
        ├── 7) 새 hash manifest + last-batch 상태 업로드
        └── 8) Vercel Revalidation Webhook 호출

Data Plane
  ├── Firestore (Spark)
  └── Firebase Storage
```

### 1.3 설계 원칙

1. **Public API 단일화**: 외부에는 `/api/*` 세 개만 공개
2. **배치 수집 → 캐시 서빙**: GitHub Actions가 하루 1회 수집/가공하고 BFF는 그 결과만 읽는다
3. **Vercel은 가볍게**: Vercel Route Handler는 10초 안에 끝나는 읽기 전용 처리만 수행한다. Playwright는 절대 올리지 않는다
4. **무료 티어 생존 우선**: Firestore Spark의 일일 읽기/쓰기 한도를 넘지 않도록 `ISR + dirty check + Storage manifest diff`를 기본값으로 둔다
5. **DB 읽기 최소화**: `/api/deals/map`은 `select()` FieldMask로 `calendar_matrix`를 제외한다
6. **캐시 우선 사고방식**: 사용자 요청은 Firestore보다 먼저 Vercel Data Cache/ISR이 흡수해야 한다

---

## 2. 런타임 책임 분리

| 컴포넌트 | 언어 | 책임 |
|---|---|---|
| Next.js BFF on Vercel | TypeScript | 공개 API, Zod 검증, Firestore coarse query, `select()` FieldMask, in-memory filtering, cached response 서빙 |
| `sky_collector` on GitHub Actions | Python | 환율 로드, XHR/GraphQL/HTML-state 수집, Pydantic 검증, anomaly 탐지, dirty check, changed-only write, Deal materialization, baseline 계산, Vercel revalidation |
| Firestore | — | `deals_current`, `offers`, `fare_snapshots`, `deal_baselines`, `source_jobs`, `source_health` 저장 |
| Firebase Storage | — | raw payload, screenshot, error dump, `last-batch.json`, **전일 hash manifest** 저장 |

> **모듈 경계**: BFF(TypeScript)와 collector(Python)는 직접 호출하지 않는다. 둘 사이의 유일한 계약은 Firestore 스키마(`OfferDoc`, `FareSnapshotDoc`, `DealCurrentDoc`, `SourceJobDoc`, `SourceHealthDoc`)와 Storage artifact/manifest(`raw_payload_ref`, `offer-hashes.json.gz`, `last-batch.json`)이다.

> 제거된 컴포넌트: `Cloud Run`, `Cloud Functions`, `Cloud Scheduler`, `Secret Manager`, `refresh_jobs`, `refresh-offers-worker`

### 2.1 모듈/레포 구조

```text
sky_planner/                         # 공개 서비스
  app/
  lib/
  require/

sky_collector/                       # 별도 수집 모듈
  src/sky_collector/
    core/                            # BrowserSession, NetworkCapture, Retry
    registry/                        # 사이트별 YAML 규칙
    parsers/                         # 사이트별 어댑터
    models/                          # Pydantic 계약
    storage/                         # Firestore/Storage writer
    pipelines/                       # daily batch / fx / revalidation
  tests/
  workflows/
```

- `sky_planner`는 공개 API와 읽기 경로만 가진다.
- `sky_collector`는 수집과 쓰기 경로만 가진다.
- collector 내부 구조와 단계별 구현 범위는 [collector_plan.md](./module/collector_plan.md) 기준으로 유지한다.

### 2.2 `sky_collector` 내부 책임

| 모듈 | 책임 | collector_plan Phase |
|---|---|---|
| `core/` | `BrowserSessionManager`, `ResourceBlocker`, `NetworkCaptureEngine`, `PollingAssembler`, `FailureClassifier` | Phase 1 |
| `models/` | `RawCapturedResponse`, `NormalizedOffer`, `NormalizedFareSnapshot`, `SourceJobResult` 검증 | Phase 2 |
| `registry/` | `response_match_rules`, `required_runtime_scripts`, `fallback_policy`, `price_anomaly_ruleset` 선언 관리 | Phase 1-3 |
| `parsers/` | 사이트별 JSON/HTML-state → 정규화 변환 | Phase 3, 6 |
| `storage/` | manifest diff, Firestore write, Deal materialize, artifact ref 저장 | Phase 4 |
| `pipelines/` | 일 배치 오케스트레이션, KEXIM 환율, revalidation | Phase 5 |

### 2.3 Collector 출력 계약

| Collector 산출물 | 저장 대상 | 계약 |
|---|---|---|
| `NormalizedOffer` | Firestore `offers` | `OfferDoc` ([database.md](./database.md) §3.5) |
| `NormalizedFareSnapshot` | Firestore `fare_snapshots` | `FareSnapshotDoc` ([database.md](./database.md) §3.6) |
| `DealMaterializer` 결과 | Firestore `deals_current` | `DealCurrentDoc` ([database.md](./database.md) §3.4) |
| `SourceJobResult` | Firestore `source_jobs` | `SourceJobDoc` ([database.md](./database.md) §3.8) |
| `SourceHealthUpdate` | Firestore `source_health` | `SourceHealthDoc` ([database.md](./database.md) §3.9) |
| `RawCapturedResponse` / 디버그 아티팩트 | Firebase Storage + Firestore ref | `raw_payload_ref`, `artifact_prefix` ([database.md](./database.md) §2.1, §3.5, §3.8) |
| Dirty Check 상태 | Firebase Storage | `offer-hashes.json.gz`, `last-batch.json` |

---

## 3. 공개 API 설계

### 3.1 Public 엔드포인트

| 엔드포인트 | 파라미터 | 역할 |
|---|---|---|
| `GET /api/deals/map` | `origin, week, cabin, region, airlines, stay_bucket, traveler` | 지도/리스트 대표가 |
| `GET /api/deals/calendar` | `origin, destination, week, cabin, stay_bucket, traveler` | 날짜 매트릭스 |
| `GET /api/offers` | `origin, destination, depart, return, cabin, airline, stops, traveler` | 상세 목록 (배치 캐시) |

### 3.2 공통 응답 형식

```ts
interface ApiResponse<T> {
  request_id: string;
  generated_at: string;
  last_batch_at: string;
  warning_flags: string[];
  source_flags: string[];
  data: T;
}
```

### 3.3 BFF 규칙

- 모든 요청은 Zod로 파싱한다.
- `traveler`는 MVP에서 `adt1`만 허용한다.
- Firestore에는 coarse filter만 전달한다.
- `/api/deals/map`은 반드시 **`select()`로 `calendar_matrix` 제외**한다.
- `airlines`, `cabin=all`, `stops`, 품질 정렬은 BFF 메모리에서 처리한다.
- `bounds` 필터링은 프론트엔드(MapLibre)가 수행한다.
- `/api/*` 응답은 **Vercel Data Cache / ISR 24시간**을 기본값으로 사용한다.
- GitHub Actions 배치 완료 후 Vercel On-Demand Revalidation으로 캐시를 비운다.

### 3.4 캐시 전략

- Route Handler는 `revalidate = 86400` 또는 `unstable_cache`로 일 단위 캐시를 건다.
- 캐시 태그는 최소 아래처럼 분리한다.
  - `deals-map:{origin}:{week}:{region}:{stay_bucket}:{traveler}`
  - `deals-calendar:{origin}:{destination}:{week}:{stay_bucket}:{traveler}`
  - `offers:{origin}:{destination}:{depart}:{return}:{traveler}`
- 사용자의 대부분 요청은 Vercel CDN/Edge에서 처리하고 Firestore read를 발생시키지 않아야 한다.

---

## 4. 배치 설계

> **구현 위치**: 배치 파이프라인은 `sky_collector` 모듈에서 구현한다. 상세 아키텍처는 [xhr_interception.md](./module/xhr_interception.md), Phase별 개발 계획은 [collector_plan.md](./module/collector_plan.md)을 참조한다.

### 4.1 실행 환경

| 항목 | 값 |
|---|---|
| 실행 주체 | GitHub Actions Cron + `workflow_dispatch` |
| 스케줄 | `0 17 * * *` UTC (`KST 02:00`) |
| 러너 | `ubuntu-latest` |
| 타임아웃 | `55분` |
| 목표 사용량 | 월 1,500분 내외 |
| 배치 명령 | `python -m sky_collector.pipelines.run_daily_batch` |
| MVP 배치 상한 | 1배치당 최대 60~80 검색 단위 |

### 4.2 배치 파이프라인

```text
batch.yml 실행 순서:
  1. KEXIM 환율 로드 (없으면 직전 영업일 fallback)
  2. Firebase Storage에서 전일 offer-hashes.json.gz 다운로드
  3. 승인 source 수집 (순차)
  4. 메모리에서 Dirty Check
  5. Firestore에 변경분만 write + source_jobs/source_health 갱신
  6. deal_baselines 30d/90d 기준가 재계산
  7. 새로운 offer-hashes.json.gz + last-batch.json 업로드
  8. Vercel Revalidation Webhook 호출
```

### 4.3 XHR 인터셉션 수집 단계 상세

1. `origin × region_seed × week × stay_bucket × traveler=adt1 × enabled_source` 조합을 만든다.
2. MVP 시드는 `ICN + 아시아권 상위 10~20개 도시 + D+14~D+90 + 5_7`에 집중한다.
3. source adapter는 **순차 호출**하며, 각 실행은 clean-room `BrowserContext`로 시작한다.
4. browser source는 Playwright + residential proxy를 사용하고, 응답 훅을 검색 트리거 **이전**에 등록한다.
5. `ResourceBlocker`는 이미지, 미디어, 폰트, 광고, 불필요한 스크립트를 차단하되 `required_runtime_scripts` allowlist는 유지한다.
6. `NetworkCaptureEngine`은 XHR/Fetch/GraphQL 응답을 캡처하며, GraphQL object/array batch와 polling completion condition을 지원한다.
7. 목표 응답이 없으면 `HtmlStateExtractor`로 `__NEXT_DATA__` 등 HTML 내장 상태 fallback을 1회 시도한다.
8. 캡처 결과는 `RawCapturedResponse`로 보존하고, parser가 `NormalizedOffer`/`NormalizedFareSnapshot`로 변환한다.
9. Pydantic 스키마 검증을 통과한 데이터만 dirty check 대상으로 넘기며, `price_anomaly`는 저장 전 플래그를 부여해 대표가 계산에서 제외할 수 있게 한다.
10. 실패는 `FailureClassifier`가 `endpoint_changed`, `captcha_detected`, `proxy_blocked`, `schema_validation_failed` 등 코드로 분류하고 필요 시 clean-room 재시도한다.

### 4.4 수집 결과 저장 규칙

- 성공 실행은 `offers`, `fare_snapshots`, `deals_current`, `source_jobs`, `source_health`까지 한 배치 흐름에서 갱신한다.
- `raw_payload_ref`, `parser_version`, `artifact_prefix`, 실패 코드, anomaly 요약은 Firestore 문서와 Storage 객체를 연결하는 공통 감사 정보다.
- trace, screenshot, HTML snapshot은 상시 저장하지 않고 실패 실행에서만 제한 저장한다.
- `schema_validation_failed` 데이터는 Firestore 저장 대상에서 제외한다.
- `price_anomaly_status='anomaly'` 데이터는 감사용 `offers`/`fare_snapshots`에는 남길 수 있지만 `deals_current` 대표가 계산에서는 제외한다.

### 4.5 Dirty Check 규칙

- `offers`는 `write_fingerprint = price + bookability + deep_link + stops + times`로 비교한다.
- 배치 시작 시 Firestore 전체를 읽지 않고 **Firebase Storage의 전일 hash manifest**를 로드한다.
- 새 수집 결과와 manifest를 메모리에서 비교한 뒤 변경된 문서만 Firestore에 `set(..., { merge: true })` 또는 `update` 한다.
- 새로운 manifest는 배치 종료 시 `offer-hashes.json.gz`로 다시 업로드한다.

### 4.6 Quota 방어 규칙

- Firestore Spark 일일 한도는 설계상 아래를 가정한다.
  - `reads <= 50,000/day`
  - `writes <= 20,000/day`
  - `deletes <= 20,000/day`
- `/api/*`는 Vercel 캐시로 읽기를 흡수한다.
- 배치는 변경분만 write 하고, delete는 stale 정리 시 최소화한다.
- 비교용 전체 상태는 Firestore가 아니라 Storage manifest를 사용한다.

---

## 5. Source Adapter 계약

> **구현 위치**: Source Adapter는 `sky_collector/src/sky_collector/parsers/` 하위에 사이트별 Python 모듈로 구현하며, 각 사이트의 수집 설정은 `sky_collector/src/sky_collector/registry/*.yaml`에 선언적으로 관리한다 (Collector Registry).

### 5.1 공통 인터페이스

```python
# sky_collector/src/sky_collector/parsers/base.py
class SourceAdapter(ABC):
    source_id: str
    source_type: Literal["meta_search", "airline_official", "promo_page"]
    execution_mode: Literal["api", "browser"]
    requires_residential_proxy: bool
    enabled_by_default: bool

    @abstractmethod
    async def search_discovery(self, params: DiscoverySearchParams) -> list[NormalizedOffer]: ...

    async def fetch_promotions(self, region: str) -> list[RawPromotion]: ...
    async def health_check(self) -> SourceHealth: ...
```

> 수집 응답은 XHR/Fetch/GraphQL 네트워크 응답을 가로채 JSON으로 직접 파싱한다. DOM 파싱은 fallback으로만 허용한다 ([xhr_interception.md](./module/xhr_interception.md) §2).

### 5.2 Registry 필수 계약

- 모든 adapter는 Registry의 `response_match_rules`, `request_payload_contains`, `operation_name`, `polling_request_match_rules`, `completion_condition`을 해석할 수 있어야 한다.
- 사이트별 `blocked_resource_rule_set`과 `required_runtime_scripts`를 동시에 지원해야 한다.
- fallback은 `fallback_policy`에 선언된 HTML 상태 추출만 허용한다.
- `price_anomaly_ruleset`, `parser_version`, `schema_validator`, `retry_requires_clean_room`는 코드가 아니라 Registry 중심으로 관리한다.

### 5.3 MVP 활성 source

| source_id | 유형 | 실행 모드 | proxy | 상태 |
|---|---|---|---|---|
| `skyscanner_affiliate` | meta_search | `api` 또는 승인된 deeplink | optional | enabled |
| `korean_air_official` | airline_official | `browser` | required | enabled |
| `asiana_official` | airline_official | `browser` | required | enabled |
| `google_flights_direct` | meta_search | `browser` | required | disabled |
| `kayak_direct` | meta_search | `browser` | required | disabled |

### 5.4 장애 격리

- adapter별 timeout 30초
- source별 최대 2회 재시도
- `retry_requires_clean_room=true`인 source는 재시도 시 BrowserContext를 새로 생성한다
- source 하나가 실패해도 배치 전체는 계속 진행한다
- GitHub-hosted runner IP는 차단되기 쉽기 때문에 direct browser source는 proxy 없이는 돌리지 않는다

---

## 6. BFF Filtering 전략

### 6.1 지도/리스트

- Firestore query는 `origin + week + stay_bucket + traveler + region`까지 사용한다.
- `region` 없으면 BFF가 기본 region을 주입한다.
- `select()` FieldMask로 `calendar_matrix`를 제외한다.
- `airlines`, `cabin availability`, 품질 정렬은 BFF 메모리에서 처리한다.
- `location`은 응답에 포함하되 viewport 필터링은 프런트엔드가 수행한다.

### 6.2 상세 목록

- Firestore query는 `origin + destination + depart + return + traveler + is_active`까지만 사용한다.
- `airline`, `stops`, `cabin`, `source visibility`는 BFF 메모리에서 필터링한다.

---

## 7. 보안 및 비밀 관리

| 영역 | 정책 |
|---|---|
| Public BFF | 인증 불필요, 기본 rate limit |
| Vercel | 읽기 전용 서비스 계정 또는 제한된 Firebase 자격 사용 |
| GitHub Actions | Firestore write 권한이 있는 서비스 계정 사용 |
| Residential proxy | GitHub Secrets에 저장 |
| Vercel Revalidation | GitHub Actions에서 서명 토큰으로만 호출 |
| Firestore | 클라이언트 직접 접근 deny |

### 7.1 환경 변수 / Secrets

#### Vercel
```bash
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
VERCEL_REVALIDATE_SECRET=
NEXT_PUBLIC_MAPTILER_STYLE_URL=
NEXT_PUBLIC_ENABLED_SOURCES=skyscanner_affiliate,korean_air_official,asiana_official
```

#### GitHub Secrets
```bash
FIREBASE_SERVICE_ACCOUNT_JSON=
FIREBASE_STORAGE_BUCKET=
COLLECTOR_ARTIFACT_PREFIX=artifacts/
RESIDENTIAL_PROXY_URL=
RESIDENTIAL_PROXY_USERNAME=
RESIDENTIAL_PROXY_PASSWORD=
KEXIM_FX_API_KEY=
KEXIM_FX_API_URL=https://www.koreaexim.go.kr/site/program/financial/exchangeJSON
VERCEL_REVALIDATE_URL=
VERCEL_REVALIDATE_SECRET=
SKYSCANNER_API_KEY=
SLACK_WEBHOOK_URL=
SOURCE_KOREAN_AIR_ENABLED=true
SOURCE_ASIANA_ENABLED=true
```

---

## 8. 테스트 전략

| 계층 | 검증 항목 |
|---|---|
| Contract | `/api/*` 파라미터 해석과 `last_batch_at` 응답 계약 |
| Cache | Vercel Data Cache / ISR 24시간 동작과 On-Demand Revalidation |
| Batch | 환율 로드, manifest diff, changed-only write, baseline 재계산, `source_jobs`/`source_health` 반영 |
| Adapter | Playwright + proxy + request interception + polling/HTML fallback 동작 |
| Quota Guard | Firestore read/write/delete가 무료 한도 내에 머무는지 |
| Validation | Pydantic 검증, `schema_validation_failed` 저장 차단, `price_anomaly` 플래그/대표가 제외 처리 |

### 필수 시나리오

- `/api/deals/map`은 캐시 miss 1회 이후 동일 조건에서 Firestore read 없이 응답해야 한다
- 배치 시작 시 Storage manifest 다운로드 1회로 전체 diff가 가능해야 한다
- 동일 fingerprint 재수집 시 Firestore write가 발생하지 않아야 한다
- 배치 완료 후 Vercel revalidation webhook이 성공해야 한다
- KEXIM 주말/공휴일에도 직전 영업일 환율이 유지되어야 한다
- GraphQL array batch 응답에서도 목표 `operation_name`만 식별해 Offer를 추출해야 한다
- polling형 API는 `completion_condition` 충족 전까지 partial result를 성공으로 처리하지 않아야 한다
- XHR 부재 시 HTML 내장 상태 fallback이 동작하되, 성공 데이터는 동일 `OfferDoc` 스키마로 저장되어야 한다
- `schema_validation_failed` 데이터는 Firestore에 저장되지 않아야 하고, `price_anomaly_status='anomaly'` 데이터는 저장되더라도 Deal 대표가 계산에서 제외되어야 한다
- 실패 실행의 `raw_payload_ref`와 `artifact_prefix`로 디버그 아티팩트를 역추적할 수 있어야 한다

---

## 9. 향후 확장 경로

| 단계 | 영역 | 설명 |
|---|---|---|
| Scale-up | 배치 컴퓨팅 | GitHub Actions 한도 초과 시 외부 cron runner 또는 유료 CI로 이동 |
| Scale-up | 검색 DB | 노선 수십만 확장 시 Firestore+BFF → Typesense/Elasticsearch CDC |
| Scale-up | 캐시 전략 | Route Handler 캐시 외에 정적 prebuild/edge KV 도입 |
| Biz | Price Alert | 배치에서 감지한 가격 변동을 유저 조건과 매칭해 알림 발송 |
| Biz | 공식 API | 스크래핑 비중을 줄이고 B2B API / NDC로 전환 |
