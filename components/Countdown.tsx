'use client';

/**
 * COUNTDOWN — the only component that reads the real clock.
 *
 * Four things tick down: the 48h calendar gate, the 72h stakeholder acknowledgement, a parked
 * run's next sweep, and the backoff between tool retries. Each is a hydration hazard, because a
 * clock necessarily differs between the server render and the browser render.
 *
 * The fix: the first render uses fixture arithmetic only, so both sides agree; the effect starts
 * measuring real time after mount, by which point React has matched the trees. Written once so
 * that reasoning lives in one place instead of on four screens.
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
  /** Fixed number from the fixtures — no clock involved, so both renders agree. */
  const initialRemainingMs = msFromNow(deadline);

  /** Real ms since mount. Zero on the server and on hydration's first pass. */
  const [elapsedMs, setElapsedMs] = useState(0);

  /** Guards `onExpire` so it fires once rather than on every tick past the deadline. */
  const hasExpired = useRef(false);

  /**
   * Held in a ref, not listed as an effect dependency. An inline arrow callback would hand over a
   * new identity every render, re-running the effect and resetting `mountedAt` — leaving the
   * countdown frozen at its starting value while appearing to work.
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

    // StrictMode double-mounts in development; without cleanup two timers would run against one
    // component and the countdown would skip. `cancelled` covers a callback already in flight,
    // `clearTimeout` the one not yet fired.
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [initialRemainingMs]);

  const remainingMs = initialRemainingMs - elapsedMs;
  const expired = remainingMs <= 0;

  return (
    <time
      /** Derived from the fixture offset, never the real clock: `Date.now()` here would be the
       *  obvious thing and would reintroduce the mismatch this component exists to avoid. */
      dateTime={at(deadline).toISOString()}
      title={formatDateTime(deadline)}
      /** `.tabular` is not optional here and is applied by the component rather than left to the
       *  four call sites: this is the one string in the app that rewrites itself once a second, so
       *  proportional digits would make the whole line jitter sideways on every tick. Callers keep
       *  their own `className` for size and colour. */
      className={className ? `tabular ${className}` : 'tabular'}
      /** Deliberately not a live region: announcing every second makes a screen reader unusable.
       *  The deadline is readable from `title` and `dateTime`; the ticking is visual. */
      aria-live="off"
    >
      {expired ? expiredLabel : formatDuration(remainingMs / 60_000)}
    </time>
  );
}
