import { NotConnectedError, PlatformError } from "./types";

/**
 * What a failed publish means for the next step. Posting twice is worse than
 * posting late, so the line is drawn by whether the post could have landed:
 *
 * - retry: it certainly did not go out (rate limited, service unavailable, no
 *   connection made). Try again after a delay.
 * - ambiguous: it may have gone out (a timeout, a gateway error). A person
 *   looks at the channel before anything is sent again.
 * - permanent: the platform refused it (bad request, no permission, gone).
 *   Trying again changes nothing.
 */
export type FailureKind = "retry" | "ambiguous" | "permanent";
export type Failure = { kind: FailureKind; retryAfterMs?: number };

const AMBIGUOUS_STATUS = new Set([408, 500, 502, 504]);
const PERMANENT_STATUS = new Set([400, 401, 403, 404, 405, 409, 410, 413, 415, 422]);

export function classifyFailure(err: unknown): Failure {
  if (err instanceof NotConnectedError) return { kind: "permanent" };
  if (err instanceof PlatformError) {
    if (err.status === 429 || err.status === 503) return { kind: "retry", retryAfterMs: err.retryAfterMs };
    if (AMBIGUOUS_STATUS.has(err.status)) return { kind: "ambiguous" };
    if (PERMANENT_STATUS.has(err.status)) return { kind: "permanent" };
    return err.status >= 500 ? { kind: "ambiguous" } : { kind: "permanent" };
  }
  const message = err instanceof Error ? `${err.name} ${err.message} ${(err as { cause?: { code?: string } }).cause?.code ?? ""}` : String(err);
  // The request never reached the platform.
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ENETUNREACH/i.test(message)) return { kind: "retry" };
  // We sent it and heard nothing back.
  if (/time(d)? ?out|aborted|socket hang up|ECONNRESET|UND_ERR|ETIMEDOUT/i.test(message)) return { kind: "ambiguous" };
  if (/\b429\b|too many requests|rate.?limit/i.test(message)) return { kind: "retry" };
  return { kind: "retry" };
}

const MINUTE = 60_000;
/** How long to wait before attempt number `attempts + 1`: 10 then 30 minutes, longer if the platform asked. */
export function retryDelayMs(attempts: number, retryAfterMs?: number) {
  const base = [10, 30, 90][Math.min(attempts, 3) - 1] ?? 90;
  return Math.min(6 * 60 * MINUTE, Math.max(MINUTE, retryAfterMs ?? 0, base * MINUTE));
}
