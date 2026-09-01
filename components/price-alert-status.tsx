"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { formatMoney } from "@/lib/format";
import {
  dealPriceLookup,
  evaluatePriceAlerts,
  parseStoredPriceAlerts,
  priceAlertsStorageKey,
  type AlertEvaluation,
} from "@/lib/price-alerts";

// UX-20260831-006 MVP(재방문 비교): 발송 인프라 없이도 알림 가치를 먼저 제공한다 —
// 이 브라우저에 저장된 목표가와 현재 최저가를 재방문 시점에 비교해 홈에 알려준다.
// 현재가 조회는 공개 map API 1회(출발지별)로 끝난다. 서버 저장·발송은 A3 계층.

const MAX_REACHED_ROWS = 3;

export function PriceAlertStatus() {
  const [result, setResult] = useState<{ reached: AlertEvaluation[]; pending: AlertEvaluation[] } | null>(null);

  useEffect(() => {
    const alerts = parseStoredPriceAlerts(localStorage.getItem(priceAlertsStorageKey()));
    if (!alerts.length) return;
    const origins = [...new Set(alerts.map((alert) => alert.origin))];
    Promise.all(
      origins.map((origin) =>
        fetch(`/api/deals/map?origin=${encodeURIComponent(origin)}`)
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null),
      ),
    ).then((responses) => {
      const deals = responses.flatMap((body) => (body && Array.isArray(body?.data?.deals) ? body.data.deals : []));
      if (!deals.length) return; // 조회 실패 시 과언 표시 대신 침묵
      setResult(evaluatePriceAlerts(alerts, dealPriceLookup(deals)));
    });
  }, []);

  if (!result || (!result.reached.length && !result.pending.length)) return null;

  return (
    <section className="price-alert-status" aria-label="가격 알림 상태" style={{ margin: "0 auto 20px", maxWidth: "1080px", padding: "0 20px" }}>
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "12px", padding: "14px 18px" }}>
        {result.reached.length > 0 ? (
          <>
            <p style={{ fontSize: "0.8rem", fontWeight: 700, margin: "0 0 8px", color: "var(--color-primary)" }}>
              🔔 설정하신 목표 가격에 도달했어요
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "6px" }}>
              {result.reached.slice(0, MAX_REACHED_ROWS).map(({ alert, currentPrice }) => (
                <li key={alert.id} style={{ fontSize: "0.88rem", display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                  <span>
                    <strong>{alert.cityName}</strong> 목표 {formatMoney(alert.targetPrice)} · 현재{" "}
                    <strong style={{ color: "var(--color-primary)" }}>{formatMoney(currentPrice ?? 0)}</strong>
                  </span>
                  <Link
                    href={`/offers?origin=${encodeURIComponent(alert.origin)}&destination=${encodeURIComponent(alert.destinationCode)}`}
                    style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}
                  >
                    항공편 보기 →
                  </Link>
                </li>
              ))}
            </ul>
            {result.pending.length > 0 && (
              <p style={{ fontSize: "0.78rem", color: "var(--color-text-secondary)", margin: "8px 0 0" }}>
                그 외 {result.pending.length}개 알림은 아직 목표가에 도달하지 않았어요.
              </p>
            )}
          </>
        ) : (
          <p style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", margin: 0 }}>
            🔔 가격 알림 {result.pending.length}개를 확인 중이에요 — 목표 가격에 도달하면 이곳에 표시됩니다.
          </p>
        )}
      </div>
    </section>
  );
}
