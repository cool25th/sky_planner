# METRICS — 측정 기준선과 최근 결과

## 기준선 (2026-08-18)

| 지표 | 2026-08-18 | 비고 |
|---|---:|---|
| npm test (계약 테스트) | 242 pass / 0 fail | 2026-08-18 오후 포맷터 가드 추가 후(241→242) |
| backend unittest | 4 pass / 0 fail | `python3 -m unittest discover -s tests` |
| sky_collector unittest | 5 pass / 0 fail | `cd sky_collector && PYTHONPATH=src …` |
| npm run build | 성공 | First Load JS shared 102 kB |
| service-readiness | 16/45 통과, 29 실패 | not_ready, HTTP 503 |
| source-health | ready | 배치 2026-08-17T11:21:30Z, 3소스 활성, 총 offers 87,696 |
| GH Actions 배치 | 0/2 성공 | 결제 실패로 잡 미시작 |
| 백로그 P0 미해결 | 3건 | DATA-001, DATA-003, UX-001 |

## 추적 지표 (매일 갱신)

- service-readiness 통과 수 (목표: 45/45)
- GH Actions 배치 성공 여부
- 배치 경과 시간 (SOURCE_MAX_STALE_HOURS=24 이내)
- 계약 테스트 수 변화와 실패
