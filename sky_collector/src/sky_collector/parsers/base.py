from abc import ABC, abstractmethod
from typing import Any, Dict, List
from ..models.offer import NormalizedOffer, Place
from ..models.batch import NormalizedBatch


class BaseConnector(ABC):
    """
    Standard interface for all Sky Collector connectors.
    """

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.source_id = config.get("source_id", "unknown_source")

    @abstractmethod
    def validate_config(self) -> bool:
        """Validates configuration parameters and credentials."""
        pass

    @abstractmethod
    async def fetch_and_parse(self) -> NormalizedBatch:
        """Fetches raw data and converts it into a NormalizedBatch."""
        pass
