import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { BookmarkButton } from "@/components/bookmark-button";
import { DealsMap } from "@/components/deals-map";
import { MapFilterSelect } from "@/components/map-filter-select";
import { ServiceUnavailableNotice } from "@/components/service-unavailable-notice";
import { ShareButton } from "@/components/share-button";
import { resolveMapResponse, resolveMetaResponse } from "@/lib/data-source";
import {
  TRIP_BUCKETS,
  parseMapQuery,
  formatWeekNatural,
} from "@/lib/mock-market";
import { isServiceUnavailableDiagnostics } from "@/lib/service-unavailable";
import { href } from "@/lib/url";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatMoney(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
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

  const originOptions = meta.origins.map((o) => ({ code: o.code, label: `${o.city} (${o.code})` }));
  const weekOptions = meta.weeks.map((w) => ({ code: w.code, label: formatWeekNatural(w.code) }));
  const stayOptions = meta.trip_buckets.filter((b) => b.code !== "ALL").map((b) => ({ code: b.code, label: b.label }));
  const cabinOptions = meta.cabins.map((c) => ({ code: c.code, label: c.label }));

  return (
    <main className="map-page-shell">
      {/* 1. Compact Top Filter Bar */}
      <header className="map-filter-bar">
        <div className="filter-bar-group">
          <MapFilterSelect
            id="map-origin-select"
            label="출발"
            defaultValue={query.origin}
            paramName="origin"
            options={originOptions}
          />
          <MapFilterSelect
            id="map-week-select"
            label="시기"
            defaultValue={query.week}
            paramName="week"
            options={weekOptions}
          />
          <MapFilterSelect
            id="map-stay-select"
            label="기간"
            defaultValue={query.stay_bucket}
            paramName="stay_bucket"
            options={stayOptions}
          />
          <MapFilterSelect
            id="map-cabin-select"
            label="좌석"
            defaultValue={query.cabin}
            paramName="cabin"
            options={cabinOptions}
          />
        </div>

        <div className="filter-bar-aside">
          <ShareButton title="Sky Planner 특가 지도 공유" text="지도에서 출발지/기간별 항공 최저가를 확인해보세요!" />
        </div>
      </header>

      {/* 2. Split View (좌측 목록 + 우측 지도) */}
      {serviceUnavailable ? (
        <ServiceUnavailableNotice diagnostics={mapResponse.diagnostics} />
      ) : (
        <div className="map-split-layout">
          {/* 좌측 목적지 목록 패널 */}
          <aside className="destination-list-panel">
            <div className="list-panel-header">
              <div>
                <span className="results-count">검색 결과 <strong>{map.deals.length}개 도시</strong></span>
                <span className="results-sub">왕복 총액 · 성인 1인 · 세금 포함</span>
              </div>
              <span className="last-batch-tag">최근 확인 {stamp(lastBatchAt)}</span>
            </div>

            {map.deals.length === 0 ? (
              <div className="map-empty-state">
                <p>선택한 조건에 맞는 목적지가 없습니다.</p>
                <span className="panel-note">여행 기간을 늘리거나 출발 공항을 '서울 전체'로 변경해 보세요.</span>
                <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                  <Link href={href("/map", { ...query, origin: "SEL" })} className="cta-btn--secondary">
                    서울 전체로 검색
                  </Link>
                  <Link href={href("/map", { ...query, stay_bucket: "5_7" })} className="cta-btn--secondary">
                    5~7일로 늘리기
                  </Link>
                </div>
              </div>
            ) : (
              <div className="destination-items-scroll">
                {map.deals.map((deal) => (
                  <article key={deal.destination_code} className="dest-list-card" id={`deal-${deal.destination_code}`}>
                    <div className="dest-card-main">
                      <div className="dest-card-header">
                        <div>
                          <span className="dest-card-region">{deal.region_label}</span>
                          <h3 className="dest-card-city">{deal.city}</h3>
                          <span className="dest-card-country">{deal.country} · {deal.destination_code}</span>
                        </div>
                        <BookmarkButton
                          deal={deal}
                          origin={query.origin}
                          week={query.week}
                          stayBucket={query.stay_bucket}
                        />
                      </div>

                      <div className="dest-card-price-row">
                        <div>
                          <span className="fare-sub">
                            {query.cabin === "BUSINESS" ? "비즈니스석 왕복" : "일반석 왕복"}
                          </span>
                          <strong className="fare-value">
                            {formatMoney(query.cabin === "BUSINESS" ? deal.business_min_total : deal.economy_min_total)}
                          </strong>
                        </div>
                        <Link
                          href={href(`/destination/${deal.destination_code}`, {
                            origin: query.origin,
                            week: query.week,
                            stay_bucket: query.stay_bucket,
                            traveler: query.traveler,
                            cabin: query.cabin,
                            airlines: query.airlines.join(",") || null,
                          })}
                          className="dest-card-cta"
                        >
                          날짜 보기 →
                        </Link>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </aside>

          {/* 우측 풀스크린 지도 */}
          <section className="map-view-canvas">
            <DealsMap deals={map.deals} query={query} />
          </section>
        </div>
      )}
    </main>
  );
}
