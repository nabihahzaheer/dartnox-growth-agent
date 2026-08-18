'use client';

/**
 * THE CONSOLE — a live feed of the agent working.
 *
 * The brief is blunt about this screen: simulate the step stream with realistic timing, and
 * "faked streaming matters; a static list does not cut it." Its closing instruction makes this the
 * screen everything else is traded against.
 *
 * ---------------------------------------------------------------------------------------------
 * THE LAYOUT IS THE ARGUMENT
 *
 * A week frame that does not move, one scrolling transcript, and a composer pinned to the bottom.
 * The transcript stays anchored to its end as steps arrive, and stops doing so the moment you
 * scroll up to read something — because following a live feed and reading back through it are two
 * different jobs, and a view that yanks you to the bottom mid-sentence is doing one of them badly.
 *
 * An earlier version was a document: a page title, stacked sections with headings, content running
 * off the bottom of a scrolling page. It read as an article about an agent rather than as an agent
 * being watched.
 *
 * ---------------------------------------------------------------------------------------------
 * THE HEADER IS A WEEK, NOT A RECORD HEADER
 *
 * It read `RUN-0147 · Needs you · Wednesday batch · 2h ago`: which database row is open, and
 * nothing else. Every question an operator actually opens this screen with — how much of next week
 * is still on me, did the owner sign off the calendar, what fires next — was unanswerable from the
 * one strip that never scrolls away.
 *
 * So the frame is the week (`lib/week.ts`) and the run is demoted to a second line under it. The
 * run id survives as `.t-meta`, because it is what you quote in a bug report and not what you
 * navigate by.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS REAL HERE AND WHAT IS PRE-WRITTEN
 *
 * Pre-written: the words. Post text, reasoning text, tool payloads, guardrail explanations.
 *
 * Real: everything around them. Steps genuinely arrive one at a time on a timer. Data genuinely
 * arrives asynchronously, so the loading state is not staged. A failed call genuinely fails. The
 * run branches on its own guardrail results, and a submitted brief is genuinely the one the next
 * drafting step reads.
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getActiveRun,
  getDraftDetail,
  getGuardrailEvents,
  getSettings,
  getWeek,
  haltRun,
  initialWeekIndex,
  openRun,
  runNow as startRunNow,
  streamRun,
  submitBrief,
  subscribeToWorld,
  type RunAttachment,
  type StreamEndReason,
} from '@/lib/agentClient';
import type {
  BriefRef,
  ConsoleError,
  Draft,
  DraftId,
  GuardrailEvent,
  MinutesFromAnchor,
  Run,
  RunId,
  RunStep,
  RunStepId,
  Settings,
} from '@/lib/types';
import type { OwnerGate, Week, WeekEntry } from '@/lib/week';
import { NOW, formatRelative, formatTime, weekStart, weekdayShort } from '@/lib/time';
import { Badge, RUN_STATE_LABEL, runStateTone, weekSlotTone } from '@/components/Badge';
import { Countdown } from '@/components/Countdown';
import { ErrorPanel, NotFound } from '@/components/ErrorState';
import { StepRow } from '@/components/console/StepRow';
import { ControlBar } from '@/components/console/ControlBar';
import { DecisionControls } from '@/components/DecisionControls';
import { Rail } from '@/components/Rail';

/**
 * WHO STARTED THIS RUN, not just which job it was.
 *
 * The labels read `Wednesday batch`, `Daily poll`, `Retry sweep` — names of jobs, which left the
 * obvious question unanswered: *why is this running when I did not press anything.* The agent runs
 * on a schedule and the console attaches to a run already in flight, which is correct and is what
 * the fixture's `RUN_LIVE` comment defends; it simply was not stated anywhere on screen.
 *
 * Prefixing the agency onto the label answers it in the frame, where the fact already lives, rather
 * than adding a sentence explaining scheduling to the person who configured it.
 */
