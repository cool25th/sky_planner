# Firebase Free Tier Quota & Retention Policy

## 1. 무료 한도 원칙
- **Spark Plan 유지**: Billing Account 연결 절대 금지 (과금 차단).
- **일일 안전 상한선**:
  - Read: 최대 30,000 / 일 (한도 50,000의 60%)
  - Write: 최대 12,000 / 일 (한도 20,000의 60%)
  - Delete: 최대 5,000 / 일 (한도 20,000의 25%)
  - Storage: 최대 600 MiB (한도 1.0 GiB의 60%)

## 2. Retention 및 정리 정책
- **현재 배치(Current)**: 활성 제공용 유지.
- **직전 배치(Previous)**: 롤백 대비용 1개 유지.
- **2개 이전 배치**: 일일 Delete Quota를 고려하여 배치 후순위 단계에서 점진 삭제.
- **오퍼 다이어트**: 노선별 최저가 및 상위 3개 오퍼만 선별 적재 (장기 히스토리 보관 금지).

## 3. 상용 전환 트리거 (Commercial Launch Triggers)
다음 조건 중 하나라도 충족 시 무료 베타를 종료하고 Vercel Pro + Firebase Blaze 유료 전환을 검토한다.
1. Affiliate 수익화 및 상업 광고 시작
2. 일일 Read 35,000건 초과 지속
3. 일일 Write 14,000건 초과 지속
4. 저장량 700 MiB 초과 지속
5. 사용자 수 50명 초과 및 마케팅 개시
