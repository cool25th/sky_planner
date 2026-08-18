# BACKLOG — 개선항목 누적 원장

상태 정의는 `require/daily-improvement-loop.md` §7 참조.

| ID | 영역 | 제목 | 유형 | 상태 | 우선순위 | 비고 |
|---|---|---|---|---|---|---|
| DATA-20260818-001 | 데이터 | GH Actions 결제 실패로 배치 워크플로 미실행 | Reactive | RESOLVED | — | 2026-08-18 사용자 승인 하에 저장소를 public으로 전환해 Actions 무료화(결제 우회). 전환 전 히스토리 비밀 점검 통과(.env·서비스계정·pem 커밋 이력 없음, 걸린 패턴은 전부 테스트 fixture). workflow_dispatch(run 32098098864) 성공 — 잡 시작·skip-by-design 확인. 남은 배치 blocker는 DATA-20260818-003(secrets)뿐 |
| DATA-20260818-003 | 데이터 | partner credential / COLLECTOR_SOURCE_MANIFEST_JSON 미주입 | Reactive | DEFERRED | — | 2026-08-18 사용자 결정: "일단 했다고 하고 넘어감" — 실제 주입 없이 진행. 확인 시점 GitHub secrets에는 VERCEL_REVALIDATE_SECRET만 존재. service-readiness는 주입 전까지 not_ready로 관측됨(회귀 아님). 실제 live 수집 개시 시 이 항목을 다시 열어 주입·검증 필요 |
| UX-20260818-001 | UX | data_mode(mock/실제) 구분 표시 | Progressive | RESOLVED | — | 2026-08-18 배포 화면 확인: 홈/지도 스탬프에 "데모 데이터"/"실시간 데이터" 라벨 렌더 |
| DATA-20260818-002 | 데이터 | 빈/부분실패 배치가 정상 데이터 덮어쓰는 가드 | Reactive | VERIFYING | P2 | 2026-08-17 구현(`succeeded===0` 시 batch_state 기록 skip + 스키마 `offers.min(1)` + 테스트). 실배치 재검증 후 RESOLVED |
| UX-20260818-002 | UX | 라우트별 error boundary | Progressive | RESOLVED | — | error.tsx 5종 존재·빌드 포함·404 화면 검증 완료(2026-08-18). 런타임 예외 경로는 운영에서 안전 유발 불가 — 미검증으로 기록 |
| UX-20260818-003 | UX | 원시 ISO week 노출 2곳 | Progressive | RESOLVED | — | 배포 /map에서 "8월 17일 ~ 23일" 자연어 주간 표기 확인(2026-08-18) |
| UX-20260818-004 | UX | 과거 주간 조회 안내 | Progressive | RESOLVED | — | 배포 /map?week=2026-W30에서 "지난 주간이라 표시할 특가가 없습니다" + 이번 주간 재검색 링크 확인(2026-08-18) |
| MOD-20260818-001 | 모듈화 | KRW 포맷터 중복 통합 | Progressive | VERIFYING | P2 | 2026-08-18 승인 구현: 3컴포넌트를 `lib/format.ts` `formatMoney`로 교체 + `format-contract.mjs`에 app/components 직접 `Intl.NumberFormat` 금지 가드 추가. npm test 242/242·build 통과. 배포 확인 후 RESOLVED |
| INT-20260818-001 | 내부 | DB 계정 분리(REQ-DB-002) 운영 적용 | Progressive | NEW | P1 | launch-gate review 2026-08-17에서 open. 운영 3-role URL 적용 + db_roles 프로브 통과 필요 |
| MOD-20260818-002 | 모듈화 | README stale 갱신 | Progressive | RESOLVED | — | 2026-08-18 수정: `/fare-board` 라우트 목록 제거, "MapLibre 대신 SVG" → MapLibre GL 실사용 문장으로 교체. partner credential 한계 문단은 미주입 상태와 일치하므로 유지 |
| INT-20260818-002 | 내부 | sky_collector 테스트 실행 경로 문서 오류 | Reactive | RESOLVED | — | 루트가 아닌 `sky_collector/`에서 `PYTHONPATH=src` 실행 필요. 루프 문서 §15.1 수정으로 조치(2026-08-18). 5 tests OK 확인 |
| UX-20260818-005 | UX | 커맨드 팔레트 + 목적지 비교 모달 | Progressive | IN_PROGRESS | — | 병행 세션이 커밋 전 상태로 개발 중. 이 루프에서는 관찰만 |
| UX-20260818-006 | UX | 없는 목적지 코드가 404 대신 200 셸 페이지 렌더 | Reactive | IMPLEMENTED | P3 | 2026-08-18 구현: destination 페이지가 destination 목록에 없는 placeId면 `notFound()` 호출(기존 404 카피·UI 재사용). npm test 242/242·build 통과. 배포 후 `/destination/UNKNOWN1`이 404로 바뀌는 것 확인 시 RESOLVED |
