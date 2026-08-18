'use client';

/**
 * THE RAIL — screens, and the week the operator is working on.
 *
 * WHAT WAS HERE BEFORE, AND WHY IT IS GONE.
 *
 * This file used to render `getRunSummaries()` — every run the system had ever emitted, newest
 * first, thirty-eight rows drawn from four repeating titles ("Draft ·", "Publish", "Plan next
 * week", "Check replies"). Three problems, in ascending order of seriousness:
 *
 *   1. It was an event log in the slot reserved for navigation. A rail is the frame a screen sits
 *      inside; putting a scrolling history there means the frame changes every time the agent
 *      ticks.
 *   2. It was mostly duplicates. Eight of those rows were the eight children of one Wednesday
 *      batch, and each of them is *already* on screen as the slot it drafted. The operator was
 *      being asked to read the same eight posts twice, under different names.
 *   3. It was the wrong unit. The product's unit of work is a week — Monday plans, Wednesday
 *      drafts the whole of the following week, Sunday learns. The run is the *child* of a week.
 *      Listing children and leaving the parent to be reconstructed in the operator's head is the
 *      exact failure `lib/week.ts` was written to fix, and the rail was its last holdout.
 *
 * WHAT REPLACED IT. The week itself: a stepper, then the week's slots grouped by day in
 * chronological order, then the two or three runs that are about the week rather than about one of
 * its posts. Roughly a dozen rows instead of thirty-eight, and every one of them is a thing the
 * operator is responsible for rather than a thing the system did.
 *
 * ONLY DAYS THAT HOLD SOMETHING ARE DRAWN. `Week.days` is always seven, empty days included,
 * because the queue's week view is a grid and a grid that drops its empty columns is a list. The
 * rail is not a grid — it is 240px of vertical schedule — so it filters. Reversing that trades four
 * useful rows for four empty labels in a column that is already the narrowest thing on screen.
 *
 * FAILURE IS SILENT HERE, WHICH IT IS NOWHERE ELSE. Every other surface renders `ErrorState` on a
 * failed read. The rail carries the navigation for all five screens, so an error banner in it would
 * take the whole app down over a widget. On failure the brand and the nav stay, the slot region
 * renders nothing, and the screen the operator was reading is untouched.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getBudget, getWeek, subscribeToWorld } from '@/lib/agentClient';
import {
  getSelectedWeek,
  getServerWeek,
  setSelectedWeek,
  subscribeToWeek,
} from '@/lib/weekSelection';
import type { BudgetPosture } from '@/lib/budget';
import type { RunId } from '@/lib/types';
import type { Week, WeekEntry } from '@/lib/week';
import { Badge, RUN_STATE_LABEL, runStateTone, WEEK_SLOT_LABEL, weekSlotTone } from '@/components/Badge';
import { Countdown } from '@/components/Countdown';
import { formatTime, weekdayShort, weekLabel } from '@/lib/time';

const SCREENS = [
  { href: '/v1/console', label: 'Console' },
  { href: '/v1/queue', label: 'Queue' },
  { href: '/v1/metrics', label: 'Metrics' },
  { href: '/v1/settings', label: 'Settings' },
] as const;

/**
 * Spelled, not marked.
 *
 * This was `in` / `x` in 11px mono, on the theory that two characters buy width in a 240px rail.
 * They bought width from the wrong line: the mark sat inside the title, so the title truncated
 * four words in, and the mark itself had to be decoded rather than read. A label that prompts
 * "is that supposed to be LinkedIn?" is not a label. It costs six characters on a metadata line
 * that had room.
 */
const CHANNEL_MARK: Record<WeekEntry['channel'], { name: string }> = {
  linkedin: { name: 'LinkedIn' },
  x: { name: 'X' },
};

