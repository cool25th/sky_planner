import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { ServiceUnavailableNotice } from "@/components/service-unavailable-notice";
import { MatrixKeyboardNavigator } from "@/components/matrix-keyboard-navigator";
import { ShareButton } from "@/components/share-button";
import { resolveCalendarResponse, resolveMapResponse } from "@/lib/data-source";
import { TRIP_BUCKETS, parseCalendarQuery, parseMapQuery } from "@/lib/mock-market";
import { isServiceUnavailableDiagnostics } from "@/lib/service-unavailable";
import { href } from "@/lib/url";

export const dynamic = "force-dynamic";

type Params = Promise<{ placeId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatMoney(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", weekday: "short" }).format(new Date(value));
}

function stamp(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default async function DestinationPage(props: { params: Params; searchParams: SearchParams }) {
  const { placeId } = await props.params;
  const searchParams = await props.searchParams;
  const query = parseCalendarQuery({ ...searchParams, destination: placeId });
  const [calendarResponse, mapResponse] = await Promise.all([
    resolveCalendarResponse(query),
    resolveMapResponse(parseMapQuery(searchParams)),
  ]);
  const calendar = calendarResponse.data;
  const mapSummary = mapResponse.data;
  const serviceUnavailable =
    isServiceUnavailableDiagnostics(calendarResponse.diagnostics) ||
    isServiceUnavailableDiagnostics(mapResponse.diagnostics);
  if (serviceUnavailable) noStore();
  const unavailableDiagnostics = isServiceUnavailableDiagnostics(calendarResponse.diagnostics)
    ? calendarResponse.diagnostics
    : mapResponse.diagnostics;
  const spotlight = mapSummary.deals.find((deal) => deal.destination_code === placeId);

  // Top 3 저렴한 추천 날짜 조합 추출
  const validCells = calendar.cells.filter(
    (cell) => (query.cabin === "BUSINESS" ? cell.business_min_total : cell.economy_min_total) !== null,
  );
  const sortedCells = [...validCells].sort((a, b) => {
    const aPrice = (query.cabin === "BUSINESS" ? a.business_min_total : a.economy_min_total) ?? Infinity;
    const bPrice = (query.cabin === "BUSINESS" ? b.business_min_total : b.economy_min_total) ?? Infinity;
    return aPrice - bPrice;
  });
  const topRecommendations = sortedCells.slice(0, 3);
  const lowestCellPrice = topRecommendations[0]
    ? (query.cabin === "BUSINESS" ? topRecommendations[0].business_min_total : topRecommendations[0].economy_min_total)
    : null;

  return (
    <main className="page-grid">
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="section-kicker">날짜 선택 · {calendar.destination?.region_label}</p>
            <h1>{calendar.destination ? `${calendar.destination.city} 특가 날짜 조합` : "목적지를 찾을 수 없습니다"}</h1>
            <p className="panel-note">
              {query.origin} 출발 · {query.week} · 여행 기간 {TRIP_BUCKETS.find((item) => item.code === query.stay_bucket)?.label} · 왕복 총액 기준 (성인 1인 · 세금 포함)
            </p>
          </div>
          <Link
            href={href("/map", {
              origin: query.origin,
              week: query.week,
              region: "ALL",
              cabin: query.cabin,
              stay_bucket: query.stay_bucket,
              traveler: query.traveler,
              airlines: query.airlines.join(",") || null,
            })}
            className="chip"
          >
            ← 특가 지도로 돌아가기
          </Link>
        </div>
      </section>

      {serviceUnavailable ? (
        <ServiceUnavailableNotice diagnostics={unavailableDiagnostics} />
      ) : calendar.destination ? (
        <>
          {/* Top 3 추천 날짜 조합 섹션 */}
          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="section-kicker">Best Deals</p>
                <h2>가장 저렴한 추천 날짜 조합 Top 3</h2>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span className="selection-pill">
                  최저 {formatMoney(lowestCellPrice)}부터 · 가격 확인 {stamp(calendarResponse.last_batch_at)}
                </span>
                <ShareButton
                  title={`${calendar.destination.city} 항공 특가 날짜 조합`}
                  text={`${calendar.destination.city} 최저가 ${formatMoney(lowestCellPrice)}부터 시작하는 날짜별 특가를 확인해보세요!`}
                />
              </div>
            </div>

            {topRecommendations.length > 0 ? (
              <div className="top-dates-grid">
                {topRecommendations.map((cell, idx) => {
                  const fare = query.cabin === "BUSINESS" ? cell.business_min_total : cell.economy_min_total;
                  return (
                    <article key={`${cell.depart_date}-${cell.return_date}`} className={`top-date-card ${idx === 0 ? "is-best" : ""}`}>
                      <div className="top-date-card__badge">
                        {idx === 0 ? "⭐ 최저가 추천" : `추천 ${idx + 1}위`}
                      </div>
                      <div className="top-date-card__schedule">
                        <div className="schedule-dates">
                          <strong>{formatDate(String(cell.depart_date))}</strong>
                          <span className="schedule-arrow">→</span>
                          <strong>{formatDate(String(cell.return_date))}</strong>
                        </div>
                        <span className="schedule-nights">
                          {String(cell.stay_nights)}박 {Number(cell.stay_nights) + 1}일 일정
                        </span>
                      </div>
                      <div className="top-date-card__price">
                        <span className="price-type">{query.cabin === "BUSINESS" ? "비즈니스석 왕복" : "일반석 왕복"}</span>
                        <strong className="price-amount">{formatMoney(fare)}</strong>
                        <span className="price-meta">세금 포함 · 성인 1인</span>
                      </div>
                      <Link
                        href={href("/offers", {
                          origin: query.origin,
                          week: query.week,
                          destination: placeId,
                          depart: String(cell.depart_date),
                          return: String(cell.return_date),
                          cabin: query.cabin,
                          traveler: query.traveler,
                        })}
                        className="top-date-card__cta"
                      >
                        이 일정으로 항공편 비교 →
                      </Link>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="panel-note">현재 선택한 조건에 맞는 날짜 조합이 없습니다.</p>
            )}
          </section>

          {/* 전체 날짜 매트릭스 (상세 비교) */}
          <details className="panel" open>
            <summary className="panel-head" style={{ cursor: "pointer" }}>
              <div>
                <p className="section-kicker">Full Matrix</p>
                <h2>전체 출발·귀국일 가격 매트릭스</h2>
                <p className="panel-note">출발일(세로)과 귀국일(가로)의 모든 조합별 최저가를 한눈에 비교합니다.</p>
              </div>
            </summary>

            <section className="calendar-layout" style={{ marginTop: "16px" }}>
              <MatrixKeyboardNavigator>
                <div className="matrix-scroll">
                  <table className="matrix-table" aria-label="출발일과 귀국일 조합별 최저가 비교 표">
                    <thead>
                      <tr>
                        <th>
                          <div className="matrix-label">
                            <strong>출발일</strong>
                            <span>귀국일 기준</span>
                          </div>
                        </th>
                        {calendar.return_dates.map((date) => (
                          <th key={date} scope="col">
                            <div className="matrix-label">
                              <strong>{formatDate(date)}</strong>
                              <span>귀국</span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {calendar.departure_dates.map((departDate) => (
                        <tr key={departDate}>
                          <th scope="row">
                            <div className="matrix-label">
                              <strong>{formatDate(departDate)}</strong>
                              <span>출발</span>
                            </div>
                          </th>
                          {calendar.return_dates.map((returnDate) => {
                            const cell = calendar.cells.find((item) => item.depart_date === departDate && item.return_date === returnDate);
                            if (!cell) {
                              return (
                                <td key={returnDate}>
                                  <div className="matrix-cell-link muted">-</div>
                                </td>
                              );
                            }
                            const fare = query.cabin === "BUSINESS" ? cell.business_min_total : cell.economy_min_total;
                            const isLowest = lowestCellPrice !== null && fare === lowestCellPrice;

                            return (
                              <td key={returnDate}>
                                <Link
                                  href={href("/offers", {
                                    origin: query.origin,
                                    week: query.week,
                                    destination: placeId,
                                    depart: String(cell.depart_date),
                                    return: String(cell.return_date),
                                    cabin: query.cabin,
                                    traveler: query.traveler,
                                  })}
                                  className={`matrix-cell-link ${isLowest ? "is-best-fare" : ""}`}
                                  aria-label={`${formatDate(departDate)} 출발 ${formatDate(returnDate)} 귀국 ${String(cell.stay_nights)}박, 최저가 ${formatMoney(fare)}`}
                                >
                                  {isLowest && <span className="cell-best-badge">최저가</span>}
                                  <div className="matrix-price-stack">
                                    <div className="matrix-price">
                                      <span>일반석</span>
                                      <strong>{formatMoney(cell.economy_min_total as number | null)}</strong>
                                    </div>
                                    <div className="matrix-price">
                                      <span>비즈니스석</span>
                                      <strong>{formatMoney(cell.business_min_total as number | null)}</strong>
                                    </div>
                                  </div>
                                  <div className="matrix-meta">
                                    {String(cell.stay_nights)}박 일정
                                  </div>
                                </Link>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </MatrixKeyboardNavigator>

              <aside className="calendar-stack">
                <article className="aside-card">
                  <p className="section-kicker">{calendar.destination.region_label}</p>
                  <h3>
                    {calendar.destination.city}, {calendar.destination.country}
                  </h3>
                  <p className="aside-copy">날짜 셀을 누르면 해당 일정의 항공편 비교 화면으로 바로 이동합니다.</p>
                  <div className="spotlight-stat">
                    <span>일반석 최저가</span>
                    <strong>{formatMoney((spotlight?.economy_min_total as number | null) ?? null)}</strong>
                  </div>
                  <div className="spotlight-stat">
                    <span>비즈니스석 최저가</span>
                    <strong>{formatMoney((spotlight?.business_min_total as number | null) ?? null)}</strong>
                  </div>
                </article>
              </aside>
            </section>
          </details>
        </>
      ) : (
        <section className="panel empty-state">선택한 목적지를 찾을 수 없습니다.</section>
      )}
    </main>
  );
}
