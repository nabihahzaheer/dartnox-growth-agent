/**
 * ERROR COPY — one sentence per failure kind, for both interfaces.
 *
 * WHY THIS MOVED OUT OF `components/ErrorState.tsx`.
 *
 * v1 already got this right: it holds a `Record<FailureKind, string>` and its own header explains
 * that the map exists because three screens had each declared their own copy of the same seven
 * sentences, and a fourth had none and rendered every failure as one line. D-031's argument for the
 * taxonomy is that **there are seven kinds because the copy differs per kind**, so a screen that
 * collapses them makes that argument false wherever a reviewer happens to look.
 *
 * The rebuild then reintroduced exactly that defect — all six rebuilt screens catch every failure
 * and render the single sentence "Could not reach the agent. Nothing has been lost — try again."
 * Found by auditing the states rather than by anything failing, because nothing does fail: the copy
 * is simply less true than the taxonomy behind it.
 *
 * The fix needed one map visible to both interfaces, and the direction of the dependency decided
 * where it goes. Importing v1's component module from the rebuild would point the living interface
 * at the frozen one, so deleting v1 later would break the rebuild — backwards. This is plain data
 * keyed on a union declared in `lib/types.ts`, and the compiler enforces that the map is total over
 * that union, so it belongs beside the type it is keyed on. Both interfaces import it from here.
 *
 * The same precedent HANDOVER §4 records for `WEEK_SLOT_LABEL`: label maps are framework-agnostic
 * and safe to share, components that render through `[data-ui='v1']`-scoped tokens are not. v1 keeps
 * its own panel; only the words are shared.
 */

import type { ConsoleError } from './types.ts';

/**
 * The six kinds that are genuinely failures.
 *
 * `not_found` is excluded on purpose and the exclusion is load-bearing. D-031's own table says it
 * renders as "an empty state, not an error" — nothing broke, nothing needs retrying, and painting it
 * as a fault tells the operator to worry about the wrong thing. Leaving it in the map is what let it
 * be styled as an error on three v1 screens without anyone noticing.
 */
export type FailureKind = Exclude<ConsoleError['kind'], 'not_found'>;

/**
 * One sentence per kind. Two are worth reading closely, because they are the pair that justifies
 * the taxonomy having seven members rather than one:
 *
 *   `unavailable` says the failure is transient and invites a retry.
 *   `timeout` refuses to say that, because a timed-out *write* may have landed. The console tells
 *   the operator it does not know rather than retrying and risking a double approval (A-06).
 *
 * Typed as a total `Record` over the union, so adding an eighth kind to `ConsoleError` is a compile
 * error here rather than a screen rendering `undefined` at somebody.
 */
export const ERROR_COPY: Record<FailureKind, string> = {
  version_conflict: 'This changed while you had it open. Reload before deciding.',
  guardrail_block: 'A guardrail blocked that.',
  forbidden: 'That control is fixed and cannot be changed.',
  rate_limited: 'Too many requests. Try again shortly.',
  unavailable: 'Could not reach the agent runtime. This is usually transient.',
  timeout: 'Timed out, so we do not know whether it landed. Reload before retrying.',
};

/**
 * Per-screen wording for the one kind whose sentence is genuinely about the screen rather than about
 * the failure — "this draft is not here" reads differently from "this week is not here". Everything
 * else is identical wherever it appears, which is why it is central.
 */
export function errorCopy(error: ConsoleError, notFoundCopy = 'That no longer exists.'): string {
  return error.kind === 'not_found' ? notFoundCopy : ERROR_COPY[error.kind];
}

/**
 * Narrow an unknown caught value to the taxonomy.
 *
 * `agentClient` throws plain objects rather than `Error`s (D-002: the caller branches on `kind`,
 * and parsing a message string is the alternative and is worse). Anything that reaches a catch
 * without a `kind` is a genuine programming fault rather than a modelled failure, and `unavailable`
 * is the honest rendering of it: something broke, trying again is reasonable.
 */
export function asConsoleError(e: unknown): ConsoleError {
  return typeof e === 'object' && e !== null && 'kind' in e
    ? (e as ConsoleError)
    : { kind: 'unavailable' };
}
