/**
 * TIME — turning a fixture offset into something a person reads.
 *
 * The idea that makes this safe: **"now" is the anchor, not the reader's clock.** Nothing here
 * calls `Date.now()`, so every static timestamp computes identically on the server and in the
 * browser and no hydration mismatch is possible. The one thing that genuinely ticks — a deadline
 * counting down — lives in `components/Countdown.tsx`, the only place allowed the real clock.
 *
 * Weekday and month names come from the fixed arrays below rather than from `Intl`'s locale data,
 * because that data is supplied by the runtime and the runtime differs between server and browser.
 * Four lines removes a class of hydration bug and gives exactly the format intended.
 */

import { CLIENT_TIMEZONE } from './anchor.ts';
import type { MinutesFromAnchor } from './types.ts';

export { CLIENT_TIMEZONE };

/** Used when the build did not inline an anchor. A real Thursday, so the fallback obeys the same
 *  invariant as the computed value; it costs freshness, never correctness. */
const FALLBACK_ANCHOR_ISO = '2026-08-13T14:00:00.000Z';

/**
 * Inlined as a string literal at build by the `env` block in `next.config.ts` — there is no
 * `process` object in a browser. Written out in full deliberately: the substitution is textual, so
 * destructuring `process.env` would silently yield `undefined` and this module would run on the
 * fallback forever.
 */
export const ANCHOR_ISO: string = process.env.ANCHOR_ISO ?? FALLBACK_ANCHOR_ISO;

export const ANCHOR_MS: number = new Date(ANCHOR_ISO).getTime();

/** "Now" as an offset. Zero by definition — the anchor *is* now. Named so call sites read as
 *  intent rather than as a magic `0`. */
export const NOW = 0 as MinutesFromAnchor;

const MINUTE_MS = 60_000;

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_LABELS = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0-6, Sunday first
};

/**
 * What the clock reads in `timeZone` at a given instant.
 *
 * `Intl.DateTimeFormat` is the platform's own timezone database, and instant-to-local-parts is the
 * direction it supports. That is why nothing here needs a date library.
 */
export function wallClockIn(timeZone: string, when: Date): WallClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(when);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    // 'en-GB' with hour12:false renders midnight as 24 rather than 00.
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/* ------------------------------------------------------------------------------ conversion --- */

/** The absolute instant a fixture offset refers to. */
export function at(offset: MinutesFromAnchor): Date {
  return new Date(ANCHOR_MS + offset * MINUTE_MS);
}

/** Milliseconds from the anchor to an offset. Negative for the past. */
export function msFromNow(offset: MinutesFromAnchor): number {
  return offset * MINUTE_MS;
}

/* ------------------------------------------------------------------------------ formatting --- */

