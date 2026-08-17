"use client";

import { useState } from "react";

export function ShareButton({
  title = "Sky Planner Atlas 특가 공유",
  text = "이 항공 특가 조건을 확인해보세요!",
  className = "",
}: {
  title?: string;
  text?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    if (typeof window === "undefined") return;

    const url = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text,
          url,
        });
        return;
      } catch (err) {
        // Fallback to clipboard if user dismissed or error
        if ((err as Error).name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      // clipboard write error
    }
  };

  return (
    <button
      type="button"
      className={`share-btn ${copied ? "is-copied" : ""} ${className}`}
      onClick={handleShare}
      aria-label="현재 탐색 조건 공유하기"
      title="현재 조건 링크 복사 및 공유"
    >
      <span className="share-btn__icon">{copied ? "✓" : "🔗"}</span>
      <span className="share-btn__label">{copied ? "링크 복사 완료!" : "조건 공유"}</span>
    </button>
  );
}
