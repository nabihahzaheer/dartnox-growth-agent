'use client';

/**
 * THE CONSOLE — a live feed of the agent working.
 *
 * The brief is blunt about this screen: simulate the step stream with realistic timing, and
 * "faked streaming matters; a static list does not cut it." Its closing instruction makes this the
 * screen everything else is traded against.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS REAL HERE AND WHAT IS PRE-WRITTEN — worth being able to say plainly
 *
 * Pre-written: the words. Post text, reasoning text, tool payloads, guardrail explanations. In a
 * real system a model produces those.
 *
 * Real: everything around them. The steps genuinely arrive one at a time on a timer. The data
 * genuinely arrives asynchronously, so the loading state is not staged. A failed call genuinely
 * fails. The run genuinely branches on its own guardrail results.
 *
 * So the honest sentence is: the model output is pre-recorded, the system logic around it is real.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getActiveRun,
  getGuardrailEvents,
  getRun,
  haltRun,
  isFailureActive,
  streamRun,
  type StreamEndReason,
} from '@/lib/agentClient';
import type { ConsoleError, GuardrailEvent, Run, RunId, RunStep } from '@/lib/types';
import { formatRelative } from '@/lib/time';
import { Badge, runStateTone } from '@/components/Badge';
import { StepRow } from '@/components/console/StepRow';
import { FailureDrawer } from '@/components/console/FailureDrawer';
import { Eyebrow, Note } from '@/components/Eyebrow';

/** The run the fixtures leave mid-flight, and how far it had got when we attached. */
const LIVE_RUN_ID = 'RUN-0143' as RunId;
const LIVE_RUN_THROUGH_SEQ = 6;
const TOOL_FAILURE_RUN_ID = 'RUN-0144' as RunId;

const TRIGGER_LABEL: Record<string, string> = {
  'schedule.weekly_plan': 'Monday planning schedule',
  'schedule.weekly_draft': 'Wednesday drafting batch',
  'manual.run_now': 'Run now, by the operator',
  'poll.performance': 'Daily performance poll',
  'poll.engagement': '30-minute reply poll',
  'sweep.resume': 'Hourly resume sweep',
};

const END_COPY: Record<StreamEndReason, string> = {
  interrupt: 'Waiting for a person. The run is holding its place, not finished.',
  parked: 'Parked after a failure. The hourly sweep will resume it from its checkpoint.',
  completed: 'Run complete.',
  halted: 'Halted by you. Any draft it was producing is left orphaned.',
};

type Source = { runId: RunId; fromSeq: number; nonce: number };

