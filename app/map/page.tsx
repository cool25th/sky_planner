import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { MapFilterSelect } from "@/components/map-filter-select";
import { MapSplitView } from "@/components/map-split-view";
import { ServiceUnavailableNotice } from "@/components/service-unavailable-notice";
import { ShareButton } from "@/components/share-button";
import { dataModeLabel, resolveMetaResponse } from "@/lib/data-source";
import { resolveMapResponseWithBookableWeek } from "@/lib/map-week-fallback";
import { isPastWeek } from "@/lib/format";
import {
  parseMapQuery,
  formatWeekNatural,
  availableWeeks,
} from "@/lib/mock-market";
import { isServiceUnavailableDiagnostics } from "@/lib/service-unavailable";
import { href } from "@/lib/url";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MapPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const query = parseMapQuery(searchParams);
  const metaResponse = await resolveMetaResponse();
  const meta = metaResponse.data;

  // UX-20260830-003: 기본 주간(미지정) 특가가 소진되면 다음 주 실데이터로 자동 진행한다.
  const { response: mapResponse, week: resolvedWeek, weekAdvancedFrom } = await resolveMapResponseWithBookableWeek(
    query,
    { explicitWeek: Boolean(searchParams.week), nextWeek: meta.weeks[1]?.code ?? null },
  );
  const effectiveQuery = { ...query, week: resolvedWeek };
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
            defaultValue={effectiveQuery.origin}
            paramName="origin"
            options={originOptions}
          />
          <MapFilterSelect
            id="map-region-select"
            label="지역"
            defaultValue={effectiveQuery.region}
            paramName="region"
            options={regionOptions}
          />
          <MapFilterSelect
            id="map-week-select"
            label="시기"
            defaultValue={effectiveQuery.week}
            paramName="week"
            options={weekOptions}
          />
          <MapFilterSelect
            id="map-stay-select"
            label="기간"
            defaultValue={effectiveQuery.stay_bucket}
            paramName="stay_bucket"
            options={stayOptions}
          />
          <MapFilterSelect
            id="map-cabin-select"
            label="좌석"
            defaultValue={effectiveQuery.cabin}
            paramName="cabin"
            options={cabinOptions}
          />
        </div>

        <div className="filter-bar-aside">
          <ShareButton title="Sky Planner 특가 지도 공유" text="지도에서 출발지/기간별 항공 최저가를 확인해보세요!" />
        </div>
      </header>

      {/* UX-20260830-003: 기본 주간 특가 소진으로 다음 주를 보여주는 중이라는 안내 */}
      {weekAdvancedFrom && (
        <div className="beta-banner">
          <span>
            <strong>시기 자동 이동:</strong> {formatWeekNatural(weekAdvancedFrom)}에는 예약 가능한 특가가 마감되어{" "}
            {formatWeekNatural(effectiveQuery.week)} 특가를 보여드려요.
          </span>
        </div>
      )}

      {isPastWeek(effectiveQuery.week) && (
        <div className="beta-banner">
          <span>
            <strong>지난 시기 안내:</strong> {formatWeekNatural(effectiveQuery.week)} — 이미 지난 주간이라 표시할 특가가 없습니다.{" "}
            <Link href={href("/map", { ...effectiveQuery, week: availableWeeks(1)[0].code })}>이번 주간으로 다시 검색</Link>해 보세요.
          </span>
        </div>
      )}

      {/* 2. Split View (좌측 목록 + 우측 지도) */}
      {serviceUnavailable ? (
        <ServiceUnavailableNotice diagnostics={mapResponse.diagnostics} />
      ) : (
        <MapSplitView
          deals={map.deals}
          query={effectiveQuery}
          lastBatchAt={lastBatchAt}
          lastSeenAt={map.summary.last_seen_at}
          dataMode={dataModeLabel(mapResponse.diagnostics)}
        />
      )}
    </main>
  );
}
