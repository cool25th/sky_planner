# DECISIONS — 아키텍처·제품 결정 기록

- **ADR-001** (2026-08-18): 운영 beta 데이터 백엔드는 Firestore, ingest/계약 검증은 PostgreSQL. mock은 `SERVICE_REQUIRE_POSTGRES=true`로 운영 차단. (기존 구조 확정 재기록)
- **ADR-002** (2026-08-18): 일일 개선 루프는 ANALYZE_ONLY 자동 실행(04:00 KST), 구현은 사용자 승인(IMPLEMENT_APPROVED) 후에만. 보고서·상태는 `docs/continuous-improvement/`에 누적, 커밋은 사용자가 수행.
- **ADR-003** (2026-08-18): sky_collector 테스트는 `cd sky_collector && PYTHONPATH=src python3 -m unittest discover -s tests`로 실행한다. 루트 실행 시 루트 `sky_collector/` 네임스페이스 패키지가 src를 가려 전량 실패함.
- **ADR-004** (2026-08-18): 저장소를 public으로 전환해 GitHub Actions를 무료화했다(결제 문제 우회). 사용자 승인: "결제 안하고 진행". 전환 전 히스토리 비밀 점검 통과. 되돌리기(private 재전환)는 언제든 가능하나 공개 이력은 회수 불가 — 향후 비밀은 절대 커밋 금지. 대안(결제 수단 수정, 로컬 러너) 대비 유지비 0.
