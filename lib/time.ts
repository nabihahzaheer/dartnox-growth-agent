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
  const ca = clockAt(a);
  const cb = clockAt(b);
  const dayA = Date.UTC(ca.year, ca.month - 1, ca.day);
  const dayB = Date.UTC(cb.year, cb.month - 1, cb.day);
  return Math.abs(Math.round((dayB - dayA) / 86_400_000));
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
