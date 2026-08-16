# Collector Module 개발 계획서

## 문서 정보
| 항목 | 내용 |
|------|------|
| 버전 | v2.0 |
| 기준일 | 2026-03-26 |
| 상위 문서 | [xhr_interception.md](./xhr_interception.md) |
| 연동 문서 | [backend.md](../backend.md), [database.md](../database.md), [source-policy.md](../source-policy.md), [ops.md](../ops.md) |
| v2.0 반영 | **Anti-Bot Bypass 4단계 전략** 추가, DB를 Firestore → PostgreSQL 전환, Phase 1에 Stealth/Warmup/HumanEmulator 추가 |

> 이 문서는 수집 기능을 **메인 서비스와 분리된 독립 모듈**로 개발하기 위한 단계별 계획을 정의한다.

---

## 1. 모듈 분리 원칙

### 1.1 왜 별도 모듈인가
- 수집기는 **GitHub Actions**에서 실행되고, 메인 서비스는 **Vercel**에서 실행된다. 런타임이 완전히 다르다.
- 수집기는 Python + Playwright, 메인 서비스는 TypeScript + Next.js — **언어 스택이 다르다**.
- 수집기의 배포·변경 주기는 사이트별 파서 업데이트에 따라 빈번하지만, 서비스 BFF는 안정적이다.
- 둘 사이의 유일한 계약은 **PostgreSQL 스키마**와 **Object Storage manifest**이다.

### 1.2 경계 정의

```text
sky_planner/                       ← 메인 서비스 (Vercel)
  app/                             ← Next.js App Router
  lib/                             ← BFF 유틸리티
  require/                         ← 설계 문서

sky_collector/                     ← 수집 모듈 (GitHub Actions) ★ 별도 패키지
  src/
    sky_collector/
      core/                        ← 공통 엔진
      registry/                    ← 사이트별 설정 (YAML)
      parsers/                     ← 사이트별 파서
      pipelines/                   ← 배치 오케스트레이션
      storage/                     ← PostgreSQL/Storage 연동
      models/                      ← Pydantic 데이터 모델
  tests/
  workflows/                       ← GitHub Actions YAML
  pyproject.toml
```

### 1.3 연동 계약

| 계약 | 방향 | 매체 |
|---|---|---|
| Offer 스키마 | collector → PostgreSQL → BFF | `offers` 테이블 (database.md §3.5) |
| FareSnapshot 스키마 | collector → PostgreSQL | `fare_snapshots` 테이블 (database.md §3.6) |
| Deal materialization | collector → PostgreSQL → BFF | `deals_current` 테이블 (database.md §3.4) |
| Batch audit | collector → PostgreSQL | `source_jobs`, `source_health` 테이블 (database.md §3.8, §3.9) |
| Raw artifact/ref | collector → Object Storage → PostgreSQL ref | `raw_payload_ref`, `artifact_prefix` |
| Hash manifest | collector ↔ PostgreSQL `batch_state` | `offer_hashes` JSONB |
| Last batch state | collector ↔ PostgreSQL `batch_state` | `last_batch` JSONB |
| FX rate cache | collector ↔ PostgreSQL `batch_state` | `fx_rate_cache` JSONB |
| Revalidation | collector → Vercel | On-Demand Revalidation Webhook |

---

## 2. 단계별 개발 계획

### Phase 0 — 프로젝트 초기화 (1일)

| 항목 | 산출물 |
|---|---|
| Python 프로젝트 뼈대 | `pyproject.toml`, `src/sky_collector/` 구조, pytest 설정 |
| Playwright 설치 스크립트 | `scripts/install_browsers.sh` |
| GitHub Actions workflow 뼈대 | `workflows/collect_daily.yml` (schedule + dispatch) |
| PostgreSQL 연결 검증 | `DATABASE_URL` 환경 변수 주입 및 컨테이너 접속 검증 |
| 환경 변수 목록 확정 | `DATABASE_URL`, `RESIDENTIAL_PROXY_URL`, `KEXIM_FX_API_KEY`, `SLACK_WEBHOOK_URL` 등 |

---

### Phase 1 — Core Engine (3-4일)

XHR 인터셉션 공통 엔진을 구현한다. **사이트별 코드 없이** 구조만 완성.

#### 1.1 `BrowserSessionManager`
- Playwright Browser → Context 생성/폐기
- **`playwright-stealth` 또는 `Patchright` 필수 적용** (xhr_interception.md §6.5.1)
- locale/timezone/user-agent 한국 기본값
- proxy 주입 (**Sticky Session 모드 필수**, §6.5.5)
- `service_workers='block'` 기본
- clean-room Context 재생성

