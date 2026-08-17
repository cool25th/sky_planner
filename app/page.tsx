import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { ServiceUnavailableNotice } from "@/components/service-unavailable-notice";
import { HeroPlane } from "@/components/hero-plane";
import { resolveMapResponse } from "@/lib/data-source";
import { getMetaData, parseMapQuery, TRIP_BUCKETS } from "@/lib/mock-market";
import { isServiceUnavailableDiagnostics } from "@/lib/service-unavailable";
import { href } from "@/lib/url";

export const dynamic = "force-dynamic";

function formatMoney(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
}

function stamp(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const THEMES = [
  {
    title: "가벼운 주말 여행",
    desc: "3~4일 일정 · 제주 · 후쿠오카 · 타이베이",
    stayBucket: "3_4",
    region: "ALL",
  },
  {
    title: "알찬 1주일 휴가",
    desc: "5~7일 일정 · 도쿄 · 방콕 · 싱가포르",
    stayBucket: "5_7",
    region: "ALL",
  },
  {
    title: "여유로운 장거리 여행",
    desc: "8~14일 일정 · 런던 · 시드니 · 로스앤젤레스",
    stayBucket: "8_14",
    region: "ALL",
  },
];

const BUDGET_OPTIONS = [
  { value: null, label: "제한없음" },
  { value: 300000, label: "30만 원 이하" },
  { value: 400000, label: "40만 원 이하" },
  { value: 500000, label: "50만 원 이하" },
  { value: 700000, label: "70만 원 이하" },
  { value: 1000000, label: "100만 원 이하" },
];

export default async function HomePage(props: { searchParams: SearchParams }) {
  const meta = getMetaData();
  const initialQuery = parseMapQuery(await props.searchParams);
  const defaultWeek = meta.weeks[0]?.code ?? initialQuery.week;
  const searchState = {
    origin: initialQuery.origin,
    week: initialQuery.week || defaultWeek,
    region: initialQuery.region,
    stay_bucket: initialQuery.stay_bucket === "ALL" ? "5_7" : initialQuery.stay_bucket,
    traveler: "adt1",
    cabin: "ALL" as const,
    budget: initialQuery.budget ?? null,
  };
  const mapResponse = await resolveMapResponse({
    origin: searchState.origin,
    week: searchState.week,
    stay_bucket: searchState.stay_bucket,
    traveler: searchState.traveler,
    region: searchState.region,
    cabin: searchState.cabin,
    airlines: [],
    budget: searchState.budget,
  });
  const serviceUnavailable = isServiceUnavailableDiagnostics(mapResponse.diagnostics);
  if (serviceUnavailable) noStore();
  const internationalDeals = mapResponse.data.deals.filter((deal) => deal.region_code !== "DOMESTIC");
  const featuredDeals = (internationalDeals.length ? internationalDeals : mapResponse.data.deals).slice(0, 3);
  const lowestFare =
    mapResponse.data.deals.length > 0
      ? Math.min(
          ...mapResponse.data.deals.flatMap((deal) =>
            [deal.economy_min_total, deal.business_min_total].filter((value): value is number => typeof value === "number"),
          ),
        )
      : null;
  const mapHref = href("/map", searchState);

  return (
    <main className="landing-shell">
      <section className="travel-shell">
        <div className="travel-topbar">
          <span className="travel-mark">Sky Planner Atlas</span>
          <div className="travel-tabs">
            <Link href="/map" className="travel-tab is-active">특가 지도</Link>
            <Link href="/offers" className="travel-tab">항공편 비교</Link>
            <Link href="/policies" className="travel-tab">가격 안내</Link>
            <Link href="/service-readiness" className="travel-tab">서비스 상태</Link>
          </div>
          <Link href={mapHref} className="travel-signin">
            특가 지도 보기
          </Link>
        </div>

        <div className="travel-hero">
          <p className="travel-kicker">지도 기반 항공권 탐색</p>
          <h1 className="travel-title">어디로 갈지 정하지 않아도 괜찮아요</h1>
          <p className="travel-subtitle">
            출발지, 여행 기간, 예산만 선택하면 갈 수 있는 목적지와 저렴한 날짜 조합을 지도에서 찾아드립니다.
          </p>
          <div className="travel-summary-grid">
            <article className="travel-summary-card">
              <span>가격 확인</span>
              <strong>{stamp(mapResponse.last_batch_at)}</strong>
            </article>
            <article className="travel-summary-card">
              <span>지도 내 최저가</span>
              <strong>{serviceUnavailable ? "점검 중" : formatMoney(lowestFare)}</strong>
            </article>
            <article className="travel-summary-card">
              <span>탐색 가능 도시</span>
              <strong>{serviceUnavailable ? "일시 중단" : `${mapResponse.data.summary.destinations}개 취항지`}</strong>
            </article>
          </div>
        </div>

        <HeroPlane />

        <section className="travel-search">
          <div className="travel-search-head">
            <div>
              <p className="featured-label">빠른 조건 검색</p>
              <h2>출발지와 일정으로 갈 수 있는 도시 찾기</h2>
            </div>
            <div className="travel-search-head-aside">
              <span className="travel-search-caption">왕복 총액 기준 · 성인 1인 · 유류세 및 공항세 포함</span>
              <Link href={mapHref} className="travel-search-inline">
                전체 지도 보기 →
              </Link>
            </div>
          </div>

          {serviceUnavailable ? (
            <ServiceUnavailableNotice diagnostics={mapResponse.diagnostics} />
          ) : (
            <div className="travel-recommendations">
              {featuredDeals.map((deal) => (
                <Link
                  key={deal.destination_code}
                  href={href(`/destination/${deal.destination_code}`, {
                    origin: searchState.origin,
                    week: searchState.week,
                    stay_bucket: searchState.stay_bucket,
                    traveler: searchState.traveler,
                    cabin: "ALL",
                  })}
                  className="travel-recommendation"
                >
                  <strong>{deal.city}</strong>
                  <span>{formatMoney(deal.economy_min_total)}~</span>
                </Link>
              ))}
            </div>
          )}

          <div className="travel-search-board">
            <div className="travel-selector">
              <span>출발 공항</span>
              <div className="travel-selector-row">
                {meta.origins.map((origin) => (
                  <Link
                    key={origin.code}
                    href={href("/", { ...searchState, origin: origin.code, cabin: null, traveler: null })}
                    className={`search-chip ${searchState.origin === origin.code ? "is-active" : ""}`}
                  >
                    {origin.city} ({origin.code})
                  </Link>
                ))}
              </div>
            </div>

            <div className="travel-selector">
              <span>출발 주간</span>
              <div className="travel-selector-row">
                {meta.weeks.slice(0, 4).map((week) => (
                  <Link
                    key={week.code}
                    href={href("/", { ...searchState, week: week.code, cabin: null, traveler: null })}
                    className={`search-chip ${searchState.week === week.code ? "is-active" : ""}`}
                  >
                    {week.code}
                  </Link>
                ))}
              </div>
            </div>

            <div className="travel-selector">
              <span>여행 지역</span>
              <div className="travel-selector-row">
                {meta.regions
                  .filter((region) => ["ALL", "JAPAN", "GREATER_CHINA", "SEA", "EUROPE"].includes(region.code))
                  .map((region) => (
                    <Link
                      key={region.code}
                      href={href("/", { ...searchState, region: region.code, cabin: null, traveler: null })}
                      className={`search-chip ${searchState.region === region.code ? "is-active" : ""}`}
                    >
                      {region.label}
                    </Link>
                  ))}
              </div>
            </div>

            <div className="travel-selector">
              <span>여행 기간</span>
              <div className="travel-selector-row">
                {meta.trip_buckets
                  .filter((bucket) => bucket.code !== "ALL")
                  .map((bucket) => (
                    <Link
                      key={bucket.code}
                      href={href("/", { ...searchState, stay_bucket: bucket.code, cabin: null, traveler: null })}
                      className={`search-chip ${searchState.stay_bucket === bucket.code ? "is-active" : ""}`}
                    >
                      {bucket.label}
                    </Link>
                  ))}
              </div>
            </div>

            <div className="travel-selector">
              <span>최대 예산 (왕복 총액)</span>
              <div className="travel-selector-row">
                {BUDGET_OPTIONS.map((budget) => (
                  <Link
                    key={budget.label}
                    href={href("/", { ...searchState, budget: budget.value, cabin: null, traveler: null })}
                    className={`search-chip ${searchState.budget === budget.value ? "is-active" : ""}`}
                  >
                    {budget.label}
                  </Link>
                ))}
              </div>
            </div>

            <Link
              href={mapHref}
              className="travel-search-action"
              aria-label="갈 수 있는 도시 지도에서 보기"
            >
              <span>갈 수 있는 도시 보기</span>
            </Link>
          </div>

          <div className="travel-search-meta">
            <span>
              기준: 최근 가격 확인 ({stamp(mapResponse.last_batch_at)}) · 왕복 총액 · 성인 1인 · 세금 포함
            </span>
            <span>최종 결제 금액은 예약처에서 확인하세요</span>
          </div>
        </section>
      </section>

      {!serviceUnavailable && (
        <section className="landing-section">
          <div className="landing-section-head">
            <p className="section-kicker">주요 추천 특가</p>
            <h2>지금 가장 저렴한 인기 목적지</h2>
            <p className="panel-note">목적지를 선택하면 가장 저렴한 날짜 조합을 바로 확인할 수 있습니다.</p>
          </div>

          <div className="featured-grid">
            {featuredDeals.map((deal, index) => (
              <article key={deal.destination_code} className={`featured-story ${index > 0 ? "is-secondary" : ""}`}>
                <div className={`featured-story__visual ${index === 0 ? "is-cabin" : index === 1 ? "is-city" : "is-tower"}`} />
                <div className="featured-story__copy">
                  <p className="featured-label">{deal.region_label}</p>
                  <h3>{deal.city}</h3>
                  <p className="aside-copy">
                    {deal.city} ({deal.country}) 최저가 {formatMoney(deal.economy_min_total)}부터
                  </p>
                  <Link
                    href={href(`/destination/${deal.destination_code}`, {
                      origin: searchState.origin,
                      week: searchState.week,
                      stay_bucket: searchState.stay_bucket,
                      traveler: searchState.traveler,
                      cabin: "ALL",
                    })}
                    className="featured-link"
                  >
                    {deal.city} 날짜별 특가 보기 →
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {!serviceUnavailable && (
        <section className="landing-section">
          <div className="landing-section-head">
            <p className="section-kicker">여행 테마별 탐색</p>
            <h2>나에게 맞는 여행 일정 선택</h2>
            <p className="panel-note">일정에 맞는 체류 기간을 선택하고 해당 조건의 목적지를 탐색하세요.</p>
          </div>
          <div className="stay-grid">
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
                className="stay-card is-waterfront"
              >
                <div className="stay-card__body">
                  <strong>{theme.title}</strong>
                  <span>{theme.desc}</span>
                  <span className="stay-card__cta">이 일정으로 지도 보기</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
