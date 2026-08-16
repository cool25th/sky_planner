# 항공 특가 지도 서비스 PRD

## 문서 정보
| 항목 | 내용 |
|------|------|
| 버전 | v4.0 |
| 기준일 | 2026-03-26 |
| 1차 출시 기준 | 2026-03-21 |
| 기본 시장 | 한국 출발 (`ko-KR`, `KR`, `KRW`) |
| 리뷰 반영 | v3.1 대비 **DB를 Firestore → Docker PostgreSQL 전환**, `sky_collector` 모듈 분리, XHR 인터셉션 요구, DB 연동 계약 정합화 반영 |

### 관련 설계 문서
- [frontend.md](./frontend.md) — 프론트엔드 설계 (Next.js + React + Tailwind + shadcn/ui)
- [backend.md](./backend.md) — 백엔드 설계 (Vercel BFF + GitHub Actions Batch)
- [database.md](./database.md) — 데이터베이스 설계 (PostgreSQL)
- [source-policy.md](./source-policy.md) — 소스 수집 정책 및 feature flag 기준
- [ops.md](./ops.md) — 운영, 배포, 스케줄링, 장애 대응 기준

### 모듈 설계 문서
- [module/xhr_interception.md](./module/xhr_interception.md) — XHR 가로채기 기반 수집 아키텍처 요구사항
- [module/collector_plan.md](./module/collector_plan.md) — Collector Module 개발 계획서 (`sky_collector`)

> **플랫폼 고정**: 웹과 BFF는 `Vercel Hobby`, DB는 `Docker PostgreSQL (로컬 또는 원격)`, 일 1회 수집과 환율 동기화는 `GitHub Actions`에서 수행한다. Vercel은 응답 전용이며 Playwright 수집 워커를 실행하지 않는다.

### 데이터베이스 인프라 (Docker PostgreSQL)

| 항목 | 설정 |
|---|---|
| 이미지 | `postgres:16-alpine` |
| 컨테이너 이름 | `sky_planner_db` |
| 포트 | `5433:5432` |
| 데이터 볼륨 | `sky_planner_pgdata:/var/lib/postgresql/data` |
| 기본 DB명 | `sky_planner` |
| 기본 사용자 | `sky_planner` |
| 인코딩 | `UTF-8` |
| 타임존 | `Asia/Seoul` |

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16-alpine
    container_name: sky_planner_db
    environment:
      POSTGRES_DB: sky_planner
      POSTGRES_USER: sky_planner
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-sky_planner_dev}
      TZ: Asia/Seoul
    ports:
      - "5433:5432"
    volumes:
      - sky_planner_pgdata:/var/lib/postgresql/data
      - ./sql/init:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sky_planner"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  sky_planner_pgdata:
```

**운영 명령어:**
```bash
# DB 시작
docker compose up -d db

# 상태 확인
docker compose ps

# psql 접속
docker exec -it sky_planner_db psql -U sky_planner

# DB 중지 (데이터 유지)
docker compose down

# DB 초기화 (데이터 삭제)
docker compose down -v
```

> **환경 변수**: `DATABASE_URL=postgresql://sky_planner:sky_planner_dev@localhost:5433/sky_planner`

---

## 1. 요약

한국 출발 항공 특가를 매일 수집해 **지도**와 **날짜 축**으로 탐색할 수 있는 웹 서비스.

- 사용자는 **지역을 찍어서 특가를 보거나**, **날짜를 찍어서 지역별 특가를 볼 수 있어야** 한다.
- 탐색 단계와 상세 단계 모두 **일 1회 배치로 수집된 캐시 데이터**를 빠르게 보여주고, 최종 가격 확인은 예약처 아웃링크로 위임한다.
- 메타검색은 **발견용**, 공식 항공사 사이트는 **배치 수집 및 예약 연결용**.

---

## 2. 문제 정의

- 항공 특가가 여러 메타검색 사이트와 항공사 공식 사이트에 흩어져 있어 한 번에 비교하기 어려움
- 사용자는 특정 도시보다 **"어디가 싸게 나왔는지"**, **"언제 가면 싼지"**를 먼저 알고 싶어 함
- 비즈니스 클래스 특가가 이코노미와 섞이면 가격 비교 의미가 흐려짐
- 체류기간·경유 품질·수하물에 따라 가격이 크게 달라져 **동일 조건 정의가 필수**

