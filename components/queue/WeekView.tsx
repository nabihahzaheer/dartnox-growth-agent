'use client';

/**
 * THE WEEK, DRAWN.
 *
 * The agent's headline behaviour is "plans a weekly content calendar from brand pillars", and until
 * this file nothing rendered a calendar. The week already existed as a value — `lib/week.ts` joins
 * ratified slots to the planning run's proposed ones and hands back seven days, always seven — but
 * every screen consumed it as a list. An operator could read what was waiting on them and could not
 * read what was going out on Thursday.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS A VIEW AND NOT A SCREEN
 *
 * A `/calendar` route was the obvious shape and was rejected: five screens is a logged scope
 * decision, and a sixth would have to earn its place in the rail against Console/Queue/Metrics/
 * Settings. It does not — the calendar answers a question about the *same* work the queue lists
 * ("what is going out, and when"), so it is the same screen seen a second way. The toggle is local
 * state on purpose: no route, no query param, no persistence. Reversing that means the back button
 * starts stepping through view changes, which is not navigation.
 *
 * ---------------------------------------------------------------------------------------------
 * DECISIONS WORTH DEFENDING
 *
 * ALL SEVEN DAYS RENDER, INCLUDING THE EMPTY ONES. `Week.days` is always seven and the weekend is
 * empty by contract — 3 LinkedIn (Mon/Wed/Thu) + 5 X (Mon–Fri). A calendar that drops its empty
 * columns is a list with day headings, and it hides the one thing a cadence commitment is checked
 * against: the shape of the week.
 *
 * THIS COMPONENT OWNS ITS OWN FETCH. The queue page already owns a queue read, a settings read, a
 * reload nonce and a decision pipeline; threading a week through it would have coupled the calendar
 * to the queue's reload cycle, so stepping to next week would re-fetch the queue. The week has its
 * own index, its own nonce and its own failure.
 *
 * A FAILED READ NEVER BLANKS THE GRID. The last week that loaded stays on screen with the error
 * panel above it, because a transient read failure is not evidence that the week is empty — the
 * same reasoning that made the queue header refuse to say "0 waiting on you" on a failed load.
 *
 * NO PILLAR COLOUR. `Pillar.colour_token` carries values like `pillar-compliance` which no CSS
 * variable answers to, and inventing them would be a second colour mapping competing with the state
 * tones in `components/Badge.tsx`. The pillar is named, not tinted; colour on this grid means state
 * and only state, which is what lets an operator find their own work by scanning for one hue.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getWeek, subscribeToWorld } from '@/lib/agentClient';
import {
  getSelectedWeek,
  getServerWeek,
  setSelectedWeek,
  subscribeToWeek,
} from '@/lib/weekSelection';
import type { ConsoleError } from '@/lib/types';
import type { Week, WeekDay, WeekEntry } from '@/lib/week';
import { CLIENT_TIMEZONE, at, formatTime, wallClockIn, weekLabel } from '@/lib/time';
import { Badge, WEEK_SLOT_LABEL, weekSlotTone } from '@/components/Badge';
import { Countdown } from '@/components/Countdown';
import { ErrorPanel } from '@/components/ErrorState';

/**
 * Seven columns above 900px, one day per row below it.
 *
 * The breakpoint is arbitrary rather than one of Tailwind's, because it is about this grid: seven
 * columns stop being readable at roughly 110px each once the rail's 240px is taken off the viewport.
 * `min-w` applies only in the wide arm, so the narrow arm can never trigger the scroller.
 */
const GRID = 'grid grid-cols-1 gap-1.5 min-[900px]:grid-cols-7 min-[900px]:min-w-[54rem]';

/** The day number in the client's timezone. Not `Date#getDate()`: that reads the *viewer's* zone,
 *  and the schedule is written in the client's. */
function dayNumber(day: WeekDay): number {
  return wallClockIn(CLIENT_TIMEZONE, at(day.start)).day;
}

