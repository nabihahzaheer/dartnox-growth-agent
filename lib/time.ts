/**
 * TIME — the one place a fixture offset becomes something a person reads.
 *
 * Every timestamp in the fixtures is a signed offset in minutes from one anchor (R2 · D-030); the
 * anchor itself, and why it is a Thursday, are explained in `lib/anchor.ts`. This module resolves
 * that anchor at runtime and turns offsets into dates and strings.
 *
 * ---------------------------------------------------------------------------------------------
 * THE IDEA THAT MAKES THE WHOLE THING SAFE
 *
 * "Now", inside this product, is the anchor. It is not the reader's clock.
 *
 * That single choice is what makes every static timestamp on every screen immune to the hydration
 * problem D-030 exists to avoid: "2 hours ago" is computed from two fixed numbers, so the server
 * and the browser cannot disagree about it. Nothing in this file reads the real clock.
 *
 * The one thing that genuinely must tick — a deadline counting down — is deliberately NOT here.
 * It lives in `components/Countdown.tsx`, which is the only place in the app permitted to look at
 * the real clock, and which is built so that its first render still matches the server's.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE FORMATTERS DO NOT USE `Intl` FOR NAMES
 *
 * `Intl.DateTimeFormat` is used for the one job only it can do: working out what the clock says
 * in the client's timezone. The weekday and month *names* are then composed from the fixed arrays
 * below rather than taken from Intl's locale data.
 *
 * The reason is hydration again. Locale data is supplied by the runtime, and the runtime rendering
 * on the server is Node while the runtime rendering in the browser is the browser. If those two
 * ever disagree about an abbreviation — a genuine, if uncommon, source of difference between ICU
 * versions — the result is a mismatch on a timestamp, which is both hard to spot and hard to
 * explain. Fixed arrays cost four lines and remove the class of bug entirely. It also means the
 * format is exactly what was intended rather than what a locale happened to produce.
 */

import { CLIENT_TIMEZONE, computeAnchorIso, wallClockIn } from './anchor.ts';
import type { MinutesFromAnchor } from './types.ts';

export { CLIENT_TIMEZONE };

/**
 * Committed fallback, used when the build did not inline an anchor — which happens if someone
 * runs the app without the config, and in any tooling that imports this module directly.
 *
 * It is a real Thursday 10:00 client-local. Falling back to a wrong-weekday value would reproduce
 * exactly the defect the Thursday rule exists to prevent, so the fallback obeys the same
 * invariant as the computed value. It only ever costs the automatic freshness, never correctness.
 */
const FALLBACK_ANCHOR_ISO = '2026-08-13T14:00:00.000Z';

/**
 * `process.env.ANCHOR_ISO` is substituted textually at build by the `env` block in
 * `next.config.ts`, so this is a literal string by the time it reaches a browser — there is no
 * `process` object there.
 *
 * It must be written out in full. Next's own documentation is explicit that destructuring
 * `process.env` does not work, because the replacement is textual rather than a real object
 * lookup. `const { ANCHOR_ISO } = process.env` would silently yield `undefined` and this module
 * would quietly run on the fallback forever.
 */
export const ANCHOR_ISO: string = process.env.ANCHOR_ISO ?? FALLBACK_ANCHOR_ISO;

/** The anchor as milliseconds since the epoch. Every conversion below starts here. */
export const ANCHOR_MS: number = new Date(ANCHOR_ISO).getTime();

/**
 * "Now" as an offset. Zero, by definition — the anchor *is* now.
 *
 * Exported as a named constant rather than left as a bare `0` at call sites, because
 * `queueAgeMinutes(NOW, approval.queued_at)` says what it means and `queueAgeMinutes(0, ...)`
 * does not.
 */
export const NOW = 0 as MinutesFromAnchor;

const MINUTE_MS = 60_000;

