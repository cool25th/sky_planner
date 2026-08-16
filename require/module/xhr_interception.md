# 항공 특가 지도 서비스 - XHR 가로채기 기반 수집 아키텍처 요구사항 

## 문서 정보
| 항목 | 내용 |
|------|------|
| 버전 | v4.0 |
| 기준일 | 2026-03-26 |
| 상위 문서 | [prd.md](../prd.md), [backend.md](../backend.md) |
| 연동 문서 | [collector_plan.md](./collector_plan.md), [database.md](../database.md), [source-policy.md](../source-policy.md) |
| v4.0 반영 | v3.1 대비 **Anti-Bot Bypass 4단계 전략**(Stealth/Warmup/HumanEmulation/StickySession) 요구사항 추가, DB를 Firestore → PostgreSQL 전환 반영 |
## 1. 문서 목적
이 문서는 항공사 및 메타검색 사이트 수집기를 구현할 때, 브라우저 화면 렌더링 결과를 DOM 셀렉터로 파싱하는 방식이 아니라 **XHR/Fetch 네트워크 응답을 가로채 JSON 또는 구조화된 상태 데이터로 직접 수집하는 구조**를 표준 방식으로 채택하기 위한 요구사항을 정의한다.

본 문서는 특히 다음 목표를 달성하기 위한 구현 기준을 제공한다.

- 무료 또는 저비용 CI 환경에서도 운영 가능한 수집 구조 확보
- 렌더링 대기 시간, 트래픽 사용량, 프록시 비용 최소화
- 사이트 UI 변경에 덜 취약한 수집 파이프라인 구성
- 수집 실패 원인을 운영 가능한 단위로 분류 및 추적
- 수집 결과를 `Offer`, `FareSnapshot`, `Deal` 모델로 일관되게 정규화
- GraphQL, 폴링형 검색, SSR/SSG 내장 상태 데이터까지 포함하는 현실적 수집 범위 확보

---

## 2. 기본 원칙

### 2.1 수집 방식 원칙
- 수집기는 **브라우저 UI 크롤러가 아니라 네트워크 응답 수집기**로 정의한다.
- 브라우저는 검색 조건 입력, 세션 형성, 인증/쿠키 확보, 숨겨진 API 호출 트리거를 위한 도구로만 사용한다.
- 가격, 편명, 소요 시간, 좌석 잔여 수량 등 핵심 데이터는 **DOM에서 읽지 않고 응답 본문(JSON 또는 구조화된 상태 데이터)** 에서 읽는다.
- 목표 응답 또는 상태 데이터가 확보되는 즉시 브라우저 컨텍스트를 종료한다.
- DOM 파싱은 예외 상황의 임시 fallback으로만 허용하며, 기본 구현 방식으로 채택하지 않는다.

### 2.2 운영 원칙
- 사이트별로 수집 난이도와 차단 정책이 다르므로, 수집기는 **공통 엔진 + 사이트별 어댑터** 구조로 설계한다.
- 수집 실패는 "전체 실패"로 처리하지 않고 `captcha_detected`, `endpoint_changed`, `parser_error` 등 원인별 상태로 기록한다.
- 프록시, 세션, 파서 버전, 원본 payload, 정규화 결과를 연결 저장하여 재현 가능한 운영 구조를 확보한다.
- 사이트가 기술적 차단 해제 없이는 안정적으로 접근 불가한 경우, 해당 사이트는 **제휴/API/법무 검토 트랙** 또는 **운영 승인된 별도 실행 환경**으로 전환하며, 본 수집기 요구사항은 차단 우회 자체를 목표로 하지 않는다.

### 2.3 강화 포인트
본 강화 반영본은 기존 문서 대비 아래 항목을 추가로 명시한다.

- 텔레메트리/필수 스크립트의 무조건 차단 금지 및 allowlist 정책
- GraphQL 단일 엔드포인트 대응용 `request_payload_contains` 규칙
- 비동기 폴링형 검색의 완료 조건 및 partial result 조립 정책
- XHR이 없는 SSR/SSG 사이트의 HTML 내장 JSON 추출 fallback
- LCC/공동운항/경유 품질 판별을 위한 항공 도메인 필드 확장
- GitHub Actions 한계와 외부 오브젝트 스토리지 중심 보존 정책 명시
- GraphQL 다중 쿼리 배치(Array Batch) 요청의 식별 및 응답 매핑 지원
- Pydantic 또는 동등한 런타임 스키마 검증 도구를 통한 데이터 계약 강제
- 가격 0원/비정상 고가 등 이상값 탐지와 알림 연계
- 재시도 시 이전 세션 오염을 차단하는 clean-room BrowserContext 재생성 정책

---

## 3. 범위

### 3.1 포함 범위
- 항공사 공식 웹사이트 검색 결과 수집
- 메타검색 사이트의 검색 응답 식별 및 수집
- XHR/Fetch 응답 가로채기
- GraphQL 요청/응답 식별
- 비동기 폴링형 검색 완료 판정 및 조립
- SSR/SSG HTML 내장 상태 데이터 추출
- JSON 응답 파싱 및 정규화
- 세션/쿠키 재사용
- 프록시 적용 및 요청량 제한
- GitHub Actions 기반 스케줄 실행
- 장애 감지, 재시도, 원본 payload 외부 저장

### 3.2 제외 범위
- 사람처럼 화면을 장시간 렌더링하며 DOM을 순회하는 스크래퍼
- 이미지 OCR 기반 가격 파싱
- CAPTCHA 우회 전문 솔루션 개발
- 사이트별 전용 모바일 앱 리버스 엔지니어링
- 실시간 예약 확정 엔진 구현
- 사이트의 기술적 차단을 무력화하기 위한 별도 우회 수단 자체의 연구/개발

---

## 4. 아키텍처 개요

수집 아키텍처는 아래 5개 계층으로 분리한다.

1. **Collector Orchestrator**
   - 어떤 사이트를 어떤 조건으로 언제 수집할지 결정
   - 스케줄 실행, 수동 실행, 재시도 정책 관리

2. **Browser Session Layer**
   - Playwright 기반 headless Chromium 실행
   - 세션, 쿠키, 로케일, 프록시 적용
   - 검색 조건 입력 및 네트워크 트리거