const TRIGGER_LABEL: Record<string, string> = {
  'schedule.weekly_plan': 'Scheduled · Monday plan',
  'schedule.weekly_draft': 'Scheduled · Wednesday batch',
  'manual.run_now': 'Started by you',
  'poll.performance': 'Scheduled · daily poll',
  'poll.engagement': 'Scheduled · reply poll',
  'sweep.resume': 'Automatic retry',
};

const CHANNEL_LABEL: Record<WeekEntry['channel'], string> = {
  linkedin: 'LinkedIn',
  x: 'X',
};

const MINUTES_PER_DAY = 1440;

/**
 * THE SCHEDULE, WHICH IS THE ONE THING THIS SCREEN KNOWS ABOUT NEXT WEEK.
 *
 * A-01's weekday rhythm: Monday plans, Wednesday drafts the whole of the following week, Sunday
 * learns from what the humans changed. Days are Monday-indexed to match `weekStart`.
 *
 * THE HOURS ARE ORDERING ONLY AND ARE NEVER RENDERED. Monday's and Wednesday's 06:00 are fixtured;
 * the learning job's hour is not specified anywhere, so printing a time for it would be the console
 * asserting a fact the system does not hold. The hour exists so that "what fires next" is still
 * right on a Wednesday afternoon, when the batch that morning is already behind us — a comparison
 * on whole days alone would answer with a job that has already run.
 */
const SCHEDULE = [
  { day: 6, hour: 6, label: 'learning run' },
  { day: 0, hour: 6, label: 'planning run' },
  { day: 2, hour: 6, label: 'drafting batch' },
] as const;

/**
 * The next scheduled behaviour, derived rather than written down.
 *
 * Two weeks of candidates, because from a Thursday the next Monday and Wednesday both live in the
 * week after this one. Pure arithmetic over the anchor, so it computes identically on the server
 * and in the browser — the same reason nothing in `lib/time.ts` calls `Date.now()`.
 */
function nextScheduled(): { label: string; at: MinutesFromAnchor } {
  const monday = weekStart(0) as number;
  return [0, 1]
    .flatMap((week) =>
      SCHEDULE.map((job) => ({
        label: job.label,
        at: (monday + (week * 7 + job.day) * MINUTES_PER_DAY + job.hour * 60) as MinutesFromAnchor,
      })),
    )
    .filter((candidate) => candidate.at > NOW)
    .sort((a, b) => (a.at as number) - (b.at as number))[0];
}

/** Status, not prose. Each is what an operator would say out loud about the run. */
const END_COPY: Record<StreamEndReason, string> = {
  /** Not "waiting for approval" — the draft gate is one of four interrupts, and a hostile-reply
   *  intervention is a decision rather than an approval. This wording is true of all of them. */
  interrupt: 'Waiting for you',
  parked: 'Parked — needs a person, and will not retry on its own',
  quarantined: 'Quarantined before drafting — no draft was produced',
  completed: 'Complete',
  halted: 'Halted · draft left orphaned',
};

/** Only one of these endings is good news, and the banner should not be green for the others. */
const END_TONE: Record<StreamEndReason, { bg: string; ink: string }> = {
  completed: { bg: 'var(--note-bg)', ink: 'var(--note-ink)' },
  interrupt: { bg: 'var(--note-bg)', ink: 'var(--note-ink)' },
  parked: { bg: 'var(--state-parked-bg)', ink: 'var(--state-parked)' },
  quarantined: { bg: 'var(--state-blocked-bg)', ink: 'var(--state-blocked)' },
  halted: { bg: 'var(--state-blocked-bg)', ink: 'var(--state-blocked)' },
};

type Source = { runId: RunId; fromSeq: number; nonce: number };