export function WeekView() {
  /**
   * Shared with the rail's stepper rather than local — see `lib/weekSelection.ts`. Both are on
   * screen together on this route, and holding the index twice let them disagree: the rail reading
   * "This week" beside this grid reading "Next week".
   */
  const index = useSyncExternalStore(subscribeToWeek, getSelectedWeek, getServerWeek);
  const setIndex = (next: (current: number) => number) => setSelectedWeek(next(index));
  const [week, setWeek] = useState<Week | null>(null);
  const [error, setError] = useState<ConsoleError | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  /**
   * A decision taken in the list view has to move this grid.
   *
   * Approving a draft with `a` while the week is showing changed the world and left the cell still
   * reading "Needs you" — the grid and the queue are two views of the same slot on the same screen.
   * `subscribeToWorld` fires after every write and re-runs the read above through the same async
   * path, so the grid never gets a privileged synchronous view; it just knows when to ask again.
   */
  useEffect(() => subscribeToWorld(reload), [reload]);

  /**
   * Loading is derived, not a flag.
   *
   * The obvious shape is `setLoading(true)` at the top of the effect, and it is a setState before
   * the first `await` in an effect body — a second render pass immediately after the first, which
   * React's lint rule rejects for the same reason it rejects it on this screen's queue fetch.
   * Comparing the request in hand against the last one that settled says the same thing with no
   * extra render: stepping the week makes them differ on the click, and the arriving read makes
   * them agree again.
   */
  const request = `${index}:${reloadNonce}`;
  const [settled, setSettled] = useState<string | null>(null);
  const loading = settled !== request;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await getWeek(index);
        if (!cancelled) {
          setWeek(next);
          setError(null);
        }
      } catch (e) {
        // Deliberately does not clear `week`. See the header: a failed read is not an empty week.
        if (!cancelled) setError(e as ConsoleError);
      } finally {
        if (!cancelled) setSettled(request);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [index, request]);

  return (
    <section aria-label="Week" aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setIndex((i) => i - 1)}
          /** Disabled from the data's own extent, so the stepper cannot walk into empty weeks
           *  forever. Unknown until the first week lands, so it starts disabled. */
          disabled={!week?.hasPrevious}
          aria-label="Previous week"
          className="t-body rounded border px-2 py-0.5 disabled:opacity-30"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          ‹
        </button>
        {/*
          Labelled from the index rather than from `week.label`, so the label changes on the click
          rather than when the fetch lands — otherwise the header names last week while next week is
          loading. Same function that produced `week.label`, so the two cannot drift.
        */}
        <span className="t-section tabular">{weekLabel(index)}</span>
        <button
          type="button"
          onClick={() => setIndex((i) => i + 1)}
          disabled={!week?.hasNext}
          aria-label="Next week"
          className="t-body rounded border px-2 py-0.5 disabled:opacity-30"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          ›
        </button>
        {week && week.waitingOnYou > 0 && (
          <span className="t-meta tabular ml-auto">{week.waitingOnYou} need you</span>
        )}
      </div>

      {error && (
        <div className="mt-2">
          <ErrorPanel error={error} onRetry={reload} />
        </div>
      )}

      <div className="mt-2 overflow-x-auto">
        <div className={GRID}>
          {week
            ? week.days.map((day) => <DayColumn key={day.index} day={day} />)
            : /** Seven boxes, not a spinner: the frame that is about to hold the week is itself the
               *  most honest thing to show while it loads. */
              Array.from({ length: 7 }, (_, i) => (
                <div
                  key={i}
                  className="h-32 rounded border"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface-sunk)' }}
                />
              ))}
        </div>
      </div>
    </section>
  );
}

