'use client';

/**
 * THE ONE CHILD THAT IS ACTUALLY MID-FLIGHT.
 *
 * The console's docblock claimed "the only thing that streams is the child that has not finished"
 * and nothing streamed: the page fetched every step of every child in one `Promise.all` and rendered
 * a static list under a pulsing "drafting" pill. `streamRun` existed in the seam, fully written, and
 * was called by v1 and by nothing in the rebuild.
 *
 * So the highest-weighted screen in the submission — the one the brief's own tiebreaker is about
 * ("if you are choosing between polishing a fifth screen or making the agent console feel genuinely
 * alive, choose alive") — was asserting liveness in a comment and not delivering it. This component
 * is that claim made true.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY A STEP ARRIVES WHEN IT STARTS
 *
 * `streamRun` emits `step` when a step begins and `settled` when it ends, which is what lets the
 * agent be visibly *doing* something rather than producing finished facts at intervals. The
 * reasoning is on `streamRun` itself; what matters here is rendering the difference, so the newest
 * step reads as in progress until its own `playback_ms` has elapsed.
 *
 * `openRun` supplies `fromSeq` rather than this component knowing it. How far a run has already got
 * is a fact about the run (D-002 forbids a component importing the fixture that holds it), and the
 * seam already computes it for exactly this purpose.
 */

import { useEffect, useState } from 'react';
import { haltRun, openRun, streamRun, type StreamEndReason } from '@/lib/agentClient';
import type { GuardrailEvent, GuardrailRule, RunId, RunStep, RunStepId } from '@/lib/types';
import { StepTimeline } from './StepTimeline';

const END_LABEL: Record<StreamEndReason, string> = {
  interrupt: 'Stopped for a decision',
  parked: 'Parked',
  quarantined: 'Quarantined',
  completed: 'Finished',
  halted: 'Halted',
};

export function LiveRun({
  runId,
  events,
  rules,
  onEnded,
}: {
  runId: RunId;
  events: GuardrailEvent[];
  rules: GuardrailRule[];
  /** The batch's counts change when a run lands, so the page refetches — the fold rule from D-026's
   *  amendment: in-flight steps live here, the world updates once, at the terminal transition. */
  onEnded: () => void;
}) {
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [settled, setSettled] = useState<Set<RunStepId>>(new Set());
  const [ended, setEnded] = useState<StreamEndReason | null>(null);
  const [halting, setHalting] = useState(false);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;

    void openRun(runId).then((attachment) => {
      if (cancelled) return;
      const handle = streamRun(runId, attachment.fromSeq, (event) => {
        if (event.type === 'history') setSteps(event.steps);
        else if (event.type === 'step') setSteps((prev) => [...prev, event.step]);
        else if (event.type === 'settled')
          setSettled((prev) => new Set(prev).add(event.id));
        else {
          setEnded(event.reason);
          onEnded();
        }
      });
      stop = handle.stop;
    });

    return () => {
      cancelled = true;
      stop?.();
    };
    // `onEnded` is intentionally not a dependency: it is a fresh closure on every render of the
    // page, and depending on it would tear down and restart the stream on each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  /** The newest step is in progress until its `settled` event arrives. This is the only thing on the
   *  screen that says the agent is working *now* rather than having worked. */
  const newest = steps.at(-1);
  const working = newest !== undefined && !settled.has(newest.id) && ended === null;

  async function halt() {
    setHalting(true);
    try {
      await haltRun(runId);
      onEnded();
    } finally {
      setHalting(false);
    }
  }

  return (
    <>
      <StepTimeline steps={steps} events={events} rules={rules} />

      {working && (
        <p className="live-working" aria-live="polite">
          <i className="pulse" aria-hidden />
          {newest.label}
        </p>
      )}

      {ended && <p className="live-ended">{END_LABEL[ended]}</p>}

      {/**
       * C6's operator halt, which had no surface in the rebuild at all.
       *
       * `haltRun` is the one producer of `abandoned` a person can reach, and the architecture named
       * that state before anything could create one. It sits here rather than on every card because
       * a run you can stop is by definition one that has not finished.
       */}
      {!ended && (
        <button type="button" className="btn btn-sm live-halt" disabled={halting} onClick={() => void halt()}>
          {halting ? '…' : 'Stop this run'}
        </button>
      )}
    </>
  );
}
