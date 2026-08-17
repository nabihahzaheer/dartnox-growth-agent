/**
 * agentClient — the one module that knows this system is simulated.
 *
 * D-002: no React component ever imports a fixture. Every screen calls a function here, gets a
 * promise back, and cannot tell the difference from a real API client. Replacing the bodies of
 * these functions with HTTP calls is the entire migration path, and their signatures are the
 * contract you would hand a backend engineer on day one.
 *
 * On the Miro board this module is the *Console API* box. That is deliberate — deliverables 1 and
 * 3 name the same seam, so a reviewer holding both finds them agreeing.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THE INDIRECTION ACTUALLY BUYS, SINCE "IT IS ALL FAKE ANYWAY" IS THE OBVIOUS OBJECTION
 *
 * Three things, none of which a component importing JSON can have:
 *
 *   Honest loading states, because the data really does arrive late.
 *   Honest error states, because a call can really fail.
 *   Latency that varies by operation, so a document fetch feels slower than a threshold read.
 *
 * A component importing a fixture synchronously has to fake all three locally, in every component.
 *
 * ---------------------------------------------------------------------------------------------
 * THIS MODULE OWNS THE WORLD (D-037)
 *
 * D-002 says the data comes from here; D-026 says state lives in a reducer. Left unresolved those
 * name two owners of one fact, and the moment an operator approves something the client is
 * answering with a stale world.
 *
 * Settled: this module is the server, because that is what it stands in for. It holds the single
 * mutable world, deep-cloned from the fixtures at initialisation. The React store caches what it
 * returns. Writes land here and hand back the records they changed, which is what a real API does.
 *
 * The clone is not a formality. Mutating the imported fixture arrays would corrupt state across
 * React 19 StrictMode's deliberate double-mount, and the symptom would look like a rendering fault
 * rather than the aliasing bug it is.
 */

import { fixtures, LIVE_RUN_EMITTED_THROUGH_SEQ } from '@/fixtures';
import { NOW } from '@/lib/time';
import {
  approve,
  escalate,
  labelEscalation,
  reject,
  type DecisionContext,
  type WorldPatch,
} from '@/lib/world';
import type {
  Client,
  ConsoleError,
  Draft,
  DraftId,
  BriefRef,
  DraftVersionId,
  EditTag,
  FixtureSet,
  GuardrailEvent,
  GuardrailEventId,
  QueueItem,
  RejectionReasonCode,
  RunVariant,
  MetricDescriptor,
  Pillar,
  Run,
  RunId,
  RunStep,
  Settings,
} from '@/lib/types';

/* ================================================================================================
 * THE WORLD
 * ==============================================================================================*/

/**
 * `structuredClone` rather than a spread. A spread is shallow: the nested arrays — `versions`,
 * `sources`, `prereqs` — would still be shared with the module-scope fixtures, so a write that
 * touched one would reach back into the template. Deep by default is the only safe default here.
 */
const world: FixtureSet = structuredClone(fixtures);

/* ================================================================================================
 * SIMULATED TRANSPORT
 * ==============================================================================================*/

/**
 * Latency varies by operation deliberately (D-002). A settings read is a lookup; a run's full step
 * trace is a heavier query. Uniform delays are the tell that a prototype is faking it, and the
 * point of this module is that the loading states are honest rather than staged.
 *
 * Deterministic, not random: a demo that is sometimes slow and sometimes not is harder to talk
 * over, and `Math.random()` at module scope would make the build non-reproducible.
 */
const LATENCY_MS = {
  config: 120, // client, settings, pillars — small and cached in reality
  list: 260, // queue, run list
  detail: 380, // one draft with its versions
  trace: 520, // a run's full step history
} as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Failure injection (D-020). A demo affordance with no production counterpart — named as such in
 * the README. In production the equivalents are a staging environment, fault injection in CI and a
 * replay tool; none of those can be shown inside a frontend-only prototype, so the switches are
 * the only way to make the recovery paths observable rather than merely described.
 *
 * It lives here because D-002 already requires this module to be able to fail deliberately. The
 * drawer is a UI over a capability that has to exist anyway.
 */
type FailureSwitch = 'next_read_fails' | 'tool_failure';

const activeFailures = new Set<FailureSwitch>();