3. **Network Capture Layer**
   - XHR/Fetch/GraphQL 응답 가로채기
   - 목표 응답 식별
   - 폴링형 API의 완료 조건 추적
   - 필요 시 HTML 상태 데이터 fallback 추출

4. **Normalization & Quality Layer**
   - 사이트별 응답 스키마를 공통 모델로 변환
   - 항공 도메인 필드 보정
   - 대표가 계산에 필요한 품질 가드레일 필드 생성

5. **Storage & Audit Layer**
   - 원본 payload 외부 저장
   - 정규화 결과 저장
   - 실행 로그, 실패 코드, 파서 버전, 스키마 해시 보존

---

## 5. 구현 기술 요구사항

### 5.1 런타임
- 수집 브라우저 런타임은 **Playwright + headless Chromium**을 기본으로 한다.
- CI 실행 환경은 Linux를 기본으로 한다.
- 멀티 브라우저 호환성 검증은 필수 요건이 아니며, 기본 수집 경로는 Chromium 기준으로 최적화한다.
- Service Worker가 네트워크 가시성을 방해하는 사이트에 대비해 `service_workers='block'` 설정을 기본 제공해야 한다.
- 브라우저 컨텍스트는 작업 종료 시 명시적으로 종료되어야 하며, 실패 시에도 close 루틴이 보장되어야 한다.

### 5.2 구현 언어
- 수집기는 Python 또는 TypeScript 중 하나로 구현할 수 있으나, 사이트별 파서와 운영 자동화를 고려하여 **Python 기반 구현을 우선 권장**한다.
- 사이트별 파서는 언어와 무관하게 공통 인터페이스를 따라야 한다.

### 5.3 실행 단위
- 1회 수집 작업은 아래 단위를 기본 원자 작업으로 한다.
  - `source_site`
  - `origin`
  - `destination`
  - `depart_date`
  - `return_date`
  - `cabin_group`
  - `stay_bucket`

### 5.4 런타임 스키마 검증
- 사이트별 파서는 정규화 결과를 저장하기 전에 **런타임 스키마 검증 계층**을 반드시 통과해야 한다.
- Python 구현 시 `Pydantic` 또는 동등한 데이터 검증 라이브러리 사용을 권장하며, 구현 언어가 다르더라도 **타입/필수 필드/제약 조건 검증**을 강제해야 한다.
- 가격 필드 타입 불일치, 필수 값 누락, enum 값 불일치, 날짜 파싱 실패 등은 `parser_error` 또는 `schema_validation_failed`로 분류한다.
- 런타임 검증에 실패한 데이터는 DB 또는 캐시를 오염시키지 않도록 저장 대상에서 제외해야 한다.
- 스키마 버전, 스키마 해시, 검증 오류 요약은 실행 로그와 원본 payload 참조 정보에 함께 저장해야 한다.

---

## 6. Playwright 브라우저 세션 요구사항

### 6.1 BrowserContext 정책
- 사이트별 수집은 **BrowserContext 단위로 격리**한다.
- 한 사이트의 쿠키/로컬 스토리지/세션 상태는 다른 사이트 실행과 공유하지 않는다.
- 동일 사이트 내 후속 요청 최적화를 위해 `storage_state` 저장 및 재사용을 지원해야 한다.
- 필요한 경우 `browser_context.request` 또는 동등한 컨텍스트 결합형 HTTP 요청 계층을 사용하여 브라우저 세션 쿠키를 공유할 수 있어야 한다.

### 6.2 브라우저 실행 옵션
- 기본값은 headless 모드로 한다.
- locale, timezone, geolocation, user-agent는 한국 출발 검색 맥락에 맞는 표준값으로 고정한다.
- 이미지, 폰트, 비디오, 광고, 불필요한 서드파티 태그는 가능한 범위 내에서 차단한다.
- 단, 차단 정책으로 인해 목표 응답 생성에 실패할 수 있으므로 **site-level allowlist**를 반드시 지원해야 한다.

### 6.3 필수 스크립트 허용 정책
- 추적/분석/텔레메트리 스크립트는 기본 차단 대상이지만, 사이트별로 아래 유형의 스크립트는 allowlist 예외를 둘 수 있어야 한다.
  - 검색 API 호출 전에 실행되는 필수 초기화 스크립트
  - 세션/토큰 발급을 위한 필수 스크립트
  - 검색 결과 응답 활성화에 관여하는 필수 검증 스크립트
- allowlist는 코드 하드코딩이 아니라 Collector Registry로 관리한다.
- 특정 스크립트 차단 시 API 응답 자체가 사라지는 경우, 해당 스크립트는 `required_runtime_script`로 분류한다.

### 6.4 세션 획득 방식
- 첫 진입 시 필요한 경우 브라우저에서 직접 페이지를 열어 세션 쿠키를 획득한다.
- 세션 획득 이후에는 같은 컨텍스트 내에서 네트워크 응답을 우선 수집한다.
- 사이트가 단순 REST/GraphQL 호출로 동작하는 경우, 브라우저로 세션만 만든 뒤 후속 요청은 경량 방식으로 재사용할 수 있어야 한다.

### 6.5 Anti-Bot Bypass 전략

항공사 및 메타검색 사이트는 Akamai, Cloudflare, Incapsula 등 상용 봇 방어 솔루션을 사용하여 브라우저 지문(Fingerprint), 접속 순서, 자바스크립트 실행 여부를 종합 채점한다. 이를 통과하기 위해 아래 **4단계 전략을 필수 적용**한다.

#### 6.5.1 Stealth Plugin 적용 (필수)
- 일반 Playwright는 `navigator.webdriver = true` 등의 자동화 흔적을 노출한다.
- **Python 환경에서는 `playwright-stealth` pip 패키지 또는 `Patchright`(Playwright stealth fork)를 필수 적용**한다.
- 스텔스 적용 시 아래 흔적을 자동 제거한다:
  - `navigator.webdriver` 프로퍼티
  - `window.chrome` 미존재 패턴
  - `Runtime.enable` CDC 시그니처
  - WebGL/Canvas fingerprint 차이
- Registry에 `stealth_mode: enabled | patchright | disabled` 필드를 추가한다.
- **PoC 단계에서는 `headless=False` 모드를 기본으로 하여** 캡차 발생 여부를 눈으로 확인한다.

