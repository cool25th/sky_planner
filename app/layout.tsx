import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import "maplibre-gl/dist/maplibre-gl.css";

import "./globals.css";

export const metadata: Metadata = {
  title: "Sky Planner Atlas",
  description: "한국 출발 항공 특가를 지도와 날짜 축으로 탐색하는 일 1회 배치 캐시 서비스",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Script id="figma-capture-loader" strategy="afterInteractive">
          {`
            (() => {
              if (typeof window === "undefined") return;
              if (!window.location.hash.includes("figmacapture=")) return;
              if (document.querySelector('script[data-figma-capture="true"]')) return;
              const script = document.createElement("script");
              script.src = "https://mcp.figma.com/mcp/html-to-design/capture.js";
              script.async = true;
              script.dataset.figmaCapture = "true";
              document.head.appendChild(script);
            })();
          `}
        </Script>
        <div className="ambient ambient-left" />
        <div className="ambient ambient-right" />
        <div className="site-shell">
          <div className="beta-banner">
            <span><strong>데모 데이터 안내:</strong> 본 서비스는 항공권 탐색을 위한 데모 데이터 및 예시 운임을 제공합니다. 실제 예약 및 최종 결제 금액은 해당 항공사 및 예약처에서 확인하시기 바랍니다.</span>
          </div>
          <header className="site-header">
            <Link href="/" className="site-brand">
              Sky Planner Atlas
            </Link>
            <nav className="site-nav">
              <Link href="/map">특가 지도</Link>
              <Link href="/offers">항공편 비교</Link>
              <Link href="/policies">가격 안내</Link>
              <Link href="/service-readiness">서비스 상태</Link>
            </nav>
          </header>
          {children}
          <footer className="site-footer">
            <div className="site-footer__links">
              <Link href="/terms">이용약관</Link>
              <Link href="/privacy">개인정보처리방침</Link>
              <Link href="/affiliate-disclosure">가격 데이터 안내</Link>
              <Link href="/policies">운영정책</Link>
            </div>
            <p className="site-footer__copy">
              &copy; 2026 Sky Planner Atlas. 한국 출발 여행자를 위한 지도 기반 항공권 탐색 서비스.
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
