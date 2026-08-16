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
