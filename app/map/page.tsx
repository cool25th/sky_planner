import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { MapFilterSelect } from "@/components/map-filter-select";
import { MapSplitView } from "@/components/map-split-view";
import { ServiceUnavailableNotice } from "@/components/service-unavailable-notice";
import { ShareButton } from "@/components/share-button";
import { dataModeLabel, resolveMapResponse, resolveMetaResponse } from "@/lib/data-source";
import { isPastWeek } from "@/lib/format";
import {
  TRIP_BUCKETS,
  parseMapQuery,
  formatWeekNatural,
  availableWeeks,
} from "@/lib/mock-market";
import { isServiceUnavailableDiagnostics } from "@/lib/service-unavailable";
import { href } from "@/lib/url";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MapPage(props: { searchParams: SearchParams }) {
  const query = parseMapQuery(await props.searchParams);
  const [metaResponse, mapResponse] = await Promise.all([resolveMetaResponse(), resolveMapResponse(query)]);
  const meta = metaResponse.data;
  const map = mapResponse.data;
  const serviceUnavailable = isServiceUnavailableDiagnostics(mapResponse.diagnostics);
  if (serviceUnavailable) noStore();
  const lastBatchAt = mapResponse.last_batch_at;

  const originOptions = meta.origins.map((o) => ({ code: o.code, label: `${o.city} (${o.code})` }));
  const regionOptions = meta.regions.map((r) => ({ code: r.code, label: r.label }));
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
            id="map-region-select"
            label="지역"
            defaultValue={query.region}
            paramName="region"
            options={regionOptions}
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

      {isPastWeek(query.week) && (
        <div className="beta-banner">
          <span>
            <strong>지난 시기 안내:</strong> {formatWeekNatural(query.week)} — 이미 지난 주간이라 표시할 특가가 없습니다.{" "}
            <Link href={href("/map", { ...query, week: availableWeeks(1)[0].code })}>이번 주간으로 다시 검색</Link>해 보세요.
          </span>
        </div>
      )}

      {/* 2. Split View (좌측 목록 + 우측 지도) */}
      {serviceUnavailable ? (
        <ServiceUnavailableNotice diagnostics={mapResponse.diagnostics} />
      ) : (
        <MapSplitView
          deals={map.deals}
          query={query}
          lastBatchAt={lastBatchAt}
          lastSeenAt={map.summary.last_seen_at}
          dataMode={dataModeLabel(mapResponse.diagnostics)}
        />
      )}
    </main>
  );
}
