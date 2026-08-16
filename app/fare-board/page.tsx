import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { ServiceUnavailableNotice } from "@/components/service-unavailable-notice";
import { resolveSearchResponse } from "@/lib/data-source";
import {
  getDestinationList,
  parseSearchQuery,
  ORIGINS,
} from "@/lib/mock-market";
import { isServiceUnavailableDiagnostics } from "@/lib/service-unavailable";
import { href } from "@/lib/url";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface FareDiagnostics {
  read_model?: string;
  postgres_configured?: boolean;
  service_unavailable?: boolean;
  service_requires_postgres?: boolean;
  fallback_used?: boolean;
  fallback_suppressed?: boolean;
  fallback_reason?: string | null;
  source_flags?: string[];
  source_readiness?: {
    status?: string;
    counts?: {
      env_enabled_sources?: number;
      search_eligible_sources?: number;
      blocked_sources?: number;
    };
    blocked_source_ids?: string[];
  } | null;
  source_health_error?: string | null;
}

function formatMoney(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function formatCompactDate(value: string) {
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()} ${WEEKDAYS[date.getDay()]}`;
}

function formatCompactStamp(value: string) {
  const date = new Date(value);
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${h}:${m}`;
}

function stamp(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function sourceLabel(flag: string) {
  const labels: Record<string, string> = {
    skyscanner_affiliate: "Skyscanner",
    korean_air_official: "대한항공",
    asiana_official: "아시아나",
  };
  return labels[flag] ?? flag.replaceAll("_", " ");
}

function readModelLabel(diagnostics?: FareDiagnostics) {
  if (!diagnostics) return "진단 없음";
  if (diagnostics.service_unavailable || diagnostics.fallback_suppressed) return "사용 불가";
  if (diagnostics.fallback_used) return "Mock fallback";
  if (diagnostics.read_model === "postgres") return "운영 DB";
  return diagnostics.read_model ?? "미확인";
}

function sourceReadinessLabel(diagnostics?: FareDiagnostics) {
  const readiness = diagnostics?.source_readiness;
  if (!readiness) return "미확인";
  if (readiness.status === "ready") return "Ready";
  return "점검 필요";
}

function trustTone(diagnostics?: FareDiagnostics) {
  if (!diagnostics) return "is-warn";
  if (diagnostics.service_unavailable || diagnostics.fallback_suppressed) return "is-warn";
  if (diagnostics.fallback_used || diagnostics.source_health_error) return "is-warn";
  if (diagnostics.source_readiness && diagnostics.source_readiness.status !== "ready") return "is-warn";
  return "is-ok";
}

const DAYS_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export default async function FareBoardPage(props: { searchParams: SearchParams }) {
  const raw = await props.searchParams;
  const query = parseSearchQuery(raw);
  const destinations = getDestinationList();
  const hasSearch = query.destination_input.length > 0 || query.destination.length > 0;
  const searchResponse = hasSearch ? await resolveSearchResponse(query) : null;
  const result = searchResponse?.data ?? null;
  const diagnostics = searchResponse?.diagnostics as FareDiagnostics | undefined;
  const serviceUnavailable = isServiceUnavailableDiagnostics(diagnostics);
  if (serviceUnavailable) noStore();
  const sourceFlags = searchResponse?.source_flags ?? [];
  const eligibleSourceCount =
    diagnostics?.source_readiness?.counts?.search_eligible_sources ?? sourceFlags.length;
  const blockedSourceCount = diagnostics?.source_readiness?.counts?.blocked_sources ?? 0;
  const hasOperationalWarning =
    !serviceUnavailable &&
    (Boolean(diagnostics?.fallback_used) ||
      Boolean(diagnostics?.source_health_error) ||
      Boolean(diagnostics?.source_readiness && diagnostics.source_readiness.status !== "ready"));
  const activeDestination = result?.destination ?? destinations.find((dest) => dest.code === query.destination);
  const flexLabel = query.flex_days === 0 ? `${query.days}박 고정` : `${query.days}박 ±${query.flex_days}`;
  const searchSummary = [
    query.origin,
    query.destination_input || activeDestination?.city || "목적지 선택",
    flexLabel,
    query.cabin === "ALL" ? "전체 캐빈" : query.cabin === "ECONOMY" ? "이코노미" : "비즈니스",
  ].join(" · ");
  const resultSummary = result && searchResponse
    ? `항공편 ${result.total_offers}건 · ${result.search_scope.destination_count}개 목적지 · ${result.flexible_night_range.min}-${result.flexible_night_range.max}박 · 배치 ${formatCompactStamp(searchResponse.last_batch_at)}`
    : "";

  // Limit to top 50 offers for display
  const displayOffers = result?.offers.slice(0, 50) ?? [];

  return (
    <main className={`page-grid fb-page ${result && !serviceUnavailable ? "has-results" : ""}`}>
      {/* ─── Selector Section ─── */}
      <details className="fb-search-panel filter-drawer" open={!result || serviceUnavailable}>
        <summary className="filter-drawer-summary">
          <span className="filter-drawer-label">검색 조건</span>
          <span className="filter-drawer-value">{searchSummary}</span>
        </summary>
        <div className="filter-drawer-body">
          <div className="fb-search-header">
            <p className="eyebrow">Fare Board</p>
            <h1>최저가 검색</h1>
            <p className="fb-search-desc">
              목적지와 여행 기간을 선택하면 가장 저렴한 항공편을 찾아드립니다.
            </p>
          </div>

          <div className="fb-search-controls">
            <form className="fb-destination-search" action="/fare-board" method="get">
              <input type="hidden" name="origin" value={query.origin} />
              <input type="hidden" name="days" value={String(query.days)} />
              <input type="hidden" name="flex" value={String(query.flex_days)} />
              <input type="hidden" name="cabin" value={query.cabin} />
              <input type="hidden" name="traveler" value={query.traveler} />
              <label className="fb-control-label" htmlFor="destination-query">목적지 검색</label>
              <div className="fb-search-input-row">
                <input
                  id="destination-query"
                  name="q"
                  className="fb-search-input"
                  defaultValue={query.destination_input}
                  list="destination-options"
                  placeholder="도시, 국가, IATA 코드"
                  autoComplete="off"
                />
                <button className="cta-link fb-search-button" type="submit">검색</button>
              </div>
              <datalist id="destination-options">
                {destinations.map((dest) => (
                  <option key={dest.code} value={dest.city} label={`${dest.code} · ${dest.country}`} />
                ))}
              </datalist>
            </form>

            {/* Origin */}
            <div className="fb-control-group">
              <label className="fb-control-label">출발 공항</label>
              <div className="chip-row">
                {ORIGINS.map((origin) => (
                  <Link
                    key={origin.code}
                    href={href("/fare-board", {
                      origin: origin.code,
                      destination: query.destination || null,
                      q: query.destination_input || null,
                      days: String(query.days),
                      flex: String(query.flex_days),
                      cabin: query.cabin,
                      traveler: query.traveler,
                    })}
                    className={`chip ${query.origin === origin.code ? "is-active" : ""}`}
                  >
                    {origin.label}
                  </Link>
                ))}
              </div>
            </div>

            {/* Destination */}
            <div className="fb-control-group">
              <label className="fb-control-label">목적지</label>
              <div className="fb-dest-grid">
                {destinations.map((dest) => (
                  <Link
                    key={dest.code}
                    href={href("/fare-board", {
                      origin: query.origin,
                      destination: dest.code,
                      q: dest.city,
                      days: String(query.days),
                      flex: String(query.flex_days),
                      cabin: query.cabin,
                      traveler: query.traveler,
                    })}
                    className={`fb-dest-chip ${query.destination === dest.code ? "is-active" : ""}`}
                  >
                    <strong>{dest.city}</strong>
                    <span>{dest.country}</span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Days */}
            <div className="fb-control-group">
              <label className="fb-control-label">체류 박수</label>
              <div className="chip-row">
                {DAYS_OPTIONS.map((d) => (
                  <Link
                    key={d}
                    href={href("/fare-board", {
                      origin: query.origin,
                      destination: query.destination || null,
                      q: query.destination_input || null,
                      days: String(d),
                      flex: String(query.flex_days),
                      cabin: query.cabin,
                      traveler: query.traveler,
                    })}
                    className={`chip ${query.days === d ? "is-active" : ""}`}
                  >
                    {d}박
                  </Link>
                ))}
              </div>
            </div>

            <div className="fb-control-group">
              <label className="fb-control-label">체류 유연성</label>
              <div className="chip-row">
                {[0, 1, 2].map((flex) => (
                  <Link
                    key={flex}
                    href={href("/fare-board", {
                      origin: query.origin,
                      destination: query.destination || null,
                      q: query.destination_input || null,
                      days: String(query.days),
                      flex: String(flex),
                      cabin: query.cabin,
                      traveler: query.traveler,
                    })}
                    className={`chip ${query.flex_days === flex ? "is-active" : ""}`}
                  >
                    {flex === 0 ? "고정" : `±${flex}박`}
                  </Link>
                ))}
              </div>
            </div>

            {/* Cabin */}
            <div className="fb-control-group">
              <label className="fb-control-label">캐빈</label>
              <div className="chip-row">
                <Link
                  href={href("/fare-board", {
                    origin: query.origin,
                    destination: query.destination || null,
                    q: query.destination_input || null,
                    days: String(query.days),
                    flex: String(query.flex_days),
                    cabin: "ALL",
                    traveler: query.traveler,
                  })}
                  className={`chip ${query.cabin === "ALL" ? "is-active" : ""}`}
                >
                  전체
                </Link>
                <Link
                  href={href("/fare-board", {
                    origin: query.origin,
                    destination: query.destination || null,
                    q: query.destination_input || null,
                    days: String(query.days),
                    flex: String(query.flex_days),
                    cabin: "ECONOMY",
                    traveler: query.traveler,
                  })}
                  className={`chip ${query.cabin === "ECONOMY" ? "is-active" : ""}`}
                >
                  이코노미
                </Link>
                <Link
                  href={href("/fare-board", {
                    origin: query.origin,
                    destination: query.destination || null,
                    q: query.destination_input || null,
                    days: String(query.days),
                    flex: String(query.flex_days),
                    cabin: "BUSINESS",
                    traveler: query.traveler,
                  })}
                  className={`chip ${query.cabin === "BUSINESS" ? "is-active" : ""}`}
                >
                  비즈니스
                </Link>
              </div>
            </div>
          </div>
        </div>
      </details>

      {/* ─── No Search State ─── */}
      {!hasSearch && (
        <section className="fb-empty-state">
          <div className="fb-empty-icon">✈</div>
          <h2>목적지를 선택하세요</h2>
          <p>도시명, 국가명, IATA 코드로 최저가 후보를 검색합니다.</p>
        </section>
      )}

      {result && !result.destination && (
        <section className="fb-empty-state">
          <div className="fb-empty-icon">?</div>
          <h2>검색 가능한 목적지를 찾지 못했습니다</h2>
          <p>도시명 또는 공항 코드를 다시 입력하세요.</p>
        </section>
      )}

      {serviceUnavailable && <ServiceUnavailableNotice diagnostics={diagnostics} />}

      {/* ─── Results: Lowest Price Hero ─── */}
      {result && result.destination && !serviceUnavailable && (
        <>
          <section className="fb-result-hero">
            <div className="fb-result-hero-main">
              <div className="fb-result-route">
                <span className="fb-route-from">{query.origin}</span>
                <span className="fb-route-arrow">→</span>
                <span className="fb-route-to">
                  {result.search_scope.kind === "broad" ? result.search_scope.label : result.destination.city}
                </span>
              </div>
              <div className="fb-result-condition">
                {result.search_scope.kind === "broad"
                  ? `${result.search_scope.destination_count}개 목적지 · 최저 후보 ${result.destination.city}`
                  : result.destination.country} · {result.flexible_night_range.min}-{result.flexible_night_range.max}박 탐색
              </div>
            </div>

            <div className="fb-result-hero-price">
              <span className="fb-result-label">최저가</span>
              <strong className="fb-result-price">
                {formatMoney(result.lowest_price)}
              </strong>
              {result.lowest_airline && (
                <span className="fb-result-airline">
                  {result.lowest_airline} · {result.lowest_date}
                </span>
              )}
            </div>

            <div className="fb-result-hero-meta">{resultSummary}</div>
            {result.searched_destinations.length > 1 && (
              <div className="fb-scope-destinations">
                {result.searched_destinations.map((destination) => (
                  <span key={destination.code}>{destination.city}</span>
                ))}
              </div>
            )}
            {searchResponse && (
              <div className={`fb-trust-strip ${trustTone(diagnostics)}`}>
                <div className="fb-trust-item">
                  <span>Read model</span>
                  <strong>{readModelLabel(diagnostics)}</strong>
                </div>
                <div className="fb-trust-item">
                  <span>Source health</span>
                  <strong>{sourceReadinessLabel(diagnostics)}</strong>
                </div>
                <div className="fb-trust-item">
                  <span>Eligible sources</span>
                  <strong>{eligibleSourceCount}개</strong>
                </div>
                <div className="fb-trust-sources">
                  {sourceFlags.map((source) => (
                    <span key={source}>{sourceLabel(source)}</span>
                  ))}
                </div>
              </div>
            )}
            {hasOperationalWarning && (
              <div className="fb-operational-warning">
                <strong>운영 확인 필요</strong>
                <span>
                  {diagnostics?.fallback_used
                    ? `fallback 사용${diagnostics.fallback_reason ? ` · ${diagnostics.fallback_reason}` : ""}`
                    : diagnostics?.source_health_error
                      ? "source health 조회 오류"
                      : `차단 source ${blockedSourceCount}개`}
                </span>
              </div>
            )}
            <div className="fb-result-hero-stats">
              {result.price_by_cabin.map((bucket) => (
                <div key={bucket.cabin} className="fb-mini-stat">
                  <span>{bucket.cabin === "ECONOMY" ? "Eco" : "Biz"}</span>
                  <strong>{formatMoney(bucket.lowest_total)}</strong>
                </div>
              ))}
              <div className="fb-mini-stat">
                <span>Dest</span>
                <strong>{result.quality_summary.destinations}개</strong>
              </div>
              <div className="fb-mini-stat">
                <span>Direct</span>
                <strong>{result.quality_summary.direct_options}개</strong>
              </div>
              <div className="fb-mini-stat">
                <span>Sources</span>
                <strong>{result.quality_summary.sources}개</strong>
              </div>
            </div>
          </section>

          {/* ─── Flight List ─── */}
          <section className="fb-flights-section">
            <div className="fb-flights-header">
              <div>
                <p className="section-kicker">Flight Options</p>
                <h2>항공편 목록</h2>
              </div>
              <span className="selection-pill">
                가격순 · 상위 {displayOffers.length}건
              </span>
            </div>

            <div className="fb-flights-list">
              {displayOffers.map((offer, index) => (
                <a
                  key={offer.offer_id}
                  href={offer.deep_link}
                  target="_blank"
                  rel="noreferrer"
                  className={`fb-flight-card ${index === 0 ? "fb-flight-best" : ""}`}
                >
                  {index === 0 && <span className="fb-badge fb-badge-lowest">최저가</span>}

                  {/* Price + Airline header */}
                  <div className="fb-flight-top">
                    <div className="fb-flight-price-block">
                      <strong className="fb-flight-price">{formatMoney(offer.price_total)}</strong>
                      {offer.discount_pct_30 > 0 && (
                        <span className="fb-discount">-{offer.discount_pct_30}%</span>
                      )}
                    </div>
                    <div className="fb-flight-airline">
                      <strong>{offer.airline_name}</strong>
                      <span>{offer.cabin_label_raw}</span>
                    </div>
                  </div>
                  <div className="fb-flight-meta-line">
                    <span>도착 {offer.destination_city}</span>
                    <span>{offer.is_direct ? "직항" : `${offer.stops}회 경유`}</span>
                    <span>{offer.duration_hours}시간</span>
                    <span>{offer.source_name}</span>
                    {offer.official_promotion && <span className="fb-flight-meta-accent">프로모션</span>}
                  </div>
                  <div className="fb-flight-route-line">
                    <span>출 {formatTime(offer.outbound_departure_at)}→{formatTime(offer.outbound_arrival_at)} {formatCompactDate(offer.depart_date)}</span>
                    <span>복 {formatTime(offer.inbound_departure_at)}→{formatTime(offer.inbound_arrival_at)} {formatCompactDate(offer.return_date)}</span>
                  </div>
                  <div className="fb-flight-meta-line">
                    <span>마지막 배치 {stamp(offer.last_batch_at)}</span>
                    <span>최종가는 예약처 확인</span>
                  </div>
                </a>
              ))}

              {displayOffers.length === 0 && (
                <div className="fb-empty-state">
                  <p>선택한 조건에 맞는 항공편이 없습니다.</p>
                </div>
              )}
            </div>
          </section>

          {/* ─── Note ─── */}
          <section className="panel">
            <p className="panel-note">
              세금 포함 총액 기준 · 성인 1인 · 일 1회 배치 갱신 · 최종 결제 금액은 예약처에서 확인하세요. 항공편 클릭 시 예약 사이트로 이동합니다.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
