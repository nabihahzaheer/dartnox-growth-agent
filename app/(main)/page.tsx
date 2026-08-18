'use client';

/**
 * THE CONSOLE — the Wednesday batch.
 *
 * One run is the whole batch: eight posts, one independent child run per slot. That is the unit the
 * architecture works in and the unit the operator's morning is, so it is the unit on screen. v1
 * showed one run at a time, which made eight parallel children look like a queue of unrelated
 * events and gave the operator no way to see a week's worth of work as a week's worth of work.
 *
 * Three regions, in the order the operator needs them:
 *
 *   the batch itself — state as data, not prose, with a progress bar that is a count and not a mood
 *   what still needs a decision — the posts, largest thing on the page
 *   what is still drafting — genuinely live, because a child really is mid-flight in the fixtures
 *
 * The last region is the honest half of "alive". Nothing replays here. A finished run is a record
 * and is rendered as one; the only thing that streams is the child that has not finished, which is
 * exactly the situation `getActiveRun` was built for. Replaying a completed run as though it were
 * happening was the incoherence that made the earlier design unreadable.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getBatch,
  getGuardrailRules,
  getRunSteps,
  getSettings,
  subscribeToWorld,
  type Batch,
} from '@/lib/agentClient';
import type { GuardrailRule, RunStep, Settings } from '@/lib/types';
import { DraftCard } from '@/components/console/DraftCard';
import { StepTimeline } from '@/components/console/StepTimeline';

type Loaded = {
  batch: Batch;
  settings: Settings;
  rules: GuardrailRule[];
  steps: Map<string, RunStep[]>;
};

/** A draft that has reached a person and not been decided. Both states qualify: a blocked draft
 *  still needs an operator, it just cannot be approved. */
const NEEDS_DECISION = new Set(['awaiting_approval', 'blocked_guardrail']);

export default function ConsolePage() {
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Nothing here sets state before the first `await`. That is deliberate rather than incidental:
   * a synchronous setState inside an effect body cascades a second render before the first has
   * committed, which is what ESLint's react-hooks/set-state-in-effect exists to catch. Clearing
   * the error alongside the result means one render per load instead of two.
   */
  const load = useCallback(async () => {
    try {
      const [batch, settings, rules] = await Promise.all([
        getBatch(),
        getSettings(),
        getGuardrailRules(),
      ]);
      /** One read per child, in parallel. Sequential would make the page's first paint the sum of
       *  eight latencies rather than the slowest one. */
      const steps = new Map<string, RunStep[]>();
      await Promise.all(
        batch.children.map(async (c) => {
          steps.set(c.run.id, await getRunSteps(c.run.id));
        }),
      );
      setState({ batch, settings, rules, steps });
      setError(null);
    } catch {
      setError('Could not reach the agent. Nothing has been lost — try again.');
    }
  }, []);

  /**
   * Subscribe first, then let the subscription drive the initial load too.
   *
   * `subscribeToWorld` fires on every write, so the effect only ever registers a listener and asks
   * the external system for a first value — it never sets state itself. That is the shape the
   * react-hooks rule is asking for, and it is also the honest description of what this screen is:
   * a view onto a world that changes underneath it.
   */
  useEffect(() => {
    const unsubscribe = subscribeToWorld(() => void load());
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [load]);

  if (error) {
    return (
      <>
        <PageHead />
        <div className="panel state-panel">
          <p className="state-title">{error}</p>
          <button type="button" className="btn" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </>
    );
  }

  if (!state) {
    return (
      <>
        <PageHead />
        <div className="panel state-panel">
          <p className="skeleton skeleton-line" />
          <p className="skeleton skeleton-line short" />
        </div>
      </>
    );
  }

  const { batch, settings, rules, steps } = state;
  const threshold = settings.score_threshold;

  const waiting = batch.children.filter((c) => c.draft && NEEDS_DECISION.has(c.draft.state));
  const drafting = batch.children.filter((c) => c.run.state === 'running' || c.run.state === 'queued');
  const settled = batch.children.filter(
    (c) => c.draft && !NEEDS_DECISION.has(c.draft.state) && c.run.state !== 'running',
  );

  return (
    <>
      <PageHead />

      <section className="batch panel">
        <div className="batch-top">
          <h2 className="batch-title">Wednesday drafting batch</h2>
          {batch.running ? (
            <span className="pill pill-live">
              <i className="pulse" aria-hidden /> running
            </span>
          ) : (
            <span className="pill pill-go">complete</span>
          )}
        </div>

        <p className="chips">
          <span className="chip mono">{batch.parent.id}</span>
          <span className="chip mono">{batch.parent.trigger}</span>
          <span className="chip mono">
            slots <b>{batch.total}</b>
          </span>
          <span className="chip mono">
            settings <b>{settings.current_version_id}</b>
          </span>
          <span className="chip mono">
            spend <b>${batch.budget.spent.toFixed(2)}</b> / {batch.budget.cap}
          </span>
        </p>

        <div className="batch-prog">
          <span className="prog">
            <i style={{ width: `${(batch.drafted / batch.total) * 100}%` }} />
          </span>
          <span className="prog-num">
            {batch.drafted} / {batch.total} drafted
          </span>
        </div>
      </section>

      {waiting.length > 0 && (
        <section>
          <h3 className="sec">
            Waiting on you <span className="sec-n">{waiting.length}</span>
          </h3>
          <div className="stack">
            {waiting.map((c) => (
              <DraftCard
                key={c.run.id}
                child={c}
                steps={steps.get(c.run.id) ?? []}
                rules={rules}
                threshold={threshold}
                onDecided={() => void load()}
              />
            ))}
          </div>
        </section>
      )}

      {waiting.length === 0 && (
        <div className="panel state-panel">
          <p className="state-title">Nothing waiting on you.</p>
          <p className="state-sub">The next drafting batch runs Wednesday at 06:00.</p>
        </div>
      )}

      {drafting.length > 0 && (
        <section>
          <h3 className="sec">
            Still drafting <span className="sec-n">{drafting.length}</span>
          </h3>
          <div className="stack">
            {drafting.map((c) => (
              <article key={c.run.id} className="card card-live">
                <header className="card-head">
                  <span
                    className="ch-dot"
                    style={{ background: `var(--ch-${c.draft?.channel ?? 'x'})` }}
                    aria-hidden
                  />
                  <span>{c.slot?.angle ?? 'Untitled slot'}</span>
                  <span className="card-state">
                    <span className="pill pill-live">
                      <i className="pulse" aria-hidden /> drafting
                    </span>
                  </span>
                </header>
                <div className="card-body">
                  <StepTimeline
                    steps={steps.get(c.run.id) ?? []}
                    events={c.events}
                    rules={rules}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {settled.length > 0 && (
        <section>
          <h3 className="sec">
            Already decided <span className="sec-n">{settled.length}</span>
          </h3>
          <ul className="settled">
            {settled.map((c) => (
              <li key={c.run.id}>
                <span
                  className="ch-dot"
                  style={{ background: `var(--ch-${c.draft?.channel ?? 'x'})` }}
                  aria-hidden
                />
                <span className="settled-title">{c.slot?.angle}</span>
                <span className="settled-state mono">{c.draft?.state}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function PageHead() {
  return (
    <header className="page-head">
      <h1 className="page-title">Console</h1>
      <p className="page-sub">
        Next week&rsquo;s posts, drafted overnight. Everything here is waiting on you or already
        settled.
      </p>
    </header>
  );
}
