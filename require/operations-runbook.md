# Operations Runbook (Firebase Free Tier Beta)

## 1. 정기 수집 배치 실패 시 대응
1. GitHub Actions 워크플로우 로그 확인.
2. `service_state/production`의 `current_batch_id`가 변경되지 않았는지 확인 (이전 정상 데이터 유지 여부 점검).
3. Quota Guard 초과로 인한 중단인 경우: 수집 노선 수 축소 또는 상위 N개 오퍼 필터링 강화.

## 2. 긴급 롤백 절차
1. `service_state/production`의 `current_batch_id`를 `previous_batch_id`로 수정.
2. Next.js 캐시 무효화 API (`/api/revalidate`) 호출.
3. `/api/ops/service-readiness`에서 정상 롤백 확인.

## 3. 오래된 배치 정리 (Manual Purge)
```bash
npm run cleanup:old-batches -- --keep 2
```