```python
# Python Stealth 적용 예시
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async

async with async_playwright() as p:
    browser = await p.chromium.launch(headless=False)  # PoC: 창 띄우기
    context = await browser.new_context(
        locale="ko-KR",
        timezone_id="Asia/Seoul",
        user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...",
    )
    page = await context.new_page()
    await stealth_async(page)  # ← 스텔스 적용
```

#### 6.5.2 메인 페이지 Warmup (필수)
- **검색 API URL이나 딥링크를 직접 호출하면 안 된다.** 안티봇 솔루션은 메인 페이지(`/`) 접속 시 백그라운드 JS 퍼즐을 풀어야만 보안 쿠키(예: Akamai `_abck`)를 발급한다.
- 수집 흐름은 반드시 아래 순서를 따른다:

| 단계 | 동작 | 대기 |
|---|---|---|
| 1 | 사이트 메인 페이지(`/`) 방문 | `domcontentloaded` 대기 |
| 2 | 안티봇 JS 퍼즐 풀기 대기 | 3~5초 랜덤 대기 |
| 3 | 인간 행동 모사 (마우스 이동, 스크롤) | 1~2초 |
| 4 | 검색 페이지/딥링크 이동 또는 UI 검색 실행 | XHR 캡처 시작 |

- Registry에 `warmup_url` 필드를 추가한다. 미설정 시 `search_url`의 도메인 루트(`/`)를 기본값으로 사용한다.

#### 6.5.3 인간 행동 모사 (Human Emulation)
- 안티봇은 마우스 이동, 키보드 입력, 스크롤 패턴도 채점한다.
- 최소 아래 행동을 warmup 단계에서 수행한다:
  - `page.mouse.move(x, y, steps=N)` — 2~3회, 랜덤 좌표
  - `page.mouse.wheel(0, delta_y)` — 1~2회
  - `page.waitForTimeout(random(2000, 5000))` — 랜덤 대기
- 행동 패턴은 `HumanEmulator` 유틸리티로 캡슐화하고 Registry에서 on/off 제어한다.

#### 6.5.4 리소스 차단 시 안티봇 JS 보호
- 이미지/폰트/미디어 차단은 필수이지만, **안티봇 방어벽의 JS/document/fetch/xhr는 절대 차단하면 안 된다.**
- 안티봇 JS가 차단되면 보안 쿠키가 생성되지 않아 100% 차단된다.
- `ResourceBlocker`는 아래 규칙을 **무조건 준수**해야 한다:
  - 차단 대상: `image`, `media`, `font` (리소스 타입 기준)
  - 통과 필수: `script`, `document`, `xhr`, `fetch`, `websocket`
  - `required_runtime_scripts` allowlist에 명시된 URL은 추가 보호

#### 6.5.5 Sticky Session 프록시 (프로덕션)
- 메인 페이지에서 발급받은 보안 쿠키는 **동일 IP에서만 유효**하다.
- 주거용 프록시 사용 시 요청마다 IP가 바뀌면 "세션 탈취"로 간주되어 차단된다.
- **최소 1~5분간 동일 IP가 유지되는 Sticky Session(Session ID) 모드를 필수 사용**한다.
- Registry에서 `proxy_sticky_duration_seconds: 300` 등으로 제어한다.

> **실전 검증 순서**: ① 로컬 PC(집 IP) + `headless=False` + Stealth로 먼저 뚫기 → ② 성공 확인 후 `headless=True`로 전환 → ③ 마지막에 주거용 프록시 결제 및 적용

---

## 7. 네트워크 응답 가로채기 요구사항

### 7.1 응답 식별 방식
- 사이트별 목표 응답은 다음 조합으로 식별한다.
  - URL 패턴
  - HTTP method
  - status code
  - content-type
  - request post body 또는 query string 특징
  - request payload 내 특정 키 또는 값
  - 필요 시 response body 내 완료 상태 플래그
- 응답 식별 규칙은 코드에 하드코딩하지 않고 **Collector Registry**에 선언적으로 저장한다.

### 7.2 GraphQL 대응 규칙
- 모든 GraphQL 요청이 동일한 `/graphql` 엔드포인트로 들어오는 사이트를 지원해야 한다.
- GraphQL 기반 사이트는 아래 규칙 중 하나 이상으로 목표 요청/응답을 식별할 수 있어야 한다.
  - `request_payload_contains`
  - `operation_name`
  - `variables_contains`
  - `persisted_query_hash`
- GraphQL 요청은 URL만으로 식별하지 않는다.
- GraphQL request payload는 **단일 JSON Object뿐 아니라 JSON Array(batch)** 형태도 지원해야 한다.
- request payload가 배열인 경우, 각 element를 순회하며 목표 `operation_name` 또는 동등한 식별 키를 찾아야 한다.
- GraphQL batch 요청 내에 여러 operation이 섞여 있는 경우, 응답 매핑은 최소 아래 방식 중 하나를 지원해야 한다.
  - 요청/응답 index 기반 매핑
  - operation_name 기반 매핑
  - persisted query hash 기반 매핑
- 목표 operation과 무관한 부가 쿼리(예: banner, config, experiment)는 함께 수신되더라도 수집 성공 판단의 필수 조건으로 간주하지 않는다.

### 7.3 응답 수신 정책
- 브라우저 검색 트리거 이전에 응답 훅을 등록해야 한다.
- 응답 수신은 요청 단위가 아니라 **응답 완료 기준**으로 판단한다.
- 목표 응답 수신 시점에 아래 정보를 함께 저장한다.
  - URL
  - method
  - status
  - headers
  - request payload
  - response body
  - response received_at

### 7.4 비동기 폴링형 검색 대응
- 검색 시작 요청과 결과 조회 요청이 분리된 사이트를 지원해야 한다.
- 아래 유형을 동일한 검색 세션으로 조립할 수 있어야 한다.
  - 초기 Job 생성 요청
  - partial result 폴링 응답
  - 최종 complete 응답
- 폴링형 API는 아래 규칙을 지원해야 한다.
  - `is_polling_api`
  - `polling_request_match_rules`
  - `completion_condition`
  - `max_polling_seconds`
  - `min_poll_interval_ms`
  - `partial_merge_strategy`