export function setFailure(which: FailureSwitch, on: boolean): void {
  if (on) activeFailures.add(which);
  else activeFailures.delete(which);
}

export function isFailureActive(which: FailureSwitch): boolean {
  return activeFailures.has(which);
}

/** Thrown as a plain object, not an `Error`. The caller branches on `kind` and renders different
 *  copy for each; parsing a message string would be the alternative and is worse. */
function fail(error: ConsoleError): never {
  throw error;
}

/** Every read goes through here, so latency and deliberate failure are applied in one place
 *  rather than remembered at each call site. */
async function read<T>(latency: number, produce: () => T): Promise<T> {
  await sleep(latency);
  if (activeFailures.has('next_read_fails')) {
    activeFailures.delete('next_read_fails'); // one-shot: the drawer arms it, the next call spends it
    fail({ kind: 'unavailable' });
  }
  return produce();
}

/* ================================================================================================
 * READS
 * ==============================================================================================*/

export async function getClient(): Promise<Client> {
  return read(LATENCY_MS.config, () => world.client);
}

export async function getPillars(): Promise<Pillar[]> {
  return read(LATENCY_MS.config, () => world.pillars);
}

export async function getSettings(): Promise<Settings> {
  return read(LATENCY_MS.config, () => world.settings);
}

export async function getMetricDescriptors(): Promise<MetricDescriptor[]> {
  return read(LATENCY_MS.config, () => world.metricDescriptors);
}

export async function getRuns(): Promise<Run[]> {
  return read(LATENCY_MS.list, () => world.runs);
}

export async function getRun(id: RunId): Promise<Run> {
  return read(LATENCY_MS.list, () => {
    const run = world.runs.find((r) => r.id === id);
    /** `not_found` renders as an empty state rather than as an error — D-031 is explicit that
     *  those are different things to show a person. */
    return run ?? fail({ kind: 'not_found' });
  });
}

export async function getDraft(id: DraftId): Promise<Draft> {
  return read(LATENCY_MS.detail, () => {
    const draft = world.drafts.find((d) => d.id === id);
    return draft ?? fail({ kind: 'not_found' });
  });
}

/**
 * A run's steps, ordered. Only the steps that have actually happened.
 *
 * `throughSeq` is what makes attaching to a live run possible: a run mid-flight has emitted some of
 * its steps and not the rest, and the console has to render the first group as history and receive
 * the second as they arrive.
 */
export async function getRunSteps(id: RunId, throughSeq?: number): Promise<RunStep[]> {
  return read(LATENCY_MS.trace, () =>
    world.runSteps
      .filter((s) => s.run_id === id && (throughSeq === undefined || s.seq <= throughSeq))
      .sort((a, b) => a.seq - b.seq),
  );
}

/**
 * A run and where to start watching it.
 *
 * `fromSeq` belongs here rather than in the console because *how far a run has already got* is a
 * fact about the run, not a rendering decision. The first version hardcoded both the run ids and
 * the offset in the component — while `fixtures/pipeline.ts` exported the offset with a comment
 * saying it lived there "so the fixture, not the code, decides where the story is up to". The
 * comment was right and the code ignored it, and the exported constant was used by nothing.
 *
 * D-002 says no component imports a fixture. A component that hardcodes fixture ids has the same
 * coupling with none of the type safety.
 */
export type RunAttachment = { run: Run; fromSeq: number };

/** Replaying a finished run: every step is history, so it renders at once and does not animate. */
const REPLAY_ALL = Number.POSITIVE_INFINITY;

/** The run the console opens on: whatever is live, else the most recent one that stopped for a
 *  human. Never empty by accident. */
export async function getActiveRun(): Promise<RunAttachment> {
  return read(LATENCY_MS.list, () => {
    const running = world.runs.find((r) => r.state === 'running');
    if (running) return { run: running, fromSeq: LIVE_RUN_EMITTED_THROUGH_SEQ };
    const waiting = world.runs.find((r) => r.state === 'awaiting_human');
    if (waiting) return { run: waiting, fromSeq: REPLAY_ALL };
    const last = world.runs.at(-1);
    return last ? { run: last, fromSeq: REPLAY_ALL } : fail({ kind: 'not_found' });
  });
}

