import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { AudienceCuration } from "@/components/audience-curation";
import { PriceAlertStatus } from "@/components/price-alert-status";
import { RecentDestinations } from "@/components/recent-destinations";
import { RecentSearches } from "@/components/recent-searches";
import { ServiceUnavailableNotice } from "@/components/service-unavailable-notice";
import { TripCard } from "@/components/trip-card";
import { seasonForWeekCode } from "@/lib/audience-calendar";
import { dataModeLabel } from "@/lib/data-source";
import { stamp } from "@/lib/format";
import { resolveMapResponseWithBookableWeek } from "@/lib/map-week-fallback";
import { formatWeekNatural, getMetaData, parseMapQuery } from "@/lib/mock-market";
import { curateFeaturedDeals } from "@/lib/recommendation";
import { isServiceUnavailableDiagnostics } from "@/lib/service-unavailable";
import { selectLowestPriceDeals, toTripCardModel } from "@/lib/trip-card";
import { href } from "@/lib/url";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const THEMES = [
  {
    icon: "🏖️",
    title: "연차 1일 주말치기",
    desc: "3~4일 일정 · 후쿠오카, 타이베이, 제주",
    stayBucket: "3_4",
    region: "ALL",
  },
  {
    icon: "✈️",
    title: "알찬 1주일 휴가",
    desc: "5~7일 일정 · 도쿄, 방콕, 다낭",
    stayBucket: "5_7",
    region: "ALL",
  },
  {
    icon: "🍣",
    title: "일본 특가 탐색",
    desc: "도쿄, 오사카, 후쿠오카, 삿포로",
    stayBucket: "3_4",
    region: "JAPAN",
  },
  {
    icon: "🌴",
    title: "따뜻한 동남아 휴양지",
    desc: "방콕, 다낭, 세부, 발리",
    stayBucket: "5_7",
    region: "SEA",
  },
];

const BUDGET_OPTIONS = [
  { value: null, label: "예산 전체" },
  { value: 200000, label: "20만 원 이하" },
  { value: 300000, label: "30만 원 이하" },
  { value: 400000, label: "40만 원 이하" },
  { value: 500000, label: "50만 원 이하" },
  { value: 1000000, label: "100만 원 이하" },
];

