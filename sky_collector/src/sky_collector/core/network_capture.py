import json
from typing import Any, Callable, Dict, List, Optional
from dataclasses import dataclass, field


@dataclass
class CapturedResponse:
    url: str
    status: int
    headers: Dict[str, str]
    body: Any
    content_type: str


class NetworkCaptureEngine:
    """
    Listens to Playwright network responses to intercept JSON/XHR/GraphQL responses.
    """

    def __init__(self, target_patterns: List[str]):
        self.target_patterns = target_patterns
        self.captured: List[CapturedResponse] = []

    def matches(self, url: str) -> bool:
        return any(pattern in url for pattern in self.target_patterns)

    async def on_response(self, response: Any):
        url = response.url
        if not self.matches(url):
            return

        try:
            status = response.status
            content_type = response.headers.get("content-type", "")
            if "application/json" in content_type or "text/plain" in content_type or "text/javascript" in content_type:
                text = await response.text()
                try:
                    data = json.loads(text)
                except Exception:
                    data = text
                self.captured.append(
                    CapturedResponse(
                        url=url,
                        status=status,
                        headers=dict(response.headers),
                        body=data,
                        content_type=content_type,
                    )
                )
        except Exception:
            pass

    def attach_to_page(self, page: Any):
        page.on("response", self.on_response)
