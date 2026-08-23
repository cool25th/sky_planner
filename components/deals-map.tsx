"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import maplibregl,
  { type LngLatBoundsLike, type Map as MaplibreMap, type StyleSpecification }
from "maplibre-gl";

import type { MapDeal, MapQuery } from "@/lib/mock-market";
import { clusterDeals, dealMinFare, type DealCluster } from "@/lib/map-clustering";
import { formatMoney, formatWeekNatural, stamp } from "@/lib/format";
import { href } from "@/lib/url";
import { STAY_BUCKET_LABELS, formatFareShort, interpolateGreatCircle, originCoordFor } from "@/lib/map-geo";

function mapStyle() {
  const styleUrl = process.env.NEXT_PUBLIC_MAPTILER_STYLE_URL;
  if (styleUrl) return styleUrl;

  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "&copy; OpenStreetMap contributors",
      },
    },
    layers: [
      {
        id: "osm",
        type: "raster",
        source: "osm",
      },
    ],
  } satisfies StyleSpecification;
}

type CameraState =
  | {
      center: [number, number];
      zoom: number;
      bounds?: never;
    }
  | {
      center?: never;
      zoom?: never;
      bounds: LngLatBoundsLike;
    };

function cameraForDeals(deals: MapDeal[]) {
  if (!deals.length) {
    return {
      center: [127.8, 32.2] as [number, number],
      zoom: 1.6,
    } satisfies CameraState;
  }

  if (deals.length === 1) {
    return {
      center: [deals[0].lon, deals[0].lat] as [number, number],
      zoom: 4.8,
    } satisfies CameraState;
  }

  const latitudes = deals.map((deal) => deal.lat);
  const longitudes = deals.map((deal) => deal.lon);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);

  return {
    bounds: [
      [minLon, minLat],
      [maxLon, maxLat],
    ] as [[number, number], [number, number]],
  } satisfies CameraState;
}

interface DealsMapProps {
  deals: MapDeal[];
  query: Pick<MapQuery, "origin" | "region" | "week" | "stay_bucket" | "traveler" | "cabin" | "budget">;
  selectedCode?: string | null;
  onSelectCode?: (code: string) => void;
}