---

## 3. 목표

1. 매일 항공 특가를 수집해 빠르게 보여준다
2. 지도 중심 UI로 목적지 탐색을 단순화한다
3. 날짜 기준으로도 특가를 조회할 수 있게 한다
4. 이코노미/비즈니스 특가를 지원하되 비교는 캐빈별 분리
5. 가격 클릭 → 실제 항공편 목록 → 예약 링크까지 바로 확인
6. 마지막 배치 시각을 명확히 보여주고 최종 가격 확인 책임은 예약처로 위임

---

## 4. 제품 원칙

| 원칙 | 설명 |
|------|------|
| 탐색은 빠르게, 운영은 단순하게 | 일 1회 배치 캐시 + 최종 예약가는 아웃링크에서 확인 |
| 동일 조건 비교 | 캐빈·체류기간·탑승객 기준이 다르면 별도 비교 집합 |
| 노출 품질 보호 | 비현실적 장시간 경유가 대표 특가로 노출되지 않도록 가드레일 |
| 투명한 가격 고지 | 수집 시점 + 경고 문구를 항상 함께 제공 |

---

## 5. 대상 사용자

- 여행 일정은 있지만 **목적지는 유연한** 사용자
- 특정 날짜에 어디가 싼지 먼저 보고 싶은 사용자
- 항공사 공식 프로모션과 메타검색 최저가를 함께 보고 싶은 사용자
- 비즈니스 특가도 함께 찾는 사용자

---

## 6. MVP 범위

### 포함

| 항목 | 범위 |
|------|------|
| 출발지 | `ICN`, `GMP`, `PUS`, `CJU` 우선 |
| 여정 | 왕복 |
| 탑승객 | 성인 1인(ADT 1) 기준 |
| 가격 기준 | 세금 포함 총액 |
| 캐빈 | 이코노미, 비즈니스 |
| 탐색 축 | 출발 주간, 출발일×귀국일, 지역별, 도시별 |
| 체류기간 버킷 | `2-3박(3-4일)` · `4-6박(5-7일)` · `7-13박(8-14일)` (기본: 4-6박) |
| 필터 | 항공사, 캐빈, 직항/경유, 지역, 체류기간 |
| 액션 | 지도 특가 조회, 날짜 특가 조회, 항공편 상세, 예약 링크 |

### 제외

- 다구간 여정 · 마일리지 항공권 · 로그인 기반 개인화 운임
- 수하물 포함 총액 정교 비교 · 호텔/패키지 결합 · 결제 기능
- 아동/유아 개별 운임 · 다인원 조합별 비교
- 프리미엄 이코노미/퍼스트를 별도 캐빈 축으로 제공

---

## 7. 데이터 소스 요건

### 7.1 소스 분류

| 분류 | 소스 |
|------|------|
| 메타검색 | Google Flights, Skyscanner, KAYAK |
| 국내 항공사 | 대한항공, 아시아나, 제주항공, 진에어, 티웨이, 에어부산, 에어서울, 이스타항공, 에어프레미아 |
| 지역 확장 | 일본/중화권/동남아/오세아니아/유럽/중동/북미 주요 항공사 |

### 7.2 수집 우선순위
1. 제휴/API 또는 공개 피드
2. 공개 검색 결과
3. 공개 프로모션/이벤트 페이지

### 7.3 데이터 수집 전략

| 구분 | 용도 | 정책 |
|------|------|------|
| **탐색용** | 지도·리스트·매트릭스 | 사전 수집 캐시, 빠른 응답 + 넓은 커버리지 우선. UI에 "대표가" 명시 |
| **상세용** | 항공편 목록·예약 링크 | 배치 캐시 즉시 표시. UI에 "마지막 업데이트"와 "실제 예약가 재확인 필요" 문구 노출 |

