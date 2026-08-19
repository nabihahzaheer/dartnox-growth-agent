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
 * THIS WEEK'S THURSDAY at 14:00 UTC — not the most recent one. Weeks run Monday to Sunday.
 *
 * CHANGED 19 AUG, AND THE REASON IS WORTH RECORDING BECAUSE THE OLD RULE LOOKED MORE CAUTIOUS.
 * It used to return the most recent Thursday at or before the build, so the anchor was never in the
 * future. That sounds safer and produced a visible contradiction. The dataset is built around the
 * anchor: the Wednesday batch ran "yesterday" and drafts the posts for "next week". Six days after
 * a Thursday build, "next week" in the fixture's frame is the week the real calendar is currently
 * in — so the console said it was drafting next week's posts while the calendar showed those same
 * posts inside the week it had labelled "Current week". Both screens were right about their own
 * frame and the pair of them was nonsense.
 *
 * Anchoring to this week's Thursday puts the fixture's "now" inside the real current week, which is
 * what makes "next week" mean the same thing on both screens. The cost is that the anchor can sit
 * up to three days ahead of the build. That is not the failure the old comment warned about — that
 * one was about the anchor overtaking the *dataset*, which cannot happen, because every fixture
 * timestamp is an offset from the anchor and half of them are negative. What it actually costs is
 * drift against the real clock, and it makes that drift smaller: at most three days in either
 * direction, where the old rule ran up to seven days behind and was at its worst on a Wednesday.
 *
 * `scripts/check.mts` asserts the weekday and the three-day bound.
 */
export function computeAnchorIso(now: Date): string {
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), ANCHOR_UTC_HOUR),
  );

  // Monday-anchored: 0 on a Monday through 6 on a Sunday, whatever `Date`'s Sunday-first numbering
  // says. Thursday is three days along from there.
  const sinceMonday = (candidate.getUTCDay() + 6) % 7;
  candidate.setUTCDate(candidate.getUTCDate() - sinceMonday + (THURSDAY - 1));

  return candidate.toISOString();
}
