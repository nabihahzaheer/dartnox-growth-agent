/**
 * THE REST OF WEDNESDAY'S BATCH.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * The architecture says the Wednesday run drafts the whole of next week — eight posts, one
 * independent run per slot. `pipeline.ts` was authored for the interface submitted on 17 August,
 * where the console showed one run at a time and the queue's other rows were run-level incidents.
 * Five slots and two pending drafts were enough for that.
 *
 * The rebuilt console makes the batch the unit on screen: eight runs drafting in parallel, landing
 * for review as they finish, cleared in one sitting. Two pending drafts cannot demonstrate that.
 * Counting the set before building against it is what surfaced the gap — 2 awaiting approval where
 * the architecture implies 8.
 *
 * Three slots are added here, taking next week to the contracted eight, and one of them exercises
 * a state the pending set never reached.
 *
 * ---------------------------------------------------------------------------------------------
 * THE BLOCKED DRAFT IS THE POINT
 *
 * `DRAFT-0152` fails L3 on a banned claim. Nothing in the whole fixture set was in
 * `blocked_guardrail`, which meant the one rule the board is most emphatic about — a hard fail
 * removes the approve control, and a reviewer overriding it would be the client overriding
 * themselves with no record — was asserted in prose and demonstrated nowhere.
 *
 * It fails on `guaranteed savings`, which the client banned at onboarding. That is deliberate: the
 * phrase is on `settings.tone.banned_phrases`, so the block is reproducible from data the operator
 * can see and edit rather than from a flag someone set on the draft.
 *
 * Its guardrail event carries no rationale, and that is correct rather than lazy. `banned_claim`
 * runs on `lookup`; a list matched, there is nothing to explain, and `scripts/check.mts` asserts
 * that correspondence.
 *
 * ---------------------------------------------------------------------------------------------
 * SEPARATE FILE, NOT AN EDIT
 *
 * Spliced in `index.ts` the way `history.ts` is, rather than threaded into `pipeline.ts`'s arrays.
 * Those arrays are hand-authored and each entry carries the reasoning for its own shape; inserting
 * three records into six of them would bury this explanation in six places.
 */

import { CLIENT_ID, PILLAR_COST, PILLAR_FIELD_NOTES, PILLAR_OLD_BUILDINGS } from './client.ts';
import { RULE_BANNED_CLAIM, RULE_ENTAILMENT, RULE_PII, RULE_SIMILARITY } from './guardrailRules.ts';
import { OPERATOR_ID, SETTINGS_V3 } from './settings.ts';
import { BATCH_START, RUN_PARENT, WEIGHTS, composite, step } from './pipeline.ts';
import { minutes } from '../lib/types.ts';
import type {
  Approval,
  ApprovalId,
  CalendarSlot,
  CalendarSlotId,
  Draft,
  DraftId,
  DraftVersion,
  DraftVersionId,
  GuardrailEvent,
  GuardrailEventId,
  MinutesFromAnchor,
  Run,
  RunId,
  RunStep,
  RunStepId,
  ScoreComponents,
} from '../lib/types.ts';

const slotId = (n: string) => n as CalendarSlotId;
const draftId = (n: string) => n as DraftId;
const versionId = (n: string) => n as DraftVersionId;
const runId = (n: string) => n as RunId;
const stepId = (n: string) => n as RunStepId;
const eventId = (n: string) => n as GuardrailEventId;
const approvalId = (n: string) => n as ApprovalId;

const HOUR = 60;
const DAY = 24 * HOUR;

/** Same origin as the rest of the batch, so all eight children share one parent's start. */
const START = -28 * HOUR + 3;
const t = (secondsIn: number): MinutesFromAnchor =>
  minutes(START + Math.round((secondsIn / 60) * 100) / 100);

export const SLOT_BEDSTUY = slotId('SLOT-0216');
export const SLOT_DIAGRAM = slotId('SLOT-0217');
export const SLOT_KNOB = slotId('SLOT-0218');

export const RUN_BEDSTUY = runId('RUN-0150');
export const RUN_DIAGRAM = runId('RUN-0151');
export const RUN_KNOB = runId('RUN-0152');

export const DRAFT_BEDSTUY = draftId('DRAFT-0150');
export const DRAFT_DIAGRAM = draftId('DRAFT-0151');
export const DRAFT_KNOB = draftId('DRAFT-0152');

const V_BEDSTUY = versionId('DV-0150-1');
const V_DIAGRAM = versionId('DV-0151-1');
const V_KNOB = versionId('DV-0152-1');