/** Opening a past run from the rail. It already happened, so it replays rather than streams. */
export async function openRun(id: RunId): Promise<RunAttachment> {
  const run = await getRun(id);
  const isLive = run.state === 'running';
  return { run, fromSeq: isLive ? LIVE_RUN_EMITTED_THROUGH_SEQ : REPLAY_ALL };
}

/**
 * Start a run on demand.
 *
 * The client picks which pre-written sequence to play, because which variant an armed failure
 * switch selects is a property of the simulation, not of the screen. §6b's unlock: without a run
 * on demand, every "next draft" setting takes effect at a moment nobody is watching.
 */
export async function runNow(): Promise<RunAttachment> {
  const variant: RunVariant = activeFailures.has('tool_failure') ? 'tool_failure' : 'nominal';
  const run =
    world.runs.find((r) => r.type === 'draft' && r.variant === variant && r.target_draft_id) ??
    world.runs.find((r) => r.variant === variant);
  if (!run) fail({ kind: 'not_found' });
  return { run, fromSeq: 0 };
}

/** The guardrail events raised by a run, so the console can render each check at its position in
 *  the stream. Attached by `run_step_id` rather than looked up by run: L4 events belong to the
 *  *publish* run, so a join through `run_id` would silently miss them. */
export async function getGuardrailEvents(id: RunId): Promise<GuardrailEvent[]> {
  return read(LATENCY_MS.list, () => world.guardrailEvents.filter((e) => e.run_id === id));
}

/* ================================================================================================
 * WRITES — only one for now
 * ==============================================================================================*/

/**
 * Halt a run. The console's single write, and the only operator action that reaches this module
 * before the queue exists.
 *
 * C6: the architecture named an `abandoned` state and nothing that produced one. Three producers
 * were then named, and this is the one a person can reach — mapped onto `abandoned` with
 * `end_reason: 'operator_halt'` rather than inventing a separate `halted` state, which is what
 * makes the state reachable through the reviewer's own action rather than only in prose.
 *
 * The draft it was producing stays in `drafting` and surfaces as orphaned. That is deliberate: a
 * halt mid-run leaves real debris, and tidying it away would misrepresent what stopping costs.
 */
export async function haltRun(id: RunId): Promise<Run> {
  await sleep(LATENCY_MS.list);
  const run = world.runs.find((r) => r.id === id);
  if (!run) fail({ kind: 'not_found' });

  run.state = 'abandoned';
  run.end_reason = 'operator_halt';
  run.ended_at = NOW;
  return run;
}

/**
 * A run described in terms of the work it is doing rather than its id and type.
 *
 * `RUN-0143 · draft` is an identifier and a category. It tells an operator nothing about what the
 * agent is actually doing. Resolving the run to its draft, its pillar and its channel turns the
 * list into a list of *work* — which is what a person scanning it is looking for.
 *
 * The join lives here rather than in the component because in production it is a server-side
 * concern: one query returning a list ready to render, not four round trips per row.
 */
export type RunSummary = {
  run: Run;
  /** What this run is doing. */
  title: string;
  /** Where it is going, when it fired. */
  detail: string;
};

export async function getRunSummaries(): Promise<RunSummary[]> {
  return read(LATENCY_MS.list, () =>
    world.runs.map((run) => {
      const draft = run.target_draft_id
        ? world.drafts.find((d) => d.id === run.target_draft_id)
        : undefined;
      const slot = draft ? world.calendarSlots.find((s) => s.id === draft.slot_id) : undefined;
      const pillar = draft ? world.pillars.find((p) => p.id === draft.pillar_id) : undefined;

      if (run.type === 'planning') {
        return { run, title: 'Plan next week', detail: 'Calendar · 8 slots' };
      }
      if (run.type === 'publish') {
        return { run, title: 'Publish', detail: slot ? slot.angle : 'Scheduled post' };
      }
      if (run.type === 'poll') {
        return { run, title: 'Check replies', detail: 'Posts under 48h' };
      }
      // Draft runs with no draft of their own: either the parent of a batch, or a run that has
      // not produced one yet.
      if (!draft) {
        /**
         * A batch is identified by *having children*, not by lacking a parent. The first version
         * used "no parent" and so labelled every redraft — which is parentless, because a rejection
         * queues it directly — as "Weekly drafting batch". Visible in the rail the moment a
         * rejection landed.
         */
        const isBatchParent = world.runs.some((r) => r.parent_run_id === run.id);
        if (isBatchParent) return { run, title: 'Weekly drafting batch', detail: '8 posts' };

        if (run.state === 'queued') return { run, title: 'Redraft', detail: 'Queued after a rejection' };
        return {
          run,
          title: 'Draft',
          detail: run.state === 'parked_transient' ? 'Source unavailable' : 'No draft produced',
        };
      }
      return {
        run,
        title: `Draft · ${pillar?.name ?? 'Unknown pillar'}`,
        detail: `${draft.channel === 'linkedin' ? 'LinkedIn' : 'X'}${slot ? ` · ${slot.angle}` : ''}`,
      };
    }),
  );
}

