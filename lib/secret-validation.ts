import { createHash, timingSafeEqual } from "node:crypto";

export const MIN_PRODUCTION_SECRET_LENGTH = 16;

export type SecretValueFailureReason = "missing" | "placeholder_value" | "too_short";

const PLACEHOLDER_SECRET_VALUES = new Set([
  "replace-me",
  "changeme",
  "change-me",
  "todo",
  "dummy",
  "example",
  "test",
  "test-token",
  "test-secret",
  "secret",
  "your-secret-here",
  "your-token-here",
]);

export function secretValueFailure(
  value: string | undefined,
  options: { minLength?: number } = {},
): SecretValueFailureReason | null {
  const minLength = options.minLength ?? MIN_PRODUCTION_SECRET_LENGTH;
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "missing";

  const normalized = trimmed.toLowerCase();
  if (PLACEHOLDER_SECRET_VALUES.has(normalized) || normalized.includes("replace-me")) {
    return "placeholder_value";
  }
  if (minLength > 0 && trimmed.length < minLength) return "too_short";
  return null;
}

// SEC-20260903-001: 요청이 보낸 시크릿과 설정된 시크릿의 비교는 타이밍 안전하게 한다.
// timingSafeEqual은 길이가 다르면 예외를 던지므로 양쪽을 sha256로 다이제스트해 길이를 맞춘 뒤 비교한다.
export function secretMatches(provided: string, configured: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(configured));
}
