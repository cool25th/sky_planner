export function errorMessage(value: unknown, fallback = "unknown_error") {
  if (value instanceof Error && value.message.trim()) return value.message;
  if (value instanceof Error) return fallback;
  const rendered = String(value).trim();
  return rendered || fallback;
}