#### 1.1-A `WarmupHandler` (신규)
- 메인 페이지(`/`) 선행 방문으로 안티봇 보안 쿠키 획득 (xhr_interception.md §6.5.2)
- Registry `warmup_url` 기반 동적 URL 결정
- 3~5초 랜덤 대기 + 인간 행동 모사

#### 1.1-B `HumanEmulator` (신규)
- 마우스 이동, 스크롤, 랜덤 대기 패턴 캡슐화 (xhr_interception.md §6.5.3)
- Registry `human_emulation: true/false`로 on/off 제어

#### 1.2 `ResourceBlocker`
- 전역 차단 규칙 (이미지, 폰트, 미디어, 광고)
- **`script`/`document`/`xhr`/`fetch`/`websocket`은 절대 차단 금지** (§6.5.4)
- `blocked_resource_rule_set` + `required_runtime_scripts` + `never_block_types` 삼중 관리
- Registry에서 사이트별 오버라이드 로드

#### 1.3 `NetworkCaptureEngine`
- `page.on('response')` 기반 XHR/Fetch 인터셉션
- `ResponseMatchRule` 평가 (URL, method, status, content-type, payload)
- GraphQL `operationName` 매칭 (Object + Array batch)
- 폴링형 API 완료 감지 (`PollingAssembler`)

#### 1.4 `HtmlStateExtractor`
- XHR/Fetch 응답 부재 시 HTML 내장 상태 데이터 fallback 추출 (xhr_interception.md §7.6)
- `__NEXT_DATA__`, `__NUXT_DATA__`, 전역 JS 변수, inline JSON blob 지원
- Registry `fallback_policy`에 선언된 `selector`, `json_path`, `decode_strategy` 해석
- fallback 결과도 동일한 `NormalizedOffer` 스키마로 정규화

#### 1.5 `FailureClassifier`
- 15개 실패 코드 분류
- clean-room 재시도 판단
- circuit breaker 상태 전환

#### 산출물
- `src/sky_collector/core/browser_session.py`
- `src/sky_collector/core/warmup_handler.py` (신규)
- `src/sky_collector/core/human_emulator.py` (신규)
- `src/sky_collector/core/resource_blocker.py`
- `src/sky_collector/core/network_capture.py`
- `src/sky_collector/core/polling_assembler.py`
- `src/sky_collector/core/html_state_extractor.py`
- `src/sky_collector/core/failure_codes.py`
- `src/sky_collector/core/retry_policy.py`
- `tests/core/` 단위 테스트

---

### Phase 2 — Data Models & Validation (2일)

Pydantic 모델로 데이터 계약을 코드화한다.

#### 2.1 Pydantic 모델
- `RawCapturedResponse` — 캡처된 원본 응답
- `NormalizedOffer` — 정규화된 Offer (database.md `OfferDoc` 매핑)
  - `price_status`: `active` / `stale` / `sold_out` (database.md §4.7, xhr_interception.md §12.2의 `freshness_status`와 동일 3-상태)
  - `capture_channel`: `xhr` / `graphql` / `html_state` — fallback 사용 여부 추적 (database.md §4.4)
  - `price_anomaly_status`: `normal` / `anomaly`
- `NormalizedFareSnapshot` — 정규화된 FareSnapshot
- `SourceJobResult` — 수집 작업 결과 (`schema_validation_failed_count`, `price_anomaly_count` 포함)

#### 2.2 검증 규칙
- 필수 필드 검증 (price_total, currency, depart_date 등)
- enum 검증 (cabin_group, price_status, stops_bucket, capture_channel)
- 가격 이상 탐지 (`AnomalyDetector`)
  - zero_price, negative_price, extreme_high_price
  - currency_mismatch, tax_flag_inconsistent (xhr_interception.md §11.3)
  - 사이트/노선/캐빈별 임계 ruleset

#### 산출물
- `src/sky_collector/models/captured.py`
- `src/sky_collector/models/offer.py`
- `src/sky_collector/models/snapshot.py`
- `src/sky_collector/models/anomaly.py`
- `tests/models/` 검증 테스트

---

### Phase 3 — 첫 번째 PoC: LCC 사이트 (3-4일)

**진에어** 또는 **제주항공** 1개 사이트를 대상으로 end-to-end 검증.

#### 3.1 Anti-Bot Bypass 로컬 PoC (최우선)
- **프록시 없이 로컬 PC(집 IP)**에서 먼저 시도
- `playwright-stealth` 또는 `Patchright` 설치 후 **`headless=False`(창 띄우기)** 모드로 실행
- 진에어 메인 페이지(`https://www.jinair.com/kr/ko`) 접속 → 3~5초 대기 → 검색 페이지 이동
- 확인 항목:
  - 캡차 발생 여부
  - Akamai 보안 쿠키(`_abck`) 발급 여부
  - XHR/GraphQL 응답 캔처 여부

