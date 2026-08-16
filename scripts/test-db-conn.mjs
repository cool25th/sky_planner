import pkg from "pg";
const { Client } = pkg;

const connectionString = process.env.DATABASE_URL || "postgresql://sky_planner:sky_planner_dev@localhost:5433/sky_planner";

async function main() {
  console.log("Connecting to PostgreSQL database at:", connectionString);
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    console.log("✅ Successfully connected to database!");

    // Test query tables
    const tableRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    const tables = tableRes.rows.map(r => r.table_name);
    console.log("Available tables in public schema:", tables);

    if (!tables.includes("places") || !tables.includes("deals_current") || !tables.includes("offers")) {
      console.error("❌ Required tables are missing. Please initialize the DB using sql/init/001_schema.sql first.");
      process.exit(1);
    }

    console.log("Clearing existing mock data for testing...");
    await client.query("TRUNCATE TABLE offers CASCADE");
    await client.query("TRUNCATE TABLE deals_current CASCADE");
    await client.query("DELETE FROM places");

    console.log("Seeding mock places...");
    await client.query(`
      INSERT INTO places (place_id, place_type, display_name_ko, display_name_en, iata_code, country_code, region, latitude, longitude)
      VALUES 
        ('TYO', 'city', '도쿄', 'Tokyo', 'TYO', 'JP', 'JAPAN', 35.6762, 139.6503),
        ('LAX', 'city', '로스앤젤레스', 'Los Angeles', 'LAX', 'US', 'NORTH_AMERICA', 34.0522, -118.2437),
        ('FUK', 'city', '후쿠오카', 'Fukuoka', 'FUK', 'JP', 'JAPAN', 33.5902, 130.4017),
        ('TPE', 'city', '타이베이', 'Taipei', 'TPE', 'TW', 'GREATER_CHINA', 25.033, 121.5654)
    `);

    console.log("Seeding mock deals_current...");
    const sampleMatrix = {
      depart_dates: ["2026-03-23", "2026-03-24"],
      return_dates: ["2026-03-30", "2026-03-31"],
      generated_at: new Date().toISOString(),
      cells: {
        "2026-03-23_2026-03-30": {
          stay_nights: 7,
          economy_min_total_krw: 245000,
          economy_price_status: "active",
          economy_is_best_cell: true,
          business_min_total_krw: 590000,
          business_price_status: "active",
          business_is_best_cell: true
        }
      }
    };

    await client.query(`
      INSERT INTO deals_current (
        deal_id, origin, traveler, destination_city_id, destination_display_name, country_code, region, week, stay_bucket, latitude, longitude,
        economy_min_total_krw, economy_discount_pct, economy_badge_type, economy_price_status, economy_best_depart_date, economy_best_return_date, economy_best_offer_id, economy_representative_airline, economy_representative_source, economy_deep_link, economy_last_seen_at, economy_last_batch_at,
        business_min_total_krw, business_discount_pct, business_badge_type, business_price_status, business_best_depart_date, business_best_return_date, business_best_offer_id, business_representative_airline, business_representative_source, business_deep_link, business_last_seen_at, business_last_batch_at,
        calendar_matrix, warning_flags, enabled_sources, is_active
      ) VALUES (
        'ICN_TYO_2026-W13_5_7_adt1', 'ICN', 'adt1', 'TYO', '도쿄', 'JP', 'JAPAN', '2026-W13', '5_7', 35.6762, 139.6503,
        245000, 15, 'price_deal', 'active', '2026-03-23', '2026-03-30', 'offer-eco-tyo', '7C', 'skyscanner_affiliate', 'https://www.jejuair.net', NOW(), NOW(),
        590000, 20, 'official_promo', 'active', '2026-03-23', '2026-03-30', 'offer-biz-tyo', 'KE', 'korean_air_official', 'https://www.koreanair.com', NOW(), NOW(),
        $1, ARRAY['daily_batch_cached'], ARRAY['skyscanner_affiliate', 'korean_air_official'], true
      ), (
        'ICN_LAX_2026-W13_5_7_adt1', 'ICN', 'adt1', 'LAX', '로스앤젤레스', 'US', 'NORTH_AMERICA', '2026-W13', '5_7', 34.0522, -118.2437,
        1100000, 10, 'price_deal', 'active', '2026-03-23', '2026-03-30', 'offer-eco-lax', 'KE', 'skyscanner_affiliate', 'https://www.koreanair.com', NOW(), NOW(),
        3900000, 5, NULL, 'active', '2026-03-23', '2026-03-30', 'offer-biz-lax', 'DL', 'skyscanner_affiliate', 'https://www.delta.com', NOW(), NOW(),
        $1, ARRAY['daily_batch_cached'], ARRAY['skyscanner_affiliate'], true
      )
    `, [JSON.stringify(sampleMatrix)]);

    console.log("Seeding mock offers...");
    await client.query(`
      INSERT INTO offers (
        offer_id, itinerary_hash, schema_version, write_fingerprint, origin_airport, origin_city_id, destination_airport, destination_city_id,
        depart_date, return_date, stay_nights, stay_bucket, week, traveler, airline_code, airline_name, booking_source, source_type, cabin_group,
        total_price, currency, tax_included, normalized_total_krw, stop_count, stops_bucket, departure_time_local, arrival_time_local,
        return_departure_time_local, return_arrival_time_local, duration_minutes, deep_link, price_status, captured_at, is_price_changed,
        warning_flags, last_seen_at, last_batch_at, is_active
      ) VALUES 
        ('offer-eco-tyo', 'hash-eco-tyo', 1, 'fp-eco-tyo', 'ICN', 'ICN', 'NRT', 'TYO', '2026-03-23', '2026-03-30', 7, '5_7', '2026-W13', 'adt1', '7C', '제주항공', 'skyscanner_affiliate', 'meta_search', 'economy', 245000, 'KRW', true, 245000, 0, 'direct', '08:30', '11:00', '14:00', '16:30', 150, 'https://www.jejuair.net', 'active', NOW(), true, ARRAY['tax_included_total'], NOW(), NOW(), true),
        ('offer-biz-tyo', 'hash-biz-tyo', 1, 'fp-biz-tyo', 'ICN', 'ICN', 'NRT', 'TYO', '2026-03-23', '2026-03-30', 7, '5_7', '2026-W13', 'adt1', 'KE', '대한항공', 'korean_air_official', 'airline_official', 'business', 590000, 'KRW', true, 590000, 0, 'direct', '09:00', '11:30', '15:20', '17:50', 150, 'https://www.koreanair.com', 'active', NOW(), false, ARRAY['tax_included_total'], NOW(), NOW(), true),
        ('offer-eco-lax', 'hash-eco-lax', 1, 'fp-eco-lax', 'ICN', 'ICN', 'LAX', 'LAX', '2026-03-23', '2026-03-30', 7, '5_7', '2026-W13', 'adt1', 'KE', '대한항공', 'skyscanner_affiliate', 'meta_search', 'economy', 1100000, 'KRW', true, 1100000, 0, 'direct', '14:30', '09:00', '12:00', '17:30', 690, 'https://www.koreanair.com', 'active', NOW(), true, ARRAY['tax_included_total'], NOW(), NOW(), true)
    `);

    console.log("✅ Seeding completed successfully!");
  } catch (err) {
    console.error("❌ Database operation failed:", err);
  } finally {
    await client.end();
    console.log("Connection closed.");
  }
}

main();
