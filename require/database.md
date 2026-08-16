# Database 설계 문서 — 항공 특가 지도 서비스

## 문서 정보
| 항목 | 내용 |
|------|------|
| 버전 | v3.1 |
| 기준 PRD | v3.1 (2026-03-25) |
| 데이터베이스 | Cloud Firestore (Native mode, Spark plan) |
| 보조 저장소 | Firebase Storage (raw payload, screenshot, error dump, hash manifest) |

> **⚠️ v3.1**: GitHub Actions 배치가 Firebase Storage의 hash manifest를 사용해 Dirty Check를 수행한다. Firestore 전체 문서 읽기로 diff 하지 않는다.
>
> **무료 티어 제약**: Firestore Spark는 일일 quota가 제한되므로, 이 문서는 `Vercel cache hit 우선`, `Storage manifest diff`, `changed-only write`를 전제로 한다.
>
> **수집 모듈 연계**: 데이터 쓰기는 `sky_collector` 모듈(Python)이 담당하고, 데이터 읽기는 Next.js BFF(TypeScript)가 담당한다. 수집 모듈의 상세 아키텍처는 [xhr_interception.md](./module/xhr_interception.md), 개발 계획은 [collector_plan.md](./module/collector_plan.md)을 참조한다.

---

## 1-A. Collector → Firestore 데이터 흐름

```text
sky_collector (GitHub Actions)
  │
  ├── RawCapturedResponse ──────────► Firebase Storage artifacts (raw/html/error)
  ├── Pydantic NormalizedOffer ──────► offers           (changed-only write)
  ├── Pydantic NormalizedFareSnapshot ► fare_snapshots  (changed-only append)
  ├── DealMaterializer ──────────────► deals_current    (materialized_hash diff)
  ├── BaselineCalculator ────────────► deal_baselines   (30d/90d 재계산)
  ├── SourceJobResult ───────────────► source_jobs      (실행 기록)
  ├── SourceHealthUpdate ────────────► source_health    (성공/실패 집계)
  ├── DailyArchiver ─────────────────► deal_history_daily (일별 스냅샷)
  │
  ├── offer-hashes.json.gz ──────────► Firebase Storage (manifest 업로드)
  └── last-batch.json ───────────────► Firebase Storage (배치 상태 업로드)

Next.js BFF (Vercel)
  │
  ├── /api/deals/map ────── Firestore deals_current (select, calendar_matrix 제외)
  ├── /api/deals/calendar ─ Firestore deals_current (단일 문서 full read)
  └── /api/offers ────────── Firestore offers (coarse query + BFF filter)
```

### 쓰기 책임 (sky_collector only)

| 컬렉션 | 쓰기 주체 | 트리거 | 검증 |
|---|---|---|---|
| `offers` | collector | XHR/GraphQL/HTML-state 캡처 → dirty check | Pydantic `NormalizedOffer` 통과 필수, anomaly는 flag 저장 가능 |
| `fare_snapshots` | collector | fingerprint 변경 시 | Pydantic `NormalizedFareSnapshot` 통과 필수 |
| `deals_current` | collector | materialized_hash 변경 시 | DealMaterializer 계산 |
| `deal_baselines` | collector | 배치 종료 시 | 30d/90d 표본 수 충분 시만 |
| `source_jobs` | collector | 배치 실행 기록 | 실패 코드, artifact ref, validation/anomaly 집계 포함 |
| `source_health` | collector | 배치 실행 후 집계 | `source_jobs` 기반 집계 |
| `deal_history_daily` | collector | 일별 아카이브 | — |

### 읽기 책임 (BFF only)

| 컬렉션 | 읽기 주체 | 캐시 |
|---|---|---|
| `deals_current` | BFF | Vercel ISR 24시간 |
| `offers` | BFF | Vercel ISR 24시간 |
| `deal_baselines` | collector (배치 내부) | — |

> **정규화 검증**: collector는 Pydantic 런타임 스키마 검증을 통과한 데이터만 Firestore에 쓴다. 검증 실패 데이터는 저장하지 않고 `schema_validation_failed`로 기록한다. 가격 이상(0원, 비정상 고가)이 탐지되면 `price_anomaly_status='anomaly'`로 분류하고, 감사 목적의 `offers`/`fare_snapshots` 저장은 허용하되 대표가 계산에서는 제외한다.

