'use client';

/**
 * THE WEEK — the operator's actual unit of work, as `lib/week.ts` already modelled it.
 *
 * This page is thin on purpose. `buildWeek` does the eight-slot join, resolves each entry's state
 * across slot/post/draft in the one order that is correct, and computes the owner's calendar gate —
 * all of it existed before this page did, unrendered. Building the week screen turned out to mean
 * wiring one existing read, not inventing a projection.
 *
 * WHY THE OWNER GATE LIVES HERE, NOT ON A SEPARATE SCREEN.
 *
 * The board names two human gates: the operator approving a draft, and the client owner approving
 * the week's plan before drafting starts. The first has had a screen since step 4. The second had
 * none — nothing before this rendered `OwnerGate` at all, even though `lib/week.ts` computed it from
 * day one. It belongs on the week rather than on its own page because it is a fact about the week,
 * not a decision the operator makes: the owner approves by an emailed link (A-08), and the console's
 * job is to show where that stands, not to offer a control for someone else's approval.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getWeek, initialWeekIndex, subscribeToWorld } from '@/lib/agentClient';
import type { Week } from '@/lib/week';
import type { ConsoleError } from '@/lib/types';
import { asConsoleError } from '@/lib/errorCopy';
import { LoadError, LoadingState, StaleWarning } from '@/components/ScreenState';
import { formatDateTime, formatRelative, formatTime } from '@/lib/time';
/**
 * The label map only, not the `Badge` component — `Badge` renders through v1's Tailwind classes and
 * CSS tokens scoped to `[data-ui='v1']`, which do not exist at `:root`. `WEEK_SLOT_LABEL` is a plain
 * `Record<string,string>` with no such scoping, so importing just it keeps one source of truth for
 * what a state is called in English without dragging in styling built for the other palette.
 */
import { WEEK_SLOT_LABEL } from '@/components/Badge';

/**
 * The rebuilt palette's own tone map, kept separate from v1's `weekSlotTone` in `components/Badge`.
 * That function returns tokens scoped to `[data-ui='v1']` — `--state-awaiting` and its siblings do
 * not exist at `:root`, so reusing it here would resolve to nothing. The state→English labels in
 * `WEEK_SLOT_LABEL` are plain strings with no such scoping problem and are imported as-is below, so
 * the two screens say the same word for the same state without sharing a colour system that would
 * break on one side of the fork.
 */
function pillClass(state: string): string {
  if (state === 'needs_you') return 'pill-attend';
  if (state === 'drafting') return 'pill-live';
  if (state === 'published' || state === 'approved' || state === 'scheduled') return 'pill-go';
  if (state === 'planned') return 'pill-calm';
  return 'pill-stop'; // blocked · rejected · failed · quarantined · dropped · slipped · pulled
}

