from __future__ import annotations

from datetime import date, datetime, time, timedelta
from functools import lru_cache
import hashlib
from typing import Dict, Iterable, List, Optional, Set
from urllib.parse import urlencode

BASE_DATE = date(2026, 3, 21)
GENERATED_AT = datetime(2026, 3, 24, 11, 30)
LAST_BATCH_AT = datetime(2026, 3, 24, 2, 0)
DEFAULT_REGION = "ALL"
DEFAULT_STAY_BUCKET = "5_7"
DEFAULT_TRAVELER = "adt1"
DEFAULT_CABIN = "ALL"
ACTIVE_SOURCE_FLAGS = [
    "skyscanner_affiliate",
    "korean_air_official",
    "asiana_official",
]
DEFAULT_WARNING_FLAGS = [
    "daily_batch_cached",
    "final_price_check_on_booking_source",
]

REGIONS = [
    {"code": "ALL", "label": "전체"},
    {"code": "DOMESTIC", "label": "국내선"},
    {"code": "JAPAN", "label": "일본"},
    {"code": "GREATER_CHINA", "label": "중화권"},
    {"code": "SEA", "label": "동남아"},
    {"code": "OCEANIA", "label": "오세아니아"},
    {"code": "EUROPE", "label": "유럽"},
    {"code": "MIDDLE_EAST", "label": "중동"},
    {"code": "NORTH_AMERICA", "label": "북미"},
]

TRIP_BUCKETS = [
    {"code": "ALL", "label": "전체 체류"},
    {"code": "3_4", "label": "3-4일"},
    {"code": "5_7", "label": "5-7일"},
    {"code": "8_14", "label": "8-14일"},
]

ORIGINS = {
    "ICN": {"code": "ICN", "city": "인천", "label": "인천 (ICN)"},
    "GMP": {"code": "GMP", "city": "서울/김포", "label": "서울/김포 (GMP)"},
    "PUS": {"code": "PUS", "city": "부산", "label": "부산 (PUS)"},
    "CJU": {"code": "CJU", "city": "제주", "label": "제주 (CJU)"},
}

ORIGIN_FACTORS = {
    "ICN": 1.00,
    "GMP": 0.97,
    "PUS": 0.94,
    "CJU": 1.06,
}

AIRLINES = {
    "KE": {
        "code": "KE",
        "name": "대한항공",
        "url": "https://www.koreanair.com",
        "type": "full_service",
        "business_label": "Prestige Class",
    },
    "OZ": {
        "code": "OZ",
        "name": "아시아나항공",
        "url": "https://flyasiana.com",
        "type": "full_service",
        "business_label": "Business Smartium",
    },
    "7C": {
        "code": "7C",
        "name": "제주항공",
        "url": "https://www.jejuair.net",
        "type": "low_cost",
        "business_label": "Business Lite",
    },
    "LJ": {
        "code": "LJ",
        "name": "진에어",
        "url": "https://www.jinair.com",
        "type": "low_cost",
        "business_label": "Jini Biz",
    },
    "TW": {
        "code": "TW",
        "name": "티웨이항공",
        "url": "https://www.twayair.com",
        "type": "low_cost",
        "business_label": "Business Saver",
    },
    "BX": {
        "code": "BX",
        "name": "에어부산",
        "url": "https://www.airbusan.com",
        "type": "low_cost",
        "business_label": "Business Smart",
    },
    "RS": {
        "code": "RS",
        "name": "에어서울",
        "url": "https://www.airseoul.com",
        "type": "low_cost",
        "business_label": "Business Flex",
    },
    "ZE": {
        "code": "ZE",
        "name": "이스타항공",
        "url": "https://www.eastarjet.com",
        "type": "low_cost",
        "business_label": "Business Flex",
    },
    "YP": {
        "code": "YP",
        "name": "에어프레미아",
        "url": "https://www.airpremia.com",
        "type": "hybrid",
        "business_label": "Premium Business",
    },
    "CX": {
        "code": "CX",
        "name": "Cathay Pacific",
        "url": "https://www.cathaypacific.com",
        "type": "full_service",
        "business_label": "Business",
    },
    "CI": {
        "code": "CI",
        "name": "China Airlines",
        "url": "https://www.china-airlines.com",
        "type": "full_service",
        "business_label": "Business",
    },
    "BR": {
        "code": "BR",
        "name": "EVA Air",
        "url": "https://www.evaair.com",
        "type": "full_service",
        "business_label": "Royal Laurel",
    },
    "SQ": {
        "code": "SQ",
        "name": "Singapore Airlines",
        "url": "https://www.singaporeair.com",
        "type": "full_service",
        "business_label": "Business",
    },
    "TG": {
        "code": "TG",
        "name": "Thai Airways",
        "url": "https://www.thaiairways.com",
        "type": "full_service",
        "business_label": "Royal Silk",
    },
    "EK": {
        "code": "EK",
        "name": "Emirates",
        "url": "https://www.emirates.com",
        "type": "full_service",
        "business_label": "Business",
    },
    "QF": {
        "code": "QF",
        "name": "Qantas",
        "url": "https://www.qantas.com",
        "type": "full_service",
        "business_label": "Business",
    },
    "BA": {
        "code": "BA",
        "name": "British Airways",
        "url": "https://www.britishairways.com",
        "type": "full_service",
        "business_label": "Club World",
    },
    "DL": {
        "code": "DL",
        "name": "Delta Air Lines",
        "url": "https://www.delta.com",
        "type": "full_service",
        "business_label": "Delta One",
    },
    "AC": {
        "code": "AC",
        "name": "Air Canada",
        "url": "https://www.aircanada.com",
        "type": "full_service",
        "business_label": "Signature Class",
    },
}

