# BACKLOG — 개선항목 누적 원장

상태 정의는 `require/daily-improvement-loop.md` §7 참조.

| ID | 영역 | 제목 | 유형 | 상태 | 우선순위 | 비고 |
|---|---|---|---|---|---|---|
| DATA-20260818-001 | 데이터 | GH Actions 결제 실패로 배치 워크플로 미실행 | Reactive | RESOLVED | — | 2026-08-18 사용자 승인 하에 저장소를 public으로 전환해 Actions 무료화(결제 우회). 전환 전 히스토리 비밀 점검 통과(.env·서비스계정·pem 커밋 이력 없음, 걸린 패턴은 전부 테스트 fixture). workflow_dispatch(run 32098098864) 성공 — 잡 시작·skip-by-design 확인. 남은 배치 blocker는 DATA-20260818-003(secrets)뿐 |
| DATA-20260818-003 | 데이터 | partner credential / COLLECTOR_SOURCE_MANIFEST_JSON 미주입 | Reactive | DEFERRED | — | 2026-08-18 사용자 결정: "일단 했다고 하고 넘어감" — 실제 주입 없이 진행. 확인 시점 GitHub secrets에는 VERCEL_REVALIDATE_SECRET만 존재. **2026-08-19 결과 관찰(EXPANDED)**: live 배치 부재로 데이터 24h 초과 → source-health not_ready → 사이트 데모 폴백 반복. service-readiness 13/45. not_ready는 회귀 아님. live 수집 개시 시 재개 필요 |
| UX-20260818-001 | UX | data_mode(mock/실제) 구분 표시 | Progressive | RESOLVED | — | 2026-08-18 배포 화면 확인: 홈/지도 스탬프에 "데모 데이터"/"실시간 데이터" 라벨 렌더 |
| DATA-20260818-002 | 데이터 | 빈/부분실패 배치가 정상 데이터 덮어쓰는 가드 | Reactive | VERIFYING | P2 | 2026-08-17 구현(`succeeded===0` 시 batch_state 기록 skip + 스키마 `offers.min(1)` + 테스트). 실배치 재검증 후 RESOLVED |
| UX-20260818-002 | UX | 라우트별 error boundary | Progressive | RESOLVED | — | error.tsx 5종 존재·빌드 포함·404 화면 검증 완료(2026-08-18). 런타임 예외 경로는 운영에서 안전 유발 불가 — 미검증으로 기록 |
| UX-20260818-003 | UX | 원시 ISO week 노출 2곳 | Progressive | RESOLVED | — | 배포 /map에서 "8월 17일 ~ 23일" 자연어 주간 표기 확인(2026-08-18) |
| UX-20260818-004 | UX | 과거 주간 조회 안내 | Progressive | RESOLVED | — | 배포 /map?week=2026-W30에서 "지난 주간이라 표시할 특가가 없습니다" + 이번 주간 재검색 링크 확인(2026-08-18) |
| MOD-20260818-001 | 모듈화 | KRW 포맷터 중복 통합 | Progressive | RESOLVED | — | 2026-08-18 구현+배포: 3컴포넌트를 `lib/format.ts` `formatMoney`로 교체 + `format-contract.mjs` 가드(app/components 직접 `Intl.NumberFormat` 금지). npm test 242/242. 2026-08-18 배포에서 라이브 확인, 가격 표정 정상 |
| INT-20260818-001 | 내부 | DB 계정 분리(REQ-DB-002) 운영 적용 | Progressive | NEW | P1 | launch-gate review 2026-08-17에서 open. 운영 3-role URL 적용 + db_roles 프로브 통과 필요 |
| MOD-20260818-002 | 모듈화 | README stale 갱신 | Progressive | RESOLVED | — | 2026-08-18 수정: `/fare-board` 라우트 목록 제거, "MapLibre 대신 SVG" → MapLibre GL 실사용 문장으로 교체. partner credential 한계 문단은 미주입 상태와 일치하므로 유지 |
| INT-20260818-002 | 내부 | sky_collector 테스트 실행 경로 문서 오류 | Reactive | RESOLVED | — | 루트가 아닌 `sky_collector/`에서 `PYTHONPATH=src` 실행 필요. 루프 문서 §15.1 수정으로 조치(2026-08-18). 5 tests OK 확인 |
| UX-20260818-005 | UX | 커맨드 팔레트 + 목적지 비교 모달 | Progressive | RESOLVED | — | 병행 세션이 `d78454a`로 커밋·배포. 2026-08-19 루프에서 ⌘K 라이브 확인으로 종결 |
| UX-20260818-006 | UX | 없는 목적지 코드가 404 대신 200 셸 페이지 렌더 | Reactive | RESOLVED | — | 2026-08-18 배포 검증 완료: unknown placeId에 not-found UI·기본 메타데이터 렌더(커밋 `302d203`, generateMetadata+페이지 이중 가드). 한계: force-dynamic 스트리밍이라 HTTP 상태는 200(soft-404) — 코드에 ponytail 주석으로 업그레이드 경로 기록(hard 404 필요 시 edge-safe codes 모듈 + middleware) |
| INT-20260819-001 | 내부 | 신선도 판정 소스 불일치 (Firestore publish vs Postgres batch_state) | Reactive | RESOLVED | — | 2026-08-19 조사 완료: source-health는 Postgres `batch_state` 직접 쿼리(`app/api/ops/source-health/route.ts:64`)로 코드 확인. collect-fares의 "Publish Daily Firestore Batch" 성공은 env 부재 시 no-op 성공(실게시 없음)이었음 — 불일치가 아니라 무효 성공. Firestore 실게시 재개 시 소스 단일화 재검토 |
| DATA-20260819-001 | 데이터 | secrets 주입 전 beta 신선도 스톱갭 | Reactive | RESOLVED | — | 2026-08-19 가동·검증 완료: `daily-batch.yml` stopgap 스텝(READY 아닌 동안 `db:seed` 재게시, ADR-005). `DATABASE_URL` 시크릿은 `.env.local`의 Neon 운영 URL에서 **따옴표 제거해** 주입(따옴표 포함 시 파서가 호스트를 `base`로 오인해 1차 실패 — run 32191507462). 검증: run 32191632315 성공 → source-health `ready` 복귀(eligible 3, blocker 0), 사이트 "실시간 데이터" 라벨 복원. DATA-003 재개 시 자동 비활성 |
