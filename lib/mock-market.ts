import { createHash } from "node:crypto";
import { isHiddenFare } from "./fare-freshness.ts";
import { formatWeekNatural } from "./format.ts";
import {
  DEFAULT_ENABLED_SOURCE_FLAGS,
  isOfferSourceEligible,
} from "./source-policy.ts";

export { formatWeekNatural };

const TODAY_ISO = new Date().toISOString().slice(0, 10);
export const GENERATED_AT = `${TODAY_ISO}T11:30`;
export const DEFAULT_LAST_BATCH_AT = `${TODAY_ISO}T02:00`;
export const DEFAULT_REGION = "ALL";
export const DEFAULT_STAY_BUCKET = "5_7";
export const DEFAULT_TRAVELER = "adt1";
export const DEFAULT_CABIN = "ALL";
export const ACTIVE_SOURCE_FLAGS = [...DEFAULT_ENABLED_SOURCE_FLAGS];
export const WARNING_FLAGS = [
  "daily_batch_cached",
  "final_price_check_on_booking_source",
];

export type RegionCode =
  | "ALL"
  | "DOMESTIC"
  | "JAPAN"
  | "GREATER_CHINA"
  | "SEA"
  | "OCEANIA"
  | "EUROPE"
  | "MIDDLE_EAST"
  | "NORTH_AMERICA";

export type StayBucket = "ALL" | "3_4" | "5_7" | "8_14";
export type CabinCode = "ALL" | "ECONOMY" | "BUSINESS";

export interface ApiResponse<T> {
  request_id: string;
  generated_at: string;
  last_batch_at: string;
  warning_flags: string[];
  source_flags: string[];
  diagnostics?: Record<string, unknown>;
  data: T;
}

interface Origin {
  code: string;
  city: string;
  label: string;
}

interface Airline {
  code: string;
  name: string;
  url: string;
  type: "full_service" | "low_cost" | "hybrid";
  businessLabel: string;
}

interface Destination {
  code: string;
  city: string;
  country: string;
  region: Exclude<RegionCode, "ALL">;
  lat: number;
  lon: number;
  baseTotal: number;
  businessMultiplier: number | null;
  durationHours: number;
  origins: string[];
  airlines: string[];
  businessAirlines: string[];
  directAirlines: string[];
  promotionAirlines: string[];
  promoWeekdays: number[];
}

export interface Offer {
  offer_id: string;
  origin: string;
  origin_label: string;
  traveler: string;
  destination_code: string;
  destination_city: string;
  destination_country: string;
  region_code: Exclude<RegionCode, "ALL">;
  region_label: string;
  lat: number;
  lon: number;
  depart_date: string;
  return_date: string;
  stay_nights: number;
  trip_bucket: Exclude<StayBucket, "ALL">;
  trip_bucket_label: string;
  airline_code: string;
  airline_name: string;
  cabin_group: Exclude<CabinCode, "ALL">;
  cabin_label_raw: string;
  fare_family: string;
  price_total: number;
  average_30_total: number;
  average_90_total: number;
  discount_pct_30: number;
  discount_pct_90: number;
  price_status: "active" | "stale" | "sold_out";
  is_price_changed: boolean;
  source_name: string;
  source_id: string;
  source_type: "meta_search" | "airline_official";
  stops: number;
  is_direct: boolean;
  last_seen_at: string;
  last_batch_at: string;
  deep_link: string;
  official_promotion: boolean;
  warning_flags: string[];
  badges: string[];
  outbound_departure_at: string;
  outbound_arrival_at: string;
  inbound_departure_at: string;
  inbound_arrival_at: string;
  duration_hours: number;
}

export interface MapDeal {
  destination_code: string;
  city: string;
  country: string;
  region_code: Exclude<RegionCode, "ALL">;
  region_label: string;
  lat: number;
  lon: number;
  economy_min_total: number | null;
  business_min_total: number | null;
  economy_discount_pct: number | null;
  business_discount_pct: number | null;
  // RECO-20260828-002: 큐레이션(시기 근접성·주말 포함) 계산용 — Postgres 경로에서 채우고 mock은 생략 가능.
  economy_best_depart_date?: string | null;
  economy_best_return_date?: string | null;
  economy_price_status: "active" | "stale" | "sold_out" | null;
  business_price_status: "active" | "stale" | "sold_out" | null;
  best_airline_by_cabin: { ECONOMY: string | null; BUSINESS: string | null };
  best_origin_by_cabin: { ECONOMY: string | null; BUSINESS: string | null };
  representative_links: { ECONOMY: string | null; BUSINESS: string | null };
  last_batch_at: string;
  last_seen_at: string;
  warning_flags: string[];
  promotion_tags: string[];
  source_mix: string[];
}

interface MapDealAccumulator extends Omit<MapDeal, "warning_flags" | "promotion_tags" | "source_mix"> {
  warning_flags: Set<string>;
  promotion_tags: Set<string>;
  source_mix: Set<string>;
}

export interface MapData {
  origin: string;
  week: string;
  region: RegionCode;
  cabin: CabinCode;
  stay_bucket: StayBucket;
  traveler: string;
  deals: MapDeal[];
  available_airlines: Array<{ code: string; name: string }>;
  summary: {
    destinations: number;
    offers_considered: number;
    last_seen_at: string | null;
  };
}

export interface CalendarCell {
  depart_date: string;
  return_date: string;
  stay_nights: number;
  trip_bucket: string;
  economy_min_total: number | null;
  business_min_total: number | null;
  economy_discount_pct: number | null;
  business_discount_pct: number | null;
  economy_price_status: "active" | "stale" | "sold_out" | null;
  business_price_status: "active" | "stale" | "sold_out" | null;
  best_airline_by_cabin: { ECONOMY: string | null; BUSINESS: string | null };
  best_offer_ids: { ECONOMY: string | null; BUSINESS: string | null };
  last_batch_at: string;
  badges: string[];
}

interface CalendarCellAccumulator extends Omit<CalendarCell, "badges"> {
  badges: Set<string>;
}

export interface CalendarData {
  origin: string;
  week: string;
  stay_bucket: StayBucket;
  traveler: string;
  destination: {
    code: string;
    city: string;
    country: string;
    region_code: Exclude<RegionCode, "ALL">;
    region_label: string;
    lat: number;
    lon: number;
  } | null;
  departure_dates: string[];
  return_dates: string[];
  cells: CalendarCell[];
  available_airlines: Array<{ code: string; name: string }>;
}

export interface OffersData {
  origin: string;
  week: string;
  traveler: string;
  destination: string;
  depart: string;
  return: string;
  offers: Offer[];
  filters: {
    available_airlines: Array<{ code: string; name: string }>;
    available_cabins: Array<{ code: string; label: string }>;
    available_stops: number[];
  };
  summary: {
    count: number;
    lowest_total: number | null;
    last_seen_at: string | null;
  };
}

export interface MapQuery {
  origin: string;
  week: string;
  region: RegionCode;
  cabin: CabinCode;
  stay_bucket: StayBucket;
  traveler: string;
  airlines: string[];
  budget?: number | null;
  pax?: number;
}

export interface CalendarQuery {
  origin: string;
  week: string;
  region?: RegionCode;
  destination: string;
  cabin: CabinCode;
  stay_bucket: StayBucket;
  traveler: string;
  airlines: string[];
  budget?: number | null;
  pax?: number;
}

export interface OffersQuery {
  origin: string;
  week: string;
  destination: string;
  depart: string;
  return: string;
  cabin: CabinCode;
  traveler: string;
  airline: string[];
  stops: "ALL" | "0" | "1";
  pax?: number;
}

const REGIONS = [
  { code: "ALL", label: "전체" },
  { code: "DOMESTIC", label: "국내선" },
  { code: "JAPAN", label: "일본" },
  { code: "GREATER_CHINA", label: "중화권" },
  { code: "SEA", label: "동남아" },
  { code: "OCEANIA", label: "오세아니아" },
  { code: "EUROPE", label: "유럽" },
  { code: "MIDDLE_EAST", label: "중동" },
  { code: "NORTH_AMERICA", label: "북미" },
] as const;

