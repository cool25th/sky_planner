export function formatWeekNatural(code: string): string {
  const match = code.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return code;
  const year = parseInt(match[1], 10);
  const weekNum = parseInt(match[2], 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const startDay = new Date(jan4.getTime() + ((weekNum - 1) * 7 - (jan4.getUTCDay() || 7) + 1) * 86400000);
  const endDay = new Date(startDay.getTime() + 6 * 86400000);
  const m1 = startDay.getUTCMonth() + 1;
  const d1 = startDay.getUTCDate();
  const m2 = endDay.getUTCMonth() + 1;
  const d2 = endDay.getUTCDate();
  if (m1 === m2) {
    return `${m1}월 ${d1}일 ~ ${d2}일`;
  }
  return `${m1}월 ${d1}일 ~ ${m2}월 ${d2}일`;
}