export default function ConsolePage() {
  const [run, setRun] = useState<Run | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [events, setEvents] = useState<GuardrailEvent[]>([]);
  const [ended, setEnded] = useState<StreamEndReason | null>(null);
  const [error, setError] = useState<ConsoleError | null>(null);
  const [loading, setLoading] = useState(true);

  /* ---- attach to whatever is live on first load ------------------------------------------- */
  useEffect(() => {
    let cancelled = false;

    getActiveRun()
      .then(async (active) => {
        if (cancelled) return;
        setRun(active);
        setSource({ runId: active.id, fromSeq: LIVE_RUN_THROUGH_SEQ, nonce: 0 });
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

  /* ---- controls ---------------------------------------------------------------------------- */

  const startRun = useCallback(async (targetId: RunId, fromSeq: number) => {
    setLoading(true);
    setError(null);
    setEnded(null);
    try {
      const next = await getRun(targetId);
      setRun(next);
      setEvents(await getGuardrailEvents(targetId));
      setSource((current) => ({
        runId: targetId,
        fromSeq,
        // Bumped every time so pressing "run now" on the run already on screen still restarts it.
        // The key below is built from this, so a new nonce remounts the stream with clean state.
        nonce: (current?.nonce ?? 0) + 1,
      }));
    } catch (e) {
      setError(e as ConsoleError);
    } finally {
      setLoading(false);
    }
  }, []);

  const runNow = useCallback(() => {
    /**
     * §6b's unlock. Most settings take effect "next draft", so without a run on demand a tone
     * change takes effect at a moment nobody is watching. This is what makes those controls
     * demonstrable at all.
     *
     * With the tool-failure switch armed, this streams the run whose variant is `tool_failure`
     * instead — three attempts, jittered backoff, then a park. That is the entire mechanism:
     * pre-written alternate step sequences selected by a flag, which is what `RunVariant` is.
     */
    const target = isFailureActive('tool_failure') ? TOOL_FAILURE_RUN_ID : LIVE_RUN_ID;
    void startRun(target, 0);
  }, [startRun]);

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

  const handleEnd = useCallback((reason: StreamEndReason) => setEnded(reason), []);

  /* ---- render ------------------------------------------------------------------------------ */

  if (error) {
    return <ErrorState error={error} onRetry={() => void startRun(LIVE_RUN_ID, 0)} />;
  }

  const streaming = source !== null && ended === null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="space-y-1">
            <Eyebrow>Operator console</Eyebrow>
            <h1 className="text-xl font-bold leading-tight">The agent, working</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runNow}
              className="rounded border px-2.5 py-1 text-sm font-medium"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--accent-text)' }}
            >
              Run now
            </button>
            {/*
              Halt, not pause. Pause implies resume, which implies a checkpoint and a restart path
              — a different feature, and a pause button that cannot resume invites exactly the
              question the orchestrator has to answer on the board anyway. Half-implementing it
              would be worse than not having it.
            */}
            <button
              type="button"
              onClick={halt}
              disabled={!streaming}
              className="rounded border px-2.5 py-1 text-sm disabled:opacity-40"
              style={{ borderColor: 'var(--border-strong)' }}
            >
              Halt
            </button>
            <FailureDrawer />
          </div>
        </div>

        {run && (
          <div
            className="rounded border px-3 py-2.5"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <div className="mb-1.5">
              <Eyebrow>Current run</Eyebrow>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{run.id}</span>
              <Badge tone={runStateTone(run.state)}>{run.state.replace(/_/g, ' ')}</Badge>
              {run.degraded && <Badge tone="parked">degraded</Badge>}
              {run.variant !== 'nominal' && (
                <Badge tone="parked" mono>
                  variant: {run.variant}
                </Badge>
              )}
            </div>
            {/* Why this run fired is the difference between a feed and a trace. */}
            <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
              {TRIGGER_LABEL[run.trigger] ?? run.trigger} · started {formatRelative(run.started_at)}{' '}
              · step cap {run.step_cap}
            </p>
          </div>
        )}
      </header>

      {loading && <LoadingState />}

      {source && (
        <div className="mb-1.5 pt-1">
          <Eyebrow>Activity</Eyebrow>
        </div>
      )}

      {source && (
        <RunStream
          // Remounting on a new source is what resets the feed. Resetting state inside the effect
          // instead would mean a synchronous setState during an effect, which cascades renders —
          // a key is the framework's own answer to "this is a different thing now".
          key={`${source.runId}:${source.nonce}`}
          runId={source.runId}
          fromSeq={source.fromSeq}
          events={events}
          onEnd={handleEnd}
        />
      )}

      {/* The document reserves its green block for the thing you must not miss. A run stopping —
          and *why* it stopped — is that thing on this screen. */}
      {ended && <Note>{END_COPY[ended]}</Note>}

      {!loading && !source && !ended && <EmptyState onRun={runNow} />}
    </div>
  );
}

/* ================================================================================================
 * THE STREAM
 *
 * A separate component so that starting a different run is a remount rather than a reset. Its
 * whole state — which steps have arrived, how many were history — is scoped to one attachment.
 * ==============================================================================================*/

function RunStream({
  runId,
  fromSeq,
  events,
  onEnd,
}: {
  runId: RunId;
  fromSeq: number;
  events: GuardrailEvent[];
  onEnd: (reason: StreamEndReason) => void;
}) {
  const [steps, setSteps] = useState<RunStep[]>([]);
  /** How many steps had already happened when we attached. Steps below this index are history and
   *  must not animate in — replaying an arrival that already occurred is theatre. */
  const [historyLength, setHistoryLength] = useState(0);
  const [live, setLive] = useState(true);

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

    // StrictMode double-invokes effects in development on purpose, to surface ones that leak.
    // `stop()` clears the pending timer and flags an in-flight callback, so the second mount runs
    // clean rather than alongside the first and emitting every step twice.
    return () => handle.stop();
  }, [runId, fromSeq, onEnd]);

  return (
    <>
      {/*
        `aria-live="polite"` with `aria-relevant="additions"`: steps are announced as they arrive
        without the whole list being re-read each time. Not `assertive` — this is a feed, not an
        alarm, and interrupting a reader once a second would make the screen unusable.
      */}
      <ol className="space-y-2" aria-live="polite" aria-relevant="additions" aria-label="Agent activity">
        {steps.map((step, index) => (
          <StepRow
            key={step.id}
            step={step}
            event={events.find((e) => e.run_step_id === step.id)}
            isNew={index >= historyLength}
          />
        ))}
      </ol>

      {live && steps.length > 0 && (
        <p className="flex items-center gap-2 px-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: 'var(--state-running)' }}
          />
          Working…
        </p>
      )}
    </>
  );
}

/* ================================================================================================
 * STATES
 * The brief names loading, empty and error as a constraint, so they are components rather than
 * afterthoughts. Each says what is happening and what the reader can do about it.
 * ==============================================================================================*/

function LoadingState() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading the run">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-14 rounded border"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-sunk)' }}
        />
      ))}
    </div>
  );
}

function EmptyState({ onRun }: { onRun: () => void }) {
  return (
    <div
      className="rounded border px-4 py-6 text-center"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <p className="text-sm font-medium">No run in progress</p>
      <p className="mx-auto mt-1 max-w-md text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Runs normally start on a schedule — the calendar on Monday, the drafting batch on
        Wednesday. You can also start one by hand.
      </p>
      <button
        type="button"
        onClick={onRun}
        className="mt-3 rounded border px-2.5 py-1 text-sm font-medium"
        style={{ borderColor: 'var(--border-strong)', color: 'var(--accent-text)' }}
      >
        Run now
      </button>
    </div>
  );
}

/** D-031's argument in one component: seven error kinds exist because the copy differs, and the
 *  copy differing is the point. A single "something went wrong" would waste the taxonomy. */
function ErrorState({ error, onRetry }: { error: ConsoleError; onRetry: () => void }) {
  const copy: Record<ConsoleError['kind'], string> = {
    not_found: 'That run no longer exists.',
    version_conflict: 'This draft changed since you opened it. Reload to see the current version.',
    guardrail_block: 'A guardrail blocked this action.',
    forbidden: 'That control is fixed and cannot be changed.',
    rate_limited: 'Too many requests. Try again shortly.',
    unavailable: 'Could not reach the agent runtime. This is usually transient.',
    timeout: 'The request timed out, so we do not know whether it landed. Check before retrying.',
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div
        className="rounded border px-4 py-4"
        style={{ borderColor: 'var(--state-blocked)', background: 'var(--state-blocked-bg)' }}
      >
        <p className="text-sm font-medium">{copy[error.kind]}</p>
        <p
          className="mt-1 font-mono text-[11px] uppercase"
          style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}
        >
          {error.kind}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded border px-2.5 py-1 text-sm font-medium"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