- partial 응답만 수신된 상태에서는 성공 완료로 간주하지 않는다.
- 응답 본문에서 `isComplete`, `status == COMPLETED`, `done == true` 등 site-specific 완료 조건을 확인한 뒤 종료한다.

### 7.5 응답 본문 처리
- JSON 응답이면 바로 JSON 파싱을 시도한다.
- JSON 파싱 실패 시 원문 텍스트를 저장하고 `parser_error`로 기록한다.
- 압축 응답, chunked 응답, GraphQL 응답 등도 파서에서 처리 가능해야 한다.
- 요청 본문 매칭이 필요한 경우 request body는 파싱 가능한 구조(JSON/form-urlencoded)로 함께 저장한다.
- GraphQL batch payload는 원본 배열 형태를 보존하되, 목표 operation 식별 결과와 매핑 로그를 함께 저장해야 한다.

### 7.6 HTML 내장 상태 데이터 Fallback
- XHR/Fetch 응답이 없거나, 첫 로드 HTML에 초기 상태가 내장된 사이트를 지원해야 한다.
- 아래 유형의 fallback을 허용한다.
  - `<script id="__NEXT_DATA__">`
  - `<script id="__NUXT_DATA__">`
  - 전역 JS 변수 기반 hydration state
  - inline script 내 JSON blob
- fallback은 아래 정보를 Registry에 선언적으로 명시해야 한다.
  - `fallback_type`
  - `selector`
  - `json_path`
  - `decode_strategy`
- HTML 상태 데이터 fallback은 **XHR 부재 또는 응답 식별 실패 시에만** 사용한다.

### 7.7 종료 정책
- 목표 응답을 확보한 후 추가 렌더링을 기다리지 않는다.
- 1개 응답만으로 충분한 사이트는 즉시 종료한다.
- 다중 응답 조합 또는 폴링 완료 판정이 필요한 사이트만 최소 대기 시간을 허용한다.

---

## 8. 리소스 절감 요구사항

### 8.1 기본 차단 대상
기본 차단 대상은 아래와 같다.

- 이미지
- 폰트
- 비디오/오디오
- 광고 네트워크
- 불필요한 서드파티 태그

> **⚠️ Critical**: `script`, `document`, `xhr`, `fetch`, `websocket` 타입은 **절대 차단하지 않는다.** 안티봇 JS 검증 스크립트가 차단되면 보안 쿠키가 발급되지 않아 모든 API 호출이 실패한다 (§6.5.4 참조).

### 8.2 조건부 차단 대상
아래 항목은 기본적으로 차단 후보지만, 사이트별로 allowlist 예외가 가능해야 한다.

- analytics/telemetry 스크립트
- feature flag 스크립트
- 실험 배정 스크립트
- client-side bootstrap 스크립트

### 8.3 차단 정책 적용 방식
- 리소스 차단은 전역 정책 + 사이트별 오버라이드 구조여야 한다.
- 차단 정책은 `blocked_resource_rule_set`과 `required_runtime_scripts` 두 축으로 동시에 관리해야 한다.
- 리소스 차단으로 인해 검색 결과 API 호출이 발생하지 않으면 해당 차단 규칙은 실패 원인으로 기록해야 한다.
- **안티봇 JS 차단으로 인한 실패는 `required_runtime_script_blocked`가 아닌 `session_bootstrap_failed`로 분류**하고, warmup 단계 재시도를 우선 수행한다.

### 8.4 성능 목표
- DOM 파싱 기반 기존 수집 대비 실행 시간과 네트워크 전송량을 유의미하게 절감해야 한다.
- 브라우저는 목표 응답 확보 이후 즉시 종료해야 하며, 검색 결과 화면 전체 렌더링 완료를 기다려서는 안 된다.

### 8.5 아티팩트 저장 정책
- trace, screenshot, HTML snapshot은 상시 저장하지 않는다.
- 실패 실행에 한해 제한적으로 저장한다.
- 저장 대상은 운영 디버깅에 필요한 최소 수준으로 제한한다.
- 라우팅이 활성화되면 캐시 동작이 달라질 수 있으므로, 성능 비교 시 캐시 비의존형 측정 기준을 사용한다.

---

## 9. 네트워크 실행 환경 및 프록시 요구사항

### 9.1 실행 환경 원칙
- 기본 CI는 GitHub Actions를 지원하되, 사이트별 접근 안정성 문제에 대비해 **self-hosted runner 또는 승인된 외부 실행 환경**으로 이관 가능한 구조여야 한다.
- 수집 엔진은 실행 환경과 무관하게 동일 Registry/Parser를 사용할 수 있어야 한다.
- 실행 환경 선택은 안정성, 비용, 법무/보안 승인 여부를 함께 고려한다.

### 9.2 프록시 운영 원칙
- 프록시는 사이트별 정책에 따라 개별 프로파일로 관리한다.
- 동일 실행 세션에서는 가능한 한 sticky session을 유지한다.
- 프록시 자격 정보는 비밀 저장소에서 주입하며, 로그에 출력하지 않는다.
- 프록시 정책은 성공률, 응답 속도, 비용 기준으로 평가되어야 하며, 운영 환경 전환이 가능해야 한다.

### 9.3 프록시 제어 파라미터
사이트별로 아래 값을 설정할 수 있어야 한다.

- 동시 실행 수
- 분당 요청 수
- 재시도 횟수
- 실패 후 쿨다운 시간
- proxy rotation 여부
- sticky session 사용 여부
- 동일 exit profile 유지 시간

### 9.4 차단 대응
- `403`, `429`, 비정상 리디렉션, 차단 페이지, 캡차 노출, 비정상 challenge 응답을 감지할 수 있어야 한다.
- 일정 실패율 이상이면 해당 사이트는 자동으로 서킷 브레이커 상태로 전환한다.
- 특정 사이트가 차단되어도 전체 수집 배치가 중단되지 않아야 한다.
- 차단이 지속되면 해당 사이트는 자동 우회 시도 대신 **제휴/API/실행 환경 재평가 대상**으로 격상한다.

---

## 10. Collector Registry 요구사항

사이트별 수집기는 아래 스키마를 가진 레지스트리로 관리한다.

