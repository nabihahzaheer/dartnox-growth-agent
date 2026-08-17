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
  FixtureSet,
  GuardrailEvent,
  GuardrailEventId,
  MinutesFromAnchor,
  Post,
  PostId,
  RejectionReasonCode,
  Run,
  RunId,
} from './types.ts';

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

function slotFor(world: FixtureSet, draft: Draft): CalendarSlot | undefined {
  return world.calendarSlots.find((s) => s.id === draft.slot_id);
}

/**
 * Working days between now and a slot's publish time.
 *
 * Working days, not elapsed days, because the runway rule is about whether a person can review a
 * redraft — and nobody reviews on Saturday. A Friday rejection for a Monday slot has one working
 * day, not three.
 */
function workingDaysUntil(now: MinutesFromAnchor, publishAt: MinutesFromAnchor): number {
  const start = new Date(0);
  const days = Math.floor(((publishAt as number) - (now as number)) / (24 * 60));
  let working = 0;
  for (let i = 1; i <= Math.max(0, days); i++) {
    const weekday = new Date(start.getTime() + i * 86_400_000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) working++;
  }
  return working;
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
    /** Attached to the run's last step, since an operator escalation is not produced by a check. */
    run_step_id: (world.runSteps.filter((s) => s.run_id === draft.run_id).at(-1)?.id ??
      world.runSteps[0].id),
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

/** Exported for the check script, which asserts the approval id is stable across a replay. */
export function approvalIdFor(draft: Draft): ApprovalId {
  return `APR-${draft.id.replace('DRAFT-', '')}` as ApprovalId;
}