export const TRIP_BUCKETS = [
  { code: "ALL", label: "전체 체류" },
  { code: "3_4", label: "3-4일" },
  { code: "5_7", label: "5-7일" },
  { code: "8_14", label: "8-14일" },
] as const;

export const ORIGINS: Origin[] = [
  { code: "SEL", city: "서울 전체", label: "서울 전체 (SEL)" },
  { code: "ICN", city: "인천", label: "인천 (ICN)" },
  { code: "GMP", city: "김포", label: "김포 (GMP)" },
  { code: "PUS", city: "부산", label: "부산 (PUS)" },
  { code: "CJU", city: "제주", label: "제주 (CJU)" },
];

const ORIGIN_FACTORS: Record<string, number> = {
  ICN: 1,
  GMP: 0.97,
  PUS: 0.94,
  CJU: 1.05,
};

export const AIRLINES: Airline[] = [
  { code: "KE", name: "대한항공", url: "https://www.koreanair.com", type: "full_service", businessLabel: "Prestige Class" },
  { code: "OZ", name: "아시아나항공", url: "https://flyasiana.com", type: "full_service", businessLabel: "Business Smartium" },
  { code: "7C", name: "제주항공", url: "https://www.jejuair.net", type: "low_cost", businessLabel: "Business Lite" },
  { code: "TW", name: "티웨이항공", url: "https://www.twayair.com", type: "low_cost", businessLabel: "Business Saver" },
  { code: "BX", name: "에어부산", url: "https://www.airbusan.com", type: "low_cost", businessLabel: "Business Smart" },
  { code: "CI", name: "China Airlines", url: "https://www.china-airlines.com", type: "full_service", businessLabel: "Business" },
  { code: "BR", name: "EVA Air", url: "https://www.evaair.com", type: "full_service", businessLabel: "Royal Laurel" },
  { code: "CX", name: "Cathay Pacific", url: "https://www.cathaypacific.com", type: "full_service", businessLabel: "Business" },
  { code: "SQ", name: "Singapore Airlines", url: "https://www.singaporeair.com", type: "full_service", businessLabel: "Business" },
  { code: "QF", name: "Qantas", url: "https://www.qantas.com", type: "full_service", businessLabel: "Business" },
  { code: "BA", name: "British Airways", url: "https://www.britishairways.com", type: "full_service", businessLabel: "Club World" },
  { code: "EK", name: "Emirates", url: "https://www.emirates.com", type: "full_service", businessLabel: "Business" },
  { code: "DL", name: "Delta Air Lines", url: "https://www.delta.com", type: "full_service", businessLabel: "Delta One" },
];

const AIRLINE_FACTORS: Record<string, number> = {
  KE: 1.1,
  OZ: 1.08,
  "7C": 0.83,
  TW: 0.85,
  BX: 0.82,
  CI: 1.03,
  BR: 1.05,
  CX: 1.12,
  SQ: 1.18,
  QF: 1.14,
  BA: 1.16,
  EK: 1.17,
  DL: 1.08,
};

