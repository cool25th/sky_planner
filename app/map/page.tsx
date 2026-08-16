import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { DealsMap } from "@/components/deals-map";
import { ServiceUnavailableNotice } from "@/components/service-unavailable-notice";
import { resolveMapResponse, resolveMetaResponse } from "@/lib/data-source";
import {
  TRIP_BUCKETS,
  parseMapQuery,
} from "@/lib/mock-market";
import { isServiceUnavailableDiagnostics } from "@/lib/service-unavailable";
import { href } from "@/lib/url";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatMoney(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
}

function sourceLabel(flag: string) {
  const labels: Record<string, string> = {
    skyscanner_affiliate: "Skyscanner",
    korean_air_official: "대한항공 공식",
    asiana_official: "아시아나 공식",
  };
  return labels[flag] ?? flag;
}

function stamp(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default async function MapPage(props: { searchParams: SearchParams }) {
  const query = parseMapQuery(await props.searchParams);
  const [metaResponse, mapResponse] = await Promise.all([resolveMetaResponse(), resolveMapResponse(query)]);
  const meta = metaResponse.data;
  const map = mapResponse.data;
  const serviceUnavailable = isServiceUnavailableDiagnostics(mapResponse.diagnostics);
  if (serviceUnavailable) noStore();
  const lastBatchAt = mapResponse.last_batch_at;
  const activeAirlines = new Set(query.airlines);
  const selectedDeal = map.deals[0];
  const lowestFare = map.deals.length
    ? Math.min(
        ...map.deals.flatMap((deal) =>
          [deal.economy_min_total, deal.business_min_total].filter((value): value is number => typeof value === "number"),
        ),
      )
    : null;

  return (
    <main className="page-grid">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Route Atlas</p>
          <h1>차분한 예약 보드에서 목적지와 대표가를 먼저 고릅니다</h1>
          <p className="hero-text">
            지역 단위로 정리된 배치 운임을 밝은 지도로 보여주고, 선택 상태만 네이비 톤으로 집중시킵니다. 이코노미와 비즈니스 가격은 같은 표면 안에서 조용하게 비교되도록 정리했습니다.
          </p>
          <div className="hero-badges">
            <span className="hero-badge">성인 1인</span>
            <span className="hero-badge">일 1회 갱신</span>
            <span className="hero-badge">체류 버킷 {TRIP_BUCKETS.find((item) => item.code === query.stay_bucket)?.label}</span>
          </div>
        </div>
        <div className="hero-metrics">
          <article className="metric-card">
            <span className="metric-label">Board Size</span>
            <strong>{serviceUnavailable ? "중단" : `${map.summary.destinations}곳`}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">Best Visible Fare</span>
            <strong>{serviceUnavailable ? "점검 중" : formatMoney(lowestFare)}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">Updated</span>
            <strong>{stamp(lastBatchAt)}</strong>
          </article>
        </div>
      </section>

      <section className="panel batch-strip">
        <div className="batch-stat">
          <span className="metric-label">Batch</span>
          <strong>{stamp(lastBatchAt)}</strong>
        </div>
        <div className="batch-stat">
          <span className="metric-label">Traveler</span>
          <strong>성인 1인 · 일 1회 갱신</strong>
        </div>
        <div className="batch-stat">
          <span className="metric-label">Enabled Sources</span>
          <strong>{mapResponse.source_flags.map(sourceLabel).join(" · ")}</strong>
        </div>
      </section>

      {serviceUnavailable ? (
        <ServiceUnavailableNotice diagnostics={mapResponse.diagnostics} />
      ) : (
        <>
      <section className="panel">
        <div className="controls-grid">
          <div className="field grow">
            <span>출발 공항</span>
            <div className="chip-row">
              {meta.origins.map((origin) => (
                <Link
                  key={origin.code}
                  href={href("/map", {
                    ...query,
                    origin: origin.code,
                    airlines: query.airlines.join(",") || null,
                  })}
                  className={`chip ${query.origin === origin.code ? "is-active" : ""}`}
                >
                  {origin.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="field grow">
            <span>출발 주간</span>
            <div className="chip-row">
              {meta.weeks.map((week) => (
                <Link
                  key={week.code}
                  href={href("/map", { ...query, week: week.code, airlines: query.airlines.join(",") || null })}
                  className={`chip ${query.week === week.code ? "is-active" : ""}`}
                >
                  {week.code}
                </Link>
              ))}
            </div>
          </div>

          <div className="field grow">
            <span>지역</span>
            <div className="chip-row">
              {meta.regions.map((region) => (
                <Link
                  key={region.code}
                  href={href("/map", { ...query, region: region.code, airlines: query.airlines.join(",") || null })}
                  className={`chip ${query.region === region.code ? "is-active" : ""}`}
                >
                  {region.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="field grow">
            <span>지도 캐빈</span>
            <div className="chip-row">
              {meta.cabins.map((cabin) => (
                <Link
                  key={cabin.code}
                  href={href("/map", { ...query, cabin: cabin.code, airlines: query.airlines.join(",") || null })}
                  className={`chip ${query.cabin === cabin.code ? "is-active" : ""}`}
                >
                  {cabin.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="field grow">
            <span>체류 버킷</span>
            <div className="chip-row">
              {meta.trip_buckets
                .filter((bucket) => bucket.code !== "ALL")
                .map((bucket) => (
                  <Link
                    key={bucket.code}
                    href={href("/map", { ...query, stay_bucket: bucket.code, airlines: query.airlines.join(",") || null })}
                    className={`chip ${query.stay_bucket === bucket.code ? "is-active" : ""}`}
                  >
                    {bucket.label}
                  </Link>
                ))}
            </div>
          </div>
        </div>
        <p className="panel-note">
          {meta.prototype_note} 반복 조회는 Vercel 캐시를 전제로 하고, 최종 결제 금액은 예약처에서 확인해야 합니다.
        </p>
      </section>

      <section className="dashboard-grid">
        <section className="panel">
          <div className="panel-head">
          <div>
              <p className="section-kicker">Flight Surface</p>
              <h2>지역과 도시별 대표 특가</h2>
          </div>
            <div className="selection-pill">
              {query.origin} · {query.week} · {TRIP_BUCKETS.find((item) => item.code === query.stay_bucket)?.label}
            </div>
          </div>

          <DealsMap deals={map.deals} query={query} />
        </section>

        <aside className="panel region-group">
          <div className="panel-head">
            <div>
              <p className="section-kicker">Fare List</p>
              <h2>지역별 대표가</h2>
            </div>
            <div className="selection-pill">{map.deals.length} deals</div>
          </div>

          {map.deals.map((deal) => (
            <Link
              key={deal.destination_code}
              href={href(`/destination/${deal.destination_code}`, {
                origin: query.origin,
                week: query.week,
                stay_bucket: query.stay_bucket,
                traveler: query.traveler,
                cabin: query.cabin,
                airlines: query.airlines.join(",") || null,
              })}
              className="deal-row"
            >
              <div className="deal-top">
                <div className="deal-title">
                  <strong>{deal.city}</strong>
                  <span>{deal.country}</span>
                </div>
                <span className="pill">{deal.region_label}</span>
              </div>
              <div className="stack">
                <div className="price-line">
                  <span>Eco</span>
                  <strong>{formatMoney(deal.economy_min_total as number | null)}</strong>
                </div>
                <div className="price-line">
                  <span>Biz</span>
                  <strong>{formatMoney(deal.business_min_total as number | null)}</strong>
                </div>
              </div>
              <div className="table-note">마지막 배치 {stamp(String(deal.last_batch_at))}</div>
            </Link>
          ))}
        </aside>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="section-kicker">Airline Lens</p>
            <h2>항공사 필터</h2>
          </div>
        </div>
        <div className="chip-row">
          <Link href={href("/map", { ...query, airlines: null })} className={`chip ${activeAirlines.size === 0 ? "is-active" : ""}`}>
            전체 항공사
          </Link>
          {map.available_airlines.map((airline) => {
            const next = new Set(activeAirlines);
            if (next.has(airline.code)) next.delete(airline.code);
            else next.add(airline.code);
            return (
              <Link
                key={airline.code}
                href={href("/map", { ...query, airlines: [...next].join(",") || null })}
                className={`chip ${activeAirlines.has(airline.code) ? "is-active" : ""}`}
              >
                {airline.name}
              </Link>
            );
          })}
        </div>
      </section>

      {selectedDeal ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="section-kicker">Next Step</p>
              <h2>{selectedDeal.city} 날짜 매트릭스로 이동</h2>
            </div>
          </div>
          <Link
            href={href(`/destination/${selectedDeal.destination_code}`, {
              origin: query.origin,
              week: query.week,
              stay_bucket: query.stay_bucket,
              traveler: query.traveler,
              cabin: query.cabin,
              airlines: query.airlines.join(",") || null,
            })}
            className="cta-link"
          >
            {selectedDeal.city} 날짜 매트릭스 보기
          </Link>
        </section>
      ) : null}
        </>
      )}
    </main>
  );
}
