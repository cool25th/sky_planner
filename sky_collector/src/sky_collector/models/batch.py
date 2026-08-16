from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

from .offer import NormalizedOffer, Place


class BatchMetrics(BaseModel):
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    rate_limited_count: int = 0
    parsed_offers_count: int = 0
    offers_received: int = 0
    offers_written: int = 0
    duration_ms: Optional[int] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    avg_latency_ms: Optional[int] = None
    block_count: int = 0
    schema_validation_failed_count: int = 0
    price_anomaly_count: int = 0


class NormalizedBatch(BaseModel):
    schema_version: Literal["collector.normalized_batch.v1"] = "collector.normalized_batch.v1"
    execution_id: str
    source_id: str
    source_type: str
    parser_version: str
    collected_at: str
    artifact_prefix: str
    places: List[Place] = Field(default_factory=list)
    offers: List[NormalizedOffer] = Field(default_factory=list)
    metrics: BatchMetrics = Field(default_factory=BatchMetrics)
