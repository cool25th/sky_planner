"use client";

import { useState } from "react";

export interface PriceAlertModalProps {
  destinationCode: string;
  cityName: string;
  origin: string;
  currentLowestPrice: number | null;
  cabin: string;
}

export function PriceAlertModal({
  destinationCode,
  cityName,
  origin,
  currentLowestPrice,
  cabin,
}: PriceAlertModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [targetPrice, setTargetPrice] = useState(
    currentLowestPrice ? Math.round((currentLowestPrice * 0.9) / 10000) * 10000 : 200000
  );
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes("@")) {
      alert("올바른 이메일 주소를 입력해 주세요.");
      return;
    }

    try {
      const existing = JSON.parse(localStorage.getItem("sky_planner_price_alerts") || "[]");
      existing.push({
        id: `${destinationCode}_${Date.now()}`,
        destinationCode,
        cityName,
        origin,
        targetPrice,
        email,
        cabin,
        createdAt: Date.now(),
      });
      localStorage.setItem("sky_planner_price_alerts", JSON.stringify(existing));
      setSubmitted(true);
    } catch {
      // storage error
      setSubmitted(true);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setSubmitted(false);
  };

  return (
    <>
      <button
        type="button"
        className="status-btn-secondary"
        onClick={() => setIsOpen(true)}
        style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", padding: "8px 14px" }}
      >
        <span>🔔</span>
        <strong>가격 하락 알림 받기</strong>
      </button>

      {isOpen && (
        <div className="app-modal-overlay" onClick={handleClose} role="presentation">
          <div className="app-modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="app-modal-header">
              <h3>
                <span>🔔</span> {cityName} 특가 가격 알림
              </h3>
              <button type="button" className="app-modal-close" onClick={handleClose} aria-label="닫기">
                ✕
              </button>
            </div>

            <div className="app-modal-body">
              {submitted ? (
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <div style={{ fontSize: "3rem", marginBottom: "12px" }}>🎉</div>
                  <h4 style={{ fontSize: "1.2rem", fontWeight: 800, marginBottom: "8px" }}>
                    가격 알림 신청이 완료되었습니다!
                  </h4>
                  <p style={{ fontSize: "0.9rem", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
                    <strong>{cityName}</strong> 항공권이 <strong>{new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(targetPrice)}</strong> 이하로 떨어지면 <strong>{email}</strong>(으)로 가장 먼저 알려드릴게요.
                  </p>
                  <button
                    type="button"
                    className="status-btn-primary"
                    onClick={handleClose}
                    style={{ marginTop: "20px" }}
                  >
                    확인
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit}>
                  <p style={{ fontSize: "0.88rem", color: "var(--color-text-secondary)", marginBottom: "18px", lineHeight: 1.5 }}>
                    {origin} 출발 {cityName} 왕복 항공권 가격이 희망하시는 목표 가격 이하로 내려가면 즉시 이메일로 알림을 보내드립니다.
                  </p>

                  <div className="price-alert-field">
                    <label className="price-alert-label">목표 가격 설정 (원)</label>
                    <input
                      type="number"
                      step={5000}
                      className="price-alert-input"
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(Number(e.target.value))}
                      required
                    />
                    <div className="price-alert-tip">
                      현재 확인된 최저가: {currentLowestPrice ? `${new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(currentLowestPrice)}` : "-"}
                    </div>
                  </div>

                  <div className="price-alert-field">
                    <label className="price-alert-label">알림 받을 이메일 주소</label>
                    <input
                      type="email"
                      className="price-alert-input"
                      placeholder="example@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                    <div className="price-alert-tip">
                      스팸 메일 없이 목표 가격 도달 시에만 1회성 알림이 발송됩니다.
                    </div>
                  </div>

                  <div className="app-modal-footer" style={{ margin: "24px -24px -24px -24px" }}>
                    <button type="button" className="status-btn-secondary" onClick={handleClose}>
                      취소
                    </button>
                    <button type="submit" className="status-btn-primary">
                      알림 등록하기
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