## 1-B. Collector 산출물 매핑

| Collector 산출물 | 저장 위치 | 연결 필드 |
|---|---|---|
| `RawCapturedResponse` | Firebase Storage `artifacts/` | `raw_payload_ref`, `artifact_prefix` |
| `NormalizedOffer` | Firestore `offers` | `parser_version`, `capture_channel`, `price_anomaly_status` |
| `NormalizedFareSnapshot` | Firestore `fare_snapshots` | `write_fingerprint`, `verification_status`, `raw_payload_ref` |
| `SourceJobResult` | Firestore `source_jobs` | `failure_code`, `schema_validation_failed_count`, `artifact_prefix` |
| `SourceHealthUpdate` | Firestore `source_health` | `last_failure_code`, `stats_24h.*` |
| Batch state | Firebase Storage `batch-state/` | `offer-hashes.json.gz`, `last-batch.json` |

---

## 1. 설계 원칙

1. **읽기 최적화**: 지도와 리스트는 `deals_current`, 상세는 `offers`만 읽도록 materialize
2. **캐빈 독립 상태**: Eco/Biz의 가격, badge, price status, best cell을 각각 분리
3. **비용 방어**: changed-only write, embedded calendar matrix, keepalive snapshot, **`select()` FieldMask** 정책을 기본값으로 사용
4. **BFF 후처리 전제**: geohash 없이 `location`만 저장. **bounds는 클라이언트(MapLibre)가 처리**, 복합 필터는 BFF가 처리
5. **정규화 KRW 우선**: 순위, 비교, 배지는 `normalized_total_krw` 기준
6. **배지 baseline 사전 계산**: 30/90일 기준가는 심야 배치로 `deal_baselines` 문서에 선 계산, 워커는 이 단일 문서만 참조
7. **Spark quota 방어**: Firestore는 캐시 miss와 changed-only write에 한정하고, 전체 상태 비교는 Storage manifest로 수행
8. **Vercel 응답 우선**: 반복 조회는 Firestore가 아니라 `Vercel Data Cache / ISR`에서 처리하고, Firestore는 배치와 캐시 miss에만 사용

---

## 2. 컬렉션 구조

```text
firestore-root/
├── places/
│   └── {place_id}/
│       └── aliases/
├── deals_current/
│   └── {deal_id}/
├── offers/
│   └── {offer_id}/
├── fare_snapshots/
│   └── {snapshot_id}/

├── deal_history_daily/
│   └── {date_deal_id}/
├── deal_baselines/
│   └── {baseline_key}/
├── promotions/
│   └── {promo_id}/
├── source_jobs/
│   └── {job_id}/
├── source_health/
│   └── {source_id}/
└── admin_config/
    └── {config_key}/
```

`calendar_cells` 서브컬렉션은 사용하지 않는다. 날짜 매트릭스는 `deals_current.calendar_matrix`에 요약 형태로 내장한다.

### 2.1 Storage 객체

```text
firebase-storage/
├── batch-state/
│   ├── offer-hashes.json.gz
│   ├── last-batch.json
│   └── fx-rate-cache.json
└── artifacts/
    └── YYYY-MM-DD/
        └── {execution_id}/
            ├── raw/
            ├── html/
            ├── screenshots/
            └── errors/
```

- `offer-hashes.json.gz`: `offer_id -> write_fingerprint` 맵
- `last-batch.json`: 최근 배치 완료 시각, 변경 문서 수, Spark quota 추정 사용량
- `fx-rate-cache.json`: 최근 유효 KEXIM 환율 fallback 용도
- `artifacts/YYYY-MM-DD/{execution_id}/raw/...json.gz`: request/response 본문, header, payload
- `artifacts/YYYY-MM-DD/{execution_id}/html/...html.gz`: HTML fallback 원문
- `artifacts/YYYY-MM-DD/{execution_id}/screenshots/...png`: 실패 시점 스크린샷
- `artifacts/YYYY-MM-DD/{execution_id}/errors/...json`: 분류된 failure code, parser error 요약

---

## 3. 스키마

### 3.1 `places`

