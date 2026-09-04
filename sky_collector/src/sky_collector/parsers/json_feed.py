import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import httpx

from .base import BaseConnector
from .mapping_adapter import (
    JsonPathMappingAdapter,
    flatten_nested_rows,
    get_by_path,
    resolve_query_month_tokens,
)
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
        query = resolve_query_month_tokens(self.config.get("query", {}))
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
            flatten = response_mapping.get("flatten_nested")
            if flatten and isinstance(raw_quotes, dict):
                raw_quotes = flatten_nested_rows(raw_quotes, flatten.get("key_fields", []))
            if not isinstance(raw_quotes, list):
                raw_quotes = []
            # Node 런타임과 동일: query를 행 기본값으로 병합 후 places_lookup·stay_nights_filter 적용.
            lookup = response_mapping.get("places_lookup")
            stay_filter = response_mapping.get("stay_nights_filter")
            for quote in raw_quotes:
                row = {**resolve_query_month_tokens(self.config.get("query") or {}), **quote}
                if lookup:
                    entry_key = str(get_by_path(row, lookup.get("key_field", "")) or "")
                    entry = (lookup.get("entries") or {}).get(entry_key)
                    if entry:
                        row = {**row, **entry}
                    elif lookup.get("drop_unmatched"):
                        continue
                if stay_filter:
                    # 필드명 기본값은 런타임 양측 동일(TP 피드 관례 — 매니페스트 슬리밍, Node 스키마 default와 파리티)
                    depart = str(get_by_path(row, stay_filter.get("depart_field", "departure_at")) or "")[:10]
                    ret = str(get_by_path(row, stay_filter.get("return_field", "return_at")) or "")[:10]
                    try:
                        nights = (datetime.fromisoformat(ret) - datetime.fromisoformat(depart)).days
                    except ValueError:
                        continue
                    if nights < int(stay_filter.get("min", 1)) or nights > int(stay_filter.get("max", 10**9)):
                        continue
                offer = JsonPathMappingAdapter.map_offer(
                    raw_quote=row,
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
