import unittest

from backend import get_calendar, get_map_deals, get_meta, get_offers


class BackendTestCase(unittest.TestCase):
    def test_meta_contains_default_origins_and_weeks(self) -> None:
        meta = get_meta()
        data = meta["data"]
        origin_codes = {item["code"] for item in data["origins"]}
        self.assertIn("ICN", origin_codes)
        self.assertIn("PUS", origin_codes)
        self.assertTrue(data["weeks"])
        self.assertEqual(data["defaults"]["stay_bucket"], "5_7")
        self.assertEqual(meta["source_flags"], ["skyscanner_affiliate", "korean_air_official", "asiana_official"])

    def test_map_deals_split_economy_and_business(self) -> None:
        response = get_map_deals(
            {"origin": "ICN", "week": "2026-W13", "region": "ALL", "cabin": "ALL", "stay_bucket": "5_7", "traveler": "adt1"}
        )
        self.assertIn("last_batch_at", response)
        deals = {deal["destination_code"]: deal for deal in response["data"]["deals"]}
        self.assertIn("LAX", deals)
        self.assertIn("FUK", deals)
        self.assertIsNotNone(deals["LAX"]["business_min_total"])
        self.assertIsNone(deals["FUK"]["business_min_total"])

    def test_calendar_has_trip_bucket_labels(self) -> None:
        response = get_calendar(
            {"origin": "ICN", "week": "2026-W13", "destination": "TPE", "cabin": "ALL", "stay_bucket": "3_4", "traveler": "adt1"}
        )
        target = next((cell for cell in response["data"]["cells"] if cell["stay_nights"] == 3), None)
        self.assertIsNotNone(target)
        self.assertEqual(target["trip_bucket"], "3-4일")
        self.assertIsNotNone(target["economy_min_total"])
        self.assertTrue(all(cell["stay_nights"] in (3, 4) for cell in response["data"]["cells"]))

    def test_offer_filters_respect_cabin_and_airline(self) -> None:
        response = get_offers(
            {
                "origin": "ICN",
                "week": "2026-W13",
                "destination": "LAX",
                "depart": "2026-03-23",
                "return": "2026-03-30",
                "cabin": "BUSINESS",
                "airline": "KE",
                "traveler": "adt1",
            }
        )
        offers = response["data"]["offers"]
        self.assertTrue(offers)
        self.assertTrue(all(offer["cabin_group"] == "BUSINESS" for offer in offers))
        self.assertTrue(all(offer["airline_code"] == "KE" for offer in offers))
        self.assertTrue(all(offer["traveler"] == "adt1" for offer in offers))
        prices = [offer["price_total"] for offer in offers]
        self.assertEqual(prices, sorted(prices))


if __name__ == "__main__":
    unittest.main()
