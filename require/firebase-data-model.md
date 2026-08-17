# Firebase Firestore Data Model Specification

## 1. 개요
Firestore의 NoSQL 특성에 맞추어 복합 조인과 실시간 집계를 제거하고, 화면 렌더링에 필요한 단일 Document 단위의 **사전 집계 뷰(Pre-aggregated Views)** 모델을 정의한다.

---

## 2. 컬렉션 상세 정의

### 2.1 `service_state/production`
서비스의 최신 상태 및 현재 활성 배치 포인터.

```json
{
  "environment": "beta",
  "release_version": "1.0.0",
  "current_batch_id": "batch_20260324_020000",
  "previous_batch_id": "batch_20260323_020000",
  "last_successful_publish_at": "2026-03-24T02:15:00Z",
  "data_status": "ready",
  "active_source_ids": ["skyscanner_affiliate", "korean_air_official"],
  "estimated_daily_reads": 450,
  "estimated_daily_writes": 1820,
  "estimated_storage_bytes": 6291456,
  "mock_data_enabled": false,
  "updated_at": "2026-03-24T02:15:00Z"
}
```

### 2.2 `current_views/map__{origin}__{week}__{stay_bucket}__{cabin}`
지도 화면에 필요한 목적지별 최저가 목록 사전 집계 문서.

```json
{
  "view_id": "map__ICN__2026-W13__5_7__economy",
  "view_type": "map",
  "origin": "ICN",
  "week": "2026-W13",
  "stay_bucket": "5_7",
  "cabin": "economy",
  "batch_id": "batch_20260324_020000",
  "deal_count": 35,
  "deals": [
    {
      "destination_code": "NRT",
      "city": "도쿄",
      "country": "일본",
      "lat": 35.772,
      "lon": 140.393,
      "region": "JAPAN",
      "economy_min_total": 285000,
      "business_min_total": 750000,
      "best_airline": "아시아나항공",
      "best_offer_id": "offer_nrt_123"
    }
  ],
  "published_at": "2026-03-24T02:15:00Z"
}
```

### 2.3 `current_views/calendar__{origin}__{destination}__{month}__{cabin}`
특정 목적지의 날짜별 최저가 매트릭스 사전 집계 문서.

```json
{
  "view_id": "calendar__ICN__TYO__2026-03__economy",
  "view_type": "calendar",
  "origin": "ICN",
  "destination": "TYO",
  "month": "2026-03",
  "cabin": "economy",
  "batch_id": "batch_20260324_020000",
  "matrix": {
    "2026-03-23": {
      "min_price_krw": 285000,
      "best_airline": "OZ",
      "best_offer_id": "offer_nrt_123"
    }
  },
  "published_at": "2026-03-24T02:15:00Z"
}
```

### 2.4 `offers/{offer_id}`
최종 예약 딥링크가 포함된 상세 오퍼 문서 (노선당 상위 3개 선별 저장).

```json
{
  "offer_id": "offer_nrt_123",
  "batch_id": "batch_20260324_020000",
  "origin_airport": "ICN",
  "destination_airport": "NRT",
  "destination_city_id": "TYO",
  "depart_date": "2026-03-23",
  "return_date": "2026-03-30",
  "airline_code": "OZ",
  "airline_name": "아시아나항공",
  "cabin_group": "economy",
  "total_price": 285000,
  "currency": "KRW",
  "deep_link": "https://flyasiana.com/booking?...",
  "booking_source": "asiana_official",
  "price_status": "active",
  "observed_at": "2026-03-24T02:00:00Z"
}
```
