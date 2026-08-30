// UX-20260830-002: 연령대×계절 큐레이션 — 에디터 정적 데이터(통계 아님).
// "많이 가는 곳" 수치 주장은 관광지식정보시스템(know.tour.go.kr) 연령×목적지 교차 통계를
// 확보해야만 가능하다. 그 전에는 "추천" 문구로 큐레이션임을 명시한다(근거 없는 주장 금지).
// 통계 확보 시 이 테이블을 수치 기반으로 교체하면 칩 문구를 "인기" 계열로 올릴 수 있다.

export type AgeGroup = "20s" | "30s" | "40s";
export type Season = "spring" | "summer" | "autumn" | "winter";

export const AGE_GROUP_LABELS: Record<AgeGroup, string> = {
  "20s": "20대",
  "30s": "30대",
  "40s": "40대",
};

const SEASON_LABELS: Record<Season, string> = {
  spring: "봄",
  summer: "여름",
  autumn: "가을",
  winter: "겨울",
};

export function seasonForMonth(month1to12: number): Season {
  if (month1to12 >= 3 && month1to12 <= 5) return "spring";
  if (month1to12 >= 6 && month1to12 <= 8) return "summer";
  if (month1to12 >= 9 && month1to12 <= 11) return "autumn";
  return "winter";
}

// ISO 주 코드(2026-W36) → 그 주 월요일의 계절. date-only UTC 계산(KST/UTC 어긋남 교훈).
export function seasonForWeekCode(weekCode: string): Season {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekCode);
  if (!m) return seasonForMonth(new Date().getUTCMonth() + 1);
  const DAY_MS = 86400000;
  const jan4 = Date.UTC(Number(m[1]), 0, 4);
  const isoDow = (new Date(jan4).getUTCDay() + 6) % 7; // 0=월요일
  const monday = jan4 - isoDow * DAY_MS + (Number(m[2]) - 1) * 7 * DAY_MS;
  return seasonForMonth(new Date(monday).getUTCMonth() + 1);
}

// 연령·계절별 추천 목적지(선호 순). 21개 취항 목적지 코드만 사용한다.
const AUDIENCE_AFFINITY: Record<AgeGroup, Record<Season, readonly string[]>> = {
  "20s": {
    spring: ["OSA", "TPE", "SHA", "TYO", "BKK"],
    summer: ["DAD", "CEB", "TPE", "BKK", "DPS"],
    autumn: ["OSA", "TYO", "BKK", "TPE", "HAN"],
    winter: ["BKK", "TPE", "HKG", "CEB", "OSA"],
  },
  "30s": {
    spring: ["TYO", "FUK", "SIN", "DPS", "GUM"],
    summer: ["GUM", "DPS", "CEB", "SIN", "FUK"],
    autumn: ["TYO", "FUK", "PEK", "SIN", "HKG"],
    winter: ["SIN", "GUM", "DPS", "HKG", "FUK"],
  },
  "40s": {
    spring: ["TYO", "SIN", "PEK", "LAX", "DXB"],
    summer: ["GUM", "SIN", "SYD", "LAX", "HKG"],
    autumn: ["TYO", "PEK", "SYD", "SIN", "LAX"],
    winter: ["DXB", "SIN", "GUM", "SYD", "LAX"],
  },
};

export function audienceRank(destinationCode: string, ageGroup: AgeGroup, season: Season): number | null {
  const idx = AUDIENCE_AFFINITY[ageGroup][season].indexOf(destinationCode);
  return idx === -1 ? null : idx + 1;
}

export function audienceChipLabel(ageGroup: AgeGroup, season: Season): string {
  return `${AGE_GROUP_LABELS[ageGroup]} ${SEASON_LABELS[season]} 추천`;
}

// 연령 친화도 순 안정 정렬(미등록 목적지는 기존 순서 유지). Array#sort는 안정 정렬이다.
export function orderForAudience<T extends { destination_code: string }>(
  items: readonly T[],
  ageGroup: AgeGroup,
  season: Season,
): T[] {
  return [...items].sort((a, b) => {
    const rankA = audienceRank(a.destination_code, ageGroup, season) ?? Number.MAX_SAFE_INTEGER;
    const rankB = audienceRank(b.destination_code, ageGroup, season) ?? Number.MAX_SAFE_INTEGER;
    return rankA - rankB;
  });
}