export function Rail({
  selectedRunId,
  onSelectRun,
}: {
  selectedRunId?: RunId | null;
  onSelectRun?: (id: RunId) => void;
}) {
  const pathname = usePathname();

  /**
   * The selected week is shared with the queue's week grid rather than held here — see
   * `lib/weekSelection.ts`. Two steppers for one fact used to disagree on screen.
   *
   * The starting value is still a synchronous read (`defaultWeekIndex` over the same world the first
   * fetch will return), resolved once at module load. Fetching it would mean one render with no
   * index at all, and therefore a stepper with no label — a frame that arrives after the screen it
   * frames.
   */
  const index = useSyncExternalStore(subscribeToWeek, getSelectedWeek, getServerWeek);
  const setIndex = (next: (current: number) => number) => setSelectedWeek(next(index));

  /**
   * ONE STATE FOR THE READ, CARRYING THE INDEX IT ANSWERED.
   *
   * The obvious shape is three fields — week, loading, error — and it is wrong twice. It needs a
   * `setLoading(true)` in the effect body, which is a synchronous setState inside an effect and a
   * cascading render (the lint rule catches it); and it cannot tell "the week I asked for" from
   * "the week I asked for two clicks ago", so a step would show the previous week's slots under the
   * new week's name for the 260ms the read takes.
   *
   * Stamping the answer with its own index fixes both. Loading is *derived* — the stamp does not
   * match the index being displayed — so nothing is set until a promise resolves. A failed read
   * stores `week: null` against its index, which is settled-and-empty rather than loading forever.
   */
  const [result, setResult] = useState<{ index: number; week: Week | null } | null>(null);
  const [budget, setBudget] = useState<BudgetPosture | null>(null);

  /**
   * A COUNTER, BUMPED WHENEVER THE WORLD IS WRITTEN.
   *
   * The rail renders on all five screens, so it displays facts that other screens change. Approving
   * a draft on the queue used to leave this column still saying "Needs you" for the slot that had
   * just been approved — two views of one fact, disagreeing, side by side. The rail had no way to
   * know, because `agentClient` is a plain module and the queue owns its own state.
   *
   * `subscribeToWorld` fires after every write, and bumping a nonce re-runs the read below through
   * the same async path as the first one. Nothing here reaches into the world synchronously, so the
   * rail has no privileged view — it just knows when to ask again.
   */
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribeToWorld(() => setRevision((n) => n + 1)), []);

  useEffect(() => {
    let cancelled = false;
    getWeek(index)
      .then((next) => {
        if (!cancelled) setResult({ index, week: next });
      })
      /** Swallowed deliberately — see the header. The nav must survive a failed week. */
      .catch(() => {
        if (!cancelled) setResult({ index, week: null });
      });
    return () => {
      cancelled = true;
    };
  }, [index, revision]);

  /** Separate from the week because it is not week-shaped: the budget period is monthly and the
   *  posture is the same on whichever week is being stepped through. */
  useEffect(() => {
    let cancelled = false;
    getBudget()
      .then((next) => {
        if (!cancelled) setBudget(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [revision]);

  /** In flight — including the very first read, when nothing has answered yet. */
  const pending = result === null || result.index !== index;
  /** The week in hand, but only if it is the week that was asked for. */
  const loaded = pending ? null : result.week;

  /**
   * The label comes off the loaded week, and falls back to the same pure function that produced it
   * while a step is in flight. `getWeek` costs 260ms; showing the *previous* week's name for that
   * long, next to arrows the operator just clicked, is the one thing a stepper must never do. The
   * two can't disagree — `buildWeek` sets `label` by calling `weekLabel(index)`.
   */
  const label = loaded !== null ? loaded.label : weekLabel(index);

  /**
   * Both arrows are dead while a step is in flight. The flags belong to the *loaded* week, so
   * trusting them mid-flight lets a fast double-click walk one week past the end of the data and
   * land on an empty schedule. 260ms of dead buttons against a state the stepper exists to prevent.
   */
  const canPrevious = loaded !== null && loaded.hasPrevious;
  const canNext = loaded !== null && loaded.hasNext;
  const days = loaded !== null ? loaded.days.filter((d) => d.entries.length > 0) : [];
  const otherRuns = loaded !== null ? loaded.otherRuns : [];

  return (
    <aside
      className="flex w-60 shrink-0 flex-col border-r"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-sunk)' }}
    >
      <div className="px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-[9px] w-[9px] shrink-0"
            style={{ background: 'var(--accent)' }}
          />
          <span className="t-body font-bold">Growth Agent</span>
        </div>
        {/* The client the console operates. One client per console (D-017), so it is a fact about
            the whole surface — and naming it as a client stops it being an unexplained word. */}
        {/* Client and spend on one line, in that order, the way an app puts the plan name next to
            the account name. `$121/400` is the whole statement — a sentence explaining what a
            monthly cap is would be the interface talking to its operator about their own contract. */}
        <div className="t-meta flex items-baseline gap-1.5 pl-[17px]">
          <span>Brightsill</span>
          {budget && (
            <>
              <span aria-hidden>·</span>
              <span
                className="tabular"
                /** Quiet under the cap and coloured at the gate. The state tokens are the same ones
                 *  a badge would use; this is not a badge because a permanent pill next to the
                 *  client name reads as an alert that never clears. */
                style={
                  budget.state === 'under'
                    ? undefined
                    : {
                        color:
                          budget.state === 'stopped'
                            ? 'var(--state-blocked)'
                            : 'var(--state-awaiting)',
                      }
                }
              >
                ${Math.round(budget.spent)}/{budget.cap}
                {budget.state !== 'under' && (budget.state === 'stopped' ? ' · stopped' : ' · 80%')}
              </span>
            </>
          )}
        </div>
      </div>

      <nav aria-label="Screens" className="px-2 pb-2">
        {SCREENS.map((screen) => {
          const active = pathname === screen.href;
          return (
            <Link
              key={screen.href}
              href={screen.href}
              aria-current={active ? 'page' : undefined}
              className="t-body block rounded px-2 py-1"
              style={{
                color: active ? 'var(--text)' : 'var(--text-muted)',
                background: active ? 'var(--surface)' : 'transparent',
              }}
            >
              {screen.label}
            </Link>
          );
        })}
      </nav>

      <section aria-label="Week" className="flex min-h-0 flex-1 flex-col border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-1 px-2 py-1.5">
          <StepButton
            glyph="‹"
            label="Previous week"
            disabled={!canPrevious}
            onClick={() => setIndex((i) => i - 1)}
          />
          {/* `aria-live` so a stepped week announces itself: the arrows keep focus, so without it
              the only thing that changed is unreachable to a screen reader. */}
          {/* The count rides on the label rather than sitting in its own row: it is a property of
              the week being shown, and it changes when the stepper moves. Omitted at zero — a
              persistent "0 need you" is a row spent saying nothing. */}
          <span className="t-body flex flex-1 items-baseline justify-center gap-1.5" aria-live="polite">
            <span>{label}</span>
            {loaded !== null && loaded.waitingOnYou > 0 && (
              <span className="t-meta tabular" style={{ color: 'var(--state-awaiting)' }}>
                {loaded.waitingOnYou} need you
              </span>
            )}
          </span>
          <StepButton
            glyph="›"
            label="Next week"
            disabled={!canNext}
            onClick={() => setIndex((i) => i + 1)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {pending ? <SlotSkeleton /> : null}

          {days.map((day) => (
            <div key={day.index} role="group" aria-label={day.label} className="mt-2 first:mt-1">
              <div className="flex items-center gap-1.5 px-2 pb-1">
                <span className="t-field" style={day.isToday ? { color: 'var(--text-muted)' } : undefined}>
                  {day.label}
                </span>
                {day.isToday ? (
                  <>
                    {/* A dot, not the brand square: D-039 reserves the square for the mark at the
                        top of this rail, and a second square would read as a second brand. */}
                    <span
                      aria-hidden
                      className="inline-block h-[5px] w-[5px] rounded-full"
                      style={{ background: 'var(--accent)' }}
                    />
                    <span className="sr-only">today</span>
                  </>
                ) : null}
              </div>
              <ul>
                {day.entries.map((entry) => (
                  <li key={entry.key}>
                    <SlotRow
                      entry={entry}
                      selected={entry.run_id !== null && entry.run_id === selectedRunId}
                      onSelectRun={onSelectRun}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* A week that loaded and holds nothing is a fact, not an error — but an unexplained
              void reads as a broken pane, so it gets two words. */}
          {loaded !== null && days.length === 0 ? (
            <div className="t-meta px-2 py-2">No slots</div>
          ) : null}

          {otherRuns.length > 0 ? (
            <div className="mt-4">
              <div className="t-field px-2 pb-1">Runs</div>
              <ul>
                {otherRuns.map(({ run, title, detail }) => {
                  const selected = run.id === selectedRunId;
                  return (
                    <li key={run.id}>
                      <button
                        type="button"
                        onClick={() => onSelectRun?.(run.id)}
                        aria-current={selected ? 'true' : undefined}
                        className="mb-0.5 w-full rounded px-2 py-1.5 text-left"
                        style={{ background: selected ? 'var(--surface)' : 'transparent' }}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <span className="t-body min-w-0 flex-1 truncate">{title}</span>
                          <Badge tone={runStateTone(run.state)}>
                            {RUN_STATE_LABEL[run.state] ?? run.state}
                          </Badge>
                        </div>
                        <div className="t-meta truncate">{detail}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
    </aside>
  );
}

/* ================================================================================================
 * ROWS
 * ==============================================================================================*/

function StepButton({
  glyph,
  label,
  disabled,
  onClick,
}: {
  glyph: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="t-body shrink-0 rounded px-1.5 leading-none disabled:cursor-default"
      style={{ color: disabled ? 'var(--text-faint)' : 'var(--text-muted)' }}
    >
      <span aria-hidden>{glyph}</span>
    </button>
  );
}

/**
 * ONE SLOT.
 *
 * A row with no `run_id` is a slot the Monday plan proposed and nothing has drafted yet — there is
 * no run to open, so it renders as a `div`. The alternative, a disabled button, is worse: it keeps
 * the affordance and takes away the result, which is how a UI teaches its operator that clicking
 * things does nothing.
 */
function SlotRow({
  entry,
  selected,
  onSelectRun,
}: {
  entry: WeekEntry;
  selected: boolean;
  onSelectRun?: (id: RunId) => void;
}) {
  const channel = CHANNEL_MARK[entry.channel];

  /**
   * THE TITLE GETS THE FIRST LINE TO ITSELF.
   *
   * It used to share that line with the publish time and a mono `in` / `x` channel mark. Three
   * things competing inside 240px meant the only one that mattered — what the post is about — got
   * roughly 130px and truncated after four words, while the two prefixes were unreadable at 11px
   * and had to be decoded rather than read. "Is that supposed to be LinkedIn?" is the question a
   * two-character mark provokes, and a rail nobody can scan is a rail that failed.
   *
   * So the title leads, full width, and everything that qualifies it — time, channel, pillar,
   * state — drops to a second line of metadata. Same information, one scan instead of three.
   * The channel is spelled, because "LinkedIn" is one word and guessing is not a feature.
   */
  const body = (
    <>
      <div className="t-body min-w-0 truncate">{entry.angle}</div>
      <div className="mt-0.5 flex items-center justify-between gap-1.5">
        <span className="t-meta min-w-0 truncate">
          <span className="tabular">{formatTime(entry.publish_at)}</span>
          {' · '}
          {channel.name}
          {/* `colour_token` is deliberately not read here. The fixtures carry `pillar-compliance`
              and friends, but globals.css defines no matching variable, so keying a swatch off it
              would render transparent — a hardcoded hex is the only way to make it work and D-039
              forbids that. The name carries the pillar until the tokens exist. */}
          {entry.pillar ? ` · ${entry.pillar.name}` : null}
          {entry.moved_from !== null ? ' · moved' : null}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {entry.deadline !== null ? (
            <Countdown deadline={entry.deadline} className="t-meta tabular" />
          ) : null}
          <Badge tone={weekSlotTone(entry.state)}>{WEEK_SLOT_LABEL[entry.state]}</Badge>
        </span>
      </div>
    </>
  );

  /** The original time lives in the tooltip rather than in the row: "moved" is the fact worth two
   *  characters of a 240px rail, and "moved from Tue 09:00" is the fact worth a hover. */
  const movedTitle =
    entry.moved_from !== null
      ? `Moved from ${weekdayShort(entry.moved_from)} ${formatTime(entry.moved_from)}`
      : undefined;

  /**
   * WHERE A SLOT GOES WHEN YOU CLICK IT, AND WHY IT IS NOT ONE ANSWER.
   *
   * `onSelectRun` is only passed by the console, which is the one screen that can show a run — it
   * owns the transcript. On the other four the prop is absent, and the first version of this row
   * called `onSelectRun?.(…)` regardless: every slot was a button that did nothing on four screens
   * out of five. A rail is on every screen, so that is four screens teaching the operator that
   * clicking is pointless.
   *
   * So the destination is the best surface the current screen can reach: the run inline where the
   * console can show it, and otherwise the draft, which is the screen for one item opened fully.
   * Deliberately NOT `/console?run=…` — `useSearchParams` opts the console out of static prerender
   * and adds a Suspense boundary to the highest-graded screen, to route to a run the operator can
   * reach in one more click anyway.
   *
   * A slot with neither is one the Monday plan proposed and nothing has drafted yet. It renders as
   * a `div`. A disabled button would be worse: it keeps the affordance and removes the result.
   */
  const draftId = entry.draft?.id ?? null;
  const runId = entry.run_id;
  const activate = onSelectRun && runId !== null ? () => onSelectRun(runId) : null;

  if (activate === null && draftId === null) {
    return (
      <div
        title={movedTitle}
        className="mb-0.5 rounded px-2 py-1"
        /** Dimmed by colour rather than opacity, so the badge keeps its own state token — a
         *  50%-opacity "Needs you" is a different colour, and D-039 has exactly one per state. */
        style={{ color: 'var(--text-faint)' }}
      >
        {body}
      </div>
    );
  }

  if (activate === null) {
    return (
      <Link
        href={`/v1/draft/${draftId}`}
        title={movedTitle}
        className="mb-0.5 block w-full rounded px-2 py-1 text-left"
      >
        {body}
      </Link>
    );
  }

  return (
    <button
      type="button"
      title={movedTitle}
      onClick={activate}
      aria-current={selected ? 'true' : undefined}
      className="mb-0.5 w-full rounded px-2 py-1 text-left"
      style={{ background: selected ? 'var(--surface)' : 'transparent' }}
    >
      {body}
    </button>
  );
}

/**
 * Three bars, not eight. The skeleton is a placeholder for "something is coming", and a full-height
 * one implies a count the rail does not know yet — a week can hold two rows or ten.
 *
 * No pulse animation: `prefers-reduced-motion` is handled deliberately in globals.css for the one
 * animation that carries meaning, and a 260ms shimmer is not worth a second exception.
 */
function SlotSkeleton() {
  return (
    <div aria-hidden className="px-2 pt-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="mb-1.5 h-7 rounded"
          style={{ background: 'var(--surface)' }}
        />
      ))}
    </div>
  );
}
