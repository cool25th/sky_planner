"use client";

import { useState } from "react";

import { TripCard } from "@/components/trip-card";
import type { TripCardModel } from "@/lib/trip-card";
import {
  AGE_GROUP_LABELS,
  audienceChipLabel,
  orderForAudience,
  type AgeGroup,
  type Season,
} from "@/lib/audience-calendar";

// UX-20260830-002: 연령대 칩으로 큐레이션 그리드를 재정렬한다. 후보는 서버가 점수순으로
// 12개를 전달하고(전체=상위 4 그대로), 연령 선택 시 친화도 순으로 4개를 다시 뽑는다.
type AudienceFilter = AgeGroup | "ALL";
const FILTERS: AudienceFilter[] = ["ALL", "20s", "30s", "40s"];
const GRID_SIZE = 4;

export interface AudienceEntry {
  destination_code: string;
  model: TripCardModel;
}

export function AudienceCuration({
  entries,
  season,
  origin,
  week,
  stayBucket,
}: {
  entries: AudienceEntry[];
  season: Season;
  origin: string;
  week: string;
  stayBucket: string;
}) {
  const [filter, setFilter] = useState<AudienceFilter>("ALL");

  const grid =
    filter === "ALL"
      ? entries.slice(0, GRID_SIZE)
      : orderForAudience(entries, filter, season)
          .slice(0, GRID_SIZE)
          .map((entry) => ({
            ...entry,
            model: {
              ...entry.model,
              reasons: [...entry.model.reasons, audienceChipLabel(filter, season)],
            },
          }));

  return (
    <div>
      <div className="audience-chips" role="group" aria-label="연령대별 추천">
        {FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            className={`audience-chip${filter === option ? " is-active" : ""}`}
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
          >
            {option === "ALL" ? "전체" : `${AGE_GROUP_LABELS[option]} 추천`}
          </button>
        ))}
      </div>
      <div className="deals-grid">
        {grid.map(({ destination_code, model }) => (
          <TripCard
            key={destination_code}
            variant="grid"
            model={model}
            origin={origin}
            week={week}
            stayBucket={stayBucket}
          />
        ))}
      </div>
    </div>
  );
}
