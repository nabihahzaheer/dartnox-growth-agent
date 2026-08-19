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
import { ChannelMark } from '@/components/ChannelMark';
import { formatDate, formatDateTime, formatTime } from '@/lib/time';

type Loaded = {
  batch: Batch;
  settings: Settings;
  rules: GuardrailRule[];
  steps: Map<string, RunStep[]>;
};


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

  /** A landed run's draft belongs here, which is the whole point of the handoff: the run card stays
   *  as the record of what happened, and the decision it produced appears below. */
  const waiting = batch.children.filter((c) => c.draft && needsDecision(c.draft));
  const drafting = batch.children.filter(
    (c) => c.run.state === 'running' || c.run.state === 'queued',
  );
  const settled = batch.children.filter(
    (c) => c.draft && !needsDecision(c.draft) && c.run.state !== 'running',
  );

  /** The week this batch publishes into, read off the slots it targets rather than asserted. This
   *  is the fact the console and the calendar were quietly disagreeing about. */
  const publishAts = batch.children
    .map((c) => c.slot?.publish_at)
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .sort((a, b) => (a as number) - (b as number));
  const publishingWeek =
    publishAts.length === 0
      ? null
      : `${formatDate(publishAts[0])} – ${formatDate(publishAts[publishAts.length - 1])}`;

  return (
    <>
      {/** Above the batch, not inside it: at `stopped` the gate is the reason the batch looks the
       *   way it does, so it has to be readable before the progress bar rather than after it. */}
      {error && <StaleWarning error={error} onRetry={() => void load()} />}

      <BudgetNotice budget={batch.budget} />

      {/**
       * THE BATCH, AS A STATUS BAR RATHER THAN A CARD.
       *
       * It was a bordered panel with a shadow — the same treatment as a draft card — carrying an id,
       * a slot count, a settings version and a progress bar. So the container of the work looked
       * like a piece of the work, and the heaviest visual element on the screen was metadata.
       *
       * Now it is a bar: the name, the state, and the count as a thin rule underneath. The run id
       * and settings version move behind the count, because they are provenance an engineer asks
       * for occasionally rather than something an operator reads every morning.
       */}
      {/**
       * THE BAND ACROSS THE TOP: WHAT THIS BATCH IS, AND THE FOUR FIGURES A MORNING TURNS ON.
       *
       * It emptied out when the agent's own sentence and the run id moved down into the section
       * they are about, leaving a title and a count sitting in a lot of space. Rather than pad it,
       * it now carries the things an operator would otherwise go and look up: how far the batch has
       * got, how many decisions are queued behind it, WHICH WEEK it is publishing into — the
       * question that made "drafting next week" and a calendar labelled "current week" read as a
       * contradiction — and what it has cost against the cap. All four are read off `batch`; none
       * is written independently of something else on the page.
       *
       * Full bleed, square corners, its own ground. It used to be plain page with a rule under it,
       * so the heaviest thing on the screen was a horizontal line. A band needs no rule: the change
       * of ground is the separation.
       */}
      <section className="hero">
        <div className="hero-left">
          <p className="hero-eyebrow">
            {batch.running ? (
              <>
                <i className="pulse" aria-hidden /> Running now
              </>
            ) : (
              'Complete'
            )}
          </p>
          <h2 className="hero-title">Wednesday drafting batch</h2>
        </div>

        <dl className="hero-stats">
          <div className="hstat">
            <dt>Drafted</dt>
            <dd>
              {batch.drafted}
              <span className="hstat-of">/ {batch.total}</span>
            </dd>
            <span className="hero-track" aria-hidden>
              <i
                style={{ width: `${batch.total === 0 ? 0 : (batch.drafted / batch.total) * 100}%` }}
              />
            </span>
          </div>
          <div className="hstat">
            <dt>Needs you</dt>
            <dd className={waiting.length > 0 ? 'is-attend' : undefined}>{waiting.length}</dd>
          </div>
          <div className="hstat">
            <dt>Publishing</dt>
            <dd className="hstat-sm">{publishingWeek ?? 'not scheduled yet'}</dd>
          </div>
          <div className="hstat">
            <dt>Spent this month</dt>
            <dd className="hstat-sm">
              ${batch.budget.spent.toFixed(2)}
              <span className="hstat-of">of ${batch.budget.cap.toFixed(0)}</span>
            </dd>
          </div>
        </dl>
      </section>

      <div className="console-cols">
        {/**
         * THE AGENT'S OWN SPACE.
         *
         * This was a heading reading "Agent activity" with cards underneath, and the agent itself —
         * the GA mark — was a badge up in the page header next to a sentence, two sections away
         * from the work the sentence was about. Nothing on the screen said the cards belonged to
         * anybody.
         *
         * It is now built like a message. The mark sits top left the way an avatar does, the
         * sentence beside it is the agent saying what it is doing, and the cards below are what it
         * is saying — all of it on its own ground so the boundary of the agent's space is visible.
         * The run id and settings version moved down here too: they are provenance FOR THIS, and in
         * the page header they were provenance for nothing in particular.
         *
         * The sentence is composed from `drafting`, `batch.total` and `waiting`, so it cannot drift
         * from the cards underneath it. When nothing is in flight it says so, and the panel below
         * changes with it.
         */}
        <section className="agent-env">
          <header className="env-head">
            <span className="agent-avatar" aria-hidden>
              GA
            </span>
            <div className="env-say">
              <h2 className="env-said">
                {drafting.length > 0
                  ? `Growth agent is drafting ${drafting.length} of next week's ${batch.total} posts`
                  : 'Nothing being drafted right now'}
              </h2>
              <p className="env-sub">
                {drafting.length > 0
                  ? `Working since ${formatTime(batch.parent.started_at)}. Each post is researched, written, scored and checked before it reaches you.`
                  : waiting.length > 0
                    ? `Finished next week's ${batch.total} posts. ${waiting.length === 1 ? '1 needs' : `${waiting.length} need`} a decision from you.`
                    : `Finished next week's ${batch.total} posts. Nothing left for you to decide.`}
              </p>
            </div>
            <p className="env-meta">
              <span className="mono">{batch.parent.id}</span>
              <span className="mono">settings {settings.current_version_id}</span>
            </p>
          </header>

          {/* One drafting child gets the full measure; two or more pair up, because four cards
              stacked one under another is a page you have to scroll to see the batch at all. */}
          <div className={drafting.length > 1 ? 'live-grid' : 'stack'}>
            {drafting.length > 0 &&
              drafting.map((c) => (
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

            {/* Not an empty box, and no longer repeating the headline above it. When nothing is
                drafting the agent is not idle — it is holding approved posts until their slot time
                — and that is a record, not a caption. */}
            {drafting.length === 0 && (
              <div className="idle">
                {batch.upNext.length === 0 ? (
                  <p className="idle-head">Everything approved has gone out. Next batch Wednesday 06:00.</p>
                ) : (
                  <>
                    {/* Scheduled, not waiting. These are decided — approved and given a slot — and
                        are simply being held until their time. "Waiting" is the queue's word for
                        waiting on a person, and nothing here is waiting on anyone. */}
                    <p className="idle-head">
                      {batch.upNext.length} approved {batch.upNext.length === 1 ? 'post is' : 'posts are'} scheduled.
                    </p>
                    <ul className="idle-list">
                      {batch.upNext.map((u) => (
                        <li key={u.run.id}>
                          <ChannelMark channel={u.post.channel} size={14} />
                          <span className="idle-angle">{u.slot?.angle ?? 'Scheduled post'}</span>
                          <span className="idle-when">{formatDateTime(u.post.scheduled_at)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="console-work">
          <h2 className="sec col-head">
            Waiting on you <span className="sec-n">{waiting.length}</span>
          </h2>
          {waiting.length > 0 && (
            <>
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
 * ONLY WHERE THERE IS NO HERO.
 *
 * The loaded console used to open with "Console" and a narrator sentence, and then immediately
 * with "Wednesday drafting batch" at hero size — two headings, one above the other, competing to
 * be the name of the screen. The hero is the better one: it names the actual thing and carries its
 * state and its count. So the page title now renders only in the states that have no hero to name
 * them — loading, load failure, and the no-batch-yet empty state — where something has to say what
 * screen you are on. The narrator line moved into the hero, where the numbers it recites live.
 */
function PageHead() {
  return (
    <header className="page-head">
      <h1 className="page-title">Console</h1>
    </header>
  );
}

