const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function formatMoney(value: number | null): string {
  if (value === null) return "-";
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
}

export function stamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function formatCompactDate(value: string): string {
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()} (${WEEKDAYS[date.getDay()]})`;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", weekday: "short" }).format(new Date(value));
}

export function weekStartDate(code: string): Date | null {
  const match = code.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const jan4 = new Date(Date.UTC(parseInt(match[1], 10), 0, 4));
  return new Date(jan4.getTime() + ((parseInt(match[2], 10) - 1) * 7 - (jan4.getUTCDay() || 7) + 1) * 86400000);
}

export function formatWeekNatural(code: string): string {
  const startDay = weekStartDate(code);
  if (!startDay) return code;
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

export function isPastWeek(code: string): boolean {
  const start = weekStartDate(code);
  if (!start) return false;
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (now.getUTCDay() || 7) + 1);
  return start.getTime() < monday.getTime();
}