function DayColumn({ day }: { day: WeekDay }) {
  return (
    <div
      /** `aria-current="date"` is how today reaches a screen reader; the accent rule below is how it
       *  reaches everyone else. Colour alone would carry it for neither. */
      aria-current={day.isToday ? 'date' : undefined}
      className="min-w-0 rounded border"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-sunk)' }}
    >
      <div
        className="border-b px-2 py-1"
        style={{
          borderColor: day.isToday ? 'var(--accent)' : 'var(--border)',
          borderBottomWidth: day.isToday ? '2px' : '1px',
        }}
      >
        <span
          className="t-field tabular"
          style={day.isToday ? { color: 'var(--accent-text)' } : undefined}
        >
          {day.label} {dayNumber(day)}
        </span>
      </div>

      {/* The floor keeps an empty weekend reading as two empty days rather than as two collapsed
          headers. Only in the wide arm — stacked, an empty day should take one row. */}
      <div className="space-y-1.5 p-1.5 min-[900px]:min-h-[6rem]">
        {day.entries.map((entry) => (
          <SlotCell key={entry.key} entry={entry} />
        ))}
      </div>
    </div>
  );
}

const CELL = 'block w-full min-w-0 rounded border px-1.5 py-1 text-left';

function SlotCell({ entry }: { entry: WeekEntry }) {
  const frame = { borderColor: 'var(--border)', background: 'var(--surface)' };

  /**
   * A cell opens the draft. A cell with no draft opens nothing, and that is a decision rather than
   * an omission: for a planned-but-undrafted slot `run_id` is the *planning* run, which is one run
   * shared by all eight slots and has no addressable URL — runs are selected as client state on the
   * console, not routed to. Making those cells clickable would mean eight cells that all land in the
   * same place, or a new route, and it would teach the operator that every cell is a door. Here the
   * ones that are doors are the ones with something behind them.
   */
  if (!entry.draft) {
    return (
      <div className={CELL} style={frame}>
        <SlotBody entry={entry} />
      </div>
    );
  }

  return (
    <Link
      href={`/v1/draft/${entry.draft.id}`}
      className={`${CELL} hover:[border-color:var(--border-strong)]`}
      style={frame}
    >
      <SlotBody entry={entry} />
    </Link>
  );
}

function SlotBody({ entry }: { entry: WeekEntry }) {
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        {/*
          A slot that moved shows the time it was planned for, struck, beside the time it now holds.
          Slipped slots are why published-vs-planned is worth measuring, so the move is visible
          rather than silent — and it is drawn with a strike rather than a colour because state
          colour on this grid comes from `weekSlotTone` and nowhere else.

          GUARDED ON THE TWO TIMES DIFFERING, WHICH IS NOT DEFENSIVE PADDING. `fixtures/history.ts`
          writes `original_publish_at = publish_at` for a slot that slipped because it went
          unreviewed in time: the record is flagged as moved, and it never actually moved. Rendering
          the marker on `moved_from !== null` alone printed the same time twice — "09:00 09:00", one
          struck — which reads as a bug and asserts a reschedule that did not happen. The `Slipped`
          badge already carries that case truthfully.
        */}
        {entry.moved_from !== null && entry.moved_from !== entry.publish_at && (
          <>
            <span className="sr-only">moved from</span>
            <span aria-hidden className="t-meta tabular line-through">
              {formatTime(entry.moved_from)}
            </span>
          </>
        )}
        {/* Spelled, matching the rail. This was `in` / `x` on the theory that a column this narrow
            cannot spend six characters on "LinkedIn" — but a two-character mark is not read, it is
            decoded, and the first question it draws is "is that meant to be LinkedIn?". The cell
            gives the title its own line below, so the six characters were available here. */}
        <span className="t-meta tabular">
          {formatTime(entry.publish_at)} · {entry.channel === 'linkedin' ? 'LinkedIn' : 'X'}
        </span>
      </div>

      <p className="t-body mt-1 line-clamp-2">{entry.angle}</p>

      {entry.pillar && <p className="t-meta mt-0.5 truncate">{entry.pillar.name}</p>}

      <div className="mt-1 flex flex-wrap items-center gap-1">
        <Badge tone={weekSlotTone(entry.state)}>{WEEK_SLOT_LABEL[entry.state]}</Badge>
        {entry.deadline !== null && <Countdown deadline={entry.deadline} className="t-meta tabular" />}
      </div>
    </>
  );
}
