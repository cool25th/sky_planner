import unittest
from sky_collector.parsers.mapping_adapter import JsonPathMappingAdapter
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