AIRLINE_PRICE_FACTORS = {
    "KE": 1.11,
    "OZ": 1.09,
    "7C": 0.83,
    "LJ": 0.84,
    "TW": 0.85,
    "BX": 0.82,
    "RS": 0.84,
    "ZE": 0.83,
    "YP": 0.95,
    "CX": 1.13,
    "CI": 1.05,
    "BR": 1.07,
    "SQ": 1.18,
    "TG": 1.03,
    "EK": 1.17,
    "QF": 1.14,
    "BA": 1.16,
    "DL": 1.08,
    "AC": 1.05,
}

META_SOURCES = [
    {"id": "google-flights", "name": "Google Flights", "type": "meta", "url": "https://www.google.com/travel/flights"},
    {"id": "skyscanner", "name": "Skyscanner", "type": "meta", "url": "https://www.skyscanner.com"},
    {"id": "kayak", "name": "KAYAK", "type": "meta", "url": "https://www.kayak.com/flights"},
]

SOURCE_FACTORS = {
    "Google Flights": 1.00,
    "Skyscanner": 0.98,
    "KAYAK": 1.02,
    "default_airline": 0.99,
}

DESTINATIONS = {
    "CJU": {
        "code": "CJU",
        "city": "제주",
        "country": "대한민국",
        "region": "DOMESTIC",
        "lat": 33.4996,
        "lon": 126.5312,
        "base_total": 79000,
        "business_multiplier": None,
        "duration_hours": 1.2,
        "origins": ["ICN", "GMP", "PUS"],
        "airlines": ["KE", "OZ", "7C", "LJ", "BX"],
        "business_airlines": [],
        "direct_airlines": ["KE", "OZ", "7C", "LJ", "BX"],
        "promotion_airlines": ["7C", "LJ"],
        "promo_weekdays": [1, 2, 3],
    },
    "FUK": {
        "code": "FUK",
        "city": "후쿠오카",
        "country": "일본",
        "region": "JAPAN",
        "lat": 33.5902,
        "lon": 130.4017,
        "base_total": 149000,
        "business_multiplier": None,
        "duration_hours": 1.45,
        "origins": ["ICN", "PUS"],
        "airlines": ["7C", "LJ", "BX", "TW", "KE"],
        "business_airlines": [],
        "direct_airlines": ["7C", "LJ", "BX", "TW", "KE"],
        "promotion_airlines": ["BX", "7C"],
        "promo_weekdays": [1, 2, 3],
    },
    "NRT": {
        "code": "NRT",
        "city": "도쿄",
        "country": "일본",
        "region": "JAPAN",
        "lat": 35.772,
        "lon": 140.3929,
        "base_total": 238000,
        "business_multiplier": 2.15,
        "duration_hours": 2.4,
        "origins": ["ICN", "GMP", "PUS"],
        "airlines": ["KE", "OZ", "7C", "TW"],
        "business_airlines": ["KE", "OZ"],
        "direct_airlines": ["KE", "OZ", "7C", "TW"],
        "promotion_airlines": ["KE", "OZ"],
        "promo_weekdays": [1, 2],
    },
    "TPE": {
        "code": "TPE",
        "city": "타이베이",
        "country": "대만",
        "region": "GREATER_CHINA",
        "lat": 25.033,
        "lon": 121.5654,
        "base_total": 286000,
        "business_multiplier": 2.3,
        "duration_hours": 2.6,
        "origins": ["ICN", "GMP", "PUS"],
        "airlines": ["KE", "OZ", "CI", "BR"],
        "business_airlines": ["KE", "OZ", "CI", "BR"],
        "direct_airlines": ["KE", "OZ", "CI", "BR"],
        "promotion_airlines": ["CI", "BR"],
        "promo_weekdays": [2, 3],
    },
    "HKG": {
        "code": "HKG",
        "city": "홍콩",
        "country": "홍콩",
        "region": "GREATER_CHINA",
        "lat": 22.3193,
        "lon": 114.1694,
        "base_total": 329000,
        "business_multiplier": 2.45,
        "duration_hours": 3.45,
        "origins": ["ICN", "PUS"],
        "airlines": ["KE", "OZ", "CX"],
        "business_airlines": ["KE", "OZ", "CX"],
        "direct_airlines": ["KE", "OZ", "CX"],
        "promotion_airlines": ["OZ", "CX"],
        "promo_weekdays": [1, 2, 3],
    },
    "DAD": {
        "code": "DAD",
        "city": "다낭",
        "country": "베트남",
        "region": "SEA",
        "lat": 16.0544,
        "lon": 108.2022,
        "base_total": 307000,
        "business_multiplier": 2.55,
        "duration_hours": 4.8,
        "origins": ["ICN", "PUS"],
        "airlines": ["TW", "KE", "OZ", "BX"],
        "business_airlines": ["KE", "OZ"],
        "direct_airlines": ["TW", "KE", "OZ", "BX"],
        "promotion_airlines": ["TW", "BX"],
        "promo_weekdays": [1, 2, 3],
    },
    "BKK": {
        "code": "BKK",
        "city": "방콕",
        "country": "태국",
        "region": "SEA",
        "lat": 13.7563,
        "lon": 100.5018,
        "base_total": 419000,
        "business_multiplier": 2.8,
        "duration_hours": 5.9,
        "origins": ["ICN", "PUS"],
        "airlines": ["KE", "OZ", "TG", "TW"],
        "business_airlines": ["KE", "OZ", "TG"],
        "direct_airlines": ["KE", "OZ", "TG", "TW"],
        "promotion_airlines": ["TG", "TW"],
        "promo_weekdays": [2, 3],
    },
    "SIN": {
        "code": "SIN",
        "city": "싱가포르",
        "country": "싱가포르",
        "region": "SEA",
        "lat": 1.3521,
        "lon": 103.8198,
        "base_total": 539000,
        "business_multiplier": 3.1,
        "duration_hours": 6.5,
        "origins": ["ICN"],
        "airlines": ["KE", "SQ", "OZ"],
        "business_airlines": ["KE", "SQ", "OZ"],
        "direct_airlines": ["KE", "SQ", "OZ"],
        "promotion_airlines": ["SQ"],
        "promo_weekdays": [1, 2],
    },
    "GUM": {
        "code": "GUM",
        "city": "괌",
        "country": "미국령 괌",
        "region": "OCEANIA",
        "lat": 13.4443,
        "lon": 144.7937,
        "base_total": 399000,
        "business_multiplier": None,
        "duration_hours": 4.4,
        "origins": ["ICN", "PUS"],
        "airlines": ["BX", "7C", "KE"],
        "business_airlines": [],
        "direct_airlines": ["BX", "7C", "KE"],
        "promotion_airlines": ["BX"],
        "promo_weekdays": [1, 2, 3],
    },
    "SYD": {
        "code": "SYD",
        "city": "시드니",
        "country": "호주",
        "region": "OCEANIA",
        "lat": -33.8688,
        "lon": 151.2093,
        "base_total": 989000,
        "business_multiplier": 3.65,
        "duration_hours": 10.4,
        "origins": ["ICN"],
        "airlines": ["KE", "QF", "YP"],
        "business_airlines": ["KE", "QF", "YP"],
        "direct_airlines": ["KE", "QF"],
        "promotion_airlines": ["KE", "YP"],
        "promo_weekdays": [1, 2],
    },
    "DXB": {
        "code": "DXB",
        "city": "두바이",
        "country": "아랍에미리트",
        "region": "MIDDLE_EAST",
        "lat": 25.2048,
        "lon": 55.2708,
        "base_total": 1249000,
        "business_multiplier": 3.92,
        "duration_hours": 9.8,
        "origins": ["ICN"],
        "airlines": ["EK", "KE"],
        "business_airlines": ["EK", "KE"],
        "direct_airlines": ["EK"],
        "promotion_airlines": ["EK"],
        "promo_weekdays": [2, 3],
    },
    "LHR": {
        "code": "LHR",
        "city": "런던",
        "country": "영국",
        "region": "EUROPE",
        "lat": 51.5072,
        "lon": -0.1276,
        "base_total": 1439000,
        "business_multiplier": 4.05,
        "duration_hours": 13.7,
        "origins": ["ICN"],
        "airlines": ["KE", "BA"],
        "business_airlines": ["KE", "BA"],
        "direct_airlines": ["KE", "BA"],
        "promotion_airlines": ["BA"],
        "promo_weekdays": [1, 2],
    },
    "LAX": {
        "code": "LAX",
        "city": "로스앤젤레스",
        "country": "미국",
        "region": "NORTH_AMERICA",
        "lat": 34.0522,
        "lon": -118.2437,
        "base_total": 1139000,
        "business_multiplier": 3.88,
        "duration_hours": 11.2,
        "origins": ["ICN"],
        "airlines": ["KE", "OZ", "DL"],
        "business_airlines": ["KE", "OZ", "DL"],
        "direct_airlines": ["KE", "OZ", "DL"],
        "promotion_airlines": ["DL"],
        "promo_weekdays": [1, 2],
    },
    "YVR": {
        "code": "YVR",
        "city": "밴쿠버",
        "country": "캐나다",
        "region": "NORTH_AMERICA",
        "lat": 49.2827,
        "lon": -123.1207,
        "base_total": 1049000,
        "business_multiplier": 3.73,
        "duration_hours": 10.0,
        "origins": ["ICN"],
        "airlines": ["KE", "AC"],
        "business_airlines": ["KE", "AC"],
        "direct_airlines": ["KE", "AC"],
        "promotion_airlines": ["AC"],
        "promo_weekdays": [2, 3],
    },
}