```ts
interface PlaceDoc {
  place_id: string;
  place_type: "city" | "airport" | "region";
  display_name_ko: string;
  display_name_en: string;
  iata_code?: string;
  country_code: string;
  region: string;
  parent_place_id?: string;
  linked_airports: string[];
  location: GeoPoint;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

### 3.2 공통 캐빈 상태 객체

```ts
interface CabinDealState {
  min_total_krw: number | null;
  discount_pct: number | null;
  badge_type: "price_deal" | "official_promo" | "new_route" | null;
  price_status: "active" | "stale" | "sold_out";
  is_price_changed: boolean;
  best_depart_date: string | null;
  best_return_date: string | null;
  best_offer_id: string | null;
  representative_airline: string | null;
  representative_source: string | null;
  deep_link: string | null;
  last_seen_at: Timestamp | null;
  last_batch_at: Timestamp | null;
}
```

### 3.3 embedded calendar matrix

```ts
interface CalendarMatrixCellSummary {
  stay_nights: number;
  economy_min_total_krw?: number | null;
  economy_price_status?: "active" | "stale" | "sold_out";
  economy_is_best_cell?: boolean;
  business_min_total_krw?: number | null;
  business_price_status?: "active" | "stale" | "sold_out";
  business_is_best_cell?: boolean;
}

interface CalendarMatrixSummary {
  depart_dates: string[];
  return_dates: string[];
  cells: Record<string, CalendarMatrixCellSummary>; // key = "{depart}_{return}"
  generated_at: Timestamp;
}
```

### 3.4 `deals_current`

```ts
// deal_id: "{origin}_{destination_city_id}_{week}_{stay_bucket}_{traveler}"
interface DealCurrentDoc {
  deal_id: string;
  _schema_version: number;
  materialized_hash: string;
  origin: string;
  traveler: "adt1";
  destination_city_id: string;
  destination_display_name: string;
  country_code: string;
  region: string;
  week: string;
  stay_bucket: "3_4" | "5_7" | "8_14";
  location: GeoPoint;

  economy: CabinDealState | null;
  business: CabinDealState | null;
  calendar_matrix: CalendarMatrixSummary;

  warning_flags: string[];
  enabled_sources: string[];
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

### 3.5 `offers`

```ts
interface OfferDoc {
  offer_id: string;
  itinerary_hash: string;
  _schema_version: number;
  write_fingerprint: string;
  source_job_id: string;
  execution_id: string;
  parser_version: string;
  schema_validator: string;
  capture_channel: "xhr" | "graphql" | "html_state";
  raw_payload_ref: string;

  origin_airport: string;
  origin_city_id: string;
  destination_airport: string;
  destination_city_id: string;

  depart_date: string;
  return_date: string;
  stay_nights: number;
  stay_bucket: "3_4" | "5_7" | "8_14";
  week: string;
  traveler: "adt1";

  airline_code: string; // marketing carrier
  airline_name: string;
  operating_airline_code?: string;
  operating_airline_name?: string;
  booking_source: string;
  source_type: "meta_search" | "airline_official" | "promo_page";

  cabin_group: "economy" | "business";
  cabin_label_raw?: string;
  fare_brand_raw?: string;

  total_price: number;
  currency: string;
  tax_included: boolean;
  normalized_total_krw: number;
  fx_rate_source: "kexim_daily";
  fx_rate_date: string;

  stop_count: number;
  stops_bucket: "direct" | "stopover";
  departure_time_local: string;
  arrival_time_local: string;
  return_departure_time_local: string;
  return_arrival_time_local: string;
  duration_minutes: number;
  return_duration_minutes: number;
  layover_duration_minutes?: number;
  free_baggage_allowance?: string;
  seats_left?: number | null;
  is_codeshare: boolean;
  duration_ratio_vs_direct_baseline?: number | null;
  quality_bucket: "preferred" | "acceptable" | "degraded" | "excluded";
  price_anomaly_status: "normal" | "anomaly";
  price_anomaly_reason?: string;

  deep_link: string;
  bookability_status: "available" | "uncertain" | "sold_out";
  price_status: "active" | "stale" | "sold_out";
  captured_at: Timestamp;
  is_price_changed: boolean;
  warning_flags: string[];
  last_seen_at: Timestamp;
  last_batch_at: Timestamp | null;

  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

### 3.6 `fare_snapshots`

```ts
interface FareSnapshotDoc {
  snapshot_id: string;
  snapshot_key: string; // source + itinerary_hash + fx_rate_date
  source_job_id: string;
  execution_id: string;
  collected_at: Timestamp;
  quote_type: "batch" | "promo";
  write_fingerprint: string;

