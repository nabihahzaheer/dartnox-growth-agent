/**
 * ANCHOR COMPUTATION — build time only.
 *
 * This file is imported by `next.config.ts`, which runs in Node during the build, and by
 * `lib/time.ts`, which runs in the browser. It therefore imports nothing and touches no
 * environment: it is a pure function of the instant you hand it.
 *
 * WHY IT IS SEPARATE FROM `lib/time.ts`. `lib/time.ts` reads `process.env.ANCHOR_ISO`, the value
 * this file produces. Importing that module from the config would execute the read while the
 * config is still being evaluated — before the value exists — which is a confusing thing to leave
 * lying around even though it would resolve harmlessly to the fallback. Splitting on the
 * build-time / runtime seam is the honest boundary and costs one small file.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT AN ANCHOR IS AND WHY THERE IS ONE  (R2 · D-030)
 *
 * No fixture contains an absolute date. Every timestamp is a signed offset in minutes from one
 * anchor: −1440 is yesterday, +120 is two hours out. Two separate wins, worth not conflating:
 *
 *   The OFFSETS make the dataset express relationships instead of eighteen absolute timestamps
 *   kept mutually consistent by hand. A run finishes before the draft it produced is scored,
 *   because the arithmetic says so rather than because someone checked.
 *
 *   The FIXED anchor avoids a hydration bug. Client components are still prerendered on the
 *   server in the App Router. Computing "now" at render makes the server tree and the browser
 *   tree disagree, and React logs a loud mismatch — on the console screen, which is the first
 *   thing a reviewer opens.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE ANCHOR IS A THURSDAY  (D-030 amendment 1, 17 Aug)
 *
 * D-030 originally said "resolved at build time", meaning the build timestamp. `lib/types.ts`
 * separately says the anchor is a Thursday and that THE WEEKDAY IS LOAD-BEARING. Those two
 * statements are not compatible: a build timestamp lands on whatever day the deploy happens.
 *
 * The schedule is weekday-shaped (A-01). Planning runs Monday. The drafting batch runs Wednesday
 * for the following week. Review runway is counted in *working* days. Trace T13 is a Friday post
 * drawing hostile replies on a Saturday. Deploy on a Monday under the original rule and the
 * Wednesday batch renders on a Sunday, every runway figure is wrong, and T13's story moves off
 * the weekend it depends on. Nothing throws. The data just stops making sense to anyone reading
 * the dates, which is worse than an error.
 *
 * So: the most recent Thursday 10:00 client-local at or before the build. A Thursday anchor puts
 * yesterday's Wednesday batch in the queue with a full runway ahead of it, last Friday's post
 * inside the 48-hour engagement-poll window, and Monday's planning run in recent history.
 *
 * A second benefit that was not the reason. D-030 conceded that the dataset ages between deploys.
 * Snapping to the previous Thursday bounds that drift to at most seven days AND makes it drift in
 * whole weeks, so the weekday shape stays correct the entire time. The conceded cost shrinks
 * without new machinery.
 */

/**
 * The fictional client's timezone. Every publish time renders client-local, and the anchor is
 * "Thursday 10:00" *in this zone* rather than in UTC or on the build machine (Vercel builds in
 * UTC; a laptop does not).
 *
 * Brightsill is in Brooklyn, so this is `America/New_York`. `fixtures/client.ts` imports this
 * constant for its `timezone` field rather than repeating the string — one value, one place.
 */
export const CLIENT_TIMEZONE = 'America/New_York';

/** Thursday, in `Date`'s day numbering where Sunday is 0. */
const THURSDAY = 4;

/** The anchor's local hour. Mid-morning: the operator's working day has started. */
const ANCHOR_HOUR = 10;

export type WallClock = {
  year: number;
  month: number; // 1-12, as humans write it, not Date's 0-11
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0-6, Sunday first, matching Date.prototype.getDay
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * What the clock on the wall says in `timeZone` at instant `at`.
 *
 * `Intl.DateTimeFormat` is the only timezone database in the platform, and it is the reason this
 * file needs no date library. `formatToParts` hands back the components individually rather than
 * as a string that would then have to be parsed back apart.
 *
 * `en-GB` with `hour12: false` is chosen for a stable, boring part set. The locale affects only
 * the weekday abbreviation, which is mapped through a lookup below rather than trusted.
 */
export function wallClockIn(timeZone: string, at: Date): WallClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`Intl returned no "${type}" part for ${timeZone}`);
    return found.value;
  };

  const weekdayName = get('weekday');
  const weekday = WEEKDAY_INDEX[weekdayName];
  if (weekday === undefined) {
    throw new Error(`Unrecognised weekday "${weekdayName}" from Intl`);
  }

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    // 'en-GB' with hour12:false renders midnight as "24" rather than "00". Normalising here means
    // no caller has to know that.
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday,
  };
}

/**
 * The absolute instant at which the wall clock in `timeZone` reads the given local time.
 *
 * This is the direction Intl does not provide, so it is solved by measuring rather than by
 * consulting a table of offsets. Treat the wall time as though it were UTC, ask what that instant
 * looks like in the target zone, and the difference is the zone's offset at that moment. Subtract
 * it.
 *
 * The correction is applied twice. The offset used in the first pass is the one in force at the
 * *guessed* instant, which is up to a day away from the real one, and across a daylight-saving
 * boundary those two offsets differ by an hour. The second pass measures at a point that is
 * already correct to within that hour and converges. This is the standard fix and the reason it
 * is not a loop is that a second iteration is provably enough for any real zone.
 */
function instantForWallClock(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute);

  let guess = asIfUtc;
  for (let pass = 0; pass < 2; pass++) {
    const seen = wallClockIn(timeZone, new Date(guess));
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess -= seenAsUtc - asIfUtc;
  }

  return new Date(guess);
}

/**
 * The most recent Thursday at `ANCHOR_HOUR`:00 client-local, at or before `now`.
 *
 * Returned as an ISO 8601 instant so it survives being inlined into the bundle as a string and
 * parsed identically on both sides of the server/browser boundary.
 *
 * The `at or before` matters: on a Thursday at 09:00 the answer is the *previous* Thursday, not
 * one an hour in the future. An anchor ahead of the build would put "now" in the future relative
 * to the whole dataset and quietly invert every relative timestamp on screen.
 */
export function computeAnchorIso(now: Date): string {
  const local = wallClockIn(CLIENT_TIMEZONE, now);

  // Days back to the most recent Thursday. `+ 7) % 7` keeps it in range for every weekday, and
  // yields 0 on a Thursday — handled by the look-back below.
  let daysBack = (local.weekday - THURSDAY + 7) % 7;

  // On a Thursday *before* 10:00, the most recent Thursday 10:00 is a week ago, not an hour from
  // now. At exactly 10:00 the answer is today, which is why this is `<` and not `<=`.
  if (daysBack === 0 && local.hour < ANCHOR_HOUR) daysBack = 7;

  // Step back in whole days using UTC arithmetic on the *local calendar date*, which has no
  // daylight-saving hazard: the date is treated as a plain calendar value, and the conversion
  // back to an instant happens once, afterwards, with the offset measured at that point.
  const stepped = new Date(Date.UTC(local.year, local.month - 1, local.day));
  stepped.setUTCDate(stepped.getUTCDate() - daysBack);

  return instantForWallClock(
    CLIENT_TIMEZONE,
    stepped.getUTCFullYear(),
    stepped.getUTCMonth() + 1,
    stepped.getUTCDate(),
    ANCHOR_HOUR,
    0,
  ).toISOString();
}