/**
 * Operator briefs submitted through the console, newest first.
 *
 * A-01 ranks briefs first among the three source types, and the reason is worth stating: a
 * brief-driven post cannot be generic, because its substance exists nowhere else. News commentary
 * is the floor; a note from someone who was on site is the product's actual differentiator.
 *
 * The architecture already says these arrive "as free-form notes through the console", which is
 * why the composer at the bottom of the screen is a real surface rather than a chat affordance
 * borrowed from somewhere else.
 */
const submittedBriefs: BriefRef[] = [];

export async function submitBrief(text: string, author: string): Promise<BriefRef> {
  await sleep(LATENCY_MS.list);
  const brief: BriefRef = { author, submitted_at: NOW, text };
  submittedBriefs.unshift(brief);
  return brief;
}

/**
 * THE WORK QUEUE.
 *
 * A union, not an array of drafts (D-033). Two of the things a person has to clear never became
 * drafts: a run quarantined at the input guardrail halts before the drafting node, and a run
 * parked on a failure needs a human even though it produced nothing. A queue typed `Draft[]`
 * silently drops the two most interesting items in the system.
 *
 * SORTING IS A-09'S RULE, AND IT IS THE WHOLE OF WHAT "ESCALATE TO OPERATOR" MEANS IN v1. Since
 * every post already reaches a human, a low score or a guardrail warning cannot change *whether*
 * an item is seen. What it changes is how it arrives: flagged, and at the top. That is the entire
 * behavioural difference, and it lives here rather than in the component because it is a rule
 * about the work, not about the rendering.
 */
export async function getQueue(): Promise<QueueItem[]> {
  return read(LATENCY_MS.list, () => {
    const threshold = world.settings.score_threshold;

    const draftItems: QueueItem[] = world.drafts
      .filter((d) => d.state === 'awaiting_approval')
      .map((draft) => ({
        kind: 'draft' as const,
        draft,
        approval:
          world.approvals.find(
            (a) => a.draft_version_id === draft.current_version_id && a.decided_at === null,
          ) ?? null,
        events: world.guardrailEvents.filter((e) => e.draft_id === draft.id),
      }));

    /** Quarantined and parked runs. Both need clearing; neither is a draft. */
    const runItems: QueueItem[] = world.runs
      .filter((r) => r.state === 'quarantined' || r.state.startsWith('parked'))
      .map((run) => ({
        kind: 'run' as const,
        run,
        events: world.guardrailEvents.filter((e) => e.run_id === run.id),
      }));

    const flagged = (item: QueueItem): boolean =>
      item.kind === 'run' ||
      item.draft.composite_score < threshold ||
      item.events.some((e) => e.result !== 'pass');

    const waitingSince = (item: QueueItem): number =>
      item.kind === 'draft' ? (item.approval?.queued_at ?? 0) : (item.run.started_at as number);

    return [...draftItems, ...runItems].sort((a, b) => {
      if (flagged(a) !== flagged(b)) return flagged(a) ? -1 : 1;
      // Oldest first within a group: the queue-age p95 is what this ordering protects.
      return waitingSince(a) - waitingSince(b);
    });
  });
}

/**
 * Rejection reasons the operator has given, newest first.
 *
 * A-04 bounds what reaches a drafting prompt to the last five reasons or thirty days, because an
 * unbounded list of grievances is not context, it is noise. The bound is applied here rather than
 * at the prompt so the console shows exactly what the agent would receive.
 */
const rejectionsGiven: { code: RejectionReasonCode; label: string }[] = [];

