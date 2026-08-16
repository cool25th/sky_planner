# Frontend 설계 문서 — 항공 특가 지도 서비스

## 문서 정보
| 항목 | 내용 |
|------|------|
| 버전 | v3.1 |
| 기준 PRD | v3.1 (2026-03-25) |
| 기술 스택 | Next.js 15 · React 19 · TypeScript 5 · Tailwind CSS 4 · shadcn/ui · MapLibre GL JS |
| 상태 관리 | TanStack Query v5 · Zustand |
| 스키마 검증 | Zod |
| 배포 경계 | Vercel Hobby 위의 Next.js BFF |

> **v3.0 무료 티어 전환**: 프런트는 `Vercel Hobby`에 배포하고, BFF 응답은 `Vercel Data Cache / ISR`로 24시간 캐시한다. 사용자는 대부분 Firestore가 아니라 Vercel CDN 응답을 받는다.

---

## 1. 프런트엔드 책임

- 공개 웹앱은 **same-origin BFF**만 호출한다.
- URL이 검색 상태의 단일 기준이다.
- 지도와 리스트는 `region` 단위 응답을 받고, viewport 마커 필터링은 클라이언트(MapLibre)가 처리한다.
- 상세 화면은 배치 캐시를 즉시 렌더링하고 `last_batch_at`을 표시한다.
- 캐시 갱신은 GitHub Actions 배치 완료 후 Vercel On-Demand Revalidation으로 처리된다.

---

## 2. 기술 스택

### Core
- **Next.js 15 (App Router)**
- **React 19**
- **TypeScript 5**

### UI
- **Tailwind CSS 4**
- **shadcn/ui**
- **Lucide React**

### 데이터
- **TanStack Query v5**
- **Zustand**
- **Zod**

### 지도
- **MapLibre GL JS**
- **MapTiler style URL**

---

## 3. 라우팅 및 URL 상태

### 3.1 페이지 경로

| 경로 | 렌더링 | 역할 |
|---|---|---|
| `/` | SSG | 랜딩 |
| `/map` | CSR + prefetch | 지도 + 지역 리스트 |
| `/destination/[placeId]` | CSR + prefetch | 날짜 매트릭스 |
| `/offers` | CSR | 상세 목록 |
| `/admin/dashboard` | CSR + auth guard | 운영 화면 |

### 3.2 URL 파라미터 계약

| 파라미터 | 화면 | 기본값 |
|---|---|---|
| `origin` | map, destination, offers | `ICN` |
| `week` | map, destination | 현재+1 ISO week |
| `stay_bucket` | map, destination | `5_7` |
| `traveler` | map, destination, offers | `adt1` |
| `cabin` | map, destination, offers | `all` |
| `region` | map | `all` |
| `airlines` | map | 빈값 |
| `destination` | offers | 없음 |
| `depart` | offers | 없음 |
| `return` | offers | 없음 |
| `airline` | offers | 없음 |
| `stops` | offers | `all` |

> `bounds`는 URL과 API에서 제거한다. BFF는 `region` 단위로 데이터를 내려주고, MapLibre가 브라우저 뷰포트 기준으로 마커를 필터링한다.

---

## 4. BFF 계약

### 4.1 엔드포인트

| 엔드포인트 | 화면 | 메모 |
|---|---|---|
| `GET /api/deals/map` | 지도, 지역 리스트 | `calendar_matrix` 제외 경량 marker payload |
| `GET /api/deals/calendar` | 날짜 매트릭스 | embedded `calendar_matrix` 반환 |
| `GET /api/offers` | 상세 목록 | 배치 캐시 즉시 반환 |

### 4.2 공통 응답 메타

```ts
interface ApiResponse<T> {
  request_id: string;
  generated_at: string;
  last_batch_at: string;
  warning_flags: string[];
  source_flags: string[];
  data: T;
}
```

### 4.3 캐시 계약

- BFF Route Handler 응답은 **Vercel Data Cache / ISR 24시간**을 사용한다.
- 사용자는 대부분 CDN 응답을 받으며 Firestore read를 직접 유발하지 않는다.
- GitHub Actions 배치 완료 후 Vercel Revalidation Webhook이 호출되면 다음 요청부터 새 데이터가 내려온다.

---

## 5. 상태 관리

### 5.1 레이어

| 레이어 | 도구 | 역할 |
|---|---|---|
| Server state | TanStack Query | BFF 응답 캐시 |
| Client state | Zustand | 선택 캐빈, 열린 sheet, hover, 지도 뷰 |
| URL state | `useSearchParams()` | 검색 조건 |