/* ================================================================================================
 * TEXT
 * ==============================================================================================*/

const bedstuyText =
  'The super told us the boiler had been fine since the nineties.\n\n' +
  'The combustion analyser put it eleven points off where it should be. Nobody had lied to us. ' +
  'Nobody had measured it either.';

const diagramText =
  'Every riser diagram we are handed was drawn for a building that has since been insulated, ' +
  'subdivided and re-glazed.\n\n' +
  'Balance to the building you have, not the one on the drawing.';

/**
 * The banned phrase sits mid-sentence rather than in the opening line, so the offending span is a
 * real substring lookup and not something an interface could find by reading the first sentence.
 */
const knobText =
  'Knob and tube found mid-retrofit is a stop-work, not a line item.\n\n' +
  'We opened a ceiling in a Prospect Heights walk-up last month expecting to run new circuits for ' +
  'the heat pump and found cloth-wrapped conductors threaded through the joists. The drawings said ' +
  'the building had been rewired in 1994. Half of it had.\n\n' +
  'Guaranteed savings on the job disappear the moment an electrician has to re-run the branch ' +
  'circuits, because that work is not additive. It stops everything else. The mechanical crew ' +
  'stands down, the equipment sits in the basement accruing storage, and the compliance deadline ' +
  'does not move to accommodate any of it.\n\n' +
  'What we do now: an invasive survey before the scope is priced, on any building where the ' +
  'rewiring date is claimed rather than documented. It costs a day and it has never once been the ' +
  'expensive part of the job.';

const BANNED_SPAN_START = knobText.indexOf('Guaranteed savings');
const BANNED_SPAN_END = BANNED_SPAN_START + 'Guaranteed savings'.length;

/* ================================================================================================
 * SLOTS
 * ==============================================================================================*/

export const batchSlots: CalendarSlot[] = [
  {
    id: SLOT_BEDSTUY,
    pillar_id: PILLAR_FIELD_NOTES,
    channel: 'x',
    /** Next Monday 13:00. */
    publish_at: minutes(4 * DAY + 3 * HOUR),
    angle: 'One line from the Bed-Stuy basement',
    is_topical: false,
    state: 'awaiting_approval',
    original_publish_at: null,
    slip_reason: null,
    calendar_run_id: runId('RUN-0132'),
  },
  {
    id: SLOT_DIAGRAM,
    pillar_id: PILLAR_OLD_BUILDINGS,
    channel: 'x',
    /** Next Tuesday 15:00. */
    publish_at: minutes(5 * DAY + 5 * HOUR),
    angle: 'Why the riser diagram is always wrong',
    is_topical: false,
    state: 'awaiting_approval',
    original_publish_at: null,
    slip_reason: null,
    calendar_run_id: runId('RUN-0132'),
  },
  {
    id: SLOT_KNOB,
    pillar_id: PILLAR_OLD_BUILDINGS,
    channel: 'linkedin',
    /** Next Wednesday 09:00, inside the LinkedIn window. */
    publish_at: minutes(6 * DAY - 1 * HOUR),
    angle: 'Knob and tube is a stop-work, not a line item',
    is_topical: false,
    /**
     * Still `awaiting_approval` even though its draft is blocked, and that is not an oversight.
     * §4.5 makes slot state derived rather than authored, and nothing in `lib/world.ts` writes a
     * slot state when a guardrail blocks. Authoring this as a new state would make the fixture
     * disagree with what the running code produces.
     */
    state: 'awaiting_approval',
    original_publish_at: null,
    slip_reason: null,
    calendar_run_id: runId('RUN-0132'),
  },
];

/* ================================================================================================
 * SCORES
 * ==============================================================================================*/

const bedstuyScores: ScoreComponents = {
  brand_voice: 0.9,
  claim_support: 0.86,
  pillar_fit: 0.92,
  channel_fit: 0.87,
  specificity: 0.84,
};

const diagramScores: ScoreComponents = {
  brand_voice: 0.89,
  claim_support: 0.85,
  pillar_fit: 0.9,
  channel_fit: 0.85,
  specificity: 0.8,
};

/**
 * Above the bar, and blocked anyway. This is the quality-gate-versus-safety-gate distinction the
 * board draws, made concrete: the score judges whether a draft is good and a person may overrule
 * it; L3 judges whether it is safe and nobody may. A draft that scored badly *and* failed L3 would
 * let a reviewer conclude the block was about quality.
 */
