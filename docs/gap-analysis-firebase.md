# PostgreSQL vs Firebase Firestore Gap Analysis & Quota Simulation

## 1. 아키텍처 및 쿼리 패러다임 비교

| 영역 | PostgreSQL (기존) | Firebase Firestore Spark Plan (전환) |
|---|---|---|
| **저장 모델** | 관계형 테이블 + SQL View (`deals_current`, `offers`) | 비정규화 문서 컬렉션 (`current_views`, `offers`) |
| **조회 방식** | 복합 필터 조건 기반 실시간 동적 SQL 집계 | **수집 시점 사전 집계(Pre-aggregated Views)** 1-Read 방식 |
| **트랜잭션/원자성**| `BEGIN ... COMMIT` (ACID) | **Immutable Batch Document 작성 후 `current_batch_id` 포인터 원자적 교체** |
| **BFF 캐싱** | DB 직접 조회 + 메모리 상태 | Next.js Vercel Data Cache + `revalidateTag` |
| **데이터 보존** | 장기 스냅샷 및 전체 원본 보존 | **Current + Previous (2개 배치)만 보관**, 오래된 배치 점진 삭제 |
| **비용 모델** | 호스팅 및 인스턴스 고정 비용 | **완전 무료 (Spark Plan Quota 내 관리)** |

---

## 2. API별 예상 Document Read/Write 수치

### 2.1 API별 Document Read 수
- `/api/deals/map`: `current_views/map__{origin}__{week}__{stay}__{cabin}` 1개 문서 조회 (**1 Read**)
- `/api/deals/calendar`: `current_views/calendar__{origin}__{dest}__{month}__{cabin}` 1개 문서 조회 (**1 Read**)
- `/api/offers`: `offers/{offer_id}` 또는 `current_views` 내 탑 3개 오퍼 (**1~3 Reads**)
- `/api/ops/service-readiness`: `service_state/production` 1개 문서 조회 (**1 Read**)

*평균 요청당 Read 수: 1.0 ~ 1.5건 (Vercel Cache Hit 시 0건)*

### 2.2 일일 1회 배치 Document Write 수
- `service_state/production`: 1 Write
- `source_state/{source_id}`: 1~3 Writes
- `batches/{batch_id}`: 1 Write
- `current_views/map__*`: 4개 출발지 × 12개 주간 × 3개 체류버킷 × 2개 캐빈 = **288 Writes**
- `current_views/calendar__*`: 4개 출발지 × 20개 핵심 목적지 × 3개 월 × 2개 캐빈 = **480 Writes**
- `offers/{offer_id}`: 핵심 오퍼 약 **500 ~ 1,500 Writes**
- **총 예상 Write 수: 약 1,300 ~ 2,300 Writes / 1회 배치** (무료 한도 20,000의 약 10%)

---

## 3. 30일 누적 예상 저장량 및 Egress

- 1회 배치당 JSON 크기: 약 1.5 ~ 2.5 MiB
- 2개 배치 보존 정책 적용 시 활성 데이터 용량: **약 5 ~ 8 MiB**
- Firestore 인덱스 및 메타데이터 오버헤드 (1.5x): **약 12 MiB**
- **Spark Plan 1.0 GiB 한도 대비 사용률: 약 1.2% (매우 안전)**

---

## 4. 인덱스 요구사항
- `current_views`: Document ID 직접 조회 (인덱스 비용 0)
- `offers`: `offer_id` 단일 키 조회 (인덱스 비용 0)
- `batches`: `published_at` 단일 인덱스 (정리용)
- *복합 쿼리를 사용하지 않으므로 추가 Custom Index 비용이 발생하지 않음.*

---

## 5. 리스크 및 대응 방안
1. **캐시 폭풍으로 인한 Read Quota 소진 위험**:
   - Next.js BFF Route Handler에서 `Cache-Control: public, s-maxage=3600` 및 태그 캐싱 적용.
2. **배치 실패로 인한 데이터 불일치 위험**:
   - Immutable Batch 작성 완료 전까지 `service_state/production` 포인터를 수정하지 않아 원자적 롤백 보장.
3. **무료 티어 초과 시 과금 발생 위험**:
   - Firebase Billing Account 미연결 상태 유지 (초과 시 과금되지 않고 자동 중단됨).
   - 수집기에 `FIRESTORE_MAX_DAILY_WRITES=12000` Quota Guard 적용.
