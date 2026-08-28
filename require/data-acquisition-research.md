# 데이터 수집 방안 리서치 — Sky Planner Atlas

- 상태: 진행(2026-08-27 개시) · 소유: DATA-20260818-003 해결 경로 · 최종 갱신: 2026-08-28(1차 리서치)
- 이 문서는 **주간 자동화(매주 월요일 05:00 KST)**가 웹 리서치 결과를 날짜 섹션으로 누적하고 아래 "권장 설계"를 갱신하는 산출물이다.

## 배경

- 운영 beta는 스톱갑(DATA-20260819-001, ADR-005) 가동 중: daily-batch가 매일 02:00 KST deterministic mock(`db:seed`)을 재게시해 batch_state 신선도(24h)를 유지한다.
- 실데이터 수집은 partner credential/매니페스트 미주입(DATA-20260818-003 DEFERRED)으로 미가동. 이 리서치는 재개 시점의 소스·설계 결정을 지원한다.

## 프로젝트 제약 (리서치 평가 기준)

- 배포: Vercel 무료(일일 배포 한도 유의), 서버리스 함수
- 수집 파이프라인: Python `sky_collector`(src 레이아웃, pydantic) — GitHub Actions(daily-batch 02:00 KST, collect-fares 18:17 UTC), 매니페스트 기반 소스 선언(`COLLECTOR_SOURCE_MANIFEST_JSON`)
- 적재 계약: `collector.normalized_batch.v1` (offers 최소 1, zod 검증, Postgres read model)
- 운영 DB: Neon 무료(ap-southeast-1, autosuspend) — read/ingest/migration 3역할 분리
- 비용: 무료 한도 내(₩0 목표)
- 필수 요건: 한국 출발(SEL/ICN/GMP/PUS/CJU) 왕복 특가, 예약 가능한 딥링크, KRW 환산

## 리서치 질문

1. 후보별(제휴/메타서치 API, 항공사 공식 API, GDS, 공개 데이터셋 등) 가격·무료 티어, 한국 출발 커버리지, 딥링크 정책, ToS/법적 제약, 인증 방식, 데이터 갱신 주기는?
2. 무료로 실사용 가능한 조합이 존재하는가? 존재한다면 어떤 매니페스트 구성으로?
3. 기존 `sky_collector`/`normalized_batch.v1` 스키마에 그대로 매핑되는가? 안 되면 무엇을 바꿔야 하는가?

## 리서치 로그

### 2026-08-28 — 1차 조사(사용자 세션, 자동화 스케줄 전 선실행)

**후보별 현황 (전부 2026-08 기준, 출처 명시)**

| 후보 | 무료 접근성 | 한국 출발 | 딥링크(수익) | 판정 |
|---|---|---|---|---|
| **Travelpayouts/Aviasales Data API** | 제휴 네트워크 등록 후 무료(`X-Access-Token`) — 단 전용 API 툴(화이트라벨 검색)은 월 5만 방문 조건 | ICN 노선 데이터 존재(Aviasales 글로벌) | **제휴 수수료 딥링크 제공** — 스키마 `deep_link` 충족 + 수익 경로 | **1순위 후보** |
| **Amadeus for Developers** | 셀프서비스 등록, API별 월 무료 쿼터(~2,000, 200~10,000) — 프로덕션 전환 후에도 유지, 초과 시 호출당 $0.003~0.046 | GDS 글로벌 → 커버 | **소비자 딥링크 없음**(GDS 오퍼 — 예약 플로우 별도) | 2순위: 가격 검증용 세컨더리 |
| Kiwi Tequila | **2024-05부터 B2B 파트너 전용** — 셀프서비스 등록 폐쇄, 초대/파트너 신청만 | — | 제휴 경로도 월 5만 MAU 조건 | **접근 불가 — 탈락** |
| Skyscanner Travel API | 파트너 심사제(케이스 바이 케이스, 상업 이용 전제) | ✓ | 제휴 딥링크는 별도 가능 | API는 소규모 접근 불가 — 딥링크만 백업 |