def _stable_ratio(key: str) -> float:
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / float(0xFFFFFFFF)


def _stable_choice(key: str, values: List[int]) -> int:
    index = int(_stable_ratio(key) * len(values))
    return values[min(index, len(values) - 1)]


def _jitter(key: str, low: float, high: float) -> float:
    return low + (high - low) * _stable_ratio(key)


def _round_krw(amount: float) -> int:
    return int(round(amount / 1000.0) * 1000)


def _current_week_start() -> date:
    delta = (7 - BASE_DATE.weekday()) % 7
    if delta == 0:
        return BASE_DATE
    return BASE_DATE + timedelta(days=delta)


def _week_code(day: date) -> str:
    year, week, _ = day.isocalendar()
    return f"{year}-W{week:02d}"


def _parse_week(week: str) -> date:
    year_str, week_str = week.split("-W", 1)
    return date.fromisocalendar(int(year_str), int(week_str), 1)


def _available_weeks(count: int = 6) -> List[Dict[str, str]]:
    start = _current_week_start()
    weeks = []
    for offset in range(count):
        day = start + timedelta(days=7 * offset)
        code = _week_code(day)
        weeks.append(
            {
                "code": code,
                "label": f"{code} ({day.isoformat()} 출발 주간)",
                "start_date": day.isoformat(),
            }
        )
    return weeks


