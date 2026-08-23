"use client";

import { useState } from "react";
import Link from "next/link";
import { href } from "@/lib/url";
import { formatMoney } from "@/lib/format";

interface DestinationMeta {
  code: string;
  city: string;
  country: string;
  region: string;
  fare: number;
  flightTime: string;
  timeDiff: string;
  visa: string;
  currency: string;
  theme: string;
}

const DESTINATION_DATA: Record<string, DestinationMeta> = {
  TYO: {
    code: "TYO",
    city: "도쿄",
    country: "일본",
    region: "동아시아",
    fare: 128000,
    flightTime: "약 2시간 15분",
    timeDiff: "시차 없음 (0h)",
    visa: "무비자 90일",
    currency: "일본 엔 (JPY)",
    theme: "쇼핑, 미식, 도심 문화",
  },
  OSA: {
    code: "OSA",
    city: "오사카",
    country: "일본",
    region: "동아시아",
    fare: 119000,
    flightTime: "약 1시간 45분",
    timeDiff: "시차 없음 (0h)",
    visa: "무비자 90일",
    currency: "일본 엔 (JPY)",
    theme: "식도락, 테마파크, 교토 연계",
  },
  FUK: {
    code: "FUK",
    city: "후쿠오카",
    country: "일본",
    region: "동아시아",
    fare: 103000,
    flightTime: "약 1시간 15분",
    timeDiff: "시차 없음 (0h)",
    visa: "무비자 90일",
    currency: "일본 엔 (JPY)",
    theme: "온천 휴양, 미식, 근교 여행",
  },
  BKK: {
    code: "BKK",
    city: "방콕",
    country: "태국",
    region: "동남아",
    fare: 235000,
    flightTime: "약 5시간 45분",
    timeDiff: "2시간 느림 (-2h)",
    visa: "무비자 90일",
    currency: "태국 바트 (THB)",
    theme: "야시장, 루프탑 바, 럭셔리 호캉스",
  },
  DAD: {
    code: "DAD",
    city: "다낭",
    country: "베트남",
    region: "동남아",
    fare: 215000,
    flightTime: "약 4시간 30분",
    timeDiff: "2시간 느림 (-2h)",
    visa: "무비자 45일",
    currency: "베트남 동 (VND)",
    theme: "리조트 휴양, 해변, 가성비 스파",
  },
  TPE: {
    code: "TPE",
    city: "타이베이",
    country: "대만",
    region: "동아시아",
    fare: 198000,
    flightTime: "약 2시간 30분",
    timeDiff: "1시간 느림 (-1h)",
    visa: "무비자 90일",
    currency: "대만 달러 (TWD)",
    theme: "야시장 미식, 지우펀, 근교 투어",
  },
  PAR: {
    code: "PAR",
    city: "파리",
    country: "프랑스",
    region: "유럽",
    fare: 740000,
    flightTime: "약 12시간 30분",
    timeDiff: "8시간 느림 (-8h)",
    visa: "무비자 90일",
    currency: "유로 (EUR)",
    theme: "미술관, 에펠탑, 유서 깊은 건축",
  },
};

