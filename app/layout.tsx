import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import "maplibre-gl/dist/maplibre-gl.css";

import { SavedDealsDrawer } from "@/components/saved-deals-drawer";
import { ThemeToggle } from "@/components/theme-toggle";
import { CurrencyToggle } from "@/components/currency-toggle";
import { CommandPalette } from "@/components/command-palette";
import { resolveSupportContact } from "@/lib/service-contact";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sky Planner Atlas | 지도 기반 항공 특가 & 저렴한 날짜 탐색",
  description: "한국 출발 여행자를 위해 예산과 기간에 맞는 목적지와 저렴한 출발/귀국 날짜 조합을 지도에서 찾아주는 항공권 탐색 서비스",
  openGraph: {
    title: "Sky Planner Atlas | 지도 기반 항공 특가 탐색",
    description: "어디로 갈지 정하지 않아도 괜찮아요. 출발지, 일정, 예산만 선택하면 저렴한 목적지와 날짜를 지도에서 찾아드립니다.",
    siteName: "Sky Planner Atlas",
    locale: "ko_KR",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Sky Planner Atlas – 지도 기반 항공 특가 탐색",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sky Planner Atlas | 지도 기반 항공 특가 탐색",
    description: "한국 출발 항공 특가를 지도와 날짜 축으로 탐색하는 스마트 항공 플래너",
    images: ["/og-image.png"],
  },
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const supportContact = resolveSupportContact();
  return (
    <html lang="ko">
      <head>
        <link
          rel="preconnect"
          href="https://cdn.jsdelivr.net"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
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
        {/* Travelpayouts Drive — 가입 온보딩의 사이트 소유 확인·계정 언락용(사용자 승인 2026-08-28, DATA-20260818-003 경로).
            Data API 토큰 확보 후 유지 여부 재검토. 제거는 이 블록 삭제로 완결. */}
        <Script
          id="travelpayouts-drive"
          strategy="afterInteractive"
          src="https://tp-em.com/NTY3NzU0.js?t=567754"
          data-cmp-ab="2"
        />
        <div className="site-shell">
          <a href="#main" className="skip-link">본문으로 건너뛰기</a>
          {/* UX-20260831-003: live 서빙 중 "데모 데이터" 안내는 사실과 반대 — 모드 중립 참고 운임 고지로 교체.
              실시간/데모 구분은 data_mode 스탬프가 담당한다. */}
          <div className="beta-banner">
            <span><strong>운임 데이터 안내:</strong> 본 서비스의 운임은 일 1회 수집 기준 참고 운임입니다. 실제 예약 및 최종 결제 금액은 해당 항공사 및 예약처에서 확인하시기 바랍니다.</span>
          </div>
          <header className="site-header">
            <Link href="/" className="site-brand">
              <span className="brand-logo">✈️</span>
              <span className="brand-name">Sky Planner Atlas</span>
            </Link>
            <div className="header-right">
              <nav className="site-nav">
                <Link href="/map" className="nav-link">특가 지도</Link>
                <Link href="/policies" className="nav-link">가격 안내</Link>
              </nav>
              <CommandPalette />
              <SavedDealsDrawer />
              <CurrencyToggle />
              <ThemeToggle />
            </div>
          </header>
          <div id="main" tabIndex={-1} className="site-main">
            {children}
          </div>
          <footer className="site-footer">
            <div className="site-footer__links">
              <Link href="/terms">이용약관</Link>
              <Link href="/privacy">개인정보처리방침</Link>
              <Link href="/affiliate-disclosure">가격 데이터 안내</Link>
              <Link href="/policies">운영정책</Link>
              <Link href="/service-readiness">서비스 상태</Link>
              {/* UX-20260830-004: 사용자 목소리 수집 최소 채널 — 서포트 이메일이 유효할 때만 렌더 */}
              {supportContact.ok && supportContact.email ? (
                <a href={`mailto:${supportContact.email}?subject=${encodeURIComponent("[Sky Planner] 개선 요청")}`}>개선 요청</a>
              ) : null}
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
