import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { BookmarkButton } from "@/components/bookmark-button";
import { ServiceUnavailableNotice } from "@/components/service-unavailable-notice";
import { resolveOffersResponse } from "@/lib/data-source";
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
  return `${date.getMonth() + 1}/${date.getDate()} ${WEEKDAYS[date.getDay()]}`;
}

function stamp(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default async function OffersPage(props: { searchParams: SearchParams }) {
  const query = parseOffersQuery(await props.searchParams);
  const offersResponse = await resolveOffersResponse(query);
  const offersData = offersResponse.data;
  const serviceUnavailable = isServiceUnavailableDiagnostics(offersResponse.diagnostics);
  if (serviceUnavailable) noStore();
  const airlineSummary = query.airline.length ? `항공사 ${query.airline.length}` : "항공사 전체";
  const cabinSummary = query.cabin === "ALL" ? "전체 좌석" : query.cabin === "ECONOMY" ? "일반석" : "비즈니스석";
  const stopsSummary = query.stops === "ALL" ? "전체 여정" : query.stops === "0" ? "직항" : "1회 경유";
  const offersSummaryLine = serviceUnavailable
    ? "서비스 점검 중입니다"
    : [
        `검색 결과 ${offersData.summary.count}건`,
        `최저 ${formatMoney(offersData.summary.lowest_total)}`,
        `가격 확인: ${stamp(offersResponse.last_batch_at)}`,
      ].join(" · ");

  return (
    <main className={`page-grid offers-page ${offersData.offers.length && !serviceUnavailable ? "has-results" : ""}`}>
      <section className="panel offers-summary-panel">
        <div className="panel-head">
          <div>
            <p className="section-kicker">Flight Offers</p>
            <h1>항공편 가격 비교</h1>
            <p className="panel-note">
              왕복 총액 · 성인 1인 · 유류세/공항세 포함 · 수하물 및 최종 결제 금액은 예약처에서 확인하세요
            </p>
            <p className="offers-summary-inline">{offersSummaryLine}</p>
          </div>
          <Link
            href={href(`/destination/${query.destination || "TYO"}`, {
              origin: query.origin,
              week: query.week,
              stay_bucket: "5_7",
              traveler: query.traveler,
              cabin: query.cabin,
            })}
            className="chip"
          >
            날짜 선택으로 돌아가기
          </Link>
        </div>
      </section>

      {!serviceUnavailable && (
      <details className="panel offers-filter-panel filter-drawer" open={offersData.offers.length === 0}>
        <summary className="filter-drawer-summary">
          <span className="filter-drawer-label">필터</span>
          <span className="filter-drawer-value">
            {airlineSummary} · {cabinSummary} · {stopsSummary}
          </span>
        </summary>
        <div className="filter-drawer-body">
          <div className="controls-grid">
            <div className="field grow">
              <span>항공사</span>
              <div className="chip-row">
                <Link href={href("/offers", { ...query, airline: null })} className={`chip ${query.airline.length === 0 ? "is-active" : ""}`}>
                  전체
                </Link>
                {offersData.filters.available_airlines.map((airline) => (
                  <Link
                    key={airline.code}
                    href={href("/offers", { ...query, airline: airline.code })}
                    className={`chip ${query.airline.includes(airline.code) ? "is-active" : ""}`}
                  >
                    {airline.name}
                  </Link>
                ))}
              </div>
            </div>

            <div className="field grow">
              <span>좌석 등급</span>
              <div className="chip-row">
                <Link href={href("/offers", { ...query, cabin: "ALL" })} className={`chip ${query.cabin === "ALL" ? "is-active" : ""}`}>
                  전체
                </Link>
                <Link href={href("/offers", { ...query, cabin: "ECONOMY" })} className={`chip ${query.cabin === "ECONOMY" ? "is-active" : ""}`}>
                  일반석
                </Link>
                <Link href={href("/offers", { ...query, cabin: "BUSINESS" })} className={`chip ${query.cabin === "BUSINESS" ? "is-active" : ""}`}>
                  비즈니스석
                </Link>
              </div>
            </div>

            <div className="field grow">
              <span>직항/경유</span>
              <div className="chip-row">
                <Link href={href("/offers", { ...query, stops: "ALL" })} className={`chip ${query.stops === "ALL" ? "is-active" : ""}`}>
                  전체
                </Link>
                <Link href={href("/offers", { ...query, stops: "0" })} className={`chip ${query.stops === "0" ? "is-active" : ""}`}>
                  직항
                </Link>
                <Link href={href("/offers", { ...query, stops: "1" })} className={`chip ${query.stops === "1" ? "is-active" : ""}`}>
                  1회 경유
                </Link>
              </div>
            </div>
          </div>
        </div>
      </details>
      )}

      <section className="offers-list">
        {serviceUnavailable ? (
          <ServiceUnavailableNotice diagnostics={offersResponse.diagnostics} />
        ) : offersData.offers.length ? (
          offersData.offers.map((offer) => (
            <article key={offer.offer_id} className="offer-card">
              <div className="offer-head">
                <div>
                  <p className="offer-summary-line">
                    <strong>{offer.airline_name}</strong>
                    <span>{offer.cabin_label_raw || (offer.cabin_group === "ECONOMY" ? "일반석" : "비즈니스석")}</span>
                    <span className="pill">{offer.is_direct ? "직항" : `${offer.stops}회 경유`}</span>
                    <span>총 {offer.duration_hours}시간</span>
                    {offer.official_promotion ? <span className="offer-meta-accent">특가 프로모션</span> : null}
                  </p>
                  <h3>{formatMoney(offer.price_total)}</h3>
                </div>
                <div className="offer-action-stack">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <BookmarkButton
                      deal={{
                        destination_code: offer.destination_code,
                        city: offer.destination_city,
                        country: offer.destination_country,
                        economy_min_total: offer.cabin_group === "ECONOMY" ? offer.price_total : null,
                        business_min_total: offer.cabin_group === "BUSINESS" ? offer.price_total : null,
                      }}
                      origin={offer.origin}
                      week={query.week}
                      stayBucket="5_7"
                    />
                    <a className="cta-link" href={offer.deep_link} target="_blank" rel="noreferrer">
                      예약처에서 가격 확인 →
                    </a>
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    {offer.discount_pct_30 > 10 ? (
                      <span className="discount-tag" style={{ fontSize: "0.72rem", color: "#047857", fontWeight: 700 }}>
                        평균 대비 {offer.discount_pct_30}% 저렴
                      </span>
                    ) : null}
                    <span className="price-status-badge">최근 확인 운임</span>
                  </div>
                </div>
              </div>
              <div className="offer-route-line">
                <div className="route-leg">
                  <span className="route-tag">가는 편</span>
                  <strong>{formatTime(offer.outbound_departure_at)} {offer.origin}</strong>
                  <span className="route-arrow">──────</span>
                  <strong>{formatTime(offer.outbound_arrival_at)} {offer.destination_code}</strong>
                  <span className="panel-note">({formatCompactDate(offer.outbound_departure_at)})</span>
                  {new Date(offer.outbound_arrival_at).getDate() !== new Date(offer.outbound_departure_at).getDate() && (
                    <span className="next-day-badge">+1일</span>
                  )}
                </div>
                <div className="route-leg">
                  <span className="route-tag">오는 편</span>
                  <strong>{formatTime(offer.inbound_departure_at)} {offer.destination_code}</strong>
                  <span className="route-arrow">──────</span>
                  <strong>{formatTime(offer.inbound_arrival_at)} {offer.origin}</strong>
                  <span className="panel-note">({formatCompactDate(offer.inbound_departure_at)})</span>
                  {new Date(offer.inbound_arrival_at).getDate() !== new Date(offer.inbound_departure_at).getDate() && (
                    <span className="next-day-badge">+1일</span>
                  )}
                </div>
              </div>
              <div className="offer-footnote">
                <span>왕복 총액 · 성인 1인 · 유류세/공항세 포함 · 위탁수하물 규정은 항공사 규정 참조</span>
                <span>가격 확인: {stamp(offer.last_seen_at || offer.last_batch_at)}</span>
              </div>
            </article>
          ))
        ) : (
          <div className="empty-state">선택한 조건에 맞는 항공편 옵션이 없습니다.</div>
        )}
      </section>
    </main>
  );
}
