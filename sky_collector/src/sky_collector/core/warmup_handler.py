import asyncio
import random
from typing import Any


class WarmupHandler:
    """
    Handles pre-navigation to main pages to acquire anti-bot / security cookies naturally.
    """

    @classmethod
    async def warmup(cls, page: Any, warmup_url: str = "https://www.google.com/travel/flights"):
        if not warmup_url:
            return
        try:
            await page.goto(warmup_url, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(random.uniform(1.0, 2.5))
        except Exception:
            # Warmup failure should not crash the collector
            pass


class HumanEmulator:
    """
    Simulates organic human interaction (natural delays, mouse movements, scrolling).
    """

    @classmethod
    async def natural_delay(cls, min_sec: float = 0.5, max_sec: float = 2.0):
        await asyncio.sleep(random.uniform(min_sec, max_sec))

    @classmethod
    async def simulate_interaction(cls, page: Any):
        try:
            # Slight mouse movement & small scroll
            await page.mouse.move(random.randint(100, 500), random.randint(100, 500))
            await page.evaluate("window.scrollBy(0, 150)")
            await asyncio.sleep(random.uniform(0.3, 0.8))
        except Exception:
            pass
