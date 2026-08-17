/**
 * WORLD — what each operator decision writes.
 *
 * This is `DUMMY-DATA-SPEC.md` §4.8 as code: the transition table that says an approve click
 * touches five records, not one. Leaving that to be discovered while building screens guarantees
 * two screens disagree about what an approval did.
 *
 * PURE. No React, no timers, no I/O, no imports beyond types and the hash helper. Each function
 * takes the current world and returns the records it changed; `agentClient.ts` applies them. That
 * is what makes them testable by a plain Node script, which is what turns "the transitions are a
 * state machine you can test without rendering" from a claim in a decision log into a fact.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THEY RETURN CHANGES RATHER THAN MUTATING
 *
 * A function that mutates the world in place can be called twice and do the wrong thing the second
 * time. Returning a patch means the caller decides when it lands, the check script can assert on
 * the patch without a world to mutate, and a write that fails partway leaves nothing half-applied.
 */

import type {
  Approval,
  ApprovalId,
  CalendarSlot,
  Draft,
  DraftId,
  DraftVersion,
  DraftVersionId,
  EditTag,
  EscalationTrigger,
  FixtureSet,
  GuardrailEvent,
  GuardrailEventId,
  GuardrailRule,
  GuardrailRuleId,
  MinutesFromAnchor,
  Post,
  PostId,
  RejectionReasonCode,
  Run,
  RunId,
  RunStepId,
  Settings,
  SettingsDiffEntry,
  SettingsVersion,
  SettingsVersionId,
} from './types.ts';
/** Calendar arithmetic only — no formatting. `time.ts` owns the client's timezone, so the runway
 *  rule and the week grid resolve a weekday through the same code rather than through two
 *  independent notions of what day it is. */
import { isWorkingDay, localDay } from './time.ts';

/**
 * A non-cryptographic digest, and the name says so.
 *
 * Production hashes approved text with sha256 — that is what L4 compares before publishing, and it
 * is what makes "we only publish what a human approved" checkable rather than asserted. In the
 * browser `crypto.subtle` is asynchronous, and making every transition async to obtain a hash
 * whose cryptographic properties nothing here depends on would be paying a real cost for a
 * pretend one.
 *
 * So: a cheap deterministic digest, prefixed `fnv1a:` rather than `sha256:` so nothing on screen
 * claims to be something it is not. The *mechanism* being demonstrated is that an approval binds
 * to a specific version's digest and publishing re-checks it; the algorithm is swappable.
 */
