'use client';

/**
 * COUNTDOWN — the only component permitted to read the real clock.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS AS A SHARED COMPONENT RATHER THAN A FEW LINES PER SCREEN
 *
 * Four things in this system tick down, and they are spread across four screens: the 48-hour
 * calendar-approval gate, the 72-hour stakeholder acknowledgement, a parked run's next sweep, and
 * the jittered backoff between tool retries. Each one is a deadline rendered as time remaining.
 *
 * Every one of them is a hydration hazard, and for the same reason. A page in the App Router is
 * rendered once on the server before it is sent, then rendered again in the browser so React can
 * attach to the existing markup. If a value differs between those two renders, React reports a
 * mismatch. A clock always differs between them — that is what a clock is.
 *
 * D-030 removes this hazard for every *static* timestamp by making "now" the fixture anchor rather
 * than the reader's clock, so `lib/time.ts` never looks at `Date.now()` at all. A countdown is the
 * one case that cannot be solved that way, because a value that does not move is not a countdown.
 *
 * Written once, the problem is solved once. Written per screen, it is four chances to reproduce a
 * console error on the screens a reviewer opens first.
 *
 * ---------------------------------------------------------------------------------------------
 * HOW IT AVOIDS THE MISMATCH
 *
 * The first render — the one the server produces and the one the browser must agree with — uses
 * only fixture arithmetic: the deadline's offset, which is a fixed number. `elapsed` starts at
 * zero on both sides, so both produce the same string.
 *
 * Only after mounting does the effect start measuring real elapsed time and re-rendering. Effects
 * do not run during server rendering and do not run during hydration's first pass, so by the time
 * the value moves, React has already matched the two trees and no longer cares.
 *
 * This is the standard shape for anything genuinely time-dependent in a prerendered app, and it
 * is worth being able to state plainly: render what the server can know, then correct it in an
 * effect.
 */

import { useEffect, useRef, useState } from 'react';
import type { MinutesFromAnchor } from '@/lib/types';
import { at, formatDateTime, formatDuration, msFromNow } from '@/lib/time';

type CountdownProps = {
  /** When this is due, as a fixture offset. */
  deadline: MinutesFromAnchor;
  /** Rendered instead of the duration once the deadline passes. */
  expiredLabel?: string;
  /** Called once, when the deadline passes while the component is mounted. */
  onExpire?: () => void;
  className?: string;
};

/**
 * Tick every second when the deadline is close enough for seconds to be visible, and every minute
 * otherwise. A 71-hour stakeholder deadline re-rendering once a second for three days would be
 * sixty times the work to produce the same string sixty times over.
 */
function tickIntervalFor(remainingMs: number): number {
  return Math.abs(remainingMs) < 60 * 60 * 1000 ? 1_000 : 60_000;
}

export function Countdown({ deadline, expiredLabel = 'overdue', onExpire, className }: CountdownProps) {
  /**
   * The gap between the anchor and the deadline. A fixed number from the fixtures — no clock
   * involved — so the server and the browser compute the same thing.
   */
  const initialRemainingMs = msFromNow(deadline);

  /**
   * Real milliseconds since this component mounted. Zero on the server and on hydration's first
   * pass, which is exactly what makes the first render match.
   */
  const [elapsedMs, setElapsedMs] = useState(0);

  /** Guards `onExpire` so it fires once rather than on every tick past the deadline. */
  const hasExpired = useRef(false);

  /**
   * `onExpire` is held in a ref rather than listed as a dependency of the effect below.
   *
   * If it were a dependency, a caller passing an inline arrow function — which is the normal thing
   * to write — would hand a new function identity on every render, the effect would tear down and
   * re-run each time, and `mountedAt` would reset. The countdown would then sit at its starting
   * value forever while appearing to work. Holding the callback in a ref and reading it at call
   * time keeps the effect tied to the deadline alone, which is what it actually depends on.
   */
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    // Wall-clock elapsed time, so it keeps counting while the tab is in the background rather
    // than pausing with the render loop — which is why this is `Date.now()` and not
    // `performance.now()`.
    const mountedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    // A self-rescheduling timeout rather than an interval, so the pace can change as the deadline
    // approaches: the last hour ticks every second, the two days before it every minute. An
    // interval would have to be torn down and recreated to do the same thing.
    const tick = () => {
      if (cancelled) return;

      const elapsed = Date.now() - mountedAt;
      setElapsedMs(elapsed);

      const remaining = initialRemainingMs - elapsed;
      if (remaining <= 0 && !hasExpired.current) {
        hasExpired.current = true;
        onExpireRef.current?.();
      }

      timer = setTimeout(tick, tickIntervalFor(remaining));
    };

    timer = setTimeout(tick, tickIntervalFor(initialRemainingMs));

    // Cleanup is not optional here. React 19's StrictMode mounts every component, unmounts it and
    // mounts it again in development, specifically to surface effects that leak. Without this,
    // two timers would run against one component and the countdown would skip — a bug that
    // appears only in development and reads as a rendering fault rather than a cleanup one.
    // `cancelled` covers the callback already in flight when cleanup runs; `clearTimeout` covers
    // the one that has not fired yet.
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [initialRemainingMs]);

  const remainingMs = initialRemainingMs - elapsedMs;
  const expired = remainingMs <= 0;

  return (
    <time
      /**
       * `dateTime` carries the machine-readable instant, so the element means something to
       * anything reading the document rather than looking at it. The visible text is a duration;
       * this attribute is the moment it counts towards.
       *
       * Derived from the fixture offset, never from the real clock. Writing
       * `new Date(Date.now() + remainingMs)` here would be the obvious thing and would reintroduce
       * the exact hydration mismatch this whole component exists to avoid — the server and the
       * browser would stamp two different instants into the same attribute.
       */
      dateTime={at(deadline).toISOString()}
      title={formatDateTime(deadline)}
      className={className}
      /**
       * Deliberately not an `aria-live` region. A value that changes every second would be
       * announced every second, which makes a screen reader unusable on a screen that may hold
       * several of these. The deadline is available as a static string in `title` and in
       * `dateTime`, which is the readable form; the ticking is a visual affordance.
       */
      aria-live="off"
    >
      {expired ? expiredLabel : formatDuration(remainingMs / 60_000)}
    </time>
  );
}