def _trip_bucket(stay_nights: int) -> str:
    if 3 <= stay_nights <= 4:
        return "3_4"
    if 5 <= stay_nights <= 7:
        return "5_7"
    if 8 <= stay_nights <= 14:
        return "8_14"
    return "OTHER"


def _trip_bucket_label(code: str) -> str:
    labels = {item["code"]: item["label"] for item in TRIP_BUCKETS}
    return labels.get(code, code)


def _cabin_label(airline_code: str, cabin: str) -> str:
    if cabin == "BUSINESS":
        return AIRLINES[airline_code]["business_label"]
    if AIRLINES[airline_code]["type"] == "low_cost":
        return "Economy Saver"
    if AIRLINES[airline_code]["type"] == "hybrid":
        return "Premium Economy Flex"
    return "Economy Standard"


def _fare_family(airline_code: str, cabin: str) -> str:
    if cabin == "BUSINESS":
        return "Flex"
    if AIRLINES[airline_code]["type"] == "low_cost":
        return "Lite"
    return "Standard"


def _source_catalog_for_airline(airline_code: str) -> List[Dict[str, str]]:
    airline = AIRLINES[airline_code]
    return [
        {"id": airline_code.lower(), "name": airline["name"], "type": "airline", "url": airline["url"]},
        *META_SOURCES,
    ]


def _source_factor(source: Dict[str, str]) -> float:
    if source["type"] == "airline":
        return SOURCE_FACTORS["default_airline"]
    return SOURCE_FACTORS[source["name"]]


def _build_link(
    source: Dict[str, str],
    origin: str,
    destination: str,
    depart_date: date,
    return_date: date,
    cabin: str,
    airline_code: str,
) -> str:
    params = urlencode(
        {
            "from": origin,
            "to": destination,
            "depart": depart_date.isoformat(),
            "return": return_date.isoformat(),
            "cabin": cabin.lower(),
            "airline": airline_code,
        }
    )
    return f"{source['url']}?{params}"


def _build_times(route: Dict[str, object], depart_date: date, return_date: date, key: str, stops: int) -> Dict[str, str]:
    dep_hour = 6 + int(_stable_ratio(key + ":dep-hour") * 11)
    dep_minute = _stable_choice(key + ":dep-minute", [0, 10, 20, 30, 40, 50])
    outbound_departure = datetime.combine(depart_date, time(dep_hour, dep_minute))
    route_hours = float(route["duration_hours"]) + (2.3 if stops else 0.0) + _jitter(key + ":duration", -0.2, 0.4)
    outbound_arrival = outbound_departure + timedelta(hours=route_hours)

    return_hour = 9 + int(_stable_ratio(key + ":ret-hour") * 10)
    return_minute = _stable_choice(key + ":ret-minute", [0, 5, 15, 25, 35, 45, 55])
    inbound_departure = datetime.combine(return_date, time(return_hour, return_minute))
    inbound_arrival = inbound_departure + timedelta(hours=route_hours + _jitter(key + ":inbound", -0.25, 0.5))

    return {
        "outbound_departure_at": outbound_departure.isoformat(timespec="minutes"),
        "outbound_arrival_at": outbound_arrival.isoformat(timespec="minutes"),
        "inbound_departure_at": inbound_departure.isoformat(timespec="minutes"),
        "inbound_arrival_at": inbound_arrival.isoformat(timespec="minutes"),
        "duration_hours": round(route_hours, 1),
    }


def _route_base_price(origin: str, route: Dict[str, object], airline_code: str, cabin: str, depart_date: date, stay_nights: int, key: str) -> float:
    weekday_factor = [0.93, 0.95, 0.98, 1.01, 1.08, 1.13, 1.06][depart_date.weekday()]
    stay_factor = 0.98 + (0.06 * (stay_nights / 14.0))
    market_pressure = 0.91 + (_stable_ratio(key + ":market") * 0.26)
    route_noise = 1.0 + _jitter(key + ":route", -0.04, 0.08)

    base = float(route["base_total"]) * ORIGIN_FACTORS[origin] * AIRLINE_PRICE_FACTORS[airline_code]
    base *= weekday_factor * stay_factor * market_pressure * route_noise
    if cabin == "BUSINESS":
        base *= float(route["business_multiplier"])
    return base


def _promotion_factor(route: Dict[str, object], airline_code: str, source: Dict[str, str], depart_date: date) -> float:
    if source["type"] != "airline":
        return 1.0
    if airline_code not in route["promotion_airlines"]:
        return 1.0
    if depart_date.weekday() not in route["promo_weekdays"]:
        return 1.0
    return 0.85 + _jitter(f"{airline_code}:{depart_date}:promo", -0.01, 0.03)