```yaml
site_code: jinair
search_url: https://www.jinair.com/booking/international/{origin}-{dest}-{date}
warmup_url: https://www.jinair.com/kr/ko          # ← 메인 페이지 Warmup (§6.5.2)
trigger_type: form_submit
stealth_mode: patchright                          # ← Anti-Bot Stealth (§6.5.1)
human_emulation: true                             # ← 인간 행동 모사 (§6.5.3)
warmup_wait_seconds: [3, 5]                       # ← Warmup 랜덤 대기 범위

response_match_rules:
  - url_contains: /api/graphql
    method: POST
    status: 200
    content_type_contains: application/json
    request_payload_contains: getAvailability
    operation_name: getAvailability
    graphql_batch_mode: array_or_object

is_polling_api: true
polling_request_match_rules:
  - url_contains: /api/graphql
    method: POST
    request_payload_contains: getAvailabilityResults
completion_condition: "status == 'COMPLETED'"
max_polling_seconds: 20
min_poll_interval_ms: 800
partial_merge_strategy: replace_by_offer_key

required_headers:
  - accept-language
required_cookies:
  - JSESSIONID
  - _abck                                          # ← Akamai 보안 쿠키 (§6.5.2)

blocked_resource_rule_set: default_lcc_light
required_runtime_scripts:
  - /runtime/
  - /bootstrap/
  - /config/
never_block_types:                                 # ← §6.5.4 무조건 통과
  - script
  - document
  - xhr
  - fetch

proxy_profile: kr_primary
proxy_sticky_duration_seconds: 300                 # ← Sticky Session 5분 (§6.5.5)
parser_version: v3
schema_validator: offer_contract_v3
expected_payload_schema_hash: abcdef123456
price_anomaly_ruleset: lcc_kr_default
retry_requires_clean_room: true
clean_room_proxy_rotation: on_block_or_session_error

fallback_policy:
  - type: extract_html_json
    selector: "#__NEXT_DATA__"
    json_path: "props.pageProps.searchResult"
  - type: endpoint_changed_review
```

### 10.1 필수 필드
- `site_code`
- `search_url`
- `trigger_type`
- `response_match_rules`
- `proxy_profile`
- `parser_version`
- `fallback_policy`

### 10.2 권장 운영 필드
- 로그인 필요 여부
- 세션 bootstrap 단계 필요 여부
- service worker 차단 필요 여부
- captcha 징후 탐지 규칙
- blocked resource rule set
- required runtime scripts
- expected payload schema hash
- schema validator
- price anomaly ruleset
- graphql batch mode
- is polling api
- polling request match rules
- completion condition
- partial merge strategy
- retry requires clean room
- clean room proxy rotation

### 10.3 변경 관리
- 사이트 응답 구조가 바뀌면 `parser_version`을 올려야 한다.
- 응답 식별 규칙이 바뀌면 Registry 변경 이력을 남겨야 한다.
- 목표 응답 탐지가 실패하면 `endpoint_changed` 상태로 기록하고 운영 검토 대상으로 넘긴다.

---

## 11. 데이터 정규화 요구사항

### 11.1 공통 정규화 필드
XHR 응답 또는 상태 데이터에서 최소 아래 필드를 정규화해야 한다.

- `source_site`
- `origin_airport`
- `origin_city`
- `destination_airport`
- `destination_city`
- `depart_date`
- `return_date`
- `stay_bucket`
- `cabin_group`
- `marketing_carrier`
- `operating_carrier`
- `flight_no`
- `stops`
- `duration_minutes`
- `layover_duration_minutes`
- `price_total`
- `currency`
- `tax_included`
- `free_baggage_allowance`
- `seats_left`
- `fare_brand_raw`
- `booking_url`
- `captured_at`
- `timezone_offset`
- `local_departure_at`
- `local_arrival_at`
- `parser_version`
- `raw_payload_ref`

### 11.2 품질 가드레일 필드
지도 대표가 및 상세 품질 판별을 위해 아래 파생 필드를 추가 지원해야 한다.

- `is_direct`
- `is_codeshare`
- `duration_ratio_vs_direct_baseline`
- `has_baggage_info`
- `freshness_status`
- `quality_bucket`
- `price_anomaly_status`
- `price_anomaly_reason`

### 11.3 가격 이상 탐지 규칙
- 가격이 `0` 이하이거나, 통화/세금 포함 여부 기준으로 사전 정의된 임계 범위를 벗어나는 경우 `price_anomaly_status='anomaly'`로 분류해야 한다.
- 가격 이상 탐지는 최소 아래 유형을 지원해야 한다.
  - `zero_price`
  - `negative_price`
  - `extreme_high_price`
  - `currency_mismatch`
  - `tax_flag_inconsistent`
  - `missing_required_price_component`
- 가격 이상 임계치는 `source_site`, `origin-destination`, `cabin_group`, `fare_family` 수준에서 ruleset으로 관리할 수 있어야 한다.
- `price_anomaly_status='anomaly'`인 Offer는 기본적으로 Deal 대표가 계산 대상에서 제외해야 하며, 운영 승인 시에만 예외적으로 포함할 수 있다.
- 이상값 탐지 시 Slack, Teams 또는 동등한 운영 채널로 경고를 발행할 수 있어야 한다.
- anomaly 경고에는 execution_id, site_code, 노선, 날짜, 원본 가격, 통화, parser_version, raw_payload_ref가 포함되어야 한다.

### 11.4 모델 매핑 규칙
- 개별 여정 단위 결과는 `Offer` 모델에 저장한다.
- 일자 조합 기준 가격 스냅샷은 `FareSnapshot`에 저장한다.
- 지도 및 리스트에 노출할 대표가는 `Deal` 계산 계층에서 생성한다.
- `Deal`은 반드시 `best_depart_date`, `best_return_date`, `stay_bucket`, `currency`, `freshness_status`를 포함해야 한다.

### 11.5 원본 데이터 보존
- 파서 오류 및 스키마 변경 대응을 위해 원본 응답 payload를 저장한다.
- 원본 저장 시 민감한 쿠키, 토큰, 개인 식별자는 마스킹한다.
- 원본 payload와 정규화 결과는 동일 실행 ID로 연결 가능해야 한다.
- 원본 payload는 GitHub Actions artifact가 아니라 **외부 오브젝트 스토리지**를 기본 저장소로 사용한다.

