# Sky Planner Atlas 상용화 요구사항 및 검증 기준

- **문서명**: Project Requirements & Acceptance Criteria
- **프로젝트**: Sky Planner Atlas
- **문서 상태**: Approved Baseline
- **대상 환경**: Production
- **주요 런타임**:
  - Web/BFF: Next.js App Router, React, Vercel Pro 이상
  - Collector: Python 3.11+
  - Database: PostgreSQL 16+
  - Map: MapLibre GL JS
- **최종 완료 조건**:
  - 본 문서의 P0 검증 항목 100% 통과
  - P1 검증 항목은 합의된 예외를 제외하고 통과
  - `ready_to_launch: true` 감사 결과 생성
  - 미해결 P0 결함 0건

---

# 1. 프로젝트 개요

Sky Planner Atlas는 한국 주요 공항에서 출발하는 항공 특가를 수집하고, 사용자가 지도와 날짜를 기준으로 특가를 탐색한 후 제휴 예약처로 이동할 수 있도록 제공하는 항공 특가 탐색 플랫폼이다.

## 1.1 지원 출발 공항

초기 출시 범위는 다음 공항으로 제한한다.

- 인천국제공항: `ICN`
- 김포국제공항: `GMP`
- 김해국제공항: `PUS`
- 제주국제공항: `CJU`

## 1.2 기본 검색 조건

별도 조건이 지정되지 않은 경우 다음 기준을 사용한다.

- 승객: 성인 1명
- 여정: 왕복
- 좌석 등급: 이코노미
- 체류기간: 4박 이상 6박 이하
- 표시 통화: KRW
- 가격 기준: 세금 포함 총액
- 최종 가격 및 예약 가능 여부: 예약처에서 확인
- 이코노미와 비즈니스 가격은 분리하여 관리 및 표시

## 1.3 핵심 운영 원칙

1. 지도와 캘린더 탐색에는 배치 기반 참고 가격을 사용한다.
2. 실제 예약 가능 여부와 최종 가격은 예약처에서 확인한다.
3. 수집기와 웹/BFF 런타임을 분리한다.
4. 공식 API 또는 공식 Feed를 최우선으로 사용한다.
5. 서면 승인되지 않은 접근통제 우회 또는 자동화는 구현하지 않는다.
6. Collector는 운영 Read Model을 직접 수정하지 않는다.
7. Production 데이터 쓰기는 단일 Ingest 계층만 담당한다.
8. Mock 데이터는 Production에서 사용할 수 없다.
9. 데이터에는 수집 시각, 가격 기준 시각 및 출처를 표시한다.
10. 소스별 사용 약관, 저장 권한, 표시 의무 및 딥링크 조건을 준수한다.

---

# Part A. 요구사항

# 2. 범위 및 산출물 요구사항

## REQ-SCOPE-001 프로젝트 범위

다음 영역을 상용화 작업 범위에 포함한다.

1. 공식 API 또는 승인된 Feed 기반 데이터 소스 연동
2. Python 기반 독립 Collector 패키지
3. 표준화된 Batch 생성 및 Ingest 파이프라인
4. PostgreSQL 운영 데이터 모델
5. Next.js 기반 Web/BFF
6. MapLibre 기반 지도 탐색 화면
7. 캘린더 및 오퍼 탐색 화면
8. 딥링크 검증 및 제휴 추적
9. 운영 모니터링과 알림
10. 배포, 장애 대응, 복구 및 재처리 절차
11. 보안 및 Secret 관리
12. 출시 감사 및 검증 자동화

## REQ-SCOPE-002 제외 범위

별도 승인되지 않는 한 다음은 초기 출시 범위에서 제외한다.

- 항공권 직접 결제
- 예약 대행
- 사용자 여권 또는 결제정보 저장
- 다구간 항공권
- 복수 승객 조합 가격
- 마일리지 항공권
- 호텔 및 렌터카 예약
- 승인되지 않은 웹사이트 자동 수집
- CAPTCHA 또는 접근통제 우회
- 사용자 계정 및 개인화 추천

## REQ-SCOPE-003 필수 산출물

납품자는 다음 산출물을 제공해야 한다.

- 소스별 Connector 코드
- Collector 실행 패키지
- `NormalizedOffer` 및 Batch 스키마
- Ingest 파이프라인
- DB Migration
- API 계약서
- MapLibre 지도 화면
- 자동화 테스트
- 운영 Dashboard
- 배포 Runbook
- 장애 대응 Runbook
- 데이터 재처리 Runbook
- Secret 및 권한 목록
- 소스별 Compliance Matrix
- 검증 결과 보고서
- Architecture Decision Record
- 알려진 제한사항 및 잔여 위험 목록

---

# 3. 데이터 소스 및 규정 준수 요구사항

## REQ-SOURCE-001 데이터 취득 우선순위

데이터 소스는 다음 우선순위로 연동한다.

1. 공식 제휴 API
2. 공식 JSON/XML/CSV Feed
3. 파트너가 서면 승인한 Server-to-Server 연동
4. 파트너가 서면 승인한 Browser Automation

## REQ-SOURCE-002 금지 사항

다음 방식은 구현 범위에서 제외한다.

- CAPTCHA 우회
- 접근통제 우회
- 보안 쿠키 탈취
- 비인가 내부 API 호출
- 약관상 금지된 자동 수집
- 사용자 계정 또는 인증정보 공유
- 데이터 저장 또는 재배포 권한이 확인되지 않은 소스의 운영 사용

## REQ-SOURCE-003 소스 Compliance Matrix

활성화되는 모든 데이터 소스에 대해 다음 정보를 기록한다.

| 항목 | 설명 |
|---|---|
| `source_id` | 내부 소스 식별자 |
| 파트너명 | API 또는 Feed 제공자 |
| 접근 방식 | API, Feed, 승인된 Automation |
| 계약 상태 | 검토 중, 승인, 만료, 중지 |
| 가격 저장 권한 | 저장 가능 여부와 보존기간 |
| 가격 표시 권한 | UI 표시 가능 여부 |
| 재배포 권한 | 집계 또는 2차 제공 가능 여부 |
| 호출 한도 | 초당, 분당, 일일 한도 |
| 데이터 TTL | 가격 유효기간 |
| 딥링크 조건 | 생성 규칙과 필수 추적 파라미터 |
| 표시 의무 | 로고, 출처, Powered by 등 |
| 수익화 조건 | CPA, CPC 또는 기타 |
| 담당자 | 내부 및 파트너 담당자 |
| 계약 만료일 | 계약 또는 API 접근 만료일 |
| 비활성화 조건 | 오류율, 계약 만료, 데이터 품질 저하 등 |

## REQ-SOURCE-004 초기 출시 소스 조건

초기 출시 전 최소 1개 이상의 핵심 데이터 소스에 대해 다음 조건이 충족되어야 한다.

- 공식 접근 권한 또는 서면 승인 확보
- 샘플 응답 20건 이상 확보
- 호출 한도 확인
- 가격 저장 및 표시 권한 확인
- 딥링크 사용 권한 확인
- 데이터 매핑 완료
- 딥링크 왕복 테스트 완료
- 장애 시 대체 또는 비활성화 절차 정의

## REQ-SOURCE-005 소스 Manifest

비밀정보를 제외한 소스 설정은 Git에서 관리하는 Manifest에 저장한다.

예시 필드:

