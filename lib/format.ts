const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function formatMoney(value: number | null): string {
  if (value === null) return "-";
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
}

// 타임스탬프 표기는 KST 고정 — SSR 런타임(TZ=UTC)에서 last_batch_at·출발 시각이
// 9시간 어긋난(심지어 전날 날짜) 값으로 렌더되는 것을 방지한다.
export function stamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(date);
}

// UX-20260831-001: live 오퍼는 다리 시각이 결측될 수 있다(read-model이 NULL을 ""로 정규화) —
// Intl format이 Invalid Date에서 throw하면 /offers 렌더 전체가 죽는다. stamp()와 같은 가드.
export function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시간 미정";
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(date);
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
