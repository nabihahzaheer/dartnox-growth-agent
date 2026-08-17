/**
 * ANCHOR — the one date every fixture timestamp is measured from. Build time only.
 *
 * Imported by `next.config.ts` (which runs in Node during the build) and by `lib/time.ts` (which
 * runs in the browser), so it imports nothing and is a pure function of the instant handed to it.
 *
 * WHY OFFSETS AND A FIXED ANCHOR (R2 · D-030). No fixture holds an absolute date; every timestamp
 * is a signed offset in minutes from here. The offsets make the dataset express relationships — a
 * run finishes before the draft it produced is scored — instead of timestamps kept consistent by
 * hand. Fixing the anchor at build time is what stops the server render and the browser render
 * disagreeing, which React reports as a hydration mismatch.
 *
 * WHY THURSDAY. The schedule is weekday-shaped: planning Monday, drafting batch Wednesday, review
 * runway counted in working days. An anchor on the wrong weekday puts Wednesday's batch on a
 * Sunday and makes every runway figure wrong, silently.
 *
 * WHY 14:00 UTC RATHER THAN A LOCAL WALL-CLOCK TIME — simplified 17 Aug. An earlier version pinned
 * the anchor to 10:00 in the client's own timezone, which meant converting a local wall-clock time
 * back into an absolute instant. That direction is the one `Intl` does not offer, so it took about
 * thirty-five lines and a two-pass correction to survive daylight saving.
 *
 * All of that served the *hour*, and the hour is not load-bearing — only the weekday is. 14:00 UTC
 * is mid-morning in New York in both halves of the year (10:00 in summer, 09:00 in winter), which
 * is all the anchor needs to be. Deleting the requirement deleted the hardest code in the
 * repository.
 */

/** Brightsill is in Brooklyn. `fixtures/client.ts` imports this rather than repeating the string,
 *  and `lib/time.ts` formats every displayed time in it. */
export const CLIENT_TIMEZONE = 'America/New_York';

/** Thursday, in `Date`'s numbering where Sunday is 0. */
const THURSDAY = 4;

/** Mid-morning in New York year round: 10:00 EDT in summer, 09:00 EST in winter. */
const ANCHOR_UTC_HOUR = 14;

/**
 * The most recent Thursday at 14:00 UTC, at or before `now`, as an ISO instant.
 *
 * "At or before" matters: on a Thursday morning the answer is the previous Thursday, not one a few
 * hours in the future. An anchor ahead of the build would put "now" after the whole dataset and
 * invert every relative timestamp on screen.
 */
export function computeAnchorIso(now: Date): string {
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), ANCHOR_UTC_HOUR),
  );

  // Step back to Thursday. `+ 7) % 7` handles every weekday and gives 0 on a Thursday.
  let daysBack = (candidate.getUTCDay() - THURSDAY + 7) % 7;

  // On a Thursday before the anchor hour, the most recent one is a week ago.
  if (daysBack === 0 && candidate.getTime() > now.getTime()) daysBack = 7;

  candidate.setUTCDate(candidate.getUTCDate() - daysBack);
  return candidate.toISOString();
}
