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
            <span><strong>Limited Beta:</strong> 비상업적 제한 공개 베타 버전입니다. 실제 예약 및 결제는 제휴처/항공사 공식 페이지에서 진행됩니다.</span>
          </div>
          <header className="site-header">
            <Link href="/" className="site-brand">
              Sky Planner Atlas
            </Link>
            <nav className="site-nav">
              <Link href="/fare-board">Fare Board</Link>
              <Link href="/map">Map</Link>
              <Link href="/offers">Offers</Link>
              <Link href="/service-readiness">Status</Link>
              <Link href="/policies">Policies</Link>
              <a href="/api/meta">API</a>
            </nav>
          </header>
          {children}
          <footer className="site-footer">
            <div className="site-footer__links">
              <Link href="/terms">이용약관</Link>
              <Link href="/privacy">개인정보처리방침</Link>
              <Link href="/affiliate-disclosure">제휴고지</Link>
              <Link href="/policies">운영정책</Link>
            </div>
            <p className="site-footer__copy">
              &copy; 2026 Sky Planner Atlas. Non-commercial Limited Beta on Firebase Spark Plan.
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
