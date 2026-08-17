"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { href } from "@/lib/url";
import type { BookmarkedDeal } from "@/components/bookmark-button";

const STORAGE_KEY = "sky_planner_saved_deals";

function formatMoney(value: number | null) {
  if (value === null || value === 0) return "-";
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
}

const STAY_LABELS: Record<string, string> = {
  "3_4": "3-4일",
  "5_7": "5-7일",
  "8_14": "8-14일",
};

export function SavedDealsDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [deals, setDeals] = useState<BookmarkedDeal[]>([]);

  const loadDeals = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setDeals(JSON.parse(raw));
      } else {
        setDeals([]);
      }
    } catch {
      setDeals([]);
    }
  };

  useEffect(() => {
    loadDeals();

    const handleUpdate = () => loadDeals();
    window.addEventListener("saved_deals_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);

    return () => {
      window.removeEventListener("saved_deals_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const removeDeal = (destCode: string, origin: string) => {
    try {
      const next = deals.filter((d) => !(d.destinationCode === destCode && d.origin === origin));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setDeals(next);
      window.dispatchEvent(new Event("saved_deals_updated"));
    } catch {
      // storage error
    }
  };

  const clearAll = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setDeals([]);
      window.dispatchEvent(new Event("saved_deals_updated"));
    } catch {
      // storage error
    }
  };

  return (
    <>
      <button
        type="button"
        className="saved-deals-trigger"
        onClick={() => setIsOpen(true)}
        aria-label={`찜한 특가 목록 보기 (총 ${deals.length}개)`}
      >
        <span className="saved-icon">❤️</span>
        <span className="saved-text">찜한 특가</span>
        {deals.length > 0 && <span className="saved-count-badge">{deals.length}</span>}
      </button>

      {isOpen && (
        <div className="drawer-overlay" onClick={() => setIsOpen(false)} role="presentation">
          <div
            className="drawer-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="찜한 특가 목록"
          >
            <div className="drawer-header">
              <div>
                <h2>찜한 특가 목록</h2>
                <p className="panel-note">관심 있는 목적지와 운임을 비교하고 언제든 다시 탐색하세요.</p>
              </div>
              <button
                type="button"
                className="drawer-close-btn"
                onClick={() => setIsOpen(false)}
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            <div className="drawer-body">
              {deals.length === 0 ? (
                <div className="drawer-empty">
                  <span className="empty-icon">🤍</span>
                  <p>아직 찜한 특가가 없습니다.</p>
                  <span className="panel-note">
                    지도나 특가 목록에서 <strong>❤️</strong> 버튼을 눌러 관심 있는 여행지를 저장해 보세요.
                  </span>
                </div>
              ) : (
                <div className="saved-items-list">
                  {deals.map((item) => (
                    <article key={`${item.destinationCode}_${item.origin}`} className="saved-deal-item">
                      <div className="saved-item-main">
                        <div className="saved-item-header">
                          <strong>{item.cityName}</strong>
                          <span className="panel-note">{item.countryName}</span>
                        </div>
                        <div className="saved-item-meta">
                          <span>출발: {item.origin}</span>
                          <span>·</span>
                          <span>{STAY_LABELS[item.stayBucket] ?? item.stayBucket}</span>
                          <span>·</span>
                          <span>주간: {item.week}</span>
                        </div>
                        <div className="saved-item-price">
                          <span>최저</span>
                          <strong>{formatMoney(item.fare)}</strong>
                        </div>
                      </div>

                      <div className="saved-item-actions">
                        <Link
                          href={href(`/destination/${item.destinationCode}`, {
                            origin: item.origin,
                            week: item.week,
                            stay_bucket: item.stayBucket,
                          })}
                          className="saved-item-link"
                          onClick={() => setIsOpen(false)}
                        >
                          날짜 보기 →
                        </Link>
                        <button
                          type="button"
                          className="saved-item-remove"
                          onClick={() => removeDeal(item.destinationCode, item.origin)}
                          aria-label={`${item.cityName} 삭제`}
                          title="삭제"
                        >
                          ✕
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            {deals.length > 0 && (
              <div className="drawer-footer">
                <button
                  type="button"
                  className="drawer-share-btn"
                  onClick={async () => {
                    const codes = deals.map((d) => d.destinationCode).join(",");
                    const url = `${window.location.origin}/map?saved=${codes}`;
                    try {
                      await navigator.clipboard.writeText(url);
                      alert("찜한 특가 목록 공유 링크가 복사되었습니다!");
                    } catch {
                      prompt("공유 링크 복사:", url);
                    }
                  }}
                >
                  🔗 보관함 링크 복사
                </button>
                <button type="button" className="drawer-clear-btn" onClick={clearAll}>
                  전체 비우기
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