export function DestinationCompareModal({ currentPlaceId }: { currentPlaceId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [dest1Code, setDest1Code] = useState(currentPlaceId in DESTINATION_DATA ? currentPlaceId : "TYO");
  const [dest2Code, setDest2Code] = useState(dest1Code === "OSA" ? "TYO" : "OSA");

  const dest1 = DESTINATION_DATA[dest1Code] || DESTINATION_DATA.TYO;
  const dest2 = DESTINATION_DATA[dest2Code] || DESTINATION_DATA.OSA;

  return (
    <>
      <button
        type="button"
        className="status-btn-secondary"
        onClick={() => setIsOpen(true)}
        style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", padding: "8px 14px" }}
      >
        <span>⚖️</span>
        <strong>1:1 여행지 비교</strong>
      </button>

      {isOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: 오버레이 클릭 닫기는 보조 수단이며 주 수단(닫기 버튼, select 포커스)이 별도로 존재한다
        <div className="app-modal-overlay" role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) setIsOpen(false);
            }}>
          <div
            className="app-modal-panel"
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: "620px" }}
          >
            <div className="app-modal-header">
              <h3>
                <span>⚖️</span> 여행지 1:1 조건 비교표
              </h3>
              <button type="button" className="app-modal-close" onClick={() => setIsOpen(false)} aria-label="닫기">
                ✕
              </button>
            </div>

            <div className="app-modal-body">
              <p style={{ fontSize: "0.86rem", color: "var(--color-text-secondary)", marginBottom: "16px" }}>
                고민 중인 두 여행지의 왕복 최저가, 비행시간, 시차, 비자 조건을 나란히 비교해 보세요.
              </p>

              {/* Destination Selectors */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
                <div>
                  <label className="price-alert-label" htmlFor="compare-dest-1">비교 도시 1</label>
                  <select
                    id="compare-dest-1"
                    className="price-alert-input"
                    value={dest1Code}
                    onChange={(e) => setDest1Code(e.target.value)}
                  >
                    {Object.values(DESTINATION_DATA).map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.city} ({d.code}) - {d.country}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="price-alert-label" htmlFor="compare-dest-2">비교 도시 2</label>
                  <select
                    id="compare-dest-2"
                    className="price-alert-input"
                    value={dest2Code}
                    onChange={(e) => setDest2Code(e.target.value)}
                  >
                    {Object.values(DESTINATION_DATA).map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.city} ({d.code}) - {d.country}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Side by side comparison grid */}
              <div className="dest-compare-grid">
                {/* Col 1 */}
                <div className="dest-compare-col">
                  <div className="dest-compare-header">
                    <h4 style={{ fontSize: "1.2rem", fontWeight: 800 }}>{dest1.city}</h4>
                    <span style={{ fontSize: "0.78rem", color: "var(--color-text-tertiary)" }}>{dest1.country} · {dest1.code}</span>
                  </div>

                  <div className="dest-compare-metric">
                    <span className="compare-metric-label">💰 왕복 최저가</span>
                    <strong style={{ color: "var(--color-primary)", fontSize: "1.1rem" }}>{formatMoney(dest1.fare)}</strong>
                  </div>

                  <div className="dest-compare-metric">
                    <span className="compare-metric-label">⏱️ 직항 비행시간</span>
                    <strong>{dest1.flightTime}</strong>
                  </div>

                  <div className="dest-compare-metric">
                    <span className="compare-metric-label">🌐 시차</span>
                    <strong>{dest1.timeDiff}</strong>
                  </div>

                  <div className="dest-compare-metric">
                    <span className="compare-metric-label">🛂 비자</span>
                    <strong>{dest1.visa}</strong>
                  </div>

                  <div className="dest-compare-metric">
                    <span className="compare-metric-label">💵 현지 화폐</span>
                    <strong>{dest1.currency}</strong>
                  </div>

                  <div className="dest-compare-metric">
                    <span className="compare-metric-label">🏖️ 추천 테마</span>
                    <span style={{ fontSize: "0.82rem", color: "var(--color-text-secondary)" }}>{dest1.theme}</span>
                  </div>

                  <Link
                    href={href(`/destination/${dest1.code}`, { origin: "SEL" })}
                    className="status-btn-primary"
                    style={{ textAlign: "center", marginTop: "8px", textDecoration: "none" }}
                    onClick={() => setIsOpen(false)}
                  >
                    {dest1.city} 날짜 매트릭스 →
                  </Link>
                </div>

                {/* Col 2 */}
                <div className="dest-compare-col">
                  <div className="dest-compare-header">
                    <h4 style={{ fontSize: "1.2rem", fontWeight: 800 }}>{dest2.city}</h4>
                    <span style={{ fontSize: "0.78rem", color: "var(--color-text-tertiary)" }}>{dest2.country} · {dest2.code}</span>
                  </div>

                  <div className="dest-compare-metric">
                    <span className="compare-metric-label">💰 왕복 최저가</span>
                    <strong style={{ color: "var(--color-primary)", fontSize: "1.1rem" }}>{formatMoney(dest2.fare)}</strong>
                  </div>

                  <div className="dest-compare-metric">
                    <span className="compare-metric-label">⏱️ 직항 비행시간</span>
                    <strong>{dest2.flightTime}</strong>
                  </div>

                  <div className="dest-compare-metric">
                    <span className="compare-metric-label">🌐 시차</span>
                    <strong>{dest2.timeDiff}</strong>
                  </div>

                  <div className="dest-compare-metric">
                    <span className="compare-metric-label">🛂 비자</span>
                    <strong>{dest2.visa}</strong>
                  </div>

                  <div className="dest-compare-metric">
                    <span className="compare-metric-label">💵 현지 화폐</span>
                    <strong>{dest2.currency}</strong>
                  </div>

                  <div className="dest-compare-metric">
                    <span className="compare-metric-label">🏖️ 추천 테마</span>
                    <span style={{ fontSize: "0.82rem", color: "var(--color-text-secondary)" }}>{dest2.theme}</span>
                  </div>

                  <Link
                    href={href(`/destination/${dest2.code}`, { origin: "SEL" })}
                    className="status-btn-primary"
                    style={{ textAlign: "center", marginTop: "8px", textDecoration: "none" }}
                    onClick={() => setIsOpen(false)}
                  >
                    {dest2.city} 날짜 매트릭스 →
                  </Link>
                </div>
              </div>
            </div>

            <div className="app-modal-footer">
              <button type="button" className="status-btn-secondary" onClick={() => setIsOpen(false)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