const knobScores: ScoreComponents = {
  brand_voice: 0.88,
  claim_support: 0.84,
  pillar_fit: 0.89,
  channel_fit: 0.83,
  specificity: 0.82,
};

/* ================================================================================================
 * VERSIONS
 * ==============================================================================================*/

const version = (
  id: DraftVersionId,
  createdAt: MinutesFromAnchor,
  text: string,
  hash: string,
): DraftVersion => ({
  id,
  version: 1,
  created_at: createdAt,
  text,
  author: 'agent',
  content_hash: hash,
  settings_version_id: SETTINGS_V3,
  token_count: text.trim().split(/\s+/).length,
  edit_tags: [],
});

/* ================================================================================================
 * DRAFTS
 * ==============================================================================================*/

export const batchDrafts: Draft[] = [
  {
    id: DRAFT_BEDSTUY,
    slot_id: SLOT_BEDSTUY,
    pillar_id: PILLAR_FIELD_NOTES,
    channel: 'x',
    run_id: RUN_BEDSTUY,
    state: 'awaiting_approval',
    queued_at: minutes(-28 * HOUR + 47),
    current_version_id: V_BEDSTUY,
    versions: [
      version(
        V_BEDSTUY,
        minutes(-28 * HOUR + 45),
        bedstuyText,
        'sha256:2d7f10a4c9b83e615d0247fa8c93b1e07a6d54cf82910be374a5d6c081f9e243',
      ),
    ],
    score_components: bedstuyScores,
    score_weights: WEIGHTS,
    composite_score: composite(bedstuyScores),
    deterministic_checks: [
      { check: 'length', result: 'pass', detail: '38 tokens, inside the X limit.' },
      { check: 'placeholders', result: 'pass', detail: 'No unresolved placeholders.' },
      { check: 'links', result: 'pass', detail: 'No outbound links.' },
      { check: 'banned_exact_match', result: 'pass', detail: 'No banned phrase present.' },
    ],
    degraded: false,
    blocked_reason: null,
    similarity: null,
    variant_group_id: null,
    source_refs: [],
    example_refs: [],
    applied_reflection_rule_ids: [],
    applied_rejection_reason_ids: [],
  },
  {
    id: DRAFT_DIAGRAM,
    slot_id: SLOT_DIAGRAM,
    pillar_id: PILLAR_OLD_BUILDINGS,
    channel: 'x',
    run_id: RUN_DIAGRAM,
    state: 'awaiting_approval',
    queued_at: minutes(-28 * HOUR + 52),
    current_version_id: V_DIAGRAM,
    versions: [
      version(
        V_DIAGRAM,
        minutes(-28 * HOUR + 50),
        diagramText,
        'sha256:b41c8e07d2596af31640ec8b5d92710fa3c6e08419db27f5a6013cd48e2b70f9',
      ),
    ],
    score_components: diagramScores,
    score_weights: WEIGHTS,
    composite_score: composite(diagramScores),
    deterministic_checks: [
      { check: 'length', result: 'pass', detail: '31 tokens, inside the X limit.' },
      { check: 'placeholders', result: 'pass', detail: 'No unresolved placeholders.' },
      { check: 'links', result: 'pass', detail: 'No outbound links.' },
      { check: 'banned_exact_match', result: 'pass', detail: 'No banned phrase present.' },
    ],
    degraded: false,
    blocked_reason: null,
    similarity: null,
    variant_group_id: null,
    source_refs: [],
    example_refs: [],
    applied_reflection_rule_ids: [],
    applied_rejection_reason_ids: [],
  },
  {
    id: DRAFT_KNOB,
    slot_id: SLOT_KNOB,
    pillar_id: PILLAR_OLD_BUILDINGS,
    channel: 'linkedin',
    run_id: RUN_KNOB,
    /** The state that removes the approve control. */
    state: 'blocked_guardrail',
    queued_at: minutes(-28 * HOUR + 58),
    current_version_id: V_KNOB,
    versions: [
      version(
        V_KNOB,
        minutes(-28 * HOUR + 56),
        knobText,
        'sha256:6ea20c8f47b1d395e0f8a26b71c4390d5f8e1027ba36c9d4708f5e2a91bc0d63',
      ),
    ],
    score_components: knobScores,
    score_weights: WEIGHTS,
    composite_score: composite(knobScores),
    deterministic_checks: [
      { check: 'length', result: 'pass', detail: '46 tokens, LinkedIn limit 2800 characters.' },
      { check: 'placeholders', result: 'pass', detail: 'No unresolved placeholders.' },
      { check: 'links', result: 'pass', detail: 'No outbound links.' },
      /**
       * The mechanical check and the guardrail agree, which they must: `banned_exact_match` is the
       * same lookup run at scoring time. A fixture where one passed and the other failed would make
       * the pair look like two opinions rather than one list consulted twice.
       */
      { check: 'banned_exact_match', result: 'fail', detail: 'Matched "guaranteed savings".' },
    ],
    degraded: false,
    blocked_reason: {
      code: 'banned_claim',
      note: '"guaranteed savings" is on the banned list, set at onboarding.',
    },
    similarity: null,
    variant_group_id: null,
    source_refs: [],
    example_refs: [],
    applied_reflection_rule_ids: [],
    applied_rejection_reason_ids: [],
  },
];

