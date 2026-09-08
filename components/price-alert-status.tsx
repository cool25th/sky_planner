"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { formatMoney, formatNumber } from "@/lib/format";
import {
  type AlertEvaluation,
  dealPriceLookup,
  evaluatePriceAlerts,
  offersHrefForAlert,
  parseStoredPriceAlerts,
  priceAlertsStorageKey,
  recordPriceAlertIntent,
} from "@/lib/price-alerts";

// UX-20260831-006 MVP(재방문 비교): 발송 인프라 없이도 알림 가치를 먼저 제공한다 —
// 이 브라우저에 저장된 목표가와 현재 최저가를 재방문 시점에 비교해 홈에 알려준다.
// 백로그[6]: "그때보다 ±N원"(저장 시점 관측가 대비)과 "알림 의향" 1st-party 카운트(local only) 추가.
// 현재가 조회는 공개 map API 1회(출발지별)로 끝난다. 서버 저장·발송은 A3 계층.

const MAX_REACHED_ROWS = 3;

function deltaLabel({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return null;
  const sign = delta > 0 ? "+" : "-";
  return `그때보다 ${sign}${formatNumber(Math.abs(delta))}원`;
}

export function PriceAlertStatus() {
  const [result, setResult] = useState<{ reached: AlertEvaluation[]; pending: AlertEvaluation[] } | null>(null);
  const [intentRecorded, setIntentRecorded] = useState(false);

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
              {result.reached.slice(0, MAX_REACHED_ROWS).map(({ alert, currentPrice, baselineDelta, deal }) => (
                <li key={alert.id} style={{ fontSize: "0.88rem", display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                  <span>
                    <strong>{alert.cityName}</strong> 목표 {formatMoney(alert.targetPrice)} · 현재{" "}
                    <strong style={{ color: "var(--color-primary)" }}>{formatMoney(currentPrice ?? 0)}</strong>
                    {deltaLabel(baselineDelta) ? (
                      <span style={{ color: baselineDelta.direction === "cheaper" ? "var(--color-best)" : "var(--color-text-tertiary)" }}>
                        {" "}· {deltaLabel(baselineDelta)}
                      </span>
                    ) : null}
                  </span>
                  <Link
                    // UX-20260902-001: depart/return 없는 /offers 링크는 postgres 조회가 비어 데모 폴백이 된다.
                    // 딜의 최저가 날짜를 붙여 live 오퍼 목록으로 연결한다.
                    href={offersHrefForAlert(alert, deal)}
                    style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}
                  >
                    항공편 보기 →
                  </Link>
                </li>
              ))}
            </ul>
            {result.pending.length > 0 && (
              <p style={{ fontSize: "0.78rem", color: "var(--color-text-secondary)", margin: "8px 0 0" }}>
                그 외 {result.pending.length}개 알림은 아직 목표가에 도달하지 않았어요
                {(() => {
                  const cheapestPending = result.pending
                    .filter((item) => item.baselineDelta.delta !== null)
                    .sort((a, b) => (a.baselineDelta.delta ?? 0) - (b.baselineDelta.delta ?? 0))[0];
                  const label = cheapestPending ? deltaLabel(cheapestPending.baselineDelta) : null;
                  return label ? ` — ${cheapestPending.alert.cityName}는 ${label}` : "";
                })()}
                .
              </p>
            )}
          </>
        ) : (
          <p style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", margin: 0 }}>
            🔔 가격 알림 {result.pending.length}개를 확인 중이에요 — 목표 가격에 도달하면 이곳에 표시됩니다
            {(() => {
              const cheapestPending = result.pending
                .filter((item) => item.baselineDelta.delta !== null)
                .sort((a, b) => (a.baselineDelta.delta ?? 0) - (b.baselineDelta.delta ?? 0))[0];
              const label = cheapestPending ? deltaLabel(cheapestPending.baselineDelta) : null;
              return label ? ` (${cheapestPending.alert.cityName} ${label})` : "";
            })()}
            .
          </p>
        )}

        {/* 백로그[6]: "알림 의향" — 서버 전송 없는 1st-party 카운트. A3(이메일 발송) 승격의 수요 근거. */}
        <p style={{ margin: "8px 0 0", fontSize: "0.75rem" }}>
          {intentRecorded ? (
            <span style={{ color: "var(--color-text-tertiary)" }}>알림 의향이 이 브라우저에 기록되었어요 — 이메일 발송이 준비되면 모달에서 안내드립니다.</span>
          ) : (
            <button
              type="button"
              className="price-alert-intent-btn"
              onClick={() => {
                recordPriceAlertIntent(result.reached[0]?.alert.destinationCode ?? result.pending[0]?.alert.destinationCode ?? "unknown");
                setIntentRecorded(true);
              }}
            >
              이메일 알림이 준비되면 받아볼래요
            </button>
          )}
        </p>
      </div>
    </section>
  );
}