export default function WeekPage() {
  /**
   * A lazy initializer, not an effect. `initialWeekIndex()` is a synchronous, side-effect-free read
   * over the current world — see its own comment in `agentClient.ts` — so it is safe to call during
   * the first render itself. Seeding it from an effect would render week 0 for one frame and then
   * correct to the real index, and it would also be exactly the synchronous-setState-in-an-effect
   * shape `DraftCard` and the console already hit twice this build.
   */
  const [index, setIndex] = useState<number>(() => initialWeekIndex());
  const [week, setWeek] = useState<Week | null>(null);
  const [error, setError] = useState<ConsoleError | null>(null);

  /**
   * A sequence guard, because the stepper can outrun its own reads.
   *
   * `getWeek` sleeps 260ms. Two clicks inside that window race, and nothing stopped the older
   * response landing last — leaving the grid showing one week while `index` held another. The
   * previous/next buttons then computed the next step from `week.index` rather than `index`, so the
   * stepper carried on from the stale week and the two never re-converged. Both halves are fixed:
   * the buttons step from `index`, and a response is discarded unless it is the newest request.
   */
  const latest = useRef(0);

  const load = useCallback(async (i: number) => {
    const ticket = ++latest.current;
    try {
      const w = await getWeek(i);
      if (ticket !== latest.current) return;
      setWeek(w);
      setError(null);
    } catch (e) {
      if (ticket !== latest.current) return;
      setError(asConsoleError(e));
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToWorld(() => void load(index));
    const timer = setTimeout(() => void load(index), 0);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [index, load]);

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">The week</h1>
      </header>

      {error && !week && <LoadError error={error} onRetry={() => void load(index)} />}
      {error && week && <StaleWarning error={error} onRetry={() => void load(index)} />}

      {!week && !error && <LoadingState lines={3} label="Loading the week" />}

      {week && (
        <>
          <div className="rh">
            <div className="l1">
              <h2>{week.label}</h2>
              {week.waitingOnYou > 0 && (
                <span className="pill pill-attend">{week.waitingOnYou} need you</span>
              )}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!week.hasPrevious}
                  aria-label="Previous week"
                  onClick={() => setIndex(index - 1)}
                >
                  ‹
                </button>
                {/**
                 * Goes to week 0, which is what "This week" means.
                 *
                 * It called `initialWeekIndex()`, which is the week that has work waiting — week 1
                 * in the shipped fixtures. So a button labelled "This week" landed on a page whose
                 * own heading read "Next week", both visible at once. The landing week and the
                 * current week are different questions and only one of them is called "this week".
                 */}
                <button type="button" className="btn btn-sm" onClick={() => setIndex(0)}>
                  This week
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!week.hasNext}
                  aria-label="Next week"
                  onClick={() => setIndex(index + 1)}
                >
                  ›
                </button>
              </span>
            </div>
          </div>

          <OwnerGateBanner gate={week.ownerGate} />

          <div className="wk-grid">
            {week.days.map((day) => (
              <div key={day.index} className={`wk-day${day.isToday ? ' wk-today' : ''}`}>
                <p className="wk-daylabel">{day.label}</p>
                {day.entries.length === 0 && <p className="wk-empty">—</p>}
                {day.entries.map((entry) => {
                  const body = (
                    <>
                      <span className="wk-row1">
                        <span
                          className="ch-dot"
                          style={{ background: `var(--ch-${entry.channel})` }}
                          aria-hidden
                        />
                        <span className="wk-time">{formatTime(entry.publish_at)}</span>
                        <span className={`pill ${pillClass(entry.state)} wk-pill`}>
                          {WEEK_SLOT_LABEL[entry.state]}
                        </span>
                      </span>
                      <span className="wk-angle">{entry.angle}</span>
                      {entry.moved_from !== null && (
                        <span className="wk-moved">moved from {formatDateTime(entry.moved_from)}</span>
                      )}
                    </>
                  );
                  return entry.draft ? (
                    <Link key={entry.key} href={`/approvals/${entry.draft.id}`} className="wk-entry">
                      {body}
                    </Link>
                  ) : (
                    <div key={entry.key} className="wk-entry wk-entry-static">
                      {body}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {week.otherRuns.length > 0 && (
            <section>
              {/* Named from the week being viewed. It read "This week's other runs" above whatever
                  week you had stepped to, so browsing to July showed July's runs under a heading
                  claiming they were this week's. */}
              <h3 className="sec">Other runs · {week.label}</h3>
              <ul className="settled">
                {week.otherRuns.map((r) => (
                  <li key={r.run.id}>
                    <span className="settled-title">{r.title}</span>
                    <span className="settled-state">{r.detail}</span>
                    <span className="settled-state mono" style={{ marginLeft: 'auto' }}>
                      {r.run.id}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

function OwnerGateBanner({ gate }: { gate: Week['ownerGate'] }) {
  if (gate.kind === 'none') return null;

  if (gate.kind === 'pending') {
    return (
      <div className="gate-band gate-pending">
        <span className="gate-ic" aria-hidden>
          !
        </span>
        <p>
          Waiting on the client owner to approve this week&rsquo;s plan — {formatRelative(gate.deadline)}.
          Drafting won&rsquo;t start until they do, or the window closes and last week&rsquo;s pillars
          carry over.
        </p>
      </div>
    );
  }

  return (
    <div className="gate-band gate-approved">
      <span className="gate-ic gate-ic-go" aria-hidden>
        ✓
      </span>
      <p>Owner approved this week&rsquo;s plan {formatRelative(gate.at)}.</p>
    </div>
  );
}
