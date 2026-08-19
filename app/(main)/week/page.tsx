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

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { getWeek, initialWeekIndex, subscribeToWorld } from '@/lib/agentClient';
import { WEEK_SLOT_LABEL, type Week } from '@/lib/week';
import type { ConsoleError } from '@/lib/types';
import { asConsoleError } from '@/lib/errorCopy';
import { LoadError, LoadingState, StaleWarning } from '@/components/ScreenState';
import { ChannelMark } from '@/components/ChannelMark';
import {
  ANCHOR_MS,
  at,
  formatDate,
  formatDateTime,
  formatDayNumber,
  formatRelative,
  formatTime,
  weekIndexOf,
} from '@/lib/time';
import type { MinutesFromAnchor } from '@/lib/types';

/**
 * THE REAL TODAY, NOT THE FIXTURE'S TODAY.
 *
 * Everything with a date in this prototype is an offset from a build-fixed anchor — the Thursday
 * of the week the build ran in (D-030). That is what keeps the server render and the browser
 * render identical, and it is the right call for the *data*. It is the wrong call for the one mark
 * on this screen that is not about the data: which square is today. The anchor's Thursday is a
 * whole-week approximation of now, so on any other weekday it tinted the wrong square and captioned
 * the wrong week "Current week".
 *
 * So the data stays anchored and the calendar reads the actual clock, once, after mount. After
 * mount rather than during render because `Date.now()` differs between the server render and the
 * client's, which is a hydration mismatch; until the effect runs, the anchor's answer is used, so
 * the first paint is still deterministic.
 */
let clientNowMs: number | null = null;
/** Read once and cached, because `useSyncExternalStore` requires a snapshot that is stable
 *  between calls — `Date.now()` straight out of `getSnapshot` is a new value every render and
 *  React loops on it. Nothing here needs the clock to tick: a page open across midnight showing
 *  yesterday tinted is not a bug worth a subscription. */
const readClientNow = () => (clientNowMs ??= Date.now());
const noClockOnTheServer = () => null;
const neverChanges = () => () => {};

function useRealNow(): number | null {
  return useSyncExternalStore(neverChanges, readClientNow, noClockOnTheServer);
}

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** "Mon 3 – Sun 9 Feb", from the week's own first and last day. */
function weekRangeLabel(week: Week): string {
  const first = week.days[0];
  const last = week.days[week.days.length - 1];
  return `${formatDate(first.start)} – ${formatDate(last.start)}`;
}

/** The draft's opening line, for the calendar cell. Empty for a slot with no draft yet. */
function preview(entry: Week['entries'][number]): string {
  const v = entry.draft?.versions.find((x) => x.id === entry.draft?.current_version_id);
  if (!v) return '';
  const flat = v.text.replace(/\s+/g, ' ').trim();
  return flat.length > 90 ? `${flat.slice(0, 88).trimEnd()}…` : flat;
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

  /** Not `useWorldRead`, and deliberately: this one is parameterised by the week being viewed, so
   *  it re-subscribes when `index` changes. The shared hook takes a zero-argument loader on purpose
   *  — generalising it to carry a parameter would make it a data hook, which is the thing its own
   *  docblock argues against. One screen out of five differing is cheaper than that. */
  const realNow = useRealNow();
  /** Before the effect runs, fall back to the anchor's answers: week 0 and `day.isToday`. */
  const currentWeekIndex =
    realNow === null ? 0 : weekIndexOf(((realNow - ANCHOR_MS) / 60_000) as MinutesFromAnchor);
  const isRealToday = (day: { start: MinutesFromAnchor; isToday: boolean }) => {
    if (realNow === null) return day.isToday;
    const from = at(day.start).getTime();
    return realNow >= from && realNow < from + DAY_MS;
  };

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
        <h1 className="page-title">Content calendar</h1>
      </header>

      {error && !week && <LoadError error={error} onRetry={() => void load(index)} />}
      {error && week && <StaleWarning error={error} onRetry={() => void load(index)} />}

      {!week && !error && <LoadingState lines={3} label="Loading the week" />}

      {week && (
        <>
          <div className="rh">
            <div className="l1">
              {/* The range, not "This week" / "Next week". Those told you where you were relative
                  to today and not which days you were looking at, which is the thing a calendar is
                  for. The button between the arrows still says "This week", because that is a
                  destination rather than a description. */}
              <h2>{weekRangeLabel(week)}</h2>
              {week.index === currentWeekIndex && <span className="wk-now">Current week</span>}
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
                <button type="button" className="btn btn-sm" onClick={() => setIndex(currentWeekIndex)}>
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
              <div key={day.index} className={`wk-day${isRealToday(day) ? ' wk-today' : ''}`}>
                {/* Weekday and date number, the way every calendar shows a day. The grid used to
                    print only "Mon", so nothing on the screen said which Monday you were looking
                    at except the week label above it. */}
                <p className="wk-daylabel">
                  <span className="wk-dow">{day.label}</span>
                  <span className="wk-dom">{formatDayNumber(day.start)}</span>
                </p>
                {day.entries.length === 0 && <p className="wk-empty" aria-hidden />}
                {day.entries.map((entry) => {
                  const body = (
                    <>
                      <span className="wk-row1">
                        <ChannelMark channel={entry.channel} size={13} />
                        <span className="wk-time">{formatTime(entry.publish_at)}</span>
                        <span className={`pill ${pillClass(entry.state)} wk-pill`}>
                          {WEEK_SLOT_LABEL[entry.state]}
                        </span>
                      </span>
                      <span className="wk-angle">{entry.angle}</span>
                      {/* Metricool's calendar cells show the post itself, not only its title — an
                          opening line is what tells you whether the slot is what you meant. Two
                          lines, clamped, and only where a draft exists. */}
                      {preview(entry) && <span className="wk-prev">{preview(entry)}</span>}
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