/* ================================================================================================
 * RUNS
 * ==============================================================================================*/

const childRun = (
  id: RunId,
  target: DraftId,
  startedAt: MinutesFromAnchor,
  checkpoint: string,
): Run => ({
  id,
  client_id: CLIENT_ID,
  type: 'draft',
  parent_run_id: RUN_PARENT,
  /** Halted at its gate. This state is what the review queue is a view of. */
  state: 'awaiting_human',
  checkpoint_ref: checkpoint,
  trigger: 'schedule.weekly_draft',
  park_reason: null,
  end_reason: null,
  started_at: startedAt,
  ended_at: null,
  step_cap: 20,
  degraded: false,
  settings_version_id: SETTINGS_V3,
  target_draft_id: target,
  target_post_id: null,
  next_sweep_at: null,
  variant: 'nominal',
});

export const batchRuns: Run[] = [
  childRun(RUN_BEDSTUY, DRAFT_BEDSTUY, BATCH_START, 'ckpt:0150:interrupt:draft_approval'),
  childRun(RUN_DIAGRAM, DRAFT_DIAGRAM, BATCH_START, 'ckpt:0151:interrupt:draft_approval'),
  /**
   * A blocked draft still waits on a person — the board routes it to the operator with the rule and
   * the offending sentence marked, and the operator decides whether to rewrite or drop the slot. So
   * this halts at a human gate like the others; what differs is which controls that gate offers.
   */
  childRun(RUN_KNOB, DRAFT_KNOB, BATCH_START, 'ckpt:0152:interrupt:draft_blocked'),
];

/* ================================================================================================
 * STEPS
 * ==============================================================================================*/