- 수집 실행 환경은 `GitHub Actions nightly batch`로 고정한다.
- 환율 동기화는 별도 함수 없이 **같은 batch 내부 1단계**에서 수행한다.
- 브라우저 스크래핑은 Vercel이나 Firebase 무료 티어에서 실행하지 않는다.
- **수집 기능은 `sky_collector` 별도 모듈로 분리**하여 개발한다. 수집기는 **XHR/Fetch/GraphQL 네트워크 응답 가로채기 방식**을 표준으로 채택하며, DOM 파싱은 fallback으로만 허용한다 ([xhr_interception.md](./module/xhr_interception.md) 참조).
- 수집 모듈의 디렉토리 구조, Phase별 개발 계획, 연동 계약은 [collector_plan.md](./module/collector_plan.md)에서 관리한다.

### 7.4 모듈 분리 원칙

| 모듈 | 런타임 | 언어 | 책임 | 금지/제한 |
|---|---|---|---|---|
| `sky_planner` | Vercel Hobby | TypeScript | 공개 API, 캐시 응답, PostgreSQL 읽기, 지도/상세 탐색 UX | Playwright 실행 금지, 외부 사이트 직접 수집 금지 |
| `sky_collector` | GitHub Actions | Python + Playwright | XHR/Fetch/GraphQL 수집, 스키마 검증, Dirty Check, PostgreSQL 쓰기, Storage 업로드, Revalidation 호출 | 사용자 요청 처리 금지, 공개 API 제공 금지 |

- `sky_planner`와 `sky_collector`는 **별도 배포 단위**로 운영한다.
- 두 모듈은 직접 함수 호출이나 내부 import로 연결하지 않고, **PostgreSQL 스키마 + Object Storage + Revalidation Webhook**만 공유 계약으로 사용한다.
- 수집 모듈의 내부 디렉토리 구조와 Phase별 구현 순서는 [collector_plan.md](./module/collector_plan.md) 기준으로 관리한다.

### 7.5 수집 모듈 연동 계약

| 계약 | 방향 | 매체 |
|---|---|---|
| Offer 스키마 | `sky_collector` → PostgreSQL → BFF | `offers` 테이블 (database.md §3.5) |
| FareSnapshot 스키마 | `sky_collector` → PostgreSQL | `fare_snapshots` 테이블 (database.md §3.6) |
| Deal materialization | `sky_collector` → PostgreSQL → BFF | `deals_current` 테이블 (database.md §3.4) |
| Batch audit | `sky_collector` → PostgreSQL | `source_jobs`, `source_health` 테이블 (database.md §3.8, §3.9) |
| Raw artifact/ref | `sky_collector` → Object Storage → PostgreSQL ref | `raw_payload_ref`, `artifact_prefix` |
| Hash manifest | `sky_collector` ↔ PostgreSQL `batch_state` 테이블 | `offer_hashes` JSONB |
| Revalidation | `sky_collector` → Vercel | On-Demand Revalidation Webhook |
| Last batch state | `sky_collector` ↔ PostgreSQL `batch_state` 테이블 | `last_batch` JSONB |

### 7.6 소스 리스크 대응

- 첫 스프린트에서 **수집 PoC(2-3일) 최우선 수행**: 수집 성공률, 차단 빈도, 응답 지연, 링크 유지율, 가격 불일치율, 운영 비용
- **Anti-bot 필수 대응**: 메타검색/항공사의 봇 방어(Cloudflare, Datadome) 대응을 위해 **GitHub Actions Ubuntu runner + Playwright + 주거용 프록시(Residential Proxy)**를 기본 아키텍처로 사용. 단, **명시적 CAPTCHA를 솔버 등으로 무력화하거나 비정상적 해킹으로 접근하는 행위는 금지** (`source-policy.md` 참조)
- 브라우저 워커 실행 시 **Request Interception을 통해 이미지, 미디어, 폰트, CSS, GTM, Criteo 등 검색 통신과 무관한 모든 리소스를 전면 차단**하여 주거용 프록시 대역폭 비용을 방어
- 외부 사이트로 나가는 수집 트래픽은 **단일 일 배치 프로세스** 안에서 순차 실행하여 호출량을 자연스럽게 제한
- 수집 성공 기준은 **DOM 파싱이 아니라 XHR/Fetch/GraphQL 응답 또는 HTML 내장 상태 데이터 fallback 확보 여부**로 정의한다.
- 수집 결과는 Firestore 쓰기 전 **런타임 스키마 검증**을 통과해야 하며, `schema_validation_failed` 데이터는 저장하지 않는다. `price_anomaly_detected` 데이터는 `price_anomaly_status='anomaly'`로 감사용 기록을 남길 수 있으나 대표가/배지 계산에서는 제외한다.
- 사이트별 실패는 `captcha_detected`, `endpoint_changed`, `parser_error`, `proxy_blocked` 등 **원인 코드 단위로 기록**하고 `source_jobs`/`source_health`에 반영한다.
- 재시도는 이전 세션 오염을 막기 위해 **clean-room BrowserContext 재생성**을 기본 정책으로 한다.
- 불안정 시 제휴/API 또는 프로모션 페이지 중심으로 축소하는 **플랜 B** 준비
- 파트너 소스의 브랜딩/딥링크/호출량 정책은 사업개발/법무 검토 선행

