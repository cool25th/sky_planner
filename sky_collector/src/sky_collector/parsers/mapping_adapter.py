from typing import Any, Dict, List, Optional
import re

from ..models.offer import CabinClass, NormalizedOffer, QualityBucket, SourceType

TEMPLATE_PATTERN = re.compile(r"\{([^}|]+?)(?:\|([a-z_]+))?\}")


def _template_filter_date(value: Any) -> str:
    return str(value)[:10]


def _template_filter_dmy(value: Any) -> str:
    date = str(value)[:10]
    return f"{date[8:10]}{date[5:7]}"


TEMPLATE_FILTERS = {
    "date": _template_filter_date,
    "dmy": _template_filter_dmy,
}


def template_value(template: str, raw_quote: Dict[str, Any], field_key: str) -> str:
    def replace(match: "re.Match[str]") -> str:
        path, filter_name = match.group(1).strip(), match.group(2)
        value = get_by_path(raw_quote, path)
        if value is None or value == "":
            raise ValueError(f"Missing template path {path} for {field_key}")
        if filter_name:
            template_filter = TEMPLATE_FILTERS.get(filter_name)
            if template_filter is None:
                raise ValueError(f"Unknown template filter {filter_name} for {field_key}")
            value = template_filter(value)
        return str(value)

    return TEMPLATE_PATTERN.sub(replace, str(template))


def flatten_nested_rows(value: Any, key_fields: List[str]) -> List[Dict[str, Any]]:
    """Node 런타임 flattenNestedRows와 동일 규약 — dict-of-dicts를 rows로 펼치고 각 depth key를 key_fields 순서대로 주입한다."""
    if not key_fields:
        return value if isinstance(value, list) else [value]
    head, rest = key_fields[0], key_fields[1:]
    rows: List[Dict[str, Any]] = []
    for key, inner in (value or {}).items():
        for child in flatten_nested_rows(inner, rest):
            if isinstance(child, dict):
                rows.append({head: key, **child})
            else:
                rows.append({head: key, "value": child})
    return rows


def get_by_path(data: Dict[str, Any], path: str, default: Any = None) -> Any:
    if not path or not data:
        return default
    keys = path.split(".")
    curr = data
    for k in keys:
        if isinstance(curr, dict) and k in curr:
            curr = curr[k]
        elif isinstance(curr, list) and k.isdigit() and int(k) < len(curr):
            curr = curr[int(k)]
        else:
            return default
    return curr


class JsonPathMappingAdapter:
    """
    Adapter that normalizes arbitrary JSON partner responses using response_mapping definitions.
    """

    @classmethod
    def map_offer(cls, raw_quote: Dict[str, Any], mapping_config: Dict[str, Any], raw_payload_ref: str, week: str) -> NormalizedOffer:
        fields = mapping_config.get("fields", {})
        defaults = mapping_config.get("defaults", {})

        def val(field_key: str, default_val: Any = None):
            template = (mapping_config.get("templates") or {}).get(field_key)
            if template is not None:
                return template_value(template, raw_quote, field_key)
            path = fields.get(field_key)
            if path:
                extracted = get_by_path(raw_quote, path)
                if extracted is not None:
                    return extracted
            return defaults.get(field_key, default_val)

        cabin_str = str(val("cabin_group", "economy")).lower()
        cabin_group = CabinClass.ECONOMY
        if "business" in cabin_str:
            cabin_group = CabinClass.BUSINESS
        elif "premium" in cabin_str:
            cabin_group = CabinClass.PREMIUM_ECONOMY
        elif "first" in cabin_str:
            cabin_group = CabinClass.FIRST

        source_type_str = str(val("source_type", "meta_search")).lower()
        source_type = SourceType.META_SEARCH
        if "airline" in source_type_str:
            source_type = SourceType.AIRLINE_OFFICIAL
        elif "promo" in source_type_str:
            source_type = SourceType.PROMO_PAGE

        return NormalizedOffer(
            offer_id=str(val("id", f"offer-{val('quoteId', 'gen')}")),
            source_offer_id=str(val("id", "")),
            raw_payload_ref=raw_payload_ref,
            origin_airport=str(val("origin_airport", "ICN")),
            destination_airport=str(val("destination_airport", "NRT")),
            destination_city_id=str(val("destination_city_id", "TYO")),
            destination_display_name=str(val("destination_display_name", "도쿄")),
            country_code=str(val("country_code", "JP")),
            region=str(val("region", "JAPAN")),
            depart_date=str(val("depart_date", "2026-03-23")),
            return_date=str(val("return_date", "2026-03-30")),
            week=week,
            traveler=str(val("traveler", "adt1")),
            airline_code=str(val("airline_code", "OZ")),
            airline_name=str(val("airline_name", "아시아나항공")),
            booking_source=str(val("booking_source", "asiana_official")),
            source_type=source_type,
            cabin_group=cabin_group,
            total_price=float(val("total_price", 250000.0)),
            currency=str(val("currency", "KRW")),
            tax_included=bool(val("tax_included", True)),
            stop_count=int(val("stop_count", 0)),
            deep_link=str(val("deep_link", "https://flyasiana.com")),
        )