#### 3.2 사이트 분석
- 브라우저 DevTools로 검색 API 리버스
- GraphQL operationName, endpoint, payload 구조 식별
- 폴링 여부, 완료 조건 확인
- 필수 런타임 스크립트 식별

#### 3.3 Registry 작성
- `src/sky_collector/registry/jinair.yaml` (또는 `jejuair.yaml`)
- `warmup_url`, `stealth_mode`, `human_emulation`, `never_block_types` 필드 포함

#### 3.4 Parser 구현
- `src/sky_collector/parsers/jinair_v1.py`
- 응답 JSON → `NormalizedOffer` 변환
- Pydantic 검증 통과 확인

#### 3.5 End-to-end 검증

```bash
# 로컬 실행 (Anti-Bot Bypass 적용)
python -m sky_collector.pipelines.run_single_site \
  --site jinair \
  --origin ICN \
  --destination NRT \
  --depart 2026-04-10 \
  --return 2026-04-15 \
  --cabin economy \
  --no-headless          # ← PoC: 창 띄우고 눈으로 확인
```

#### 수용 기준
- [ ] Stealth + Warmup 적용 후 안티봇 돌파 (보안 쿠키 획득)
- [ ] DOM 파싱 없이 XHR/GraphQL 응답에서 Offer를 추출할 수 있다
- [ ] Pydantic 검증을 통과한 `NormalizedOffer`가 생성된다
- [ ] 원본 payload가 Object Storage에 저장된다
- [ ] 실행 시간이 30초 이내이다

#### 산출물
- Registry YAML 1개
- Parser 1개
- PoC 결과 기록 (`docs/poc_jinair.md`)

---

### Phase 4 — PostgreSQL 연동 & Dirty Check (2-3일)

수집 결과를 PostgreSQL에 changed-only write하는 파이프라인을 완성한다.

#### 4.1 `ManifestManager`
- PostgreSQL `batch_state` 테이블에서 `offer_hashes` JSONB 로드
- 메모리 내 `write_fingerprint` 비교
- manifest 미존재 시 빈 매니페스트로 초기화

#### 4.2 `PgWriter`
- changed-only `offers` UPSERT (`ON CONFLICT DO UPDATE`)
- `deals_current` materialization (changed deal만)
- `source_jobs` 기록 (`schema_validation_failed_count`, `price_anomaly_count` 포함)
- `source_health` 갱신 (`write_amplification_ratio` 포함)
- `price_status` 계산: `active` / `stale` / `sold_out` (database.md §4.7 기준)

#### 4.3 `DealMaterializer`
- Offer → Deal 대표가 계산
- calendar_matrix 생성
- badge 판별 (deal_baselines 참조)
- `price_anomaly_status='anomaly'` Offer는 대표가 계산에서 제외 (database.md §4.4)

#### 4.4 `DailyArchiver`
- `deals_current` 일별 스냅샷 → `deal_history_daily` 저장 (database.md §3.10)
- `deal_baselines` 30d/90d 집계의 원본 데이터 공급
- `expire_at` TTL 180일 설정

#### 산출물
- `src/sky_collector/storage/manifest_manager.py`
- `src/sky_collector/storage/pg_writer.py`
- `src/sky_collector/storage/deal_materializer.py`
- `src/sky_collector/storage/daily_archiver.py`
- `tests/storage/` 통합 테스트

---

### Phase 5 — 배치 파이프라인 완성 (2-3일)

backend.md §4.2의 8단계 파이프라인을 코드로 구현한다.

```
batch.yml 8단계:
  1. KEXIM 환율 로드
  2. PostgreSQL batch_state에서 manifest 로드
  3. 승인 source 순차 스크래핑 (Stealth + Warmup 적용)
  4. dirty check
  5. PostgreSQL changed-only write + source_health
  6. deal_baselines 재계산
  7. manifest 업로드 (batch_state 테이블)
  8. Vercel Revalidation Webhook
```

#### 5.1 `BatchOrchestrator`
- Registry에서 enabled source 목록 로드
- `origin × region_seed × week × stay_bucket × traveler` 조합 생성
- MVP 상한 60-80 검색 단위 적용
- source별 순차 실행, 실패 격리
- source fallback 정책: 비활성 source는 job 미생성, 기존 데이터 24시간 stale 유지 후 `is_active=false` 처리 (source-policy.md §6 참조)
- `write_amplification_ratio` 배치 종료 시 계산 및 `source_health`에 기록 (database.md §7.2: `offers_changed/offers_seen ≤ 0.25` 목표)

#### 5.2 GitHub Actions Workflow
```yaml
# workflows/collect_daily.yml
name: Daily Batch
on:
  schedule:
    - cron: '0 17 * * *'  # KST 02:00
  workflow_dispatch:
    inputs:
      site: { type: string, default: 'all' }
      origin: { type: string, default: 'ICN' }
```