/** Sunday first, matching `Date.prototype.getDay` and `WallClock.weekday`. */
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Indexed 1-12, so the unused zeroth slot keeps the arithmetic free of off-by-ones. */
const MONTH_LABELS = [
  '',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/* ==============================================================================================
 * CONVERSION
 * ============================================================================================*/

/** The absolute instant a fixture offset refers to. */
export function at(offset: MinutesFromAnchor): Date {
  return new Date(ANCHOR_MS + offset * MINUTE_MS);
}

/** Milliseconds between the anchor and an offset. Negative for the past. */
export function msFromNow(offset: MinutesFromAnchor): number {
  return offset * MINUTE_MS;
}

/** True if the offset is in the fixture world's past. */
export function isPast(offset: MinutesFromAnchor): boolean {
  return offset < 0;
}

/* ==============================================================================================
 * FORMATTING — all client-local, all deterministic
 * ============================================================================================*/

/** The wall clock in the client's timezone at a given offset. */
function clockAt(offset: MinutesFromAnchor) {
  return wallClockIn(CLIENT_TIMEZONE, at(offset));
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `09:00` — client-local, 24-hour. The operator's schedule is written in 24-hour time. */
export function formatTime(offset: MinutesFromAnchor): string {
  const c = clockAt(offset);
  return `${pad(c.hour)}:${pad(c.minute)}`;
}

/** `Thu 13 Aug` */
export function formatDate(offset: MinutesFromAnchor): string {
  const c = clockAt(offset);
  return `${WEEKDAY_LABELS[c.weekday]} ${pad(c.day)} ${MONTH_LABELS[c.month]}`;
}

/** `Thu 13 Aug, 09:00` — the default for anything with a specific moment attached. */
export function formatDateTime(offset: MinutesFromAnchor): string {
  return `${formatDate(offset)}, ${formatTime(offset)}`;
}

/** `Thu 13 Aug 2026, 09:00` — only where the year is genuinely in question. */
export function formatFull(offset: MinutesFromAnchor): string {
  const c = clockAt(offset);
  return `${formatDate(offset)} ${c.year}, ${formatTime(offset)}`;
}

/**
 * `4 minutes ago` · `in 3 hours` · `yesterday` · `in 6 days`.
 *
 * Hand-written rather than delegated to `Intl.RelativeTimeFormat` for the same determinism reason
 * as the name arrays, and because the unit thresholds here are a product decision. A queue item
 * that has been waiting 30 hours should read "yesterday", not "in 2 days" — the operator cares
 * that it crossed a day boundary, and the p95 target is measured in hours.
 *
 * `days` is computed from the calendar date rather than by dividing by 1440, so 23:00 to 01:00
 * reads "yesterday" rather than "2 hours ago" losing the day boundary. That is the distinction an
 * operator actually reads.
 */
export function formatRelative(offset: MinutesFromAnchor): string {
  const mins = offset as number;
  const abs = Math.abs(mins);
  const past = mins < 0;

  if (abs < 1) return 'just now';

  if (abs < 60) {
    const n = Math.round(abs);
    return past ? `${n} min ago` : `in ${n} min`;
  }

  if (abs < 60 * 20) {
    const n = Math.round(abs / 60);
    const unit = n === 1 ? 'hour' : 'hours';
    return past ? `${n} ${unit} ago` : `in ${n} ${unit}`;
  }

  const days = calendarDaysBetween(NOW, offset);

  if (days === 0) return past ? 'earlier today' : 'later today';
  if (days === 1) return past ? 'yesterday' : 'tomorrow';
  if (days < 7) return past ? `${days} days ago` : `in ${days} days`;

  const weeks = Math.round(days / 7);
  const unit = weeks === 1 ? 'week' : 'weeks';
  return past ? `${weeks} ${unit} ago` : `in ${weeks} ${unit}`;
}

/**
 * Whole client-local calendar days between two offsets, as a positive count.
 *
 * Uses the local calendar date rather than elapsed milliseconds, so a daylight-saving boundary
 * between the two never adds or removes a day — an hour of clock change is not a day, and 23-hour
 * days exist twice a year in the client's timezone.
 */
export function calendarDaysBetween(a: MinutesFromAnchor, b: MinutesFromAnchor): number {
  const ca = clockAt(a);
  const cb = clockAt(b);
  const dayA = Date.UTC(ca.year, ca.month - 1, ca.day);
  const dayB = Date.UTC(cb.year, cb.month - 1, cb.day);
  return Math.abs(Math.round((dayB - dayA) / 86_400_000));
}

/**
 * `2h 14m` · `18m` · `3d 4h` — a span, not a moment.
 *
 * Used for deadlines, backoff gaps and queue age. Deliberately never says "0m": a span that has
 * run out is a different state and the caller renders it, rather than this returning something
 * that reads like a live value.
 */
export function formatDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  if (m < 60) return `${m}m`;

  const hours = Math.floor(m / 60);
  const mins = m % 60;
  if (hours < 24) return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours === 0 ? `${days}d` : `${days}d ${remHours}h`;
}

/**
 * The anchor recomputed from the current real clock.
 *
 * Not used by the app. It exists so `scripts/check.ts` can assert that the committed fallback and
 * the computed value obey the same invariant, and so the value can be inspected without reading
 * the build output.
 */
export function anchorForNow(): string {
  return computeAnchorIso(new Date());
}
