# METRICS — 측정 기준선과 최근 결과

## 기준선 (2026-08-18)

| 지표 | 2026-08-18 | 2026-08-19 | 비고 |
|---|---:|---:|---|
| npm test (계약 테스트) | 242 pass / 0 fail | 242 pass / 0 fail | |
| backend unittest | 4 pass / 0 fail | 4 pass / 0 fail | |
| sky_collector unittest | 5 pass / 0 fail | 5 pass / 0 fail | `cd sky_collector && PYTHONPATH=src …` |
| npm run build | 성공 | 성공 | |
| service-readiness | 16/45 통과 | **13/45 통과** | 스테일 연쇄로 악화 |
| source-health | ready (eligible 3) | **not_ready** (eligible 0, 전소스 stale) | 배치 32h 경과 |
| 배치 경과 시간 | ~13h | ~32h | 한도 24h |
| 배포 페이지 | 200 | 200 ("데모 데이터" 폴백) | |
| GH Actions 배치 | 0/2 (결제) | 1/2 실행됨(collect-fares는 audit 실패) | 결제 해제 확인 |
| 백로그 미해결 | — | DATA-003(DEFERRED), INT-001, INT-019-001, DATA-019-001, DATA-002(대기) | |

## 추적 지표 (매일 갱신)

- service-readiness 통과 수 (목표: 45/45)
- 배치 경과 시간 (SOURCE_MAX_STALE_HOURS=24 이내)
- GH Actions 배치 성공 여부
- 계약 테스트 수 변화와 실패
