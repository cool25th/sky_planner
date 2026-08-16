from datetime import datetime
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field, HttpUrl


class CaptureChannel(str, Enum):
    XHR = "xhr"
    GRAPHQL = "graphql"
    HTML_STATE = "html_state"


class CabinClass(str, Enum):
    ECONOMY = "economy"
    PREMIUM_ECONOMY = "premium_economy"
    BUSINESS = "business"
    FIRST = "first"


class SourceType(str, Enum):
    META_SEARCH = "meta_search"
    AIRLINE_OFFICIAL = "airline_official"
    PROMO_PAGE = "promo_page"


class PriceStatus(str, Enum):
    ACTIVE = "active"
    STALE = "stale"
    SOLD_OUT = "sold_out"


class BookabilityStatus(str, Enum):
    AVAILABLE = "available"
    UNCERTAIN = "uncertain"
    SOLD_OUT = "sold_out"


class PriceAnomalyStatus(str, Enum):
    NORMAL = "normal"
    ANOMALY = "anomaly"


class QualityBucket(str, Enum):
    PREFERRED = "preferred"
    ACCEPTABLE = "acceptable"
    DEGRADED = "degraded"
    EXCLUDED = "excluded"


class Place(BaseModel):
    place_id: str
    place_type: str = "city"
    display_name_ko: str
    display_name_en: str
    iata_code: Optional[str] = None
    country_code: str
    region: str
    linked_airports: List[str] = Field(default_factory=list)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    is_active: bool = True


class NormalizedOffer(BaseModel):
    offer_id: Optional[str] = None
    source_offer_id: Optional[str] = None
    raw_payload_ref: str
    capture_channel: CaptureChannel = CaptureChannel.XHR
    origin_airport: str
    origin_city_id: Optional[str] = None
    destination_airport: str
    destination_city_id: str
    destination_display_name: str
    destination_display_name_en: Optional[str] = None
    country_code: str
    region: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    depart_date: str
    return_date: str
    stay_nights: Optional[int] = None
    week: str
    traveler: str = "adt1"
    airline_code: str
    airline_name: str
    operating_airline_code: Optional[str] = None
    operating_airline_name: Optional[str] = None
    booking_source: str
    source_type: SourceType
    cabin_group: CabinClass
    cabin_label_raw: Optional[str] = None
    fare_brand_raw: Optional[str] = None
    total_price: float
    currency: str = "KRW"
    tax_included: bool = True
    normalized_total_krw: Optional[float] = None
    fx_rate_source: str = "kexim_daily"
    fx_rate_date: Optional[str] = None
    stop_count: int = 0
    departure_time_local: Optional[str] = None
    arrival_time_local: Optional[str] = None
    return_departure_time_local: Optional[str] = None
    return_arrival_time_local: Optional[str] = None
    duration_minutes: Optional[int] = None
    return_duration_minutes: Optional[int] = None
    layover_duration_minutes: Optional[int] = None
    free_baggage_allowance: Optional[str] = None
    seats_left: Optional[int] = None
    is_codeshare: bool = False
    duration_ratio_vs_direct_baseline: Optional[float] = None
    quality_bucket: Optional[QualityBucket] = None
    price_anomaly_status: PriceAnomalyStatus = PriceAnomalyStatus.NORMAL
    price_anomaly_reason: Optional[str] = None
    deep_link: str
    bookability_status: BookabilityStatus = BookabilityStatus.AVAILABLE
    price_status: PriceStatus = PriceStatus.ACTIVE
    is_price_changed: bool = False
    warning_flags: List[str] = Field(default_factory=list)
    last_seen_at: Optional[str] = None