### 7.7 MVP 활성 소스

- MVP 기본 활성 소스는 `Skyscanner(승인된 메타)`, `대한항공 공식`, `아시아나 공식`으로 제한
- `Google Flights`, `KAYAK` 직접 수집은 법무/파트너 검토 전까지 **feature flag 비활성**
- 소스 활성 여부와 딥링크 정책은 [source-policy.md](./source-policy.md)에서 운영 기준으로 관리

---

## 8. 지역 · 장소 체계 요건

### 8.1 지역 분류
국내선 · 일본 · 중화권 · 동남아 · 오세아니아 · 유럽 · 중동 · 북미

### 8.2 장소 요건

- 지도 핀은 **도시 단위**로 노출 (`도쿄(NRT/HND)`, `오사카(KIX/ITM)`)
- 내부적으로 도시 엔티티 + 공항 엔티티 모두 보존
- 같은 도시 여러 공항이 **중복 핀으로 노출되지 않도록** canonicalization
- 지도 · 리스트 · 달력은 **같은 장소 체계 공유**

---

## 9. 일정 · 시간 기준 요건

- `week`: 왕복 출국편 출발일 기준 ISO 주간
- `출발일`/`귀국일`: 각 편의 출발 공항 현지 날짜
- `체류기간`: 내부 `stay_nights` 저장, UI에서 버킷 변환 노출
- 날짜 변경선/야간편/환승으로 달력 어긋나지 않도록 **원본 시간대 + 현지 날짜** 함께 보존

---

## 10. 핵심 사용자 흐름

```
1. 출발 공항 + 출발 주간 선택
2. 체류기간 버킷 선택 (기본: 4-6박)
3. 지도에서 지역/도시별 대표 특가 확인
4. 핀 또는 지역 리스트 클릭
5. 목적지의 출발일 × 귀국일 가격 매트릭스 확인
6. 가격 셀 클릭
7. 해당 날짜 조합의 항공편 목록 (배치 캐시 표시)
8. 항공사/캐빈 필터링
9. 예약 링크 이동
```

---

## 11. 화면별 요건

### 11.1 메인 지도 화면

| 요건 ID | 요건 |
|---------|------|
| MAP-01 | 도시 단위 가격 핀 표시 |
| MAP-02 | 핀에 `Eco 최저가` + `Biz 최저가` 동시 표시 |
| MAP-03 | 줌아웃 시 국가/지역 클러스터 |
| MAP-04 | 지역 리스트와 동일 데이터 동기화 |
| MAP-05 | 상단 체류기간 버킷 필터 |
| MAP-06 | 각 가격에 "마지막 업데이트: N시간 전" 표시 |
| MAP-07 | "성인 1인 기준", "수하물 미포함 가능" 안내 |

### 11.2 지역 리스트

| 요건 ID | 요건 |
|---------|------|
| LIST-01 | 지역별 대표 특가, 각 행에 Eco/Biz 대표가 + 대표 항공사 + 할인 배지 |
| LIST-02 | 지도 클릭과 리스트 클릭은 같은 결과 |
| LIST-03 | 대표가에 마지막 배치 시각 또는 수집 시각 표시 |

### 11.3 날짜 매트릭스

| 요건 ID | 요건 |
|---------|------|
| CAL-01 | 출발일 × 귀국일 매트릭스, 각 셀에 최저가 |
| CAL-02 | Eco/Biz 토글 또는 병렬 표시 |
| CAL-03 | 체류기간 버킷별 계산 |
| CAL-04 | `best_depart_date`/`best_return_date` 셀 기본 하이라이트 |
| CAL-05 | 데이터 오래됨/품절 가능성 → 비활성 또는 경고 상태 |