- 출처: [Amadeus 포털](https://developers.amadeus.com/), [AltexSoft 무료 쿼터·프로덕션 유지](https://www.altexsoft.com/blog/amadeus-api-integration/), [Travelpayouts Data API 문서](https://travelpayouts.github.io/slate/), [API 툴 트래픽 조건](https://www.travelpayouts.com/brands/blog/api/), [Aviasales 데이터 API](https://support.travelpayouts.com/hc/en-us/articles/20384016664594), [Tequila B2B 전환](https://www.vervotech.com/hub/integrations/kiwi-com-api/), [Tequila 초대제 확인](https://phptravels.com/blog/comprehensive-guide-to-flights-api-integration), [Skyscanner 파트너 포털](https://www.partners.skyscanner.net/product/travel-api), [Kiwi 제휴 5만 MAU](https://support.travelpayouts.com/hc/en-us/articles/360019237899-Kiwi-com-affiliate-program-API)

**미확인(다음 리서치에서 확인)**
- Travelpayouts 기본 제휴 계정(트래픽 0)으로 Data API(`v1/prices/cheap` 등) 접근이 실제로 승인되는지 — 가입 후 스파이크로만 검증 가능. 5만 방문 조건이 화이트라벨 검색 툴에만 적용되는 것으로 보이나 명문화 안 됨
- Aviasales 데이터의 한국 출발 ICN/GMP/SEL/PUS/CJU 전 노선 커버리지·KRW 환산 정확도
- Amadeus Flight Offers Search의 정확 월 무료 쿼터(2026 현재가)와 초과 시 종료 조건

## 권장 설계 (2026-08-28 1차)

**1순위: Travelpayouts(Aviasales) Data API 단일 소스로 시작.**
- 근거: 유일하게 "무료 데이터 + 수수료 딥링크"를 동시에 제공 → 스키마 `deep_link`(min 1)와 수익 경로를 한 번에 충족. 나머지 무료 후보는 딥링크가 없거나(Amadeus) 접근 불가(Kiwi·Skyscanner).
- 배치 친화성: `v1/prices/cheap`는 출발지 기준으로 다수 목적지를 1호출에 반환 → 5 출발지 × 1~2호출/일로 무료 쿼터 소진 위험 거의 없음.
- 매핑: sky_collector에 `travelpayouts_data_api` 소스 추가(Python, pydantic → `collector.normalized_batch.v1`) + `PARTNER_FEED_API_KEY`=Travelpayouts 토큰 + 매니페스트 항목 1개. 소스 타입 `meta_search`.
- 주의: 제휴 딥링크는 수익 시작 = Vercel Hobby 비상업 조항과 충돌 — **리얼 데이터 검증 단계에서는 딥링크를 노출만 하고 수익 정산은 트래픽 증명 후**(무료 우선 원칙과 정렬).

**2단계(트래픽 확보 후): Amadeus 무료 쿼터를 가격 교차검증 세컨더리로 추가.**

**DATA-20260818-003 재개 체크리스트 (업데이트)**
1. Travelpayouts 제휴 가입(무료) — 사이트로 `skyplanner-kappa.vercel.app` 등록, 트래픽 조건 여부 확인
2. 토큰 발급 → `v1/prices/cheap?origin=ICN` 스파이크: 한국 출발 데이터·딥링크 형식·KRW 지원 실측 (실패 시 Amadeus 경로로 전환)
3. sky_collector 신규 소스 구현 + 매니페스트 JSON 작성
4. GitHub secrets 주입(PARTNER_FEED_API_KEY·COLLECTOR_SOURCE_MANIFEST_JSON)
5. READY 자동 전환 → 스톱갑 자동 비활성 확인
6. 배포 후 data_mode live 실측(홈 라벨 + readiness 43/45)