const DESTINATIONS: Destination[] = [
  {
    code: "CJU",
    city: "제주",
    country: "대한민국",
    region: "DOMESTIC",
    lat: 33.4996,
    lon: 126.5312,
    baseTotal: 79000,
    businessMultiplier: null,
    durationHours: 1.2,
    origins: ["ICN", "GMP", "PUS"],
    airlines: ["KE", "OZ", "7C", "BX"],
    businessAirlines: [],
    directAirlines: ["KE", "OZ", "7C", "BX"],
    promotionAirlines: ["7C", "BX"],
    promoWeekdays: [1, 2, 3],
  },
  {
    code: "FUK",
    city: "후쿠오카",
    country: "일본",
    region: "JAPAN",
    lat: 33.5902,
    lon: 130.4017,
    baseTotal: 149000,
    businessMultiplier: null,
    durationHours: 1.45,
    origins: ["ICN", "PUS"],
    airlines: ["7C", "BX", "TW", "KE"],
    businessAirlines: [],
    directAirlines: ["7C", "BX", "TW", "KE"],
    promotionAirlines: ["BX", "7C"],
    promoWeekdays: [1, 2, 3],
  },
  {
    code: "TYO",
    city: "도쿄",
    country: "일본",
    region: "JAPAN",
    lat: 35.6762,
    lon: 139.6503,
    baseTotal: 238000,
    businessMultiplier: 2.15,
    durationHours: 2.4,
    origins: ["ICN", "GMP", "PUS"],
    airlines: ["KE", "OZ", "7C", "TW"],
    businessAirlines: ["KE", "OZ"],
    directAirlines: ["KE", "OZ", "7C", "TW"],
    promotionAirlines: ["KE", "OZ"],
    promoWeekdays: [1, 2],
  },
  {
    code: "TPE",
    city: "타이베이",
    country: "대만",
    region: "GREATER_CHINA",
    lat: 25.033,
    lon: 121.5654,
    baseTotal: 286000,
    businessMultiplier: 2.3,
    durationHours: 2.6,
    origins: ["ICN", "GMP", "PUS"],
    airlines: ["KE", "OZ", "CI", "BR"],
    businessAirlines: ["KE", "OZ", "CI", "BR"],
    directAirlines: ["KE", "OZ", "CI", "BR"],
    promotionAirlines: ["CI", "BR"],
    promoWeekdays: [2, 3],
  },
  {
    code: "HKG",
    city: "홍콩",
    country: "홍콩",
    region: "GREATER_CHINA",
    lat: 22.3193,
    lon: 114.1694,
    baseTotal: 329000,
    businessMultiplier: 2.45,
    durationHours: 3.45,
    origins: ["ICN", "PUS"],
    airlines: ["KE", "OZ", "CX"],
    businessAirlines: ["KE", "OZ", "CX"],
    directAirlines: ["KE", "OZ", "CX"],
    promotionAirlines: ["OZ", "CX"],
    promoWeekdays: [1, 2, 3],
  },
  {
    code: "BKK",
    city: "방콕",
    country: "태국",
    region: "SEA",
    lat: 13.7563,
    lon: 100.5018,
    baseTotal: 419000,
    businessMultiplier: 2.8,
    durationHours: 5.9,
    origins: ["ICN", "PUS"],
    airlines: ["KE", "OZ", "SQ", "TW"],
    businessAirlines: ["KE", "OZ", "SQ"],
    directAirlines: ["KE", "OZ", "SQ", "TW"],
    promotionAirlines: ["SQ", "TW"],
    promoWeekdays: [2, 3],
  },
  {
    code: "SIN",
    city: "싱가포르",
    country: "싱가포르",
    region: "SEA",
    lat: 1.3521,
    lon: 103.8198,
    baseTotal: 539000,
    businessMultiplier: 3.1,
    durationHours: 6.5,
    origins: ["ICN"],
    airlines: ["KE", "SQ", "OZ"],
    businessAirlines: ["KE", "SQ", "OZ"],
    directAirlines: ["KE", "SQ", "OZ"],
    promotionAirlines: ["SQ"],
    promoWeekdays: [1, 2],
  },
  {
    code: "SYD",
    city: "시드니",
    country: "호주",
    region: "OCEANIA",
    lat: -33.8688,
    lon: 151.2093,
    baseTotal: 989000,
    businessMultiplier: 3.65,
    durationHours: 10.4,
    origins: ["ICN"],
    airlines: ["KE", "QF"],
    businessAirlines: ["KE", "QF"],
    directAirlines: ["KE", "QF"],
    promotionAirlines: ["KE"],
    promoWeekdays: [1, 2],
  },
  {
    code: "DXB",
    city: "두바이",
    country: "아랍에미리트",
    region: "MIDDLE_EAST",
    lat: 25.2048,
    lon: 55.2708,
    baseTotal: 1249000,
    businessMultiplier: 3.92,
    durationHours: 9.8,
    origins: ["ICN"],
    airlines: ["EK", "KE"],
    businessAirlines: ["EK", "KE"],
    directAirlines: ["EK"],
    promotionAirlines: ["EK"],
    promoWeekdays: [2, 3],
  },
  {
    code: "LHR",
    city: "런던",
    country: "영국",
    region: "EUROPE",
    lat: 51.5072,
    lon: -0.1276,
    baseTotal: 1439000,
    businessMultiplier: 4.05,
    durationHours: 13.7,
    origins: ["ICN"],
    airlines: ["KE", "BA"],
    businessAirlines: ["KE", "BA"],
    directAirlines: ["KE", "BA"],
    promotionAirlines: ["BA"],
    promoWeekdays: [1, 2],
  },
  {
    code: "LAX",
    city: "로스앤젤레스",
    country: "미국",
    region: "NORTH_AMERICA",
    lat: 34.0522,
    lon: -118.2437,
    baseTotal: 1139000,
    businessMultiplier: 3.88,
    durationHours: 11.2,
    origins: ["ICN"],
    airlines: ["KE", "OZ", "DL"],
    businessAirlines: ["KE", "OZ", "DL"],
    directAirlines: ["KE", "OZ", "DL"],
    promotionAirlines: ["DL"],
    promoWeekdays: [1, 2],
  },
  {
    code: "OSA",
    city: "오사카",
    country: "일본",
    region: "JAPAN",
    lat: 34.6937,
    lon: 135.5023,
    baseTotal: 240000,
    businessMultiplier: 2.1,
    durationHours: 1.7,
    origins: ["ICN", "GMP"],
    airlines: ["KE", "OZ", "7C", "TW"],
    businessAirlines: ["KE", "OZ"],
    directAirlines: ["KE", "OZ", "7C", "TW"],
    promotionAirlines: ["7C", "TW"],
    promoWeekdays: [2, 3],
  },
  {
    code: "TAO",
    city: "칭다오",
    country: "중국",
    region: "GREATER_CHINA",
    lat: 36.0671,
    lon: 120.3826,
    baseTotal: 210000,
    businessMultiplier: null,
    durationHours: 1.5,
    origins: ["ICN"],
    airlines: ["KE", "OZ", "7C"],
    businessAirlines: [],
    directAirlines: ["KE", "OZ", "7C"],
    promotionAirlines: ["7C"],
    promoWeekdays: [1, 2],
  },
  {
    code: "SHA",
    city: "상하이",
    country: "중국",
    region: "GREATER_CHINA",
    lat: 31.2304,
    lon: 121.4737,
    baseTotal: 280000,
    businessMultiplier: 2.2,
    durationHours: 2.1,
    origins: ["ICN"],
    airlines: ["KE", "OZ", "CX"],
    businessAirlines: ["KE", "OZ", "CX"],
    directAirlines: ["KE", "OZ"],
    promotionAirlines: ["CX"],
    promoWeekdays: [1, 2],
  },
  {
    code: "PEK",
    city: "베이징",
    country: "중국",
    region: "GREATER_CHINA",
    lat: 39.9042,
    lon: 116.4074,
    baseTotal: 300000,
    businessMultiplier: 2.3,
    durationHours: 2.2,
    origins: ["ICN"],
    airlines: ["KE", "OZ"],
    businessAirlines: ["KE", "OZ"],
    directAirlines: ["KE", "OZ"],
    promotionAirlines: [],
    promoWeekdays: [1, 2],
  },
  {
    code: "HAN",
    city: "하노이",
    country: "베트남",
    region: "SEA",
    lat: 21.0278,
    lon: 105.8342,
    baseTotal: 330000,
    businessMultiplier: null,
    durationHours: 5.3,
    origins: ["ICN"],
    airlines: ["KE", "OZ", "TW"],
    businessAirlines: [],
    directAirlines: ["KE", "OZ", "TW"],
    promotionAirlines: ["TW"],
    promoWeekdays: [2, 3],
  },
  {
    code: "DAD",
    city: "다낭",
    country: "베트남",
    region: "SEA",
    lat: 16.0544,
    lon: 108.2022,
    baseTotal: 350000,
    businessMultiplier: null,
    durationHours: 5.0,
    origins: ["ICN"],
    airlines: ["KE", "OZ", "7C"],
    businessAirlines: [],
    directAirlines: ["KE", "OZ", "7C"],
    promotionAirlines: ["7C"],
    promoWeekdays: [1, 2],
  },
  {
    code: "CEB",
    city: "세부",
    country: "필리핀",
    region: "SEA",
    lat: 10.3157,
    lon: 123.8854,
    baseTotal: 390000,
    businessMultiplier: null,
    durationHours: 4.8,
    origins: ["ICN"],
    airlines: ["KE", "OZ"],
    businessAirlines: [],
    directAirlines: ["KE", "OZ"],
    promotionAirlines: [],
    promoWeekdays: [1, 2],
  },
  {
    code: "BKI",
    city: "코타키나발루",
    country: "말레이시아",
    region: "SEA",
    lat: 5.9804,
    lon: 116.0735,
    baseTotal: 380000,
    businessMultiplier: null,
    durationHours: 5.7,
    origins: ["ICN"],
    airlines: ["KE", "OZ"],
    businessAirlines: [],
    directAirlines: ["KE", "OZ"],
    promotionAirlines: [],
    promoWeekdays: [2, 3],
  },
  {
    code: "DPS",
    city: "발리",
    country: "인도네시아",
    region: "SEA",
    lat: -8.6705,
    lon: 115.2126,
    baseTotal: 520000,
    businessMultiplier: 2.6,
    durationHours: 7.4,
    origins: ["ICN"],
    airlines: ["KE", "OZ", "SQ"],
    businessAirlines: ["KE", "OZ", "SQ"],
    directAirlines: ["KE", "OZ"],
    promotionAirlines: ["SQ"],
    promoWeekdays: [1, 2],
  },
  {
    code: "GUM",
    city: "괌",
    country: "괌",
    region: "OCEANIA",
    lat: 13.4443,
    lon: 144.7937,
    baseTotal: 360000,
    businessMultiplier: null,
    durationHours: 4.4,
    origins: ["ICN"],
    airlines: ["KE", "OZ", "7C"],
    businessAirlines: [],
    directAirlines: ["KE", "OZ", "7C"],
    promotionAirlines: ["7C"],
    promoWeekdays: [1, 2],
  },
];

const META_SOURCE = {
  id: "skyscanner_affiliate",
  name: "Skyscanner",
  type: "meta_search" as const,
  factor: 0.98,
  url: "https://www.skyscanner.com/transport/flights",
};

function stableRatio(key: string) {
  const digest = createHash("md5").update(key).digest("hex");
  return Number.parseInt(digest.slice(0, 8), 16) / 0xffffffff;
}

function jitter(key: string, low: number, high: number) {
  return low + (high - low) * stableRatio(key);
}

function roundKrw(value: number) {
  return Math.round(value / 1000) * 1000;
}

function weekStartFromCode(week: string) {
  const [yearPart, weekPart] = week.split("-W");
  const year = Number(yearPart);
  const isoWeek = Number(weekPart);
  const january4 = new Date(Date.UTC(year, 0, 4));
  const day = january4.getUTCDay() || 7;
  const monday = new Date(january4);
  monday.setUTCDate(january4.getUTCDate() - day + 1 + (isoWeek - 1) * 7);
  return monday;
}

function currentWeekStart() {
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (now.getUTCDay() || 7) + 1);
  return monday;
}

export function availableWeeks(count = 6) {
  const start = currentWeekStart();
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index * 7);
    const year = day.getUTCFullYear();
    const jan1 = new Date(Date.UTC(year, 0, 1));
    const dayOfYear = Math.floor((day.getTime() - jan1.getTime()) / 86400000) + 1;
    const week = Math.ceil((dayOfYear + ((jan1.getUTCDay() || 7) - 1)) / 7);
    const code = `${year}-W${String(week).padStart(2, "0")}`;
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    return {
      code,
      label: `${m}월 ${d}일 주간`,
      natural_range: formatWeekNatural(code),
      start_date: day.toISOString().slice(0, 10),
    };
  });
}