```json
{
  "schema_version": "collector.source_manifest.v1",
  "sources": [
    {
      "source_id": "partner_a",
      "enabled": true,
      "connector_type": "official_api",
      "secret_ref": "SOURCE_PARTNER_A_API_KEY",
      "max_requests_per_minute": 30,
      "max_stale_hours": 28,
      "priority": 100
    }
  ]
}
```

API Key, Client Secret 및 토큰은 Manifest에 직접 기록하지 않고 `secret_ref`로 참조한다.

---

# 4. Collector 요구사항

## REQ-COL-001 런타임

Collector는 다음 기준으로 구성한다.

- Python 3.11 이상
- Pydantic v2 이상
- 구조화 로그 지원
- 비동기 HTTP Client 사용 가능
- 공식 API Connector와 승인된 Browser Connector 분리
- 실행 환경과 독립된 CLI 또는 Job Entry Point 제공

## REQ-COL-002 Connector 인터페이스

모든 Connector는 공통 인터페이스를 구현해야 한다.

필수 동작:

1. 설정 검증
2. 인증 검증
3. 소스 호출
4. 응답 파싱
5. `NormalizedOffer` 변환
6. 데이터 품질 검사
7. Batch 생성
8. 실행 결과 및 통계 반환

Connector별 구현 상세가 공통 Ingest 및 UI 코드에 노출되어서는 안 된다.

## REQ-COL-003 재시도 정책

일시적 오류에 대해 다음 정책을 적용한다.

- Exponential Backoff
- Random Jitter
- `429` 응답 시 `Retry-After` 준수
- 재시도 가능한 오류와 불가능한 오류 구분
- 소스별 최대 재시도 횟수 설정
- 최대 실행시간 설정
- 실패 소스가 다른 소스의 수집을 차단하지 않도록 격리

## REQ-COL-004 Circuit Breaker

다음 상황에서 소스별 Circuit Breaker를 활성화할 수 있어야 한다.

- 연속 인증 실패
- 연속 Rate Limit 초과
- 응답 스키마 대량 변경
- 딥링크 유효성 급락
- 비정상적으로 빈 응답
- 파트너 계약 만료 또는 긴급 중지

## REQ-COL-005 실행 식별자

모든 Collector 실행에는 다음 식별자를 부여한다.

- `job_id`
- `run_id`
- `source_id`
- `batch_id`
- `schema_version`
- `started_at`
- `completed_at`
- `collector_version`

## REQ-COL-006 실행 결과

Collector는 실행 완료 시 다음 통계를 출력해야 한다.

- 요청 수
- 성공 응답 수
- 실패 응답 수
- Rate Limit 발생 수
- 파싱 성공 수
- 파싱 실패 수
- 생성된 오퍼 수
- 중복 제거된 오퍼 수
- 격리된 오퍼 수
- 전체 실행시간
- 소스별 마지막 정상 수집 시각

## REQ-COL-007 원본 응답 관리

계약 및 개인정보 정책이 허용하는 범위에서 재현 가능한 형태로 원본 응답 또는 원본 응답의 참조를 관리한다.

- 원본 저장이 허용되지 않으면 checksum과 파싱 메타데이터만 저장
- 저장 시 암호화 및 보존기간 적용
- 인증정보, 쿠키, 토큰 및 개인정보 제거
- Batch와 원본 응답을 추적할 수 있어야 함

---

# 5. 표준 데이터 계약 요구사항

## REQ-DATA-001 Batch 규격

Collector는 `collector.normalized_batch.v1` 규격의 Batch를 생성한다.

필수 필드:

```text
schema_version
batch_id
source_id
collector_version
collected_at
generated_at
checksum
offer_count
offers[]
metadata
```

## REQ-DATA-002 Batch 멱등성

- 동일한 `batch_id`를 여러 번 처리해도 중복 데이터가 생성되지 않아야 한다.
- 동일 Batch 재처리는 성공 또는 기존 처리 결과를 반환해야 한다.
- checksum이 다른 동일 `batch_id`는 충돌로 처리하고 publish하지 않는다.

## REQ-DATA-003 NormalizedOffer 필수 필드

각 오퍼는 다음 정보를 포함해야 한다.

```text
offer_id
source_id
source_offer_id
origin_airport
destination_airport
outbound_departure_at
outbound_arrival_at
return_departure_at
return_arrival_at
timezone
marketing_carriers
operating_carriers
cabin_class
fare_brand
stops_outbound
stops_return
self_transfer
baggage_included
adult_count
native_amount
native_currency
tax_included
fee_included
krw_amount
fx_rate
fx_source
fx_effective_at
observed_at
expires_at
deeplink_url
deeplink_expires_at
terms_url
data_license
```

소스에서 제공되지 않는 필드는 `null`로 명시하고, 추정값을 사실값처럼 저장해서는 안 된다.

## REQ-DATA-004 날짜와 시간

- 모든 timestamp는 timezone 정보를 포함한다.
- DB에는 UTC 기준으로 저장한다.
- 사용자 화면에는 출발지 또는 도착지의 현지시간을 표시한다.
- 날짜 변경선 및 익일 도착을 표시할 수 있어야 한다.
- KST 기준 배치 시각을 별도 계산할 수 있어야 한다.

## REQ-DATA-005 가격

가격에는 다음 원칙을 적용한다.

- 원 통화 금액을 변경 없이 보존
- KRW 금액은 파생값으로 관리
- 세금 포함 여부 명시
- 수수료 포함 여부 명시
- 가격 기준 시각 저장
- 최종 가격이 아님을 UI에 표시
- 이코노미와 비즈니스를 혼합 집계하지 않음
- 편도 가격을 왕복 가격처럼 표시하지 않음

## REQ-DATA-006 중복 제거

오퍼 중복 판정에는 최소한 다음 조건을 고려한다.

- 소스
- 출발지
- 목적지
- 출발일
- 귀국일
- 항공사
- 항공편 또는 여정 조합
- 좌석 등급
- 가격
- 딥링크 식별자

서로 다른 소스의 동일 여정은 별도 오퍼로 유지하되, Read Model에서 비교 가능한 형태로 집계한다.

---

# 6. FX 환율 요구사항

## REQ-FX-001 환율 데이터

KRW 환산 시 다음 정보를 저장한다.

- 환율 제공자
- 환율
- 기준 통화
- 대상 통화
- 기준일
- 조회 시각
- 실제 적용 시각

## REQ-FX-002 장애 처리

- Primary FX Provider 장애 시 마지막 정상 환율을 사용할 수 있다.
- 마지막 정상 환율 사용 최대 기간은 기본 72시간으로 한다.
- 72시간을 초과하면 해당 통화의 KRW 가격을 새로 게시하지 않는다.
- 원 통화 가격은 보존한다.
- fallback 사용 여부를 로그와 데이터에 표시한다.

## REQ-FX-003 환율 재현성

특정 오퍼의 KRW 가격이 어떤 환율로 계산되었는지 재현할 수 있어야 한다.

---

# 7. Ingest 및 데이터베이스 요구사항

## REQ-ING-001 Single Writer

Production 데이터에 대한 쓰기는 Ingest 계층 하나만 담당한다.

- Collector는 운영 Read Model을 직접 수정하지 않는다.
- Web/BFF는 운영 가격 데이터에 대한 쓰기 권한을 갖지 않는다.
- Migration은 별도의 권한으로 실행한다.