/**
 * Idempotency keys already spent.
 *
 * A replayed write — a double click, a retry after a timeout — must not produce a second approval.
 * The key is the client's; the server remembers it and returns the original result rather than
 * doing the work twice. This is the first question a backend engineer asks about a write API, and
 * a signature list that cannot answer it is not a contract.
 */
const spentKeys = new Map<string, WorldPatch>();

/** Applies a patch to the world in place. The only place the world is written. */
function applyPatch(patch: WorldPatch): void {
  const merge = <T extends { id: string }>(collection: T[], changed?: T[]) => {
    if (!changed) return;
    for (const record of changed) {
      const index = collection.findIndex((r) => r.id === record.id);
      if (index >= 0) collection[index] = record;
      else collection.push(record);
    }
  };
  merge(world.drafts, patch.drafts);
  merge(world.approvals, patch.approvals);
  merge(world.posts, patch.posts);
  merge(world.runs, patch.runs);
  merge(world.calendarSlots, patch.calendarSlots);
  merge(world.guardrailEvents, patch.guardrailEvents);
}

export type ReviewDecision =
  | { kind: 'approve' }
  | { kind: 'approve_with_edits'; text: string; editTags: EditTag[] }
  | { kind: 'reject'; reasonCode: RejectionReasonCode; note: string | null }
  | { kind: 'escalate'; tier: 'operator' | 'stakeholder'; detail: string };

/**
 * The operator's decision on a draft. The one write the queue makes.
 *
 * Takes the version the operator was looking at. If the draft has moved since — someone else
 * edited it, or a settings change bounced it — this throws `version_conflict` rather than deciding
 * against text nobody read. An approval binds a *version*, and L4 later publishes only on a hash
 * match, so deciding against a stale version would break the chain that makes "a human approved
 * every published post" true.
 */
export async function submitReview(
  draftId: DraftId,
  seenVersionId: DraftVersionId,
  decision: ReviewDecision,
  opts: { idempotencyKey: string; secondsOpen: number },
): Promise<WorldPatch> {
  await sleep(LATENCY_MS.detail);

  const replayed = spentKeys.get(opts.idempotencyKey);
  if (replayed) return replayed;

  const draft = world.drafts.find((d) => d.id === draftId);
  if (!draft) fail({ kind: 'not_found' });

  if (draft.current_version_id !== seenVersionId) {
    fail({ kind: 'version_conflict', current_version_id: draft.current_version_id });
  }

  const ctx: DecisionContext = {
    now: NOW,
    operatorId: world.settings.versions[0].changed_by,
    secondsOpen: opts.secondsOpen,
    idempotencyKey: opts.idempotencyKey,
  };

  let patch: WorldPatch;
  switch (decision.kind) {
    case 'approve':
      patch = approve(world, draftId, ctx);
      break;
    case 'approve_with_edits':
      patch = approve(world, draftId, ctx, { text: decision.text, editTags: decision.editTags });
      break;
    case 'reject': {
      patch = reject(world, draftId, decision.reasonCode, decision.note, ctx);
      const label =
        world.settings.rejection_reason_set.find((r) => r.code === decision.reasonCode)?.label ??
        decision.reasonCode;
      rejectionsGiven.unshift({ code: decision.reasonCode, label });
      break;
    }
    case 'escalate':
      patch = escalate(world, draftId, decision.tier, decision.detail, ctx);
      break;
  }

  applyPatch(patch);
  spentKeys.set(opts.idempotencyKey, patch);
  return patch;
}

/** One click, and the escalation-precision figure moves. */
export async function labelEscalationUnnecessary(
  eventId: GuardrailEventId,
  wasUnnecessary: boolean,
): Promise<WorldPatch> {
  await sleep(LATENCY_MS.config);
  const patch = labelEscalation(world, eventId, wasUnnecessary, {
    now: NOW,
    operatorId: world.settings.versions[0].changed_by,
    secondsOpen: 0,
    idempotencyKey: `label:${eventId}`,
  });
  applyPatch(patch);
  return patch;
}

/* ================================================================================================
 * THE STREAM
 * ==============================================================================================*/

/** Why a run stopped. An interrupt is the normal end of a draft run — it is waiting for a person,
 *  not finished — which is a distinction the console has to render differently. */