def _captured_at(key: str) -> str:
    capture_date = BASE_DATE - timedelta(days=int(_stable_ratio(key + ":capture-day") * 3))
    capture_hour = 4 + int(_stable_ratio(key + ":capture-hour") * 18)
    capture_minute = _stable_choice(key + ":capture-minute", [0, 7, 15, 22, 30, 37, 45, 52])
    return datetime.combine(capture_date, time(capture_hour, capture_minute)).isoformat(timespec="minutes")


def _discount_pct(current: int, baseline: int) -> int:
    if baseline <= 0:
        return 0
    return round((1 - (current / baseline)) * 100)


def _selected_airlines(params: Dict[str, str], *keys: str) -> Set[str]:
    search_keys = keys or ("airlines",)
    for key in search_keys:
        raw = params.get(key, "")
        if raw:
            return {code.strip().upper() for code in raw.split(",") if code.strip()}
    return set()


def _stay_bucket(params: Dict[str, str]) -> str:
    value = (params.get("stay_bucket") or DEFAULT_STAY_BUCKET).strip().lower().replace("-", "_")
    normalized = {
        "all": "ALL",
        "3_4": "3_4",
        "5_7": "5_7",
        "8_14": "8_14",
    }.get(value)
    return normalized or DEFAULT_STAY_BUCKET


def _traveler(params: Dict[str, str]) -> str:
    traveler = (params.get("traveler") or DEFAULT_TRAVELER).strip().lower()
    return DEFAULT_TRAVELER if traveler != DEFAULT_TRAVELER else traveler


def _request_id(prefix: str, params: Dict[str, str]) -> str:
    normalized = "|".join(f"{key}={params[key]}" for key in sorted(params))
    digest = hashlib.md5(f"{prefix}|{normalized}|{GENERATED_AT.isoformat()}".encode("utf-8")).hexdigest()
    return f"{prefix}-{digest[:12]}"


def _api_response(prefix: str, params: Dict[str, str], data: Dict[str, object]) -> Dict[str, object]:
    return {
        "request_id": _request_id(prefix, params),
        "generated_at": GENERATED_AT.isoformat(timespec="minutes"),
        "last_batch_at": LAST_BATCH_AT.isoformat(timespec="minutes"),
        "warning_flags": list(DEFAULT_WARNING_FLAGS),
        "source_flags": list(ACTIVE_SOURCE_FLAGS),
        "data": data,
    }


@lru_cache(maxsize=8)
def build_market(week: str) -> Dict[str, List[Dict[str, object]]]:
    week_start = _parse_week(week)
    offers: List[Dict[str, object]] = []

    for origin in ORIGINS:
        for destination_code, route in DESTINATIONS.items():
            if origin not in route["origins"]:
                continue

            for airline_code in route["airlines"]:
                cabins = ["ECONOMY"]
                if airline_code in route["business_airlines"]:
                    cabins.append("BUSINESS")

                for depart_offset in range(7):
                    depart_date = week_start + timedelta(days=depart_offset)
                    for stay_nights in range(3, 15):
                        return_date = depart_date + timedelta(days=stay_nights)
                        bucket_code = _trip_bucket(stay_nights)
                        if bucket_code == "OTHER":
                            continue

                        for cabin in cabins:
                            stops = 0 if airline_code in route["direct_airlines"] else 1
                            times = _build_times(
                                route,
                                depart_date,
                                return_date,
                                f"{origin}:{destination_code}:{airline_code}:{cabin}:{depart_date}:{stay_nights}",
                                stops,
                            )

                            for source in _source_catalog_for_airline(airline_code):
                                key = f"{origin}:{destination_code}:{airline_code}:{cabin}:{depart_date}:{return_date}:{source['id']}"
                                price_base = _route_base_price(
                                    origin,
                                    route,
                                    airline_code,
                                    cabin,
                                    depart_date,
                                    stay_nights,
                                    key,
                                )
                                promotion_factor = _promotion_factor(route, airline_code, source, depart_date)
                                current_total = _round_krw(price_base * _source_factor(source) * promotion_factor)
                                average_30 = _round_krw(price_base * (1.11 + _jitter(key + ":avg30", 0.0, 0.11)))
                                average_90 = _round_krw(average_30 * (1.04 + _jitter(key + ":avg90", 0.0, 0.05)))
                                current_total = min(current_total, _round_krw(average_90 * 1.08))

                                discount_30 = _discount_pct(current_total, average_30)
                                discount_90 = _discount_pct(current_total, average_90)
                                official_promotion = source["type"] == "airline" and promotion_factor < 0.95

                                badges = []
                                if discount_30 >= 12 or discount_90 >= 16:
                                    badges.append("가격 특가")
                                if official_promotion:
                                    badges.append("공식 특가")

                                offer = {
                                    "offer_id": f"offer-{hashlib.md5(key.encode('utf-8')).hexdigest()[:12]}",
                                    "origin": origin,
                                    "origin_label": ORIGINS[origin]["label"],
                                    "traveler": DEFAULT_TRAVELER,
                                    "destination_code": destination_code,
                                    "destination_city": route["city"],
                                    "destination_country": route["country"],
                                    "region_code": route["region"],
                                    "region_label": next(item["label"] for item in REGIONS if item["code"] == route["region"]),
                                    "lat": route["lat"],
                                    "lon": route["lon"],
                                    "depart_date": depart_date.isoformat(),
                                    "return_date": return_date.isoformat(),
                                    "stay_nights": stay_nights,
                                    "trip_bucket": bucket_code,
                                    "trip_bucket_label": _trip_bucket_label(bucket_code),
                                    "airline_code": airline_code,
                                    "airline_name": AIRLINES[airline_code]["name"],
                                    "cabin_group": cabin,
                                    "cabin_label": "이코노미" if cabin == "ECONOMY" else "비즈니스",
                                    "cabin_label_raw": _cabin_label(airline_code, cabin),
                                    "fare_family": _fare_family(airline_code, cabin),
                                    "price_total": current_total,
                                    "tax_included": True,
                                    "average_30_total": average_30,
                                    "average_90_total": average_90,
                                    "discount_pct_30": discount_30,
                                    "discount_pct_90": discount_90,
                                    "price_status": "active",
                                    "is_price_changed": bool(discount_30 >= 12 or discount_90 >= 16),
                                    "source_name": source["name"],
                                    "source_id": source["id"],
                                    "source_type": source["type"],
                                    "stops": stops,
                                    "is_direct": stops == 0,
                                    "captured_at": _captured_at(key),
                                    "last_seen_at": _captured_at(key),
                                    "last_batch_at": LAST_BATCH_AT.isoformat(timespec="minutes"),
                                    "deep_link": _build_link(source, origin, destination_code, depart_date, return_date, cabin, airline_code),
                                    "official_promotion": official_promotion,
                                    "warning_flags": ["tax_included_total", "baggage_unknown"],
                                    "badges": badges,
                                    **times,
                                }
                                offers.append(offer)

    return {"offers": offers}