### 11.4 항공편 상세

| 요건 ID | 요건 |
|---------|------|
| DET-01 | 표시: 항공사, 캐빈, 총액, 통화, 직항/경유, 출발/도착 시각, 총 소요시간, 출처, 예약 링크, 마지막 배치 시각 |
| DET-02 | 필터: 항공사, 캐빈, 직항/경유 |
| DET-03 | 상세 진입 시 "마지막 업데이트: YYYY.MM.DD · 일 1회 갱신" 문구 표시 |
| DET-04 | "위탁 수하물 미포함 가능" 안내 |
| DET-05 | "최종 결제 금액은 예약처에서 재확인 필요" 안내 |

---

## 12. 대표가 · 노출 품질 요건

| 요건 ID | 요건 |
|---------|------|
| QUAL-01 | 대표가 = 예약 가능성 + 여정 품질 통과 후보 중 최저가 |
| QUAL-02 | 직항 존재 시 직항 우선 노출 |
| QUAL-03 | 경유편은 직항 대비 총 소요시간 1.5배 이내만 후보 |
| QUAL-04 | 비현실적 장시간 환승 대표가 후보 제외 (상세에는 남김) |

---

## 13. 가격 신선도 · 고스트 페어 방어 요건

| 요건 ID | 요건 |
|---------|------|
| FRESH-01 | 모든 가격에 `last_seen_at` 연결 |
| FRESH-02 | 지도/리스트/매트릭스는 "탐색용 가격 (일 1회 갱신)" 명시 |
| FRESH-03 | 상세 진입 시 배치 캐시 데이터 즉시 표시 + "마지막 업데이트" 시각 표시 |
| FRESH-04 | 예약 버튼은 항공사 공식 사이트 아웃링크로 연결, 사용자가 직접 최종가 확인 |
| FRESH-05 | 종료된 프로모션 링크와 품절 요금은 배치에서 자동 비활성 |

> **v3.0 미사용**: FRESH-06(실시간 job enqueue+polling), FRESH-07(Thundering Herd) — 일 1회 배치로 전환하여 불필요

---

## 14. 특가 정의 요건

| 요건 ID | 요건 |
|---------|------|
| DEAL-01 | 특가 = 동일 조건(출발지·목적지·날짜·항공사·캐빈·체류버킷·탑승객) 대비 최근 평균보다 유의미하게 낮은 가격 |
| DEAL-02 | **가격 특가** 배지: 최근 30일/90일 평균 대비 할인 |
| DEAL-03 | **공식 프로모션** 배지: 항공사 이벤트/특가 페이지 명시 할인 |

---

## 15. 콜드 스타트 요건

| 요건 ID | 요건 |
|---------|------|
| COLD-01 | 오픈 시 사전 적재된 과거 가격 데이터를 유지하여 이력 기반 배지 부여를 위한 표본 확보 |
| COLD-02 | 워밍업 기간 fallback: 절대가 기준 임시 배지, 공식 프로모션 우선, "신규 수집 구간" 표기 |
| COLD-03 | 가격 특가 배지는 비교 표본 수 충분 시에만 부여 |

---

## 16. 데이터 모델 (요건 수준)

### Deal (대표가)
`deal_id`, 목적지 도시/엔티티ID, 국가/지역, 출발 주간, 체류버킷, Eco/Biz 최저총액·할인율·대표항공사·대표소스·예약링크, embedded `calendar_matrix`, KRW 정규화가, `last_seen_at`, `last_batch_at`, `price_status`, `warning_flags`, `enabled_sources`

### Offer (항공편)
`offer_id`, 여정 해시, 출발/목적 공항·도시, 출발/귀국일, 체류일·버킷, 마케팅/운항 항공사, 예약처, 캐빈, 총액·통화·KRW, 세금포함 여부, 직항/경유·경유횟수, 출발/도착 시각, 소요시간, 수하물 정보, 출처·타입, 예약가능상태, `last_seen_at`, `last_batch_at`, 예약링크, `parser_version`, `raw_payload_ref`, `price_anomaly_status`

