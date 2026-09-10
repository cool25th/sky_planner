-- ============================================================
-- UX-20260910-005: 제휴 클릭 통계 — Travelpayouts /v2/statistics/sales
-- (group_by=date_marker) 일일 적재. 최소 형태 (date, sub_id, clicks)에
-- API가 함께 제공하는 지표(방문·검색·유료클릭·예약·수익)를 포함한다.
-- 회수는 scripts/collect-tp-click-stats.mjs(일일 배치 잡, allow_empty 준용).
-- ============================================================
CREATE TABLE IF NOT EXISTS affiliate_click_stats (
    stat_date       DATE NOT NULL,
    sub_id          TEXT NOT NULL,
    visitors        INTEGER DEFAULT 0,
    searches        INTEGER DEFAULT 0,
    clicks          INTEGER DEFAULT 0,
    paid_clicks     INTEGER DEFAULT 0,
    bookings        INTEGER DEFAULT 0,
    paid_bookings   INTEGER DEFAULT 0,
    profit_krw      NUMERIC DEFAULT 0,
    fetched_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (stat_date, sub_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_date ON affiliate_click_stats(stat_date DESC);