function tripBucket(stayNights: number): Exclude<StayBucket, "ALL"> | "OTHER" {
  if (stayNights >= 3 && stayNights <= 4) return "3_4";
  if (stayNights >= 5 && stayNights <= 7) return "5_7";
  if (stayNights >= 8 && stayNights <= 14) return "8_14";
  return "OTHER";
}

function tripBucketLabel(code: Exclude<StayBucket, "ALL">) {
  return TRIP_BUCKETS.find((item) => item.code === code)?.label ?? code;
}

function airlineByCode(code: string) {
  const airline = AIRLINES.find((item) => item.code === code);
  if (!airline) throw new Error(`Unknown airline: ${code}`);
  return airline;
}

function buildLink(
  airline: Airline,
  origin: string,
  destination: string,
  departDate: string,
  returnDate: string,
  cabin: Exclude<CabinCode, "ALL">,
) {
  const search = new URLSearchParams({
    from: origin,
    to: destination,
    depart: departDate,
    return: returnDate,
    cabin: cabin.toLowerCase(),
    airline: airline.code,
  });
  return `${airline.url}?${search.toString()}`;
}

function sourceLink(
  origin: string,
  destination: string,
  departDate: string,
  returnDate: string,
  cabin: Exclude<CabinCode, "ALL">,
  airlineCode: string,
) {
  const search = new URLSearchParams({
    from: origin,
    to: destination,
    depart: departDate,
    return: returnDate,
    cabin: cabin.toLowerCase(),
    airline: airlineCode,
  });
  return `${META_SOURCE.url}?${search.toString()}`;
}

function buildTimes(destination: Destination, departDate: string, returnDate: string, key: string, stops: number) {
  const depHour = 6 + Math.floor(stableRatio(`${key}:depHour`) * 11);
  const depMinute = [0, 10, 20, 30, 40, 50][Math.floor(stableRatio(`${key}:depMinute`) * 6)];
  const outboundDeparture = new Date(`${departDate}T${String(depHour).padStart(2, "0")}:${String(depMinute).padStart(2, "0")}:00`);
  const durationHours = destination.durationHours + (stops ? 2.3 : 0) + jitter(`${key}:duration`, -0.2, 0.4);
  const outboundArrival = new Date(outboundDeparture.getTime() + durationHours * 3600000);
  const inboundDeparture = new Date(`${returnDate}T${String(9 + Math.floor(stableRatio(`${key}:retHour`) * 10)).padStart(2, "0")}:15:00`);
  const inboundArrival = new Date(inboundDeparture.getTime() + (durationHours + jitter(`${key}:return`, -0.2, 0.4)) * 3600000);
  return {
    outbound_departure_at: outboundDeparture.toISOString().slice(0, 16),
    outbound_arrival_at: outboundArrival.toISOString().slice(0, 16),
    inbound_departure_at: inboundDeparture.toISOString().slice(0, 16),
    inbound_arrival_at: inboundArrival.toISOString().slice(0, 16),
    duration_hours: Number(durationHours.toFixed(1)),
  };
}

function capturedAt(lastBatchAt: string, key: string) {
  const batch = new Date(lastBatchAt);
  const minutes = Math.floor(stableRatio(`${key}:capture`) * 720);
  return new Date(batch.getTime() - minutes * 60000).toISOString().slice(0, 16);
}

function routeBasePrice(
  origin: string,
  destination: Destination,
  airlineCode: string,
  cabin: Exclude<CabinCode, "ALL">,
  departDate: Date,
  stayNights: number,
  key: string,
) {
  const weekdayFactors = [0.93, 0.95, 0.98, 1.01, 1.08, 1.13, 1.06];
  const weekdayFactor = weekdayFactors[departDate.getUTCDay() === 0 ? 6 : departDate.getUTCDay() - 1];
  const stayFactor = 0.98 + 0.06 * (stayNights / 14);
  const marketPressure = 0.91 + stableRatio(`${key}:market`) * 0.26;
  const routeNoise = 1 + jitter(`${key}:route`, -0.04, 0.08);
  let base = destination.baseTotal * ORIGIN_FACTORS[origin] * AIRLINE_FACTORS[airlineCode];
  base *= weekdayFactor * stayFactor * marketPressure * routeNoise;
  if (cabin === "BUSINESS" && destination.businessMultiplier) {
    base *= destination.businessMultiplier;
  }
  return base;
}

function discountPct(current: number, baseline: number) {
  if (baseline <= 0) return 0;
  return Math.round((1 - current / baseline) * 100);
}

const marketCache = new Map<string, Offer[]>();

export function buildMarket(week: string, lastBatchAt = DEFAULT_LAST_BATCH_AT) {
  const cacheKey = `${week}:${lastBatchAt}`;
  const cachedMarket = marketCache.get(cacheKey);
  if (cachedMarket !== undefined) {
    return cachedMarket;
  }

  const offers: Offer[] = [];
  const weekStart = weekStartFromCode(week);

  for (const origin of ORIGINS) {
    for (const destination of DESTINATIONS) {
      if (!destination.origins.includes(origin.code)) continue;
      for (const airlineCode of destination.airlines) {
        const airline = airlineByCode(airlineCode);
        const cabins: Array<Exclude<CabinCode, "ALL">> = ["ECONOMY"];
        if (destination.businessAirlines.includes(airlineCode)) cabins.push("BUSINESS");
        for (let departOffset = 0; departOffset < 7; departOffset += 1) {
          const departDate = new Date(weekStart);
          departDate.setUTCDate(weekStart.getUTCDate() + departOffset);
          const departIso = departDate.toISOString().slice(0, 10);
          for (let stayNights = 3; stayNights <= 14; stayNights += 1) {
            const bucket = tripBucket(stayNights);
            if (bucket === "OTHER") continue;
            const returnDate = new Date(departDate);
            returnDate.setUTCDate(departDate.getUTCDate() + stayNights);
            const returnIso = returnDate.toISOString().slice(0, 10);
            for (const cabin of cabins) {
              const stops = destination.directAirlines.includes(airlineCode) ? 0 : 1;
              const key = `${origin.code}:${destination.code}:${airlineCode}:${cabin}:${departIso}:${returnIso}`;
              const base = routeBasePrice(origin.code, destination, airlineCode, cabin, departDate, stayNights, key);
              const average30 = roundKrw(base * (1.11 + jitter(`${key}:avg30`, 0, 0.11)));
              const average90 = roundKrw(average30 * (1.04 + jitter(`${key}:avg90`, 0, 0.05)));
              const officialPromotion = destination.promotionAirlines.includes(airlineCode) && destination.promoWeekdays.includes(departDate.getUTCDay() || 7);

              const officialPrice = roundKrw(base * 0.99 * (officialPromotion ? 0.87 : 1));
              const metaPrice = roundKrw(base * META_SOURCE.factor);
              const candidates = [
                {
                  sourceId: airline.code.toLowerCase(),
                  sourceName: airline.name,
                  sourceType: "airline_official" as const,
                  price: Math.min(officialPrice, roundKrw(average90 * 1.08)),
                  deepLink: buildLink(airline, origin.code, destination.code, departIso, returnIso, cabin),
                },
                {
                  sourceId: META_SOURCE.id,
                  sourceName: META_SOURCE.name,
                  sourceType: "meta_search" as const,
                  price: Math.min(metaPrice, roundKrw(average90 * 1.08)),
                  deepLink: sourceLink(origin.code, destination.code, departIso, returnIso, cabin, airline.code),
                },
              ];

              for (const candidate of candidates) {
                const current = candidate.price;
                const discount30 = discountPct(current, average30);
                const discount90 = discountPct(current, average90);
                const badges = [];
                if (discount30 >= 12 || discount90 >= 16) badges.push("가격 특가");
                if (candidate.sourceType === "airline_official" && officialPromotion) badges.push("공식 특가");
                offers.push({
                  offer_id: `offer-${createHash("md5").update(`${key}:${candidate.sourceId}`).digest("hex").slice(0, 12)}`,
                  origin: origin.code,
                  origin_label: origin.label,
                  traveler: DEFAULT_TRAVELER,
                  destination_code: destination.code,
                  destination_city: destination.city,
                  destination_country: destination.country,
                  region_code: destination.region,
                  region_label: REGIONS.find((item) => item.code === destination.region)?.label ?? destination.region,
                  lat: destination.lat,
                  lon: destination.lon,
                  depart_date: departIso,
                  return_date: returnIso,
                  stay_nights: stayNights,
                  trip_bucket: bucket,
                  trip_bucket_label: tripBucketLabel(bucket),
                  airline_code: airline.code,
                  airline_name: airline.name,
                  cabin_group: cabin,
                  cabin_label_raw: cabin === "BUSINESS" ? airline.businessLabel : airline.type === "low_cost" ? "Economy Saver" : "Economy Standard",
                  fare_family: cabin === "BUSINESS" ? "Flex" : airline.type === "low_cost" ? "Lite" : "Standard",
                  price_total: current,
                  average_30_total: average30,
                  average_90_total: average90,
                  discount_pct_30: discount30,
                  discount_pct_90: discount90,
                  price_status: "active",
                  is_price_changed: badges.includes("가격 특가"),
                  source_name: candidate.sourceName,
                  source_id: candidate.sourceId,
                  source_type: candidate.sourceType,
                  stops,
                  is_direct: stops === 0,
                  last_seen_at: capturedAt(lastBatchAt, `${key}:${candidate.sourceId}`),
                  last_batch_at: lastBatchAt,
                  deep_link: candidate.deepLink,
                  official_promotion: badges.includes("공식 특가"),
                  warning_flags: ["tax_included_total", "baggage_unknown"],
                  badges,
                  ...buildTimes(destination, departIso, returnIso, `${key}:${candidate.sourceId}`, stops),
                });
              }
            }
          }
        }
      }
    }
  }

  marketCache.set(cacheKey, offers);
  return offers;
}

