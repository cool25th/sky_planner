# LEARNINGS — 검증 결과와 학습

## 2026-08-18 (첫 실행)

### 오늘 확인된 사실

- 로컬 검증 전 녹색: `npm test` 241/241, backend unittest 4/4, sky_collector 5/5(올바른 경로), `npm run build` 성공. First Load JS shared 102 kB.
- 배포 사이트(200)의 `/api/ops/source-health`는 **ready**: 최신 배치 2026-08-17T11:21:30Z 성공, 활성 3소스(skyscanner 56,448 / korean_air 17,640 / asiana 13,608 offers), stale 아님(경과 ~13h).
- 같은 사이트의 `/api/ops/service-readiness`는 **not_ready**: 45 check 중 29 실패(live_collector_success, source_credentials_present, mock_fallback_disabled, 정책/게이트 문서 check 등). HTTP 503으로 응답.
- GitHub Actions `Collect fares`(03:17 KST), `Daily fare batch`(02:00 KST) 모두 **잡 시작 전 실패** — 원인은 코드가 아니라 계정 결제/지출한도("Billing & plans" 조치 필요).
- CI가 못 돌았는데도 배치 데이터가 fresh함 → 해당 배치는 CI 외 경로(로컬/수동 publish, mock parser로 추정)에서 게시됨.

### 기존 가설의 검증 결과

- "sky_collector 테스트는 PYTHONPATH=src면 충분" → **아님**. 실행 디렉터리가 `sky_collector/`여야 함(ADR-003). 루트 실행 시 `sky_collector.parsers.mapping_adapter` ModuleNotFoundError.
- "원시 ISO week가 UI에 2곳 노출" → 정적 검증에서는 미발견(`formatWeekNatural` 사용, raw `W${` 없음). 화면 확인 후 종결 예정.
- 시드 "partner credential 미주입" → service-readiness 실패 check로 **여전히 유효** 확인.

### 더 이상 유효하지 않은 가정

- "source-health가 ready면 데이터가 live다" → 아님. source-health는 배치 최신성만 보고, service-readiness는 parser_version≠local-mock live 증거를 요구. 두 엔드포인트의 ready 기준이 다르므로 판단은 service-readiness 기준으로.

### 다음 루프에서 확인할 사항

- GH Actions 결제 조치 여부(잡이 시작되는가) — DATA-20260818-001
- f1acbb7 기능들(error boundary, 과거 주간 안내) 배포 화면 확인 — UX-20260818-002/004
- data_mode 라벨링 실화면 확인 — UX-20260818-001
- 병행 세션의 커맨드 팔레트/비교 모달 커밋 여부와 포맷터 중복 확대 여부 — MOD-20260818-001

### 당일 오후 자체 교정 (프로세스 학습)

- 첫 판정에서 data_mode 표시·빈 배치 가드를 "미구현/미확인"으로 분류했으나, 세션 메모리 확인 결과 **둘 다 2026-08-17에 구현 완료**였음(백로그·보고서는 VERIFYING으로 교정함).
- 교훈: 병행 세션의 완료 사실은 `docs/`가 아니라 ZCode 세션 메모리에 먼저 남는다. LOAD 단계에서는 (1) 백로그, (2) 최근 커밋 메시지, (3) 코드 실측을 함께 봐야 하며, "구현 흔적을 못 찾았다"와 "없다"를 구분해 기록해야 한다. 오늘의 ISO week 검증(코드 실측으로 종료)이 올바른 예.

### 승인 실행 (2026-08-18 오후)

- 배포 검증은 SSR HTML `curl + grep`으로 충분했다: data_mode 라벨, 자연어 주간, 과거 주간 안내가 전부 정적 렌더 텍스트로 확인됨. 브라우저 없이 검증 가능한 항목이 많다.
- 포맷터 재중복은 계약 테스트 가드(정적 스캔)로 봉쇄 — "통합했다"로 끝내지 않고 재발을 못하게 하는 것이 두 번째 방어선.
- GH Actions 결제 문제는 API(404)·workflow_dispatch 재시도 모두로 확인: 코드 밖 병목은 조기에 BLOCKED로 분류하고 운영자 조치로 넘기는 것이 맞다.
- `/destination/<unknown>`이 200 셸 페이지를 반환 — 404 카피에는 "잘못된 목적지 코드" 안내가 있어 의도와 불일치. UX-20260818-006으로 등록.
- GitHub Actions 결제 블로커는 private 저장소 요금제에서만 발생한다. public 전환으로 즉시 해제됨(런 32098098864 성공). 공개 전에는 히스토리 비밀 스캔이 선행 조건 — 이 저장소는 통과(.env류 커밋 이력 없음, credential 패턴은 전부 가짜 fixture).

### 커밋·배포 (2026-08-18 저녁)

- **병행 세션이 같은 working tree에서 빌드하면 `.next`가 교차 오염된다.** 에디터 버퍼 저장 시점에 따라 내가 추가한 가드가 빌드에서 빠진 적 있음. 검증은 격리 포트(:3100) + `rm -rf .next` 클린 빌드 + 본문 grep으로.
- `npm run start`가 EADDRINUSE로 죽어도 `-w "%{http_code}"`는 다른 서버(:3000 점유자)의 응답을 출력한다 — 로그 파일로 서버 기동 성공을 먼저 확인해야 한다.
- Next 15 force-dynamic 스트리밍에서 `notFound()`는 본문·메타데이터를 404로 바꾸지만 HTTP 상태 코드는 이미 커밋된 200으로 남는다(soft-404). 메타데이터 오염은 generateMetadata에서 같은 가드를 호출해 제거했다. 하드 404가 필요하면 middleware(+edge-safe codes 모듈)이 업그레이드 경로.
- Vercel CLI 배포는 `--scope cools-projects-d471a9e6` 명시 필요(팀 스코프 없으면 Not authorized).