### FareSnapshot (수집 이력)
수집시각, 견적유형(`batch`/`promo`), 출발/목적지, 날짜, 항공사, 캐빈, 체류버킷, 탑승객, 세금포함여부, 총액·통화·KRW, 소스, `write_fingerprint`, `parser_version`, `raw_payload_ref`, 검증상태

> **v3.0 미사용**: RefreshJob 모델 (실시간 재검증 파이프라인 삭제)

### DealBaseline (특가 기준선)
`baseline_key`, 출발지, 목적지 도시, 체류버킷, 탑승객, Eco/Biz 30일·90일 기준가, 표본 수, 기준 환율일, 계산 시각

### Place (장소)
`place_id`, 타입(`city`/`airport`/`region`), 표시명, IATA/엔티티ID, 상위지역, 연결 공항, 위도/경도

### SourceJob / SourceHealth (운영 감사)
`job_id`, `source_id`, 실행 범위(origin/region/week/stay_bucket/cabin), 상태, 시도 횟수, 발견/변경 offer 수, 실패 코드, 시작/종료 시각, `artifact_prefix`, 최근 성공/실패 시각, 차단 여부, 연속 실패 수, 24시간 성공률/지연/차단 통계

---

## 17. API 요건 (인터페이스 수준)

### 주요 엔드포인트

| 엔드포인트 | 파라미터 | 용도 |
|---|---|---|
| `GET /api/deals/map` | origin, week, region, cabin, airlines, stay_bucket, traveler | 지도/리스트 대표가 |
| `GET /api/deals/calendar` | origin, destination, week, cabin, stay_bucket, traveler | 날짜 매트릭스 |
| `GET /api/offers` | origin, destination, depart, return, cabin, airline, stops, traveler | 항공편 상세 (배치 캐시) |

### 공통 응답 요건
- 가격 통화
- **마지막 배치 시각** (`last_batch_at`)
- 경고 플래그 (`baggage_unknown`, `promo_expired_risk` 등)
- `/api/deals/map`은 `calendar_matrix`를 제외한 경량 marker payload만 반환, viewport 필터링은 프론트엔드가 수행
- `/api/offers`는 배치 캐시를 즉시 반환하고, 응답에 "마지막 업데이트" 표시에 필요한 `last_batch_at`을 포함
- 동일 `region` 조회는 **Vercel Data Cache / ISR 24시간**으로 캐시하고, 배치 완료 직후 On-Demand Revalidation으로만 갱신

---

## 18. 정렬 · 노출 규칙

| 규칙 ID | 규칙 |
|---------|------|
| SORT-01 | 기본 정렬: 대표 최저가 오름차순 |
| SORT-02 | Eco/Biz 같은 화면에 보이되, 내부 순위와 특가 계산은 분리 |
| SORT-03 | Biz 없는 노선은 Biz 슬롯 비워 둠 |
| SORT-04 | 메타검색 + 공식 사이트 동시 존재 시 `최신 + 예약 가능 + 품질 통과` 기준으로 대표값 선택 |
| SORT-05 | 상세 화면에서 소스별 링크 분리 표시 |
| SORT-06 | 오래된 가격은 더 낮더라도 최신 가격보다 대표값이 되지 않음 |

---

## 19. 성공 지표

### 사용자 지표
- 지도 핀 클릭률
- 가격 셀 클릭률
- 항공편 상세 진입률
- 예약 링크 클릭률
- 주간 재방문율
- 특가 배지 클릭률

### 운영 지표
- 수집 성공률
- 깨진 링크 비율
- 가격 불일치 신고 비율
- stale 가격 노출 비율
- 도시 canonicalization 오류 비율
- 대표가 실제 예약 가능 비율
- 배치 완료 시각 대비 지연 시간
- PostgreSQL 테이블 크기 및 인덱스 사용량
- GitHub Actions 월 실행 시간
- 주거용 프록시 월 대역폭 비용

---

## 20. 테스트 요건