export function buildAllOffers(lastBatchAt = DEFAULT_LAST_BATCH_AT) {
  return availableWeeks().flatMap((week) => buildMarket(week.code, lastBatchAt));
}

function normalizeCabin(value?: string): CabinCode {
  const normalized = (value ?? DEFAULT_CABIN).toUpperCase();
  return normalized === "ECONOMY" || normalized === "BUSINESS" ? normalized : "ALL";
}

function normalizeRegion(value?: string): RegionCode {
  const normalized = (value ?? DEFAULT_REGION).toUpperCase() as RegionCode;
  return (REGIONS.find((item) => item.code === normalized)?.code ?? DEFAULT_REGION) as RegionCode;
}

function normalizeStayBucket(value?: string): StayBucket {
  const normalized = (value ?? DEFAULT_STAY_BUCKET).replace("-", "_").toLowerCase();
  if (normalized === "all") return "ALL";
  if (normalized === "3_4" || normalized === "5_7" || normalized === "8_14") return normalized;
  return DEFAULT_STAY_BUCKET;
}

function normalizeTraveler(value?: string) {
  return value === DEFAULT_TRAVELER ? value : DEFAULT_TRAVELER;
}

function normalizeAirlines(value?: string | string[]) {
  const raw = Array.isArray(value) ? value.join(",") : value ?? "";
  return raw
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

export function requestId(prefix: string, payload: Record<string, string>) {
  const normalized = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join("|");
  return `${prefix}-${createHash("md5").update(`${prefix}|${normalized}|${GENERATED_AT}`).digest("hex").slice(0, 12)}`;
}

export function envelope<T>(
  prefix: string,
  payload: Record<string, string>,
  data: T,
  lastBatchAt: string,
  sourceFlags = ACTIVE_SOURCE_FLAGS,
): ApiResponse<T> {
  return {
    request_id: requestId(prefix, payload),
    generated_at: GENERATED_AT,
    last_batch_at: lastBatchAt,
    warning_flags: [...WARNING_FLAGS],
    source_flags: [...sourceFlags],
    data,
  };
}

export function getMetaData() {
  return {
    prototype_note: "일 1회 캐시 기반 탐색용 데모 데이터입니다. 최종 운임 및 예약 가능 여부는 예약처에서 확인해야 합니다.",
    defaults: {
      origin: "ICN",
      region: DEFAULT_REGION,
      stay_bucket: DEFAULT_STAY_BUCKET,
      traveler: DEFAULT_TRAVELER,
      cabin: DEFAULT_CABIN,
    },
    origins: ORIGINS,
    weeks: availableWeeks(),
    regions: REGIONS,
    trip_buckets: TRIP_BUCKETS,
    cabins: [
      { code: "ALL", label: "전체 좌석" },
      { code: "ECONOMY", label: "일반석" },
      { code: "BUSINESS", label: "비즈니스석" },
    ],
    airlines: AIRLINES.map(({ businessLabel, ...rest }) => ({
      ...rest,
      business_label: businessLabel,
    })),
  };
}

export function getDestinationList() {
  return DESTINATIONS.map((d) => ({
    code: d.code,
    city: d.city,
    country: d.country,
    region: d.region,
  }));
}

export interface SearchQuery {
  origin: string;
  destination: string;
  destination_input: string;
  days: number;
  flex_days: number;
  cabin: CabinCode;
  traveler: string;
}

export interface DestinationMatch {
  code: string;
  city: string;
  country: string;
  region: Exclude<RegionCode, "ALL">;
  score: number;
  matched_by: string;
}

export interface SearchDestination {
  code: string;
  city: string;
  country: string;
  region: Exclude<RegionCode, "ALL"> | string;
}

export interface SearchCabinSummary {
  cabin: Exclude<CabinCode, "ALL">;
  lowest_total: number | null;
  best_airline: string | null;
  best_depart_date: string | null;
  best_return_date: string | null;
  direct_available: boolean;
  offer_count: number;
  discount_pct: number | null;
}

export interface SearchResult {
  query: SearchQuery;
  destination: SearchDestination | null;
  search_scope: {
    kind: "exact" | "broad" | "unresolved";
    label: string;
    destination_count: number;
    destination_codes: string[];
  };
  searched_destinations: SearchDestination[];
  matches: DestinationMatch[];
  best_offer: Offer | null;
  lowest_price: number | null;
  lowest_airline: string | null;
  lowest_date: string | null;
  total_offers: number;
  flexible_night_range: {
    min: number;
    max: number;
  };
  price_by_cabin: SearchCabinSummary[];
  quality_summary: {
    destinations: number;
    direct_options: number;
    airlines: number;
    sources: number;
    weeks_searched: number;
  };
  offers: Offer[];
}

const DESTINATION_ALIASES: Record<string, string[]> = {
  CJU: ["jeju", "jejudo", "제주도", "국내", "국내선"],
  FUK: ["fukuoka", "후쿠오카", "큐슈", "kyushu"],
  TYO: ["tokyo", "도쿄", "동경", "nrt", "hnd", "나리타", "하네다"],
  TPE: ["taipei", "타이페이", "대만", "taiwan"],
  HKG: ["hong kong", "hongkong", "홍콩"],
  BKK: ["bangkok", "방콕"],
  SIN: ["singapore", "싱가폴", "싱가포르"],
  SYD: ["sydney", "시드니"],
  DXB: ["dubai", "두바이"],
  LHR: ["london", "런던", "heathrow", "히스로"],
  LAX: ["los angeles", "la", "로스앤젤레스", "로스앤젤리스", "엘에이"],
};

const REGION_SEARCH_ALIASES: Partial<Record<Exclude<RegionCode, "ALL">, string[]>> = {
  DOMESTIC: ["국내", "국내선", "korea"],
  JAPAN: ["일본", "japan"],
  GREATER_CHINA: ["중화권", "대만", "홍콩", "중국", "taiwan", "hong kong"],
  SEA: ["동남아", "southeast asia", "태국", "베트남"],
  OCEANIA: ["오세아니아", "호주", "괌", "oceania", "australia"],
  EUROPE: ["유럽", "europe"],
  MIDDLE_EAST: ["중동", "middle east", "uae"],
  NORTH_AMERICA: ["북미", "미국", "캐나다", "north america", "usa", "canada"],
};

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[()[\]{}.,/\\_\-\s]+/g, "");
}

