import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { BookmarkButton } from "@/components/bookmark-button";
import { DealsMap } from "@/components/deals-map";
import { ServiceUnavailableNotice } from "@/components/service-unavailable-notice";
import { ShareButton } from "@/components/share-button";
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
          <p className="eyebrow">특가 지도</p>
          <h1>예산과 기간에 맞는 목적지를 지도에서 발견하세요</h1>
          <p className="hero-text">
            한국 출발 주요 취항지의 최저가와 추천 일정을 지도에서 한눈에 확인하고, 마음에 드는 목적지의 날짜 조합을 탐색할 수 있습니다.
          </p>
          <div className="hero-badges" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
            <span className="hero-badge">왕복 총액 기준</span>
            <span className="hero-badge">성인 1인 · 세금 포함</span>
            <span className="hero-badge">여행 기간 {TRIP_BUCKETS.find((item) => item.code === query.stay_bucket)?.label}</span>
            <ShareButton title="Sky Planner 특가 지도 공유" text="지도에서 출발지/기간별 항공 최저가를 확인해보세요!" />
          </div>
        </div>
        <div className="hero-metrics">
          <article className="metric-card">
            <span className="metric-label">검색 결과</span>
            <strong>{serviceUnavailable ? "중단" : `${map.summary.destinations}개 도시`}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">지도 내 최저가</span>
            <strong>{serviceUnavailable ? "점검 중" : formatMoney(lowestFare)}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">가격 확인</span>
            <strong>{stamp(lastBatchAt)}</strong>
          </article>
        </div>
      </section>

      <section className="panel batch-strip">
        <div className="batch-stat">
          <span className="metric-label">데이터 기준</span>
          <strong>최근 업데이트 {stamp(lastBatchAt)}</strong>
        </div>
        <div className="batch-stat">
          <span className="metric-label">검색 조건</span>
          <strong>성인 1인 · 왕복 · 세금 포함</strong>
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
            <span>좌석 등급</span>
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
            <span>여행 기간</span>
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

        <div className="theme-filter-row" style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px dashed rgba(14, 49, 86, 0.08)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--accent)" }}>추천 테마:</span>
          <Link href={href("/map", { ...query, stay_bucket: "3_4" })} className={`chip chip--sm ${query.stay_bucket === "3_4" ? "is-active" : ""}`}>
            🏖️ 주말/연차 1일 (3~4일)
          </Link>
          <Link href={href("/map", { ...query, stay_bucket: "5_7" })} className={`chip chip--sm ${query.stay_bucket === "5_7" ? "is-active" : ""}`}>
            ✈️ 알찬 1주일 (5~7일)
          </Link>
          <Link href={href("/map", { ...query, region: "JAPAN" })} className={`chip chip--sm ${query.region === "JAPAN" ? "is-active" : ""}`}>
            🍣 일본 특가
          </Link>
          <Link href={href("/map", { ...query, region: "SEA" })} className={`chip chip--sm ${query.region === "SEA" ? "is-active" : ""}`}>
            🌴 동남아 휴양지
          </Link>
        </div>
        <p className="panel-note" style={{ marginTop: "10px" }}>
          표시된 가격은 최근 수집된 대표 운임(왕복 총액)이며, 실시간 좌석 상황 및 최종 결제 금액은 예약처에서 확인해야 합니다.
        </p>
      </section>

      <section className="dashboard-grid">
        <section className="panel">
          <div className="panel-head">
          <div>
              <p className="section-kicker">특가 지도</p>
              <h2>목적지별 최저가</h2>
          </div>
            <div className="selection-pill">
              {query.origin === "SEL" ? "서울 전체 (인천/김포)" : query.origin} · {query.week} · {TRIP_BUCKETS.find((item) => item.code === query.stay_bucket)?.label}
              {query.budget != null ? ` · 예산 ${Math.round(query.budget / 10000)}만 원 이하` : ""}
            </div>
          </div>

          <DealsMap deals={map.deals} query={query} />
        </section>

        <aside className="panel region-group">
          <div className="panel-head">
            <div>
              <p className="section-kicker">목적지 목록</p>
              <h2>대표 특가 순위</h2>
            </div>
            <div className="selection-pill">{map.deals.length}개 도시</div>
          </div>

          {map.deals.map((deal) => (
            <div key={deal.destination_code} className="deal-row-wrapper" style={{ position: "relative" }}>
              <Link
                href={href(`/destination/${deal.destination_code}`, {
                  origin: query.origin,
                  week: query.week,
                  stay_bucket: query.stay_bucket,
                  traveler: query.traveler,
                  cabin: query.cabin,
                  airlines: query.airlines.join(",") || null,
                  budget: query.budget,
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
                    <span>일반석</span>
                    <strong>{formatMoney(deal.economy_min_total as number | null)}</strong>
                  </div>
                  <div className="price-line">
                    <span>비즈니스석</span>
                    <strong>{formatMoney(deal.business_min_total as number | null)}</strong>
                  </div>
                </div>
                <div className="table-note">
                  <span>가격 확인 {stamp(String(deal.last_batch_at))}</span>
                </div>
              </Link>
              <div style={{ position: "absolute", top: "12px", right: "12px", zIndex: 2 }}>
                <BookmarkButton
                  deal={deal}
                  origin={query.origin}
                  week={query.week}
                  stayBucket={query.stay_bucket}
                />
              </div>
            </div>
          ))}
        </aside>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="section-kicker">항공사</p>
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
              <p className="section-kicker">다음 단계</p>
              <h2>{selectedDeal.city} 저렴한 날짜 조합 보기</h2>
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
              budget: query.budget,
            })}
            className="cta-link"
          >
            {selectedDeal.city} 날짜 매트릭스 탐색
          </Link>
        </section>
      ) : null}
        </>
      )}
    </main>
  );
}
