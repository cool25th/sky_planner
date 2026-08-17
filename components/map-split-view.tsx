"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";

import { BookmarkButton } from "@/components/bookmark-button";
import { DealsMap } from "@/components/deals-map";
import { saveRecentSearch } from "@/components/recent-searches";
import type { MapDeal, MapQuery } from "@/lib/mock-market";
import { href } from "@/lib/url";

function formatMoney(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function stamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

interface MapSplitViewProps {
  deals: MapDeal[];
  query: MapQuery;
  lastBatchAt: string;
}

export function MapSplitView({ deals, query, lastBatchAt }: MapSplitViewProps) {
  const [selectedCode, setSelectedCode] = useState<string | null>(deals[0]?.destination_code ?? null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    saveRecentSearch({
      origin: query.origin,
      week: query.week,
      stay_bucket: query.stay_bucket,
      budget: query.budget ?? null,
      region: query.region,
    });
  }, [query.origin, query.week, query.stay_bucket, query.budget, query.region]);

  const handleSelectFromMap = useCallback((code: string) => {
    setSelectedCode(code);
    const cardEl = document.getElementById(`deal-${code}`);
    if (cardEl && listContainerRef.current) {
      cardEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, []);

  const handleHoverCard = useCallback((code: string) => {
    setSelectedCode(code);
  }, []);

  return (
    <div className="map-split-layout">
      {/* 좌측 목적지 목록 패널 */}
      <aside className="destination-list-panel">
        <div className="list-panel-header">
          <div>
            <span className="results-count">
              검색 결과 <strong>{deals.length}개 도시</strong>
            </span>
            <span className="results-sub">왕복 총액 · 성인 1인 · 세금 포함</span>
          </div>
          <span className="last-batch-tag">최근 확인 {stamp(lastBatchAt)}</span>
        </div>

        {deals.length === 0 ? (
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
          <div ref={listContainerRef} className="destination-items-scroll">
            {deals.map((deal) => {
              const isSelected = selectedCode === deal.destination_code;
              return (
                <article
                  key={deal.destination_code}
                  className={`dest-list-card ${isSelected ? "is-active" : ""}`}
                  id={`deal-${deal.destination_code}`}
                  onMouseEnter={() => handleHoverCard(deal.destination_code)}
                >
                  <div className="dest-card-main">
                    <div className="dest-card-header">
                      <div>
                        <span className="dest-card-region">{deal.region_label}</span>
                        <h3 className="dest-card-city">{deal.city}</h3>
                        <span className="dest-card-country">
                          {deal.country} · {deal.destination_code}
                        </span>
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
                          {formatMoney(
                            query.cabin === "BUSINESS" ? deal.business_min_total : deal.economy_min_total,
                          )}
                        </strong>
                      </div>
                      <Link
                        href={href(`/destination/${deal.destination_code}`, {
                          origin: query.origin,
                          week: query.week,
                          region: query.region,
                          stay_bucket: query.stay_bucket,
                          traveler: query.traveler,
                          cabin: query.cabin,
                          budget: query.budget,
                          airlines: query.airlines.join(",") || null,
                        })}
                        className="dest-card-cta"
                      >
                        날짜 보기 →
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </aside>

      {/* 우측 풀스크린 지도 */}
      <section className="map-view-canvas">
        <DealsMap
          deals={deals}
          query={query}
          selectedCode={selectedCode}
          onSelectCode={handleSelectFromMap}
        />
      </section>
    </div>
  );
}