export function DealsMap({ deals, query, selectedCode: controlledCode, onSelectCode }: DealsMapProps) {
  const router = useRouter();
  const mapRef = useRef<MaplibreMap | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);
  const [visibleCount, setVisibleCount] = useState(deals.length);
  const [internalCode, setInternalCode] = useState<string | null>(deals[0]?.destination_code ?? null);
  const selectedCode = controlledCode !== undefined ? controlledCode : internalCode;

  const setSelectedCode = useCallback((code: string | null) => {
    if (code) onSelectCode?.(code);
    setInternalCode(code);
  }, [onSelectCode]);

  const [webglSupported, setWebglSupported] = useState(true);
  const [clusters, setClusters] = useState<DealCluster<MapDeal>[]>(() =>
    deals.map((deal) => ({ deals: [deal], representative: deal, min_fare: dealMinFare(deal) })),
  );
  const [sheetState, setSheetState] = useState<"peek" | "half" | "full">("half");
  const clusterSignatureRef = useRef("");

  const camera = useMemo(() => cameraForDeals(deals), [deals]);
  const cameraBounds = "bounds" in camera ? camera.bounds : null;

  useEffect(() => {
    if (!controlledCode || !mapRef.current) return;
    const deal = deals.find((d) => d.destination_code === controlledCode);
    if (!deal) return;
    const map = mapRef.current;
    const bounds = map.getBounds();
    if (!bounds.contains([deal.lon, deal.lat])) {
      map.easeTo({
        center: [deal.lon, deal.lat],
        duration: 500,
      });
    }
  }, [controlledCode, deals]);

  useEffect(() => {
    // Check WebGL availability
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) {
        setWebglSupported(false);
        return;
      }
    } catch {
      setWebglSupported(false);
      return;
    }

    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let map: MaplibreMap;
    try {
      map = new maplibregl.Map({
        container,
        style: mapStyle(),
        attributionControl: false,
        center: "center" in camera ? camera.center : [127.8, 32.2],
        zoom: "zoom" in camera ? camera.zoom : 1.6,
        cooperativeGestures: true,
      });
    } catch (err) {
      console.warn("MapLibre map creation error", err);
      setWebglSupported(false);
      return;
    }

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      if (cameraBounds) {
        map.fitBounds(cameraBounds, { padding: 72, duration: 0 });
      }

      // Add Arc Source and Layer
      map.addSource("route-arc", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.addLayer({
        id: "route-arc-layer",
        type: "line",
        source: "route-arc",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#2563eb",
          "line-width": 2.5,
          "line-opacity": 0.8,
          "line-dasharray": [2, 2],
        },
      });
    });

    map.on("moveend", () => {
      const bounds = map.getBounds();
      const nextVisible = deals.filter((deal) => bounds.contains([deal.lon, deal.lat])).length;
      setVisibleCount(nextVisible);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [camera, cameraBounds, deals]);

  // 줌/이동 시 화면 좌표 기반 클러스터 재계산. 구성이 바뀔 때만 다시 그린다.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const recompute = () => {
      const next = clusterDeals(deals, (deal) => {
        const point = map.project([deal.lon, deal.lat]);
        return { x: point.x, y: point.y };
      });
      const signature = next.map((cluster) => cluster.deals.map((deal) => deal.destination_code).join("+")).join("|");
      if (signature !== clusterSignatureRef.current) {
        clusterSignatureRef.current = signature;
        setClusters(next);
      }
    };
    recompute();
    map.on("move", recompute);
    return () => {
      map.off("move", recompute);
    };
  }, [deals]);

  // Update Route Arc line when selectedCode or query.origin changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;

    const originCoord = originCoordFor(query.origin);
    const selectedDeal = deals.find((d) => d.destination_code === selectedCode);

    const source = map.getSource("route-arc") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    if (!selectedDeal) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const arcCoordinates = interpolateGreatCircle(originCoord, [selectedDeal.lon, selectedDeal.lat]);
    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: arcCoordinates,
          },
        },
      ],
    });
  }, [deals, query.origin, selectedCode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markerRefs.current.forEach((marker) => {
      marker.remove();
    });
    markerRefs.current = [];

    const nextMarkers = clusters.map((cluster) => {
      const markerEl = document.createElement("button");
      markerEl.type = "button";
      if (cluster.deals.length > 1) {
        markerEl.className = `deal-marker deal-marker--cluster ${selectedCode === cluster.representative.destination_code ? "is-selected" : ""}`;
        markerEl.setAttribute(
          "aria-label",
          `클러스터 ${cluster.deals.length}개 목적지, 최저가 ${formatMoney(cluster.min_fare)}, 대표 ${cluster.representative.city}`,
        );
        markerEl.innerHTML = `
          <span class="deal-marker__city">${cluster.representative.city}</span>
          <span class="deal-marker__fare">${formatFareShort(cluster.min_fare)}</span>
        `;
        markerEl.addEventListener("mouseenter", () => setSelectedCode(cluster.representative.destination_code));
        markerEl.addEventListener("click", () => {
          setSelectedCode(cluster.representative.destination_code);
          map.easeTo({
            center: [cluster.representative.lon, cluster.representative.lat],
            zoom: Math.min(map.getZoom() + 2, 12),
            duration: 600,
          });
        });
      } else {
        const deal = cluster.representative;
        const isSelected = selectedCode === deal.destination_code;
        markerEl.className = `deal-marker ${isSelected ? "is-selected" : ""}`;
        markerEl.setAttribute("aria-label", `${deal.city} 최저가 ${formatMoney(deal.economy_min_total ?? deal.business_min_total)}`);
        markerEl.innerHTML = `
          ${isSelected ? `<span class="deal-marker__city">${deal.city}</span>` : ""}
          <span class="deal-marker__fare">${formatFareShort(deal.economy_min_total ?? deal.business_min_total)}</span>
        `;
        markerEl.addEventListener("mouseenter", () => setSelectedCode(deal.destination_code));
        markerEl.addEventListener("click", () => {
          setSelectedCode(deal.destination_code);
            router.push(
              href(`/destination/${deal.destination_code}`, {
                origin: query.origin,
                week: query.week,
                region: query.region,
                stay_bucket: query.stay_bucket,
                traveler: query.traveler,
                cabin: query.cabin,
                budget: query.budget,
              }),
            );
        });
      }

      return new maplibregl.Marker({ element: markerEl, anchor: "bottom" })
        .setLngLat([cluster.representative.lon, cluster.representative.lat])
        .addTo(map);
    });

    markerRefs.current = nextMarkers;
    const bounds = map.getBounds();
    const nextVisible = deals.filter((deal) => bounds.contains([deal.lon, deal.lat])).length;
    setVisibleCount(nextVisible);

    return () => {
      nextMarkers.forEach((marker) => {
        marker.remove();
      });
    };
  }, [clusters, deals, query.budget, query.cabin, query.origin, query.region, query.stay_bucket, query.traveler, query.week, router, selectedCode, setSelectedCode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (cameraBounds) {
      map.fitBounds(cameraBounds, { padding: 72, duration: 600 });
    } else {
      map.easeTo({ center: camera.center, zoom: camera.zoom, duration: 600 });
    }
  }, [camera, cameraBounds]);

  const selection = deals.find((deal) => deal.destination_code === selectedCode) ?? deals[0] ?? null;

  if (!webglSupported) {
    return (
      <section className="map-surface fallback-list-surface" aria-label="항공 특가 목록 대체 뷰">
        <div className="fallback-header">
          <h3>지도 대체 목록 뷰 (WebGL Fallback)</h3>
          <p className="panel-note">브라우저 그래픽 가속을 사용할 수 없어 목록 형식으로 특가를 표시합니다.</p>
        </div>
        <div className="fallback-deals-grid">
          {deals.map((deal) => (
            <button
              key={deal.destination_code}
              type="button"
              className="fallback-deal-card"
              onClick={() => {
                router.push(
                  href(`/destination/${deal.destination_code}`, {
                    origin: query.origin,
                    week: query.week,
                    region: query.region,
                    stay_bucket: query.stay_bucket,
                    traveler: query.traveler,
                    cabin: query.cabin,
                    budget: query.budget,
                  }),
                );
              }}
            >
              <div>
                <strong>{deal.city}</strong>
                <span className="panel-note"> · {deal.country}</span>
              </div>
              <div className="fallback-fare">
                {formatMoney(deal.economy_min_total ?? deal.business_min_total)}
              </div>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="map-surface">
      <div ref={containerRef} className="map-canvas" />
      <div className="map-overlay map-overlay--top">
        <div className="map-chip">
          <span>표시된 도시</span>
          <strong>{visibleCount}개</strong>
        </div>
        <div className="map-chip">
          <span>검색 조건</span>
          <strong>{query.origin} · {formatWeekNatural(query.week)}</strong>
        </div>
      </div>
      {selection ? (
        <div className={`map-overlay map-overlay--bottom map-bottom-sheet is-sheet-${sheetState}`}>
          <div className="sheet-drag-bar">
            <button
              type="button"
              className="sheet-drag-handle"
              aria-label={`바텀시트 크기 조절 (현재: ${sheetState === "peek" ? "접힘" : sheetState === "half" ? "중간" : "전체"})`}
              onClick={() => {
                setSheetState((prev) => (prev === "peek" ? "half" : prev === "half" ? "full" : "peek"));
              }}
            >
              <span className="sheet-handle-indicator" />
              <span className="sheet-handle-label">
                {sheetState === "peek" ? "▲ 특가 정보 보기" : sheetState === "half" ? "▲ 더보기" : "▼ 접기"}
              </span>
            </button>
          </div>
          <div className="map-selection">
            <div>
              <p className="section-kicker">{selection.region_label}</p>
              <h3>{selection.city}</h3>
              <p className="panel-note">{selection.country}</p>
              <p className="panel-note">
                {STAY_BUCKET_LABELS[query.stay_bucket] ?? query.stay_bucket} ·{" "}
                {query.cabin === "BUSINESS" ? "비즈니스석" : query.cabin === "ECONOMY" ? "일반석" : "전체 좌석"} · 왕복 · 세금 포함 KRW
              </p>
              <p className="panel-note">가격 확인: {stamp(selection.last_seen_at || selection.last_batch_at)}</p>
              <button
                type="button"
                className="map-selection__cta"
                onClick={() => {
                  router.push(
                    href(`/destination/${selection.destination_code}`, {
                      origin: query.origin,
                      week: query.week,
                      region: query.region,
                      stay_bucket: query.stay_bucket,
                      traveler: query.traveler,
                      cabin: query.cabin,
                      budget: query.budget,
                    }),
                  );
                }}
              >
                {selection.city} 날짜별 특가 보기 →
              </button>
            </div>
            <div className="map-selection__fares">
              <div>
                <span>일반석</span>
                <strong>{formatMoney(selection.economy_min_total)}</strong>
              </div>
              <div>
                <span>비즈니스석</span>
                <strong>{formatMoney(selection.business_min_total)}</strong>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
