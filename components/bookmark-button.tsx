"use client";

import { useEffect, useState } from "react";

export interface BookmarkedDeal {
  destinationCode: string;
  cityName: string;
  countryName: string;
  fare: number;
  origin: string;
  week: string;
  stayBucket: string;
  savedAt: string;
}

const STORAGE_KEY = "sky_planner_saved_deals";

export function BookmarkButton({
  deal,
  origin,
  week,
  stayBucket,
}: {
  deal: { destination_code: string; city: string; country: string; economy_min_total: number | null; business_min_total: number | null };
  origin: string;
  week: string;
  stayBucket: string;
}) {
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const list: BookmarkedDeal[] = JSON.parse(raw);
      setIsSaved(list.some((item) => item.destinationCode === deal.destination_code && item.origin === origin));
    } catch {
      // localStorage unavailable
    }
  }, [deal.destination_code, origin]);

  const toggleBookmark = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list: BookmarkedDeal[] = raw ? JSON.parse(raw) : [];

      if (isSaved) {
        const next = list.filter((item) => !(item.destinationCode === deal.destination_code && item.origin === origin));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setIsSaved(false);
      } else {
        const newItem: BookmarkedDeal = {
          destinationCode: deal.destination_code,
          cityName: deal.city,
          countryName: deal.country,
          fare: deal.economy_min_total ?? deal.business_min_total ?? 0,
          origin,
          week,
          stayBucket,
          savedAt: new Date().toISOString(),
        };
        const next = [newItem, ...list.filter((item) => !(item.destinationCode === deal.destination_code && item.origin === origin))].slice(0, 20);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setIsSaved(true);
      }
    } catch {
      // localStorage write error
    }
  };

  return (
    <button
      type="button"
      className={`bookmark-btn ${isSaved ? "is-active" : ""}`}
      onClick={toggleBookmark}
      aria-label={isSaved ? `${deal.city} 찜 해제` : `${deal.city} 관심 목적지 찜하기`}
      title={isSaved ? "관심 목적지에서 삭제" : "관심 목적지로 저장"}
    >
      <span>{isSaved ? "❤️" : "🤍"}</span>
    </button>
  );
}
