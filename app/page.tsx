import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { BookmarkButton } from "@/components/bookmark-button";
import { RecentSearches } from "@/components/recent-searches";
import { RecentDestinations } from "@/components/recent-destinations";
import { ServiceUnavailableNotice } from "@/components/service-unavailable-notice";
import { dataModeLabel, resolveMapResponse } from "@/lib/data-source";
import { formatMoney, stamp } from "@/lib/format";
import { getMetaData, parseMapQuery, formatWeekNatural } from "@/lib/mock-market";
import { isServiceUnavailableDiagnostics } from "@/lib/service-unavailable";
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
  const featuredDeals = (internationalDeals.length ? internationalDeals : mapResponse.data.deals).slice(0, 4);
  const mapHref = href("/map", searchState);

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

      {/* 2. Featured Deals Section (지금 확인할 수 있는 특가) */}
      <section className="home-section">
        <div className="section-header">
          <div>
            <h2 className="section-title">지금 확인할 수 있는 특가</h2>
            <p className="section-desc">최근 확인된 주요 취항지 최저가 운임입니다. 목적지를 선택하면 날짜별 조합을 비교할 수 있습니다.</p>
          </div>
          <Link href={mapHref} className="section-link">
            지도에서 전체 보기 →
          </Link>
        </div>

        {serviceUnavailable ? (
          <ServiceUnavailableNotice diagnostics={mapResponse.diagnostics} />
        ) : (
          <div className="deals-grid">
            {featuredDeals.map((deal) => (
              <article key={deal.destination_code} className="deal-card">
                <div className="deal-card__body">
                  <div className="deal-card__top">
                    <div>
                      <span className="deal-card__region">{deal.region_label}</span>
                      <h3 className="deal-card__city">{deal.city}</h3>
                      <p className="deal-card__country">{deal.country}</p>
                    </div>
                    <BookmarkButton
                      deal={deal}
                      origin={searchState.origin}
                      week={searchState.week}
                      stayBucket={searchState.stay_bucket}
                    />
                  </div>

                  <div className="deal-card__fare-box">
                    <span className="fare-label">왕복 총액 (성인 1인)</span>
                    <strong className="fare-amount">{formatMoney(deal.economy_min_total)}</strong>
                    <span className="fare-meta">세금·유류세 포함</span>
                  </div>

                  <Link
                    href={href(`/destination/${deal.destination_code}`, {
                      origin: searchState.origin,
                      week: searchState.week,
                      stay_bucket: searchState.stay_bucket,
                      traveler: searchState.traveler,
                      cabin: "ALL",
                    })}
                    className="deal-card__cta"
                  >
                    날짜별 특가 보기 →
                  </Link>
                </div>
              </article>
            ))}
          </div>
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
