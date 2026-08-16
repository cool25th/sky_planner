-- ============================================================
-- sky_planner PostgreSQL 초기화 DDL
-- database.md 스키마를 PostgreSQL 테이블로 변환
-- ============================================================

-- 확장 모듈
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. places (장소 마스터)
-- ============================================================
CREATE TABLE places (
    place_id        TEXT PRIMARY KEY,
    place_type      TEXT NOT NULL CHECK (place_type IN ('city', 'airport', 'region')),
    display_name_ko TEXT NOT NULL,
    display_name_en TEXT NOT NULL,
    iata_code       TEXT,
    country_code    TEXT NOT NULL,
    region          TEXT NOT NULL,
    parent_place_id TEXT REFERENCES places(place_id),
    linked_airports TEXT[] DEFAULT '{}',
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_places_region ON places(region);
CREATE INDEX idx_places_type ON places(place_type);

-- ============================================================
-- 2. deals_current (대표가 — 지도/리스트용)
-- ============================================================
CREATE TABLE deals_current (
    deal_id                 TEXT PRIMARY KEY,
    schema_version          INTEGER DEFAULT 1,
    materialized_hash       TEXT,
    origin                  TEXT NOT NULL,
    traveler                TEXT DEFAULT 'adt1',
    destination_city_id     TEXT NOT NULL,
    destination_display_name TEXT NOT NULL,
    country_code            TEXT,
    region                  TEXT NOT NULL,
    week                    TEXT NOT NULL,
    stay_bucket             TEXT NOT NULL CHECK (stay_bucket IN ('3_4', '5_7', '8_14')),
    latitude                DOUBLE PRECISION,
    longitude               DOUBLE PRECISION,

    -- 이코노미 캐빈 상태
    economy_min_total_krw       NUMERIC,
    economy_discount_pct        NUMERIC,
    economy_badge_type          TEXT,
    economy_price_status        TEXT DEFAULT 'active',
    economy_best_depart_date    TEXT,
    economy_best_return_date    TEXT,
    economy_best_offer_id       TEXT,
    economy_representative_airline TEXT,
    economy_representative_source TEXT,
    economy_deep_link           TEXT,
    economy_last_seen_at        TIMESTAMPTZ,
    economy_last_batch_at       TIMESTAMPTZ,

    -- 비즈니스 캐빈 상태
    business_min_total_krw      NUMERIC,
    business_discount_pct       NUMERIC,
    business_badge_type         TEXT,
    business_price_status       TEXT DEFAULT 'active',
    business_best_depart_date   TEXT,
    business_best_return_date   TEXT,
    business_best_offer_id      TEXT,
    business_representative_airline TEXT,
    business_representative_source TEXT,
    business_deep_link          TEXT,
    business_last_seen_at       TIMESTAMPTZ,
    business_last_batch_at      TIMESTAMPTZ,

    -- calendar matrix (JSONB)
    calendar_matrix             JSONB DEFAULT '{}',

    warning_flags               TEXT[] DEFAULT '{}',
    enabled_sources             TEXT[] DEFAULT '{}',
    is_active                   BOOLEAN DEFAULT TRUE,
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deals_origin_week ON deals_current(origin, week, stay_bucket, traveler);
CREATE INDEX idx_deals_region ON deals_current(region, is_active);
CREATE INDEX idx_deals_destination ON deals_current(destination_city_id);

-- ============================================================
-- 3. offers (항공편 상세)
-- ============================================================
CREATE TABLE offers (
    offer_id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    itinerary_hash          TEXT,
    schema_version          INTEGER DEFAULT 1,
    write_fingerprint       TEXT,
    source_job_id           TEXT,
    execution_id            TEXT,
    parser_version          TEXT,
    schema_validator        TEXT,
    capture_channel         TEXT CHECK (capture_channel IN ('xhr', 'graphql', 'html_state')),
    raw_payload_ref         TEXT,

    origin_airport          TEXT NOT NULL,
    origin_city_id          TEXT,
    destination_airport     TEXT NOT NULL,
    destination_city_id     TEXT,

    depart_date             DATE NOT NULL,
    return_date             DATE,
    stay_nights             INTEGER,
    stay_bucket             TEXT CHECK (stay_bucket IN ('3_4', '5_7', '8_14')),
    week                    TEXT,
    traveler                TEXT DEFAULT 'adt1',

    airline_code            TEXT NOT NULL,
    airline_name            TEXT,
    operating_airline_code  TEXT,
    operating_airline_name  TEXT,
    booking_source          TEXT,
    source_type             TEXT CHECK (source_type IN ('meta_search', 'airline_official', 'promo_page')),

    cabin_group             TEXT NOT NULL CHECK (cabin_group IN ('economy', 'premium_economy', 'business', 'first')),
    cabin_label_raw         TEXT,
    fare_brand_raw          TEXT,

    total_price             NUMERIC NOT NULL CHECK (total_price > 0),
    currency                TEXT NOT NULL,
    tax_included            BOOLEAN DEFAULT TRUE,
    normalized_total_krw    NUMERIC,
    fx_rate_source          TEXT DEFAULT 'kexim_daily',
    fx_rate_date            TEXT,

    stop_count              INTEGER DEFAULT 0,
    stops_bucket            TEXT CHECK (stops_bucket IN ('direct', '1stop', '2plus')),
    departure_time_local    TEXT,
    arrival_time_local      TEXT,
    return_departure_time_local TEXT,
    return_arrival_time_local   TEXT,
    duration_minutes        INTEGER,
    return_duration_minutes INTEGER,
    layover_duration_minutes INTEGER,
    free_baggage_allowance  TEXT,
    seats_left              INTEGER,
    is_codeshare            BOOLEAN DEFAULT FALSE,
    duration_ratio_vs_direct_baseline NUMERIC,
    quality_bucket          TEXT CHECK (quality_bucket IN ('preferred', 'acceptable', 'degraded', 'excluded')),
    price_anomaly_status    TEXT DEFAULT 'normal' CHECK (price_anomaly_status IN ('normal', 'anomaly')),
    price_anomaly_reason    TEXT,

    deep_link               TEXT,
    bookability_status      TEXT DEFAULT 'available' CHECK (bookability_status IN ('available', 'uncertain', 'sold_out')),
    price_status            TEXT DEFAULT 'active' CHECK (price_status IN ('active', 'stale', 'sold_out')),
    captured_at             TIMESTAMPTZ DEFAULT NOW(),
    is_price_changed        BOOLEAN DEFAULT FALSE,
    warning_flags           TEXT[] DEFAULT '{}',
    last_seen_at            TIMESTAMPTZ DEFAULT NOW(),
    last_batch_at           TIMESTAMPTZ,

    is_active               BOOLEAN DEFAULT TRUE,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_offers_route ON offers(origin_airport, destination_city_id, depart_date, return_date, traveler, is_active);
CREATE INDEX idx_offers_price ON offers(normalized_total_krw ASC) WHERE is_active = TRUE;
CREATE INDEX idx_offers_airline ON offers(airline_code);
CREATE INDEX idx_offers_fingerprint ON offers(write_fingerprint);

-- ============================================================
-- 4. fare_snapshots (수집 이력)
-- ============================================================
CREATE TABLE fare_snapshots (
    snapshot_id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    snapshot_key            TEXT,
    source_job_id           TEXT,
    execution_id            TEXT,
    collected_at            TIMESTAMPTZ DEFAULT NOW(),
    quote_type              TEXT CHECK (quote_type IN ('batch', 'promo')),
    write_fingerprint       TEXT,

    origin                  TEXT NOT NULL,
    destination_city_id     TEXT,
    depart_date             DATE NOT NULL,
    return_date             DATE,
    stay_bucket             TEXT,
    traveler                TEXT DEFAULT 'adt1',
    airline_code            TEXT,
    cabin_group             TEXT NOT NULL,

    tax_included            BOOLEAN DEFAULT TRUE,
    total_price             NUMERIC NOT NULL,
    currency                TEXT NOT NULL,
    normalized_total_krw    NUMERIC,
    fx_rate_source          TEXT DEFAULT 'kexim_daily',
    fx_rate_date            TEXT,

    source_id               TEXT,
    parser_version          TEXT,
    capture_channel         TEXT,
    raw_payload_ref         TEXT,
    verification_status     TEXT DEFAULT 'unverified' CHECK (verification_status IN ('verified', 'unverified', 'failed')),
    price_anomaly_status    TEXT DEFAULT 'normal',
    expire_at               TIMESTAMPTZ
);

CREATE INDEX idx_snapshots_route ON fare_snapshots(origin, destination_city_id, cabin_group, stay_bucket, traveler);
CREATE INDEX idx_snapshots_collected ON fare_snapshots(collected_at DESC);
CREATE INDEX idx_snapshots_expire ON fare_snapshots(expire_at);

-- ============================================================
-- 5. deal_history_daily (일별 아카이브)
-- ============================================================
CREATE TABLE deal_history_daily (
    id                      TEXT PRIMARY KEY,
    date                    DATE NOT NULL,
    deal_id                 TEXT NOT NULL,
    origin                  TEXT NOT NULL,
    destination_city_id     TEXT,
    week                    TEXT,
    stay_bucket             TEXT,
    traveler                TEXT DEFAULT 'adt1',
    economy_min_total_krw   NUMERIC,
    business_min_total_krw  NUMERIC,
    economy_price_status    TEXT,
    business_price_status   TEXT,
    archived_at             TIMESTAMPTZ DEFAULT NOW(),
    expire_at               TIMESTAMPTZ
);

CREATE INDEX idx_history_date ON deal_history_daily(date, deal_id);
CREATE INDEX idx_history_expire ON deal_history_daily(expire_at);

-- ============================================================
-- 6. deal_baselines (특가 기준선)
-- ============================================================
CREATE TABLE deal_baselines (
    baseline_key            TEXT PRIMARY KEY,
    origin                  TEXT NOT NULL,
    destination_city_id     TEXT NOT NULL,
    stay_bucket             TEXT NOT NULL,
    traveler                TEXT DEFAULT 'adt1',
    fx_rate_source          TEXT DEFAULT 'kexim_daily',
    fx_rate_date            TEXT,

    economy_avg_30d_krw     NUMERIC,
    economy_avg_90d_krw     NUMERIC,
    economy_sample_30d      INTEGER DEFAULT 0,
    economy_sample_90d      INTEGER DEFAULT 0,

    business_avg_30d_krw    NUMERIC,
    business_avg_90d_krw    NUMERIC,
    business_sample_30d     INTEGER DEFAULT 0,
    business_sample_90d     INTEGER DEFAULT 0,

    computed_at             TIMESTAMPTZ DEFAULT NOW(),
    expire_at               TIMESTAMPTZ
);

-- ============================================================
-- 7. promotions (프로모션)
-- ============================================================
CREATE TABLE promotions (
    promo_id                TEXT PRIMARY KEY,
    airline_code            TEXT NOT NULL,
    title                   TEXT NOT NULL,
    region                  TEXT,
    destinations            TEXT[],
    cabin_group             TEXT,
    discount_pct            NUMERIC,
    booking_url             TEXT,
    source_url              TEXT,
    valid_from              TIMESTAMPTZ,
    valid_until             TIMESTAMPTZ,
    is_active               BOOLEAN DEFAULT TRUE,
    collected_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. source_jobs (수집 작업 기록)
-- ============================================================
CREATE TABLE source_jobs (
    job_id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    execution_id            TEXT,
    source_id               TEXT NOT NULL,
    origin                  TEXT,
    target_region           TEXT,
    week                    TEXT,
    stay_bucket             TEXT,
    traveler                TEXT DEFAULT 'adt1',
    cabin_group             TEXT,
    status                  TEXT DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'skipped')),
    attempts                INTEGER DEFAULT 1,
    parser_version          TEXT,
    proxy_profile           TEXT,
    offers_found            INTEGER DEFAULT 0,
    offers_changed          INTEGER DEFAULT 0,
    snapshots_written       INTEGER DEFAULT 0,
    deals_recomputed        INTEGER DEFAULT 0,
    schema_validation_failed_count INTEGER DEFAULT 0,
    price_anomaly_count     INTEGER DEFAULT 0,
    failure_code            TEXT,
    last_error              TEXT,
    artifact_prefix         TEXT,
    started_at              TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    expire_at               TIMESTAMPTZ
);

CREATE INDEX idx_jobs_source ON source_jobs(source_id, created_at DESC);
CREATE INDEX idx_jobs_expire ON source_jobs(expire_at);

-- ============================================================
-- 9. source_health (소스 상태 집계)
-- ============================================================
CREATE TABLE source_health (
    source_id               TEXT PRIMARY KEY,
    is_paused               BOOLEAN DEFAULT FALSE,
    enabled_by_flag         BOOLEAN DEFAULT TRUE,
    circuit_breaker_open    BOOLEAN DEFAULT FALSE,
    consecutive_failures    INTEGER DEFAULT 0,

    -- 24시간 통계 (JSONB)
    stats_24h               JSONB DEFAULT '{
        "total_jobs": 0,
        "success_count": 0,
        "failure_count": 0,
        "avg_latency_ms": 0,
        "block_count": 0,
        "schema_validation_failure_count": 0,
        "price_anomaly_count": 0,
        "write_amplification_ratio": 0
    }',

    last_success_at         TIMESTAMPTZ,
    last_failure_at         TIMESTAMPTZ,
    last_failure_code       TEXT,
    last_artifact_prefix    TEXT,
    last_checked_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 10. batch_state (배치 상태 — 기존 Firebase Storage 대체)
-- ============================================================
CREATE TABLE batch_state (
    key                     TEXT PRIMARY KEY,
    data                    JSONB NOT NULL DEFAULT '{}',
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- 초기 배치 상태 삽입
INSERT INTO batch_state (key, data) VALUES
    ('offer_hashes', '{}'),
    ('last_batch', '{"status": "init"}'),
    ('fx_rate_cache', '{}');

-- ============================================================
-- 11. admin_config (관리 설정)
-- ============================================================
CREATE TABLE admin_config (
    config_key              TEXT PRIMARY KEY,
    config_value            JSONB NOT NULL DEFAULT '{}',
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- updated_at 자동 갱신 트리거
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_places_updated_at BEFORE UPDATE ON places FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_deals_updated_at BEFORE UPDATE ON deals_current FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_offers_updated_at BEFORE UPDATE ON offers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_source_health_updated_at BEFORE UPDATE ON source_health FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_batch_state_updated_at BEFORE UPDATE ON batch_state FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_admin_config_updated_at BEFORE UPDATE ON admin_config FOR EACH ROW EXECUTE FUNCTION update_updated_at();