| 테스트 ID | 검증 항목 |
|-----------|----------|
| T-01 | 주간 선택 시 지도·리스트·매트릭스가 같은 데이터로 갱신 |
| T-02 | 목적지별 Eco/Biz 가격 동시 정확 표시 |
| T-03 | 가격 셀 클릭 → 해당 날짜 조합 항공편 목록 |
| T-04 | 항공사 필터와 캐빈 필터 독립 동작 |
| T-05 | Eco만/Biz만/둘 다 있는 노선 각각 검증 |
| T-06 | 메타검색+공식 양쪽 있는 노선 → 하나의 딜, 상세에서 분리 |
| T-07 | 세금 포함 총액 아닌 데이터 → 비교 제외 또는 별도 표기 |
| T-08 | 종료 프로모션/품절 → 자동 비활성 |
| T-09 | 대표가가 비현실적 장시간 경유에 치우치지 않음 |
| T-10 | "성인 1인 기준" 모든 화면/API 일관 |
| T-11 | 도시/공항 canonicalization → 중복 핀 없음 |
| T-12 | 날짜 변경선/야간편에서도 매트릭스 정확 |
| T-13 | 상세 화면에서 `last_batch_at`과 "일 1회 갱신" 문구 정확 노출 |
| T-14 | 콜드 스타트 기간 특가 배지 fallback 정상 |
| T-15 | 같은 `region` 요청이 Vercel 캐시 적중 시 Firestore 추가 read 없이 응답 |
| T-16 | GitHub Actions 배치 완료 후 Vercel revalidation으로 새 데이터가 반영 |
| T-17 | Dirty check가 Firebase Storage hash manifest 기준으로만 동작하고 Firestore 전체 스캔을 하지 않음 |
| T-18 | 수집기는 DOM 파싱이 아니라 XHR/Fetch/GraphQL 응답 또는 HTML 상태 fallback으로 Offer를 추출 |
| T-19 | `schema_validation_failed` 데이터는 저장되지 않고, `price_anomaly_detected` 데이터는 anomaly로 기록되더라도 대표가 계산에 반영되지 않음 |
| T-20 | 폴링형 검색, GraphQL batch, 필수 런타임 스크립트 allowlist가 source별 Registry 설정대로 동작 |
| T-21 | `source_jobs`, `source_health`, `raw_payload_ref`가 실패 원인 추적에 충분한 정보로 연결됨 |

---

## 21. 운영 체크리스트

- [ ] 소스별 robots/약관/브랜딩/딥링크 정책 검토
- [ ] 파트너/API 제휴 가능 여부 확인
- [ ] 수집 실패 시 알림 및 소스 헬스 모니터링
- [ ] 환율 변환 기준 시각 관리
- [ ] KEXIM 주말/공휴일 fallback 유지 여부 확인
- [ ] 가격 이력 보관 기간 및 배치 비용 산정
- [ ] Dirty checking과 changed-only write 적용
- [ ] `deal_baselines` 심야 선계산과 배지 계산 경로 분리
- [ ] GitHub Actions 실행 시간(월 2,000분)과 일 배치 시간 확인
- [ ] Firebase Storage hash manifest 업로드/다운로드 경로 확인
- [ ] raw payload / screenshot / error dump의 Storage 경로와 Firestore 참조 필드 연결 확인
- [ ] Vercel On-Demand Revalidation Webhook 구성 확인
- [ ] PostgreSQL Docker 컨테이너 헬스체크 및 데이터 볼륨 백업 확인
- [ ] Vercel Hobby 함수에서 Playwright/장시간 배치를 실행하지 않도록 경계 확인
- [ ] GitHub Actions cron(`0 17 * * *` UTC, KST 02:00)과 batch timeout 확인
- [ ] `source_jobs`, `source_health`, `schema_validation_failed`, `price_anomaly_detected` 운영 알림 경로 확인
- [ ] 관리자용 수동 비활성화 도구 제공
- [ ] CS 대응용 "왜 이 가격이 바뀌었는지" 추적 로그

---

## 22. 기본 가정