## REQ-ING-002 적재 절차

Ingest는 다음 순서로 실행한다.

1. Batch 스키마 검증
2. checksum 검증
3. Source 활성 상태 검증
4. 데이터 품질 검증
5. Staging 적재
6. 중복 제거
7. 트랜잭션 시작
8. 원본 오퍼 및 Snapshot 반영
9. Read Model 갱신
10. Batch 상태 갱신
11. 트랜잭션 Commit
12. 캐시 무효화
13. 후속 Smoke Test

## REQ-ING-003 원자적 Publish

다음 조건을 만족하지 못한 Batch는 운영 데이터에 부분적으로 노출되어서는 안 된다.

- Batch 스키마 유효
- 필수 데이터 품질 기준 충족
- DB 트랜잭션 성공
- Read Model 생성 성공
- Batch 상태 갱신 성공

## REQ-ING-004 격리 및 재처리

검증 실패 Batch는 격리 상태로 기록한다.

필수 상태 예시:

```text
RECEIVED
VALIDATING
REJECTED
STAGED
PUBLISHING
PUBLISHED
REVALIDATING
COMPLETED
FAILED
REPLAYING
```

운영자는 실패 Batch를 수정 없이 재처리하거나, 수정된 새 Batch로 다시 제출할 수 있어야 한다.

## REQ-DB-001 PostgreSQL

- PostgreSQL 16 이상 사용
- Production과 Preview/Stage DB 분리
- TLS 연결 필수
- 자동 백업 활성화
- PITR 지원
- Connection Pooler 적용 여부 명시
- Vercel과 DB 리전 최적화

## REQ-DB-002 계정 분리

최소 다음 DB 연결정보를 분리한다.

```text
DATABASE_READ_URL
DATABASE_INGEST_URL
DATABASE_MIGRATION_URL
```

권한 원칙:

- `READ`: 필요한 테이블에 대한 조회
- `INGEST`: 필요한 테이블에 대한 제한된 쓰기
- `MIGRATION`: DDL 실행
- 운영자가 아닌 외부 업체의 직접 Production 접근 최소화

## REQ-DB-003 데이터 보존

테이블별 보존기간을 정의한다.

최소 대상:

- 원본 오퍼
- 가격 Snapshot
- 현재 Deal
- Batch 기록
- Source Job 기록
- Audit Log
- 원본 응답
- 실패 및 격리 데이터

---

# 8. BFF 및 API 요구사항

## REQ-API-001 필수 API

최소 다음 API를 제공한다.

```text
GET  /api/search
GET  /api/deals/map
GET  /api/deals/calendar
GET  /api/offers
GET  /api/ops/health
GET  /api/ops/readiness
POST /api/internal/revalidate
```

## REQ-API-002 Map API

`/api/deals/map`은 최소 다음 조건을 지원한다.

```text
origin
cabin
departureFrom
departureTo
stayMin
stayMax
bbox
zoom
```

응답에는 다음 정보를 포함한다.

```text
destination_id
city_code
airport_codes
latitude
longitude
min_price_krw
native_price
native_currency
departure_date
return_date
source_count
offer_count
freshness_at
best_offer_id
batch_id
```

## REQ-API-003 오류 응답

