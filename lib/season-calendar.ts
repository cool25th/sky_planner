// RECO-20260828-003: 한국 공휴일·목적지 시즌 정적 캘린더.
// 연휴는 추천 점수의 근거가 되고(+15, "추석 연휴 포함"), 시즌 노트는 우기·태풍 등
// 정직한 안내 칩으로만 쓴다(점수 없음). 2027 말까지 — 이후 해는 데이터를 갱신한다.

export interface KoreanHoliday {
  date: string;
  name: string;
}

export const KOREAN_HOLIDAYS: KoreanHoliday[] = [
  { date: "2026-01-01", name: "신정" },
  { date: "2026-02-16", name: "설날 연휴" },
  { date: "2026-02-17", name: "설날" },
  { date: "2026-02-18", name: "설날 연휴" },
  { date: "2026-03-01", name: "삼일절" },
  { date: "2026-05-05", name: "어린이날" },
  { date: "2026-06-06", name: "현충일" },
  { date: "2026-08-15", name: "광복절" },
  { date: "2026-09-24", name: "추석 연휴" },
  { date: "2026-09-25", name: "추석" },
  { date: "2026-09-26", name: "추석 연휴" },
  { date: "2026-10-03", name: "개천절" },
  { date: "2026-10-09", name: "한글날" },
  { date: "2026-12-25", name: "성탄절" },
  { date: "2027-01-01", name: "신정" },
  { date: "2027-02-05", name: "설날 연휴" },
  { date: "2027-02-06", name: "설날" },
  { date: "2027-02-07", name: "설날 연휴" },
  { date: "2027-03-01", name: "삼일절" },
  { date: "2027-05-05", name: "어린이날" },
  { date: "2027-06-06", name: "현충일" },
  { date: "2027-08-15", name: "광복절" },
  { date: "2027-09-14", name: "추석 연휴" },
  { date: "2027-09-15", name: "추석" },
  { date: "2027-09-16", name: "추석 연휴" },
  { date: "2027-10-03", name: "개천절" },
  { date: "2027-10-09", name: "한글날" },
  { date: "2027-12-25", name: "성탄절" },
];

const DAY_MS = 86400000;
const HOLIDAYS_BY_DATE = new Map(KOREAN_HOLIDAYS.map((holiday) => [holiday.date, holiday.name]));

export function holidaysInStay(departDate: string | null | undefined, returnDate: string | null | undefined): string[] {
  if (!departDate || !returnDate) return [];
  const start = Date.parse(`${String(departDate).slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${String(returnDate).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const names: string[] = [];
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const iso = new Date(ms).toISOString().slice(0, 10);
    const name = HOLIDAYS_BY_DATE.get(iso);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

// 연휴 구간에 걸치면 "추석 연휴 포함"으로 통합하고, 단일 공휴일이면 "한글날 포함".
export function holidayReason(names: string[]): string | null {
  if (!names.length) return null;
  const base = names.find((name) => name.endsWith(" 연휴")) ?? names[0];
  if (base.endsWith(" 연휴")) return `${base} 포함`;
  const baseName = base.replace(/ 연휴$/, "");
  if (names.length > 1 && names.some((name) => name === `${baseName} 연휴`)) {
    return `${base.replace(/ 연휴$/, "")} 연휴 포함`;
  }
  return `${base} 포함`;
}

// 목적지×월 시즌 노트 — 잘 알려진 것만. 점수에 영향 없는 정보 칩.
export const SEASON_NOTES: Record<string, Record<number, string>> = {
  DPS: { 11: "발리 우기 시작", 12: "발리 우기", 1: "발리 우기", 2: "발리 우기", 3: "발리 우기" },
  BKK: { 6: "방콕 우기", 7: "방콕 우기", 8: "방콕 우기", 9: "방콕 우기" },
  CEB: { 7: "세부 우기", 8: "세부 우기", 9: "세부 우기", 10: "세부 우기" },
  GUM: { 8: "괌 태풍 시즌", 9: "괌 태풍 시즌", 10: "괌 태풍 시즌", 11: "괌 태풍 시즌" },
  HKG: { 7: "홍콩 태풍 시즌", 8: "홍콩 태풍 시즌", 9: "홍콩 태풍 시즌" },
  SYD: { 12: "시드니 한여름 성수기", 1: "시드니 한여름 성수기", 2: "시드니 한여름 성수기" },
};

export function seasonNoteFor(destinationCode: string, departDate: string | null | undefined): string | null {
  if (!departDate) return null;
  const month = Number(String(departDate).slice(5, 7));
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return SEASON_NOTES[destinationCode]?.[month] ?? null;
}
