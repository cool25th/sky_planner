import os
from typing import Any, Dict, Optional
from .resource_blocker import ResourceBlocker


class BrowserSessionManager:
    """
    Manages Playwright browser lifecycle with stealth settings, sticky proxies,
    and Korean locale/timezone defaults.
    """

    def __init__(self, proxy_url: Optional[str] = None):
        self.proxy_url = proxy_url or os.getenv("RESIDENTIAL_PROXY_URL")

    def get_context_options(self) -> Dict[str, Any]:
        options: Dict[str, Any] = {
            "locale": "ko-KR",
            "timezone_id": "Asia/Seoul",
            "user_agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "viewport": {"width": 1440, "height": 900},
            "service_workers": "block",
        }
        if self.proxy_url:
            options["proxy"] = {"server": self.proxy_url}
        return options

    async def setup_route_filtering(self, page: Any):
        """
        Intercepts requests to block images, fonts, and trackers.
        """
        async def handle_route(route: Any):
            request = route.request
            if ResourceBlocker.should_block(request.resource_type, request.url):
                await route.abort()
            else:
                await route.continue_()

        await page.route("**/*", handle_route)
