# Sky Planner Atlas

한국 출발 항공 특가 서비스 MVP. `Next.js 15 App Router + same-origin BFF + PostgreSQL read model + 일 1회 배치 수집` 구조이며, 초기 Python 프로토타입도 함께 보관한다.

- 제품 요구사항: 비공개(로컬 보관)
- 운영 가이드(배치/수집기/readiness gate): [`docs/operations.md`](docs/operations.md)

## 구조

| 경로 | 역할 |
|---|---|
| `app/` | Next.js App Router 페이지 + `/api/*` BFF route handler |
| `components/` | React 클라이언트 컴포넌트 |
| `lib/mock-market.ts` | mock market feed, 쿼리 파싱, 응답 envelope |
| `lib/data-source.ts` + `lib/read-model/` | PostgreSQL 조회 → mock fallback → readiness 차단 오케스트레이션 |
| `lib/db.ts` | Postgres 연결 풀 |
| `scripts/` | 배치·수집·검증 스크립트 (상세는 [운영 가이드](docs/operations.md)) |
| `sql/init/` | read model DDL 및 롤 분리 |
| `sky_collector/` | Python 수집기 패키지 (Playwright 기반, normalized batch 생성) |
| `backend.py`, `server.py`, `legacy_static/` | 초기 Python 프로토타입 (레거시 보관) |

## 데이터 백엔드

**PostgreSQL이 canonical read model**이고 **Firestore는 감사(audit) sink**다. 앱은 `DATABASE_URL`(또는 `DATABASE_READ_URL`)이 있으면 read model을 먼저 사용하고, 없거나 실패하면 mock으로 fallback한다. 운영에서는 `SERVICE_REQUIRE_POSTGRES=true`로 fallback을 차단해 빈 결과 + 503을 반환한다.

응답 진위 판별은 `diagnostics.read_model === "postgres"`, `diagnostics.fallback_used === false`, `diagnostics.source_readiness.status === "ready"`로 한다.

## 실행

### Next.js 앱
```bash
npm install
npm run batch
npm run dev            # http://localhost:3000
```

### PostgreSQL read model 확인
```bash
docker compose up -d db
npm run db:seed
DATABASE_URL=postgresql://sky_planner:sky_planner_dev@localhost:5433/sky_planner npm run dev
```

DB 계정 분리(read/ingest/migration), collector ingest 계약, authorized feed collector, preflight/smoke/launch audit 절차는 [docs/operations.md](docs/operations.md)를 참고한다.

### Production-like 확인
```bash
npm run build
npm run start
```

### Python legacy 프로토타입
```bash
python3 server.py      # http://127.0.0.1:8000
```

## API

- `/api/meta`
- `/api/search?q=Tokyo&origin=ICN&days=7&flex=1&cabin=ALL` — 국가/지역 입력은 매칭되는 여러 목적지를 함께 비교
- `/api/deals/map?origin=ICN&week=2026-W13&region=ALL&cabin=ALL&stay_bucket=5_7&traveler=adt1`
- `/api/deals/calendar?origin=ICN&week=2026-W13&destination=TPE&...`
- `/api/offers?origin=ICN&week=2026-W13&destination=TPE&depart=2026-03-23&return=2026-03-30&...`
- `/api/ops/source-health` — collector readiness 상태와 source별 operator actions
- `/api/ops/service-readiness` — 서비스 출시 gate (6개 축)

모든 API는 공통 envelope을 반환한다:

```json
{
  "request_id": "...",
  "generated_at": "2026-03-24T11:30",
  "last_batch_at": "2026-03-24T02:00",
  "warning_flags": ["daily_batch_cached", "final_price_check_on_booking_source"],
  "source_flags": ["skyscanner_affiliate", "korean_air_official", "asiana_official"],
  "data": {}
}
```

## 개발

```bash
npm test               # Node contract 테스트 전체
npm run lint           # Biome lint
npx tsc --noEmit       # 타입 검사
python3 -m unittest discover -s tests   # 레거시 Python 테스트
npm run build          # 프로덕션 빌드
```

개별 smoke/preflight/audit 명령은 [`docs/operations.md`](docs/operations.md) 참고.

## 현재 한계

- 실제 partner credential과 live endpoint manifest secret은 아직 주입 전이다. `COLLECTOR_SOURCE_MANIFEST_JSON`이 비어 있으면 service readiness도 출시 준비 상태로 인정하지 않는다.
- `/service-readiness`는 mock seed만으로는 `ready`로 인정하지 않는다. 승인 collector 성공 이력과 artifact 증거를 요구한다.
- `sky_collector`의 사이트별 XHR/GraphQL 캡처 어댑터는 구현 전이며, 현재는 normalized batch ingest 계약과 DB writer를 먼저 검증했다.
- 가격, 할인율, 공식 특가 배지는 deterministic mock 데이터다.
- 지도는 MapLibre GL 기반(`components/deals-map.tsx`)이며 클러스터링과 지도↔목록 양방향 연동을 지원한다.
