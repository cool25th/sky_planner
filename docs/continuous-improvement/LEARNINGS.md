# LEARNINGS — 검증 결과와 학습

## 2026-08-19 (자동 ANALYZE_ONLY)

### 오늘 확인된 사실

- 배포 데이터가 24시간 한도를 넘으면서 source-health가 ready→not_ready로 전환한다(활성 3소스 전부 `stale`, eligible 0/2). 회귀가 아니라 DATA-003 DEFERRED의 예측된 결과.
- **사이트는 끊기지 않는다**: 홈/맵/오퍼 모두 200, "데모 데이터" 라벨 폴백. UX-20260818-001(data_mode 표시)이 실전에서 정확히 작동 — 오인 없는 데모 전환 확인.
- collect-fares가 secrets 없이도 잡 시작~`Publish Daily Firestore Batch`(quota guard)까지 실행된다. 결제 해제(public 전환)가 스케줄 실행에서도 유효. 실패는 audit/artifact 단계(env·수집 결과 없음)에서만 발생.
- **Firestore publish 성공과 source-health last_batch 갱신이 따로 논다**(→ 08-19 후속으로 판명: publish는 no-op 성공, 판정 소스는 Postgres `batch_state` — 코드로 확인. 불일치 아님).

### 후속 실행 (2026-08-19 스톱갑 작업)

- `vercel env pull`은 Sensitive 환경변수의 실제 값을 내려주지 않는다(무의미한 짧은 값이 기록됨). Sensitive 값 이전은 대시보드 확인 후 수동 주입이 유일.
- CI의 publish/audit 스텝 중 일부는 필요 env가 없어도 exit 0으로 "성공"한다 — 스텝 성공 ≠ 실제 게시. 판정은 결과 데이터로.
- 운영 DB는 Vercel `DATABASE_URL`(Sensitive, 08-18 설정)로만 존재하며 source-health는 이 DB의 `batch_state`를 직접 쿼리한다(`app/api/ops/source-health/route.ts:64`).
- **운영 DB 제공자는 Neon(ap-southeast-1)이다** — `.env.local` URL로 확인. 당초 마스터 프롬프트의 Neon 가정은 제공자 레벨에서 맞았다.
- `.env.local`의 값은 큰따옴표로 감싸져 있다 — 시크릿 주입 시 반드시 따옴표를 벗긴다(포함 시 pg 파서가 호스트를 `base`로 오인해 `EAI_AGAIN base` 실패).
- GitHub Actions `if:` 조건식에는 `secrets` 컨텍스트를 쓸 수 없다 — job `env`로 옮겨 `env.X`로 판정한다(기존 READY 패턴 재사용).

### 기존 가설의 검증 결과

- "source-health ready ≠ live 데이터"(08-18 학습)에 반대 사례 확인: not_ready는 실제 스테일과 정확히 일치. 방향성은 맞고, 이제 판정 소스 단일화가 과제.

### 다음 루프에서 확인할 사항

- collect-fares 내일 실행(오늘과 동일 패턴인지 — publish 성공/audit 실패)
- DATA-003 재개 또는 스톱갑 결정 여부(사용자)
- INT-20260819-001 조사 진행 여부

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

## 2026-08-20 (자동 ANALYZE_ONLY)

### 오늘 확인된 사실

- stopgap(ingest 역할)+계정 분리 조합이 첫 야간 자동 사이클에서 무중단 동작: 02:22 KST seed 성공(1m18s) → source-health ready → 사이트 "실시간 데이터". 배치 파이프라인의 최소 가동 상태 확립.
- service-readiness 13/45 → 16/45: 스테일 연쇄(fresh_successful_batch, eligible_sources_minimum, source_health_ready) 해소. 회복은 데이터 신선도에서 온 것.
- **잔여 실패 29개 분류**: partner 키 직접 의존 4개, 운영 env 부재(SUPPORT_EMAIL·OPS_READINESS_TOKEN·OPS_ALERT_WEBHOOK_URL·SOURCE_*_ENABLED)가 원인인 것이 대부분. "not_ready"를 뭉뚱그리면 우선순위를 잘못 잡는다.
- collect-fares는 매일 1분 실패를 반복 — DEFERRED 기간의 알림 노이즈. skip 게이트(daily-batch 패턴) 부재.

### 다음 루프에서 확인할 사항

- stopgap 내일 스케줄 실행(2일 연속 안정성)
- 운영 env 패키지 주입 여부(사용자) 및 주입 시 readiness 상승 폭
- DATA-20260818-003 재개 검토 여부

## 2026-08-21 (자동 ANALYZE_ONLY)

### 오늘 확인된 사실

- `*_available` 시리즈 17개의 실패 원인: `lib/readiness-artifacts.ts`의 `artifactContains()`가 런타임 `readFile(process.cwd()/path)`로 소스 파일을 읽지만 Vercel 번들은 nft 트레이싱 대상(import 모듈)만 포함 — 정적 파일 체크는 배포에서 구조적으로 통과 불가. "체크 실패"가 아니라 "평가 환경 불일치"였다.
- stopgap 3일 연속 자동 성공, collect-fares skip 가드 스케줄 검증 완료(7s) — 배치 하루 주기가 완전히 안정화됨.

### 다음 루프에서 확인할 사항

- INT-20260821-001(번들 포함) 승인·적용 여부와 적용 시 readiness 상승 폭
- 사용자 env 값(SUPPORT_EMAIL·OPS_ALERT_WEBHOOK_URL) 주입 여부

### 승인 실행 (2026-08-21 INT-20260821-001)

- 런타임 fs 체크를 배포에서 살리는 최소 수단은 `outputFileTracingIncludes` — 파일 목록은 체크 코드(`readiness-artifacts.ts`, `service-readiness-runtime.ts`)의 `artifactContains` 호출과 1:1 유지(새 체크 추가 시 next.config도 갱신 필요, 주석으로 상호 참조).
- glob에서 `[placeId]`처럼 대괄호 디렉터리는 문자클래스로 해석된다 — `**`로 회피.
- 결과: readiness 18→37/45. "정적 체크 실패"의 상당수는 평가 환경 문제였음을 재확인.
