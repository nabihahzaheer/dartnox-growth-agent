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
 * A context strip that does not move, one scrolling transcript, and a composer pinned to the
 * bottom. The transcript stays anchored to its end as steps arrive, and stops doing so the moment
 * you scroll up to read something — because following a live feed and reading back through it are
 * two different jobs, and a view that yanks you to the bottom mid-sentence is doing one of them
 * badly.
 *
 * An earlier version was a document: a page title, stacked sections with headings, content running
 * off the bottom of a scrolling page. It read as an article about an agent rather than as an agent
 * being watched.
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
  getGuardrailEvents,
  haltRun,
  openRun,
  runNow as startRunNow,
  streamRun,
  submitBrief,
  type RunAttachment,
  type StreamEndReason,
} from '@/lib/agentClient';
import type { BriefRef, ConsoleError, GuardrailEvent, Run, RunId, RunStep } from '@/lib/types';
import { formatRelative, formatTime } from '@/lib/time';
import { Badge, RUN_STATE_LABEL, runStateTone } from '@/components/Badge';
import { ErrorPanel, NotFound } from '@/components/ErrorState';
import { StepRow } from '@/components/console/StepRow';
import { ControlBar } from '@/components/console/ControlBar';
import { Rail } from '@/components/Rail';

const TRIGGER_LABEL: Record<string, string> = {
  'schedule.weekly_plan': 'Monday schedule',
  'schedule.weekly_draft': 'Wednesday batch',
  'manual.run_now': 'Started by you',
  'poll.performance': 'Daily poll',
  'poll.engagement': 'Reply poll',
  'sweep.resume': 'Retry sweep',
};

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
   * Where a decision actually gets taken.
   *
   * The console is a viewer and the queue is where a week's decisions get cleared in one sitting.
   * That split is the brief's, but nothing on this screen used to say so: a run would stop, announce
   * "Waiting for you", and offer no route anywhere. The only visible control was Run now, which
   * starts a *different* run — so the obvious thing to press was also the wrong one, and it gave no
   * signal that it was wrong.
   */
  const router = useRouter();
  const goToQueue = useCallback(() => router.push('/queue'), [router]);

  const streaming = source !== null && ended === null;
  /**
   * True when this run stopped for the operator specifically.
   *
   * Keyed off the *stream's* ending rather than `run.state`, and the difference is not pedantic:
   * the live run is `running` in its record and stays that way while its remaining steps play out,
   * so a condition on the record hid the link on the one run a reviewer is most likely to be
   * watching when it stops.
   *
   * Planning is excluded because its gate waits on the owner, who has no console account and
   * approves by signed link from their inbox. Offering the operator a decision there would invent
   * a gate the architecture does not have.
   */
  const needsOperator = ended === 'interrupt' && run?.type !== 'planning';
  /** Viewing something that already finished, rather than following the live run. */
  const viewingPast = run !== null && run.state !== 'running' && ended !== null;

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
      {/* Context strip. Fixed, because "which run is this and why did it fire" should never scroll
          away from the thing it describes. */}
      <div
        className="shrink-0 border-b px-4 py-2.5"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-1">
          {run ? (
            <>
              <span className="font-mono text-[13px]">{run.id}</span>
              <Badge tone={runStateTone(run.state)}>
                {RUN_STATE_LABEL[run.state] ?? run.state}
              </Badge>
              {run.variant !== 'nominal' && (
                <Badge tone="parked" mono>
                  {run.variant}
                </Badge>
              )}
              {run.degraded && <Badge tone="parked">degraded</Badge>}
              <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {TRIGGER_LABEL[run.trigger] ?? run.trigger} · {formatRelative(run.started_at)}
              </span>

            </>
          ) : (
            <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              No run selected
            </span>
          )}
        </div>
      </div>

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
      />

      <ControlBar
        onSubmitBrief={sendBrief}
        onRunNow={runNow}
        onHalt={halt}
        onBackToLive={backToLive}
        canHalt={streaming}
        viewingPast={viewingPast}
        busy={loading}
      />
      </main>
    </>
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
          />
        )}

        {ended && (
          <div
            className="flex flex-wrap items-center gap-2 rounded px-2.5 py-1.5"
            style={{ background: END_TONE[ended].bg, color: END_TONE[ended].ink }}
          >
            <span className="text-[13px] font-bold">{END_COPY[ended]}</span>
            {/* The route out. A banner saying "Waiting for you" with nothing to click is where
                this screen used to end. */}
            {needsOperator && (
              <button
                type="button"
                onClick={onDecide}
                className="rounded px-2 py-0.5 text-[13px] font-bold underline underline-offset-2"
                style={{ color: 'inherit' }}
              >
                Decide on this in the queue →
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
          <p className="pt-0.5 text-right text-[11px]" style={{ color: 'var(--text-faint)' }}>
            Queued for the next run
          </p>
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
        <div
          className="font-mono text-[10px] font-bold uppercase"
          style={{ color: 'var(--accent-text)', letterSpacing: '0.1em' }}
        >
          Brief · {formatTime(brief.submitted_at)}
        </div>
        <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap">{brief.text}</p>
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
}: {
  runId: RunId;
  fromSeq: number;
  events: GuardrailEvent[];
  onEnd: (reason: StreamEndReason) => void;
  onDecide: () => void;
}) {
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [historyLength, setHistoryLength] = useState(0);
  const [live, setLive] = useState(true);
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
      } else if (event.type === 'step') {
        setSteps((current) => [...current, event.step]);
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
              onDecide={onDecide}
            />
          </Fragment>
        ))}
      </ol>

      {live && steps.length > 0 && (
        <p className="flex items-center gap-2 px-1 pt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
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

function EmptyState({ onRun }: { onRun: () => void }) {
  return (
    <div className="py-10 text-center">
      <p className="text-[13px] font-medium">Nothing running</p>
      <p className="mx-auto mt-1 max-w-sm text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Runs start on a schedule — the calendar on Monday, the drafting batch on Wednesday. Brief
        the agent below, or start one now.
      </p>
      <button
        type="button"
        onClick={onRun}
        className="mt-3 rounded px-2.5 py-1 text-[13px] font-medium"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        Run now
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
          <NotFound
            title="No run to show"
            detail="Runs start on a schedule — the calendar on Monday, the drafting batch on Wednesday."
          />
        ) : (
          <ErrorPanel error={error} onRetry={onRetry} retryLabel="Try again" />
        )}
      </div>
    </div>
  );
}
