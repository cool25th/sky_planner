import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { ServiceUnavailableNotice } from "@/components/service-unavailable-notice";
import { HeroPlane } from "@/components/hero-plane";
import { resolveMapResponse } from "@/lib/data-source";
import { getMetaData, parseMapQuery } from "@/lib/mock-market";
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

const AIRLINE_TONES = ["is-morning", "is-glacier", "is-cloud", "is-harbor"] as const;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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
  };
  const mapResponse = await resolveMapResponse({
    origin: searchState.origin,
    week: searchState.week,
    stay_bucket: searchState.stay_bucket,
    traveler: searchState.traveler,
    region: searchState.region,
    cabin: searchState.cabin,
    airlines: [],
  });
  const serviceUnavailable = isServiceUnavailableDiagnostics(mapResponse.diagnostics);
  if (serviceUnavailable) noStore();
  const internationalDeals = mapResponse.data.deals.filter((deal) => deal.region_code !== "DOMESTIC");
  const featuredDeals = (internationalDeals.length ? internationalDeals : mapResponse.data.deals).slice(0, 3);
  const featuredDeal = featuredDeals[0];
  const secondaryDeals = featuredDeals.slice(1, 3);
  const popularAirlines = mapResponse.data.available_airlines.slice(0, 4);
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
          <span className="travel-mark">Sky planner.</span>
          <div className="travel-tabs">
            <Link href="/fare-board" className="travel-tab is-active">Fare Board</Link>
            <span className="travel-tab">Flights</span>
            <span className="travel-tab">Calendar</span>
            <span className="travel-tab">Airlines</span>
            <span className="travel-tab">Routes</span>
          </div>
          <Link href={mapHref} className="travel-signin">
            Open Atlas
          </Link>
        </div>

        <div className="travel-hero">
          <p className="travel-kicker">Ready take-off</p>
          <h1 className="travel-title">Convenient online flight deal services</h1>
          <p className="travel-subtitle">
            한국 출발 특가를 정리된 예약 데스크처럼 탐색합니다. 마지막 배치 시각을 보고, 목적지와 날짜 조합을 바로 좁힌 뒤 예약처로 이동할 수 있습니다.
          </p>
          <div className="travel-summary-grid">
            <article className="travel-summary-card">
              <span>Last batch</span>
              <strong>{stamp(mapResponse.last_batch_at)}</strong>
            </article>
            <article className="travel-summary-card">
              <span>Lowest fare</span>
              <strong>{serviceUnavailable ? "점검 중" : formatMoney(lowestFare)}</strong>
            </article>
            <article className="travel-summary-card">
              <span>Destinations</span>
              <strong>{serviceUnavailable ? "일시 중단" : `${mapResponse.data.summary.destinations} routes`}</strong>
            </article>
          </div>
        </div>

        <HeroPlane />

        <section className="travel-search">
          <div className="travel-search-head">
            <div>
              <p className="featured-label">Quick Search</p>
              <h2>추천 최저가와 주요 도시로 바로 시작</h2>
            </div>
            <div className="travel-search-head-aside">
              <span className="travel-search-caption">입력 수를 줄이고 바로 Fare Board로 이동합니다.</span>
              <Link
                href={href("/map", {
                  origin: searchState.origin,
                  week: searchState.week,
                  region: searchState.region,
                  stay_bucket: searchState.stay_bucket,
                  traveler: searchState.traveler,
                  cabin: "ALL",
                })}
                className="travel-search-inline"
              >
                Explore Map
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
                  <span>{formatMoney(deal.economy_min_total)}</span>
                </Link>
              ))}
            </div>
          )}
          <div className="travel-search-board">
            <div className="travel-selector">
              <span>출발지</span>
              <div className="travel-selector-row">
                {meta.origins.map((origin) => (
                  <Link
                    key={origin.code}
                    href={href("/", { ...searchState, origin: origin.code, cabin: null, traveler: null })}
                    className={`search-chip ${searchState.origin === origin.code ? "is-active" : ""}`}
                  >
                    {origin.code}
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
              <span>지역</span>
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
              <span>체류 버킷</span>
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
            <Link
              href={href("/map", {
                origin: searchState.origin,
                week: searchState.week,
                region: searchState.region,
                stay_bucket: searchState.stay_bucket,
                traveler: searchState.traveler,
                cabin: "ALL",
              })}
              className="travel-search-action"
              aria-label="지도 탐색 시작"
            >
              <span>View Map</span>
            </Link>
          </div>
          <div className="travel-search-meta">
            <span>
              활성 소스: {serviceUnavailable ? "점검 중" : mapResponse.source_flags.map((source) => source.replaceAll("_", " ")).join(" · ")}
            </span>
            <span>세금 포함 총액 기준 · 성인 1인</span>
          </div>
        </section>
      </section>

      <section className="landing-copy-block">
        <div className="landing-copy-intro">
          <p className="section-kicker">Operating Model</p>
          <h2>일 1회 배치 구조를 중심으로 실제 예약 판단에 필요한 흐름만 남겼습니다</h2>
          <p className="aside-copy">
            첫 화면에서는 빠른 선택만 하고, 실제 세부 비교는 지도와 날짜 매트릭스로 내려갑니다. 홈은 길게 설명하는 랜딩이 아니라 바로 탐색을 시작하는 입구 역할에 집중합니다.
          </p>
        </div>
      </section>

      {!serviceUnavailable && (
        <section className="landing-section">
          <div className="landing-section-head">
            <p className="section-kicker">Top Flight Deals</p>
            <h2>배치 결과에서 바로 읽히는 대표 목적지</h2>
            <p className="panel-note">카드 모자이크 대신 넓은 히어로 타일과 두 개의 보조 타일로 목적지 선택을 먼저 유도합니다.</p>
          </div>

          <div className="featured-grid">
            <article className="featured-story">
              <div className="featured-story__visual is-cabin" />
              <div className="featured-story__copy">
                <p className="featured-label">{featuredDeal?.region_label ?? "JAPAN"}</p>
                <h3>{featuredDeal?.city ?? "Tokyo"}</h3>
                <p className="aside-copy">
                  {featuredDeal ? `${featuredDeal.city} 대표가는 ${formatMoney(featuredDeal.economy_min_total)}부터 시작합니다.` : "지도와 날짜 매트릭스로 바로 이어지는 대표 특가입니다."}
                </p>
                <Link
                  href={href("/map", {
                    origin: searchState.origin,
                    week: searchState.week,
                    stay_bucket: searchState.stay_bucket,
                    traveler: searchState.traveler,
                    region: featuredDeal?.region_code ?? "ALL",
                    cabin: "ALL",
                  })}
                  className="featured-link"
                >
                  Explore Fare Board
                </Link>
              </div>
            </article>

            {secondaryDeals.map((deal, index) => (
              <Link
                key={deal.destination_code}
                href={href(`/destination/${deal.destination_code}`, {
                  origin: searchState.origin,
                  week: searchState.week,
                  stay_bucket: searchState.stay_bucket,
                  traveler: searchState.traveler,
                  cabin: "ALL",
                })}
                className={`destination-card ${index === 0 ? "is-city" : "is-tower"}`}
              >
                <div className="destination-card__art" />
                <div className="destination-card__footer">
                  <div>
                    <strong>{deal.city}</strong>
                    <span>{formatMoney(deal.economy_min_total)}</span>
                  </div>
                  <span className="destination-card__arrow">↗</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!serviceUnavailable && (
        <section className="landing-section">
          <div className="landing-section-head">
            <p className="section-kicker">Most Popular Airlines</p>
            <h2>현재 배치 범위에서 자주 노출되는 항공사</h2>
            <p className="panel-note">실제 사진 대신 밝은 그라데이션과 넓은 비율로 항공사 카드 리듬만 가져왔습니다.</p>
          </div>
          <div className="airline-strip">
            {popularAirlines.map((airline, index) => (
              <article key={airline.code} className={`airline-card ${AIRLINE_TONES[index % AIRLINE_TONES.length]}`}>
                <div className="airline-card__image" />
                <div className="airline-card__label">
                  <strong>{airline.name}</strong>
                  <span>{airline.code}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {!serviceUnavailable && (
        <section className="landing-section">
          <div className="landing-section-head">
            <p className="section-kicker">Plan Your Stay</p>
            <h2>특가 탐색 이후 바로 이어지는 체류 패턴</h2>
            <p className="panel-note">원본 레퍼런스의 하단 카드 리듬은 유지하되, 우리 서비스 문맥에 맞게 체류 버킷과 예약 흐름으로 바꿨습니다.</p>
          </div>
          <div className="stay-grid">
            <article className="stay-card is-waterfront">
              <div className="stay-card__image" />
              <div className="stay-card__body">
                <strong>Short City Break</strong>
                <span>3-4일 · 도쿄 · 후쿠오카 · 타이베이</span>
              </div>
            </article>
            <article className="stay-card is-villa is-featured">
              <div className="stay-card__image" />
              <div className="stay-card__body">
                <strong>Balanced Fare Window</strong>
                <span>가장 많이 쓰는 5-7일 체류 버킷</span>
                <Link href={mapHref} className="stay-card__cta">
                  Open Map
                </Link>
              </div>
            </article>
            <article className="stay-card is-coast">
              <div className="stay-card__image" />
              <div className="stay-card__body">
                <strong>Long-Haul Comfort</strong>
                <span>8-14일 · 시드니 · 런던 · 로스앤젤레스</span>
              </div>
            </article>
          </div>
        </section>
      )}
    </main>
  );
}
