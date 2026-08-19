'use client';

/**
 * THE CONSOLE — the Wednesday batch.
 *
 * One run is the whole batch: eight posts, one independent child run per slot. That is the unit the
 * architecture works in and the unit the operator's morning is, so it is the unit on screen. v1
 * showed one run at a time, which made eight parallel children look like a queue of unrelated
 * events and gave the operator no way to see a week's worth of work as a week's worth of work.
 *
 * Four regions, in the order the operator needs them:
 *
 *   the batch itself — state as data, not prose, with a progress bar that is a count and not a mood
 *   what still needs a decision — the posts, largest thing on the page
 *   what is still drafting — genuinely live, streamed, see `LiveRun`
 *   what has already been decided — a one-line list, because it is context and not work
 *
 * The third region is the honest half of "alive". A finished run is a record and is rendered as
 * one; the only thing that streams is the child that has not finished. Replaying a completed run as
 * though it were happening was the incoherence that made the earlier design unreadable.
 *
 * CORRECTED 19 AUG. That paragraph was true as a description of intent and false as a description of
 * this file: nothing streamed. Every child's steps were fetched in one `Promise.all` and rendered as
 * a static list, so the "Still drafting" card showed all ten of a running child's steps — including
 * its own terminal "Waiting for a decision" — under a pulsing live pill. The header also said three
 * regions while rendering four, and credited `getActiveRun`, which the rebuild never calls. The
 * streaming is now real (`LiveRun`) and the seam refuses to hand back unemitted steps (`getRunSteps`).
 */

import { useCallback, useState } from 'react';
import {
  getBatch,
  getGuardrailRules,
  getRunSteps,
  getSettings,
  type Batch,
} from '@/lib/agentClient';
import type { ConsoleError, GuardrailRule, RunStep, Settings } from '@/lib/types';
import { asConsoleError } from '@/lib/errorCopy';
import { needsDecision } from '@/lib/world';
import { useWorldRead } from '@/lib/useWorldRead';
import { EmptyState, LoadError, LoadingState, StaleWarning } from '@/components/ScreenState';
import { DraftCard } from '@/components/console/DraftCard';
import { LiveRun } from '@/components/console/LiveRun';
import { DecidedCard } from '@/components/console/DecidedCard';
import { BudgetNotice } from '@/components/BudgetNotice';

type Loaded = {
  batch: Batch;
  settings: Settings;
  rules: GuardrailRule[];
  steps: Map<string, RunStep[]>;
};


export default function ConsolePage() {
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<ConsoleError | null>(null);
  const [layout, setLayout] = useState<'split' | 'stacked'>('split');

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

  useWorldRead(load);

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

  if (error && !state) {
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

  const waiting = batch.children.filter((c) => c.draft && needsDecision(c.draft));
  const blocked = waiting.filter((c) => c.draft?.state === 'blocked_guardrail');
  const drafting = batch.children.filter((c) => c.run.state === 'running' || c.run.state === 'queued');
  const settled = batch.children.filter(
    (c) => c.draft && !needsDecision(c.draft) && c.run.state !== 'running',
  );

  return (
    <>
      <PageHead>
        <AgentLine batch={batch} waitingCount={waiting.length} blockedCount={blocked.length} />
      </PageHead>

      {/** Above the batch, not inside it: at `stopped` the gate is the reason the batch looks the
       *   way it does, so it has to be readable before the progress bar rather than after it. */}
      {error && <StaleWarning error={error} onRetry={() => void load()} />}

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

          {/**
           * TWO LAYOUTS, BECAUSE THEY SUIT DIFFERENT MOMENTS.
           *
           * Split puts the live run beside the queue, which is right while a batch is running and
           * you want to watch it land. Stacked gives the posts the full column, which is right once
           * drafting is done and the screen is only a review surface. Neither is correct all the
           * time, so it is a control rather than a decision taken for the operator.
           *
           * The choice is component state and resets on reload. It is a view preference, not a
           * fact about the world, so it does not belong in `agentClient` — putting it there would
           * make the seam carry something a real backend would never store.
           */}
          <span className="lay-toggle" role="group" aria-label="Layout">
            <button
              type="button"
              className={layout === 'split' ? 'is-on' : undefined}
              aria-pressed={layout === 'split'}
              onClick={() => setLayout('split')}
            >
              Split
            </button>
            <button
              type="button"
              className={layout === 'stacked' ? 'is-on' : undefined}
              aria-pressed={layout === 'stacked'}
              onClick={() => setLayout('stacked')}
            >
              Stacked
            </button>
          </span>
        </div>

        <p className="chips">
          <span className="chip mono">{batch.parent.id}</span>
          <span className="chip mono">
            slots <b>{batch.total}</b>
          </span>
          <span className="chip mono">
            settings <b>{settings.current_version_id}</b>
          </span>
        </p>

        <div className="batch-prog">
          <span className="prog">
            <i style={{ width: `${batch.total === 0 ? 0 : (batch.drafted / batch.total) * 100}%` }} />
          </span>
          <span className="prog-num">
            {batch.drafted} / {batch.total} drafted
          </span>
        </div>
      </section>

      <div className={`console-grid console-${layout}`}>
        {/* THE LIVE RUN COMES FIRST IN THE MARKUP in both layouts. It used to sit below the queue
            and the decided list, so the only thing on the screen that moves was the last thing you
            could reach. In `split` it is a sticky column; in `stacked` it is simply the first card. */}
        {drafting.length > 0 && (
          <section className="console-live">
            <h2 className="sec">Drafting now</h2>
            <div className="stack">
              {drafting.map((c) => (
                <LiveRun
                  key={c.run.id}
                  runId={c.run.id}
                  channel={c.draft?.channel ?? 'x'}
                  angle={c.slot?.angle ?? 'Next post'}
                  events={c.events}
                  rules={rules}
                  onEnded={() => void load()}
                />
              ))}
            </div>
          </section>
        )}

        <section className="console-work">
          {waiting.length > 0 && (
            <>
              <h2 className="sec">
                Waiting on you <span className="sec-n">{waiting.length}</span>
              </h2>
              <div className="stack">
                {waiting.map((c) => (
                  <DraftCard
                    key={c.run.id}
                    child={c}
                    steps={steps.get(c.run.id) ?? []}
                    rules={rules}
                    threshold={threshold}
                    reasons={settings.rejection_reason_set}
                    onDecided={() => void load()}
                  />
                ))}
              </div>
            </>
          )}

          {waiting.length === 0 && drafting.length === 0 && (
            <EmptyState
              title="Nothing waiting on you."
              detail="The next drafting batch runs Wednesday at 06:00."
            />
          )}
          {waiting.length === 0 && drafting.length > 0 && (
            <EmptyState
              title="Nothing waiting on you yet."
              detail="The agent is still drafting. Anything that needs a decision will appear here."
            />
          )}

          {/* No heading of its own. These are finished, so they sit at the foot of the same stack
              and say so through their own treatment rather than through a section title. */}
          {settled.length > 0 && (
            <div className="stack done-stack">
              {settled.map((c) =>
                c.draft ? (
                  <DecidedCard
                    key={c.run.id}
                    draft={c.draft}
                    angle={c.slot?.angle ?? 'Untitled slot'}
                  />
                ) : null,
              )}
            </div>
          )}
        </section>
      </div>

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
    ? `Drafting next week now.`
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
