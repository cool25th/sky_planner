from typing import Set

BLOCKED_RESOURCE_TYPES: Set[str] = {
    "image",
    "font",
    "media",
    "stylesheet",
    "imageset",
}

NEVER_BLOCK_TYPES: Set[str] = {
    "script",
    "document",
    "xhr",
    "fetch",
    "websocket",
}

BLOCKED_URL_PATTERNS = [
    "google-analytics.com",
    "googletagmanager.com",
    "facebook.net",
    "doubleclick.net",
    "adnxs.com",
    "criteo.com",
]


class ResourceBlocker:
    """
    Blocks unnecessary network resources (images, fonts, ads) while strictly preserving
    scripts, documents, and API responses (XHR/Fetch).
    """

    @classmethod
    def should_block(cls, resource_type: str, url: str) -> bool:
        if resource_type in NEVER_BLOCK_TYPES:
            return False

        if resource_type in BLOCKED_RESOURCE_TYPES:
            return True

        for pattern in BLOCKED_URL_PATTERNS:
            if pattern in url:
                return True

        return False
