"use client";

import { useState } from "react";

export interface BoardingPassModalProps {
  origin: string;
  originLabel?: string;
  destinationCode: string;
  cityName: string;
  countryName: string;
  departDate: string;
  returnDate: string;
  fare: number | null;
  cabin: string;
  airlineName?: string;
}

function formatMoney(value: number | null) {
  if (value === null || value === 0) return "-";
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
}

function formatDateDisplay(value: string) {
  try {
    const d = new Date(value);
    return `${d.getMonth() + 1}.${d.getDate()} (${["일", "월", "화", "수", "목", "금", "토"][d.getDay()]})`;
  } catch {
    return value;
  }
}

export function BoardingPassModal({
  origin,
  originLabel = "서울",
  destinationCode,
  cityName,
  countryName,
  departDate,
  returnDate,
  fare,
  cabin,
  airlineName = "추천 항공사",
}: BoardingPassModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const cabinLabel = cabin === "BUSINESS" ? "비즈니스석" : "일반석";

  const handleCopy = async () => {
    const shareText = `✈️ [Sky Planner Atlas] ${originLabel} ➔ ${cityName} 왕복 항공 특가 발견!\n\n` +
      `📅 일정: ${formatDateDisplay(departDate)} ~ ${formatDateDisplay(returnDate)}\n` +
      `💺 좌석: ${cabinLabel}\n` +
      `💰 왕복 최저가: ${formatMoney(fare)} (성인 1인 총액)\n\n` +
      `🔎 실시간 최저가 확인하기: ${window.location.href}`;

    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      prompt("공유 텍스트 복사:", shareText);
    }
  };

  return (
    <>
      <button
        type="button"
        className="top-date-card__link"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(true);
        }}
        style={{ background: "var(--color-surface-subtle)", color: "var(--color-text-primary)", border: "1px solid var(--color-border)" }}
        title="보딩패스 티켓 형태로 보기 & 공유"
      >
        🎫 티켓 카드
      </button>

      {isOpen && (
        <div className="app-modal-overlay" onClick={() => setIsOpen(false)} role="presentation">
          <div className="app-modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ maxWidth: "460px" }}>
            <div className="app-modal-header">
              <h3>
                <span>🎫</span> 특가 보딩패스 티켓
              </h3>
              <button type="button" className="app-modal-close" onClick={() => setIsOpen(false)} aria-label="닫기">
                ✕
              </button>
            </div>

            <div className="app-modal-body">
              {/* Boarding Pass Ticket */}
              <div className="boarding-pass-card">
                <div className="boarding-pass-top">
                  <span className="boarding-pass-brand">✈️ SKY PLANNER ATLAS</span>
                  <span className="boarding-pass-class">{cabinLabel}</span>
                </div>

                <div className="boarding-pass-route">
                  <div className="boarding-pass-city">
                    <h4>{origin}</h4>
                    <span>{originLabel}</span>
                  </div>
                  <div className="boarding-pass-plane">✈️</div>
                  <div className="boarding-pass-city" style={{ textAlign: "right" }}>
                    <h4>{destinationCode}</h4>
                    <span>{cityName}, {countryName}</span>
                  </div>
                </div>

                <div className="boarding-pass-details">
                  <div className="boarding-pass-item">
                    <label>출발일</label>
                    <strong>{formatDateDisplay(departDate)}</strong>
                  </div>
                  <div className="boarding-pass-item">
                    <label>귀국일</label>
                    <strong>{formatDateDisplay(returnDate)}</strong>
                  </div>
                  <div className="boarding-pass-item">
                    <label>대표 항공사</label>
                    <strong>{airlineName}</strong>
                  </div>
                </div>

                <div className="boarding-pass-barcode">
                  <div className="barcode-lines">||| | |||| | ||| |||| | ||</div>
                  <div className="barcode-price">{formatMoney(fare)}</div>
                </div>
              </div>

              <p style={{ fontSize: "0.8rem", color: "var(--color-text-tertiary)", marginTop: "14px", textAlign: "center" }}>
                카카오톡, 인스타그램, 메시지로 친구나 동행자에게 이 일정을 공유해 보세요.
              </p>
            </div>

            <div className="app-modal-footer">
              <button type="button" className="status-btn-secondary" onClick={() => setIsOpen(false)}>
                닫기
              </button>
              <button type="button" className="status-btn-primary" onClick={handleCopy}>
                {copied ? "✅ 복사 완료!" : "📋 일정 공유 텍스트 복사"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
