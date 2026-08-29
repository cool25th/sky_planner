import unittest
from datetime import datetime, timezone

from sky_collector.parsers.mapping_adapter import (
    JsonPathMappingAdapter,
    month_offset_iso,
    resolve_query_month_tokens,
)
from sky_collector.models.offer import CabinClass


class TestMappingAdapter(unittest.TestCase):
    def test_json_path_mapping(self):
        raw_quote = {
            "quoteId": "q-999",
            "from": "ICN",
            "toAirport": "KIX",
            "toCity": "OSA",
            "toNameKo": "오사카",
            "depart": "2026-03-24",
            "return": "2026-03-29",
            "airline": {"code": "KE", "name": "대한항공"},
            "bookingSource": "korean_air_official",
            "sourceType": "airline_official",
            "bookingUrl": "https://www.koreanair.com",
            "cabin": "business",
            "totalKrw": 650000,
            "stops": 0,
        }
        mapping_config = {
            "adapter": "json_path_mapping",
            "defaults": {
                "traveler": "adt1",
                "currency": "KRW",
                "tax_included": True,
                "country_code": "JP",
                "region": "JAPAN",
            },
            "fields": {
                "id": "quoteId",
                "origin_airport": "from",
                "destination_airport": "toAirport",
                "destination_city_id": "toCity",
                "destination_display_name": "toNameKo",
                "depart_date": "depart",
                "return_date": "return",
                "airline_code": "airline.code",
                "airline_name": "airline.name",
                "booking_source": "bookingSource",
                "source_type": "sourceType",
                "deep_link": "bookingUrl",
                "cabin_group": "cabin",
                "total_price": "totalKrw",
                "stop_count": "stops",
            },
        }

        offer = JsonPathMappingAdapter.map_offer(
            raw_quote=raw_quote,
            mapping_config=mapping_config,
            raw_payload_ref="runtime/test/raw.json",
            week="2026-W13",
        )

        self.assertEqual(offer.offer_id, "q-999")
        self.assertEqual(offer.origin_airport, "ICN")
        self.assertEqual(offer.destination_city_id, "OSA")
        self.assertEqual(offer.destination_display_name, "오사카")
        self.assertEqual(offer.airline_code, "KE")
        self.assertEqual(offer.cabin_group, CabinClass.BUSINESS)
        self.assertEqual(offer.total_price, 650000.0)


if __name__ == "__main__":
    unittest.main()


class TestTravelpayoutsMappingExtensions(unittest.TestCase):
    """DATA-20260818-003: flatten_nested·templates 매핑 확장(Node 런타임과 동일 규약)."""

    def test_flatten_nested_rows_injects_keys(self):
        from sky_collector.parsers.mapping_adapter import flatten_nested_rows

        rows = flatten_nested_rows({"TYO": {"1": {"price": 1}}}, ["destination_city_id", "offer_index"])
        self.assertEqual(rows, [{"destination_city_id": "TYO", "offer_index": "1", "price": 1}])

    def test_template_filters_date_and_dmy(self):
        from sky_collector.parsers.mapping_adapter import template_value

        row = {"departure_at": "2026-10-12T07:10:00+09:00", "origin": "ICN", "destination_city_id": "TYO"}
        self.assertEqual(template_value("{departure_at|date}", row, "depart_date"), "2026-10-12")
        self.assertEqual(
            template_value("{origin}{destination_city_id}{departure_at|dmy}", row, "deep_link"),
            "ICNTYO1210",
        )

    def test_template_missing_path_raises(self):
        from sky_collector.parsers.mapping_adapter import template_value

        with self.assertRaises(ValueError):
            template_value("{absent}", {"x": 1}, "id")

    def test_map_offer_prefers_templates_over_field_paths(self):
        config = {
            "templates": {"deep_link": "https://x/{origin_airport}"},
            "fields": {
                "origin_airport": "origin_airport",
                "airline_code": "airline",
                "airline_name": "airline",
                "total_price": "price",
            },
            "defaults": {},
        }
        offer = JsonPathMappingAdapter.map_offer(
            raw_quote={"origin_airport": "ICN", "airline": "7C", "price": 100},
            mapping_config=config,
            raw_payload_ref="ref",
            week="2026-W36",
        )
        self.assertEqual(offer.deep_link, "https://x/ICN")
        self.assertEqual(offer.airline_code, "7C")


# TEST-20260829-002: RECO-20260828-004 쿼리 상대 월 토큰 파서의 Node 계약 테스트 포팅 —
# 런타임 양측 파리티 주장의 Python 절반을 방어한다.
class TestQueryMonthTokens(unittest.TestCase):
    def test_month_offset_iso_resolves_yyyy_mm(self):
        now = datetime(2026, 8, 28, 1, 0, 0, tzinfo=timezone.utc)
        self.assertEqual(month_offset_iso(0, now), "2026-08")
        self.assertEqual(month_offset_iso(1, now), "2026-09")
        self.assertEqual(month_offset_iso(-1, now), "2026-07")

    def test_month_offset_iso_rolls_over_year_boundary(self):
        now = datetime(2026, 12, 15, tzinfo=timezone.utc)
        self.assertEqual(month_offset_iso(1, now), "2027-01")

    def test_resolve_query_month_tokens_substitutes_strings_only(self):
        now = datetime(2026, 8, 28, 1, 0, 0, tzinfo=timezone.utc)
        self.assertEqual(
            resolve_query_month_tokens({"origin": "ICN", "depart_date": "{month}:{month+2}", "currency": "krw"}, now),
            {"origin": "ICN", "depart_date": "2026-08:2026-10", "currency": "krw"},
        )