### 5.2 Query key 규칙

- `/api/deals/map`: `["deals-map", origin, week, stay_bucket, traveler, cabin, region, airlines]`
- `/api/deals/calendar`: `["deals-calendar", origin, placeId, week, stay_bucket, traveler, cabin]`
- `/api/offers`: `["offers", origin, destination, depart, return, traveler, cabin, airline, stops]`

### 5.3 캐시 정책

| 엔드포인트 | client staleTime | gcTime | 비고 |
|---|---|---|---|
| `/api/deals/map` | 10분 | 30분 | 서버 쪽은 24시간 ISR |
| `/api/deals/calendar` | 10분 | 30분 | 서버 쪽은 24시간 ISR |
| `/api/offers` | 10분 | 30분 | 서버 쪽은 24시간 ISR |

> 클라이언트 캐시는 UX 최적화용이고, Firestore quota 방어의 핵심은 **Vercel 서버 캐시**다.

---

## 6. 핵심 컴포넌트

### 6.1 SearchHeader
- `origin`, `week`, `stay_bucket`, `cabin`, `region` 선택
- `traveler=adt1`는 숨김 기본값

### 6.2 DealsMapPanel
- `region` 단위 응답을 받고 MapLibre에서 viewport 기준 마커 필터링
- 핀은 `Eco`와 `Biz`를 동시에 표시
- 지도 이동 자체는 API 재호출보다 클라이언트 필터링을 우선

### 6.3 RegionListPanel
- 대표가, 대표 항공사, badge, `last_batch_at` 기반 라벨 표시
- 비활성 source는 필터 옵션에서 숨김

### 6.4 FareMatrix
- embedded `calendar_matrix`를 그리드로 렌더링
- best cell 하이라이트와 상태 표시

### 6.5 OfferList
- 배치 캐시를 즉시 표시
- 상단 배너: `마지막 업데이트: YYYY.MM.DD · 일 1회 갱신 · 실제 예약가는 항공사에서 확인하세요`
- 예약 버튼은 외부 deeplink로 이동

---

## 7. 상세 화면 UX

- `/offers` 진입 시 배치 캐시 데이터를 즉시 렌더링
- `last_batch_at`을 명확히 노출
- `실시간 재검증`, `polling`, `refresh 배너`는 없다
- 예약 버튼 클릭 시 외부 예약처로 이동

---

## 8. 성능 전략

- `region` 단위 캐시로 서버 캐시 히트율을 높인다
- `/api/deals/map`은 `calendar_matrix`를 제외한 경량 payload만 소비한다
- MapLibre는 `next/dynamic`으로 지연 로딩한다
- 리스트는 virtualization을 적용한다
- 첫 요청 이후 같은 조건의 다수 사용자는 **Vercel CDN 응답만 받도록** 설계한다

---

## 9. 테스트 전략

| 계층 | 도구 | 검증 항목 |
|---|---|---|
| Unit | Vitest | URL 파서, formatter |
| Component | Testing Library | FareMatrix, OfferCard, LastBatchBanner |
| Integration | MSW + Vitest | 배치 캐시 렌더, BFF filter 결과 |
| E2E | Playwright | 지도 탐색, 복수 항공사 필터, 외부 예약 링크 이동 |

### 필수 시나리오

- `/api/offers` 응답이 카드로 즉시 렌더링되어야 한다
- `last_batch_at`이 화면에 올바르게 표시되어야 한다
- 복수 항공사 선택이 Firestore 직접 쿼리 실패 없이 동작해야 한다
- 지도 이동 중 같은 `region`에서는 불필요한 API 재호출 없이 마커 필터링이 동작해야 한다

---

## 10. 환경 변수

```bash
NEXT_PUBLIC_MAPTILER_STYLE_URL=
NEXT_PUBLIC_ENABLED_SOURCES=skyscanner_affiliate,korean_air_official,asiana_official
NEXT_PUBLIC_APP_LOCALE=ko-KR
```

---

## 11. 향후 확장

- 트래픽이 커지면 polling이 아니라 **여전히 캐시 우선 구조**를 유지하고, 필요 시 별도 알림/실시간 서브시스템을 추가한다.
- 검색 트래픽이 커지면 서버 응답을 정적 prebuild 또는 edge KV로 넘기는 방향을 검토한다.
