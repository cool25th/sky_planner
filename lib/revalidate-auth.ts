import { secretValueFailure } from "./secret-validation.ts";

export { secretValueFailure };

export const REVALIDATE_SECRET_HEADER = "x-revalidate-secret";

export function revalidateRequestSecret(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;
  return request.headers.get(REVALIDATE_SECRET_HEADER)?.trim() ?? "";
}

export function isRevalidateRequestAuthorized(
  request: Request,
  env: Record<string, string | undefined> = process.env,
) {
  const configuredSecret = env.VERCEL_REVALIDATE_SECRET;
  if (secretValueFailure(configuredSecret)) return false;
  return revalidateRequestSecret(request) === configuredSecret;
}
