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
import { buildWeek, defaultWeekIndex, describeRun, type Week } from '@/lib/week';
import { budgetPosture, type BudgetPosture } from '@/lib/budget';
import {
  addBannedClaim,
  approve,
  countBannedClaimMatches,
  escalate,
  labelEscalation,
  reject,
  settingRefusal,
  toggleGuardrailRule,
  updateSetting,
  type DecisionContext,
  type SettingUpdate,
  type WorldPatch,
} from '@/lib/world';
import type {
  Approval,
  BriefRef,
  CalendarSlot,
  Client,
  ConsoleError,
  Draft,
  DraftId,
  DraftVersion,
  DraftVersionId,
  EditTag,
  FixtureSet,
  GuardrailEvent,
  GuardrailEventId,
  GuardrailRule,
  GuardrailRuleId,
  MetricDescriptor,
  Pillar,
  QueueItem,
  ReflectionRule,
  RejectionReasonCode,
  Run,
  RunId,
  RunStep,
  RunStepId,
  RunVariant,
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
/**
 * `next_read_fails` breaks the transport. The other four select which pre-written run `runNow()`
 * plays, and each maps onto a `RunVariant` of the same name.
 */
type FailureSwitch =
  | 'next_read_fails'
  | 'tool_failure'
  | 'poisoned_source'
  | 'hostile_reply'
  | 'auth_revoked';

/** The four that choose a run, in the order `runNow()` prefers them when more than one is armed.
 *  Ordered rather than arbitrary so two armed switches give a predictable demo rather than a
 *  race decided by `Set` insertion order. */
const VARIANT_SWITCHES = [
  'tool_failure',
  'poisoned_source',
  'hostile_reply',
  'auth_revoked',
] as const satisfies readonly FailureSwitch[];

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

/**
 * The whole record set, for the dashboard.
 *
 * Every number on that screen is a pure function over these collections (R1) — there is no
 * aggregate endpoint to call, deliberately, because a stats response would destroy the property
 * the screen is graded on: that approving something in the queue moves the numbers.
 *
 * In production this is the one read that would NOT look like this. Aggregation belongs on the
 * server, cached, and the console would fetch computed figures. The seam is the same either way:
 * this function's signature changes and nothing else does.
 */
export async function getWorld(): Promise<FixtureSet> {
  return read(LATENCY_MS.trace, () => world);
}

/**
 * Everything the settings screen renders, in one call.
 *
 * Same reasoning as `getDraftDetail`: this is a join across four collections, and doing it in the
 * component would mean four awaits and four loading states for one screen. In production it is one
 * endpoint returning one document.
 *
 * `awaitingDecision` and `scheduledCount` are here rather than fetched separately because they are
 * what make two controls honest. The threshold slider has to say how many waiting drafts it would
 * flag *before* it is committed, and the banned-phrase field has to say how many scheduled posts a
 * phrase would catch. Both are previews of a consequence, and a control that changes something
 * invisible is the failure mode this screen is most prone to.
 */
export type SettingsScreen = {
  settings: Settings;
  guardrailRules: GuardrailRule[];
  reflectionRules: ReflectionRule[];
  /** Drafts currently waiting on a person, with their scores — the population the threshold
   *  re-sorts and re-flags. */
  awaitingDecision: Draft[];
  /** How many posts are scheduled, so "appears in 1 of 2 scheduled posts" has a denominator. */
  scheduledCount: number;
  /** Current spend against the cap, so the cap control can show what moving it would do before it
   *  is moved — the same discipline as the threshold and the banned-phrase field. */
  budget: BudgetPosture;
  /** The versions each rule's suggestion was built from, resolved. Empty for a rule whose evidence
   *  predates the retained history window, which is a different thing from a rule with none. */
  evidence: Record<string, DraftVersion[]>;
};

export async function getSettingsScreen(): Promise<SettingsScreen> {
  return read(LATENCY_MS.detail, () => {
    const versionsById = new Map(
      world.drafts.flatMap((d) => d.versions.map((v) => [v.id as string, v] as const)),
    );

    const evidence: Record<string, DraftVersion[]> = {};
    for (const rule of world.reflectionRules) {
      evidence[rule.id] = rule.evidence_ids
        .map((id) => versionsById.get(id))
        .filter((v): v is DraftVersion => v !== undefined);
    }

    return {
      settings: world.settings,
      guardrailRules: world.guardrailRules,
      reflectionRules: world.reflectionRules,
      awaitingDecision: world.drafts.filter((d) => d.state === 'awaiting_approval'),
      scheduledCount: world.posts.filter((p) => p.state === 'scheduled').length,
      budget: budgetPosture(world),
      evidence,
    };
  });
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
 * Everything the detail view opens.
 *
 * The brief asks for "one item opened fully… including the agent's reasoning trace and history."
 * That is a join across five collections, and doing it in the component would mean five awaits and
 * five loading states for one screen. In production this is one endpoint returning one document,
 * so it is one call here.
 */
export type DraftDetail = {
  draft: Draft;
  /** The run that produced it, and its full trace. B1's Draft had no path to its run at all, which
   *  would have made this screen unbuildable — the single most load-bearing omission found while
   *  deriving the fixture set. */
  run: Run | null;
  steps: RunStep[];
  events: GuardrailEvent[];
  approval: Approval | null;
  slot: CalendarSlot | null;
  pillar: Pillar | null;
  /** The sibling treatment of the same angle on the other channel, if there is one. Variants are
   *  not versions: channel fit is scored per channel and an approval binds one version to one
   *  publication. */
  sibling: Draft | null;
  /** The bar the composite is judged against. Carried rather than fetched separately so the detail
   *  view can say "below the 0.85 bar" instead of printing a bare number and leaving the reader to
   *  work out whether it is good. */
  threshold: number;
};

export async function getDraftDetail(id: DraftId): Promise<DraftDetail> {
  return read(LATENCY_MS.detail, () => {
    const draft = world.drafts.find((d) => d.id === id);
    if (!draft) fail({ kind: 'not_found' });

    const run = world.runs.find((r) => r.id === draft.run_id) ?? null;
    return {
      draft,
      run,
      steps: world.runSteps.filter((s) => s.run_id === draft.run_id).sort((a, b) => a.seq - b.seq),
      events: world.guardrailEvents.filter((e) => e.draft_id === draft.id),
      approval:
        world.approvals.find((a) => a.draft_version_id === draft.current_version_id) ?? null,
      slot: world.calendarSlots.find((s) => s.id === draft.slot_id) ?? null,
      pillar: world.pillars.find((p) => p.id === draft.pillar_id) ?? null,
      sibling:
        draft.variant_group_id === null
          ? null
          : (world.drafts.find(
              (d) => d.variant_group_id === draft.variant_group_id && d.id !== draft.id,
            ) ?? null),
      threshold: world.settings.score_threshold,
    };
  });
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
  /**
   * The armed switch decides which pre-written sequence plays, and that decision lives here rather
   * than in the console because it is a property of the simulation and not of the screen.
   *
   * Three of the four variants are not draft runs — a poll and a publish among them — so the
   * lookup cannot filter on `type === 'draft'` the way it did when tool failure was the only
   * switch. It matches on the variant and falls back to nominal.
   */
  const armed = VARIANT_SWITCHES.find((s) => activeFailures.has(s));
  const variant: RunVariant = armed ?? 'nominal';

  const run =
    world.runs.find((r) => r.variant === variant && r.type === 'draft' && r.target_draft_id) ??
    world.runs.find((r) => r.variant === variant);
  if (!run) fail({ kind: 'not_found' });

  /** Failure runs replay from the top: their whole content is the sequence of steps that leads to
   *  the stop, so starting anywhere else would skip the argument. */
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

/**
 * THE WEEK — the read every screen frames itself with.
 *
 * `list` latency rather than `trace`: it is a join across slots, drafts, posts and runs, but all of
 * them are collections this module already holds. Treating it as a heavy query would put a
 * half-second skeleton on the rail of every screen, which is the opposite of what a persistent
 * frame should do.
 *
 * The projection itself is `lib/week.ts` and is pure. This function's whole job is to be the async
 * seam D-002 requires, so that a real backend attaches here without a component changing.
 */
export async function getWeek(index: number): Promise<Week> {
  return read(LATENCY_MS.list, () => buildWeek(world, index));
}

/**
 * The admission gate's current posture. `config` latency: it is two sums over collections already
 * in memory, and it renders in the rail's identity block on every screen — a skeleton there would
 * flash on every navigation for a value that is quiet most of the time.
 */
export async function getBudget(): Promise<BudgetPosture> {
  return read(LATENCY_MS.config, () => budgetPosture(world));
}

/** Which week to open on, decided from the data rather than from the calendar — see
 *  `defaultWeekIndex`. Synchronous because the rail needs it before its first fetch, and it is a
 *  read over the same world the next call will return. */
export function initialWeekIndex(): number {
  return defaultWeekIndex(world);
}

export async function getRunSummaries(): Promise<RunSummary[]> {
  return read(LATENCY_MS.list, () =>
    world.runs
      /**
       * A run with no steps opens onto an empty screen, which reads as broken.
       *
       * Three qualify: the Wednesday batch parent, which is a container whose children hold the
       * work, and the two queued publish runs, which have not executed yet. Listing them invites a
       * click that lands nowhere, and the batch parent in particular is the most tempting row in
       * the rail because it is the one that sounds like the whole week.
       *
       * The runs are not removed from the world — they are real records and the queue, the metrics
       * and `Run.parent_run_id` all still use them. This is a rendering decision about a list, and
       * it belongs here rather than in the component because "has anything happened yet" is a fact
       * about the run.
       */
      .filter((run) => world.runSteps.some((s) => s.run_id === run.id))
      /** The labelling itself moved to `lib/week.ts` when the rail stopped being a run list. One
       *  labeller, so the week's "about the week" group and this summary cannot describe the same
       *  run two different ways. */
      .map((run) => ({ run, ...describeRun(world, run) })),
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

    /**
     * Scheduled posts sent back by a settings change (D-043). Not drafts — `Draft` terminates at
     * `approved`, so the draft behind one of these is still `approved` and the draft arm above
     * correctly does not pick it up.
     *
     * A post with no pending approval is dropped rather than rendered: it would be an item with
     * nothing to decide against, and therefore no way out of the queue. That is a broken world
     * rather than a state, and showing it would be worse than not showing it.
     */
    const postItems: QueueItem[] = world.posts
      .filter((p) => p.state === 'invalidated')
      .flatMap((post) => {
        const draft = world.drafts.find((d) =>
          d.versions.some((v) => v.id === post.draft_version_id),
        );
        const approval = world.approvals.find(
          (a) => a.draft_version_id === post.draft_version_id && a.decided_at === null,
        );
        if (!draft || !approval) return [];
        return [
          {
            kind: 'post' as const,
            post,
            draft,
            approval,
            events: world.guardrailEvents.filter((e) => e.draft_id === draft.id),
          },
        ];
      });

    /**
     * THREE PRIORITIES, NOT TWO — and the new one goes to the top.
     *
     * An invalidated post is the operator's own prior decision being reversed by their own settings
     * change. It is the item most likely to be a surprise, and the only one where something already
     * approved is now scheduled to publish text the current rules forbid. Sorting it by "waiting
     * since" alongside everything else would bury the consequence of the change that produced it.
     *
     * The two existing groups are unchanged: flagged before unflagged, oldest first within each.
     */
    const priority = (item: QueueItem): number => {
      if (item.kind === 'post') return 0;
      if (item.kind === 'run') return 1;
      const flagged =
        item.draft.composite_score < threshold || item.events.some((e) => e.result !== 'pass');
      return flagged ? 1 : 2;
    };

    const waitingSince = (item: QueueItem): number => {
      if (item.kind === 'run') return item.run.started_at as number;
      if (item.kind === 'post') return item.approval.queued_at as number;
      return item.approval?.queued_at ?? 0;
    };

    return [...postItems, ...draftItems, ...runItems].sort((a, b) => {
      const byPriority = priority(a) - priority(b);
      if (byPriority !== 0) return byPriority;
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
/* ================================================================================================
 * CHANGE NOTIFICATION
 *
 * The rail renders the week on all five screens, so a decision taken on the queue has to reach a
 * component the queue does not own. Without this, approving a draft moved the queue and left the
 * rail still saying "Needs you" for the slot that had just been approved — two views of one fact,
 * disagreeing, on screen at the same time.
 *
 * Deliberately not Zustand or Context (D-022/D-038 rejected the store library, and there is no
 * shared provider yet). A `Set` of callbacks is nine lines, no dependency, and it is exactly what a
 * real client would expose so a cache could invalidate itself. Subscribers refetch through the same
 * async reads as everyone else, so nothing gets a privileged synchronous view of the world.
 * ==============================================================================================*/

const listeners = new Set<() => void>();

/** Returns its own unsubscribe, so an effect can hand it straight back to React. */
export function subscribeToWorld(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

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
  merge(world.guardrailRules, patch.guardrailRules);
  /** Settings is a singleton with no `id`, so it is assigned rather than merged. One line of
   *  special handling, and the alternative — inventing an id for a record there is exactly one of
   *  — would be worse. */
  if (patch.settings) world.settings = patch.settings;

  /** Announced here rather than at each write, because this is the one function every write already
   *  goes through. A per-call-site notify is the version that gets forgotten on the sixth write. */
  for (const listener of listeners) listener();
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

/* ================================================================================================
 * SETTINGS WRITES
 *
 * Three, and each is here rather than in a component for the same reason every other write is: the
 * transitions are pure functions in `lib/world.ts`, and this module is the only thing that applies
 * them to the world.
 *
 * THIS IS WHERE `forbidden` BECOMES REACHABLE. D-031 declares seven error kinds and argues that
 * they are seven because the copy on screen differs for each. Until now nothing threw `forbidden`,
 * so that argument was a claim the code did not keep — the taxonomy described a union the shipped
 * code could not produce, which is precisely the defect D-037 caught in an earlier design.
 * `updateSettings` throws it on a fixed key, which is what the kind was written for.
 * ==============================================================================================*/

/** The operator acting. One client per console (D-017), so this resolves to the same person every
 *  time — but the write records *who*, because the audit trail is per-change and not per-session. */
function operatorContext(idempotencyKey: string): DecisionContext {
  return {
    now: NOW,
    operatorId: world.settings.versions[0].changed_by,
    secondsOpen: 0,
    idempotencyKey,
  };
}

/**
 * Change one operator control.
 *
 * Throws `forbidden` with the reason on a control the architecture fixes — auto-approve, and the
 * three non-tunable rules. The reason travels with the error rather than being looked up again by
 * the screen: a disabled control that cannot say why reads as a bug, and the sentence explaining it
 * is a product decision, not a string constant.
 */
export async function updateSettings(update: SettingUpdate): Promise<WorldPatch> {
  await sleep(LATENCY_MS.config);

  const refusal = settingRefusal(world, update);
  if (refusal) fail({ kind: 'forbidden', reason: refusal });

  const patch = updateSetting(world, update, operatorContext(`setting:${update.kind}`));
  applyPatch(patch);
  return patch;
}

/**
 * Switch a guardrail rule on or off.
 *
 * Separate from `updateSettings` because a rule is not a settings field — it lives in its own
 * collection with its own `is_fixed`, and folding it into the settings union would have meant one
 * member per rule.
 */
export async function toggleGuardrail(
  ruleId: GuardrailRuleId,
  enabled: boolean,
): Promise<WorldPatch> {
  await sleep(LATENCY_MS.config);

  const rule = world.guardrailRules.find((r) => r.id === ruleId);
  if (!rule) fail({ kind: 'not_found' });
  if (rule.is_fixed) fail({ kind: 'forbidden', reason: rule.fixed_reason });

  const patch = toggleGuardrailRule(
    world,
    ruleId,
    enabled,
    operatorContext(`guardrail:${ruleId}:${enabled}`),
  );
  applyPatch(patch);
  return patch;
}

/**
 * Add a banned phrase, and re-validate everything already scheduled against it.
 *
 * The write returns what the sweep found rather than only the patch, because the sentence the
 * screen has to show is "scanned 2, returned 1" — and a caller counting the patch's `posts` array
 * could report the second number but not the first.
 *
 * Latency is the heavier `list` figure rather than `config`: in production this is a scan across
 * scheduled posts and a re-run of an L3 rule, not a field write. The operation feeling slower than
 * moving a slider is the honest rendering of what it does.
 */
export type BannedClaimResult = { scanned: number; invalidated: number; patch: WorldPatch };

export async function addBannedPhrase(phrase: string): Promise<BannedClaimResult> {
  await sleep(LATENCY_MS.list);

  const trimmed = phrase.trim();
  if (trimmed.length === 0) fail({ kind: 'not_found' });

  const already = world.settings.tone.banned_phrases.some(
    (p) => p.toLowerCase() === trimmed.toLowerCase(),
  );
  if (already) {
    fail({ kind: 'forbidden', reason: `"${trimmed}" is already on the banned list.` });
  }

  const sweep = addBannedClaim(world, trimmed, operatorContext(`banned:${trimmed}`));
  applyPatch(sweep.patch);
  return { scanned: sweep.scanned, invalidated: sweep.invalidated.length, patch: sweep.patch };
}

/**
 * How many scheduled posts a phrase would catch, without writing anything.
 *
 * Deliberately synchronous and outside the `read` wrapper. It runs on every keystroke, so a 120ms
 * delay and a one-shot failure switch would both be wrong: this is a local predicate over data the
 * screen already caused to be loaded, not a round trip. In production it would be the same
 * calculation against the posts the screen is already holding.
 */
export function previewBannedPhrase(phrase: string): number {
  return countBannedClaimMatches(world, phrase);
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
export type StreamEndReason =
  | 'interrupt'
  | 'parked'
  | 'quarantined'
  | 'completed'
  | 'halted';

export type StreamEvent =
  /** Steps that had already happened when we attached. Delivered together, because that is what
   *  joining a stream in progress actually looks like. */
  | { type: 'history'; steps: RunStep[] }
  /**
   * A step that has STARTED. It is not finished, and the console must not render it as though it
   * were — see `emitNext`.
   */
  | { type: 'step'; step: RunStep }
  /** That step finished. Carries the id rather than the step because nothing about the record
   *  changed; what changed is that it is over. */
  | { type: 'settled'; id: RunStepId }
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
/**
 * ◆ DEMO AFFORDANCE — no production counterpart. Named as such in the README.
 *
 * `RunStep.playback_ms` is the fixture's own compression of `latency_ms`: a run whose steps really
 * take four minutes is unwatchable, and a uniform 300ms tick is the faked streaming the brief
 * rejects. The authored values land around 500–1600ms, which turned out to be too quick to read —
 * a fourteen-step run was over in twelve seconds and registered as a flicker rather than as work.
 *
 * One multiplier here rather than eighty edited fixture values: the ratio to `latency_ms` is a
 * property of the playback, not of any step, and it is the number the README quotes.
 */
const PLAYBACK_SCALE = 1.7;

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
      /**
       * THE RUN'S OWN STATE DECIDES, not the shape of its last step.
       *
       * This inferred the ending from the final step — interrupt, else error, else complete — which
       * gave a quarantined run a green "Complete" banner directly under a header badge reading
       * "Quarantined". Both were rendering the same run and disagreeing about how it went, because
       * a quarantine ends on a successful `notify_operator` action and an ambiguous publish ends on
       * a successful park. The step succeeded; the run did not.
       *
       * The interrupt case still comes from the step, because a run waiting for a person is
       * `awaiting_human` whichever gate stopped it, and the step is what knows which.
       */
      const last = steps.at(-1);
      const run = world.runs.find((r) => r.id === runId);

      const reason: StreamEndReason =
        last?.type === 'interrupt'
          ? 'interrupt'
          : run?.state === 'quarantined'
            ? 'quarantined'
            : run?.state.startsWith('parked') || last?.outcome === 'error'
              ? 'parked'
              : 'completed';

      onEvent({ type: 'end', reason });
      return;
    }

    /**
     * A STEP ARRIVES WHEN IT STARTS, NOT WHEN IT FINISHES.
     *
     * This used to wait `playback_ms` and then deliver the step complete — with its duration, its
     * token counts and its cost already filled in. So the feed was a sequence of finished facts
     * appearing at intervals, and the agent was never once seen *doing* anything. Watching it felt
     * like a list being populated, because that is exactly what it was.
     *
     * Now the step is emitted immediately and marked settled after its own duration. The agent is
     * visibly mid-step for the whole of that interval, which is the thing a person recognises as
     * work happening. Same records, same order, same total elapsed time — the difference is
     * entirely that there is now a present tense.
     *
     * It also makes the per-step duration legible for the first time: a 17-second drafting call
     * visibly dwells where a 200ms guardrail check flicks past, and `playback_ms` finally means
     * something on screen rather than just spacing the arrivals.
     */
    const step = pending[index];
    onEvent({ type: 'step', step });

    timer = setTimeout(() => {
      if (cancelled) return;
      onEvent({ type: 'settled', id: step.id });
      emitNext(index + 1);
    }, step.playback_ms * PLAYBACK_SCALE);
  }

  return { stop };
}