---

## 12. 재검증 및 가격 신선도 요구사항

### 12.1 탐색용 가격과 예약용 가격 분리
- 지도 및 날짜 매트릭스는 **탐색용 가격**을 사용한다.
- 상세 화면에서는 배치 캐시를 즉시 표시하고 `last_batch_at`을 노출한다.
- 예약 버튼은 외부 아웃링크로 연결하며, 최종 가격 확인 책임은 예약처에 위임한다.
- 탐색용 가격과 예약처 가격이 다를 수 있음을 UI 및 API 모두에서 표현해야 한다.

### 12.2 freshness 필드
각 가격 데이터에는 최소 아래 메타데이터가 포함되어야 한다.

- `captured_at`
- `freshness_minutes`
- `freshness_status`
  - `active`
  - `stale`
  - `sold_out`

> **v3.0 정합**: 본 문서의 `freshness_status`는 database.md의 `price_status` enum(`active`/`stale`/`sold_out`)과 동일한 3-상태를 사용한다. 실시간 재검증이 제거된 일 1회 배치 구조에서 `recheck_required`는 사용하지 않는다.

### 12.3 고스트 페어 방어
- 프런트엔드는 `최종 확인: N시간 전` 문구를 표기할 수 있어야 한다.
- LCC 또는 수하물 불명 운임은 `수하물 미포함 가능성` 경고 배지를 지원해야 한다.
- 예약 직전 가격이 달라지면 API 응답에서 변경 사유를 구분할 수 있어야 한다.

### 12.4 LCC 특화 안내
- `free_baggage_allowance`가 비어 있거나 불명확한 경우, UI는 `수하물 정보 미확인` 상태를 표현할 수 있어야 한다.
- `operating_carrier`가 `marketing_carrier`와 다른 경우 공동운항 안내를 지원해야 한다.
- 긴 경유 대기시간이 있는 경우 상세 화면에서 별도 경고 문구를 지원해야 한다.

---

## 13. 장애 상태 코드 요구사항

실패 상태는 최소 아래 코드로 분류한다.

- `network_timeout`
- `proxy_blocked`
- `captcha_detected`
- `endpoint_changed`
- `parser_error`
- `empty_result`
- `sold_out`
- `session_bootstrap_failed`
- `unexpected_content_type`
- `rate_limited`
- `polling_incomplete`
- `html_state_extraction_failed`
- `required_runtime_script_blocked`
- `schema_validation_failed`
- `price_anomaly_detected`

### 13.1 실패 기록 필드
실패 로그에는 최소 아래 정보가 포함되어야 한다.

- execution_id
- site_code
- search params
- proxy_profile
- failure_code
- failure_reason
- html snapshot path
- trace path
- parser_version
- received responses summary
- occurred_at

### 13.2 재시도 정책
- 네트워크 타임아웃과 일시적 5xx는 제한적 재시도를 허용한다.
- captcha, endpoint_changed, parser_error는 자동 무한 재시도를 금지한다.
- polling incomplete는 짧은 지연 후 제한적 재시도를 허용할 수 있다.
- 동일 사이트에서 연속 실패율이 높으면 자동 알림 및 일시 중지 상태로 전환한다.
- `schema_validation_failed` 또는 `price_anomaly_detected`는 사이트별 임계치 기반으로 운영 알림을 발행하되, 동일 원인으로 전체 사이트를 즉시 중단할지는 정책화할 수 있어야 한다.

### 13.3 Clean-room 재시도 요구사항
- 재시도 시 이전 Playwright `BrowserContext`를 재사용해서는 안 되며, 기존 컨텍스트는 명시적으로 `close()` 후 폐기해야 한다.
- clean-room 재시도는 **완전히 비워진 새 incognito성 BrowserContext**에서 처음부터 다시 시작해야 한다.
- 세션 오염, WAF challenge, proxy 차단이 의심되는 경우 새 프록시 프로파일 또는 새 exit IP로 전환할 수 있어야 한다.
- clean-room 재시도에서는 이전 시도의 쿠키, localStorage, sessionStorage, 메모리 캐시를 재사용하지 않는다.
- 재시도 로그에는 기존 execution_id와 parent execution_id를 연결 저장하여, 동일 검색 작업의 재시도 체인을 추적할 수 있어야 한다.
- clean-room 재시도 적용 여부와 프록시 교체 여부는 Registry 또는 retry policy 설정으로 제어할 수 있어야 한다.

---

## 14. GitHub Actions 및 실행 오케스트레이션 요구사항

### 14.1 실행 방식
- 배치 수집은 `schedule`과 `workflow_dispatch` 두 가지 실행 방식을 모두 지원해야 한다.
- 일배치, 특정 날짜 재수집, 특정 사이트 단건 재실행을 각각 지원해야 한다.
- 수동 실행은 운영자가 사이트/노선/날짜 범위를 입력해 단건 검증에 사용할 수 있어야 한다.

### 14.2 스케줄 정책
- 정각 집중 구간을 피해서 실행 시간을 분산한다.
- 동일 사이트/동일 날짜 범위 작업이 겹치지 않도록 concurrency 정책을 적용한다.
- 장시간 실행 방지를 위해 작업 단위를 작게 쪼개고, 실패한 단위만 재실행할 수 있어야 한다.
- schedule 기반 실행은 최소 주기 제약을 고려해 설계해야 하며, 실제 수집 단위는 워크플로 내부 fan-out 구조로 분리한다.
- **MVP 1배치 상한**: GitHub Actions 55분 타임아웃 기준, 1배치당 최대 **60~80 검색 단위**를 상한으로 한다. 초과 분은 다음 날 배치로 이월하거나, 우선순위가 낮은 노선/소스를 스킵한다.

### 14.3 비용 관리
- 무료 티어 또는 제한된 CI 예산 환경에서도 유지 가능한 수준으로 실행 횟수와 저장 아티팩트를 통제해야 한다.
- trace, screenshot, HTML snapshot은 실패 분석용으로만 사용한다.
- 원본 payload는 GitHub Actions artifact에 장기 보존하지 않고 외부 오브젝트 스토리지로 즉시 업로드한다.
- 사이트별 수집 우선순위를 두어 핵심 노선/핵심 항공사를 먼저 수집한다.