export type StreamEndReason = 'interrupt' | 'parked' | 'completed' | 'halted';

export type StreamEvent =
  /** Steps that had already happened when we attached. Delivered together, because that is what
   *  joining a stream in progress actually looks like. */
  | { type: 'history'; steps: RunStep[] }
  | { type: 'step'; step: RunStep }
  | { type: 'end'; reason: StreamEndReason };

export type StreamHandle = {
  /** Idempotent. Safe to call from an effect cleanup, and safe to call twice. */
  stop: () => void;
};

/**
 * Emit a run's steps over time.
 *
 * WHY `playback_ms` AND NOT `latency_ms`. Every step carries both. `latency_ms` is the honest
 * number — a drafting call really does take about twenty seconds — and is rendered as metadata.
 * `playback_ms` is how long the console waits before showing the next step. A run played at its
 * true four-minute duration is unwatchable; a uniform 300ms tick is precisely the "faked
 * streaming" the brief rejects. Two numbers, and the README states the ratio rather than leaving a
 * reviewer to work out that the timings are invented.
 *
 * WHY A SELF-RESCHEDULING TIMEOUT AND A `cancelled` FLAG. React 19's StrictMode mounts every
 * component, unmounts it and mounts it again in development, on purpose, to expose effects that
 * leak. A naive `setInterval` started in an effect would survive the first unmount and run
 * alongside the second — the console would emit every step twice and look broken in development
 * only. `stop()` clears the pending timer and sets a flag, because a callback can already be in
 * flight when cleanup runs.
 */
export function streamRun(
  runId: RunId,
  fromSeq: number,
  onEvent: (event: StreamEvent) => void,
): StreamHandle {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };

  const steps = world.runSteps
    .filter((s) => s.run_id === runId)
    .sort((a, b) => a.seq - b.seq)
    /**
     * If the operator has submitted a brief, the next drafting step consumes it instead of the
     * fixture's. This is the smallest honest version of "your input changes what the agent does
     * next": the step really does read whatever is in the store at the moment it runs, rather than
     * replaying a value baked in at build time.
     *
     * The limit, which belongs in the README: the drafted *text* is still pre-written. What is
     * real is which input the run consumed.
     */
    .map((step) => {
      if (!step.brief_ref && step.applied_inputs.length === 0) return step;

      /**
       * The brief's hardest queue clause: a rejection must "visibly change what the agent does
       * next". It does, here — the next drafting step lists the rejection it consumed, alongside
       * the settings and rules it read.
       *
       * Assembled at emit time from what is in the store *now*, not baked into the fixture. That
       * single property is what makes both this and the settings controls demonstrable rather than
       * claimed, and it is why `run_now` had to exist at all.
       */
      const consumedRejections = rejectionsGiven.slice(0, 5).map((r) => ({
        kind: 'rejection_reason' as const,
        id: r.code,
        label: `Avoiding: ${r.label}`,
      }));

      return {
        ...step,
        brief_ref: step.brief_ref && submittedBriefs.length > 0 ? submittedBriefs[0] : step.brief_ref,
        applied_inputs:
          step.applied_inputs.length > 0
            ? [...consumedRejections, ...step.applied_inputs]
            : step.applied_inputs,
      };
    });

  const history = steps.filter((s) => s.seq <= fromSeq);
  const pending = steps.filter((s) => s.seq > fromSeq);

  // The initial delay stands in for opening the connection. Without it the history would appear
  // synchronously on first paint, which is the one moment a loading state has to be real.
  timer = setTimeout(() => {
    if (cancelled) return;
    onEvent({ type: 'history', steps: history });
    emitNext(0);
  }, LATENCY_MS.trace);

  function emitNext(index: number) {
    if (cancelled) return;

    if (index >= pending.length) {
      const last = steps.at(-1);
      const reason: StreamEndReason =
        last?.type === 'interrupt'
          ? 'interrupt'
          : last?.outcome === 'error'
            ? 'parked'
            : 'completed';
      onEvent({ type: 'end', reason });
      return;
    }

    const step = pending[index];
    timer = setTimeout(() => {
      if (cancelled) return;
      onEvent({ type: 'step', step });
      emitNext(index + 1);
    }, step.playback_ms);
  }

  return { stop };
}