def _filter_offers(
    offers: Iterable[Dict[str, object]],
    origin: str,
    region: str = "ALL",
    airlines: Optional[Set[str]] = None,
    destination: Optional[str] = None,
    depart_date: Optional[str] = None,
    return_date: Optional[str] = None,
    stay_bucket: str = "ALL",
    traveler: str = DEFAULT_TRAVELER,
    cabin: str = "ALL",
    stops: str = "ALL",
) -> List[Dict[str, object]]:
    result = []
    airline_filter = airlines or set()
    for offer in offers:
        if offer["origin"] != origin:
            continue
        if region != "ALL" and offer["region_code"] != region:
            continue
        if destination and offer["destination_code"] != destination:
            continue
        if depart_date and offer["depart_date"] != depart_date:
            continue
        if return_date and offer["return_date"] != return_date:
            continue
        if stay_bucket != "ALL" and offer["trip_bucket"] != stay_bucket:
            continue
        if traveler != DEFAULT_TRAVELER or offer["traveler"] != DEFAULT_TRAVELER:
            if offer["traveler"] != traveler:
                continue
        if cabin != "ALL" and offer["cabin_group"] != cabin:
            continue
        if airline_filter and offer["airline_code"] not in airline_filter:
            continue
        if stops != "ALL" and str(offer["stops"]) != stops:
            continue
        result.append(offer)
    return result


def get_meta() -> Dict[str, object]:
    data = {
        "prototype_note": "일 1회 배치로 수집된 mock market feed입니다. 마지막 배치 시각과 최종 결제 금액 재확인 안내를 함께 노출합니다.",
        "defaults": {
            "origin": "ICN",
            "region": DEFAULT_REGION,
            "stay_bucket": DEFAULT_STAY_BUCKET,
            "traveler": DEFAULT_TRAVELER,
            "cabin": DEFAULT_CABIN,
        },
        "origins": list(ORIGINS.values()),
        "weeks": _available_weeks(),
        "regions": REGIONS,
        "trip_buckets": TRIP_BUCKETS,
        "cabins": [
            {"code": "ALL", "label": "전체 캐빈"},
            {"code": "ECONOMY", "label": "이코노미"},
            {"code": "BUSINESS", "label": "비즈니스"},
        ],
        "airlines": [AIRLINES[code] for code in sorted(AIRLINES)],
    }
    return _api_response("meta", {}, data)


