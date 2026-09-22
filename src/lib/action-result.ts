import { unstable_rethrow } from "next/navigation";

/**
 * What a server action called from a client component returns. Expected
 * failures (a missing name, a placeholder left in, no permission) come back as
 * values, because a thrown message is replaced by a generic one in production
 * builds and the person would never learn what to fix.
 */
export type ActionResult<T extends object = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string };

type Data<T> = T extends object ? T : Record<never, never>;

/**
 * Runs an action's body and turns a thrown Error into `{ ok: false, error }`.
 * redirect() and notFound() are rethrown so Next.js still handles them.
 */
export async function asResult<T extends object | void>(work: () => Promise<T>): Promise<ActionResult<Data<T>>> {
  try {
    const data: unknown = await work();
    return { ok: true, ...(data as Data<T>) };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

/** True for a failed ActionResult; anything else (including void) counts as success. */
export function isFailure(res: unknown): res is { ok: false; error: string } {
  return typeof res === "object" && res !== null && (res as { ok?: unknown }).ok === false;
}