API 오류 응답은 다음 정보를 포함한다.

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "사용자 또는 운영자용 메시지",
    "request_id": "unique-request-id"
  }
}
```

Production에서는 내부 Stack Trace, DB 연결 문자열 또는 Secret을 반환하지 않는다.

## REQ-API-004 Mock 차단

`SERVICE_REQUIRE_POSTGRES=true`인 환경에서는 다음을 적용한다.

- PostgreSQL 연결 실패 시 Mock 데이터로 fallback하지 않음
- 사용자 API는 적절한 `503 Service Unavailable` 반환
- 운영 알림 발생
- 마지막 정상 데이터 제공 정책이 있는 경우 stale 상태를 명확히 표시

## REQ-API-005 캐시

- 검색 조건별 Cache Key 규칙 정의
- 데이터 Batch와 Cache를 추적할 수 있도록 `batch_id` 제공
- `revalidateTag` 또는 동등한 태그 기반 무효화 사용
- Publish 성공 후에만 캐시 무효화
- 캐시 무효화 실패 시 재시도
- 무효화 실패가 DB Publish를 rollback시키지 않도록 상태를 별도 관리

---

# 9. 지도 및 사용자 화면 요구사항

## REQ-MAP-001 기술 구성

- MapLibre GL JS 사용
- Next.js App Router와 통합
- Client Component로 지도 렌더링
- 필요한 경우 `next/dynamic`으로 브라우저 전용 로딩
- 다크 및 라이트 테마 지원
- 반응형 UI 지원

## REQ-MAP-002 지도 공급망

다음 항목을 명시한다.

- 벡터 타일 공급자
- Style JSON 위치
- Sprite 및 Font 위치
- Attribution 문구
- API Key 제한 정책
- 월별 사용량 및 비용 상한
- 지도 공급자 장애 시 fallback

## REQ-MAP-003 지도 표시

지도에는 다음을 표시한다.

- 선택된 출발 공항
- 도착 도시 또는 공항
- 목적지별 최저가
- 데이터 기준 시각
- 선택된 목적지의 대권 항로
- 줌 레벨에 따른 Cluster
- 선택 또는 Hover 상태

모든 목적지의 항로를 동시에 표시하지 않고, 선택된 목적지 중심으로 표시한다.

## REQ-MAP-004 Cluster

Cluster에는 다음 정보를 표시할 수 있어야 한다.

- Cluster 내부 목적지 수
- Cluster 내부 최저가
- 대표 목적지
- 데이터 Freshness

Cluster 클릭 시 적절한 하위 Zoom 또는 목적지 목록으로 이동한다.

## REQ-MAP-005 Popup

핀 또는 가격 클릭 시 다음 정보를 표시한다.

- 목적지명
- 출발 및 귀국일
- 체류기간
- 최저가
- 통화
- 좌석 등급
- 경유 여부
- 가격 확인 시각
- 오퍼 상세 이동 버튼

## REQ-MAP-006 Fallback

다음 환경에서도 핵심 기능을 사용할 수 있어야 한다.

- WebGL 미지원
- 지도 Script 로딩 실패
- 타일 공급자 장애
- 저사양 모바일
- JavaScript 오류

Fallback은 목적지 및 가격 목록 형태로 제공한다.

## REQ-UI-001 가격 고지

가격 표시 영역에 다음 정보를 제공한다.

- 가격 기준 시각
- 성인 인원
- 왕복 또는 편도 여부
- 세금 포함 여부
- 수수료 포함 여부
- 수하물 포함 여부
- 최종 가격은 예약처에서 확인해야 한다는 안내

## REQ-UI-002 접근성

- 키보드로 주요 기능 접근 가능
- 가격 및 목적지가 색상만으로 구분되지 않음
- 충분한 명도 대비
- 지도 대체 목록 제공
- 버튼과 링크에 접근 가능한 이름 제공
- Focus 상태 표시
- Modal 및 Popup Focus 관리

---

# 10. 딥링크 요구사항

## REQ-LINK-001 허용 기준

딥링크는 다음 조건을 충족해야 한다.

- HTTPS
- 승인된 도메인
- 제휴 추적 파라미터 포함
- 악성 또는 비인가 Redirect 없음
- 출발지, 목적지 및 날짜가 가능한 범위에서 일치
- 만료 시각이 있으면 저장
- 사용자에게 최종 예약처를 명확히 표시

## REQ-LINK-002 검증

딥링크 검증은 URL 문자열 고유성만으로 판단하지 않는다.

다음을 검사한다.

- URL 구문
- Scheme
- Domain Allowlist
- Redirect 횟수
- 최종 Landing Domain
- 여정 조건 보존
- 추적 파라미터
- HTTP 오류
- 만료 여부
- 소스별 필수 표시 조건

## REQ-LINK-003 실패 처리

딥링크가 유효하지 않은 오퍼는 다음 중 하나로 처리한다.

- UI 노출 제외
- 상세보기만 제공하고 예약 버튼 비활성화
- 정상 대체 딥링크로 교체

유효하지 않은 링크를 활성 예약 버튼으로 제공해서는 안 된다.

---

# 11. 인프라 및 배포 요구사항

## REQ-INFRA-001 환경

최소 다음 환경을 분리한다.

- Development
- Preview 또는 Staging
- Production

각 환경의 DB, API Key, Webhook 및 Secret을 분리한다.

## REQ-INFRA-002 Vercel

- Production은 Vercel Pro 이상 사용
- Hobby는 개인 개발 또는 비상업적 Preview에만 사용
- 커스텀 도메인과 HTTPS 적용
- Production 배포 보호 정책 적용
- Preview 환경이 Production DB를 사용하지 않도록 차단

## REQ-INFRA-003 Collector Runner

초기 Collector Runner로 GitHub Actions를 사용할 수 있다.

단, 다음 상황에서는 별도 Job Runner 이전 계획을 수립한다.

- 장시간 브라우저 세션 필요
- 실행시간 또는 동시성 한도 초과
- 고정 네트워크 필요
- 빈번한 스케줄 필요
- 소스 수 증가
- 세밀한 재시도 및 작업 재개 필요

후보 환경:

- Cloud Run Jobs
- AWS ECS/Fargate
- AWS Batch
- 동등한 Managed Job Runner

## REQ-INFRA-004 배포 방식

- 모든 변경은 Pull Request로 제출
- Production 직접 수정 금지
- 자동 테스트 통과 후 병합
- DB 변경에는 Migration 포함
- 비가역 DB 변경에는 별도 승인 필요
- 배포 실패 시 Rollback 절차 제공
- 소스별 Feature Flag 제공

---

# 12. Secret 및 보안 요구사항

## REQ-SEC-001 Secret 생성

자체 생성 Secret은 암호학적으로 안전한 난수 32바이트 이상을 사용한다.

적용 대상:

- 운영 진단 토큰
- Revalidation Secret
- 내부 Webhook Secret
- Service-to-Service 인증정보

파트너가 발급한 Key는 파트너 형식을 그대로 사용한다.

## REQ-SEC-002 Secret 저장

- Secret은 Git에 저장하지 않는다.
- 로그에 Secret을 출력하지 않는다.
- Audit Artifact에 Secret을 포함하지 않는다.
- 환경별 Secret을 분리한다.
- 외부 개발사에 불필요한 Production Secret을 제공하지 않는다.
- Secret 이름과 주입 절차만 문서화한다.

## REQ-SEC-003 Secret 회전

- 사고 발생 시 즉시 회전
- 담당자 변경 시 접근 권한 검토
- 정기 회전 정책 정의
- 회전 시 서비스 중단 방지 절차 제공
- 폐기된 Secret의 사용 여부 감사

## REQ-SEC-004 내부 Endpoint

내부 운영 및 Revalidation Endpoint는 다음 중 하나 이상의 방식으로 보호한다.

- HMAC Signature
- Timestamp
- Replay 방지
- Bearer Token
- IP 또는 Network 제한
- Rate Limit

## REQ-SEC-005 개인정보

초기 버전에서 사용자 개인정보를 저장하지 않는 것을 기본 원칙으로 한다.

Analytics 또는 문의 기능으로 개인정보를 수집할 경우 다음을 제공한다.

- 개인정보처리방침
- 수집 목적
- 보존기간
- 삭제 절차
- Cookie 또는 Analytics 동의 정책
- 외부 처리자 목록

---

# 13. 환경변수 요구사항

## REQ-ENV-001 필수 환경변수

| 환경변수 | 대상 | 설명 |
|---|---|---|
| `DATABASE_READ_URL` | Vercel | BFF 조회 전용 |
| `DATABASE_INGEST_URL` | Job Runner | Ingest 전용 |
| `DATABASE_MIGRATION_URL` | CI/CD | DB Migration 전용 |
| `SERVICE_REQUIRE_POSTGRES` | Vercel, Job Runner | Production에서는 `true` |
| `OPS_ALERT_WEBHOOK_URL` | Vercel, Job Runner | 운영 알림 수신 URL |
| `OPS_READINESS_TOKEN` | Vercel, CI/CD | 운영 진단 인증 |
| `VERCEL_REVALIDATE_SECRET` | Vercel, Job Runner | 캐시 무효화 인증 |
| `SUPPORT_EMAIL` | Vercel | 고객 문의 이메일 |
| `SOURCE_MAX_STALE_HOURS` | Vercel, Job Runner | 기본값 `28` |
| `COLLECTOR_SOURCE_MANIFEST_PATH` | Job Runner | 소스 Manifest 경로 |
| `APP_ENV` | 전체 | development, staging, production |
| `LOG_LEVEL` | 전체 | 로그 레벨 |
| `RELEASE_VERSION` | 전체 | 배포 버전 |

소스별 API Key는 별도 환경변수 또는 Secret Manager에서 관리한다.

## REQ-ENV-002 환경변수 사전검증

애플리케이션 실행 전에 다음을 검증한다.

- 필수 환경변수 존재 여부
- URL 형식
- Production에서 Mock 차단 여부
- Secret 기본값 또는 예제값 사용 여부
- Production과 Preview DB 중복 여부
- Source Manifest의 `secret_ref` 존재 여부
- 비활성 소스의 Secret은 필수로 요구하지 않음

---

# 14. 관측성 및 운영 요구사항

## REQ-OPS-001 구조화 로그

모든 서비스는 JSON 또는 동등한 구조화 로그를 출력한다.

필수 필드:

```text
timestamp
level
service
environment
release_version
request_id
run_id
job_id
batch_id
source_id
event
duration_ms
error_code
```

Secret, Authorization Header, Cookie 및 전체 DB URL은 기록하지 않는다.

## REQ-OPS-002 Metric

최소 다음 Metric을 수집한다.

- API 요청 수
- API 오류율
- API 응답시간
- Source별 수집 성공률
- Source별 데이터 건수
- Source별 마지막 정상 수집 시각
- Batch 처리시간
- Batch 거부율
- 딥링크 유효율
- 가격 데이터 Freshness
- FX Provider 상태
- Revalidation 성공률
- DB Connection 오류
- Job 실행시간
- 예상 인프라 비용

## REQ-OPS-003 Alert

다음 조건에 대해 운영 알림을 발생시킨다.

- Production API 오류율 임계치 초과
- DB 연결 실패
- 핵심 소스 연속 실패
- 마지막 정상 Publish가 허용시간 초과
- 딥링크 유효율 급락
- Batch 데이터량 급변
- FX 데이터 72시간 초과
- Revalidation 연속 실패
- Secret 또는 인증 오류 급증
- 백업 또는 복구 작업 실패

## REQ-OPS-004 Runbook

최소 다음 Runbook을 제공한다.

- Collector 장애
- API 인증 실패
- Rate Limit 초과
- 응답 스키마 변경
- DB 장애
- Batch 재처리
- 데이터 롤백
- 캐시 갱신 실패
- 딥링크 장애
- FX 장애
- 소스 긴급 비활성화
- Production 배포 롤백

---

# 15. 비기능 요구사항

## REQ-NFR-001 성능

기본 목표:

- 캐시 적중 API 응답시간 P95: 500ms 이하
- DB 조회 API 응답시간 P95: 1,500ms 이하
- 지도 초기 데이터 응답 P95: 1,500ms 이하
- 지도 기본 화면 Interaction 가능 시점: 합의된 모바일 기준에서 5초 이하
- 대량 목적지 데이터는 viewport 또는 pagination 방식으로 제한

성능 목표는 실제 인프라와 사용자 지역을 기준으로 최종 확정한다.

## REQ-NFR-002 가용성

- BFF 월간 가용성 목표 정의
- 데이터 소스 장애가 전체 서비스 장애로 확산되지 않도록 격리
- 일부 소스 장애 시 정상 소스 데이터 제공
- Stale 데이터 사용 시 사용자에게 상태 표시
- 운영자가 소스별로 즉시 비활성화 가능

## REQ-NFR-003 호환성

최소 지원 범위:

- 최신 Chrome
- 최신 Safari
- 최신 Firefox
- 최신 Edge
- iOS Safari
- Android Chrome

구체적인 최소 버전은 출시 전 Browser Support Matrix로 확정한다.

## REQ-NFR-004 비용

다음 서비스의 월별 예산과 알림 임계치를 설정한다.

- Vercel
- PostgreSQL
- Map Tile
- Job Runner
- Proxy 또는 네트워크 서비스
- Monitoring
- Object Storage
- 데이터 소스 API

---

# Part B. 검증 기준

# 16. 검증 공통 원칙

## VER-GEN-001 검증 환경

모든 P0 검증은 다음 조건에서 수행한다.

- Production과 동일하거나 동등한 Staging 환경
- 실제 PostgreSQL 사용
- Mock 데이터 비활성화
- 실제 Source Credential 또는 승인된 Sandbox Credential 사용
- 실제 Cache 및 Revalidation 경로 사용
- 실제 지도 타일 공급자 사용
- 검증용 Secret은 Production Secret과 분리

## VER-GEN-002 증빙

각 검증 결과에는 다음 정보를 포함한다.

- 검증 ID
- 실행 시각
- 실행 환경
- Release Version
- Commit SHA
- 실행 명령
- Pass 또는 Fail
- 실제 결과
- 기대 결과
- 로그 또는 Report 경로
- 담당자
- 승인자

## VER-GEN-003 우선순위

- **P0**: 미통과 시 출시 불가
- **P1**: 원칙적으로 출시 전 통과, 예외는 서면 승인 필요
- **P2**: 출시 후 개선 가능

---

# 17. 소스 및 Compliance 검증

## VER-SOURCE-001 공식 접근 권한

- **우선순위**: P0
- **대상 요구사항**: `REQ-SOURCE-001`, `REQ-SOURCE-004`
- **통과 기준**:
  - 핵심 소스 1개 이상에 대해 계약서, 승인 이메일 또는 공식 API 접근 증빙 존재
  - 가격 저장 및 표시 권한 확인
  - 딥링크 사용 권한 확인
  - 호출 한도 확인
- **실패 기준**:
  - 권한을 추정만 한 경우
  - 승인되지 않은 내부 API를 사용하는 경우
  - 저장 또는 표시 권한이 불명확한 경우

## VER-SOURCE-002 Compliance Matrix

- **우선순위**: P0
- **대상 요구사항**: `REQ-SOURCE-003`
- **통과 기준**:
  - 활성화된 모든 소스에 Matrix가 존재
  - 계약 상태와 만료일 기록
  - 호출 한도와 데이터 TTL 기록
  - 표시 의무와 딥링크 조건 기록
  - 소스 비활성화 절차 존재

## VER-SOURCE-003 소스 Manifest

- **우선순위**: P0
- **대상 요구사항**: `REQ-SOURCE-005`
- **통과 기준**:
  - Manifest Schema 검증 성공
  - 모든 활성 소스의 `secret_ref`가 유효
  - Manifest에 실제 Secret이 포함되지 않음
  - 비활성 소스는 실행 대상에서 제외됨

---

# 18. Collector 검증

## VER-COL-001 Connector Contract Test

- **우선순위**: P0
- **대상 요구사항**: `REQ-COL-002`
- **통과 기준**:
  - 모든 활성 Connector가 공통 Contract Test 통과
  - 샘플 응답 20건 이상 정규화 성공
  - 필수 필드 누락률이 허용 기준 이하
  - Connector 예외가 공통 오류 형식으로 변환됨

## VER-COL-002 Retry 및 Rate Limit

- **우선순위**: P1
- **대상 요구사항**: `REQ-COL-003`
- **통과 기준**:
  - `429`, `500`, timeout에 대한 재시도 테스트 통과
  - `Retry-After`가 있으면 준수
  - 영구 인증 오류에 무한 재시도하지 않음
  - 최대 재시도 이후 명확한 실패 상태 기록

## VER-COL-003 소스 장애 격리

- **우선순위**: P0
- **대상 요구사항**: `REQ-COL-004`
- **통과 기준**:
  - 소스 하나가 실패해도 다른 소스 Job이 정상 종료
  - Circuit Breaker 활성화 상태가 기록됨
  - 운영 알림 발생
  - 운영자가 Feature Flag로 소스를 비활성화할 수 있음

## VER-COL-004 실행 통계

- **우선순위**: P1
- **대상 요구사항**: `REQ-COL-006`
- **통과 기준**:
  - Job 종료 시 요청, 파싱, 오퍼, 오류 통계 출력
  - 모든 로그에서 `job_id`, `run_id`, `batch_id`, `source_id` 추적 가능
  - Secret이 로그에 노출되지 않음

---

# 19. 데이터 계약 검증

## VER-DATA-001 Batch Schema

- **우선순위**: P0
- **대상 요구사항**: `REQ-DATA-001`
- **통과 기준**:
  - 정상 Batch Schema 검증 성공
  - 필수 필드가 없는 Batch 거부
  - 지원하지 않는 `schema_version` 거부
  - 잘못된 checksum 거부

## VER-DATA-002 멱등성

- **우선순위**: P0
- **대상 요구사항**: `REQ-DATA-002`
- **통과 기준**:
  - 동일 Batch를 3회 처리해도 오퍼 중복이 발생하지 않음
  - 동일 `batch_id`와 다른 checksum은 충돌로 거부
  - 재처리 결과가 Audit Log에 기록됨

## VER-DATA-003 가격 정확성

- **우선순위**: P0
- **대상 요구사항**: `REQ-DATA-005`
- **통과 기준**:
  - 원 통화 가격과 원본 응답의 가격 일치
  - 이코노미와 비즈니스가 분리됨
  - 편도와 왕복이 잘못 혼합되지 않음
  - 세금 및 수수료 포함 여부가 저장됨
  - 가격 기준 시각이 저장됨

## VER-DATA-004 날짜와 Timezone

- **우선순위**: P0
- **대상 요구사항**: `REQ-DATA-004`
- **통과 기준**:
  - UTC 저장 확인
  - 현지시간 변환 확인
  - 익일 및 날짜 변경선 사례 테스트 통과
  - 출발일과 귀국일 계산 오류 없음

## VER-DATA-005 데이터 품질

- **우선순위**: P0
- **통과 기준**:
  - 출발 및 도착 공항 코드가 유효
  - 출발시각이 도착시각보다 논리적으로 앞섬
  - 귀국 여정이 출국 여정보다 뒤에 존재
  - 가격이 0보다 큼
  - 통화 코드가 유효
  - `observed_at`이 현재보다 비정상적으로 미래가 아님
  - 딥링크가 요구조건을 충족

---

# 20. FX 검증

## VER-FX-001 환율 계산

- **우선순위**: P0
- **대상 요구사항**: `REQ-FX-001`, `REQ-FX-003`
- **통과 기준**:
  - 원 통화, 환율 및 KRW 계산 결과 재현 가능
  - 허용된 반올림 규칙 적용
  - 환율 기준일과 공급자 저장
  - 동일 입력에 대해 일관된 결과 생성

## VER-FX-002 FX 장애

- **우선순위**: P1
- **대상 요구사항**: `REQ-FX-002`
- **통과 기준**:
  - Primary Provider 장애 시 fallback 동작
  - 72시간 이내 마지막 정상 환율 사용
  - 72시간 초과 시 새 KRW 가격 publish 차단
  - 운영 알림 발생

---

# 21. Ingest 및 DB 검증

## VER-ING-001 Single Writer

- **우선순위**: P0
- **대상 요구사항**: `REQ-ING-001`, `REQ-DB-002`
- **통과 기준**:
  - BFF DB 계정으로 `INSERT`, `UPDATE`, `DELETE`, `DDL` 실행 실패
  - Ingest 계정은 허용된 테이블만 수정 가능
  - Migration 계정만 DDL 실행 가능
  - Collector에 직접 DB 쓰기 권한이 없음

## VER-ING-002 원자적 Publish

- **우선순위**: P0
- **대상 요구사항**: `REQ-ING-002`, `REQ-ING-003`
- **통과 기준**:
  - Publish 도중 강제 실패 시 부분 데이터가 노출되지 않음
  - 이전 정상 Read Model 유지
  - 실패 Batch 상태가 `FAILED` 또는 `REJECTED`로 기록
  - 재처리 가능

## VER-ING-003 재처리

- **우선순위**: P0
- **대상 요구사항**: `REQ-ING-004`
- **통과 기준**:
  - 실패 Batch 재처리 성공
  - 중복 생성 없음
  - 원 실행과 재처리 실행을 Audit에서 구분 가능
  - 운영자가 Runbook만으로 재처리 수행 가능

## VER-DB-001 Backup 및 Restore

- **우선순위**: P0
- **대상 요구사항**: `REQ-DB-001`
- **통과 기준**:
  - 자동 백업 활성화
  - PITR 설정 확인
  - Staging 환경에서 복구 훈련 성공
  - 복구시간과 데이터 손실 범위 기록
  - 복구 Runbook 승인

## VER-DB-002 Migration

- **우선순위**: P0
- **통과 기준**:
  - 빈 DB에 전체 Migration 성공
  - 현재 운영 Schema에서 Upgrade 성공
  - 지원되는 Rollback 또는 Forward Fix 절차 존재
  - 비가역 Migration에 별도 승인 기록

---

# 22. API 및 캐시 검증

## VER-API-001 필수 Endpoint

- **우선순위**: P0
- **대상 요구사항**: `REQ-API-001`
- **통과 기준**:
  - 필수 Endpoint가 정상 응답
  - 입력값 검증 동작
  - 오류 응답이 표준 형식 사용
  - `request_id`로 로그 추적 가능

## VER-API-002 Mock 차단

- **우선순위**: P0
- **대상 요구사항**: `REQ-API-004`
- **통과 기준**:
  - `SERVICE_REQUIRE_POSTGRES=true` 상태에서 DB 연결 차단
  - Mock 데이터가 반환되지 않음
  - API가 `503` 또는 정의된 장애 응답 반환
  - 운영 알림 발생

## VER-API-003 Map API

- **우선순위**: P0
- **대상 요구사항**: `REQ-API-002`
- **통과 기준**:
  - 출발 공항 필터 정상
  - 좌석 등급 필터 정상
  - 날짜 및 체류기간 필터 정상
  - `bbox`와 `zoom` 조건 정상
  - 각 항목에 `batch_id` 및 `freshness_at` 제공

## VER-CACHE-001 캐시 무효화

- **우선순위**: P0
- **대상 요구사항**: `REQ-API-005`
- **통과 기준**:
  - Batch Publish 후 Revalidation 호출 성공
  - Revalidation 전후 `batch_id` 변경 확인
  - 동일 Revalidation 요청 반복 시 오류 없음
  - 인증 실패 요청 거부
  - Revalidation 실패 시 재시도 및 알림 동작

---

# 23. 지도 및 UI 검증

## VER-MAP-001 지도 렌더링

- **우선순위**: P0
- **대상 요구사항**: `REQ-MAP-001`, `REQ-MAP-003`
- **통과 기준**:
  - 지도 정상 로딩
  - 출발 공항 및 목적지 표시
  - 목적지별 가격 표시
  - 다크 및 라이트 테마 정상
  - 모바일 및 데스크톱 레이아웃 정상

## VER-MAP-002 Cluster

- **우선순위**: P1
- **대상 요구사항**: `REQ-MAP-004`
- **통과 기준**:
  - 줌 레벨에 따라 Cluster가 분리 및 병합
  - Cluster 내부 최저가 정확
  - Cluster 클릭 시 하위 Zoom 또는 목록 이동
  - 목적지 수와 대표 가격이 일관됨

## VER-MAP-003 Popup 및 상세 이동

- **우선순위**: P0
- **대상 요구사항**: `REQ-MAP-005`
- **통과 기준**:
  - 핀 또는 가격 클릭 시 Popup 표시
  - 날짜, 가격, 좌석 등급 및 기준 시각 표시
  - 상세 오퍼 화면 이동 성공
  - 선택 목적지 항로 표시

## VER-MAP-004 Fallback

- **우선순위**: P0
- **대상 요구사항**: `REQ-MAP-006`
- **통과 기준**:
  - WebGL 비활성 상태에서 목록 View 제공
  - 타일 요청 실패 시 전체 페이지가 Crash하지 않음
  - 목적지와 가격 탐색 가능
  - 오류 및 재시도 안내 표시

## VER-UI-001 가격 고지

- **우선순위**: P0
- **대상 요구사항**: `REQ-UI-001`
- **통과 기준**:
  - 성인 수와 왕복 여부 표시
  - 세금 및 수수료 포함 여부 표시
  - 가격 기준 시각 표시
  - 최종 가격은 예약처 확인 대상이라는 안내 표시
  - 좌석 등급 표시

## VER-UI-002 접근성

- **우선순위**: P1
- **대상 요구사항**: `REQ-UI-002`
- **통과 기준**:
  - 키보드만으로 주요 탐색 가능
  - Focus 표시
  - 지도 대체 목록 제공
  - 주요 버튼에 접근 가능한 이름 존재
  - 자동 접근성 검사에서 Critical 오류 0건

---

# 24. 딥링크 검증

## VER-LINK-001 딥링크 표본

- **우선순위**: P0
- **대상 요구사항**: `REQ-LINK-001`, `REQ-LINK-002`
- **표본 기준**:
  - 소스별 최소 20건
  - 또는 최근 활성 오퍼의 1% 중 더 큰 값
- **통과 기준**:
  - HTTPS 비율 100%
  - 허용 Domain 비율 100%
  - 추적 파라미터 충족률 100%
  - 최종 Landing 성공률 95% 이상
  - 여정 조건 일치율 95% 이상
  - 악성 또는 비인가 Redirect 0건

## VER-LINK-002 실패 링크 노출 차단

- **우선순위**: P0
- **대상 요구사항**: `REQ-LINK-003`
- **통과 기준**:
  - 검증 실패 링크에 활성 예약 버튼이 표시되지 않음
  - 실패 원인이 기록됨
  - 소스별 실패율이 Dashboard에 표시됨

---

# 25. 보안 검증

## VER-SEC-001 Secret Scan

- **우선순위**: P0
- **대상 요구사항**: `REQ-SEC-001`, `REQ-SEC-002`
- **통과 기준**:
  - Git 이력과 현재 파일 Secret Scan 통과
  - Build Artifact에 Secret 없음
  - 로그에 Secret 없음
  - 예제 Key 또는 기본 Secret이 Production에서 사용되지 않음

## VER-SEC-002 권한

- **우선순위**: P0
- **대상 요구사항**: `REQ-SEC-005`, `REQ-DB-002`
- **통과 기준**:
  - 최소 권한 원칙 확인
  - 외부 업체의 Production 접근 목록 승인
  - 불필요한 계정 제거
  - Preview에서 Production Secret 접근 불가

## VER-SEC-003 내부 Endpoint 인증

- **우선순위**: P0
- **대상 요구사항**: `REQ-SEC-004`
- **통과 기준**:
  - 인증정보 없는 요청 거부
  - 잘못된 Signature 거부
  - 허용시간을 초과한 요청 거부
  - 동일 요청 Replay 거부 또는 안전하게 멱등 처리
  - Rate Limit 동작

## VER-SEC-004 Dependency 검사

- **우선순위**: P1
- **통과 기준**:
  - Production Dependency 취약점 검사 수행
  - 합의된 기준 이상의 Critical 취약점 0건
  - High 취약점은 조치하거나 Risk Acceptance 문서화

---

# 26. 운영 및 안정성 검증

## VER-OPS-001 수집 성공률

- **우선순위**: P0
- **대상 요구사항**: `REQ-OPS-002`
- **관찰 기간**: 최소 7일, 권장 14일
- **통과 기준**:
  - 전체 Scheduled Job 성공률 95% 이상
  - 핵심 소스는 최근 7일 중 최소 6일 정상 Publish
  - 마지막 정상 Publish 시각이 28시간 이내
  - 수동 수정 없이 자동 실행

Job 성공은 프로세스 종료코드뿐 아니라 최소 데이터 품질 기준과 Publish 성공을 포함한다.

## VER-OPS-002 데이터 Freshness

- **우선순위**: P0
- **통과 기준**:
  - 활성 오퍼의 Freshness가 설정된 `SOURCE_MAX_STALE_HOURS` 이내
  - 기준 초과 데이터는 stale로 표시하거나 노출 제외
  - 핵심 소스 전체가 stale이면 운영 알림 발생

## VER-OPS-003 알림 Smoke Test

- **우선순위**: P0
- **통과 기준**:
  - Collector 실패 알림 수신
  - DB 장애 알림 수신
  - Stale 데이터 알림 수신
  - Revalidation 실패 알림 수신
  - 알림에 환경, 서비스, 소스 및 Run ID 포함

## VER-OPS-004 장애 복구 훈련

- **우선순위**: P0
- **통과 기준**:
  - 소스 강제 비활성화 성공
  - 실패 Batch 재처리 성공
  - 이전 정상 Read Model 유지 확인
  - DB 복구 훈련 성공
  - 배포 Rollback 성공
  - 실제 수행시간 기록

---

# 27. 성능 검증

## VER-PERF-001 API 성능

- **우선순위**: P1
- **대상 요구사항**: `REQ-NFR-001`
- **통과 기준**:
  - 캐시 적중 응답 P95 500ms 이하
  - DB 조회 응답 P95 1,500ms 이하
  - 오류율 1% 미만
  - 테스트 조건과 동시 사용자 수를 보고서에 명시

## VER-PERF-002 지도 성능

- **우선순위**: P1
- **통과 기준**:
  - 합의된 모바일 기기 및 네트워크에서 Interaction 가능 시점 5초 이하
  - 지도 이동 중 심각한 UI Freeze 없음
  - 목적지 증가 시 viewport 또는 Cluster로 데이터량 제한
  - 타일 및 GeoJSON 요청량 기록

## VER-PERF-003 비용 상한

- **우선순위**: P1
- **대상 요구사항**: `REQ-NFR-004`
- **통과 기준**:
  - 월별 예상 비용표 제출
  - 서비스별 Budget Alert 설정
  - 정상 트래픽 및 피크 트래픽 비용 추정
  - API 호출량과 Source Rate Limit이 계획 범위 이내

---

# 28. 법적 고지 및 사용자 문서 검증

## VER-LEGAL-001 필수 고지

- **우선순위**: P0
- **통과 기준**:
  - 개인정보처리방침 게시
  - 이용약관 게시
  - 고객 문의 이메일 정상 수신
  - 제휴 또는 어필리에이트 관계 고지
  - 가격 및 예약 가능 여부 면책 문구 게시
  - 데이터 출처 및 필수 Attribution 표시

## VER-LEGAL-002 사용자 데이터

- **우선순위**: P0
- **통과 기준**:
  - 저장되는 사용자 데이터 목록 문서화
  - 불필요한 개인정보를 수집하지 않음
  - Analytics/Cookie 사용 시 필요한 고지 및 동의 적용
  - 삭제 및 문의 절차 제공

---

# 29. 자동 검증 명령

프로젝트의 실제 `package.json` 및 Script 구현에 따라 아래 명령을 제공한다.

```bash
# 1. 런타임 환경변수 검증
npm run preflight:runtime-env

