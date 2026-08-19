'use client';

/**
 * THE ONE CHILD THAT IS ACTUALLY MID-FLIGHT.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT "ALIVE" HAD TO MEAN, AFTER THE FIRST ATTEMPT DID NOT
 *
 * The first version streamed correctly and still did not feel alive, and the reason is worth
 * stating: the only motion was *arrival*. A finished step appeared every couple of seconds and
 * nothing happened in between, so the screen read as a list being populated on a timer rather than
 * as work being done. Nabihah's words: "that doesnt feel alive enough".
 *
 * Three changes, none of which invent data:
 *
 *   A step that is running is OPEN and shows its own sub-lines appearing one at a time, each derived
 *   from a real field on the step — the sources it read, the rules it applied, the model it asked.
 *   Nothing here is written prose; `subLinesFor` composes them from the record.
 *
 *   A running step carries a spinner and a clock counting its real `latency_ms`. Between arrivals
 *   there is now something moving that means something.
 *
 *   A finished step COLLAPSES to one line — tick, label, duration — so the open step is the only
 *   detailed thing on screen and the eye goes to the work in progress rather than to the history.
 *
 * ---------------------------------------------------------------------------------------------
 * AND THE RUN NOW LANDS SOMEWHERE
 *
 * The stream used to end on "Waiting for a decision" while the draft it produced stayed in
 * `drafting`, so the decision the run announced existed nowhere. On the terminal event this calls
 * `landRunAtInterrupt`, which moves the draft into `awaiting_approval` and opens its Approval row —
 * so the card hands off into a real decision at the top of the queue. See `landRun` in
 * `lib/world.ts`.
 */

import { useEffect, useState } from 'react';
import { haltRun, landRunAtInterrupt, openRun, streamRun, type StreamEndReason } from '@/lib/agentClient';
import type { GuardrailEvent, GuardrailRule, RunId, RunStep, RunStepId } from '@/lib/types';
import { ChannelMark } from '@/components/ChannelMark';

const END_LABEL: Record<StreamEndReason, string> = {
  interrupt: 'Ready for your decision',
  parked: 'Parked — it will retry on its own',
  quarantined: 'Quarantined before drafting',
  completed: 'Finished',
  halted: 'Stopped by you',
};

/**
 * The lines a running step shows while it works, composed from what the record actually holds.
 *
 * This is the compose-from-values rule applied to motion: it would have been far easier to write
 * three plausible sentences per step type, and they would have been prose that could drift from the
 * step beside them. Every line below names a number or a label the step is carrying.
 */
function subLinesFor(
  step: RunStep,
  events: GuardrailEvent[],
  rules: GuardrailRule[],
): string[] {
  const lines: string[] = [];

  if (step.tool_name) lines.push(`calling ${step.tool_name.replace(/_/g, ' ')}`);
  if (step.sources.length > 0)
    lines.push(`read ${step.sources.length} source${step.sources.length === 1 ? '' : 's'}`);
  for (const input of step.applied_inputs.slice(0, 3)) lines.push(input.label.toLowerCase());
  if (step.model) lines.push(`asking ${step.model}`);

  /** A guardrail step carries none of the above — no model, no tool, no inputs — so without this it
   *  was an open step with nothing under it. What it does carry is the rule it ran, which is the
   *  honest description of the work: the check's own name and how it decides. */
  const event = events.find((e) => e.id === step.guardrail_event_id);
  const rule = event?.rule_id ? rules.find((r) => r.id === event.rule_id) : undefined;
  if (rule) {
    lines.push(`checking: ${rule.display_name.toLowerCase()}`);
    lines.push(`by ${rule.mechanism}`);
  }

  return lines;
}

