"use client";

import { useEffect, useState } from "react";

export type Currency = "KRW" | "USD" | "JPY" | "EUR";

const CURRENCIES: Array<{ code: Currency; symbol: string; label: string; rate: number }> = [
  { code: "KRW", symbol: "₩", label: "원 (KRW)", rate: 1 },
  { code: "USD", symbol: "$", label: "달러 (USD)", rate: 0.00075 }, // 1 USD ≈ 1,330 KRW
  { code: "JPY", symbol: "¥", label: "엔 (JPY)", rate: 0.11 }, // 100 JPY ≈ 900 KRW
  { code: "EUR", symbol: "€", label: "유로 (EUR)", rate: 0.00068 }, // 1 EUR ≈ 1,470 KRW
];

const STORAGE_KEY = "sky_planner_currency";

export function CurrencyToggle() {
  const [current, setCurrent] = useState<Currency>("KRW");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem(STORAGE_KEY) as Currency | null;
    if (saved && CURRENCIES.some((c) => c.code === saved)) {
      setCurrent(saved);
    }
  }, []);

  const toggleCurrency = () => {
    const currentIndex = CURRENCIES.findIndex((c) => c.code === current);
    const nextIndex = (currentIndex + 1) % CURRENCIES.length;
    const nextCurrency = CURRENCIES[nextIndex].code;

    setCurrent(nextCurrency);
    localStorage.setItem(STORAGE_KEY, nextCurrency);
    window.dispatchEvent(
      new CustomEvent("currency_changed", { detail: { currency: nextCurrency } })
    );
  };

  if (!mounted) {
    return (
      <button type="button" className="currency-toggle-btn" aria-label="통화 선택">
        ₩ KRW
      </button>
    );
  }

  const active = CURRENCIES.find((c) => c.code === current) || CURRENCIES[0];

  return (
    <button
      type="button"
      className="currency-toggle-btn"
      onClick={toggleCurrency}
      title={`현재 통화: ${active.label} (클릭하여 변경)`}
      aria-label={`통화 변경 (현재: ${active.label})`}
    >
      {active.symbol} {active.code}
    </button>
  );
}
