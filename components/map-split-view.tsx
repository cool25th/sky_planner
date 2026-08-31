"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

import { saveRecentSearch } from "@/components/recent-searches";
import { TripCard } from "@/components/trip-card";
import type { MapDeal, MapQuery } from "@/lib/mock-market";
import { PRICE_DEFINITION_SHORT } from "@/lib/price-definition";
import { stamp } from "@/lib/format";
import { toTripCardModel } from "@/lib/trip-card";
import { href } from "@/lib/url";

// PERF-20260831-001: maplibre-gl(~1MB)을 /map 초기 JS에서 분리 — 지도는 어차피
// 클라이언트 WebGL이라 SSR이 불가능하고, 목록이 먼저 렌더되는 동안 스트리밍 로드된다.
const DealsMap = dynamic(() => import("@/components/deals-map").then((m) => m.DealsMap), {
  ssr: false,
  loading: () => <div className="map-canvas-fallback" aria-hidden="true" />,
});

interface MapSplitViewProps {
  deals: MapDeal[];
  query: MapQuery;
  lastBatchAt: string;
  lastSeenAt: string | null;
  dataMode: string;
}

export function MapSplitView({ deals, query, lastBatchAt, lastSeenAt, dataMode }: MapSplitViewProps) {
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
            <span className="results-sub">{PRICE_DEFINITION_SHORT}</span>
          </div>
          <span className="last-batch-tag">
            게시 {stamp(lastBatchAt)}{lastSeenAt ? ` · 관측 ${stamp(lastSeenAt)}` : ""} · {dataMode}
          </span>
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
            {deals.map((deal) => (
              <TripCard
                key={deal.destination_code}
                variant="compact"
                model={toTripCardModel(deal, query)}
                origin={query.origin}
                week={query.week}
                stayBucket={query.stay_bucket}
                selected={selectedCode === deal.destination_code}
                onMouseEnter={() => handleHoverCard(deal.destination_code)}
              />
            ))}
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