- 기본 시장: 한국 출발
- 기본 언어/통화: `ko-KR`, `KRW`
- 국내선도 비즈니스/프리미엄 캐빈이 존재하면 포함
- 탐색 진입 방식: 지도 탐색 + 날짜 탐색 두 가지 모두 지원
- 초기 MVP: 성인 1인 기준 가격 비교가 전반의 기본 축
- 공개 읽기는 모두 Next.js BFF를 통해서만 수행
- 지도 bounds 필터는 MVP에서 geohash가 아니라 **프론트엔드(MapLibre)가 클라이언트에서 수행**. BFF는 `region` 단위로 데이터를 내려주고, **`region`이 없으면 기본 region을 적용**하여 전체 문서 스캔을 방지
- 환율 정규화 기준: **KEXIM(한국수출입은행) 일일 고시환율**. 1차 고시 직후(`11:30 KST`) 수집. **주말/공휴일에는 직전 영업일 데이터 fallback**
- `/api/deals/map`은 **`select()` FieldMask로 `calendar_matrix` 필드를 제외**하여 OOM과 Egress 비용을 방어
- 특가 배지 판별을 위한 30/90일 평균가는 **심야 배치로 메타 문서에 사전 계산**, 워커는 이 단일 문서만 참조
- 웹/BFF는 **Vercel Hobby**, 데이터는 **Docker PostgreSQL**, 일 배치는 **GitHub Actions cron**을 사용
- PostgreSQL은 Docker 컨테이너로 실행하며 `docker compose up -d db`로 시작한다
- Vercel Hobby 함수는 짧은 조회 응답 전용으로만 사용하고, 브라우저 엔진이나 장시간 작업을 올리지 않는다
- 전체 테이블 비교 대신 **PostgreSQL `batch_state` 테이블의 hash manifest**로 dirty check를 수행
- 사용자 응답은 **Vercel Data Cache / ISR 24시간**을 기본으로 하며, 배치 완료 후 On-Demand Revalidation으로 갱신한다
- 주요 과금 요소는 **residential proxy**와 **PostgreSQL 호스팅(프로덕션 전환 시)**이다
- MVP 기본 체류 버킷은 `4-6박(5-7일)`이며 `traveler=adt1`을 유지

---

## 23. 권장 구현 순서

1. **source-policy 확정**: 승인 source, 딥링크, 브랜딩, feature flag 잠금
2. **`sky_collector` 모듈 초기화**: Python 프로젝트 뼈대, Playwright 설치, Firestore 연결 (collector_plan.md Phase 0)
3. **Core Engine 구현**: BrowserSession, NetworkCapture, ResourceBlocker, FailureClassifier (Phase 1)
4. **Pydantic Data Models**: NormalizedOffer, FareSnapshot, AnomalyDetector (Phase 2)
5. **LCC PoC**: 진에어/제주항공 XHR 캡처 → Pydantic 검증 → Offer 생성 end-to-end 검증 (Phase 3)
6. `places`, `deals_current(embedded calendar_matrix)`, `offers`, `deal_baselines` 스키마 및 Firestore 인덱스 확정
7. **Firestore 연동 및 Dirty Check**: Storage manifest diff → changed-only write → Deal materialization (Phase 4)
8. `GET /api/deals/map`, `GET /api/deals/calendar`, `GET /api/offers` BFF 구현 + Vercel ISR 24시간 적용
9. **배치 파이프라인 8단계 완성**: 환율 → manifest → 수집 → dirty check → write → baseline → manifest 업로드 → revalidation (Phase 5)
10. "마지막 업데이트" UI + 아웃링크 예약 연결
11. 추가 사이트 어댑터: 아시아나 → 대한항공 → Skyscanner (Phase 6)
12. `ops.md` 기준 운영 안정화: GitHub Actions 실행 시간, Firestore quota, 프록시 비용, 알림 연동 (Phase 7)

---

## 24. 향후 확장 경로

| 단계 | 영역 | 설명 |
|---|---|---|
| Scale-up | 실시간 재검증 | 필요 시 on-demand refresh 파이프라인을 별도 서브시스템으로 재도입 |
| Scale-up | 검색 DB | 노선 수십만 확장 시 Firestore+BFF → Elasticsearch/Typesense CDC |
| Scale-up | 문서 제한 | embedded `calendar_matrix` 1MB 대비 → Redis Cache 또는 서브커렉션 |
| Biz | Price Alert | `daily-batch` 가격 변동 감지 → 유저 조건 매칭 → Push/이메일 알림 |
| Biz | 공식 API 전환 | 서비스 지표 증명 후 브라우저 스크래핑 → Skyscanner B2B API, NDC 다이렉트 연동 |