export default async function HomePage(props: { searchParams: SearchParams }) {
  const meta = getMetaData();
  const searchParams = await props.searchParams;
  const initialQuery = parseMapQuery(searchParams);
  const baseQuery = {
    origin: initialQuery.origin,
    week: initialQuery.week || (meta.weeks[0]?.code ?? initialQuery.week),
    region: initialQuery.region,
    stay_bucket: initialQuery.stay_bucket === "ALL" ? "5_7" : initialQuery.stay_bucket,
    traveler: "adt1" as const,
    cabin: "ALL" as const,
    airlines: [] as string[],
    budget: initialQuery.budget ?? null,
  };

  // UX-20260830-003: 기본 주간(미지정) 특가가 소진되면 다음 주 실데이터로 자동 진행한다.
  const { response: mapResponse, week: resolvedWeek, weekAdvancedFrom } = await resolveMapResponseWithBookableWeek(
    baseQuery,
    { explicitWeek: Boolean(searchParams.week), nextWeek: meta.weeks[1]?.code ?? null },
  );
  const searchState = {
    origin: baseQuery.origin,
    week: resolvedWeek,
    region: baseQuery.region,
    stay_bucket: baseQuery.stay_bucket,
    traveler: baseQuery.traveler,
    cabin: baseQuery.cabin,
    budget: baseQuery.budget,
  };

  const serviceUnavailable = isServiceUnavailableDiagnostics(mapResponse.diagnostics);
  if (serviceUnavailable) noStore();

  const internationalDeals = mapResponse.data.deals.filter((deal) => deal.region_code !== "DOMESTIC");
  // RECO-20260828-002: 노출 순서를 규칙 점수(가격 메리트·시기 근접성·주말 포함)로 큐레이션하고 근거를 칩으로 보여준다.
  // UX-20260830-002: 후보는 12개를 뽑아 클라이언트 연령대 칩(전체=상위 4)이 재정렬한다.
  const curatedDeals = curateFeaturedDeals(
    internationalDeals.length ? internationalDeals : mapResponse.data.deals,
    new Date().toISOString().slice(0, 10),
    12,
  );
  const audienceEntries = curatedDeals.map(({ deal, reasons }) => ({
    destination_code: deal.destination_code,
    model: toTripCardModel(deal, searchState, reasons),
  }));
  const mapHref = href("/map", searchState);
  // P0-commerce 2단계: 최저가 스트립 — 그리드(큐레이션순)와 달리 순수 가격 오름차순. 국내선 포함(리전 라벨로 구분).
  const stripDeals = selectLowestPriceDeals(mapResponse.data.deals, 8);

  return (
    <main className="home-container">
      {/* 1. Search-First Hero Section */}
      <section className="home-hero">
        <div className="home-hero__content">
          <h1 className="home-hero__title">어디로 갈지 정하지 않아도 괜찮아요</h1>
          <p className="home-hero__subtitle">
            예산과 일정에 맞는 왕복 목적지와 가장 저렴한 날짜를 지도에서 찾아드립니다.
          </p>

          {/* 통합 캡슐 검색 바 */}
          <div className="search-capsule-wrapper">
            <form action="/map" method="GET" className="search-capsule">
              <div className="capsule-field">
                <label htmlFor="origin-select" className="capsule-label">출발지</label>
                <select id="origin-select" name="origin" defaultValue={searchState.origin} className="capsule-select">
                  {meta.origins.map((origin) => (
                    <option key={origin.code} value={origin.code}>
                      {origin.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="capsule-divider" />

              <div className="capsule-field">
                <label htmlFor="week-select" className="capsule-label">여행 시기</label>
                <select id="week-select" name="week" defaultValue={searchState.week} className="capsule-select">
                  {meta.weeks.map((week) => (
                    <option key={week.code} value={week.code}>
                      {formatWeekNatural(week.code)} ({week.label})
                    </option>
                  ))}
                </select>
              </div>

              <div className="capsule-divider" />

              <div className="capsule-field">
                <label htmlFor="stay-select" className="capsule-label">여행 기간</label>
                <select id="stay-select" name="stay_bucket" defaultValue={searchState.stay_bucket} className="capsule-select">
                  {meta.trip_buckets
                    .filter((bucket) => bucket.code !== "ALL")
                    .map((bucket) => (
                      <option key={bucket.code} value={bucket.code}>
                        {bucket.label}
                      </option>
                    ))}
                </select>
              </div>

              <div className="capsule-divider" />

              <div className="capsule-field">
                <label htmlFor="budget-select" className="capsule-label">최대 예산</label>
                <select id="budget-select" name="budget" defaultValue={searchState.budget ?? ""} className="capsule-select">
                  {BUDGET_OPTIONS.map((opt) => (
                    <option key={opt.label} value={opt.value ?? ""}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <button type="submit" className="capsule-submit-btn" aria-label="갈 수 있는 도시 지도에서 보기">
                <span>도시 보기</span>
                <span className="btn-arrow">→</span>
              </button>
            </form>

            {/* 빠른 추천 테마 칩 */}
            <div className="quick-tags-row">
              <span className="quick-tag-title">추천 조건:</span>
              <Link href={href("/map", { ...searchState, stay_bucket: "3_4" })} className="quick-tag">
                🏖️ 주말/연차 1일 (3~4일)
              </Link>
              <Link href={href("/map", { ...searchState, region: "JAPAN" })} className="quick-tag">
                🍣 일본 특가
              </Link>
              <Link href={href("/map", { ...searchState, region: "SEA" })} className="quick-tag">
                🌴 동남아 휴양지
              </Link>
              <Link href={href("/map", { ...searchState, stay_bucket: "5_7" })} className="quick-tag">
                ✈️ 알찬 1주일
              </Link>
            </div>

            {/* 최근 검색 조건 */}
            <RecentSearches />
            <RecentDestinations />
          </div>
        </div>
      </section>

      {/* UX-20260830-003: 기본 주간 특가 소진으로 다음 주를 보여주는 중이라는 안내 */}
      {weekAdvancedFrom && (
        <div className="beta-banner">
          <span>
            <strong>시기 자동 이동:</strong> {formatWeekNatural(weekAdvancedFrom)}에는 예약 가능한 특가가 마감되어{" "}
            {formatWeekNatural(resolvedWeek)} 특가를 보여드려요.
          </span>
        </div>
      )}

      {/* UX-20260831-006 MVP: 저장된 가격 알림의 재방문 시점 도달 확인(클라이언트 비교 — 발송은 A3) */}
      <PriceAlertStatus />

      {/* 1.5 최저가 스트립 (P0-commerce: 조건을 고르기 전에 가격을 먼저 보여준다) */}
      {stripDeals.length > 0 && (
        <section className="home-section trip-strip-section">
          <div className="section-header">
            <div>
              <h2 className="section-title">지금 이 조건의 최저가</h2>
              <p className="section-desc">선택한 조건에서 방금 확인된 가장 낮은 왕복 운임부터 순서대로 보여드립니다.</p>
            </div>
            <Link href={mapHref} className="section-link">
              지도에서 전체 보기 →
            </Link>
          </div>
          <ul className="trip-strip">
            {stripDeals.map((deal) => (
              <li key={deal.destination_code}>
                <TripCard
                  variant="strip"
                  model={toTripCardModel(deal, searchState)}
                  origin={searchState.origin}
                  week={searchState.week}
                  stayBucket={searchState.stay_bucket}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 2. Featured Deals Section (지금 확인할 수 있는 특가) */}
      <section className="home-section">
        <div className="section-header">
          <div>
            <h2 className="section-title">지금 확인할 수 있는 특가</h2>
            <p className="section-desc">최근 확인된 주요 취항지 최저가 운임입니다. 연령대 추천으로 순서를 바꿔보세요. 목적지를 선택하면 날짜별 조합을 비교할 수 있습니다.</p>
          </div>
          <Link href={mapHref} className="section-link">
            지도에서 전체 보기 →
          </Link>
        </div>

        {serviceUnavailable ? (
          <ServiceUnavailableNotice diagnostics={mapResponse.diagnostics} />
        ) : curatedDeals.length === 0 ? (
          <div className="map-empty-state">
            <p>선택한 시기에 예약 가능한 특가가 없습니다.</p>
            <span className="panel-note">주 후반에는 이번 주 출발 일정이 마감될 수 있어요.</span>
            <div style={{ marginTop: "12px" }}>
              <Link
                href={href("/map", { ...searchState, week: meta.weeks[1]?.code ?? searchState.week })}
                className="cta-btn--secondary"
              >
                다음 주간으로 검색
              </Link>
            </div>
          </div>
        ) : (
          <AudienceCuration
            entries={audienceEntries}
            season={seasonForWeekCode(searchState.week)}
            origin={searchState.origin}
            week={searchState.week}
            stayBucket={searchState.stay_bucket}
          />
        )}
        <div className="section-caption">
          <span>가격 확인: {stamp(mapResponse.last_batch_at)} · {dataModeLabel(mapResponse.diagnostics)} · 일 1회 배치 기준 참고 운임이며 최종 가격은 예약처에서 확인해야 합니다.</span>
        </div>
      </section>

      {/* 3. Explore by Themes Section (일정 및 테마별 탐색) */}
      <section className="home-section">
        <div className="section-header">
          <div>
            <h2 className="section-title">일정으로 탐색</h2>
            <p className="section-desc">휴가 일정이나 여행 테마에 맞춰 갈 수 있는 목적지를 한눈에 확인하세요.</p>
          </div>
        </div>

        <div className="themes-grid">
          {THEMES.map((theme) => (
            <Link
              key={theme.title}
              href={href("/map", {
                origin: searchState.origin,
                week: searchState.week,
                stay_bucket: theme.stayBucket,
                traveler: searchState.traveler,
                region: theme.region,
                cabin: "ALL",
              })}
              className="theme-card"
            >
              <span className="theme-card__icon">{theme.icon}</span>
              <div className="theme-card__info">
                <strong className="theme-card__title">{theme.title}</strong>
                <p className="theme-card__desc">{theme.desc}</p>
              </div>
              <span className="theme-card__arrow">→</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
