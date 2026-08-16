from enum import Enum


class CollectorFailureCode(str, Enum):
    AUTH_FAILED = "AUTH_FAILED"
    RATE_LIMITED = "RATE_LIMITED"
    TIMEOUT = "TIMEOUT"
    SCHEMA_CHANGED = "SCHEMA_CHANGED"
    EMPTY_RESPONSE = "EMPTY_RESPONSE"
    CIRCUIT_BREAKER_OPEN = "CIRCUIT_BREAKER_OPEN"
    DEEPLINK_INVALID = "DEEPLINK_INVALID"
    CAPTCHA_DETECTED = "CAPTCHA_DETECTED"
    NETWORK_ERROR = "NETWORK_ERROR"
    UNKNOWN_ERROR = "UNKNOWN_ERROR"


class CollectorException(Exception):
    def __init__(self, code: CollectorFailureCode, message: str, details: dict = None):
        super().__init__(f"[{code.value}] {message}")
        self.code = code
        self.message = message
        self.details = details or {}