  origin: string;
  destination_city_id: string;
  depart_date: string;
  return_date: string;
  stay_bucket: "3_4" | "5_7" | "8_14";
  traveler: "adt1";
  airline_code: string;
  cabin_group: "economy" | "business";

  tax_included: boolean;
  total_price: number;
  currency: string;
  normalized_total_krw: number;
  fx_rate_source: "kexim_daily";
  fx_rate_date: string;

  source_id: string;
  parser_version: string;
  capture_channel: "xhr" | "graphql" | "html_state";
  raw_payload_ref: string;
  verification_status: "verified" | "unverified" | "failed";
  price_anomaly_status: "normal" | "anomaly";
  expire_at: Timestamp;
}
```

> `refresh_jobs` 컬렉션은 v3.0에서 사용하지 않는다.

### 3.7 `promotions`

```ts
interface PromotionDoc {
  promo_id: string;
  airline_code: string;
  title: string;
  region?: string;
  destinations?: string[];
  cabin_group?: "economy" | "business" | "all";
  discount_pct?: number;
  booking_url: string;
  source_url: string;
  valid_from: Timestamp;
  valid_until: Timestamp;
  is_active: boolean;
  collected_at: Timestamp;
}
```

### 3.8 `source_jobs`

```ts
interface SourceJobDoc {
  job_id: string;
  execution_id: string;
  source_id: string;
  origin: string;
  target_region: string;
  week: string;
  stay_bucket: "3_4" | "5_7" | "8_14";
  traveler: "adt1";
  cabin_group: "economy" | "business";
  status: "running" | "success" | "failed" | "skipped";
  attempts: number;
  parser_version?: string;
  proxy_profile?: string;
  offers_found: number;
  offers_changed: number;
  snapshots_written: number;
  deals_recomputed: number;
  schema_validation_failed_count: number;
  price_anomaly_count: number;
  failure_code?: string;
  last_error?: string;
  artifact_prefix?: string;
  started_at?: Timestamp;
  completed_at?: Timestamp;
  created_at: Timestamp;
  expire_at: Timestamp;
}
```

### 3.9 `source_health`

```ts
interface SourceHealthDoc {
  source_id: string;
  is_paused: boolean;
  enabled_by_flag: boolean;
  circuit_breaker_open: boolean;
  consecutive_failures: number;
  stats_24h: {
    total_jobs: number;
    success_count: number;
    failure_count: number;
    avg_latency_ms: number;
    block_count: number;
    schema_validation_failure_count: number;
    price_anomaly_count: number;
    write_amplification_ratio: number;
  };
  last_success_at?: Timestamp;
  last_failure_at?: Timestamp;
  last_failure_code?: string;
  last_artifact_prefix?: string;
  last_checked_at: Timestamp;
  updated_at: Timestamp;
}
```

### 3.10 `deal_history_daily`

```ts
interface DealHistoryDailyDoc {
  date: string;
  deal_id: string;
  origin: string;
  destination_city_id: string;
  week: string;
  stay_bucket: "3_4" | "5_7" | "8_14";
  traveler: "adt1";
  economy_min_total_krw: number | null;
  business_min_total_krw: number | null;
  economy_price_status: string | null;
  business_price_status: string | null;
  archived_at: Timestamp;
  expire_at: Timestamp;
}
```

### 3.11 `deal_baselines`

```ts
// baseline_key: "{origin}_{destination_city_id}_{stay_bucket}_{traveler}"
interface DealBaselineDoc {
  baseline_key: string;
  origin: string;
  destination_city_id: string;
  stay_bucket: "3_4" | "5_7" | "8_14";
  traveler: "adt1";
  fx_rate_source: "kexim_daily";
  fx_rate_date: string;
  economy?: {
    avg_30d_krw: number;
    avg_90d_krw: number;
    sample_30d: number;
    sample_90d: number;
  };
  business?: {
    avg_30d_krw: number;
    avg_90d_krw: number;
    sample_30d: number;
    sample_90d: number;
  };
  computed_at: Timestamp;
  expire_at: Timestamp;
}
```

---

## 4. 문서 키 및 정규화 규칙

### 4.1 document ID

| 컬렉션 | ID 형식 | 예시 |
|---|---|---|
| `places` | IATA 또는 custom place_id | `TYO` |
| `deals_current` | `{origin}_{dest}_{week}_{bucket}_{traveler}` | `ICN_TYO_2026-W13_5_7_adt1` |
| `offers` | auto-id 또는 itinerary hash | `offer_abc123` |
| `deal_baselines` | `{origin}_{dest}_{bucket}_{traveler}` | `ICN_TYO_5_7_adt1` |
| `fare_snapshots` | auto-id | Firestore 생성 |

### 4.2 `normalized_total_krw` 규칙

- 환율 소스는 `KEXIM(한국수출입은행) 일일 고시환율`로 고정
- **주말/공휴일에 KEXIM이 데이터를 고시하지 않으면 Firestore에 저장된 가장 최근 영업일의 `fx_rate_date` 데이터를 fallback으로 유지**한다
- `fx_rate_date`는 수집일 기준 스냅샷 날짜를 저장
- `normalized_total_krw = round(total_price * fx_rate)`
- 동일 비교 집합에서는 같은 `fx_rate_date` 기준 값만 랭킹에 사용
- 원통화가 KRW면 `normalized_total_krw = total_price`

### 4.3 hash manifest 규칙

- 배치 시작 시 Firestore 전체를 읽지 않고 Firebase Storage의 `offer-hashes.json.gz`를 읽어 온다.
- manifest는 `offer_id`, `write_fingerprint`, `updated_at`의 경량 구조만 포함한다.
- 배치 종료 시 새로운 manifest를 gzip 압축해 덮어쓴다.
- manifest 다운로드 실패 시에만 제한된 범위의 Firestore fallback read를 허용한다.
- manifest 비교는 GitHub Actions 메모리에서 수행하고, 변경분이 없는 문서는 Firestore write를 금지한다.

### 4.4 collector 감사 필드 규칙

- `raw_payload_ref`는 Firebase Storage 내 원본 payload 객체의 절대 경로 문자열이다.
- `artifact_prefix`는 한 `execution_id` 아래 생성된 디버그 파일들의 공통 prefix다.
- `capture_channel`은 `xhr`, `graphql`, `html_state` 중 하나로 기록해 fallback 사용 여부를 추적한다.
- `airline_code`는 마케팅 캐리어를 저장하고, 실제 운항편이 다르면 `operating_airline_code`/`operating_airline_name`에 별도 저장한다.
- `price_anomaly_status='anomaly'` 데이터는 `offers`에는 감사 목적으로 남길 수 있으나 `deals_current` 대표가 계산과 배지 계산에서는 제외한다.

### 4.5 배지 baseline 규칙

- `deal_baselines`는 심야 배치에서 `deal_history_daily`를 집계해 갱신한다.
- `daily-batch`의 materialize 단계는 배지 판별 시 `deal_history_daily`를 직접 스캔하지 않는다.
- baseline은 `origin + destination_city_id + stay_bucket + traveler` 기준으로 계산한다.
- 표본 수가 부족하면 `price_deal` 배지를 부여하지 않는다.

### 4.6 calendar matrix 내장 규칙

- `calendar_matrix`는 UI 렌더링에 필요한 **요약값만 저장**한다.
- 셀에는 가격, 상태, best cell 여부만 넣고 offer 전체 정보는 넣지 않는다.
- 한 `deals_current` 문서의 serialized size는 **750KB 이하**를 목표로 한다.
- 750KB를 넘길 가능성이 있으면 materialize run을 실패시키고 운영 알람을 보낸다.
- **향후 체류 버킷/캐빈/탑승객 유형 확장 시 Firestore 1MB 문서 제한에 도달할 수 있으며, 이 경우 Redis KV Cache 또는 서브컨렉션으로 분리 마이그레이션한다.**

### 4.7 price status 규칙

- `active`: 최신 일 배치에서 수집된 정상 가격
- `stale`: 최신 배치에서 재수집되지 않았지만 24시간 유예로 유지 중인 가격
- `sold_out`: 배치 시점에 예약 불가로 확인된 가격

### 4.8 필터링 및 bounds 규칙

- `deals_current.location`만 저장하고 geohash는 두지 않는다.
- `airlines`, `cabin availability`는 BFF 메모리에서 필터링한다.
- **bounds 필터링은 프론트엔드(MapLibre)가 클라이언트에서 수행**한다. BFF는 bounds 파라미터를 받지 않는다.
- Firestore는 coarse query만 담당한다.
- **`region`이 없으면 BFF가 기본 region을 주입**하여 전체 `deals_current` 문서 스캔을 방지한다.

### 4.9 FieldMask 필수 규칙

- `/api/*` 응답은 Vercel Data Cache / ISR 뒤에 놓인다.
- Firestore read는 cache miss 시에만 발생하도록 설계한다.
- `/api/deals/map`은 **`select()`로 `calendar_matrix` 필드를 제외**하여 문서당 전송량을 최소화한다 (750KB → ~5KB).
- `/api/deals/calendar`은 단일 `deals_current` 문서의 `calendar_matrix` 필드를 읽으므로 `select()` 없이 전체 읽기 허용.
- `/api/deals/map`에서 `select()` 없이 전체 문서를 읽는 구현은 금지한다. region 단위 조회 시 OOM과 Egress 비용을 유발하기 때문이다.

---

## 5. 주요 쿼리 패턴

### 5.1 지도/리스트 조회

```ts
let q = adminDb.collection("deals_current")
  .where("origin", "==", "ICN")
  .where("week", "==", "2026-W13")
  .where("stay_bucket", "==", "5_7")
  .where("traveler", "==", "adt1")
  .where("is_active", "==", true);

if (region && region !== "all") {
  q = q.where("region", "==", region);
}

const docs = await q
  .select("deal_id", "origin", "destination_city_id", "destination_display_name",
    "region", "location", "week", "stay_bucket", "traveler",
    "economy", "business", "warning_flags", "is_active", "updated_at")
  .get();
const filtered = docs.docs
  .map((doc) => doc.data() as Omit<DealCurrentDoc, "calendar_matrix">)
  .filter((doc) => matchesAirlines(doc, airlines))
  .filter((doc) => matchesCabinAvailability(doc, cabin))
  .sort(sortByRepresentativePrice(cabin));
// bounds 필터링은 프론트엔드(MapLibre)가 클라이언트에서 수행
```

### 5.2 날짜 매트릭스 조회

```ts
const deal = await adminDb
  .collection("deals_current")
  .doc("ICN_TYO_2026-W13_5_7_adt1")
  .get();

const matrix = deal.data()?.calendar_matrix;
```

### 5.3 상세 조회

```ts
const q = adminDb.collection("offers")
  .where("origin_airport", "==", "ICN")
  .where("destination_city_id", "==", "TYO")
  .where("depart_date", "==", "2026-04-10")
  .where("return_date", "==", "2026-04-15")
  .where("traveler", "==", "adt1")
  .where("is_active", "==", true)
  .orderBy("normalized_total_krw", "asc");

const docs = await q.get();
const offers = docs.docs
  .map((doc) => doc.data() as OfferDoc)
  .filter((doc) => matchesAirline(doc, airline))
  .filter((doc) => matchesStops(doc, stops))
  .filter((doc) => matchesCabin(doc, cabin));
```

### 5.4 baseline 조회

```ts
const baseline = await adminDb.collection("deal_baselines")
  .doc("ICN_TYO_5_7_adt1")
  .get();
```

---

## 6. 필수 인덱스

```json
{
  "indexes": [
    {
      "collectionGroup": "deals_current",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "origin", "order": "ASCENDING" },
        { "fieldPath": "week", "order": "ASCENDING" },
        { "fieldPath": "stay_bucket", "order": "ASCENDING" },
        { "fieldPath": "traveler", "order": "ASCENDING" },
        { "fieldPath": "region", "order": "ASCENDING" },
        { "fieldPath": "is_active", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "offers",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "origin_airport", "order": "ASCENDING" },
        { "fieldPath": "destination_city_id", "order": "ASCENDING" },
        { "fieldPath": "depart_date", "order": "ASCENDING" },
        { "fieldPath": "return_date", "order": "ASCENDING" },
        { "fieldPath": "traveler", "order": "ASCENDING" },
        { "fieldPath": "is_active", "order": "ASCENDING" },
        { "fieldPath": "normalized_total_krw", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "fare_snapshots",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "origin", "order": "ASCENDING" },
        { "fieldPath": "destination_city_id", "order": "ASCENDING" },
        { "fieldPath": "cabin_group", "order": "ASCENDING" },
        { "fieldPath": "stay_bucket", "order": "ASCENDING" },
        { "fieldPath": "traveler", "order": "ASCENDING" },
        { "fieldPath": "collected_at", "order": "DESCENDING" }
      ]
    },

  ],
  "fieldOverrides": []
}
```

---

## 7. Dirty Checking 및 쓰기 최적화

### 7.1 changed-only write 규칙

| 대상 | 기본 규칙 |
|---|---|
| `offers` | `write_fingerprint`가 달라질 때만 upsert |
| `fare_snapshots` | fingerprint 변경 시만 append, 동일 상태는 24시간 keepalive만 허용 |
| `deals_current` | `materialized_hash` 변경 시만 update |
| `deal_history_daily` | 일별 집계 결과 hash가 달라질 때만 update |
| `deal_baselines` | 30/90일 기준가가 실제 변할 때만 update |


### 7.2 write amplification 목표

- `offers_changed / offers_seen <= 0.25`
- `deals_recomputed / deals_scanned <= 0.10`
- 목표를 초과하면 source_health에 기록하고 운영 경고를 올린다

### 7.3 Spark quota 가드레일

- Firestore Spark **실제 한도**는 `read 50,000 / write 20,000 / delete 20,000 per day`.
- **운영 목표**는 한도의 60% 이하: `read <= 30,000`, `write <= 10,000`, `delete <= 5,000`.
- 배치가 예상 write 수를 초과하면 우선순위가 낮은 region과 source를 skip 처리한다.
- API 반복 호출은 Vercel cache hit로 흡수하고, cache miss 패턴이 비정상적으로 높으면 region payload 또는 TTL을 재조정한다.

---

## 8. 수명 주기 및 일관성

### 8.1 TTL

| 컬렉션 | TTL 필드 | 보관 기간 |
|---|---|---|
| `fare_snapshots` | `expire_at` | 90일 |
| `source_jobs` | `expire_at` | 30일 |
| `deal_history_daily` | `expire_at` | 180일 |

### 8.2 일관성 전략

| 작업 | 방식 |
|---|---|
| changed offer upsert | Batch write |
| deal materialization | Batch write |
| source health update | Merge set |

---

## 9. 예상 규모 및 비용 방어

### 9.1 예상 규모 (MVP)

| 컬렉션 | 예상 문서 수 | 갱신 주기 |
|---|---|---|
| `places` | ~500 | 거의 정적 |
| `deals_current` | ~10,000 | 변경 시만 |
| `offers` | ~50,000 | 일 1회 배치 |
| `fare_snapshots` | changed-only, 월 최대 150,000 목표 | 변경 시만 |
| `deal_baselines` | ~500 (노선 수 비례) | 일 1회 배치 |

### 9.2 무료 티어 전제

- Spark 플랜은 대량 읽기/쓰기에 취약하므로, 문서 구조는 "배치로 적게 쓰고 캐시로 많이 읽기"를 전제로 한다.
- `deals_current`는 지도용 대표값과 매트릭스를 한 문서에 묶되, 지도 API는 항상 FieldMask로 경량화한다.
- 배치 비교용 상태는 Firestore가 아니라 Storage manifest를 우선 사용한다.

### 9.3 비용 방어 규칙

- `calendar_matrix`는 embedded summary로 저장해 별도 `calendar_cells` write를 없앤다.
- materialize는 changed deal만 수행한다.
- 동일 가격과 상태는 snapshot을 반복 저장하지 않는다.
- `/api/deals/map`은 `select()` FieldMask로 `calendar_matrix`를 제외하여 Egress 비용을 절감한다.
- 배지 판별용 30/90일 기준가는 심야 배치로 `deal_baselines` 문서에 사전 계산해 둔다.

---

## 10. 마이그레이션 기준

1. 주요 컬렉션에 `_schema_version`을 둔다
2. 필드 추가는 무중단 허용
3. 필드 삭제/변경은 migration script 후 적용
4. `firestore.indexes.json`은 코드와 함께 버전 관리한다