function clockAt(offset: MinutesFromAnchor) {
  return wallClockIn(CLIENT_TIMEZONE, at(offset));
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `09:00` — client-local, 24-hour, because the posting schedule is written that way. */
export function formatTime(offset: MinutesFromAnchor): string {
  const c = clockAt(offset);
  return `${pad(c.hour)}:${pad(c.minute)}`;
}

/** `Thu 13 Aug` */
export function formatDate(offset: MinutesFromAnchor): string {
  const c = clockAt(offset);
  return `${WEEKDAY_LABELS[c.weekday]} ${pad(c.day)} ${MONTH_LABELS[c.month]}`;
}

/** `Thu 13 Aug, 09:00` — the default wherever a specific moment is shown. */
export function formatDateTime(offset: MinutesFromAnchor): string {
  return `${formatDate(offset)}, ${formatTime(offset)}`;
}

/**
 * `4 min ago` · `in 3 hours` · `yesterday` · `in 6 days`.
 *
 * Hand-written rather than `Intl.RelativeTimeFormat` because the thresholds are a product
 * decision: an item waiting 30 hours should read "yesterday", since what the operator cares about
 * is that it crossed a day boundary. Days come from the calendar date rather than from dividing by
 * 1440, so a daylight-saving boundary never adds or removes one.
 */
export function formatRelative(offset: MinutesFromAnchor): string {
  const mins = offset as number;
  const abs = Math.abs(mins);
  const past = mins < 0;

  if (abs < 1) return 'just now';
  if (abs < 60) return past ? `${Math.round(abs)} min ago` : `in ${Math.round(abs)} min`;

  if (abs < 60 * 20) {
    const n = Math.round(abs / 60);
    return past ? `${n} hour${n === 1 ? '' : 's'} ago` : `in ${n} hour${n === 1 ? '' : 's'}`;
  }

  const days = calendarDaysBetween(NOW, offset);
  if (days === 0) return past ? 'earlier today' : 'later today';
  if (days === 1) return past ? 'yesterday' : 'tomorrow';
  if (days < 7) return past ? `${days} days ago` : `in ${days} days`;

  const w = Math.round(days / 7);
  return past ? `${w} week${w === 1 ? '' : 's'} ago` : `in ${w} week${w === 1 ? '' : 's'}`;
}

/** Whole client-local calendar days between two offsets. */
export function calendarDaysBetween(a: MinutesFromAnchor, b: MinutesFromAnchor): number {
  return Math.abs(signedCalendarDays(a, b));
}

/** As above, keeping direction: negative when `b` is before `a`. Days come from the client-local
 *  calendar date rather than from dividing by 1440, so a daylight-saving boundary never adds one. */
function signedCalendarDays(a: MinutesFromAnchor, b: MinutesFromAnchor): number {
  const ca = clockAt(a);
  const cb = clockAt(b);
  const dayA = Date.UTC(ca.year, ca.month - 1, ca.day);
  const dayB = Date.UTC(cb.year, cb.month - 1, cb.day);
  return Math.round((dayB - dayA) / 86_400_000);
}

/**
 * An offset as a client-local calendar day: a whole-day index plus the weekday it falls on.
 *
 * The index is only meaningful against another value from this function — it exists so a caller can
 * walk day by day. The weekday is the point: anything reasoning about working days, posting windows
 * or a weekly grid has to agree with the calendar the client actually publishes against, and
 * `Math.floor(offset / 1440)` does not. That divides time into 24-hour blocks measured from the
 * anchor's mid-morning, so "day 3" spans Sunday morning to Monday morning and a Monday 09:00 slot
 * gets attributed to Sunday.
 */
export function localDay(offset: MinutesFromAnchor): { index: number; weekday: number } {
  const c = clockAt(offset);
  return {
    index: Math.round(Date.UTC(c.year, c.month - 1, c.day) / 86_400_000),
    weekday: c.weekday,
  };
}

/** Monday to Friday. The client's posting window is weekdays and L4 checks it before publishing. */
export const isWorkingDay = (weekday: number): boolean => weekday >= 1 && weekday <= 5;

/* ----------------------------------------------------------------------------------- weeks --- */

/**
 * WEEKS, because the product's unit of work is one.
 *
 * The agent plans on Monday, drafts the whole of the following week on Wednesday, publishes
 * against slots, and learns on Sunday. Everything the operator does sits inside a week, so the
 * week needs to be a value the code can pass around rather than something each screen re-derives
 * from a pile of timestamps.
 *
 * WEEKS ARE INDEXED RELATIVE TO THE ANCHOR, NOT NUMBERED. Week 0 contains the anchor, week +1 is
 * the one being drafted right now, week −1 is the one that just published. Absolute week numbers
 * would reintroduce exactly the drift R2/D-030 removed by making every timestamp an offset.
 *
 * MONDAY-FIRST, because the schedule is: planning Monday, drafting Wednesday, learning Sunday. A
 * Sunday-first week would split the learning run off from the week it learned from.
 */
const MINUTES_PER_DAY = 1440;

/** How far into its own week the anchor sits, in whole days. The anchor is a Thursday and
 *  `scripts/check.mts` enforces that, so this is 3 — but it is derived, not assumed. */
function anchorDaysSinceMonday(): number {
  return (clockAt(NOW).weekday + 6) % 7;
}

/**
 * Which week an offset falls in, relative to the anchor's own week.
 *
 * `Math.floor` rather than a truncating divide: truncation rounds toward zero, which would fold
 * last Sunday (−1 day from a Monday boundary) into week 0 alongside this Monday. Off-by-one on a
 * week boundary is the defect this function exists to not have.
 */
export function weekIndexOf(offset: MinutesFromAnchor): number {
  return Math.floor((signedCalendarDays(NOW, offset) + anchorDaysSinceMonday()) / 7);
}

/** Monday 00:00 client-local of a given week, as an offset. */
export function weekStart(index: number): MinutesFromAnchor {
  const c = clockAt(NOW);
  const intoWeek = anchorDaysSinceMonday() * MINUTES_PER_DAY + c.hour * 60 + c.minute;
  return (index * 7 * MINUTES_PER_DAY - intoWeek) as MinutesFromAnchor;
}

/** `03` — the day of the month, for a calendar column head. Zero-padded so the seven columns line
 *  up rather than jittering between one and two digits. */
export function formatDayNumber(offset: MinutesFromAnchor): string {
  return pad(clockAt(offset).day);
}

/** `Mon` — the day name alone, for a column head or a schedule row. */
export function weekdayShort(offset: MinutesFromAnchor): string {
  return WEEKDAY_LABELS[clockAt(offset).weekday];
}

/**
 * `This week` · `Next week` · `Last week` · `Week of 20 Jul`.
 *
 * The three named ones are the only weeks an operator refers to by name. Anything further out is
 * a date, because "in 3 weeks" is not something you can check a calendar against.
 */
export function weekLabel(index: number): string {
  if (index === 0) return 'This week';
  if (index === 1) return 'Next week';
  if (index === -1) return 'Last week';
  const start = weekStart(index);
  const c = clockAt(start);
  return `Week of ${pad(c.day)} ${MONTH_LABELS[c.month]}`;
}

/**
 * `2h 14m` · `18m` · `3d 4h` — a span, not a moment. Used for deadlines, backoff and queue age.
 * Never returns "0m": a span that has run out is a different state and the caller renders it.
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
