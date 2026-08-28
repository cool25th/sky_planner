# 데이터 수집 방안 리서치 — Sky Planner Atlas

- 상태: 진행(2026-08-27 개시) · 소유: DATA-20260818-003 해결 경로 · 최종 갱신: 2026-08-27
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

(주간 자동화가 `## YYYY-MM-DD` 섹션으로 추가 — 새 사실만, 변동 없으면 "변동 없음")

## 권장 설계 (주간 자동화가 갱신)

- 아직 리서치 전 — 첫 주간 실행이 작성한다.
- DATA-20260818-003 재개 체크리스트: (1) 소스 확정 (2) API 키 발급 (3) 매니페스트 JSON 작성 (4) GitHub secrets 주입 (5) READY 자동 전환 확인 (6) 스톱갑 자동 비활성 확인