function childSteps(
  run: RunId,
  draft: DraftId,
  prefix: string,
  channel: 'linkedin' | 'x',
  pillarId: string,
  offset: number,
  blocked: boolean,
): RunStep[] {
  const id = (seq: number) => stepId(`${prefix}-0${seq}`);
  const at = (s: number) => t(offset + s);
  return [
    step({
      id: id(1),
      run_id: run,
      seq: 1,
      type: 'thinking',
      label: 'Loading the slot',
      started_at: at(0),
      latency_ms: 2200,
      playback_ms: 600,
      model: 'claude-opus-5',
      model_snapshot: 'opus-5-2026-05-14',
      tokens_in: 2080,
      tokens_out: 154,
      cost_model_usd: 0.0328,
      thinking_text:
        'Pulling the pillar description, the active writing rules and the tone settings before ' +
        'drafting this ' +
        (channel === 'linkedin' ? 'LinkedIn' : 'X') +
        ' slot.',
    }),
    step({
      id: id(2),
      run_id: run,
      seq: 2,
      type: 'tool_call',
      label: 'Looking up posts that performed',
      started_at: at(6),
      latency_ms: 880,
      playback_ms: 460,
      tool_name: 'retrieve_examples',
      tool_input: { pillar_id: pillarId, channel, k: 3 },
    }),
    step({
      id: id(3),
      run_id: run,
      seq: 3,
      type: 'tool_result',
      label: 'Found 2 past posts to draw on',
      started_at: at(8),
      latency_ms: 140,
      playback_ms: 440,
      tool_name: 'retrieve_examples',
      outcome: 'ok',
      tool_output: { returned: 2, cosine: [0.79, 0.74] },
    }),
    step({
      id: id(4),
      run_id: run,
      seq: 4,
      type: 'action',
      label: 'Writing the draft',
      started_at: at(11),
      latency_ms: 18_600,
      playback_ms: 880,
      model: 'claude-opus-5',
      model_snapshot: 'opus-5-2026-05-14',
      tokens_in: 3740,
      tokens_out: 288,
      cost_model_usd: 0.0691,
      output_ref: `trace://${prefix.replace('RS-', '')}/step-4/output`,
      produced: { entity_type: 'draft', id: draft },
      applied_inputs: [
        { kind: 'setting', id: 'tone.register', label: 'plain, technical, first person plural' },
        { kind: 'setting', id: 'tone.banned_phrases', label: '4 banned phrases in force' },
      ],
    }),
    step({
      id: id(5),
      run_id: run,
      seq: 5,
      type: 'action',
      label: 'Scoring the draft',
      started_at: at(31),
      latency_ms: 5400,
      playback_ms: 760,
      model: 'claude-sonnet-5',
      model_snapshot: 'sonnet-5-2026-04-02',
      tokens_in: 1980,
      tokens_out: 96,
      cost_model_usd: 0.0104,
    }),
    step({
      id: id(6),
      run_id: run,
      seq: 6,
      type: 'guardrail',
      label: 'Checking the finished draft',
      started_at: at(37),
      latency_ms: 3200,
      playback_ms: 700,
      guardrail_event_id: eventId(`GE-${prefix.replace('RS-', '')}-01`),
    }),
    step({
      id: id(7),
      run_id: run,
      seq: 7,
      type: 'interrupt',
      label: 'Waiting for a decision',
      started_at: at(41),
      latency_ms: 0,
      playback_ms: 520,
      interrupt: {
        gate: 'draft_approval',
        /**
         * Still the operator either way. A block does not change who decides, only what they may
         * decide.
         */
        awaiting: 'operator',
        /**
         * THE POLICY, EXPRESSED IN DATA RATHER THAN IN A COMPONENT.
         *
         * A blocked draft's gate does not offer `approve`. The board is explicit that an L3 failure
         * cannot be approved and that the control is removed from the item, because L3 tests rules
         * the client set at onboarding rather than a judgement about quality — a reviewer overriding
         * one would be the client overriding themselves with no record of it.
         *
         * Putting that in `options` rather than in a disabled button means the interface renders
         * what the gate offers instead of deciding for itself which button to grey out. Two screens
         * cannot then disagree, and `scripts/check.mts` can assert it.
         *
         * `approve_with_edits` survives, and must: editing the phrase is the route forward. The
         * board notes the edit is re-checked before it can be approved, so this is not a loophole.
         */
        options: blocked
          ? ['approve_with_edits', 'reject', 'escalate']
          : ['approve', 'approve_with_edits', 'reject', 'escalate'],
        deadline:
          channel === 'linkedin' ? minutes(6 * DAY - 1 * HOUR) : minutes(4 * DAY + 3 * HOUR),
      },
    }),
  ];
}

export const batchSteps: RunStep[] = [
  ...childSteps(RUN_BEDSTUY, DRAFT_BEDSTUY, 'RS-0150', 'x', 'PIL-003', 0, false),
  ...childSteps(RUN_DIAGRAM, DRAFT_DIAGRAM, 'RS-0151', 'x', 'PIL-004', 300, false),
  ...childSteps(RUN_KNOB, DRAFT_KNOB, 'RS-0152', 'linkedin', 'PIL-004', 600, true),
];

/* ================================================================================================
 * GUARDRAIL EVENTS
 * ==============================================================================================*/

const passing = (
  id: string,
  run: RunId,
  stepRef: RunStepId,
  draft: DraftId,
  rule: GuardrailEvent['rule_id'],
  at: MinutesFromAnchor,
  detail: string,
): GuardrailEvent => ({
  id: eventId(id),
  run_id: run,
  run_step_id: stepRef,
  draft_id: draft,
  rule_id: rule,
  trigger_kind: 'guardrail',
  result: 'pass',
  evaluated_at: at,
  offending_span: null,
  span_withheld: false,
  withheld_reason: null,
  escalation_tier: 'none',
  escalation_trigger: null,
  raised_at: at,
  acknowledged_at: null,
  was_unnecessary: null,
  labelled_at: null,
  labelled_by: null,
  source_url: null,
  domain_flagged: false,
  replies: [],
  decision_deadline: null,
  detail,
  /** Lookups and embeddings decide nothing that needs explaining. */
  rationale: null,
});

