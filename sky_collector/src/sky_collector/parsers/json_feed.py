import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import httpx

from .base import BaseConnector
from .mapping_adapter import JsonPathMappingAdapter, get_by_path
from ..models.batch import BatchMetrics, NormalizedBatch
from ..models.offer import NormalizedOffer, Place
from ..core.failure_codes import CollectorException, CollectorFailureCode


class AuthorizedJsonFeedConnector(BaseConnector):
    """
    Connector for official authorized JSON feed endpoints.
    """

    def validate_config(self) -> bool:
        if not self.config.get("endpoint"):
            return False
        auth = self.config.get("auth")
        if auth and auth.get("token_env"):
            token_val = os.getenv(auth["token_env"])
            if not token_val:
                return False
        return True

    async def fetch_and_parse(self) -> NormalizedBatch:
        endpoint = self.config.get("endpoint")
        method = self.config.get("method", "GET").upper()
        query = self.config.get("query", {})
        headers = {}

        auth = self.config.get("auth")
        if auth and auth.get("token_env"):
            token = os.getenv(auth["token_env"])
            if not token:
                raise CollectorException(
                    CollectorFailureCode.AUTH_FAILED,
                    f"Missing required token in env {auth['token_env']}",
                )
            header_name = auth.get("header_name", "x-api-key")
            headers[header_name] = token

        started_at = datetime.now(timezone.utc).isoformat()
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                if method == "POST":
                    resp = await client.post(endpoint, json=query, headers=headers)
                else:
                    resp = await client.get(endpoint, params=query, headers=headers)

                if resp.status_code == 401 or resp.status_code == 403:
                    raise CollectorException(
                        CollectorFailureCode.AUTH_FAILED,
                        f"Auth failed with status {resp.status_code}",
                    )
                if resp.status_code == 429:
                    raise CollectorException(
                        CollectorFailureCode.RATE_LIMITED,
                        f"Rate limited by endpoint: {resp.status_code}",
                    )
                resp.raise_for_status()
                raw_json = resp.json()
        except httpx.HTTPError as err:
            raise CollectorException(
                CollectorFailureCode.NETWORK_ERROR,
                f"HTTP request failed: {str(err)}",
            ) from err

        completed_at = datetime.now(timezone.utc).isoformat()
        execution_id = f"exec-{uuid.uuid4().hex[:12]}"
        collected_at = datetime.now(timezone.utc).isoformat()
        artifact_prefix = f"runtime/collector-artifacts/{self.source_id}/{datetime.now().strftime('%Y-%m-%d')}"

        response_mapping = self.config.get("response_mapping")
        offers: List[NormalizedOffer] = []
        places: List[Place] = []

        if response_mapping and response_mapping.get("adapter") == "json_path_mapping":
            quotes_path = response_mapping.get("offers_path", "data")
            raw_quotes = get_by_path(raw_json, quotes_path, [])
            for quote in raw_quotes:
                offer = JsonPathMappingAdapter.map_offer(
                    raw_quote=quote,
                    mapping_config=response_mapping,
                    raw_payload_ref=f"{artifact_prefix}/raw.json",
                    week=self.config.get("default_week", "2026-W13"),
                )
                offers.append(offer)
        elif isinstance(raw_json, dict) and "offers" in raw_json:
            for item in raw_json["offers"]:
                offers.append(NormalizedOffer.model_validate(item))
            if "places" in raw_json:
                for p in raw_json["places"]:
                    places.append(Place.model_validate(p))

        metrics = BatchMetrics(
            total_requests=1,
            successful_requests=1,
            failed_requests=0,
            parsed_offers_count=len(offers),
            offers_received=len(offers),
            offers_written=len(offers),
            started_at=started_at,
            completed_at=completed_at,
        )

        return NormalizedBatch(
            execution_id=execution_id,
            source_id=self.source_id,
            source_type=self.config.get("source_type", "meta_search"),
            parser_version=self.config.get("parser_version", "authorized-json-feed-v1"),
            collected_at=collected_at,
            artifact_prefix=artifact_prefix,
            places=places,
            offers=offers,
            metrics=metrics,
        )
