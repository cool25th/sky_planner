# Free Tier Limited Beta Go-Live Checklist

- [ ] Firebase Spark Plan (Billing Account 미연결)
- [ ] Firestore Security Rules (Client Read/Write 100% 차단)
- [ ] Service Account 환경변수 주입 (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`)
- [ ] `SERVICE_REQUIRE_FIRESTORE=true` 설정
- [ ] `DATA_BACKEND=firestore` 설정
- [ ] Production Mock Offer 0건 확인
- [ ] 승인된 실제 데이터 소스 1개 이상 연결
- [ ] 일일 예상 Write ≤ 12,000건, Read ≤ 30,000건 확인
- [ ] `/terms` 및 `/privacy` 비상업적 베타 면책 고지 완료
- [ ] `npm run audit:free-tier-beta` 통과 (`ready_for_free_beta: true`)
