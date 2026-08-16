# Source Policy — 항공 특가 지도 서비스

## 문서 정보
| 항목 | 내용 |
|------|------|
| 버전 | v3.1 |
| 기준일 | 2026-03-25 |
| 적용 범위 | MVP 클로즈드 베타 |

---

## 1. 목적

- 어떤 source를 어떤 방식으로 수집하는지 문서화한다.
- robots, 약관, 브랜딩, 딥링크, 차단 위험을 기준으로 source 활성 여부를 고정한다.
- feature flag와 fallback 정책을 코드와 운영에서 같은 기준으로 사용한다.

---

## 2. 기본 원칙

1. 단순 IP 분산과 source별 rate control을 위한 **주거용 프록시 사용은 허용**한다. 단, 로그인 우회, 명시적 CAPTCHA 솔버 사용, 비정상적 해킹 기반 접근은 금지한다.
2. 법무/파트너 검토가 끝나지 않은 direct source는 비활성 유지한다.
3. UI에는 사용 가능한 booking source만 노출한다.
4. representative deal은 **활성 source**에서만 선택한다.
5. 모든 수집은 raw payload 또는 증적 로그를 남긴다.
6. browser 기반 source는 **GitHub Actions Ubuntu runner + Playwright + residential proxy**를 기본 실행 환경으로 사용한다.
7. browser 기반 source는 Request Interception allowlist 정책을 적용해 검색에 불필요한 이미지/미디어/비필수 CSS/광고·분석 스크립트를 차단한다.
8. Vercel은 사용자 응답 전용이며, source 스크래핑을 실행하지 않는다.

---

## 3. MVP source 카탈로그

| source_id | 유형 | 획득 방식 | 상태 | feature flag | UI 노출 | fallback |
|---|---|---|---|---|---|---|
| `skyscanner_affiliate` | meta_search | 승인된 affiliate/API 또는 허용된 deeplink | enabled | `SOURCE_SKYSCANNER_ENABLED=true` | yes | disabled 시 공식 항공사만 유지 |
| `korean_air_official` | airline_official | GitHub Actions Playwright + official search/deeplink | enabled | `SOURCE_KOREAN_AIR_ENABLED=true` | yes | 장애 시 stale 유지 후 제외 |
| `asiana_official` | airline_official | GitHub Actions Playwright + official search/deeplink | enabled | `SOURCE_ASIANA_ENABLED=true` | yes | 장애 시 stale 유지 후 제외 |
| `google_flights_direct` | meta_search | GitHub Actions Playwright + residential proxy | disabled_pending_review | `SOURCE_GOOGLE_FLIGHTS_ENABLED=false` | no | 승인 전까지 job 미생성 |
| `kayak_direct` | meta_search | GitHub Actions Playwright + residential proxy | disabled_pending_review | `SOURCE_KAYAK_ENABLED=false` | no | 승인 전까지 job 미생성 |
| `official_promo_pages` | promo_page | 공식 프로모션 페이지 | optional_secondary | `SOURCE_PROMO_PAGES_ENABLED=false` | badge only | manifest와 live evidence 준비 후 활성화 |

---

## 4. 브랜딩 및 딥링크 규칙

### 4.1 메타 소스

- 메타 소스 라벨은 예약처 명칭 그대로 노출한다.
- partner 조건이 허용한 경우에만 deeplink를 사용한다.
- 브랜드 사용 문구, 로고, attribution이 요구되면 UI 하단에 고정 노출한다.

### 4.2 공식 항공사

- 공식 사이트는 항공사명, 항공사 코드, 공식 예약 링크를 그대로 쓴다.
- 항공사 공식 프로모션 페이지는 `official_promo` badge 부여에만 사용 가능하다.
- 프로모션만 있고 실제 검색 결과 검증이 없으면 대표가로 사용하지 않는다.

---

## 5. robots / 약관 / 차단 대응

| 상황 | 정책 |
|---|---|
| robots 허용 + 파트너/법무 승인 | 수집 가능 |
| robots 불명확 또는 약관 미확정 | staging에서만 검토, prod 비활성 |
| CAPTCHA / block / bot detection 반복 | circuit breaker 열고 운영 경고, CAPTCHA 솔버로 우회하지 않음 |
| 링크 포맷 변경 | source status를 `degraded`로 보고 stale 유지 |

- 승인 전 source는 prod에 배포하더라도 feature flag 기본값을 `false`로 둔다.
- 차단이 24시간 이상 지속되면 해당 source는 UI와 대표가 계산에서 제외한다.
- browser source는 GitHub Actions `daily-batch` 안에서 source별 순차 호출로 실행한다.
- 주거용 프록시는 source별 IP 분산과 안정적인 접속성 확보를 위한 수단으로만 사용하며, 명시적 차단 페이지를 해킹적으로 우회하는 용도로 사용하지 않는다.
- GitHub-hosted runner의 공용 IP 대역은 차단 가능성이 높으므로 direct browser source는 proxy 없이는 운영하지 않는다.
- 장기적으로는 브라우저 스크래핑보다 승인된 affiliate/API, NDC, 공식 파트너 연동으로 전환하는 것을 우선 전략으로 둔다.

---

## 6. fallback 정책

1. 특정 source가 비활성화되면 scheduler가 해당 source job을 만들지 않는다.
2. 기존 데이터는 최대 24시간 동안 stale로 남길 수 있다.
3. 24시간이 지나면 representative candidate에서 제외하고 필요 시 `is_active=false` 처리한다.
4. promotion source만 남은 경우, 배지는 유지하되 대표 가격 source로는 사용하지 않는다.
5. 모든 source가 비면 해당 도시/버킷 결과를 숨기고 "현재 확인 가능한 예약처 없음" 메시지를 노출한다.

---

## 7. 운영 체크리스트

- source별 법무/브랜딩 승인 여부 기록
- deeplink 샘플 5건 수동 검증
- 차단 빈도와 응답 지연 1주 관찰
- attribution 문구와 로고 사용 정책 확인
- disabled source가 UI에 노출되지 않는지 회귀 테스트