export function LiveRun({
  runId,
  channel,
  angle,
  events,
  rules,
  onEnded,
}: {
  runId: RunId;
  channel: 'linkedin' | 'x';
  angle: string;
  events: GuardrailEvent[];
  rules: GuardrailRule[];
  onEnded: () => void;
}) {
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [settled, setSettled] = useState<Set<RunStepId>>(new Set());
  const [ended, setEnded] = useState<StreamEndReason | null>(null);
  const [halting, setHalting] = useState(false);
  /** How many sub-lines of the running step are visible, and how long it has been running. */
  const [revealed, setRevealed] = useState(0);
  /**
   * Elapsed is computed from when the step started, not accumulated a tick at a time.
   *
   * The first version did `setElapsed(e => e + 0.1)` on a 100ms interval, and measured about one
   * increment per second in the browser — the effect was being torn down and rebuilt often enough
   * that most ticks never landed, so the clock ran at a tenth of real speed and quietly lied. A
   * timestamp cannot drift: however often this re-renders, `now - startedAt` is the truth.
   */
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const elapsed = startedAt === 0 ? 0 : (now - startedAt) / 1000;

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;

    void openRun(runId).then((attachment) => {
      if (cancelled) return;
      const handle = streamRun(runId, attachment.fromSeq, (event) => {
        if (event.type === 'history') setSteps(event.steps);
        else if (event.type === 'step') {
          setSteps((prev) => [...prev, event.step]);
          setRevealed(0);
          const at = Date.now();
          setStartedAt(at);
          setNow(at);
        } else if (event.type === 'settled') setSettled((prev) => new Set(prev).add(event.id));
        else {
          setEnded(event.reason);
          /** The one write the console makes on the agent's behalf rather than the operator's: the
           *  run reached its gate, so the world records that it is now waiting on a person. */
          /**
           * Land immediately, refresh a beat later.
           *
           * The write has to happen at once or the world is briefly wrong. The *refresh* is delayed
           * because refreshing unmounts this card — the run is no longer `running`, so it drops out
           * of the drafting filter — and without the pause the run simply vanished at the moment it
           * finished. The operator saw a card disappear rather than a run hand its work over.
           */
          void landRunAtInterrupt(runId).then(() => {
            window.setTimeout(onEnded, 2600);
          });
        }
      });
      stop = handle.stop;
    });

    return () => {
      cancelled = true;
      stop?.();
    };
    // `onEnded` is a fresh closure each render; depending on it would restart the stream every time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const newest = steps.at(-1);
  const working = newest !== undefined && !settled.has(newest.id) && ended === null;
  const subLines = newest ? subLinesFor(newest, events, rules) : [];

  /** Reveal one sub-line at a time and tick the clock, only while a step is actually open. */
  useEffect(() => {
    if (!working) return;
    const tick = setInterval(() => setNow(Date.now()), 100);
    /** Paced against the step's own playback length rather than a fixed 700ms, so a long drafting
     *  call fills its time instead of showing everything in the first two seconds and then sitting
     *  on "working…" for the rest. */
    const per = Math.max(500, (newest.playback_ms * 4.2) / (subLines.length + 1));
    const reveal = setInterval(() => setRevealed((r) => Math.min(r + 1, subLines.length)), per);
    return () => {
      clearInterval(tick);
      clearInterval(reveal);
    };
  }, [working, newest?.id, newest?.playback_ms, subLines.length]);

  async function halt() {
    setHalting(true);
    try {
      await haltRun(runId);
      /**
       * Set the ending locally before telling the parent.
       *
       * Pressing Stop used to call `haltRun` and then `onEnded`, which refetched, dropped the run
       * out of the drafting filter, and unmounted this card — so the operator pressed a button and
       * the thing they stopped disappeared, with no confirmation that stopping was what happened.
       * The card now says it was stopped and stays put; the parent is told after.
       */
      setEnded('halted');
      onEnded();
    } finally {
      setHalting(false);
    }
  }

  const done = steps.filter((s) => settled.has(s.id) || s.id !== newest?.id);

  return (
    <article className="card card-live live">
      <header className="card-head">
        <ChannelMark channel={channel} />
        <span>{angle}</span>
        <span className="card-state">
          {ended ? (
            <span className="pill pill-attend">{END_LABEL[ended]}</span>
          ) : (
            <span className="pill pill-live">
              <i className="pulse" aria-hidden /> drafting
            </span>
          )}
        </span>
      </header>

      <div className="card-body">
        <ol className="lv">
          {/* Finished steps, collapsed. One line each so the open step is the only detailed thing. */}
          {done.map((s) => (
            <li key={s.id} className="lv-row">
              <span className="lv-node lv-ok" aria-hidden>✓</span>
              <span className="lv-label">{s.label}</span>
              <span className="sr-only">finished</span>
              <span className="lv-dur">{(s.latency_ms / 1000).toFixed(1)}s</span>
            </li>
          ))}

          {/* The step in progress, open, with its own lines arriving. */}
          {working && newest && (
            <li className="lv-row lv-open">
              <span className="lv-node lv-now" aria-hidden>
                <i className="lv-spin" />
              </span>
              <div className="lv-body">
                <p className="lv-label lv-strong">
                  {newest.label}
                  {/* Rounded, and only where a step actually spends any. `RunStep` carries
                      `tokens_in`/`tokens_out` and A-04 specifies a per-step token cap, so this is
                      modelled rather than invented — but the exact figure is noise while a step is
                      still running, so the header shows the scale and the expanded trace keeps the
                      precise number. */}
                  {newest.tokens_in > 0 && (
                    <span className="lv-tok">~{Math.round(newest.tokens_in / 100) / 10}k tokens</span>
                  )}
                </p>
                <ul className="lv-sub">
                  {subLines.slice(0, revealed).map((line) => (
                    <li key={line}>
                      <span className="lv-tick" aria-hidden>✓</span>
                      {line}
                    </li>
                  ))}
                  {revealed < subLines.length && (
                    <li className="lv-pending">
                      <span className="lv-tick lv-tick-run" aria-hidden>◍</span>
                      working…
                    </li>
                  )}
                </ul>
              </div>
              <span className="lv-dur lv-live-dur">{elapsed.toFixed(1)}s</span>
            </li>
          )}

          {/* Where it ends up, so the run reads as going somewhere. */}
          {ended && (
            <li className="lv-row">
              <span className="lv-node lv-end" aria-hidden>→</span>
              <span className="lv-label lv-strong">{END_LABEL[ended]}</span>
            </li>
          )}
        </ol>

        {ended === 'interrupt' && (
          <p className="lv-handoff" aria-live="polite">
            This draft has moved to <b>Waiting on you</b> below.
          </p>
        )}
      </div>

      {!ended && (
        <footer className="card-act">
          {/* C6's operator halt — the one producer of `abandoned` a person can reach, and the
              architecture named that state before anything could create one. */}
          <button type="button" className="btn btn-sm" disabled={halting} onClick={() => void halt()}>
            {halting ? 'Stopping…' : 'Stop'}
          </button>
        </footer>
      )}
    </article>
  );
}
