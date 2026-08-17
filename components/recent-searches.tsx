"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { href } from "@/lib/url";

function formatWeekNatural(code: string): string {
  const match = code.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return code;
  const year = parseInt(match[1], 10);
  const weekNum = parseInt(match[2], 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const startDay = new Date(jan4.getTime() + ((weekNum - 1) * 7 - (jan4.getUTCDay() || 7) + 1) * 86400000);
  const endDay = new Date(startDay.getTime() + 6 * 86400000);
  const m1 = startDay.getUTCMonth() + 1;
  const d1 = startDay.getUTCDate();
  const m2 = endDay.getUTCMonth() + 1;
  const d2 = endDay.getUTCDate();
  if (m1 === m2) {
    return `${m1}월 ${d1}일 ~ ${d2}일`;
  }
  return `${m1}월 ${d1}일 ~ ${m2}월 ${d2}일`;
}

export interface RecentSearchItem {
  id: string;
  origin: string;
  originLabel?: string;
  week: string;
  stay_bucket: string;
  stayLabel?: string;
  budget: number | null;
  region?: string;
  timestamp: number;
}

const STORAGE_KEY = "sky_planner_recent_searches";

export function saveRecentSearch(item: Omit<RecentSearchItem, "id" | "timestamp">) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: RecentSearchItem[] = raw ? JSON.parse(raw) : [];
    const id = `${item.origin}_${item.week}_${item.stay_bucket}_${item.budget ?? "all"}_${item.region ?? "all"}`;
    const next = [
      { ...item, id, timestamp: Date.now() },
      ...list.filter((x) => x.id !== id),
    ].slice(0, 5);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("recent_searches_updated"));
  } catch {
    // localStorage error fallback
  }
}

const STAY_LABELS: Record<string, string> = {
  "3_4": "3~4일",
  "5_7": "5~7일",
  "8_14": "8~14일",
};

export function RecentSearches() {
  const [items, setItems] = useState<RecentSearchItem[]>([]);

  const loadItems = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setItems(JSON.parse(raw));
      } else {
        setItems([]);
      }
    } catch {
      setItems([]);
    }
  };

  useEffect(() => {
    loadItems();
    const handleUpdate = () => loadItems();
    window.addEventListener("recent_searches_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("recent_searches_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  const removeItem = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const next = items.filter((x) => x.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setItems(next);
      window.dispatchEvent(new Event("recent_searches_updated"));
    } catch {
      // storage error
    }
  };

  if (items.length === 0) return null;

  return (
    <div className="recent-searches-container" aria-label="최근 검색 조건 목록">
      <span className="recent-searches-title">🕒 최근 검색:</span>
      <div className="recent-chips-list">
        {items.map((item) => {
          const stay = STAY_LABELS[item.stay_bucket] ?? item.stay_bucket;
          const weekLabel = formatWeekNatural(item.week);
          const budgetLabel = item.budget ? `${Math.floor(item.budget / 10000)}만원 이하` : null;
          const labelParts = [item.origin, weekLabel, stay, budgetLabel].filter(Boolean);

          return (
            <div key={item.id} className="recent-chip-badge">
              <Link
                href={href("/map", {
                  origin: item.origin,
                  week: item.week,
                  stay_bucket: item.stay_bucket,
                  budget: item.budget,
                  region: item.region || "ALL",
                })}
                className="recent-chip-link"
              >
                <span>{labelParts.join(" · ")}</span>
              </Link>
              <button
                type="button"
                className="recent-chip-remove"
                onClick={(e) => removeItem(item.id, e)}
                aria-label="이 검색 조건 삭제"
                title="삭제"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