#### 5.3 `RevalidationClient`
- Vercel On-Demand Revalidation 호출
- 캐시 태그 기반 선택적 갱신

#### 5.4 `KexImFxLoader`
- KEXIM 환율 로드 + PostgreSQL `batch_state.fx_rate_cache` 읽기/쓰기
- 주말/공휴일 직전 영업일 fallback (ops.md §4-①, database.md §4.2)

#### 산출물
- `src/sky_collector/pipelines/run_daily_batch.py`
- `src/sky_collector/pipelines/kexim_fx.py`
- `src/sky_collector/pipelines/revalidation.py`
- `workflows/collect_daily.yml`
- `workflows/recollect_site.yml`

---

### Phase 6 — 추가 사이트 어댑터 (사이트당 2-3일)

PoC 성공 후 나머지 MVP source를 순차 추가한다.

| 순서 | 사이트 | 예상 기간 |
|---|---|---|
| 1 | 아시아나 | 2-3일 |
| 2 | 대한항공 (PoC → fallback 판단) | 2-3일 |
| 3 | Skyscanner affiliate | 1-2일 (API 방식이면 파서만) |

---

### Phase 7 — 운영 안정화 (2일)

- 알림 연동 (Slack/Discord webhook — `SLACK_WEBHOOK_URL`)
- 가격 이상 탐지 알림 (`price_anomaly_detected` → 운영 채널 경고)
- `write_amplification_ratio` 임계 초과 경고 (database.md §7.2: `offers ≤ 0.25`, `deals ≤ 0.10`)
- source_health 대시보드 (admin 페이지 또는 로그)
- Firestore quota 모니터링 (Spark 일일 한도 60% 이하 운영 목표 — database.md §7.3)
- GitHub Actions 월 실행 시간 트래킹 (월 2,000분 이내 — ops.md §2)

---

## 3. 일정 요약

| Phase | 내용 | 기간 | 누적 |
|---|---|---|---|
| 0 | 프로젝트 초기화 | 1일 | 1일 |
| 1 | Core Engine | 3-4일 | 5일 |
| 2 | Data Models | 2일 | 7일 |
| 3 | LCC PoC | 3-4일 | 11일 |
| 4 | Firestore 연동 | 2-3일 | 14일 |
| 5 | 배치 파이프라인 | 2-3일 | 17일 |
| 6 | 추가 사이트 | 5-8일 | 25일 |
| 7 | 운영 안정화 | 2일 | **27일** |

> **총 예상: 약 4주** (1인 개발 기준, 파트타임 시 6-8주)

---

## 4. 기술 스택

| 영역 | 선택 |
|---|---|
| 언어 | Python 3.12+ |
| 브라우저 | Playwright + **`playwright-stealth` 또는 Patchright** |
| Anti-Bot | Stealth Plugin + Warmup + HumanEmulator |
| 데이터 검증 | Pydantic v2 |
| 데이터베이스 | **Docker PostgreSQL 16** (`psycopg2-binary`) |
| 환율 | KEXIM OpenAPI |
| HTTP | `httpx` (경량 요청용) |
| 테스트 | pytest + pytest-asyncio |
| CI | GitHub Actions (`ubuntu-latest`) |
| 프록시 | Residential proxy (**Sticky Session 필수**) |

---

## 5. 리스크 및 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| **Anti-Bot 차단** | **XHR 캐처 실패** | **Stealth + Warmup + HumanEmulator 적용 (§6.5)** |
| LCC 사이트 API 변경 | Parser 깨짐 | `endpoint_changed` 자동 감지 + parser_version 관리 |
| 대한항공 Akamai 차단 | 스크래핑 불가 | deeplink fallback, 가격은 Skyscanner에서 수집 |
| GitHub Actions 55분 초과 | 배치 미완료 | 60-80건 상한 + 우선순위 skip |
| 프록시 IP 비고정 | 세션 탈취 차단 | **Sticky Session 필수 사용** (§6.5.5) |
| 프록시 비용 증가 | 월 예산 초과 | Request Interception으로 대역폭 최소화, 사이트별 요청 수 제한 |

---

## 6. 성공 기준 (Phase 5 완료 시)

- [ ] **Anti-Bot Bypass: Stealth + Warmup + HumanEmulator 적용 후 XHR 캐처 성공**
- [ ] 진에어/제주항공 XHR 캐처 → Pydantic 검증 → PostgreSQL write 자동화
- [ ] `batch_state.offer_hashes` JSONB 기반 dirty check 동작
- [ ] GitHub Actions cron 배치가 55분 내 완료
- [ ] 배치 완료 후 Vercel revalidation으로 새 데이터 반영
- [ ] 실패 시 `source_health`에 기록되고 다른 source는 계속 실행
