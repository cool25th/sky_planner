"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { href } from "@/lib/url";

export interface RecentDestinationItem {
  code: string;
  city: string;
  country: string;
  timestamp: number;
}

const STORAGE_KEY = "sky_planner_recent_destinations";
const UPDATE_EVENT = "recent_destinations_updated";

function recordRecentDestination(item: Omit<RecentDestinationItem, "timestamp">) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: RecentDestinationItem[] = raw ? JSON.parse(raw) : [];
    const next = [
      { ...item, timestamp: Date.now() },
      ...list.filter((x) => x.code !== item.code),
    ].slice(0, 8);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(UPDATE_EVENT));
  } catch {
    // localStorage error fallback
  }
}

export function RecentDestinationTracker({ code, city, country }: { code: string; city: string; country: string }) {
  useEffect(() => {
    recordRecentDestination({ code, city, country });
  }, [code, city, country]);
  return null;
}

export function RecentDestinations() {
  const [items, setItems] = useState<RecentDestinationItem[]>([]);

  useEffect(() => {
    const loadItems = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        setItems(raw ? JSON.parse(raw) : []);
      } catch {
        setItems([]);
      }
    };
    loadItems();
    window.addEventListener(UPDATE_EVENT, loadItems);
    window.addEventListener("storage", loadItems);
    return () => {
      window.removeEventListener(UPDATE_EVENT, loadItems);
      window.removeEventListener("storage", loadItems);
    };
  }, []);

  const removeItem = (code: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const next = items.filter((x) => x.code !== code);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setItems(next);
      window.dispatchEvent(new Event(UPDATE_EVENT));
    } catch {
      // storage error
    }
  };

  if (items.length === 0) return null;

  return (
    <section className="recent-searches-container" aria-label="최근 본 목적지 목록">
      <span className="recent-searches-title">📍 최근 본 곳:</span>
      <div className="recent-chips-list">
        {items.map((item) => (
          <div key={item.code} className="recent-chip-badge">
            <Link href={href(`/destination/${item.code}`, {})} className="recent-chip-link">
              <span>{item.city} ({item.code})</span>
            </Link>
            <button
              type="button"
              className="recent-chip-remove"
              onClick={(e) => removeItem(item.code, e)}
              aria-label="이 목적지 삭제"
              title="삭제"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