def get_map_deals(params: Dict[str, str]) -> Dict[str, object]:
    week = params.get("week") or _available_weeks()[0]["code"]
    origin = (params.get("origin") or "ICN").upper()
    region = (params.get("region") or DEFAULT_REGION).upper()
    cabin_filter = (params.get("cabin") or DEFAULT_CABIN).upper()
    stay_bucket = _stay_bucket(params)
    traveler = _traveler(params)
    airline_filter = _selected_airlines(params)

    market = build_market(week)
    offers = _filter_offers(
        market["offers"],
        origin=origin,
        region=region,
        airlines=airline_filter,
        stay_bucket=stay_bucket,
        traveler=traveler,
    )
    offers.sort(key=lambda item: (item["price_total"], item["destination_code"], item["cabin_group"]))

    grouped: Dict[str, Dict[str, object]] = {}
    for offer in offers:
        code = str(offer["destination_code"])
        deal = grouped.setdefault(
            code,
            {
                "destination_code": code,
                "city": offer["destination_city"],
                "country": offer["destination_country"],
                "region_code": offer["region_code"],
                "region_label": offer["region_label"],
                "lat": offer["lat"],
                "lon": offer["lon"],
                "economy_min_total": None,
                "business_min_total": None,
                "economy_discount_pct": None,
                "business_discount_pct": None,
                "economy_price_status": None,
                "business_price_status": None,
                "best_airline_by_cabin": {"ECONOMY": None, "BUSINESS": None},
                "representative_links": {"ECONOMY": None, "BUSINESS": None},
                "last_batch_at": offer["last_batch_at"],
                "last_seen_at": offer["last_seen_at"],
                "warning_flags": set(),
                "promotion_tags": set(),
                "source_mix": set(),
            },
        )

        cabin = str(offer["cabin_group"])
        if cabin == "ECONOMY":
            if deal["economy_min_total"] is None or offer["price_total"] < deal["economy_min_total"]:
                deal["economy_min_total"] = offer["price_total"]
                deal["economy_discount_pct"] = max(int(offer["discount_pct_30"]), int(offer["discount_pct_90"]))
                deal["economy_price_status"] = offer["price_status"]
                deal["best_airline_by_cabin"]["ECONOMY"] = offer["airline_code"]
                deal["representative_links"]["ECONOMY"] = offer["deep_link"]
        if cabin == "BUSINESS":
            if deal["business_min_total"] is None or offer["price_total"] < deal["business_min_total"]:
                deal["business_min_total"] = offer["price_total"]
                deal["business_discount_pct"] = max(int(offer["discount_pct_30"]), int(offer["discount_pct_90"]))
                deal["business_price_status"] = offer["price_status"]
                deal["best_airline_by_cabin"]["BUSINESS"] = offer["airline_code"]
                deal["representative_links"]["BUSINESS"] = offer["deep_link"]

        deal["last_seen_at"] = max(str(deal["last_seen_at"]), str(offer["last_seen_at"]))
        deal["source_mix"].add(str(offer["source_name"]))
        for warning in offer["warning_flags"]:
            deal["warning_flags"].add(warning)
        for badge in offer["badges"]:
            deal["promotion_tags"].add(badge)

    deals = []
    for deal in grouped.values():
        if cabin_filter == "ECONOMY":
            deal["business_min_total"] = None
            deal["business_discount_pct"] = None
            deal["business_price_status"] = None
            deal["best_airline_by_cabin"]["BUSINESS"] = None
            deal["representative_links"]["BUSINESS"] = None
        elif cabin_filter == "BUSINESS":
            deal["economy_min_total"] = None
            deal["economy_discount_pct"] = None
            deal["economy_price_status"] = None
            deal["best_airline_by_cabin"]["ECONOMY"] = None
            deal["representative_links"]["ECONOMY"] = None

        available_prices = [value for value in [deal["economy_min_total"], deal["business_min_total"]] if value is not None]
        if not available_prices:
            continue
        sort_price = min(available_prices)
        deal["sort_price"] = sort_price
        deal["promotion_tags"] = sorted(deal["promotion_tags"])
        deal["source_mix"] = sorted(deal["source_mix"])
        deal["warning_flags"] = sorted(deal["warning_flags"])
        deals.append(deal)

    deals.sort(key=lambda item: (item["sort_price"], item["city"]))

    available_airlines = {}
    for offer in offers:
        available_airlines[str(offer["airline_code"])] = {"code": offer["airline_code"], "name": offer["airline_name"]}

    data = {
        "origin": origin,
        "week": week,
        "region": region,
        "cabin": cabin_filter,
        "stay_bucket": stay_bucket,
        "traveler": traveler,
        "deals": deals,
        "available_airlines": list(sorted(available_airlines.values(), key=lambda item: item["code"])),
        "summary": {
            "destinations": len(deals),
            "offers_considered": len(offers),
            "last_seen_at": max((offer["last_seen_at"] for offer in offers), default=None),
        },
    }
    return _api_response("deals-map", {"origin": origin, "week": week, "region": region, "stay_bucket": stay_bucket, "traveler": traveler, "cabin": cabin_filter}, data)


