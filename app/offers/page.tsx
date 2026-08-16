import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

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
  const cabinSummary = query.cabin === "ALL" ? "전체 캐빈" : query.cabin === "ECONOMY" ? "이코노미" : "비즈니스";
  const stopsSummary = query.stops === "ALL" ? "전체 여정" : query.stops === "0" ? "직항" : "1회 경유";
  const offersSummaryLine = serviceUnavailable
    ? "운영 데이터 일시 중단 · mock fallback 차단"
    : [
        `${offersData.summary.count}건`,
        `최저 ${formatMoney(offersData.summary.lowest_total)}`,
        `배치 ${stamp(offersResponse.last_batch_at)}`,
      ].join(" · ");

  return (
    <main className={`page-grid offers-page ${offersData.offers.length && !serviceUnavailable ? "has-results" : ""}`}>
      <section className="panel offers-summary-panel">
        <div className="panel-head">
          <div>
            <p className="section-kicker">Offers</p>
            <h1>실제 항공편 옵션</h1>
            <p className="panel-note">
              마지막 업데이트: {stamp(offersResponse.last_batch_at)} · 일 1회 갱신 · 실제 예약가는 항공사에서 확인하세요
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
            날짜 매트릭스로 돌아가기
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
              <span>캐빈</span>
              <div className="chip-row">
                <Link href={href("/offers", { ...query, cabin: "ALL" })} className={`chip ${query.cabin === "ALL" ? "is-active" : ""}`}>
                  전체
                </Link>
                <Link href={href("/offers", { ...query, cabin: "ECONOMY" })} className={`chip ${query.cabin === "ECONOMY" ? "is-active" : ""}`}>
                  이코노미
                </Link>
                <Link href={href("/offers", { ...query, cabin: "BUSINESS" })} className={`chip ${query.cabin === "BUSINESS" ? "is-active" : ""}`}>
                  비즈니스
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
                    <span>{offer.airline_name}</span>
                    <span>{offer.cabin_label_raw}</span>
                  </p>
                  <h3>{formatMoney(offer.price_total)}</h3>
                </div>
                <a className="cta-link" href={offer.deep_link} target="_blank" rel="noreferrer">
                  예약
                </a>
              </div>
              <div className="offer-meta-line">
                <span>{offer.source_name}</span>
                <span>{offer.is_direct ? "직항" : `${offer.stops}회 경유`}</span>
                <span>{offer.duration_hours}시간</span>
                <span>{offer.fare_family}</span>
                {offer.official_promotion ? <span className="offer-meta-accent">프로모션</span> : null}
              </div>
              <div className="offer-route-line">
                <span>출 {formatTime(offer.outbound_departure_at)}→{formatTime(offer.outbound_arrival_at)} {formatCompactDate(offer.outbound_departure_at)}</span>
                <span>복 {formatTime(offer.inbound_departure_at)}→{formatTime(offer.inbound_arrival_at)} {formatCompactDate(offer.inbound_departure_at)}</span>
              </div>
              <div className="offer-footnote">마지막 배치 {stamp(offer.last_batch_at)} · 실제 예약가는 항공사에서 다시 확인하세요</div>
            </article>
          ))
        ) : (
          <div className="empty-state">선택한 조건에 맞는 항공편 옵션이 없습니다.</div>
        )}
      </section>
    </main>
  );
}
