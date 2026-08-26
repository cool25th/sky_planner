# METRICS — 측정 기준선과 최근 결과

날짜별 행(append-only). 매일 마지막에 한 행 추가, 이전 행은 수정하지 않는다.

| 날짜 | npm test | python | build | readiness | source-health | stopgap(02:xx KST) | collect-fares(03:5x) | 비고 |
|---|---|---|---|---|---|---|---|---|
| 2026-08-18 | 241→242 pass | 4/5 pass | OK | 16/45 | ready(13h 경과) | 수동 검증 | 결제로 잡 미시작 | 첫 실행. 포맷터 가드 추가 |
| 2026-08-19 | 242 pass | 4/5 pass | OK | 13→16/45 | not_ready(32h)→ready | 가동(run 32191632315) | 실행됨·audit 실패 | 스톱갑 가동, 계정 분리 1단계 |
| 2026-08-20 | 242 pass | 4/5 pass | OK | 16→18/45 | ready | 자동 성공(첫) | skip 가드 첫 스케줄 7s | env 1차(스위치·토큰) |
| 2026-08-21 | 242 pass | 4/5 pass | OK | 18→**37/45** | ready | 자동 성공(3일째) | skip-성공 2일째 | INT-20260821-001(번들 포함 +19) |
| 2026-08-22 | 242→**250 pass** | 4/5 pass | OK | 37/45 | ready | 자동 성공(4일째) | skip-성공 3일째 | TEST 3종(+8), SUPPORT_EMAIL 주입·배포 한도 대기 |
| 2026-08-23 | 250 pass | 4/5 pass | OK | 37/45 | ready(1.7h 전) | 자동 성공(5일째) | skip-성공 5s | 이메일 반영 배포 대기, 관측성 렌즈 |

## 추적 지표

- service-readiness 통과 수 (목표: 45/45; 잔여 8 = partner 키 4·웹훅 2·이메일 반영 1·SERVICE_REQUIRE_POSTGRES 1)
- stopgap 연속 자동 성공 일수 (현재 5일)
- 배치 경과 시간 (SOURCE_MAX_STALE_HOURS=24 이내 유지)
- 계약 테스트 수 변화와 실패
| 2026-08-24 | 248 pass | 4/5 pass | OK | 37→**39/45** | ready | 자동 성공(6일째) | skip-성공 9s | 병행 리팩터링 5커밋·이메일 반영, 성능 렌즈: 콜드스타트 5~6s 발견, 자율 구현 skip(가드) |
| 2026-08-25 | 248 pass | 4/5 pass | OK | 39/45 | ready | 자동 성공(7일째) | skip-성공 8s(5일째) | 정체일·커밋 0, 접근성 렌즈: skip-link 갭 1건, 자율 구현 skip(가드 2일째) |
| 2026-08-26 | 248 pass | 4/5 pass | OK | 39/45 | ready | 자동 성공(8일째) | skip-성공 6s(6일째) | SEO 렌즈: 사이트맵 17URL 무효 호스트 발견(SEO-001/002), 자율 구현 skip(가드 3일째) |