# 2. 서비스 및 Source Manifest 검증
npm run preflight:service-env -- \
  --manifest-path "$COLLECTOR_SOURCE_MANIFEST_PATH"

# 3. 테스트
npm run test
npm run test:contract
npm run test:integration
npm run test:e2e

# 4. 빌드
npm run build

# 5. 운영 알림 Smoke Test
npm run smoke:ops-alert -- \
  --event collector_ops_alert_smoke

# 6. 서비스 Readiness
npm run smoke:service-readiness -- \
  --manifest-path "$COLLECTOR_SOURCE_MANIFEST_PATH"

# 7. 딥링크 검증
npm run audit:deeplinks -- \
  --min-samples-per-source 20

# 8. 보안 및 Secret 검사
npm run audit:security
npm run audit:secrets

# 9. 종합 출시 감사
npm run audit:service-launch -- \
  --verify-release-gates \
  --run-collector \
  --output-dir runtime/service-launch-audits
```

DB 연결정보는 명령행 문자열에 직접 작성하지 않고 환경 Secret으로 주입한다.

---

# 30. 종합 출시 판정 기준

## VER-LAUNCH-001 P0 Gate

- **우선순위**: P0
- **통과 기준**:
  - 모든 P0 검증 통과
  - P0 미해결 결함 0건
  - 실제 데이터 소스 1개 이상 활성화
  - Mock 데이터 완전 차단
  - Backup 및 Restore 검증 완료
  - 딥링크 검증 통과
  - 수집 안정성 검증 통과
  - 법적 고지 게시
  - 운영 알림 수신 확인

## VER-LAUNCH-002 P1 Gate

- **우선순위**: P1
- **통과 기준**:
  - P1 검증 항목 통과
  - 미통과 항목은 Risk Acceptance 문서 존재
  - 담당자와 해결 기한 지정
  - 서비스 핵심 기능에 직접 영향을 주는 P1 예외 없음

## VER-LAUNCH-003 감사 결과

최종 감사 결과는 기계 판독 가능한 파일과 사람이 읽을 수 있는 보고서로 생성한다.

예시:

```json
{
  "project": "sky-planner-atlas",
  "environment": "production",
  "release_version": "1.0.0",
  "commit_sha": "COMMIT_SHA",
  "audited_at": "ISO-8601-TIMESTAMP",
  "p0": {
    "total": 0,
    "passed": 0,
    "failed": 0
  },
  "p1": {
    "total": 0,
    "passed": 0,
    "failed": 0,
    "accepted_risks": 0
  },
  "active_sources": [],
  "last_successful_publish_at": "ISO-8601-TIMESTAMP",
  "ready_to_launch": true
}
```

`ready_to_launch`는 다음 조건을 모두 만족할 때만 `true`가 된다.

```text
P0 실패 = 0
P0 미실행 = 0
실데이터 소스 수 >= 1
Mock 데이터 사용 = false
마지막 정상 Publish <= 28시간
딥링크 검증 통과 = true
Backup/Restore 검증 통과 = true
운영 알림 검증 통과 = true
법적 고지 검증 통과 = true
```

---

# 31. 단계별 완료 기준

## Phase 0 — 데이터 소스 타당성

완료 조건:

- 핵심 소스 1개 이상 승인
- Compliance Matrix 작성
- 샘플 응답 확보
- 호출량 및 비용 산정
- Batch와 Offer 계약 확정
- 대체 소스 또는 축소 MVP 계획 확정

## Phase 1 — 인프라 및 수직 슬라이스

완료 조건:

- Stage 및 Production DB 구축
- 권한별 DB 계정 분리
- 한 개 소스의 수집부터 지도 표시까지 연결
- Batch 멱등성 검증
- Mock 차단 검증
- 기본 운영 알림 연결

## Phase 2 — Collector 및 소스 확장

완료 조건:

- Connector Contract Test 통과
- 재시도 및 Circuit Breaker 검증
- FX fallback 검증
- Source별 품질 Metric 제공
- 실패 Batch 격리와 재처리 검증

## Phase 3 — 지도 및 UI

완료 조건:

- MapLibre 지도 구현
- Cluster 및 가격 표시
- 상세 오퍼 이동
- 지도 장애 fallback
- 접근성 주요 항목 검증
- 가격 및 제휴 고지 적용

## Phase 4 — 안정화

완료 조건:

- 최소 7일, 권장 14일 안정성 관찰
- 성공률 및 Freshness 기준 충족
- 부하 테스트 완료
- Backup/Restore 훈련 완료
- 장애 및 Rollback 훈련 완료
- 비용 상한 검증

## Phase 5 — 출시

완료 조건:

- P0 항목 100% 통과
- P1 예외 승인 완료
- 최종 감사 보고서 생성
- `ready_to_launch: true`
- 내부 승인자 Sign-off 완료
- 점진 출시 및 모니터링 계획 승인

---

# 32. 납품 및 승인

## 32.1 납품 절차

1. Pull Request 제출
2. 자동 검증 실행
3. 코드 및 보안 검토
4. Staging 배포
5. 인수 테스트
6. 운영 문서 검토
7. Production 배포 승인
8. 점진적 출시
9. 출시 후 모니터링
10. 최종 Sign-off

## 32.2 납품 제외 조건

다음 상태에서는 완료로 인정하지 않는다.

- 테스트 없이 기능만 구현된 경우
- 실제 소스 대신 Mock만 연결된 경우
- Source 사용 권한이 확인되지 않은 경우
- Collector가 Production DB를 직접 수정하는 경우
- Secret이 코드 또는 로그에 포함된 경우
- 딥링크 유효성이 검증되지 않은 경우
- Backup은 있으나 Restore가 검증되지 않은 경우
- 운영자가 장애 대응 또는 재처리를 수행할 수 없는 경우
- `ready_to_launch: false`인 경우

## 32.3 최종 승인

| 역할 | 이름 | 승인일 | 상태 |
|---|---|---|---|
| Product Owner |  |  | Pending |
| Technical Lead |  |  | Pending |
| Operations Owner |  |  | Pending |
| Security Reviewer |  |  | Pending |
| Business/Compliance Owner |  |  | Pending |

---

# Appendix A. 요구사항 추적표

| 요구사항 영역 | 요구사항 ID | 주요 검증 ID |
|---|---|---|
| 데이터 소스 | `REQ-SOURCE-*` | `VER-SOURCE-*` |
| Collector | `REQ-COL-*` | `VER-COL-*` |
| 데이터 계약 | `REQ-DATA-*` | `VER-DATA-*` |
| FX | `REQ-FX-*` | `VER-FX-*` |
| Ingest | `REQ-ING-*` | `VER-ING-*` |
| Database | `REQ-DB-*` | `VER-DB-*` |
| API | `REQ-API-*` | `VER-API-*`, `VER-CACHE-*` |
| 지도 | `REQ-MAP-*` | `VER-MAP-*` |
| UI | `REQ-UI-*` | `VER-UI-*` |
| 딥링크 | `REQ-LINK-*` | `VER-LINK-*` |
| 인프라 | `REQ-INFRA-*` | `VER-OPS-*`, `VER-PERF-*` |
| 보안 | `REQ-SEC-*` | `VER-SEC-*` |
| 운영 | `REQ-OPS-*` | `VER-OPS-*` |
| 비기능 | `REQ-NFR-*` | `VER-PERF-*` |
| 출시 | 전체 | `VER-LAUNCH-*` |

---

# Appendix B. 참고 문서

- Skyscanner Travel API  
  https://www.partners.skyscanner.net/product/travel-api
- Skyscanner API Usage Guidelines  
  https://developers.skyscanner.net/docs/getting-started/usage-guidelines
- Playwright Network Documentation  
  https://playwright.dev/python/docs/network
- Next.js Incremental Static Regeneration  
  https://nextjs.org/docs/app/guides/incremental-static-regeneration
- MapLibre GL JS Cluster Example  
  https://www.maplibre.org/maplibre-gl-js/docs/examples/create-and-style-clusters/
- GitHub Actions Limits  
  https://docs.github.com/en/actions/reference/limits
- Vercel Fair Use Guidelines  
  https://vercel.com/docs/limits/fair-use-guidelines