export function contentDigest(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a:${hash.toString(16).padStart(8, '0')}`;
}

/**
 * The records a decision changed. Every field optional — an escalate writes a guardrail event and
 * a draft state and nothing else, and listing empty arrays for the rest would suggest it touched
 * them.
 */
export type WorldPatch = {
  drafts?: Draft[];
  approvals?: Approval[];
  posts?: Post[];
  runs?: Run[];
  calendarSlots?: CalendarSlot[];
  guardrailEvents?: GuardrailEvent[];
  guardrailRules?: GuardrailRule[];
  /**
   * A singleton, so it is replaced wholesale rather than merged by id like everything else here.
   * `Settings` has no `id` field because there is exactly one per client — which is correct, and
   * is why `applyPatch` needs one line of special handling for it.
   */
  settings?: Settings;
};

/** Everything a transition needs that is not in the world: who, when, and the idempotency key. */
export type DecisionContext = {
  now: MinutesFromAnchor;
  operatorId: Approval['operator_id'];
  /** Seconds the item was open in front of the operator, inclusive of editing time. The
   *  rubber-stamp clock — if editing happened outside the measured window, hours saved would be
   *  systematically overstated. */
  secondsOpen: number;
  /** Replaying the same decision — a double click, a retry after a timeout — must not produce two
   *  approvals. The client rejects a repeat of a key it has already seen. */
  idempotencyKey: string;
};

/* ================================================================================================
 * HELPERS
 * ==============================================================================================*/

function requireDraft(world: FixtureSet, draftId: DraftId): Draft {
  const draft = world.drafts.find((d) => d.id === draftId);
  if (!draft) throw new Error(`No draft ${draftId}`);
  return draft;
}

/** The pending approval row for a draft's current version. Created at the interrupt, not at the
 *  decision — `decided_at: null` is what *means* pending, and the queue orders on `queued_at`. */
function pendingApproval(world: FixtureSet, draft: Draft): Approval {
  const approval = world.approvals.find(
    (a) => a.draft_version_id === draft.current_version_id && a.decided_at === null,
  );
  if (!approval) throw new Error(`No pending approval for ${draft.id}`);
  return approval;
}

function lastStepOf(world: FixtureSet, runId: RunId): RunStepId {
  const step = world.runSteps.filter((s) => s.run_id === runId).at(-1);
  if (!step) throw new Error(`Run ${runId} has no steps to attach an escalation to`);
  return step.id;
}

function slotFor(world: FixtureSet, draft: Draft): CalendarSlot | undefined {
  return world.calendarSlots.find((s) => s.id === draft.slot_id);
}

/**
 * `ANCHOR_WEEKDAY = 4` used to live here, on the reasoning that the anchor is a Thursday and so any
 * day's weekday is arithmetic rather than a date lookup. It was removed with the second rewrite of
 * `workingDaysUntil`: the arithmetic was only sound if you also divided time into calendar days,
 * and dividing by 1440 divides it into 24-hour blocks from mid-morning instead. Two different
 * notions of "what day is it" in one codebase is what produced a Monday slot the runway rule read
 * as a Sunday, so this file no longer has its own — it asks `lib/time.ts`.
 */
const MINUTES_PER_DAY = 24 * 60;

/**
 * Working days between two offsets.
 *
 * Working days, not elapsed days, because the runway rule is about whether a person can review a
 * redraft — and nobody reviews on Saturday. A Friday rejection for a Monday slot has one working
 * day of runway, not three, which is the difference between slipping the slot and dropping it.
 *
 * Rewritten 17 Aug. The first version built a `new Date(0)` and walked forward from it, which was
 * correct **by coincidence**: the epoch is a Thursday and so is the anchor. It also ignored `now`
 * entirely — the loop always counted from the epoch — so any decision taken at a non-zero offset
 * would have counted the wrong weekdays. Nothing failed, because every decision so far is taken at
 * offset zero. That is the worst kind of bug to leave in: right today, wrong later, silent both
 * times.
 *
 * REWRITTEN AGAIN, AND THE SECOND BUG WAS LIVE IN THE DEMO.
 *
 * That version still divided time with `Math.floor(offset / MINUTES_PER_DAY)`, which measures
 * 24-hour blocks from the anchor's mid-morning rather than client-local calendar days. The anchor is
 * Thursday ~10:00, so "day 3" ran Sunday 10:00 → Monday 10:00 — and next Monday's 09:00 slot, which
 * is offset 5700, landed in it and was counted as a **Sunday**.
 *
 * The consequence was not academic. The showcase draft publishes Monday 09:00; rejecting it
 * measured one working day of runway instead of two, took the `runway < 2` branch, and **dropped
 * the slot instead of slipping it** — no redraft run queued, the slot gone from the calendar, while
 * the queue's toast said "Redraft queued". The single most likely thing a reviewer clicks, doing
 * the opposite of what it announced.
 *
 * Calendar days come from `lib/time.ts`, which resolves them in the client's timezone through the
 * platform's own database. Same source as the week grid, so a slot cannot be Monday on the calendar
 * and Sunday to the runway rule.
 */
export function workingDaysUntil(now: MinutesFromAnchor, publishAt: MinutesFromAnchor): number {
  const start = localDay(now);
  const end = localDay(publishAt);

  let working = 0;
  for (let day = start.index + 1; day <= end.index; day++) {
    // `% 7` twice, because a slot in the past gives a negative difference.
    const weekday = (((start.weekday + (day - start.index)) % 7) + 7) % 7;
    if (isWorkingDay(weekday)) working++;
  }
  return working;
}

/**
 * The next working day at or after an offset, preserving the time of day.
 *
 * A slipped slot has to actually move. `CalendarSlot.original_publish_at` exists so the calendar
 * can show the move rather than silently relocating a slot, and the reject transition used to write
 * `original_publish_at: slot.publish_at` while leaving `publish_at` alone — two identical times
 * claiming a reschedule. On the week grid that renders as `09:00 09:00` with one struck through,
 * which reads as a broken renderer rather than as a fact about the slot.
 *
 * Weekends are skipped for the same reason `workingDaysUntil` counts them out: the client's posting
 * window is Monday to Friday and L4 checks that window before publishing, so slipping a Friday slot
 * onto a Saturday would produce a slot that fails its own publish-time guard.
 */
function nextWorkingDayAfter(offset: MinutesFromAnchor): MinutesFromAnchor {
  let at = ((offset as number) + MINUTES_PER_DAY) as MinutesFromAnchor;
  /** Bounded rather than `while`: a timezone that somehow reported no weekday would spin forever,
   *  and three days is the longest run of non-working days this calendar can produce. */
  for (let guard = 0; guard < 7; guard++) {
    if (isWorkingDay(localDay(at).weekday)) break;
    at = ((at as number) + MINUTES_PER_DAY) as MinutesFromAnchor;
  }
  return at;
}

/* ================================================================================================
 * APPROVE
 *
 * §4.8: writes the Approval, moves the Draft to `approved`, creates the Post, and queues a publish
 * Run. Slot state derives from the draft and post rather than being written (§4.5).
 * ==============================================================================================*/

export function approve(
  world: FixtureSet,
  draftId: DraftId,
  ctx: DecisionContext,
  edited?: { text: string; editTags: EditTag[] },
): WorldPatch {
  const draft = requireDraft(world, draftId);
  const approval = pendingApproval(world, draft);
  const slot = slotFor(world, draft);

  let versions = draft.versions;
  let currentVersionId = draft.current_version_id;
  let boundVersion = draft.versions.find((v) => v.id === draft.current_version_id);

  if (edited) {
    /**
     * An edit creates a new version rather than overwriting the current one. Edit magnitude diffs
     * the last *agent* version against the shipped version, so overwriting would destroy the
     * measurement — and authorship is what edit rate counts, not the decision label.
     */
    const lastAgent = [...draft.versions].reverse().find((v) => v.author === 'agent');
    const next: DraftVersion = {
      id: `${draft.id}-v${draft.versions.length + 1}` as DraftVersionId,
      version: draft.versions.length + 1,
      created_at: ctx.now,
      text: edited.text,
      author: 'human',
      content_hash: contentDigest(edited.text),
      settings_version_id: lastAgent?.settings_version_id ?? world.settings.current_version_id,
      token_count: edited.text.trim().split(/\s+/).length,
      edit_tags: edited.editTags,
    };
    versions = [...draft.versions, next];
    currentVersionId = next.id;
    boundVersion = next;
  }

  if (!boundVersion) throw new Error(`Draft ${draftId} has no current version`);

  const decidedApproval: Approval = {
    ...approval,
    /** The decision label follows the *version*, not the button. If a human authored the shipped
     *  text, this is an approve-with-edits regardless of which control was pressed. */
    decision: edited ? 'approve_with_edits' : 'approve',
    decided_at: ctx.now,
    seconds_open: ctx.secondsOpen,
    decided_by: 'operator',
    draft_version_id: currentVersionId,
  };

  const post: Post = {
    id: `POST-${draft.id.replace('DRAFT-', '')}` as PostId,
    draft_version_id: currentVersionId,
    channel: draft.channel,
    scheduled_at: slot?.publish_at ?? ctx.now,
    state: 'scheduled',
    published_at: null,
    platform_post_id: null,
    platform_url: null,
    /** L4 publishes only on a match against this. It is bound to the version that was approved,
     *  which is what makes a later edit invalidate the scheduled post rather than sneak out. */
    approved_content_hash: boundVersion.content_hash,
    idempotency_key: ctx.idempotencyKey,
    platform_cost_usd: draft.channel === 'x' ? 0.02 : 0,
    invalidated_reason: null,
    pulled_at: null,
    pull_reason: null,
  };

  /** Publishing is a separate short run, fired by the scheduler. A draft run never stays open
   *  waiting on a clock — that is why this is queued rather than executed here. */
  const publishRun: Run = {
    id: `RUN-P${draft.id.replace('DRAFT-', '')}` as RunId,
    client_id: world.client.id,
    type: 'publish',
    parent_run_id: null,
    state: 'queued',
    checkpoint_ref: '',
    trigger: 'schedule.weekly_draft',
    park_reason: null,
    end_reason: null,
    started_at: post.scheduled_at,
    ended_at: null,
    step_cap: 20,
    degraded: false,
    settings_version_id: world.settings.current_version_id,
    target_draft_id: draft.id,
    target_post_id: post.id,
    next_sweep_at: null,
    variant: 'nominal',
  };

  return {
    drafts: [{ ...draft, state: 'approved', versions, current_version_id: currentVersionId }],
    approvals: [decidedApproval],
    posts: [post],
    runs: [publishRun],
  };
}

/* ================================================================================================
 * REJECT
 *
 * §4.8: writes the Approval with its reason, moves the Draft to `rejected`, and moves the slot to
 * `slipped` or `dropped`. A redraft run is queued whose drafting step names the rejection it
 * consumed — which is the mechanism behind the brief's hardest queue clause.
 * ==============================================================================================*/

export function reject(
  world: FixtureSet,
  draftId: DraftId,
  reasonCode: RejectionReasonCode,
  reasonNote: string | null,
  ctx: DecisionContext,
): WorldPatch {
  const draft = requireDraft(world, draftId);
  const approval = pendingApproval(world, draft);
  const slot = slotFor(world, draft);

  const decidedApproval: Approval = {
    ...approval,
    decision: 'reject',
    reason_code: reasonCode,
    reason_note: reasonNote,
    decided_at: ctx.now,
    seconds_open: ctx.secondsOpen,
    decided_by: 'operator',
  };

  const patch: WorldPatch = {
    drafts: [{ ...draft, state: 'rejected' }],
    approvals: [decidedApproval],
  };

  if (slot) {
    /**
     * Dropped when the slot is topical or there is under two working days of runway; slipped
     * otherwise.
     *
     * The topical case is the honest one: a topical post that slips a week is stale by definition,
     * so there is nothing to reschedule. The runway case is arithmetic — a redraft needs about a
     * day to produce and a day to review, so under two working days there is no room for another
     * attempt before the slot arrives.
     */
    const runway = workingDaysUntil(ctx.now, slot.publish_at);
    const dropped = slot.is_topical || runway < 2;

    patch.calendarSlots = [
      {
        ...slot,
        state: dropped ? 'dropped' : 'slipped',
        /** A dropped slot never runs again, so it keeps whatever move history it already had. A
         *  slipped one moves to the next working day and records where it came from — see
         *  `nextWorkingDayAfter`. */
        publish_at: dropped ? slot.publish_at : nextWorkingDayAfter(slot.publish_at),
        original_publish_at: dropped ? slot.original_publish_at : slot.publish_at,
        slip_reason: dropped ? null : 'rejected_redraft',
      },
    ];

    if (!dropped) {
      patch.runs = [
        {
          id: `RUN-R${draft.id.replace('DRAFT-', '')}` as RunId,
          client_id: world.client.id,
          type: 'draft',
          parent_run_id: null,
          state: 'queued',
          checkpoint_ref: '',
          trigger: 'schedule.weekly_draft',
          park_reason: null,
          end_reason: null,
          started_at: ctx.now,
          ended_at: null,
          step_cap: 20,
          degraded: false,
          settings_version_id: world.settings.current_version_id,
          target_draft_id: null,
          target_post_id: null,
          next_sweep_at: null,
          variant: 'nominal',
        },
      ];
    }
  }

  return patch;
}

/* ================================================================================================
 * ESCALATE
 *
 * §4.8: writes a GuardrailEvent and holds the draft. `operator_escalation` and `operator_initiated`
 * exist in their unions specifically for this — before they were added, the transition table
 * described a record the reducer had no valid way to produce.
 * ==============================================================================================*/

export function escalate(
  world: FixtureSet,
  draftId: DraftId,
  tier: 'operator' | 'stakeholder',
  detail: string,
  ctx: DecisionContext,
): WorldPatch {
  const draft = requireDraft(world, draftId);

  const event: GuardrailEvent = {
    id: `GE-ESC-${draft.id}` as GuardrailEventId,
    run_id: draft.run_id,
    /**
     * The last step of *this draft's* run — an operator escalation is not produced by a check, so
     * it attaches to where the run stopped.
     *
     * The first version fell back to `world.runSteps[0]` when the run had no steps, which would
     * have pointed the event at a step belonging to an entirely different run. Referential
     * integrity would still have passed, because the step exists; it would simply have been the
     * wrong one, and the console renders events at their step's position in the stream. A run with
     * no steps is a broken fixture, so it throws rather than quietly picking something.
     */
    run_step_id: lastStepOf(world, draft.run_id),
    draft_id: draft.id,
    /** Null, and well-formed: `trigger_kind` is what makes it so. Minting a synthetic rule for
     *  "the operator escalated" would corrupt the per-rule block-rate chart with a row that is not
     *  a guardrail. */
    rule_id: null,
    trigger_kind: 'operator_escalation',
    result: 'warn',
    evaluated_at: ctx.now,
    offending_span: null,
    span_withheld: false,
    withheld_reason: null,
    escalation_tier: tier,
    escalation_trigger: 'operator_initiated',
    raised_at: ctx.now,
    acknowledged_at: null,
    /** Tri-state and unlabelled. It becomes a number in the escalation-precision metric only once
     *  a person says whether it was warranted. */
    was_unnecessary: null,
    labelled_at: null,
    labelled_by: null,
    source_url: null,
    domain_flagged: false,
    replies: [],
    /** 72 hours for the stakeholder tier (N14); the operator tier has no countdown because the
     *  operator is already here. */
    decision_deadline: tier === 'stakeholder' ? ((ctx.now + 72 * 60) as MinutesFromAnchor) : null,
    detail,
  };

  return {
    /** `held`, not `blocked_guardrail`. The producer and the release event are different: a
     *  content decision released by an operator choice, versus a rule that stopped it. */
    drafts: [{ ...draft, state: 'held' }],
    guardrailEvents: [event],
  };
}

/* ================================================================================================
 * SETTINGS
 *
 * "Every change is a versioned event, and every draft records the settings version it ran under.
 * That is what makes edit rate before and after a change comparable." — which means a settings
 * write that only assigns a value is wrong even when the value it assigns is right. Every function
 * below appends a `SettingsVersion` with a per-key diff and moves `current_version_id`, because the
 * dashboard's one graded drill-down splits its cohorts on exactly that.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY `updateSetting` TAKES A UNION AND NOT A KEY AND A VALUE
 *
 * `(key: string, value: unknown)` is the obvious signature and it gives up everything the rest of
 * this file is built on. It cannot say that `score_threshold` is a number and `tone.register` is a
 * string, it cannot stop a caller writing a key that does not exist, and every call site ends in a
 * cast. D-002's claim is that these signatures are the API contract handed to a backend engineer;
 * a contract whose payload is `unknown` is a suggestion.
 *
 * The union costs one member per settable control. There are five, and the brief names four.
 * ==============================================================================================*/

export type SettingUpdate =
  /** The one control with an immediate, run-free effect: the queue re-sorts and review flags
   *  appear and clear as it moves. */
  | { kind: 'score_threshold'; value: number }
  | { kind: 'tone_register'; value: string }
  /**
   * The board's admission gate, made operable.
   *
   * The second control with an immediate effect and the only one whose effect is a *system state*
   * rather than a record change: taking the cap below current spend puts the client into the
   * cap-reached branch — new drafting and planning wait, approved posts still publish, reply
   * monitoring keeps running. `field_meta['budget.cap']` already declared it immediate with a
   * 50–2000 range and nothing rendered it.
   */
  | { kind: 'budget_cap'; value: number }
  /** Always refused. Present in the union rather than absent from it *because* it is refused —
   *  a control that cannot be operated still has to be expressible, or the screen would be
   *  rendering a toggle wired to nothing. */
  | { kind: 'auto_approve'; value: boolean }
  | { kind: 'escalation_trigger'; trigger: EscalationTrigger; enabled: boolean }
  | { kind: 'approval_rule'; trigger: EscalationTrigger; enabled: boolean };

/** Human-readable path for the diff row, matching the `field_meta` keys where one exists. */
function settingKeyPath(update: SettingUpdate): string {
  switch (update.kind) {
    case 'score_threshold':
      return 'score_threshold';
    case 'tone_register':
      return 'tone.register';
    case 'budget_cap':
      return 'budget.cap';
    case 'auto_approve':
      return 'auto_approve.enabled';
    case 'escalation_trigger':
      return `escalation_triggers.${update.trigger}`;
    case 'approval_rule':
      return `approval_rules.${update.trigger}`;
  }
}

/**
 * Append a version and return the new Settings.
 *
 * The version id is derived from the count rather than from a clock, so the same edit produces the
 * same id on every run — `Math.random()` or `Date.now()` here would make the build non-reproducible
 * and the drill-down's x-axis unstable between reloads.
 */
function withNewVersion(
  settings: Settings,
  ctx: DecisionContext,
  changeSummary: string,
  diff: SettingsDiffEntry[],
  mutate: (draft: Settings) => void,
): Settings {
  const versionId = `SET-V${settings.versions.length + 1}` as SettingsVersionId;
  const version: SettingsVersion = {
    version_id: versionId,
    changed_at: ctx.now,
    changed_by: ctx.operatorId,
    change_summary: changeSummary,
    diff,
  };

  const next: Settings = {
    ...settings,
    versions: [...settings.versions, version],
    current_version_id: versionId,
  };
  mutate(next);
  return next;
}

/** Whether a control refuses to be written, and the sentence saying why. Null means it is tunable.
 *  Read from the data — `field_meta.is_fixed` and the rule rows' own `is_fixed` — rather than from
 *  a list of key names here, so a fixture that marks something fixed is obeyed without a code
 *  change. */
export function settingRefusal(world: FixtureSet, update: SettingUpdate): string | null {
  if (update.kind === 'auto_approve') return world.settings.auto_approve.lock_reason;

  if (update.kind === 'escalation_trigger' || update.kind === 'approval_rule') {
    const rows =
      update.kind === 'escalation_trigger'
        ? world.settings.escalation_triggers
        : world.settings.approval_rules;
    const row = rows.find((r) => r.trigger === update.trigger);
    if (!row) return null;
    return row.is_fixed
      ? 'This rule cannot be loosened. Relaxing a rule on the evidence of its own false positives ' +
          'is only safe where a false negative is recoverable, and this one is not.'
      : null;
  }

  const meta = world.settings.field_meta[settingKeyPath(update)];
  return meta?.is_fixed ? 'This control is fixed and cannot be changed.' : null;
}

/**
 * Apply one settings change.
 *
 * Assumes the caller has already checked `settingRefusal` — this file is pure and throws no
 * `ConsoleError`, because those belong to the console boundary and not to the transition table
 * (D-031, A-06's "two contract sets, separate boundaries").
 */
export function updateSetting(
  world: FixtureSet,
  update: SettingUpdate,
  ctx: DecisionContext,
): WorldPatch {
  const current = world.settings;

  switch (update.kind) {
    case 'score_threshold': {
      /** Clamped to the declared range rather than trusted. A slider cannot produce an out-of-range
       *  value, but a caller can, and the range is the operator-facing promise. */
      const range = current.field_meta.score_threshold?.range;
      const value = range
        ? Math.min(range.max, Math.max(range.min, update.value))
        : update.value;
      return {
        settings: withNewVersion(
          current,
          ctx,
          `Review threshold moved from ${current.score_threshold} to ${value}.`,
          [{ key: 'score_threshold', from: current.score_threshold, to: value }],
          (next) => {
            next.score_threshold = value;
          },
        ),
      };
    }

    case 'budget_cap': {
      /** Clamped to the declared range, for the same reason `score_threshold` is: the range is the
       *  operator-facing promise and a caller is not a slider. */
      const range = current.field_meta['budget.cap']?.range;
      const value = Math.round(
        range ? Math.min(range.max, Math.max(range.min, update.value)) : update.value,
      );
      return {
        settings: withNewVersion(
          current,
          ctx,
          `Monthly cap moved from $${current.budget.cap} to $${value}.`,
          [{ key: 'budget.cap', from: current.budget.cap, to: value }],
          (next) => {
            /** A new object rather than a field write: `withNewVersion` spreads one level only, so
             *  mutating `next.budget.cap` in place would also mutate the world's own settings and
             *  break the purity every transition in this file is asserted on. */
            next.budget = { ...current.budget, cap: value };
          },
        ),
      };
    }

    case 'tone_register':
      return {
        settings: withNewVersion(
          current,
          ctx,
          'Changed the tone register.',
          [{ key: 'tone.register', from: current.tone.register, to: update.value }],
          (next) => {
            next.tone = { ...current.tone, register: update.value };
          },
        ),
      };

    case 'escalation_trigger':
    case 'approval_rule': {
      const isEscalation = update.kind === 'escalation_trigger';
      const rows = isEscalation ? current.escalation_triggers : current.approval_rules;
      const updated = rows.map((r) =>
        r.trigger === update.trigger ? { ...r, enabled: update.enabled } : r,
      );
      const verb = update.enabled ? 'Enabled' : 'Disabled';
      const label = update.trigger.replace(/_/g, ' ');
      return {
        settings: withNewVersion(
          current,
          ctx,
          `${verb} the ${label} ${isEscalation ? 'escalation trigger' : 'approval rule'}.`,
          [
            {
              key: settingKeyPath(update),
              from: String(!update.enabled),
              to: String(update.enabled),
            },
          ],
          (next) => {
            if (isEscalation) next.escalation_triggers = updated;
            else next.approval_rules = updated;
          },
        ),
      };
    }

    /** Unreachable in practice — the caller refuses this before arriving. Returning an empty patch
     *  rather than throwing keeps this file free of the console's error taxonomy. */
    case 'auto_approve':
      return {};
  }
}

/**
 * Enable or disable a guardrail rule.
 *
 * `disabled_at` is written alongside `is_enabled`, and that pairing is the entire reason both
 * fields exist: A-17 wants a sudden drop in a rule's block rate to raise an alarm, and the
 * commonest benign cause of that drop is somebody switching the rule off. Without the date the
 * dashboard raises a false alarm instead of drawing a disabled-from marker.
 */
export function toggleGuardrailRule(
  world: FixtureSet,
  ruleId: GuardrailRuleId,
  enabled: boolean,
  ctx: DecisionContext,
): WorldPatch {
  const rule = world.guardrailRules.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`No guardrail rule ${ruleId}`);

  const next: GuardrailRule = {
    ...rule,
    is_enabled: enabled,
    /** Cleared on re-enable. A rule that carried a stale `disabled_at` would put a permanent
     *  "switched off on the 6th" marker under a chart of a rule that is running. */
    disabled_at: enabled ? null : ctx.now,
  };

  return {
    guardrailRules: [next],
    settings: withNewVersion(
      world.settings,
      ctx,
      `${enabled ? 'Enabled' : 'Disabled'} the "${rule.display_name}" guardrail.`,
      [{ key: `guardrail.${rule.id}`, from: String(rule.is_enabled), to: String(enabled) }],
      () => {
        /** Nothing on Settings changes — the rule lives in its own collection. The version is
         *  written anyway because "every change is a versioned event" is the claim the audit trail
         *  makes, and a config change that left no trace would quietly falsify it. */
      },
    ),
  };
}

/* ================================================================================================
 * ADDING A BANNED CLAIM — the re-validation sweep
 *
 * The bonus the brief offers: "Bonus if changing a setting visibly changes simulated agent
 * behavior." This is the one that changes something already decided rather than something the
 * agent will do next, which is why it is the strongest version of that claim available.
 *
 * WHAT MAKES IT HONEST. The match is `String.includes` against the actual text of the version each
 * scheduled post binds. It is not a lookup, not a flag on a fixture, and not a scripted outcome:
 * type a phrase that appears in nothing and nothing happens, which is the property that makes the
 * case where something *does* happen worth watching.
 *
 * WHY THE MATCH IS A LITERAL STRING AND NOT A MODEL. The banned-claim rule's own config says
 * `match: 'exact_phrase'`. A model would be slower, dearer and less predictable than `includes`,
 * and an operator adding a phrase to a list expects that phrase to be what is matched.
 *
 * WHAT THE SWEEP DOES *NOT* TOUCH. Published posts. A post that is already out is recalled, which
 * is a different action with a different record (`pulled_at`, `pull_reason`) and a human decision
 * in front of it. Invalidation is only meaningful before publication — which is the same reason
 * the effort in this architecture goes before the publish boundary rather than after it.
 * ==============================================================================================*/

export type BannedClaimSweep = {
  patch: WorldPatch;
  /** How many scheduled posts were examined. Shown beside the result, because "1 returned" without
   *  "of 2 scanned" does not tell the operator whether the rule is narrow or the queue is empty. */
  scanned: number;
  invalidated: PostId[];
};

export function addBannedClaim(
  world: FixtureSet,
  phrase: string,
  ctx: DecisionContext,
): BannedClaimSweep {
  const trimmed = phrase.trim();
  const needle = trimmed.toLowerCase();

  const settings = withNewVersion(
    world.settings,
    ctx,
    `Banned the phrase "${trimmed}".`,
    [
      {
        key: 'tone.banned_phrases',
        from: world.settings.tone.banned_phrases.join(', '),
        to: [...world.settings.tone.banned_phrases, trimmed].join(', '),
      },
    ],
    (next) => {
      next.tone = {
        ...world.settings.tone,
        banned_phrases: [...world.settings.tone.banned_phrases, trimmed],
      };
    },
  );

  const scheduled = world.posts.filter((p) => p.state === 'scheduled');

  const posts: Post[] = [];
  const approvals: Approval[] = [];
  const invalidated: PostId[] = [];

  for (const post of scheduled) {
    const draft = world.drafts.find((d) =>
      d.versions.some((v) => v.id === post.draft_version_id),
    );
    const version = draft?.versions.find((v) => v.id === post.draft_version_id);
    if (!draft || !version) continue;

    if (!version.text.toLowerCase().includes(needle)) continue;

    posts.push({
      ...post,
      state: 'invalidated',
      /** Defined for this case only. The queue row renders it verbatim — a post that reappears
       *  without saying which rule sent it back is indistinguishable from a bug. */
      invalidated_reason: `Contains "${trimmed}".`,
    });
    invalidated.push(post.id);

    /**
     * The re-decision, modelled properly rather than by clearing the old row.
     *
     * `Approval.superseded_by` exists for exactly this: a genuine second decision on the same
     * version. Mutating the original in place would make the audit trail claim the operator took
     * one decision when they took two, and would leave edit rate and approval rate disagreeing
     * with what the queue shows.
     */
    const newApprovalId = `APR-RE-${post.id}` as ApprovalId;
    const prior = world.approvals.find(
      (a) => a.draft_version_id === post.draft_version_id && a.decided_at !== null,
    );
    if (prior) approvals.push({ ...prior, superseded_by: newApprovalId });

    approvals.push({
      id: newApprovalId,
      draft_version_id: post.draft_version_id,
      decision: null,
      reason_code: null,
      reason_note: null,
      /** The clock the queue sorts on starts now, not when the draft was first written. This is a
       *  new review, and queue-age p95 measures reviews rather than drafts. */
      queued_at: ctx.now,
      decided_at: null,
      seconds_open: null,
      decided_by: null,
      operator_id: ctx.operatorId,
      superseded_by: null,
      pillar_id: draft.pillar_id,
      channel_at_decision: draft.channel,
    });
  }

  return {
    patch: {
      settings,
      posts: posts.length > 0 ? posts : undefined,
      approvals: approvals.length > 0 ? approvals : undefined,
    },
    scanned: scheduled.length,
    invalidated,
  };
}

/**
 * How many scheduled posts a phrase would catch, without changing anything.
 *
 * Pure and cheap, so the settings screen can call it on every keystroke and show the count before
 * the operator commits. That signpost is not decoration: a reviewer who has to guess which phrase
 * occurs in which scheduled post will not find one, and an control that appears to do nothing is
 * worse than an absent one.
 */
export function countBannedClaimMatches(world: FixtureSet, phrase: string): number {
  const needle = phrase.trim().toLowerCase();
  if (needle.length === 0) return 0;
  return world.posts.filter((post) => {
    if (post.state !== 'scheduled') return false;
    const draft = world.drafts.find((d) => d.versions.some((v) => v.id === post.draft_version_id));
    const version = draft?.versions.find((v) => v.id === post.draft_version_id);
    return version ? version.text.toLowerCase().includes(needle) : false;
  }).length;
}

/** Marks an escalation as one that should not have fired. One click, and escalation precision
 *  moves — the shortest causal chain in the product between an action and a metric. */
export function labelEscalation(
  world: FixtureSet,
  eventId: GuardrailEventId,
  wasUnnecessary: boolean,
  ctx: DecisionContext,
): WorldPatch {
  const event = world.guardrailEvents.find((e) => e.id === eventId);
  if (!event) throw new Error(`No guardrail event ${eventId}`);
  return {
    guardrailEvents: [
      {
        ...event,
        was_unnecessary: wasUnnecessary,
        labelled_at: ctx.now,
        labelled_by: ctx.operatorId,
      },
    ],
  };
}
