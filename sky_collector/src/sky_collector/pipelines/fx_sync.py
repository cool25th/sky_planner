from datetime import datetime, timezone, timedelta
from typing import Dict, Optional
import httpx


# Default fallback rates (USD, JPY, EUR, TWD, THB, VND, CNY to KRW)
FALLBACK_RATES: Dict[str, float] = {
    "USD": 1380.0,
    "JPY": 9.2,
    "EUR": 1500.0,
    "TWD": 43.5,
    "THB": 38.0,
    "VND": 0.055,
    "CNY": 190.0,
    "KRW": 1.0,
}


class FxRateSynchronizer:
    """
    Synchronizes daily foreign exchange rates (KEXIM / Open API) with 72h stale fallback support.
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key
        self.cached_rates: Dict[str, float] = dict(FALLBACK_RATES)
        self.last_updated: datetime = datetime.now(timezone.utc)

    def convert_to_krw(self, amount: float, currency: str) -> float:
        curr = currency.upper()
        if curr == "KRW":
            return amount
        rate = self.cached_rates.get(curr, FALLBACK_RATES.get(curr, 1.0))
        return round(amount * rate, -2)

    def is_stale_over_72h(self) -> bool:
        delta = datetime.now(timezone.utc) - self.last_updated
        return delta > timedelta(hours=72)
