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
import type { ConsoleError, GuardrailRule, RunStep, Settings } from '@/lib/types';
import { asConsoleError } from '@/lib/errorCopy';
import { EmptyState, LoadError, LoadingState } from '@/components/ScreenState';
import { DraftCard } from '@/components/console/DraftCard';
import { StepTimeline } from '@/components/console/StepTimeline';
import { BudgetNotice } from '@/components/BudgetNotice';

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
  const [error, setError] = useState<ConsoleError | null>(null);

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
    } catch (e) {
      setError(asConsoleError(e));
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

  /**
   * `not_found` is an empty state, not a failure (D-031), and this screen used to render it as one.
   *
   * `getBatch()` throws it when no parent drafting run exists — a client onboarded on a Thursday has
   * no Wednesday batch behind them yet, which is a legitimate state of the world and not a fault.
   * Painting it red with a retry button told the operator something had broken and invited them to
   * retry a call that would keep answering the same way. `app/(main)/approvals/[id]` already made
   * this distinction; the console did not, so two screens disagreed about what a missing record
   * means.
   */
  if (error && error.kind === 'not_found') {
    return (
      <>
        <PageHead />
        <EmptyState
          title="No drafting batch yet."
          detail="The agent drafts the coming week every Wednesday at 06:00. Nothing has run for this client so far."
        />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHead />
        <LoadError error={error} onRetry={() => void load()} />
      </>
    );
  }

  if (!state) {
    return (
      <>
        <PageHead />
        <LoadingState lines={3} label="Loading the batch" />
      </>
    );
  }

  const { batch, settings, rules, steps } = state;
  const threshold = settings.score_threshold;

  const waiting = batch.children.filter((c) => c.draft && NEEDS_DECISION.has(c.draft.state));
  const blocked = waiting.filter((c) => c.draft?.state === 'blocked_guardrail');
  const drafting = batch.children.filter((c) => c.run.state === 'running' || c.run.state === 'queued');
  const settled = batch.children.filter(
    (c) => c.draft && !NEEDS_DECISION.has(c.draft.state) && c.run.state !== 'running',
  );

  return (
    <>
      <PageHead>
        <AgentLine batch={batch} waitingCount={waiting.length} blockedCount={blocked.length} />
      </PageHead>

      {/** Above the batch, not inside it: at `stopped` the gate is the reason the batch looks the
       *   way it does, so it has to be readable before the progress bar rather than after it. */}
      <BudgetNotice budget={batch.budget} />

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
          {/**
           * The spend chip that used to sit here is gone, deliberately. `lib/budget.ts` states the
           * rule in its own type comment — `under` renders nothing anywhere, because a console
           * carrying a permanent budget strip spends its best pixels on a number that is fine
           * almost always. `BudgetNotice` above speaks up at the alert and stop thresholds and is
           * silent otherwise; Results and Settings carry the standing figure.
           */}
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
        <EmptyState
          title="Nothing waiting on you."
          detail="The next drafting batch runs Wednesday at 06:00."
        />
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

/**
 * `Console` stays a plain heading — h1 is not the place for a composed sentence. What sits below it
 * is `children`, and it is empty until there is real batch data to compose from: a narrator line
 * cannot say anything true before the first read returns, and a placeholder sentence would be
 * exactly the kind of prose this rebuild has spent five steps replacing with values.
 */
function PageHead({ children }: { children?: React.ReactNode }) {
  return (
    <header className="page-head">
      <h1 className="page-title">Console</h1>
      {children}
    </header>
  );
}

/**
 * WHAT THE AGENT WOULD SAY, COMPOSED FROM THE SAME FIELDS THE PANEL BELOW RENDERS.
 *
 * Not a chat box — there is nowhere to type back, and D-002's seam has no endpoint for a free-text
 * instruction to land on. What is worth keeping from the composer we cut is the register: the agent
 * reporting on itself in one sentence, the way Lindy's activity feed narrates a run rather than
 * captioning it. Every number here is `batch`, `waiting.length` or `blocked.length` — nothing is
 * written independently of what the panel underneath is about to show, so the two cannot disagree.
 */
function AgentLine({
  batch,
  waitingCount,
  blockedCount,
}: {
  batch: Batch;
  waitingCount: number;
  blockedCount: number;
}) {
  const said = batch.running
    ? `Drafting next week now — ${batch.drafted} of ${batch.total} done so far.`
    : waitingCount === 0
      ? `Finished next week's ${batch.total} posts. Nothing left for you to decide.`
      : `Finished next week's ${batch.total} posts. ${
          waitingCount === 1 ? '1 needs you' : `${waitingCount} need you`
        }${blockedCount > 0 ? `, ${blockedCount === 1 ? 'one of them blocked' : `${blockedCount} of them blocked`}` : ''}.`;

  return (
    <div className="agent-line">
      <span className="agent-avatar" aria-hidden>
        GA
      </span>
      <p className="agent-said">{said}</p>
    </div>
  );
}
