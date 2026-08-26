import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";

import { RecentDestinationTracker } from "@/components/recent-destinations";
import { ServiceUnavailableNotice } from "@/components/service-unavailable-notice";
import { MatrixKeyboardNavigator } from "@/components/matrix-keyboard-navigator";
import { ShareButton } from "@/components/share-button";
import { PriceAlertModal } from "@/components/price-alert-modal";
import { BoardingPassModal } from "@/components/boarding-pass-modal";
import { DestinationCompareModal } from "@/components/destination-compare-modal";
import { dataModeLabel, resolveCalendarResponse, resolveMapResponse } from "@/lib/data-source";
import { formatDate, formatMoney, isPastWeek, stamp } from "@/lib/format";
import { TRIP_BUCKETS, parseCalendarQuery, parseMapQuery, formatWeekNatural, availableWeeks, getDestinationList } from "@/lib/mock-market";
import { isServiceUnavailableDiagnostics } from "@/lib/service-unavailable";
import { href, siteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

type Params = Promise<{ placeId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// ponytail: notFound()가 본문·메타데이터는 404로 바꾸지만 force-dynamic 스트리밍이라 HTTP 상태는 200으로 남는다(soft-404).
// 하드 404가 필요해지면 codes 목록을 edge-safe 모듈로 분리해 middleware에서 응답한다.
function isKnownDestination(placeId: string): boolean {
  return getDestinationList().some((d) => d.code === placeId);
}

export async function generateMetadata(props: { params: Params; searchParams: SearchParams }): Promise<Metadata> {
  const { placeId } = await props.params;
  // generateMetadata가 먼저 플러시되며 200이 커밋되는 것을 막으려면 여기서도 notFound()를 호출해야 한다.
  if (!isKnownDestination(placeId)) notFound();
  const searchParams = await props.searchParams;
  const query = parseCalendarQuery({ ...searchParams, destination: placeId });
  const destinations = getDestinationList();
  const dest = destinations.find((d) => d.code === placeId);
  const cityName = dest?.city ?? placeId;
  const countryName = dest?.country ?? "";

  const title = `${cityName}(${placeId}) 항공 특가 & 저렴한 날짜 매트릭스 | Sky Planner Atlas`;
  const description = `${query.origin} 출발 ${cityName}(${countryName}) 왕복 항공권 최저가와 저렴한 출발/귀국 날짜 조합을 2D 가격 매트릭스로 확인하세요.`;

  return {
    title,
    description,
    alternates: {
      canonical: `${siteUrl}/destination/${placeId}`,
    },
    openGraph: {
      title,
      description,
      type: "website",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: `${cityName} 항공 특가 날짜 탐색`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-image.png"],
    },
  };
}

export default async function DestinationPage(props: { params: Params; searchParams: SearchParams }) {
  const { placeId } = await props.params;
  if (!isKnownDestination(placeId)) notFound();
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

  const prices = validCells.map((c) => (query.cabin === "BUSINESS" ? c.business_min_total : c.economy_min_total) as number);
  const minFare = prices.length ? Math.min(...prices) : 0;
  const maxFare = prices.length ? Math.max(...prices) : 0;
  const fareRange = Math.max(maxFare - minFare, 1);

  const getHeatmapClass = (fare: number | null) => {
    if (fare === null) return "";
    if (fare === minFare) return "fare-level-1"; // 최저가
    const ratio = (fare - minFare) / fareRange;
    if (ratio <= 0.3) return "fare-level-2"; // 저렴
    if (ratio <= 0.7) return "fare-level-3"; // 보통
    return "fare-level-4"; // 높음
  };

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${calendar.destination?.city || placeId} 왕복 항공권 특가`,
    description: `${query.origin} 출발 ${calendar.destination?.city || placeId}(${calendar.destination?.country || ""}) 왕복 항공권 최저가 탐색`,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "KRW",
      lowPrice: lowestCellPrice ?? undefined,
      offerCount: validCells.length,
    },
  };

  return (
    <main className="dest-page-container">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD 표준 출력이며 데이터가 자체 정의 객체라 사용자 입력이 포함되지 않는다
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {isPastWeek(query.week) && (
        <div className="beta-banner">
          <span>
            <strong>지난 시기 안내:</strong> {formatWeekNatural(query.week)} — 이미 지난 주간이라 표시할 특가가 없습니다.{" "}
            <Link href={href(`/destination/${placeId}`, { ...query, week: availableWeeks(1)[0].code })}>이번 주간으로 다시 검색</Link>해 보세요.
          </span>
        </div>
      )}
      {calendar.destination && (
        <RecentDestinationTracker
          code={calendar.destination.code}
          city={calendar.destination.city}
          country={calendar.destination.country}
        />
      )}
      {/* 1. Compact Destination Header */}
      {calendar.destination && (
        <section className="dest-header-banner">
          <div className="dest-header-main">
            <div>
              <div className="dest-header-tags">
                <span className="dest-tag">{calendar.destination.region_label}</span>
                <span className="dest-code-tag">{calendar.destination.code}</span>
              </div>
              <h1 className="dest-header-title">{calendar.destination.city}, {calendar.destination.country}</h1>
              <p className="dest-header-sub">
                {query.origin} 출발 · {formatWeekNatural(query.week)} · {TRIP_BUCKETS.find((item) => item.code === query.stay_bucket)?.label} · 왕복 총액 (성인 1인 · 세금 포함)
              </p>
            </div>
            <div className="dest-header-actions">
              <DestinationCompareModal currentPlaceId={placeId} />
              <PriceAlertModal
                destinationCode={placeId}
                cityName={calendar.destination.city}
                origin={query.origin}
                currentLowestPrice={lowestCellPrice}
                cabin={query.cabin}
              />
              <ShareButton
                title={`${calendar.destination.city} 항공 특가 날짜`}
                text={`${calendar.destination.city} 최저 ${formatMoney(lowestCellPrice)}부터 시작하는 저렴한 날짜 조합을 확인해보세요!`}
              />
              <Link
                href={href("/map", {
                  origin: query.origin,
                  week: query.week,
                  region: query.region || "ALL",
                  cabin: query.cabin,
                  stay_bucket: query.stay_bucket,
                  traveler: query.traveler,
                  airlines: query.airlines.join(",") || null,
                  budget: query.budget,
                })}
                className="dest-back-btn"
              >
                ← 특가 지도로 돌아가기
              </Link>
            </div>
          </div>

          {/* Filter Controls Bar: Origin & Cabin */}
          <div className="dest-filter-bar">
            <div className="cabin-toggle-group">
              <span className="cabin-toggle-label">출발 공항:</span>
              {[
                { code: "SEL", label: "서울 전체" },
                { code: "ICN", label: "인천" },
                { code: "GMP", label: "김포" },
                { code: "PUS", label: "부산" },
                { code: "CJU", label: "제주" },
              ].map((orig) => (
                <Link
                  key={orig.code}
                  href={href(`/destination/${placeId}`, {
                    origin: orig.code,
                    week: query.week,
                    region: query.region,
                    stay_bucket: query.stay_bucket,
                    traveler: query.traveler,
                    cabin: query.cabin,
                    budget: query.budget,
                  })}
                  className={`cabin-toggle-btn ${query.origin === orig.code ? "is-active" : ""}`}
                >
                  {orig.label}
                </Link>
              ))}
            </div>

            <div className="cabin-toggle-group">
              <span className="cabin-toggle-label">좌석 등급:</span>
              <Link
                href={href(`/destination/${placeId}`, {
                  origin: query.origin,
                  week: query.week,
                  region: query.region,
                  stay_bucket: query.stay_bucket,
                  traveler: query.traveler,
                  cabin: "ALL",
                  budget: query.budget,
                })}
                className={`cabin-toggle-btn ${query.cabin === "ALL" ? "is-active" : ""}`}
              >
                전체
              </Link>
              <Link
                href={href(`/destination/${placeId}`, {
                  origin: query.origin,
                  week: query.week,
                  region: query.region,
                  stay_bucket: query.stay_bucket,
                  traveler: query.traveler,
                  cabin: "ECONOMY",
                  budget: query.budget,
                })}
                className={`cabin-toggle-btn ${query.cabin === "ECONOMY" ? "is-active" : ""}`}
              >
                일반석
              </Link>
              <Link
                href={href(`/destination/${placeId}`, {
                  origin: query.origin,
                  week: query.week,
                  region: query.region,
                  stay_bucket: query.stay_bucket,
                  traveler: query.traveler,
                  cabin: "BUSINESS",
                  budget: query.budget,
                })}
                className={`cabin-toggle-btn ${query.cabin === "BUSINESS" ? "is-active" : ""}`}
              >
                비즈니스석
              </Link>
            </div>
          </div>
        </section>
      )}

      {serviceUnavailable ? (
        <ServiceUnavailableNotice diagnostics={unavailableDiagnostics} />
      ) : calendar.destination ? (
        <>
          {/* Travel Info Quick Grid */}
          {(() => {
            const TRAVEL_INFO_MAP: Record<string, { flightTime: string; timeDiff: string; visa: string; currency: string }> = {
              TYO: { flightTime: "약 2시간 15분", timeDiff: "시차 없음 (0h)", visa: "무비자 (90일)", currency: "일본 엔 (JPY)" },
              FUK: { flightTime: "약 1시간 15분", timeDiff: "시차 없음 (0h)", visa: "무비자 (90일)", currency: "일본 엔 (JPY)" },
              OSA: { flightTime: "약 1시간 45분", timeDiff: "시차 없음 (0h)", visa: "무비자 (90일)", currency: "일본 엔 (JPY)" },
              BKK: { flightTime: "약 5시간 45분", timeDiff: "2시간 느림 (-2h)", visa: "무비자 (90일)", currency: "태국 바트 (THB)" },
              DAD: { flightTime: "약 4시간 30분", timeDiff: "2시간 느림 (-2h)", visa: "무비자 (45일)", currency: "베트남 동 (VND)" },
              TPE: { flightTime: "약 2시간 30분", timeDiff: "1시간 느림 (-1h)", visa: "무비자 (90일)", currency: "대만 달러 (TWD)" },
              HKG: { flightTime: "약 3시간 45분", timeDiff: "1시간 느림 (-1h)", visa: "무비자 (90일)", currency: "홍콩 달러 (HKD)" },
              SIN: { flightTime: "약 6시간 15분", timeDiff: "1시간 느림 (-1h)", visa: "무비자 (90일)", currency: "싱가포르 달러 (SGD)" },
              PAR: { flightTime: "약 12시간 30분", timeDiff: "8시간 느림 (-8h)", visa: "무비자 (90일)", currency: "유로 (EUR)" },
              LON: { flightTime: "약 12시간 45분", timeDiff: "9시간 느림 (-9h)", visa: "무비자 (6개월)", currency: "영국 파운드 (GBP)" },
              NYC: { flightTime: "약 14시간", timeDiff: "14시간 느림 (-14h)", visa: "ESTA 전자비자", currency: "미국 달러 (USD)" },
              HNL: { flightTime: "약 8시간 10분", timeDiff: "19시간 느림 (-19h)", visa: "ESTA 전자비자", currency: "미국 달러 (USD)" },
            };
            const travelInfo = TRAVEL_INFO_MAP[placeId] || {
              flightTime: "직항/경유 탐색",
              timeDiff: "현지 시차 확인",
              visa: "대한민국 여권 기준",
              currency: "현지 통화 결제",
            };
            return (
              <section className="dest-travel-info">
                <div className="travel-info-chip">
                  <span className="travel-info-icon">⏱️</span>
                  <div>
                    <span className="travel-info-label">직항 비행시간</span>
                    <strong className="travel-info-val">{travelInfo.flightTime}</strong>
                  </div>
                </div>
                <div className="travel-info-chip">
                  <span className="travel-info-icon">🌐</span>
                  <div>
                    <span className="travel-info-label">한국 대비 시차</span>
                    <strong className="travel-info-val">{travelInfo.timeDiff}</strong>
                  </div>
                </div>
                <div className="travel-info-chip">
                  <span className="travel-info-icon">🛂</span>
                  <div>
                    <span className="travel-info-label">관광 비자</span>
                    <strong className="travel-info-val">{travelInfo.visa}</strong>
                  </div>
                </div>
                <div className="travel-info-chip">
                  <span className="travel-info-icon">💵</span>
                  <div>
                    <span className="travel-info-label">현지 화폐</span>
                    <strong className="travel-info-val">{travelInfo.currency}</strong>
                  </div>
                </div>
              </section>
            );
          })()}

          {/* Price Trend Gauge */}
          {(() => {
            const discountPct = spotlight
              ? (query.cabin === "BUSINESS" ? spotlight.business_discount_pct : spotlight.economy_discount_pct) ?? 0
              : 0;

            let trendStatus = "deal-fair";
            let trendLabel = "✨ 적정 가격 구간 (평균 수준)";
            let gaugePos = "50%";

            if (discountPct >= 15) {
              trendStatus = "deal-hot";
              trendLabel = `🔥 최근 30일 평균 대비 ${discountPct}% 저렴한 역대급 특가!`;
              gaugePos = "15%";
            } else if (discountPct >= 5) {
              trendStatus = "deal-hot";
              trendLabel = `✨ 최근 평균 대비 ${discountPct}% 알뜰한 가격`;
              gaugePos = "32%";
            } else if (discountPct < -10) {
              trendStatus = "deal-high";
              trendLabel = "⚠️ 평소보다 다소 높은 가격 구간";
              gaugePos = "85%";
            }

            return (
              <section className="price-trend-card">
                <div className="price-trend-header">
                  <div className="price-trend-title">
                    <span>📊</span>
                    <strong>가격 수준 분석 & 최근 트렌드</strong>
                  </div>
                  <span className={`price-trend-badge ${trendStatus}`}>{trendLabel}</span>
                </div>
                <div className="price-gauge-wrap">
                  <div className="price-gauge-bar">
                    <div className="price-gauge-marker" style={{ left: gaugePos }} title={`현재 가격 위치: ${trendLabel}`} />
                  </div>
                  <div className="price-gauge-labels">
                    <span>🟢 특가 구간 ({lowestCellPrice ? formatMoney(lowestCellPrice) : "최저"})</span>
                    <span>🟡 평균</span>
                    <span>🔴 성수기 / 고가</span>
                  </div>
                </div>
              </section>
            );
          })()}

          {/* 2. Top 3 Recommended Date Combinations */}
          <section className="dest-section">
            <div className="section-header">
              <div>
                <h2 className="section-title">가장 저렴한 추천 날짜 조합 Top 3</h2>
                <p className="section-desc">해당 기간 중 항공권 가격이 가장 저렴한 출발-귀국 날짜 조합입니다.</p>
              </div>
              <span className="last-batch-tag">최근 가격 확인 {stamp(calendarResponse.last_batch_at)} · {dataModeLabel(calendarResponse.diagnostics)}</span>
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
                      <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
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
                          style={{ flex: 1, textAlign: "center" }}
                        >
                          항공편 비교 →
                        </Link>
                        <BoardingPassModal
                          origin={query.origin}
                          destinationCode={placeId}
                          cityName={calendar.destination?.city || placeId}
                          countryName={calendar.destination?.country || ""}
                          departDate={String(cell.depart_date)}
                          returnDate={String(cell.return_date)}
                          fare={fare}
                          cabin={query.cabin}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="panel-note">현재 선택한 조건에 맞는 날짜 조합이 없습니다.</p>
            )}
          </section>

          {/* 3. Simplified 2D Heatmap Fare Matrix */}
          <section className="dest-section">
            <details className="matrix-details" open>
              <summary className="matrix-summary-head">
                <div>
                  <h2 className="section-title">전체 출발·귀국일 가격 매트릭스</h2>
                  <p className="section-desc">출발일(세로)과 귀국일(가로)의 모든 조합별 최저가를 색상 히트맵으로 한눈에 비교합니다.</p>
                </div>
                <div className="heatmap-legend">
                  <span className="legend-item"><span className="legend-box fare-level-1" /> 최저가</span>
                  <span className="legend-item"><span className="legend-box fare-level-2" /> 저렴</span>
                  <span className="legend-item"><span className="legend-box fare-level-3" /> 보통</span>
                  <span className="legend-item"><span className="legend-box fare-level-4" /> 높음</span>
                </div>
              </summary>

              <div className="matrix-scroll-wrapper">
                <MatrixKeyboardNavigator>
                  <div className="matrix-scroll">
                    <table className="matrix-table" aria-label="출발일과 귀국일 조합별 최저가 비교 표">
                      <thead>
                        <tr>
                          <th>
                            <div className="matrix-corner-label">
                              <span>출발 ↓ / 귀국 →</span>
                            </div>
                          </th>
                          {calendar.return_dates.map((date) => (
                            <th key={date} scope="col">
                              <div className="matrix-header-cell">
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
                              <div className="matrix-header-cell">
                                <strong>{formatDate(departDate)}</strong>
                                <span>출발</span>
                              </div>
                            </th>
                            {calendar.return_dates.map((returnDate) => {
                              const cell = calendar.cells.find((item) => item.depart_date === departDate && item.return_date === returnDate);
                              if (!cell) {
                                return (
                                  <td key={returnDate}>
                                    <div className="matrix-cell-empty">-</div>
                                  </td>
                                );
                              }
                              const fare = query.cabin === "BUSINESS" ? cell.business_min_total : cell.economy_min_total;
                              const isLowest = lowestCellPrice !== null && fare === lowestCellPrice;
                              const heatClass = getHeatmapClass(fare);

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
                                    className={`matrix-cell-link ${heatClass} ${isLowest ? "is-best-fare" : ""}`}
                                    aria-label={`${formatDate(departDate)} 출발 ${formatDate(returnDate)} 귀국 ${String(cell.stay_nights)}박, 최저가 ${formatMoney(fare)}`}
                                  >
                                    {isLowest && <span className="cell-best-badge">최저가</span>}
                                    <strong className="cell-fare">{formatMoney(fare)}</strong>
                                    <span className="cell-nights">{String(cell.stay_nights)}박</span>
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
              </div>
            </details>
          </section>
        </>
      ) : (
        <div className="empty-state">목적지 정보를 불러올 수 없습니다.</div>
      )}
    </main>
  );
}