### 14.4 환경 전환 가능성
- GitHub-hosted runner만을 유일한 실행 환경으로 가정하지 않는다.
- 차단율, 시간 초과, 비용이 임계치를 넘으면 self-hosted runner 또는 승인된 외부 실행 환경으로 전환 가능해야 한다.
- 실행 환경 변경 시에도 Collector Registry, Parser, 저장 포맷은 유지되어야 한다.

---

## 15. 저장소 및 보존 정책 요구사항

### 15.1 원본 저장소
- 원본 payload의 장기 저장소는 S3/R2/GCS 등 외부 오브젝트 스토리지를 기본으로 한다.
- 저장 키는 최소 아래 정보를 포함해야 한다.
  - execution date
  - site code
  - origin-destination
  - depart/return date
  - parser version
  - execution id

### 15.2 GitHub Actions Artifact 사용 원칙
- Artifact는 실패 분석용 trace, screenshot, HTML snapshot 등 단기 진단 자료에만 사용한다.
- 성공 실행의 원본 payload는 Artifact에 저장하지 않는다.
- Artifact 보존 기간은 짧게 유지하고, 외부 저장소와 역할을 분리한다.

### 15.3 마스킹 및 보안
- 외부 저장소 업로드 전 payload 내 쿠키, 토큰, 개인 식별자를 마스킹해야 한다.
- 마스킹 실패 시 업로드를 중단하고 `payload_redaction_failed`로 기록한다.

---

## 16. 보안 및 컴플라이언스 요구사항

- 시크릿은 환경 변수 또는 비밀 저장소를 통해 주입한다.
- 프록시 자격 정보, 세션 토큰, 쿠키 값은 로그 및 아티팩트에 남기지 않는다.
- 원본 payload 저장 시 개인 식별 가능 정보는 저장 대상에서 제외하거나 마스킹한다.
- 사이트별 이용 약관, 제휴/API 사용 가능 여부, robots 정책 등은 별도 법무/제휴 검토 트랙으로 관리한다.
- 특정 사이트가 반복적으로 기술적 차단 또는 challenge 응답을 반환하는 경우, 해당 사이트는 **수집기 개선 이슈**가 아니라 **수집 가능성 재평가 이슈**로 분류할 수 있어야 한다.

---

## 17. 개발 산출물 요구사항

구현 시 아래 산출물이 함께 제공되어야 한다.

1. 사이트별 Collector Registry 정의 파일
2. 사이트별 Parser 명세 및 버전 관리 규칙
3. 공통 수집 실행기
4. 공통 실패 코드 정의
5. 원본 payload 저장 규칙
6. 정규화 스키마 문서
7. GitHub Actions workflow 정의
8. 운영용 재실행/중지 기준 문서
9. 사이트별 PoC 결과 기록 문서
10. HTML 상태 데이터 fallback 명세
11. 폴링 API 조립 규칙 명세
12. 외부 오브젝트 스토리지 보존 정책 문서
13. 런타임 스키마 검증 모델 및 validator 정의
14. 가격 이상 탐지 ruleset 및 알림 정책 문서
15. clean-room retry 정책 문서

---

## 18. 권장 디렉터리 구조

```text
sky_collector/
  src/
    sky_collector/
      core/
        browser_session.py
        network_capture.py
        resource_blocker.py
        polling_assembler.py
        html_state_extractor.py
        retry_policy.py
        failure_codes.py
      models/
        captured.py
        offer.py
        snapshot.py
        anomaly.py
      registry/
        jinair.yaml
        jejuair.yaml
        tway.yaml
      parsers/
        base.py
        contracts.py
        jinair_v3.py
        jejuair_v3.py
      pipelines/
        run_daily_batch.py
        kexim_fx.py
        revalidation.py
      storage/
        manifest_manager.py
        firestore_writer.py
        deal_materializer.py
        daily_archiver.py
  tests/
  workflows/
    collect_daily.yml
    recollect_site.yml
  pyproject.toml
```

---

## 19. 수용 기준

아래 조건을 만족하면 본 요구사항을 충족한 것으로 본다.

### 19.1 기능 수용 기준
- 검색 트리거 후 화면 DOM 가격을 읽지 않고도 목표 응답 또는 상태 데이터를 수집할 수 있다.
- GraphQL 단일 엔드포인트 사이트에서 `operation_name` 또는 `request_payload_contains` 기반으로 목표 응답을 식별할 수 있다.
- GraphQL batch(Array) 요청에서도 목표 operation을 식별하고 응답을 올바르게 매핑할 수 있다.
- 폴링형 사이트에서 partial 응답과 complete 응답을 구분하고 최종 완료 상태에서만 성공 처리할 수 있다.
- XHR이 없는 SSR/SSG 사이트에서 HTML 내장 상태 데이터를 추출해 `Offer` 생성이 가능하다.
- 수집된 응답으로 `Offer` 생성에 필요한 필수 필드를 안정적으로 추출할 수 있다.
- 런타임 스키마 검증 실패 시 정규화 데이터가 저장되지 않고 오류가 명시적으로 기록된다.
- `Deal` 생성에 필요한 대표가 계산 입력값을 제공할 수 있다.
- 특정 사이트의 응답 구조 변경 시 `endpoint_changed` 또는 `parser_error`로 분리 감지할 수 있다.

### 19.2 성능 수용 기준
- 동일 사이트에서 DOM 파싱 방식보다 평균 실행 시간이 단축되어야 한다.
- 브라우저 체류 시간과 네트워크 전송량이 기존 방식 대비 유의미하게 감소해야 한다.
- 불필요한 정적 리소스 요청 비율이 차단 정책 적용 후 현저히 감소해야 한다.

### 19.3 운영 수용 기준
- 실패 실행은 원인 코드, 프록시 정보, 파서 버전, 원본 응답 참조 정보와 함께 추적 가능해야 한다.
- 실패한 사이트만 개별 재실행할 수 있어야 한다.
- 세션 오염이 의심되는 재시도는 clean-room BrowserContext로 수행되며, 이전 시도와 추적 가능하게 연결되어야 한다.
- 가격 이상 탐지 시 운영 알림이 발행되고, anomaly Offer가 기본적으로 대표가 계산에서 제외되어야 한다.
- 스케줄 중복 실행이 방지되어야 한다.
- 비용 제한을 넘지 않도록 사이트별 우선순위 및 실행량 통제가 가능해야 한다.
- 원본 payload가 Artifact가 아닌 외부 오브젝트 스토리지에 저장되어야 한다.

