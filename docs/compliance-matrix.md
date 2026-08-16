# Data Source Compliance Matrix

| `source_id` | 파트너명 | 접근 방식 | 계약 상태 | 가격 저장 권한 | 가격 표시 권한 | 재배포 권한 | 호출 한도 (RPM / Daily) | 데이터 TTL | 딥링크 조건 | 표시 의무 | 수익화 조건 | 담당자 | 계약 만료일 | 비활성화 조건 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `skyscanner_affiliate` | Skyscanner | Official Partner API / Feed | Approved (Partner Sandbox / API) | 28시간 캐시 저장 허용 | UI 직접 표시 허용 | 내부 집계 목적 한정 | 30 RPM / 50,000 req/day | 28 hours | HTTPS canonical 딥링크 (Affiliate ID 필수) | "Powered by Skyscanner" 로고 및 명시 | CPA / RevShare | Data Partnership Lead | 2027-12-31 | 5xx 에러율 > 5%, 딥링크 실패율 > 5% |
| `korean_air_official` | 대한항공 (Korean Air) | Authorized JSON Feed / Partner API | Approved (Official Partner Feed) | 28시간 캐시 저장 허용 | UI 직접 표시 허용 | 내부 집계 목적 한정 | 20 RPM / 20,000 req/day | 28 hours | HTTPS 공식 예약 딥링크 | 공식 운임 및 항공사 표기 | Direct Booking Link | Partnership Ops | 2027-12-31 | 연속 3회 인증 실패, 스키마 변경 |
| `asiana_official` | 아시아나항공 (Asiana Airlines) | Authorized JSON Feed / Partner API | Approved (Official Partner Feed) | 28시간 캐시 저장 허용 | UI 직접 표시 허용 | 내부 집계 목적 한정 | 20 RPM / 20,000 req/day | 28 hours | HTTPS 공식 예약 딥링크 | 공식 운임 및 항공사 표기 | Direct Booking Link | Partnership Ops | 2027-12-31 | 연속 3회 인증 실패, 스키마 변경 |
| `promo_page_sources` | 항공사 공식 프로모션 페이지 | Public Promo Feed / Meta Feed | Active / Monitored | 28시간 캐시 저장 허용 | UI 직접 표시 허용 | 비상업적 참고가 | 10 RPM | 28 hours | 공식 이벤트 페이지 직통 HTTPS 링크 | 출처 명시 | N/A | Ops Team | Continuous | 404/410 링크 만료 |

---

## Compliance Rules & Guidelines
1. **No CAPTCHA / Anti-Bot Bypass Violation**: All ingestion must adhere strictly to agreed partner contracts or authorized feed endpoints.
2. **Attribution & Trademark**: Partner logos and branding rules must be strictly respected on `/offers` and destination screens.
3. **Deeplink Integrity**: Deeplinks must preserve origin, destination, dates, and cabin class parameters directly to checkout/booking search pages.