def get_calendar(params: Dict[str, str]) -> Dict[str, object]:
    week = params.get("week") or _available_weeks()[0]["code"]
    origin = (params.get("origin") or "ICN").upper()
    destination = (params.get("destination") or "").upper()
    airline_filter = _selected_airlines(params)
    cabin_filter = (params.get("cabin") or DEFAULT_CABIN).upper()
    stay_bucket = _stay_bucket(params)
    traveler = _traveler(params)

    if destination not in DESTINATIONS:
        return _api_response(
            "deals-calendar",
            {"origin": origin, "week": week, "destination": destination, "stay_bucket": stay_bucket, "traveler": traveler, "cabin": cabin_filter},
            {
            "origin": origin,
            "week": week,
            "stay_bucket": stay_bucket,
            "traveler": traveler,
            "destination": None,
            "departure_dates": [],
            "return_dates": [],
            "cells": [],
            },
        )

    market = build_market(week)
    offers = _filter_offers(
        market["offers"],
        origin=origin,
        destination=destination,
        airlines=airline_filter,
        stay_bucket=stay_bucket,
        traveler=traveler,
        cabin="ALL" if cabin_filter == "ALL" else cabin_filter,
    )

    cells: Dict[str, Dict[str, object]] = {}
    departure_dates: Set[str] = set()
    return_dates: Set[str] = set()
    available_airlines = {}
    for offer in offers:
        key = f"{offer['depart_date']}::{offer['return_date']}"
        cell = cells.setdefault(
            key,
            {
                "depart_date": offer["depart_date"],
                "return_date": offer["return_date"],
                "stay_nights": offer["stay_nights"],
                "trip_bucket": offer["trip_bucket_label"],
                "economy_min_total": None,
                "business_min_total": None,
                "economy_discount_pct": None,
                "business_discount_pct": None,
                "economy_price_status": None,
                "business_price_status": None,
                "best_airline_by_cabin": {"ECONOMY": None, "BUSINESS": None},
                "best_offer_ids": {"ECONOMY": None, "BUSINESS": None},
                "last_batch_at": offer["last_batch_at"],
                "badges": set(),
            },
        )
        departure_dates.add(str(offer["depart_date"]))
        return_dates.add(str(offer["return_date"]))
        available_airlines[str(offer["airline_code"])] = {"code": offer["airline_code"], "name": offer["airline_name"]}

        cabin = str(offer["cabin_group"])
        if cabin == "ECONOMY":
            if cell["economy_min_total"] is None or offer["price_total"] < cell["economy_min_total"]:
                cell["economy_min_total"] = offer["price_total"]
                cell["economy_discount_pct"] = max(int(offer["discount_pct_30"]), int(offer["discount_pct_90"]))
                cell["economy_price_status"] = offer["price_status"]
                cell["best_airline_by_cabin"]["ECONOMY"] = offer["airline_code"]
                cell["best_offer_ids"]["ECONOMY"] = offer["offer_id"]
        elif cabin == "BUSINESS":
            if cell["business_min_total"] is None or offer["price_total"] < cell["business_min_total"]:
                cell["business_min_total"] = offer["price_total"]
                cell["business_discount_pct"] = max(int(offer["discount_pct_30"]), int(offer["discount_pct_90"]))
                cell["business_price_status"] = offer["price_status"]
                cell["best_airline_by_cabin"]["BUSINESS"] = offer["airline_code"]
                cell["best_offer_ids"]["BUSINESS"] = offer["offer_id"]
        for badge in offer["badges"]:
            cell["badges"].add(badge)

    sorted_cells = []
    for cell in cells.values():
        if cabin_filter == "ECONOMY":
            cell["business_min_total"] = None
            cell["business_discount_pct"] = None
            cell["business_price_status"] = None
        elif cabin_filter == "BUSINESS":
            cell["economy_min_total"] = None
            cell["economy_discount_pct"] = None
            cell["economy_price_status"] = None
        cell["badges"] = sorted(cell["badges"])
        sorted_cells.append(cell)

    sorted_cells.sort(key=lambda item: (item["depart_date"], item["return_date"]))
    route = DESTINATIONS[destination]

    data = {
        "origin": origin,
        "week": week,
        "stay_bucket": stay_bucket,
        "traveler": traveler,
        "destination": {
            "code": route["code"],
            "city": route["city"],
            "country": route["country"],
            "region_code": route["region"],
            "region_label": next(item["label"] for item in REGIONS if item["code"] == route["region"]),
            "lat": route["lat"],
            "lon": route["lon"],
        },
        "departure_dates": sorted(departure_dates),
        "return_dates": sorted(return_dates),
        "cells": sorted_cells,
        "available_airlines": list(sorted(available_airlines.values(), key=lambda item: item["code"])),
    }
    return _api_response("deals-calendar", {"origin": origin, "week": week, "destination": destination, "stay_bucket": stay_bucket, "traveler": traveler, "cabin": cabin_filter}, data)


def get_offers(params: Dict[str, str]) -> Dict[str, object]:
    week = params.get("week") or _available_weeks()[0]["code"]
    origin = (params.get("origin") or "ICN").upper()
    destination = (params.get("destination") or "").upper()
    depart_date = params.get("depart", "")
    return_date = params.get("return", "")
    cabin_filter = (params.get("cabin") or DEFAULT_CABIN).upper()
    traveler = _traveler(params)
    airline_filter = _selected_airlines(params, "airline", "airlines")
    stops_filter = (params.get("stops") or "ALL").upper()

    market = build_market(week)
    offers = _filter_offers(
        market["offers"],
        origin=origin,
        destination=destination or None,
        depart_date=depart_date or None,
        return_date=return_date or None,
        airlines=airline_filter,
        traveler=traveler,
        cabin=cabin_filter,
        stops=stops_filter,
    )

    offers.sort(
        key=lambda item: (
            item["price_total"],
            0 if item["source_type"] == "airline" else 1,
            item["airline_code"],
        )
    )

    available_airlines = {}
    available_cabins = set()
    available_stops = set()
    for offer in offers:
        available_airlines[str(offer["airline_code"])] = {"code": offer["airline_code"], "name": offer["airline_name"]}
        available_cabins.add(str(offer["cabin_group"]))
        available_stops.add(int(offer["stops"]))

    data = {
        "origin": origin,
        "week": week,
        "traveler": traveler,
        "destination": destination,
        "depart": depart_date,
        "return": return_date,
        "offers": offers,
        "filters": {
            "available_airlines": list(sorted(available_airlines.values(), key=lambda item: item["code"])),
            "available_cabins": [
                {"code": code, "label": "이코노미" if code == "ECONOMY" else "비즈니스"}
                for code in sorted(available_cabins)
            ],
            "available_stops": sorted(available_stops),
        },
        "summary": {
            "count": len(offers),
            "lowest_total": offers[0]["price_total"] if offers else None,
            "last_seen_at": max((offer["last_seen_at"] for offer in offers), default=None),
        },
    }
    return _api_response(
        "offers",
        {
            "origin": origin,
            "week": week,
            "destination": destination,
            "depart": depart_date,
            "return": return_date,
            "traveler": traveler,
            "cabin": cabin_filter,
            "stops": stops_filter,
            "airline": ",".join(sorted(airline_filter)) if airline_filter else "",
        },
        data,
    )