export const batchEvents: GuardrailEvent[] = [
  passing(
    'GE-0150-01',
    RUN_BEDSTUY,
    stepId('RS-0150-06'),
    DRAFT_BEDSTUY,
    RULE_BANNED_CLAIM,
    minutes(-28 * HOUR + 46),
    'No banned phrase present.',
  ),
  passing(
    'GE-0150-02',
    RUN_BEDSTUY,
    stepId('RS-0150-06'),
    DRAFT_BEDSTUY,
    RULE_SIMILARITY,
    minutes(-28 * HOUR + 46),
    'Nearest published post scores 0.38. Well inside the limit.',
  ),
  passing(
    'GE-0151-01',
    RUN_DIAGRAM,
    stepId('RS-0151-06'),
    DRAFT_DIAGRAM,
    RULE_BANNED_CLAIM,
    minutes(-28 * HOUR + 51),
    'No banned phrase present.',
  ),
  passing(
    'GE-0151-02',
    RUN_DIAGRAM,
    stepId('RS-0151-06'),
    DRAFT_DIAGRAM,
    RULE_ENTAILMENT,
    minutes(-28 * HOUR + 51),
    'No quantitative claim to check.',
  ),
  /**
   * THE BLOCK. `result: 'fail'` on a `block`-severity rule is what removes the approve control, and
   * the span is stored in full because the operator is not this rule's target — unlike an injection
   * event, where withholding is the whole point.
   */
  {
    id: eventId('GE-0152-01'),
    run_id: RUN_KNOB,
    run_step_id: stepId('RS-0152-06'),
    draft_id: DRAFT_KNOB,
    rule_id: RULE_BANNED_CLAIM,
    trigger_kind: 'guardrail',
    result: 'fail',
    evaluated_at: minutes(-28 * HOUR + 57),
    offending_span: {
      start: BANNED_SPAN_START,
      end: BANNED_SPAN_END,
      text: 'Guaranteed savings',
      version_id: V_KNOB,
    },
    span_withheld: false,
    withheld_reason: null,
    escalation_tier: 'operator',
    escalation_trigger: 'guardrail_fail',
    raised_at: minutes(-28 * HOUR + 57),
    acknowledged_at: null,
    was_unnecessary: null,
    labelled_at: null,
    labelled_by: null,
    source_url: null,
    domain_flagged: false,
    replies: [],
    decision_deadline: minutes(6 * DAY - 1 * HOUR),
    detail:
      'Blocked on a banned claim. "guaranteed savings" is on the list the client set at ' +
      'onboarding. Editing the phrase re-runs the check; the slot can also be dropped.',
    /**
     * Null, and this is the case the field's contract exists for. `banned_claim` runs on `lookup`:
     * a string matched a list. Prose here would imply a model weighed something, and the reviewer
     * would reasonably read it as a judgement they could argue with. There is nothing to argue with.
     */
    rationale: null,
  },
  passing(
    'GE-0152-02',
    RUN_KNOB,
    stepId('RS-0152-06'),
    DRAFT_KNOB,
    RULE_PII,
    minutes(-28 * HOUR + 57),
    'No personal data found.',
  ),
];

/* ================================================================================================
 * APPROVALS
 * ==============================================================================================*/

const pending = (
  id: string,
  versionRef: DraftVersionId,
  queuedAt: MinutesFromAnchor,
  pillarId: string,
  channel: 'linkedin' | 'x',
): Approval => ({
  id: approvalId(id),
  draft_version_id: versionRef,
  decision: null,
  reason_code: null,
  reason_note: null,
  queued_at: queuedAt,
  decided_at: null,
  seconds_open: null,
  decided_by: null,
  operator_id: OPERATOR_ID,
  superseded_by: null,
  pillar_id: pillarId as Approval['pillar_id'],
  channel_at_decision: channel,
});

export const batchApprovals: Approval[] = [
  pending('APR-0150', V_BEDSTUY, minutes(-28 * HOUR + 47), PILLAR_FIELD_NOTES, 'x'),
  pending('APR-0151', V_DIAGRAM, minutes(-28 * HOUR + 52), PILLAR_OLD_BUILDINGS, 'x'),
  /**
   * A blocked draft still has a pending approval row. The row is created at the interrupt, not at
   * the decision — so it exists the moment the run stops for a person, whatever that person is
   * permitted to do next. Without it the blocked item would be invisible to every query that finds
   * work by looking for undecided approvals.
   */
  pending('APR-0152', V_KNOB, minutes(-28 * HOUR + 58), PILLAR_OLD_BUILDINGS, 'linkedin'),
];

/** Unused import guard: PILLAR_COST is re-exported for symmetry with the pillar set. */
export const BATCH_PILLARS = [PILLAR_COST, PILLAR_FIELD_NOTES, PILLAR_OLD_BUILDINGS] as const;
