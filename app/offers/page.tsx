import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { BookmarkButton } from "@/components/bookmark-button";
import { ServiceUnavailableNotice } from "@/components/service-unavailable-notice";
import { ShareButton } from "@/components/share-button";
import { resolveOffersResponse } from "@/lib/data-source";
import { fareFreshness } from "@/lib/fare-freshness";
import { parseOffersQuery } from "@/lib/mock-market";
import { isServiceUnavailableDiagnostics } from "@/lib/service-unavailable";
import { href } from "@/lib/url";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function formatMoney(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatCompactDate(value: string) {
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()} (${WEEKDAYS[date.getDay()]})`;
}

function stamp(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default async function OffersPage(props: { searchParams: SearchParams }) {
  const rawParams = await props.searchParams;
  const query = parseOffersQuery(rawParams);
  const sortBy = (typeof rawParams?.sort === "string" ? rawParams.sort : "price") as "price" | "duration" | "departure";

  const offersResponse = await resolveOffersResponse(query);
  const offersData = offersResponse.data;
  const serviceUnavailable = isServiceUnavailableDiagnostics(offersResponse.diagnostics);
  if (serviceUnavailable) noStore();

  const sortedOffers = [...offersData.offers].sort((a, b) => {
    if (sortBy === "duration") {
      return a.duration_hours - b.duration_hours || a.price_total - b.price_total;
    }
    if (sortBy === "departure") {
      return new Date(a.outbound_departure_at).getTime() - new Date(b.outbound_departure_at).getTime() || a.price_total - b.price_total;
    }
    return a.price_total - b.price_total;
  });

  const cabinLabel = query.cabin === "BUSINESS" ? "비즈니스석" : query.cabin === "ECONOMY" ? "일반석" : "전체 좌석";
  const dateRangeLabel = query.depart && query.return
    ? `${formatCompactDate(query.depart)} ~ ${formatCompactDate(query.return)}`
    : "일정 선택됨";

  return (
    <main className="offers-page-container">
      {/* 1. Natural Language Search Summary Bar */}
      <section className="offers-summary-banner">
        <div className="summary-banner-main">
          <div>
            <div className="summary-route">
              <strong>{query.origin}</strong>
              <span className="route-arrow">✈</span>
              <strong>{query.destination || "목적지"}</strong>
            </div>
            <p className="summary-conditions">
              {dateRangeLabel} · 성인 1인 · {cabinLabel} · 왕복
            </p>
          </div>
          <div className="summary-banner-actions">
            <ShareButton
              title={`${query.origin} → ${query.destination} 항공편 가격 비교`}
              text={`${query.origin}에서 ${query.destination} 가는 항공편 최저가 비교 결과를 확인해보세요!`}
            />
            <Link
              href={href(`/destination/${query.destination || "TYO"}`, {
                origin: query.origin,
                week: query.week,
                stay_bucket: "5_7",
                traveler: query.traveler,
                cabin: query.cabin,
              })}
              className="change-dates-btn"
            >
              날짜 변경하기 →
            </Link>
          </div>
        </div>
      </section>

      {/* 2. Compact Filter & Sort Bar */}
      {!serviceUnavailable && (
        <section className="offers-filter-bar">
          <div className="filter-chips-wrapper">
            <div className="filter-chips-group">
              <span className="filter-group-label">여정:</span>
              <Link
                href={href("/offers", { ...query, stops: "ALL", sort: sortBy !== "price" ? sortBy : null })}
                className={`filter-chip ${query.stops === "ALL" ? "is-active" : ""}`}
              >
                전체 여정
              </Link>
              <Link
                href={href("/offers", { ...query, stops: "0", sort: sortBy !== "price" ? sortBy : null })}
                className={`filter-chip ${query.stops === "0" ? "is-active" : ""}`}
              >
                직항만
              </Link>
              <Link
                href={href("/offers", { ...query, cabin: "ALL", sort: sortBy !== "price" ? sortBy : null })}
                className={`filter-chip ${query.cabin === "ALL" ? "is-active" : ""}`}
              >
                전체 좌석
              </Link>
              <Link
                href={href("/offers", { ...query, cabin: "ECONOMY", sort: sortBy !== "price" ? sortBy : null })}
                className={`filter-chip ${query.cabin === "ECONOMY" ? "is-active" : ""}`}
              >
                일반석
              </Link>
              <Link
                href={href("/offers", { ...query, cabin: "BUSINESS", sort: sortBy !== "price" ? sortBy : null })}
                className={`filter-chip ${query.cabin === "BUSINESS" ? "is-active" : ""}`}
              >
                비즈니스석
              </Link>
            </div>

            <div className="filter-chips-group">
              <span className="filter-group-label">항공사:</span>
              {[
                { code: "ALL", name: "전체 항공사" },
                { code: "KE", name: "대한항공" },
                { code: "OZ", name: "아시아나" },
                { code: "7C", name: "제주항공" },
                { code: "TW", name: "티웨이" },
                { code: "BX", name: "에어부산" },
              ].map((al) => {
                const isActive = al.code === "ALL" ? query.airline.length === 0 : query.airline.includes(al.code);
                const nextAirline = al.code === "ALL" ? null : al.code;
                return (
                  <Link
                    key={al.code}
                    href={href("/offers", {
                      ...query,
                      airline: nextAirline,
                      sort: sortBy !== "price" ? sortBy : null,
                    })}
                    className={`filter-chip ${isActive ? "is-active" : ""}`}
                  >
                    {al.name}
                  </Link>
                );
              })}
            </div>

            <div className="filter-chips-group">
              <span className="filter-group-label">정렬:</span>
              <Link
                href={href("/offers", { ...query, sort: "price" })}
                className={`filter-chip ${sortBy === "price" ? "is-active" : ""}`}
              >
                최저가순
              </Link>
              <Link
                href={href("/offers", { ...query, sort: "duration" })}
                className={`filter-chip ${sortBy === "duration" ? "is-active" : ""}`}
              >
                최단시간순
              </Link>
              <Link
                href={href("/offers", { ...query, sort: "departure" })}
                className={`filter-chip ${sortBy === "departure" ? "is-active" : ""}`}
              >
                출발빠른순
              </Link>
            </div>
          </div>
          <span className="results-badge">검색 결과 {sortedOffers.length}건</span>
        </section>
      )}

      {/* 3. Modern Timeline Flight Offers List */}
      <section className="offers-card-list">
        {serviceUnavailable ? (
          <ServiceUnavailableNotice diagnostics={offersResponse.diagnostics} />
        ) : sortedOffers.length ? (
          sortedOffers.map((offer) => {
            const freshness = fareFreshness(offer.last_seen_at || offer.last_batch_at);
            const isOutboundNextDay = new Date(offer.outbound_arrival_at).getDate() !== new Date(offer.outbound_departure_at).getDate();
            const isInboundNextDay = new Date(offer.inbound_arrival_at).getDate() !== new Date(offer.inbound_departure_at).getDate();

            return (
              <article key={offer.offer_id} className="flight-offer-card">
                <div className="flight-card-body">
                  {/* Left: Flight Legs Timeline */}
                  <div className="flight-legs-container">
                    {/* Outbound Leg */}
                    <div className="flight-leg-row">
                      <span className="leg-tag">가는 편</span>
                      <div className="leg-timeline">
                        <div className="leg-endpoint">
                          <strong>{formatTime(offer.outbound_departure_at)}</strong>
                          <span>{offer.origin}</span>
                        </div>
                        <div className="leg-duration-bar">
                          <span className="duration-text">{offer.is_direct ? "직항" : `${offer.stops}회 경유`} · {offer.duration_hours}시간</span>
                          <div className="duration-line" />
                        </div>
                        <div className="leg-endpoint">
                          <strong>{formatTime(offer.outbound_arrival_at)}</strong>
                          <span>{offer.destination_code}</span>
                        </div>
                        {isOutboundNextDay && <span className="next-day-pill">+1일</span>}
                      </div>
                    </div>

                    {/* Inbound Leg */}
                    <div className="flight-leg-row">
                      <span className="leg-tag">오는 편</span>
                      <div className="leg-timeline">
                        <div className="leg-endpoint">
                          <strong>{formatTime(offer.inbound_departure_at)}</strong>
                          <span>{offer.destination_code}</span>
                        </div>
                        <div className="leg-duration-bar">
                          <span className="duration-text">{offer.is_direct ? "직항" : `${offer.stops}회 경유`} · {offer.duration_hours}시간</span>
                          <div className="duration-line" />
                        </div>
                        <div className="leg-endpoint">
                          <strong>{formatTime(offer.inbound_arrival_at)}</strong>
                          <span>{offer.origin}</span>
                        </div>
                        {isInboundNextDay && <span className="next-day-pill">+1일</span>}
                      </div>
                    </div>

                    <div className="flight-airline-meta">
                      <strong>{offer.airline_name}</strong>
                      <span>·</span>
                      <span>{offer.cabin_label_raw || (offer.cabin_group === "ECONOMY" ? "일반석" : "비즈니스석")}</span>
                      <span>·</span>
                      <span>위탁수하물 규정은 항공사 기준 확인</span>
                    </div>
                  </div>

                  {/* Right: Fare Box & CTA */}
                  <div className="flight-fare-box">
                    <div className="fare-amount-group">
                      <span className="fare-type-label">왕복 총액 (성인 1인)</span>
                      <strong className="fare-total-amount">{formatMoney(offer.price_total)}</strong>
                      <span className="fare-tax-label">유류세·공항세 포함</span>
                    </div>

                    <div className="fare-cta-group">
                      {freshness.level === "cta_disabled" ? (
                        <span className="flight-cta-btn is-disabled" aria-disabled="true" title="28시간 이상 경과된 운임입니다.">
                          가격 갱신 대기 중
                        </span>
                      ) : (
                        <a className="flight-cta-btn" href={offer.deep_link} target="_blank" rel="noreferrer">
                          예약처에서 가격 확인 →
                        </a>
                      )}
                      <span className="freshness-status-text">
                        {freshness.level === "fresh" ? "최근 확인 운임" : `업데이트 지연 (${Math.floor(freshness.ageHours)}h 전)`}
                      </span>
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <div className="empty-state">선택한 조건에 맞는 항공편 옵션이 없습니다.</div>
        )}
      </section>
    </main>
  );
}