---

## 20. PRD 반영 문구 예시

아래 문구는 PRD 또는 기술 설계 문서에 바로 반영할 수 있다.

> 수집 시스템은 브라우저 렌더링 결과를 DOM 셀렉터로 파싱하는 방식이 아니라, Playwright 기반 브라우저 세션에서 검색 트리거 후 발생하는 XHR/Fetch/GraphQL 응답을 가로채 구조화된 데이터를 직접 수집하는 방식을 기본 원칙으로 한다. 이 구조를 통해 렌더링 대기 시간, 프록시 비용, UI 변경 취약성을 줄이고, 원본 payload 저장 및 파서 버전 관리를 통해 운영 안정성을 확보한다.

> 사이트별 수집기는 Collector Registry를 통해 목표 응답 식별 규칙, 폴링 완료 조건, 필수 런타임 스크립트 allowlist, 프록시 정책, 파서 버전, fallback 정책을 선언적으로 관리한다. 목표 응답이 정상적으로 감지되지 않으면 endpoint_changed 상태로 기록하고 운영 검토 대상으로 분류한다.

> XHR 응답이 존재하지 않거나 첫 HTML 로드에 검색 결과 상태가 내장된 사이트는 HTML 내장 JSON 추출 fallback을 사용할 수 있다. 단, 이는 XHR/Fetch 응답이 확인되지 않는 경우에 한해 제한적으로 적용한다.

> 지도 및 날짜 매트릭스에 노출되는 가격은 탐색용 가격이며, 상세 화면 및 예약 이동 직전에는 필요 시 재검증을 수행한다. 모든 가격 데이터는 captured_at과 freshness_status를 포함해야 하며, UI는 최종 확인 시각과 가격 불일치 가능성을 안내해야 한다.

> 원본 payload는 GitHub Actions Artifact에 장기 저장하지 않고 외부 오브젝트 스토리지에 저장한다. GitHub Actions Artifact는 실패 분석용 trace, screenshot, HTML snapshot 등 단기 진단 자료로만 사용한다.

> 정규화 계층은 런타임 스키마 검증을 필수 통과해야 하며, 필수 필드 누락이나 타입 불일치가 발생한 데이터는 저장하지 않는다. 가격이 0원이거나 비정상적으로 높은 값 등 이상값이 탐지된 경우 anomaly 상태로 분류하고 운영 채널에 알림을 발행한다.

> 재시도는 이전 브라우저 컨텍스트를 재사용하지 않는 clean-room 정책을 따른다. 세션 오염 또는 차단이 의심되는 경우 새 BrowserContext와 새 프록시 프로파일로 다시 시작하여 연속 실패 가능성을 낮춘다.

---

## 21. 다음 단계 권장 사항

1. **Anti-Bot Bypass 로컬 PoC (최우선)**
   - `playwright-stealth` 또는 `Patchright` 설치 후 `headless=False`(창 띄우기) 모드로 진에어 메인 페이지 접속
   - 캡차 발생 여부, 보안 쿠키(`_abck`) 발급 여부를 눈으로 확인
   - 프록시 없이 로컬 PC(집 IP)에서 먼저 뚫기
2. 국내 LCC 1개 사이트를 선정해 XHR/GraphQL 가로채기 PoC 수행
   - 첫 타겟은 JSON 구조와 화면-API 분리가 비교적 명확한 제주항공 또는 진에어를 우선 검토한다.
3. 목표 응답 URL 패턴, operation name, GraphQL batch 여부, payload 스키마 식별
4. partial polling 응답과 complete 응답의 종료 조건 확인
5. HTML 상태 데이터 fallback 필요 여부 검증
6. 공통 Collector Registry와 Parser 인터페이스 초안 확정
7. 런타임 스키마 검증 모델과 가격 이상 탐지 ruleset 초안 확정
8. GitHub Actions 기준 일배치 workflow 작성
9. 원본 payload 외부 저장 및 정규화 적재까지 end-to-end 검증
10. 실패 코드 체계, clean-room retry 정책, 운영 대시보드 요구사항 정리

### 21.1 PoC 대상 우선순위

| 순위 | 사이트 | 난이도 | 이유 | fallback |
|---|---|---|---|---|
| 1 | 제주항공/진에어 | 🟢 낮음 | GraphQL API 명확, JSON 구조 분리 | — |
| 2 | 아시아나 | 🟡 중간 | Amadeus SPA, API 경로 안정적이나 세션 복잡 | — |
| 3 | 대한항공 | 🟠 높음 | Akamai Bot Manager + fingerprinting | PoC 실패 시 공식 사이트 deeplink만 유지, 스크래핑 비활성 |
| — | Google Flights/KAYAK | 🔴 disabled | 법무/파트너 검토 전까지 feature flag 비활성 | — |

> **대한항공 fallback**: PoC에서 Akamai 차단이 안정적으로 우회되지 않으면, `korean_air_official` source는 스크래핑 대신 **공식 사이트 검색 deeplink만 제공**하고 가격 수집은 메타검색(Skyscanner)에 위임한다.


---

## 22. 구현 전달 메모

본 버전(v3)은 기존 강화 반영본(v2)의 방향성을 유지하면서, 실제 개발 착수 시 엔지니어가 놓치기 쉬운 마이크로 디테일을 요구사항 수준으로 명시한 문서다.

- GraphQL 수집기는 단일 object payload뿐 아니라 batch array payload도 처리해야 한다.
- 파서는 정규화 직후 Pydantic 또는 동등한 validator를 통과해야 하며, 검증 실패 데이터는 저장하지 않는다.
- 가격 이상 탐지는 단순 로그가 아니라 대표가 제외와 운영 알림까지 연결되어야 한다.
- 재시도는 반드시 clean-room BrowserContext와 필요 시 새 프록시 프로파일에서 시작해야 한다.

이 문서는 국내 LCC 1개 사이트를 대상으로 한 첫 번째 PoC와 이후 Registry/Parser 표준화 작업의 베이스라인으로 사용할 수 있다.