export default function ConsolePage() {
  const [run, setRun] = useState<Run | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [events, setEvents] = useState<GuardrailEvent[]>([]);
  const [ended, setEnded] = useState<StreamEndReason | null>(null);
  const [error, setError] = useState<ConsoleError | null>(null);
  const [loading, setLoading] = useState(true);
  const [briefs, setBriefs] = useState<BriefRef[]>([]);
  const [week, setWeek] = useState<Week | null>(null);

  /**
   * The week index, resolved once.
   *
   * `initialWeekIndex()` is synchronous and picks the earliest week that still has something
   * waiting — from a Thursday that is next week, whose eight posts Wednesday's batch drafted. Held
   * in state with a lazy initialiser so that re-reading the week after a decision re-reads *this*
   * week, rather than sliding to whichever week is now the earliest with work outstanding. The
   * frame moving under the operator because they cleared something is the opposite of a frame.
   */
  const [weekIndex] = useState(initialWeekIndex);

  /**
   * Writes land in `agentClient` and are announced from `applyPatch`, so any screen that renders a
   * consequence of one can re-read without being told by the screen that took the decision.
   *
   * This is new, and it is what the console needed the moment it could take a decision itself. The
   * comment here used to say the console takes none and therefore nothing on it can change
   * `waitingOnYou`. That is now false: approving at the interrupt moves the week, the rail and the
   * metrics, and the frame has to agree with the transcript underneath it. Same mechanism the rail
   * and the week view already use.
   */
  const [worldRevision, setWorldRevision] = useState(0);
  useEffect(() => subscribeToWorld(() => setWorldRevision((n) => n + 1)), []);

  useEffect(() => {
    let cancelled = false;
    getWeek(weekIndex)
      .then((next) => {
        if (!cancelled) setWeek(next);
      })
      /** The frame is context. If it fails the transcript is still the screen, so this does not
       *  raise the full-screen error state the run's own failure does. */
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [weekIndex, worldRevision]);

  useEffect(() => {
    let cancelled = false;
    getActiveRun()
      .then(async ({ run: active, fromSeq }) => {
        if (cancelled) return;
        setRun(active);
        setSource({ runId: active.id, fromSeq, nonce: 0 });
        setEvents(await getGuardrailEvents(active.id));
      })
      .catch((e: ConsoleError) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** One path for "show me this run", whether it came from the rail or from Run now. The client
   *  decides which run and where to attach; this only renders the answer. */
  const attach = useCallback(async (load: () => Promise<RunAttachment>) => {
    setLoading(true);
    setError(null);
    setEnded(null);
    try {
      const { run: next, fromSeq } = await load();
      setRun(next);
      setEvents(await getGuardrailEvents(next.id));
      // A new nonce remounts the stream, so this is a fresh instance rather than a reset.
      setSource((current) => ({ runId: next.id, fromSeq, nonce: (current?.nonce ?? 0) + 1 }));
      /**
       * Pending briefs clear when a run starts, because the run has now consumed them — the
       * drafting step shows which brief it read. Leaving them queued would imply they were still
       * waiting, which would be the one thing on this screen that is not true.
       */
      setBriefs([]);
    } catch (e) {
      setError(e as ConsoleError);
    } finally {
      setLoading(false);
    }
  }, []);

  const runNow = useCallback(() => void attach(startRunNow), [attach]);

  /** Back to whatever is live, or the most recent thing that stopped for a human. The same call the
   *  screen makes on mount, so "back" lands exactly where you started. */
  const backToLive = useCallback(() => void attach(getActiveRun), [attach]);

  /** Opening a run from the rail replays it rather than streaming it — a run that finished
   *  yesterday did not just happen, and animating it would be the console lying about time. The
   *  client decides that, since it is a fact about the run. */
  const showRun = useCallback((id: RunId) => void attach(() => openRun(id)), [attach]);

  const halt = useCallback(async () => {
    if (!run) return;
    try {
      const halted = await haltRun(run.id);
      setRun({ ...halted });
      setEnded('halted');
      setSource(null);
    } catch (e) {
      setError(e as ConsoleError);
    }
  }, [run]);

  const sendBrief = useCallback(async (text: string) => {
    const brief = await submitBrief(text, 'You — operator');
    setBriefs((current) => [...current, brief]);
    // The transcript pins itself to the bottom as steps arrive; a brief is the one addition that
    // comes from the operator rather than the stream, so it scrolls itself into view.
    requestAnimationFrame(() => {
      const scroller = document.querySelector('[data-transcript]');
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  }, []);

  const handleEnd = useCallback((reason: StreamEndReason) => setEnded(reason), []);

  /**
   * The route to the queue, now a secondary affordance rather than the only one.
   *
   * The decision itself is taken here — see `decision` below. This stays because clearing a week in
   * one sitting is what the queue is for, and a person who has just approved the run in front of
   * them usually has seven more waiting.
   */
  const router = useRouter();
  const goToQueue = useCallback(() => router.push('/queue'), [router]);

  const streaming = source !== null && ended === null;
  /**
   * True when this run stopped for the operator specifically.
   *
   * Keyed off the *stream's* ending rather than `run.state`, and the difference is not pedantic:
   * the live run is `running` in its record and stays that way while its remaining steps play out,
   * so a condition on the record hid the controls on the one run a reviewer is most likely to be
   * watching when it stops.
   *
   * PLANNING IS EXCLUDED AND STAYS EXCLUDED. Its gate waits on the client's owner, who has no
   * console account and approves by signed link from their inbox. Offering the operator a decision
   * there would invent a gate the architecture does not have.
   */
  const needsOperator = ended === 'interrupt' && run?.type !== 'planning';
  /** Viewing something that already finished, rather than following the live run. */
  const viewingPast = run !== null && run.state !== 'running' && ended !== null;

  /* --------------------------------------------------------------------------------------------
   * THE DRAFT GATE
   *
   * What the operator is being asked to decide about, loaded only once a run has actually stopped
   * for them. Two of the four interrupt gates carry no draft at all — a hostile-reply intervention
   * is about a published post — so this resolves to null there and the row falls back to the queue
   * route.
   * ------------------------------------------------------------------------------------------ */

  const [gate, setGate] = useState<{ draft: Draft; decidable: boolean } | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  /**
   * What the operator's decision did, kept on screen where the buttons were.
   *
   * Both carry the draft they belong to, and both are rendered only while that is still the draft
   * on screen. The alternative was clearing them in an effect keyed on the run — which would have
   * had to distinguish "a different run is showing" from "the world changed because of the
   * decision I just took", and the second of those fires immediately after every decision.
   */
  const [outcome, setOutcome] = useState<{ draftId: DraftId; message: string } | null>(null);
  const [decisionError, setDecisionError] = useState<{
    draftId: DraftId;
    error: ConsoleError;
  } | null>(null);

  /**
   * When the operator started looking at this decision.
   *
   * A-17's rubber-stamp clock measures from here, not from page load — the same discipline the
   * queue applies at selection. A ref rather than state because it is read at decision time and
   * never rendered.
   */
  const gateOpenedAt = useRef(0);

  const gateDraftId: DraftId | null = needsOperator ? (run?.target_draft_id ?? null) : null;

  /** Nothing is cleared here on the way out. A stale `gate` is filtered at the render below by
   *  comparing its draft to `gateDraftId`, which is one comparison against a `setState` in an
   *  effect body — the cascading render the lint rule is right to reject. */
  useEffect(() => {
    if (gateDraftId === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const [detail, config] = await Promise.all([getDraftDetail(gateDraftId), getSettings()]);
        if (cancelled) return;
        setGate({
          draft: detail.draft,
          /**
           * Decidable means the world holds a pending approval to decide against.
           *
           * The live run is the case that forces this check. It is mid-flight at `NOW`: its
           * interrupt step is in the future, its draft is still `drafting`, and no Approval row
           * exists yet — so there is genuinely nothing to approve, and `submitReview` would throw
           * against a draft with no pending approval. The runs that have actually reached the gate
           * (RUN-0141, RUN-0142, and anything Start-a-new-run replays) do carry one.
           */
          decidable:
            detail.draft.state === 'awaiting_approval' &&
            detail.approval !== null &&
            detail.approval.decided_at === null,
        });
        setSettings(config);
        gateOpenedAt.current = Date.now();
      } catch {
        /** The gate is one block inside the transcript. If it fails to load the run is still
         *  readable, so this does not raise the full-screen error state. */
        if (!cancelled) setGate(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gateDraftId, worldRevision]);

  /**
   * The decision surface, built once and slotted into the interrupt step.
   *
   * `DecisionControls` is the same component the queue renders, holding the only `submitReview`
   * call site in the application — which is what answers D-051's objection that a console decision
   * would mean two implementations of the highest-consequence write. There is one, and two screens
   * import it.
   */
  const decision =
    decisionError && decisionError.draftId === gateDraftId ? (
      <ErrorPanel
        error={decisionError.error}
        onRetry={() => setDecisionError(null)}
        retryLabel="Try again"
      />
    ) : outcome && outcome.draftId === gateDraftId ? (
      <span
        className="t-body inline-block rounded px-2 py-0.5 font-bold"
        style={{ background: 'var(--note-bg)', color: 'var(--note-ink)' }}
      >
        {outcome.message}
      </span>
    ) : gate?.decidable && gate.draft.id === gateDraftId && settings ? (
      <DecisionControls
        draft={gate.draft}
        reasons={settings.rejection_reason_set}
        openedAt={gateOpenedAt}
        onDecided={(message) => setOutcome({ draftId: gate.draft.id, message })}
        onError={(error) => setDecisionError({ draftId: gate.draft.id, error })}
      />
    ) : null;

  if (error) {
    return (
      <>
        <Rail selectedRunId={run?.id ?? null} onSelectRun={showRun} />
        <main className="flex min-w-0 flex-1 flex-col">
          <ErrorState error={error} onRetry={runNow} />
          <ControlBar
            onSubmitBrief={sendBrief}
            onRunNow={runNow}
            onHalt={halt}
            onBackToLive={backToLive}
            canHalt={false}
            viewingPast={false}
            runActive={false}
            busy={loading}
          />
        </main>
      </>
    );
  }

  return (
    <>
      <Rail selectedRunId={run?.id ?? null} onSelectRun={showRun} />
      <main className="flex min-w-0 flex-1 flex-col">
      <WeekFrame week={week} run={run} />

      <Transcript
        source={source}
        events={events}
        briefs={briefs}
        loading={loading}
        ended={ended}
        onEnd={handleEnd}
        onRunNow={runNow}
        onDecide={goToQueue}
        needsOperator={needsOperator}
        decision={decision}
      />

      <ControlBar
        onSubmitBrief={sendBrief}
        onRunNow={runNow}
        onHalt={halt}
        onBackToLive={backToLive}
        canHalt={streaming}
        viewingPast={viewingPast}
        /** Live, or stopped and waiting on a person: either way starting another run is not the
         *  thing to reach for. */
        runActive={streaming || needsOperator}
        busy={loading}
      />
      </main>
    </>
  );
}

/* ================================================================================================
 * THE WEEK FRAME — two rows, fixed, and the only chrome above the transcript
 *
 * Row A is where we are in the week. Row B is what is on screen. That order is the argument: the
 * week outlives the run, and a run only means something as one day's work inside it.
 * ==============================================================================================*/

function WeekFrame({ week, run }: { week: Week | null; run: Run | null }) {
  /**
   * The slot this run is working on, matched on the run id the week already resolved.
   *
   * `WeekEntry.run_id` is the drafting run where one exists and the planning run otherwise, so this
   * join is the week's own answer to "what happened to this slot", read backwards. It misses for a
   * run outside the framed week — a poll, a publish, last week's batch — and the row falls back to
   * the trigger, which is the honest answer: that run is not one of these eight posts.
   */
  const entry = week && run ? (week.entries.find((e) => e.run_id === run.id) ?? null) : null;
  const next = nextScheduled();

  return (
    <div
      className="shrink-0 border-b px-4 py-2"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <div className="mx-auto w-full max-w-3xl">
        {/* Row A · the week. The schedule renders before the fetch resolves — it is arithmetic over
            the anchor, not data — so the frame is never a blank bar waiting on latency. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {week && (
            <>
              <span className="t-title">{week.label}</span>
              {week.waitingOnYou > 0 && (
                <Badge tone={weekSlotTone('needs_you')}>{week.waitingOnYou} need you</Badge>
              )}
              <OwnerGateLine gate={week.ownerGate} />
            </>
          )}
          <span className="t-meta ml-auto">
            Next · {weekdayShort(next.at)} {next.label}
          </span>
        </div>

        {/* Row B · the run. */}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {run ? (
            <>
              <Badge tone={runStateTone(run.state)}>
                {RUN_STATE_LABEL[run.state] ?? run.state}
              </Badge>
              {run.variant !== 'nominal' && (
                <Badge tone="parked" mono>
                  {run.variant}
                </Badge>
              )}
              {run.degraded && <Badge tone="parked">degraded</Badge>}
              {/* What the run is actually about: a day, a channel and an angle beats "RUN-0143
                  running", which names the record and not the work. */}
              {entry && (
                <span className="t-body min-w-0 flex-1 truncate">
                  {weekdayShort(entry.publish_at)} · {CHANNEL_LABEL[entry.channel]} · {entry.angle}
                </span>
              )}
              <span className="t-label">
                {TRIGGER_LABEL[run.trigger] ?? run.trigger} · {formatRelative(run.started_at)}
              </span>
              <span className="t-meta tabular ml-auto font-mono">{run.id}</span>
            </>
          ) : (
            <span className="t-label">No run selected</span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * THE CALENDAR GATE — the board's other human gate, and it waits on the client's owner, not on the
 * operator reading this screen. Naming them is the whole point of the line: an unlabelled countdown
 * in an operator console reads as the operator's own deadline.
 *
 * NO COUNTDOWN ON THE APPROVED CASE. The union carries `at`, a moment that has passed, and the
 * fixtures hold exactly that — the owner approved on Tuesday, which is what let Wednesday's batch
 * draft at all. Rendering a live clock against a settled gate would be the console stating
 * something false, so the two cases render as two different things rather than one component fed a
 * different number.
 */
function OwnerGateLine({ gate }: { gate: OwnerGate }) {
  if (gate.kind === 'none') return null;

  if (gate.kind === 'approved') {
    return <span className="t-label">Owner approved · {weekdayShort(gate.at)}</span>;
  }

  return (
    <span className="t-label">
      Owner approval ·{' '}
      <Countdown deadline={gate.deadline} expiredLabel="lapsed" className="tabular" />
    </span>
  );
}

/* ================================================================================================
 * TRANSCRIPT — the one scrolling region
 * ==============================================================================================*/

function Transcript({
  source,
  events,
  briefs,
  loading,
  ended,
  onEnd,
  onRunNow,
  onDecide,
  needsOperator,
  decision,
}: {
  source: Source | null;
  events: GuardrailEvent[];
  briefs: BriefRef[];
  loading: boolean;
  ended: StreamEndReason | null;
  onEnd: (reason: StreamEndReason) => void;
  onRunNow: () => void;
  onDecide: () => void;
  needsOperator: boolean;
  /** Rendered at the interrupt step. Null when this gate carries no decision for the operator —
   *  the calendar gate, or a run whose draft has not reached review yet. */
  decision: React.ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-transcript>
      <div className="mx-auto w-full max-w-3xl space-y-2 px-4 py-4">
        {loading && !source && <LoadingState />}

        {source && (
          <RunStream
            key={`${source.runId}:${source.nonce}`}
            runId={source.runId}
            fromSeq={source.fromSeq}
            events={events}
            onEnd={onEnd}
            onDecide={onDecide}
            decision={decision}
          />
        )}

        {ended && (
          <div
            className="flex flex-wrap items-center gap-2 rounded px-2.5 py-1.5"
            style={{ background: END_TONE[ended].bg, color: END_TONE[ended].ink }}
          >
            <span className="t-body font-bold">{END_COPY[ended]}</span>
            {/* Secondary now, not the route out. The decision itself is taken at the interrupt
                step above; this is for the other seven drafts waiting behind it, which is what
                the queue is for. */}
            {needsOperator && (
              <button
                type="button"
                onClick={onDecide}
                className="t-body rounded px-2 py-0.5 font-bold underline underline-offset-2"
                style={{ color: 'inherit' }}
              >
                Clear the rest in the queue →
              </button>
            )}
          </div>
        )}

        {!loading && !source && !ended && <EmptyState onRun={onRunNow} />}

        {/* Below the run, because that is when they were submitted. They clear once a run starts,
            since at that point the run has read them. */}
        {briefs.map((brief, i) => (
          <BriefBubble key={`${brief.submitted_at}-${i}`} brief={brief} />
        ))}

        {briefs.length > 0 && (
          <p className="t-meta pt-0.5 text-right">Queued for the next run</p>
        )}
      </div>
    </div>
  );
}

/** What the operator put in, rendered in the flow of the run rather than in a side panel. It is an
 *  input to the system and it belongs in the record of what happened. */
function BriefBubble({ brief }: { brief: BriefRef }) {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[80%] rounded-lg px-3 py-2"
        style={{ background: 'var(--accent-soft)', border: '1px solid var(--border-strong)' }}
      >
        {/* Not `.t-field`, though it was mono caps and looked like it. That role is reserved for
            labels inside an expanded step; reusing it here would make a message header and a JSON
            field label the same thing. */}
        <div className="t-meta font-mono" style={{ color: 'var(--accent-text)' }}>
          Brief · {formatTime(brief.submitted_at)}
        </div>
        <p className="t-body mt-1 whitespace-pre-wrap">{brief.text}</p>
      </div>
    </div>
  );
}

function RunStream({
  runId,
  fromSeq,
  events,
  onEnd,
  onDecide,
  decision,
}: {
  runId: RunId;
  fromSeq: number;
  events: GuardrailEvent[];
  onEnd: (reason: StreamEndReason) => void;
  onDecide: () => void;
  decision: React.ReactNode;
}) {
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [historyLength, setHistoryLength] = useState(0);
  const [live, setLive] = useState(true);
  /**
   * Which steps are over.
   *
   * A step now arrives when it *starts*, so "has this finished" is a fact the stream delivers
   * separately and the transcript has to hold. A `Set` of ids rather than a flag on the step: the
   * record does not change when it settles — what changed is that it is no longer happening — and
   * rewriting the step in place would make the list re-render every row on every settle.
   */
  const [settled, setSettled] = useState<ReadonlySet<RunStepId>>(() => new Set());
  const endRef = useRef<HTMLDivElement>(null);
  /** Whether to keep the view pinned to the newest step. Turned off the moment the reader scrolls
   *  away from the bottom, because following a feed and reading back through it are two different
   *  jobs and only one of them wants the view moving. */
  const stickToBottom = useRef(true);

  useEffect(() => {
    const scroller = document.querySelector('[data-transcript]');
    if (!scroller) return;
    const onScroll = () => {
      const distanceFromBottom =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      stickToBottom.current = distanceFromBottom < 80;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  // Layout effect, not effect: this runs before the browser paints, so the view is already at the
  // bottom when the new step becomes visible rather than jumping there a frame later.
  useLayoutEffect(() => {
    if (stickToBottom.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [steps.length]);

  useEffect(() => {
    const handle = streamRun(runId, fromSeq, (event) => {
      if (event.type === 'history') {
        setHistoryLength(event.steps.length);
        setSteps(event.steps);
        /** History is by definition over. Marked in one assignment rather than by treating an
         *  absent id as settled, so that "not in the set" means exactly one thing: still running. */
        setSettled(new Set(event.steps.map((s) => s.id)));
      } else if (event.type === 'step') {
        setSteps((current) => [...current, event.step]);
      } else if (event.type === 'settled') {
        setSettled((current) => new Set(current).add(event.id));
      } else {
        setLive(false);
        onEnd(event.reason);
      }
    });
    // StrictMode double-invokes effects in development to surface ones that leak; `stop()` clears
    // the pending timer and flags an in-flight callback so the second mount runs clean.
    return () => handle.stop();
  }, [runId, fromSeq, onEnd]);

  return (
    <>
      {/* `aria-live="polite"` with `aria-relevant="additions"`: steps are announced as they arrive
          without the whole list being re-read. Not `assertive` — this is a feed, not an alarm. */}
      <ol className="space-y-2" aria-live="polite" aria-relevant="additions" aria-label="Agent activity">
        {steps.map((step, index) => (
          <Fragment key={step.id}>
            {/*
              No "live from here" divider.

              There was one, marking where replayed history ended and live steps began. It was
              solving a problem the product does not have: an operator watching an agent does not
              need to know which steps arrived before they opened the tab, and no application
              annotates its own feed that way. Steps that arrive live already animate in, which is
              the same information without a label.
            */}
            <StepRow
              step={step}
              event={events.find((e) => e.run_step_id === step.id)}
              isNew={index >= historyLength}
              inFlight={!settled.has(step.id)}
              onDecide={onDecide}
              decision={decision}
            />
          </Fragment>
        ))}
      </ol>

      {live && steps.length > 0 && (
        <p className="t-label flex items-center gap-2 px-1 pt-1">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: 'var(--state-running)' }}
          />
          Working…
        </p>
      )}

      <div ref={endRef} />
    </>
  );
}

/* ================================================================================================
 * STATES — named by the brief as a constraint, so they are components rather than afterthoughts
 * ==============================================================================================*/

function LoadingState() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading the run">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-14 rounded border"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        />
      ))}
    </div>
  );
}

/**
 * Two words and a button.
 *
 * It used to carry a sentence explaining the schedule to the person operating it. The frame above
 * now names what fires next, derived rather than written out, so the sentence was both long and a
 * second copy of a fact — the failure mode of a product that narrates itself instead of showing
 * its state.
 */
function EmptyState({ onRun }: { onRun: () => void }) {
  return (
    <div className="py-10 text-center">
      <p className="t-body font-medium">Nothing running</p>
      <button
        type="button"
        onClick={onRun}
        className="t-body mt-3 rounded px-2.5 py-1 font-medium"
        style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
      >
        Start a new run
      </button>
    </div>
  );
}

/**
 * The console's failure surface, which replaces the whole screen rather than sitting inside it.
 *
 * That is the right call here and not elsewhere: if the run cannot be loaded there is no transcript
 * to put a panel above. The copy and the kind label come from the shared component, so the seven
 * kinds cannot say one thing here and another on the queue.
 */
function ErrorState({ error, onRetry }: { error: ConsoleError; onRetry: () => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        {error.kind === 'not_found' ? (
          <NotFound title="No run to show" />
        ) : (
          <ErrorPanel error={error} onRetry={onRetry} retryLabel="Try again" />
        )}
      </div>
    </div>
  );
}
