import unittest
from sky_collector.pipelines.fx_sync import FxRateSynchronizer


class TestFxSync(unittest.TestCase):
    def test_krw_conversion(self):
        sync = FxRateSynchronizer()
        # 100 USD = 138000 KRW
        krw = sync.convert_to_krw(100.0, "USD")
        self.assertEqual(krw, 138000.0)

        # 1000 JPY = 9200 KRW
        krw_jpy = sync.convert_to_krw(1000.0, "JPY")
        self.assertEqual(krw_jpy, 9200.0)

        # KRW should remain exact
        krw_direct = sync.convert_to_krw(500000.0, "KRW")
        self.assertEqual(krw_direct, 500000.0)

    def test_stale_detection(self):
        sync = FxRateSynchronizer()
        self.assertFalse(sync.is_stale_over_72h())


if __name__ == "__main__":
    unittest.main()
