"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <main className="status-page-container">
      <div className="status-icon">✈️⚠️</div>
      <h1 className="status-title">일시적인 오류가 발생했습니다</h1>
      <p className="status-desc">
        항공권 데이터를 불러오는 중 예기치 않은 문제가 발생했습니다.
        잠시 후 다시 시도해 주시거나 홈 화면으로 이동해 주세요.
      </p>
      <div className="status-actions">
        <button type="button" onClick={() => reset()} className="status-btn-primary">
          다시 시도하기
        </button>
        <Link href="/" className="status-btn-secondary">
          홈으로 돌아가기
        </Link>
        <Link href="/map" className="status-btn-secondary">
          특가 지도 보기
        </Link>
      </div>
    </main>
  );
}