function destinationToSearchDestination(destination: Destination): SearchDestination {
  return {
    code: destination.code,
    city: destination.city,
    country: destination.country,
    region: destination.region,
  };
}

function destinationSearchValues(destination: Destination) {
  const regionLabel = REGIONS.find((item) => item.code === destination.region)?.label ?? destination.region;
  return [
    { value: destination.code, by: "iata", baseScore: 120 },
    { value: destination.city, by: "city", baseScore: 112 },
    { value: destination.country, by: "country", baseScore: 82 },
    { value: regionLabel, by: "region", baseScore: 72 },
    { value: destination.region, by: "region", baseScore: 62 },
    ...(DESTINATION_ALIASES[destination.code] ?? []).map((value) => ({ value, by: "alias", baseScore: 104 })),
    ...(REGION_SEARCH_ALIASES[destination.region] ?? []).map((value) => ({ value, by: "region", baseScore: 70 })),
  ];
}

export function findDestinationMatches(input: string, limit = 8): DestinationMatch[] {
  const needle = normalizeSearchText(input);
  if (!needle) return [];

  return DESTINATIONS.map((destination) => {
    let best = { score: 0, matched_by: "" };
    for (const candidate of destinationSearchValues(destination)) {
      const haystack = normalizeSearchText(candidate.value);
      if (!haystack) continue;
      let score = 0;
      if (haystack === needle) score = candidate.baseScore;
      else if (haystack.startsWith(needle)) score = candidate.baseScore - 18;
      else if (haystack.includes(needle) || (haystack.length >= 4 && needle.includes(haystack))) score = candidate.baseScore - 32;
      if (score > best.score) {
        best = { score, matched_by: candidate.by };
      }
    }
    return {
      code: destination.code,
      city: destination.city,
      country: destination.country,
      region: destination.region,
      score: best.score,
      matched_by: best.matched_by,
    } satisfies DestinationMatch;
  })
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.city.localeCompare(right.city, "ko"))
    .slice(0, limit);
}

export function isBroadDestinationSearch(input: string, matches: DestinationMatch[]) {
  const needle = normalizeSearchText(input);
  if (!needle || matches.length <= 1) return false;

  const isExactCityOrCode = DESTINATIONS.some((destination) => {
    if (normalizeSearchText(destination.code) === needle) return true;
    if (normalizeSearchText(destination.city) === needle) return true;
    return (DESTINATION_ALIASES[destination.code] ?? []).some((alias) => normalizeSearchText(alias) === needle);
  });
  if (isExactCityOrCode) return false;

  return matches.some((match) => (match.matched_by === "country" || match.matched_by === "region") && match.score >= 70);
}

