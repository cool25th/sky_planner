import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { ServiceUnavailableNotice } from "@/components/service-unavailable-notice";
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
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", weekday: "short" }).format(new Date(value));
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
  const firstCell = calendar.cells[0];

  return (
    <main className="page-grid">
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="section-kicker">Destination</p>
            <h1>{calendar.destination ? `${calendar.destination.city} 날짜 매트릭스` : "목적지를 찾을 수 없습니다"}</h1>
            <p className="panel-note">
              {query.origin} 출발 · {query.week} · {TRIP_BUCKETS.find((item) => item.code === query.stay_bucket)?.label} · 마지막 배치 {stamp(calendarResponse.last_batch_at)}
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
            지도로 돌아가기
          </Link>
        </div>
      </section>

      {serviceUnavailable ? (
        <ServiceUnavailableNotice diagnostics={unavailableDiagnostics} />
      ) : calendar.destination ? (
        <section className="calendar-layout">
          <div className="panel">
            <div className="matrix-scroll">
              <table className="matrix-table">
                <thead>
                  <tr>
                    <th>
                      <div className="matrix-label">
                        <strong>출발일</strong>
                        <span>귀국일 기준 비교</span>
                      </div>
                    </th>
                    {calendar.return_dates.map((date) => (
                      <th key={date}>
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
                      <td>
                        <div className="matrix-label">
                          <strong>{formatDate(departDate)}</strong>
                          <span>출발</span>
                        </div>
                      </td>
                      {calendar.return_dates.map((returnDate) => {
                        const cell = calendar.cells.find((item) => item.depart_date === departDate && item.return_date === returnDate);
                        if (!cell) {
                          return (
                            <td key={returnDate}>
                              <div className="matrix-cell-link muted">-</div>
                            </td>
                          );
                        }
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
                              className="matrix-cell-link"
                            >
                              <div className="matrix-price-stack">
                                <div className="matrix-price">
                                  <span>Eco</span>
                                  <strong>{formatMoney(cell.economy_min_total as number | null)}</strong>
                                </div>
                                <div className="matrix-price">
                                  <span>Biz</span>
                                  <strong>{formatMoney(cell.business_min_total as number | null)}</strong>
                                </div>
                              </div>
                              <div className="matrix-meta">
                                {String(cell.stay_nights)}박 · {String(cell.trip_bucket)}
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
          </div>

          <aside className="calendar-stack">
            <article className="aside-card">
              <p className="section-kicker">{calendar.destination.region_label}</p>
              <h3>
                {calendar.destination.city}, {calendar.destination.country}
              </h3>
              <p className="aside-copy">배치 캐시 기반 날짜 매트릭스입니다. 셀을 누르면 해당 날짜 조합의 항공편 상세로 내려갑니다.</p>
              <div className="spotlight-stat">
                <span>대표 Eco</span>
                <strong>{formatMoney((spotlight?.economy_min_total as number | null) ?? null)}</strong>
              </div>
              <div className="spotlight-stat">
                <span>대표 Biz</span>
                <strong>{formatMoney((spotlight?.business_min_total as number | null) ?? null)}</strong>
              </div>
            </article>

            <article className="aside-card">
              <p className="section-kicker">Selected Window</p>
              {firstCell ? (
                <>
                  <h3>
                    {formatDate(String(firstCell.depart_date))} → {formatDate(String(firstCell.return_date))}
                  </h3>
                  <p className="aside-copy">
                    {String(firstCell.stay_nights)}박 · {String(firstCell.trip_bucket)} · 마지막 배치 {stamp(String(firstCell.last_batch_at))}
                  </p>
                  <Link
                    href={href("/offers", {
                      origin: query.origin,
                      week: query.week,
                      destination: placeId,
                      depart: String(firstCell.depart_date),
                      return: String(firstCell.return_date),
                      cabin: query.cabin,
                      traveler: query.traveler,
                    })}
                    className="cta-link"
                  >
                    이 날짜 조합으로 항공편 보기
                  </Link>
                </>
              ) : (
                <p className="aside-copy">현재 조건에 맞는 날짜 조합이 없습니다.</p>
              )}
            </article>
          </aside>
        </section>
      ) : (
        <section className="panel empty-state">선택한 목적지를 찾을 수 없습니다.</section>
      )}
    </main>
  );
}
