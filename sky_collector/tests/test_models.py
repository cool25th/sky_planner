import unittest
from sky_collector.models.offer import (
    BookabilityStatus,
    CabinClass,
    CaptureChannel,
    NormalizedOffer,
    Place,
    PriceAnomalyStatus,
    PriceStatus,
    SourceType,
)
from sky_collector.models.batch import BatchMetrics, NormalizedBatch


class TestModels(unittest.TestCase):
    def test_normalized_offer_creation(self):
        offer = NormalizedOffer(
            offer_id="test-offer-1",
            raw_payload_ref="runtime/test/raw.json",
            capture_channel=CaptureChannel.XHR,
            origin_airport="ICN",
            destination_airport="NRT",
            destination_city_id="TYO",
            destination_display_name="도쿄",
            country_code="JP",
            region="JAPAN",
            depart_date="2026-03-23",
            return_date="2026-03-30",
            week="2026-W13",
            airline_code="OZ",
            airline_name="아시아나항공",
            booking_source="asiana_official",
            source_type=SourceType.AIRLINE_OFFICIAL,
            cabin_group=CabinClass.ECONOMY,
            total_price=280000.0,
            currency="KRW",
            deep_link="https://flyasiana.com",
        )
        self.assertEqual(offer.origin_airport, "ICN")
        self.assertEqual(offer.total_price, 280000.0)
        self.assertEqual(offer.cabin_group, CabinClass.ECONOMY)

    def test_normalized_batch_serialization(self):
        batch = NormalizedBatch(
            execution_id="exec-12345",
            source_id="test_source",
            source_type="meta_search",
            parser_version="test-v1",
            collected_at="2026-03-24T10:00:00Z",
            artifact_prefix="runtime/collector-artifacts/test_source/2026-03-24",
            places=[
                Place(
                    place_id="TYO",
                    display_name_ko="도쿄",
                    display_name_en="Tokyo",
                    country_code="JP",
                    region="JAPAN",
                )
            ],
            offers=[],
            metrics=BatchMetrics(total_requests=1, parsed_offers_count=0),
        )
        dumped = batch.model_dump(mode="json")
        self.assertEqual(dumped["schema_version"], "collector.normalized_batch.v1")
        self.assertEqual(dumped["source_id"], "test_source")
        self.assertEqual(len(dumped["places"]), 1)


if __name__ == "__main__":
    unittest.main()