function clampInteger(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function parseSearchQuery(input: Record<string, string | string[] | undefined>): SearchQuery {
  const destinationParam = Array.isArray(input.destination) ? input.destination[0] : input.destination ?? "";
  const destinationInput = Array.isArray(input.q) ? input.q[0] : input.q ?? destinationParam;
  const directCode = destinationParam.toUpperCase();
  const exactDestination = DESTINATIONS.find((destination) => destination.code === directCode);
  const destinationMatches = findDestinationMatches(destinationInput || destinationParam);
  const resolvedDestination = exactDestination?.code ?? destinationMatches[0]?.code ?? "";

  return {
    origin: (Array.isArray(input.origin) ? input.origin[0] : input.origin ?? "ICN").toUpperCase(),
    destination: resolvedDestination,
    destination_input: destinationInput.trim(),
    days: clampInteger(Number(Array.isArray(input.days) ? input.days[0] : input.days ?? "7"), 3, 14, 7),
    flex_days: clampInteger(Number(Array.isArray(input.flex) ? input.flex[0] : input.flex ?? "1"), 0, 2, 1),
    cabin: normalizeCabin(Array.isArray(input.cabin) ? input.cabin[0] : input.cabin),
    traveler: normalizeTraveler(Array.isArray(input.traveler) ? input.traveler[0] : input.traveler),
  };
}

function searchOfferSort(left: Offer, right: Offer) {
  const statusRank = { active: 0, stale: 1, sold_out: 2 } as const;
  const statusDelta = statusRank[left.price_status] - statusRank[right.price_status];
  if (statusDelta) return statusDelta;
  if (left.price_total !== right.price_total) return left.price_total - right.price_total;
  if (left.is_direct !== right.is_direct) return left.is_direct ? -1 : 1;
  if (left.duration_hours !== right.duration_hours) return left.duration_hours - right.duration_hours;
  return left.outbound_departure_at.localeCompare(right.outbound_departure_at);
}

export function buildSearchResult(
  query: SearchQuery,
  destination: SearchDestination | null,
  matches: DestinationMatch[],
  offers: Offer[],
  searchedDestinations: SearchDestination[] = destination ? [destination] : [],
): SearchResult {
  const unique = [...new Map(offers.map((offer) => [offer.offer_id, offer])).values()];
  const sorted = unique.sort(searchOfferSort);
  const bestOffer = sorted[0] ?? null;
  const bestOfferDestination = bestOffer
    ? {
        code: bestOffer.destination_code,
        city: bestOffer.destination_city,
        country: bestOffer.destination_country,
        region: bestOffer.region_code,
      }
    : null;
  const searchScopeKind = searchedDestinations.length > 1 ? "broad" : destination ? "exact" : "unresolved";
  const resultDestination = searchScopeKind === "broad" ? bestOfferDestination ?? destination : destination;
  const cabinSummaries: SearchCabinSummary[] = (["ECONOMY", "BUSINESS"] as const).map((cabin) => {
    const cabinOffers = sorted.filter((offer) => offer.cabin_group === cabin);
    const bestCabinOffer = cabinOffers[0] ?? null;
    return {
      cabin,
      lowest_total: bestCabinOffer?.price_total ?? null,
      best_airline: bestCabinOffer?.airline_name ?? null,
      best_depart_date: bestCabinOffer?.depart_date ?? null,
      best_return_date: bestCabinOffer?.return_date ?? null,
      direct_available: cabinOffers.some((offer) => offer.is_direct),
      offer_count: cabinOffers.length,
      discount_pct: bestCabinOffer ? Math.max(bestCabinOffer.discount_pct_30, bestCabinOffer.discount_pct_90) : null,
    };
  });

  return {
    query,
    destination: resultDestination,
    search_scope: {
      kind: searchScopeKind,
      label:
        searchScopeKind === "broad"
          ? query.destination_input || searchedDestinations.map((item) => item.city).join(", ")
          : destination?.city ?? query.destination_input,
      destination_count: searchedDestinations.length,
      destination_codes: searchedDestinations.map((item) => item.code),
    },
    searched_destinations: searchedDestinations,
    matches,
    best_offer: bestOffer,
    lowest_price: bestOffer?.price_total ?? null,
    lowest_airline: bestOffer?.airline_name ?? null,
    lowest_date: bestOffer?.depart_date ?? null,
    total_offers: sorted.length,
    flexible_night_range: {
      min: Math.max(3, query.days - query.flex_days),
      max: Math.min(14, query.days + query.flex_days),
    },
    price_by_cabin: cabinSummaries,
    quality_summary: {
      destinations: new Set(sorted.map((offer) => offer.destination_code)).size || searchedDestinations.length,
      direct_options: sorted.filter((offer) => offer.is_direct).length,
      airlines: new Set(sorted.map((offer) => offer.airline_code)).size,
      sources: new Set(sorted.map((offer) => offer.source_id)).size,
      weeks_searched: availableWeeks().length,
    },
    offers: sorted,
  };
}

export function getSearchResults(query: SearchQuery, lastBatchAt = DEFAULT_LAST_BATCH_AT, sourceFlags = ACTIVE_SOURCE_FLAGS): SearchResult {
  const matches = findDestinationMatches(query.destination_input || query.destination);
  const dest = DESTINATIONS.find((d) => d.code === query.destination) ?? DESTINATIONS.find((d) => d.code === matches[0]?.code);
  if (!dest) {
    return buildSearchResult(query, null, matches, []);
  }

  const searchedDestinations = isBroadDestinationSearch(query.destination_input || query.destination, matches)
    ? matches
        .map((match) => DESTINATIONS.find((destination) => destination.code === match.code))
        .filter((destination): destination is Destination => Boolean(destination))
    : [dest];
  const searchedDestinationCodes = new Set(searchedDestinations.map((destination) => destination.code));
  const minNights = Math.max(3, query.days - query.flex_days);
  const maxNights = Math.min(14, query.days + query.flex_days);
  const allOffers: Offer[] = [];
  for (const week of availableWeeks()) {
    const weekOffers = buildMarket(week.code, lastBatchAt).filter((offer) => {
      if (offer.origin !== query.origin) return false;
      if (offer.depart_date < todayIso()) return false;
      if (!searchedDestinationCodes.has(offer.destination_code)) return false;
      if (offer.traveler !== query.traveler) return false;
      if (offer.stay_nights < minNights || offer.stay_nights > maxNights) return false;
      if (query.cabin !== "ALL" && offer.cabin_group !== query.cabin) return false;
      if (offer.price_status === "sold_out") return false;
      if (!isOfferSourceEligible(offer, sourceFlags)) return false;
      return true;
    });
    allOffers.push(...weekOffers);
  }

  return buildSearchResult(
    query,
    destinationToSearchDestination(dest),
    matches,
    allOffers,
    searchedDestinations.map(destinationToSearchDestination),
  );
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function filterOffers(
  offers: Offer[],
  query: {
    origin: string;
    region?: RegionCode;
    destination?: string;
    depart?: string;
    return?: string;
    stay_bucket?: StayBucket;
    traveler?: string;
    cabin?: CabinCode;
    airlines?: string[];
    stops?: "ALL" | "0" | "1";
    sourceFlags?: string[];
  },
) {
  return offers.filter((offer) => {
    if (offer.depart_date < todayIso()) return false;
    if (query.origin === "SEL") {
      if (offer.origin !== "ICN" && offer.origin !== "GMP") return false;
    } else if (offer.origin !== query.origin) {
      return false;
    }
    if (query.region && query.region !== "ALL" && offer.region_code !== query.region) return false;
    if (query.destination && offer.destination_code !== query.destination) return false;
    if (query.depart && offer.depart_date !== query.depart) return false;
    if (query.return && offer.return_date !== query.return) return false;
    if (query.stay_bucket && query.stay_bucket !== "ALL" && offer.trip_bucket !== query.stay_bucket) return false;
    if (query.traveler && offer.traveler !== query.traveler) return false;
    if (query.cabin && query.cabin !== "ALL" && offer.cabin_group !== query.cabin) return false;
    if (query.airlines?.length && !query.airlines.includes(offer.airline_code)) return false;
    if (query.stops && query.stops !== "ALL" && String(offer.stops) !== query.stops) return false;
    if (query.sourceFlags && !isOfferSourceEligible(offer, query.sourceFlags)) return false;
    return true;
  });
}

function parseBudget(value?: string | string[]) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

// UX-20260831-005: 성인 인원(1~9). 데이터는 성인 1인 요금만 제공하므로 조회 조건(traveler)은
// adt1 그대로 두고 표시층 총액(1인가 × pax)에만 사용한다 — 아동 요금은 피드에 없어 계산하지 않는다.
export function parsePax(value?: string | string[]): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 9 ? Math.floor(parsed) : 1;
}

export function parseMapQuery(input: Record<string, string | string[] | undefined>): MapQuery {
  return {
    origin: (Array.isArray(input.origin) ? input.origin[0] : input.origin ?? "ICN").toUpperCase(),
    week: Array.isArray(input.week) ? input.week[0] : input.week ?? availableWeeks()[0].code,
    region: normalizeRegion(Array.isArray(input.region) ? input.region[0] : input.region),
    cabin: normalizeCabin(Array.isArray(input.cabin) ? input.cabin[0] : input.cabin),
    stay_bucket: normalizeStayBucket(Array.isArray(input.stay_bucket) ? input.stay_bucket[0] : input.stay_bucket),
    traveler: normalizeTraveler(Array.isArray(input.traveler) ? input.traveler[0] : input.traveler),
    airlines: normalizeAirlines(input.airlines),
    budget: parseBudget(input.budget),
    pax: parsePax(input.pax),
  };
}

export function parseCalendarQuery(input: Record<string, string | string[] | undefined>): CalendarQuery {
  const map = parseMapQuery(input);
  return {
    ...map,
    destination: (Array.isArray(input.destination) ? input.destination[0] : input.destination ?? "").toUpperCase(),
  };
}

export function parseOffersQuery(input: Record<string, string | string[] | undefined>): OffersQuery {
  return {
    origin: (Array.isArray(input.origin) ? input.origin[0] : input.origin ?? "ICN").toUpperCase(),
    week: Array.isArray(input.week) ? input.week[0] : input.week ?? availableWeeks()[0].code,
    destination: (Array.isArray(input.destination) ? input.destination[0] : input.destination ?? "").toUpperCase(),
    depart: Array.isArray(input.depart) ? input.depart[0] : input.depart ?? "",
    return: Array.isArray(input.return) ? input.return[0] : input.return ?? "",
    cabin: normalizeCabin(Array.isArray(input.cabin) ? input.cabin[0] : input.cabin),
    traveler: normalizeTraveler(Array.isArray(input.traveler) ? input.traveler[0] : input.traveler),
    airline: normalizeAirlines(input.airline ?? input.airlines),
    stops: (((Array.isArray(input.stops) ? input.stops[0] : input.stops) ?? "ALL").toUpperCase() as "ALL" | "0" | "1"),
    pax: parsePax(input.pax),
  };
}

export function getMapData(query: MapQuery, lastBatchAt: string, sourceFlags = ACTIVE_SOURCE_FLAGS): MapData {
  const offers = filterOffers(buildMarket(query.week, lastBatchAt), { ...query, sourceFlags }).sort((a, b) => a.price_total - b.price_total);
  const grouped = new Map<string, MapDealAccumulator>();

  for (const offer of offers) {
    const current = grouped.get(offer.destination_code) ?? {
      destination_code: offer.destination_code,
      city: offer.destination_city,
      country: offer.destination_country,
      region_code: offer.region_code,
      region_label: offer.region_label,
      lat: offer.lat,
      lon: offer.lon,
      economy_min_total: null,
      business_min_total: null,
      economy_discount_pct: null,
      business_discount_pct: null,
      economy_price_status: null,
      business_price_status: null,
      best_airline_by_cabin: { ECONOMY: null, BUSINESS: null },
      best_origin_by_cabin: { ECONOMY: null, BUSINESS: null },
      representative_links: { ECONOMY: null, BUSINESS: null },
      last_batch_at: offer.last_batch_at,
      last_seen_at: offer.last_seen_at,
      warning_flags: new Set<string>(),
      promotion_tags: new Set<string>(),
      source_mix: new Set<string>(),
    } satisfies MapDealAccumulator;
    const bestByCabin = current.best_airline_by_cabin as { ECONOMY: string | null; BUSINESS: string | null };
    const bestOrigin = current.best_origin_by_cabin as { ECONOMY: string | null; BUSINESS: string | null };
    const links = current.representative_links as { ECONOMY: string | null; BUSINESS: string | null };
    if (offer.cabin_group === "ECONOMY" && ((current.economy_min_total as number | null) === null || offer.price_total < (current.economy_min_total as number))) {
      current.economy_min_total = offer.price_total;
      current.economy_discount_pct = Math.max(offer.discount_pct_30, offer.discount_pct_90);
      current.economy_price_status = offer.price_status;
      bestByCabin.ECONOMY = offer.airline_code;
      bestOrigin.ECONOMY = offer.origin;
      links.ECONOMY = offer.deep_link;
    }
    if (offer.cabin_group === "BUSINESS" && ((current.business_min_total as number | null) === null || offer.price_total < (current.business_min_total as number))) {
      current.business_min_total = offer.price_total;
      current.business_discount_pct = Math.max(offer.discount_pct_30, offer.discount_pct_90);
      current.business_price_status = offer.price_status;
      bestByCabin.BUSINESS = offer.airline_code;
      bestOrigin.BUSINESS = offer.origin;
      links.BUSINESS = offer.deep_link;
    }
    for (const flag of offer.warning_flags) (current.warning_flags as Set<string>).add(flag);
    for (const badge of offer.badges) (current.promotion_tags as Set<string>).add(badge);
    (current.source_mix as Set<string>).add(offer.source_name);
    grouped.set(offer.destination_code, current);
  }

  const deals: MapDeal[] = [...grouped.values()]
    .map((deal) => ({
      ...deal,
      promotion_tags: [...(deal.promotion_tags as Set<string>)].sort(),
      source_mix: [...(deal.source_mix as Set<string>)].sort(),
      warning_flags: [...(deal.warning_flags as Set<string>)].sort(),
    }) as MapDeal)
    .filter((deal) => {
      const fare =
        query.cabin === "ECONOMY"
          ? deal.economy_min_total
          : query.cabin === "BUSINESS"
            ? deal.business_min_total
            : deal.economy_min_total ?? deal.business_min_total;
      if (!fare) return false;
      return query.budget == null || fare <= query.budget;
    })
    .map((deal) => {
      if (query.cabin === "ECONOMY") {
        return { ...deal, business_min_total: null, business_discount_pct: null, business_price_status: null };
      }
      if (query.cabin === "BUSINESS") {
        return { ...deal, economy_min_total: null, economy_discount_pct: null, economy_price_status: null };
      }
      return deal;
    })
    .sort((a, b) => {
      const aPrice = Math.min(...[a.economy_min_total, a.business_min_total].filter(Boolean) as number[]);
      const bPrice = Math.min(...[b.economy_min_total, b.business_min_total].filter(Boolean) as number[]);
      return aPrice - bPrice;
    });

  const availableAirlines = [...new Map(offers.map((offer) => [offer.airline_code, { code: offer.airline_code, name: offer.airline_name }])).values()];

  return {
    origin: query.origin,
    week: query.week,
    region: query.region,
    cabin: query.cabin,
    stay_bucket: query.stay_bucket,
    traveler: query.traveler,
    deals,
    available_airlines: availableAirlines,
    summary: {
      destinations: deals.length,
      offers_considered: offers.length,
      last_seen_at: offers.reduce<string | null>((latest, offer) => (!latest || offer.last_seen_at > latest ? offer.last_seen_at : latest), null),
    },
  };
}

export function getCalendarData(query: CalendarQuery, lastBatchAt: string, sourceFlags = ACTIVE_SOURCE_FLAGS): CalendarData {
  const destination = DESTINATIONS.find((item) => item.code === query.destination);
  if (!destination) {
    return {
      origin: query.origin,
      week: query.week,
      stay_bucket: query.stay_bucket,
      traveler: query.traveler,
      destination: null,
      departure_dates: [] as string[],
      return_dates: [] as string[],
      cells: [] as CalendarCell[],
      available_airlines: [] as Array<{ code: string; name: string }>,
    };
  }

  const offers = filterOffers(buildMarket(query.week, lastBatchAt), { ...query, sourceFlags });
  const cells = new Map<string, CalendarCellAccumulator>();
  const departureDates = new Set<string>();
  const returnDates = new Set<string>();

  for (const offer of offers) {
    const key = `${offer.depart_date}:${offer.return_date}`;
    const current = cells.get(key) ?? {
      depart_date: offer.depart_date,
      return_date: offer.return_date,
      stay_nights: offer.stay_nights,
      trip_bucket: offer.trip_bucket_label,
      economy_min_total: null,
      business_min_total: null,
      economy_discount_pct: null,
      business_discount_pct: null,
      economy_price_status: null,
      business_price_status: null,
      best_airline_by_cabin: { ECONOMY: null, BUSINESS: null },
      best_offer_ids: { ECONOMY: null, BUSINESS: null },
      last_batch_at: offer.last_batch_at,
      badges: new Set<string>(),
    } satisfies CalendarCellAccumulator;
    if (offer.cabin_group === "ECONOMY" && ((current.economy_min_total as number | null) === null || offer.price_total < (current.economy_min_total as number))) {
      current.economy_min_total = offer.price_total;
      current.economy_discount_pct = Math.max(offer.discount_pct_30, offer.discount_pct_90);
      current.economy_price_status = offer.price_status;
      (current.best_airline_by_cabin as { ECONOMY: string | null; BUSINESS: string | null }).ECONOMY = offer.airline_code;
      (current.best_offer_ids as { ECONOMY: string | null; BUSINESS: string | null }).ECONOMY = offer.offer_id;
    }
    if (offer.cabin_group === "BUSINESS" && ((current.business_min_total as number | null) === null || offer.price_total < (current.business_min_total as number))) {
      current.business_min_total = offer.price_total;
      current.business_discount_pct = Math.max(offer.discount_pct_30, offer.discount_pct_90);
      current.business_price_status = offer.price_status;
      (current.best_airline_by_cabin as { ECONOMY: string | null; BUSINESS: string | null }).BUSINESS = offer.airline_code;
      (current.best_offer_ids as { ECONOMY: string | null; BUSINESS: string | null }).BUSINESS = offer.offer_id;
    }
    for (const badge of offer.badges) (current.badges as Set<string>).add(badge);
    departureDates.add(offer.depart_date);
    returnDates.add(offer.return_date);
    cells.set(key, current);
  }

  const data: CalendarCell[] = [...cells.values()].map((cell) => ({
    ...cell,
    badges: [...(cell.badges as Set<string>)].sort(),
  }) as CalendarCell);

  return {
    origin: query.origin,
    week: query.week,
    stay_bucket: query.stay_bucket,
    traveler: query.traveler,
    destination: {
      code: destination.code,
      city: destination.city,
      country: destination.country,
      region_code: destination.region,
      region_label: REGIONS.find((item) => item.code === destination.region)?.label ?? destination.region,
      lat: destination.lat,
      lon: destination.lon,
    },
    departure_dates: [...departureDates].sort(),
    return_dates: [...returnDates].sort(),
    cells: data.sort((a, b) => String(a.depart_date).localeCompare(String(b.depart_date)) || String(a.return_date).localeCompare(String(b.return_date))),
    available_airlines: [...new Map(offers.map((offer) => [offer.airline_code, { code: offer.airline_code, name: offer.airline_name }])).values()],
  };
}

export function getOffersData(query: OffersQuery, lastBatchAt: string, sourceFlags = ACTIVE_SOURCE_FLAGS): OffersData {
  const offers = filterOffers(buildMarket(query.week, lastBatchAt), {
    origin: query.origin,
    destination: query.destination,
    depart: query.depart,
    return: query.return,
    traveler: query.traveler,
    cabin: query.cabin,
    airlines: query.airline,
    stops: query.stops,
    sourceFlags,
  })
    .filter((offer) => !isHiddenFare(offer.last_seen_at || offer.last_batch_at))
    .sort((a, b) => a.price_total - b.price_total || a.airline_code.localeCompare(b.airline_code));

  return {
    origin: query.origin,
    week: query.week,
    traveler: query.traveler,
    destination: query.destination,
    depart: query.depart,
    return: query.return,
    offers,
    filters: {
      available_airlines: [...new Map(offers.map((offer) => [offer.airline_code, { code: offer.airline_code, name: offer.airline_name }])).values()],
      available_cabins: [...new Set(offers.map((offer) => offer.cabin_group))].map((code) => ({
        code,
        label: code === "ECONOMY" ? "일반석" : "비즈니스석",
      })),
      available_stops: [...new Set(offers.map((offer) => offer.stops))].sort(),
    },
    summary: {
      count: offers.length,
      lowest_total: offers[0]?.price_total ?? null,
      last_seen_at: offers.reduce<string | null>((latest, offer) => (!latest || offer.last_seen_at > latest ? offer.last_seen_at : latest), null),
    },
  };
}

export function pinTop(lat: number) {
  const raw = ((72 - lat) / 145) * 100;
  return Math.min(88, Math.max(10, raw));
}

export function pinLeft(lon: number) {
  const raw = ((lon + 180) / 360) * 100;
  return Math.min(92, Math.max(8, raw));
}
