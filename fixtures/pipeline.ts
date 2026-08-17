/**
 * THE LIVE PIPELINE — the slice the console, queue and detail view are built against.
 *
 * This is not the full dataset. It is the smallest set that exercises the whole seam end to end:
 * fixtures → the simulated client → the transitions → React. The settled history that feeds the
 * dashboard's aggregates arrives later and is mostly generated; everything here is hand-written,
 * because these are the records a reviewer actually reads.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SHAPE OF THE WEEK, SO THE OFFSETS BELOW MAKE SENSE
 *
 * The anchor is Thursday 10:00 client-local, and the schedule is weekday-shaped (A-01):
 *
 *   Monday 06:00      planning run proposes next week's slots, then stops for the owner
 *   Wednesday 06:00   drafting batch — one parent run, one independent child per slot
 *   Thursday 10:00    ← you are here. Yesterday's batch is in the queue with a full runway
 *   next Mon–Wed      the slots those drafts publish into
 *
 * That is why the anchor's weekday is load-bearing rather than cosmetic: an anchor on the wrong
 * day puts the Wednesday batch on a Sunday and makes every runway figure below wrong.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THE FOUR RUNS ARE FOR
 *
 *   RUN-0141  nominal, completed at the approval interrupt. The showcase trace, and the draft the
 *             detail view opens. Scores above threshold.
 *   RUN-0142  nominal, completed at the interrupt, but its draft trips the claim-entailment
 *             guardrail with a warn AND scores below threshold. Two drafts in `awaiting_approval`
 *             that differ *only* by guardrail result is the only place the three-state guardrail
 *             becomes legible in the product (§4.7).
 *   RUN-0143  RUNNING, right now, mid-flight. The console has to be able to attach to a run it
 *             did not start (§4.2), which means the emitter must support starting at an offset —
 *             a requirement that is invisible until a fixture forces it.
 *   RUN-0144  the `tool_failure` variant. Pre-written alternate sequence the failure drawer swaps
 *             in. Lives here rather than with the later fixtures because the console's drawer
 *             needs it at Step 8, and the rest of the variants do not arrive until Step 10.
 *
 * ONE RUN PRODUCES ONE DRAFT. `Run.target_draft_id` is singular and the architecture fans out one
 * child run per slot, so "one run with two drafts" is not expressible — a plan that assumed
 * otherwise would have been caught here by the compiler.
 */

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
  PostId,
  Run,
  RunId,
  RunStep,
  RunStepId,
  ScoreComponents,
  ScoreWeights,
} from '../lib/types.ts';
import {
  CLIENT_ID,
  PILLAR_COMPLIANCE,
  PILLAR_COST,
  PILLAR_FIELD_NOTES,
} from './client.ts';
import { OPERATOR_ID, SETTINGS_V3 } from './settings.ts';
import { RULE_BANNED_CLAIM, RULE_ENTAILMENT, RULE_INJECTION, RULE_PII } from './guardrailRules.ts';
import { RULE_LEAD_WITH_BUILDING } from './reflectionRules.ts';
import { FIXTURE_SCHEMA_VERSION, type FixtureSchemaVersion } from './schema.ts';

export const schemaVersion: FixtureSchemaVersion = FIXTURE_SCHEMA_VERSION;

const HOUR = 60;
const DAY = 24 * HOUR;

const slotId = (n: string) => n as CalendarSlotId;
const draftId = (n: string) => n as DraftId;
const versionId = (n: string) => n as DraftVersionId;
const runId = (n: string) => n as RunId;
const stepId = (n: string) => n as RunStepId;
const eventId = (n: string) => n as GuardrailEventId;
const approvalId = (n: string) => n as ApprovalId;

export const RUN_PARENT = runId('RUN-0140');
export const RUN_CLEAN = runId('RUN-0141');
export const RUN_WARNED = runId('RUN-0142');
export const RUN_LIVE = runId('RUN-0143');
export const RUN_TOOL_FAILURE = runId('RUN-0144');

export const DRAFT_CLEAN = draftId('DRAFT-0141');
export const DRAFT_WARNED = draftId('DRAFT-0142');
export const DRAFT_LIVE = draftId('DRAFT-0143');

/* ================================================================================================
 * SCORING
 * A-10's five rubric dimensions and their weights. The weights are data sitting next to the scores
 * rather than a constant buried in a function, because a single returned number hides whether the
 * weights were applied at all — and showing the arithmetic is the antidote to that.
 * ==============================================================================================*/

const WEIGHTS: ScoreWeights = {
  brand_voice: 0.3,
  claim_support: 0.25,
  pillar_fit: 0.2,
  channel_fit: 0.15,
  specificity: 0.1,
};

/**
 * The weighted mean, computed here rather than typed in by hand.
 *
 * `Draft.composite_score` is R1's fourth and last exception: derived and cached, so the queue can
 * sort without recomputing on every render. Cached is not the same as invented — if the cached
 * value disagreed with the components, the components would win. Computing it at module load is
 * what guarantees they never disagree in the first place, and it costs nothing because the whole
 * fixture set is built once.
 */
function composite(c: ScoreComponents): number {
  const raw =
    c.brand_voice * WEIGHTS.brand_voice +
    c.claim_support * WEIGHTS.claim_support +
    c.pillar_fit * WEIGHTS.pillar_fit +
    c.channel_fit * WEIGHTS.channel_fit +
    c.specificity * WEIGHTS.specificity;
  return Math.round(raw * 1000) / 1000;
}

/* ================================================================================================
 * STEP HELPER
 * ==============================================================================================*/

/**
 * `RunStep` has thirty fields and most of them are null on most steps. Writing all thirty out
 * forty times would bury the six that carry the meaning of each step, and every added field would
 * mean forty edits.
 *
 * So this fills the nulls and the caller supplies what matters. It is a fixture-authoring
 * convenience, not an abstraction: the returned object is a plain `RunStep`, fully typed, and
 * nothing at runtime knows this function existed.
 */
function step(
  partial: Pick<RunStep, 'id' | 'run_id' | 'seq' | 'type' | 'label' | 'started_at'> &
    Partial<RunStep>,
): RunStep {
  return {
    thinking_text: null,
    /** C2 · the honest number. A drafting call really does take about twenty seconds. */
    latency_ms: 400,
    /**
     * C2 · the watchable number, and a demo affordance with no production counterpart.
     * A run played at its true four-minute duration is unwatchable; a uniform 300ms tick is the
     * faked streaming the brief explicitly rejects. Two fields, and the README states the ratio
     * rather than leaving a reviewer to infer that the timings are invented.
     */
    playback_ms: 700,
    model: null,
    model_snapshot: null,
    tokens_in: 0,
    tokens_out: 0,
    cost_model_usd: 0,
    cost_platform_usd: 0,
    input_hash: null,
    output_ref: null,
    tool_input: null,
    tool_output: null,
    tool_name: null,
    outcome: null,
    error: null,
    attempt: 1,
    max_attempts: 3,
    backoff_ms: null,
    sources: [],
    brief_ref: null,
    applied_inputs: [],
    guardrail_event_id: null,
    produced: null,
    interrupt: null,
    proposed_calendar: null,
    ...partial,
  };
}

/* ================================================================================================
 * SLOTS — next week's publishing plan, ratified by Monday's planning run
 * ==============================================================================================*/

const SLOT_CLEAN = slotId('SLOT-0211');
const SLOT_WARNED = slotId('SLOT-0212');
const SLOT_LIVE = slotId('SLOT-0213');

export const calendarSlots: CalendarSlot[] = [
  {
    id: SLOT_CLEAN,
    pillar_id: PILLAR_COMPLIANCE,
    channel: 'linkedin',
    /** Next Monday 09:00. Four days out, so the review runway is comfortable. */
    publish_at: minutes(4 * DAY - 1 * HOUR),
    angle: 'What the next compliance period actually asks of a 30-unit building',
    is_topical: false,
    state: 'awaiting_approval',
    original_publish_at: null,
    slip_reason: null,
    calendar_run_id: runId('RUN-0132'),
  },
  {
    id: SLOT_WARNED,
    pillar_id: PILLAR_COST,
    channel: 'x',
    /** Next Tuesday 08:30. */
    publish_at: minutes(5 * DAY - 90),
    angle: 'Payback maths, plainly',
    is_topical: false,
    state: 'awaiting_approval',
    original_publish_at: null,
    slip_reason: null,
    calendar_run_id: runId('RUN-0132'),
  },
  {
    id: SLOT_LIVE,
    pillar_id: PILLAR_FIELD_NOTES,
    channel: 'x',
    /** Next Wednesday 12:00. Being drafted right now by the live run. */
    publish_at: minutes(6 * DAY + 2 * HOUR),
    angle: 'The cavity nobody had recorded',
    is_topical: false,
    state: 'awaiting_approval',
    original_publish_at: null,
    slip_reason: null,
    calendar_run_id: runId('RUN-0132'),
  },
];

/* ================================================================================================
 * DRAFT 0141 — clean, above threshold. The showcase.
 * ==============================================================================================*/

const V_CLEAN = versionId('DV-0141-1');

const cleanText =
  'A 30-unit building in Crown Heights came to us in March convinced it needed a full ' +
  'electrification retrofit before the next compliance period.\n\n' +
  'It did not. It needed its steam traps replaced, its risers balanced, and about forty hours of ' +
  'air sealing in the basement and roof bulkhead.\n\n' +
  'That is not a story about heat pumps. It is a story about the order you do things in. The ' +
  'envelope work was a fraction of the cost of the equipment upgrade, it moved the building ' +
  'under its cap for this period, and it made the eventual heat pump smaller and cheaper when ' +
  'the building is ready for one.\n\n' +
  'The compliance clock rewards sequencing. Most owners we meet are being sold the last step ' +
  'first.';

const draftCleanVersions: DraftVersion[] = [
  {
    id: V_CLEAN,
    version: 1,
    created_at: minutes(-28 * HOUR + 41),
    text: cleanText,
    author: 'agent',
    content_hash: 'sha256:9f2c41ab6e0d5a7b3c8e14d0f6a92b57cc3e8d1a4b6f02e9d7c5a831b04e2f6d',
    settings_version_id: SETTINGS_V3,
    token_count: 168,
    edit_tags: [],
  },
];

const cleanScores: ScoreComponents = {
  brand_voice: 0.93,
  claim_support: 0.88,
  pillar_fit: 0.91,
  channel_fit: 0.86,
  specificity: 0.79,
};

/* ================================================================================================
 * DRAFT 0142 — warned by the entailment check, and below threshold.
 *
 * This draft exists to carry two things at once that would otherwise need two fixtures:
 *
 *   The claim-entailment guardrail firing on a real number in real text — "cuts a building's
 *   heating bill by about 40%" is exactly the kind of quantitative claim about the world that
 *   A-18 says must be entailed by a cited source, and this draft's sources do not support it.
 *
 *   A composite score below the 0.85 threshold, so the queue's review flag has something to
 *   attach to. This is what replaces the low-score failure switch that D-041 cut: the behaviour
 *   is demonstrated by dragging the threshold in Settings across this draft, which the reviewer
 *   does themselves rather than watching a scripted switch.
 * ==============================================================================================*/

const V_WARNED = versionId('DV-0142-1');

const warnedText =
  'Heat pumps cut a building’s heating bill by about 40%. The payback maths is simpler than most ' +
  'owners expect once you stack the incentives.\n\n' +
  'Happy to walk anyone through it.';

const draftWarnedVersions: DraftVersion[] = [
  {
    id: V_WARNED,
    version: 1,
    created_at: minutes(-28 * HOUR + 52),
    text: warnedText,
    author: 'agent',
    content_hash: 'sha256:41b0d8e37c5a296a1c4e70b93d28f5177ba0c6e394d1528fa7b03cd6e9142a08',
    settings_version_id: SETTINGS_V3,
    token_count: 44,
    edit_tags: [],
  },
];

const warnedScores: ScoreComponents = {
  brand_voice: 0.74,
  /** The dimension the guardrail's finding shows up in. A number with no source in the draft's own
   *  cited material scores badly here *and* trips L3 — two independent signals agreeing, which is
   *  what makes the queue row legible rather than mysterious. */
  claim_support: 0.61,
  pillar_fit: 0.88,
  channel_fit: 0.82,
  specificity: 0.55,
};

/* ================================================================================================
 * DRAFT 0143 — being written right now by the live run
 * ==============================================================================================*/

const V_LIVE = versionId('DV-0143-1');

const liveText =
  'We opened a wall on Sterling Place expecting solid brick and found a cavity nobody had ' +
  'recorded — not on the drawings, not in the 1987 alteration file, not in anyone’s memory.\n\n' +
  'Three feet of it, running the height of the party wall, packed with what forty years ago ' +
  'someone decided was insulation.';

export const drafts: Draft[] = [
  {
    id: DRAFT_CLEAN,
    slot_id: SLOT_CLEAN,
    pillar_id: PILLAR_COMPLIANCE,
    channel: 'linkedin',
    run_id: RUN_CLEAN,
    state: 'awaiting_approval',
    /** When the draft first entered review. Distinct from `Approval.queued_at`, which records when
     *  *this* review began — they differ for a redraft, and the queue's p95 measures the second. */
    queued_at: minutes(-28 * HOUR + 44),
    current_version_id: V_CLEAN,
    versions: draftCleanVersions,
    score_components: cleanScores,
    score_weights: WEIGHTS,
    composite_score: composite(cleanScores),
    deterministic_checks: [
      { check: 'length', result: 'pass', detail: '168 tokens, LinkedIn limit 2800 characters.' },
      { check: 'placeholders', result: 'pass', detail: 'No unresolved placeholders.' },
      { check: 'disclaimers', result: 'pass', detail: 'No disclaimer required for this pillar.' },
      { check: 'links', result: 'pass', detail: 'No outbound links.' },
      { check: 'banned_exact_match', result: 'pass', detail: 'No banned phrase present.' },
    ],
    degraded: false,
    blocked_reason: null,
    similarity: {
      published: { max_cosine: 0.42, against_post_id: 'POST-0098' as PostId },
      batch: null,
      window_days: 30,
      same_channel: true,
    },
    variant_group_id: null,
    source_refs: ['https://www.nyc.gov/site/sustainablebuildings/ll97/local-law-97.page'],
    example_refs: [],
    applied_reflection_rule_ids: [RULE_LEAD_WITH_BUILDING],
    applied_rejection_reason_ids: [],
  },
  {
    id: DRAFT_WARNED,
    slot_id: SLOT_WARNED,
    pillar_id: PILLAR_COST,
    channel: 'x',
    run_id: RUN_WARNED,
    state: 'awaiting_approval',
    queued_at: minutes(-28 * HOUR + 55),
    current_version_id: V_WARNED,
    versions: draftWarnedVersions,
    score_components: warnedScores,
    score_weights: WEIGHTS,
    composite_score: composite(warnedScores),
    deterministic_checks: [
      { check: 'length', result: 'pass', detail: '44 tokens, X limit 280 characters.' },
      { check: 'placeholders', result: 'pass', detail: 'No unresolved placeholders.' },
      { check: 'disclaimers', result: 'pass', detail: 'No disclaimer required for this pillar.' },
      { check: 'links', result: 'pass', detail: 'No outbound links.' },
      { check: 'banned_exact_match', result: 'pass', detail: 'No banned phrase present.' },
    ],
    degraded: false,
    blocked_reason: null,
    similarity: null,
    variant_group_id: null,
    source_refs: ['https://www.nyserda.ny.gov/all-programs/clean-heat'],
    example_refs: [],
    applied_reflection_rule_ids: [],
    applied_rejection_reason_ids: [],
  },
  {
    id: DRAFT_LIVE,
    slot_id: SLOT_LIVE,
    pillar_id: PILLAR_FIELD_NOTES,
    channel: 'x',
    run_id: RUN_LIVE,
    /** The state that lasts milliseconds in production and is the console's whole subject here.
     *  Not yet queued for review, so `queued_at` is null. */
    state: 'drafting',
    queued_at: null,
    current_version_id: V_LIVE,
    versions: [
      {
        id: V_LIVE,
        version: 1,
        created_at: minutes(-1),
        text: liveText,
        author: 'agent',
        content_hash:
          'sha256:c70a1e4b8d23f95a6c08b4e17d3a2f60e9b5c841da70e3f92b6d5847ac10e2b3',
        settings_version_id: SETTINGS_V3,
        token_count: 71,
        edit_tags: [],
      },
    ],
    score_components: { brand_voice: 0, claim_support: 0, pillar_fit: 0, channel_fit: 0, specificity: 0 },
    score_weights: WEIGHTS,
    /** Zero because it has not been scored yet — the run has not reached the scoring node. The
     *  console renders this as "not yet scored", never as a score of zero. */
    composite_score: 0,
    deterministic_checks: [],
    degraded: false,
    blocked_reason: null,
    similarity: null,
    variant_group_id: null,
    source_refs: [],
    example_refs: [],
    applied_reflection_rule_ids: [],
    applied_rejection_reason_ids: [],
  },
];

/* ================================================================================================
 * APPROVALS — created at the interrupt, not at the decision
 *
 * Both rows below are pending. `decided_at: null` is what *means* pending, which is why there is
 * no separate status field, and it is why these rows exist at all before anyone has clicked
 * anything: the queue orders on `Approval.queued_at`, and queue-age p95 has no start without it.
 * ==============================================================================================*/

export const approvals: Approval[] = [
  {
    id: approvalId('APR-0141'),
    draft_version_id: V_CLEAN,
    decision: null,
    reason_code: null,
    reason_note: null,
    queued_at: minutes(-28 * HOUR + 44),
    decided_at: null,
    seconds_open: null,
    decided_by: null,
    operator_id: OPERATOR_ID,
    superseded_by: null,
    pillar_id: PILLAR_COMPLIANCE,
    channel_at_decision: 'linkedin',
  },
  {
    id: approvalId('APR-0142'),
    draft_version_id: V_WARNED,
    decision: null,
    reason_code: null,
    reason_note: null,
    queued_at: minutes(-28 * HOUR + 55),
    decided_at: null,
    seconds_open: null,
    decided_by: null,
    operator_id: OPERATOR_ID,
    superseded_by: null,
    pillar_id: PILLAR_COST,
    channel_at_decision: 'x',
  },
];

/* ================================================================================================
 * RUNS
 * ==============================================================================================*/

const BATCH_START = minutes(-28 * HOUR);

export const runs: Run[] = [
  {
    id: RUN_PARENT,
    client_id: CLIENT_ID,
    type: 'draft',
    parent_run_id: null,
    state: 'completed',
    checkpoint_ref: 'ckpt:0140:final',
    trigger: 'schedule.weekly_draft',
    park_reason: null,
    end_reason: null,
    started_at: BATCH_START,
    ended_at: minutes(-28 * HOUR + 3),
    step_cap: 20,
    degraded: false,
    settings_version_id: SETTINGS_V3,
    target_draft_id: null,
    target_post_id: null,
    next_sweep_at: null,
    variant: 'nominal',
  },
  {
    id: RUN_CLEAN,
    client_id: CLIENT_ID,
    type: 'draft',
    /** Fan-out: the parent spawns one independent child per slot, so two failing does not fail the
     *  week. That independence is why RUN-0144 can park without touching these. */
    parent_run_id: RUN_PARENT,
    /** Halted at the approval interrupt. This state *is* the work queue. */
    state: 'awaiting_human',
    checkpoint_ref: 'ckpt:0141:interrupt:draft_approval',
    trigger: 'schedule.weekly_draft',
    park_reason: null,
    end_reason: null,
    started_at: minutes(-28 * HOUR + 3),
    ended_at: null,
    step_cap: 20,
    degraded: false,
    settings_version_id: SETTINGS_V3,
    target_draft_id: DRAFT_CLEAN,
    target_post_id: null,
    next_sweep_at: null,
    variant: 'nominal',
  },
  {
    id: RUN_WARNED,
    client_id: CLIENT_ID,
    type: 'draft',
    parent_run_id: RUN_PARENT,
    state: 'awaiting_human',
    checkpoint_ref: 'ckpt:0142:interrupt:draft_approval',
    trigger: 'schedule.weekly_draft',
    park_reason: null,
    end_reason: null,
    started_at: minutes(-28 * HOUR + 3),
    ended_at: null,
    step_cap: 20,
    degraded: false,
    settings_version_id: SETTINGS_V3,
    target_draft_id: DRAFT_WARNED,
    target_post_id: null,
    next_sweep_at: null,
    variant: 'nominal',
  },
  {
    id: RUN_LIVE,
    client_id: CLIENT_ID,
    type: 'draft',
    /** No parent: triggered by hand a few minutes ago, not by the Wednesday batch. `manual.run_now`
     *  is also §6b's unlock — it is what makes every "next draft" setting demonstrable, because
     *  without a run on demand a tone change takes effect at a moment nobody is watching. */
    parent_run_id: null,
    state: 'running',
    checkpoint_ref: 'ckpt:0143:step:6',
    trigger: 'manual.run_now',
    park_reason: null,
    end_reason: null,
    /** Four minutes ago. The console must be able to attach to this rather than only to runs it
     *  started itself, which is what forces the emitter to support starting at an offset. */
    started_at: minutes(-4),
    ended_at: null,
    step_cap: 20,
    degraded: false,
    settings_version_id: SETTINGS_V3,
    target_draft_id: DRAFT_LIVE,
    target_post_id: null,
    next_sweep_at: null,
    variant: 'nominal',
  },
  {
    id: RUN_TOOL_FAILURE,
    client_id: CLIENT_ID,
    type: 'draft',
    parent_run_id: null,
    /** Sweep-eligible: a transient failure parks here and the hourly sweep retries it. The
     *  distinction from `parked_blocked` is the release event — a clock versus a human action. */
    state: 'parked_transient',
    checkpoint_ref: 'ckpt:0144:step:5',
    trigger: 'manual.run_now',
    park_reason: 'upstream_error',
    end_reason: null,
    started_at: minutes(-95),
    ended_at: null,
    step_cap: 20,
    degraded: false,
    settings_version_id: SETTINGS_V3,
    target_draft_id: null,
    target_post_id: null,
    /** A parked run must show when it will be retried, or parking is indistinguishable from
     *  death. This is what the `<Countdown>` component renders on the queue's run-backed row. */
    next_sweep_at: minutes(25),
    variant: 'tool_failure',
  },
];

/* ================================================================================================
 * RUN STEPS
 *
 * The record the highest-weighted screen is made of. Four sequences, hand-written.
 *
 * `t()` places a step a number of seconds into its run. Fractional minutes are fine —
 * `MinutesFromAnchor` is a number, and a step stream where everything lands on a whole minute
 * reads as generated. The gaps between steps are what create the sense of a system doing work
 * rather than a list being revealed.
 * ==============================================================================================*/

const t = (runStart: number, secondsIn: number): MinutesFromAnchor =>
  minutes(runStart + secondsIn / 60);

const CLEAN_START = -28 * HOUR + 3;
const WARNED_START = -28 * HOUR + 3;
const LIVE_START = -4;
const FAIL_START = -95;

const cleanSteps: RunStep[] = [
  step({
    id: stepId('RS-0141-01'),
    run_id: RUN_CLEAN,
    seq: 1,
    type: 'thinking',
    label: 'Load slot context',
    started_at: t(CLEAN_START, 0),
    thinking_text:
      'Slot is Monday 09:00 LinkedIn, pillar "The compliance clock", angle "what the next ' +
      'compliance period actually asks of a 30-unit building". This pillar is always-review, so ' +
      'whatever I produce goes to a person regardless of score. Two operator briefs are open; ' +
      'one of them is about a Crown Heights job that fits this angle exactly.',
    model: 'claude-opus-5',
    model_snapshot: 'opus-5-2026-05-14',
    tokens_in: 2140,
    tokens_out: 180,
    cost_model_usd: 0.0384,
    latency_ms: 3100,
    playback_ms: 1400,
    input_hash: 'sha256:6b1e…c904',
  }),
  step({
    id: stepId('RS-0141-02'),
    run_id: RUN_CLEAN,
    seq: 2,
    type: 'tool_call',
    label: 'search_sources',
    started_at: t(CLEAN_START, 4),
    tool_name: 'search_sources',
    tool_input: {
      query: 'Local Law 97 compliance period multifamily under 30 units',
      since_days: 21,
      limit: 8,
      allowlist_only: true,
    },
    latency_ms: 900,
    playback_ms: 600,
  }),
  step({
    id: stepId('RS-0141-03'),
    run_id: RUN_CLEAN,
    seq: 3,
    type: 'tool_result',
    label: 'search_sources → 3 candidates',
    started_at: t(CLEAN_START, 5),
    tool_name: 'search_sources',
    outcome: 'ok',
    tool_output: {
      candidates: 3,
      rejected_off_allowlist: 5,
      urls: [
        'https://www.nyc.gov/site/sustainablebuildings/ll97/local-law-97.page',
        'https://www.urbangreencouncil.org/…/retrofit-sequencing',
        'https://www.nyserda.ny.gov/all-programs/clean-heat',
      ],
    },
    latency_ms: 1240,
    playback_ms: 700,
  }),
  step({
    id: stepId('RS-0141-04'),
    run_id: RUN_CLEAN,
    seq: 4,
    type: 'tool_call',
    label: 'fetch_source',
    started_at: t(CLEAN_START, 7),
    tool_name: 'fetch_source',
    tool_input: { url: 'https://www.nyc.gov/site/sustainablebuildings/ll97/local-law-97.page' },
    latency_ms: 1800,
    playback_ms: 700,
  }),
  step({
    id: stepId('RS-0141-05'),
    run_id: RUN_CLEAN,
    seq: 5,
    type: 'tool_result',
    label: 'fetch_source → 1 document',
    started_at: t(CLEAN_START, 11),
    tool_name: 'fetch_source',
    outcome: 'ok',
    tool_output: { bytes: 48210, content_type: 'text/html', trusted: false },
    /**
     * `guard_result` on a source is not decoration. This is untrusted external text, and the fact
     * that it passed L1 is the reason it is allowed to reach a summarising prompt at all.
     * `why_selected` is what makes the choice of source legible rather than magical — a reviewer
     * asking "why this page" gets an answer from the trace instead of from me.
     */
    sources: [
      {
        url: 'https://www.nyc.gov/site/sustainablebuildings/ll97/local-law-97.page',
        domain: 'nyc.gov',
        title: 'Local Law 97 — Sustainable Buildings',
        publisher: 'City of New York',
        fetched_at: t(CLEAN_START, 11),
        summary:
          'Official overview of the emissions caps, the compliance periods and the reporting ' +
          'obligation. Primary source; no interpretation.',
        citations: ['Compliance periods and reporting obligations'],
        guard_result: 'pass',
        why_selected:
          'Primary source on the allowlist. The pillar forbids stating a penalty figure without ' +
          'a citation, so a first-party page is worth more here than commentary.',
      },
    ],
    latency_ms: 2400,
    playback_ms: 900,
  }),
  step({
    id: stepId('RS-0141-06'),
    run_id: RUN_CLEAN,
    seq: 6,
    type: 'guardrail',
    label: 'L1 · instructions hidden in a source',
    started_at: t(CLEAN_START, 14),
    guardrail_event_id: eventId('GE-0141-01'),
    latency_ms: 260,
    playback_ms: 600,
  }),
  step({
    id: stepId('RS-0141-07'),
    run_id: RUN_CLEAN,
    seq: 7,
    type: 'thinking',
    label: 'Summarise sources',
    started_at: t(CLEAN_START, 15),
    thinking_text:
      'Summarising to a fixed schema with citations retained. Raw page text never reaches the ' +
      'drafting prompt — the drafter sees this summary and its citations, not the HTML.',
    /** Haiku, because summarising to a fixed schema is bulk work and paying for the capable model
     *  here would be spending on the wrong step (A-03). */
    model: 'claude-haiku-4-5',
    model_snapshot: 'haiku-4-5-20251001',
    tokens_in: 11840,
    tokens_out: 320,
    cost_model_usd: 0.0114,
    latency_ms: 4200,
    playback_ms: 1100,
  }),
  step({
    id: stepId('RS-0141-08'),
    run_id: RUN_CLEAN,
    seq: 8,
    type: 'tool_call',
    label: 'retrieve_examples',
    started_at: t(CLEAN_START, 21),
    tool_name: 'retrieve_examples',
    tool_input: { pillar: 'The compliance clock', channel: 'linkedin', k: 2, min_maturity_days: 7 },
    latency_ms: 480,
    playback_ms: 600,
  }),
  step({
    id: stepId('RS-0141-09'),
    run_id: RUN_CLEAN,
    seq: 9,
    type: 'tool_result',
    label: 'retrieve_examples → 2 posts',
    started_at: t(CLEAN_START, 22),
    tool_name: 'retrieve_examples',
    outcome: 'ok',
    /** Top performers only. No negative examples, ever — in-context examples get imitated, so
     *  showing the model what not to do shows it what to do (A-05). */
    tool_output: { returned: 2, pool: 24, percentile_floor: 75, negative_examples: 0 },
    latency_ms: 520,
    playback_ms: 700,
  }),
  step({
    id: stepId('RS-0141-10'),
    run_id: RUN_CLEAN,
    seq: 10,
    type: 'action',
    label: 'Write the draft',
    started_at: t(CLEAN_START, 24),
    thinking_text:
      'Leading with the building rather than the equipment, per the active writing rule. The ' +
      'brief gives me a specific job with a specific outcome, so the post can be concrete without ' +
      'naming the address — the PII rule blocks that and the neighbourhood carries the same ' +
      'weight anyway.',
    model: 'claude-opus-5',
    model_snapshot: 'opus-5-2026-05-14',
    tokens_in: 4820,
    tokens_out: 410,
    cost_model_usd: 0.0921,
    /** The honest number. Drafting really is the slow step. */
    latency_ms: 19_400,
    playback_ms: 2600,
    /**
     * §6b's load-bearing requirement, and the field that closes the brief's two hardest loops.
     *
     * A rejection "visibly changing what the agent does next" and a setting "visibly changing
     * simulated agent behaviour" are both demonstrated by the next run's drafting step listing
     * what it consumed. In the running prototype this array is assembled from *current settings at
     * run time* rather than read from the fixture — which is what makes `run_now` convert every
     * "next draft" setting from undemonstrable to demonstrable.
     */
    applied_inputs: [
      { kind: 'reflection_rule', id: 'REF-003', label: 'Open on the building, not the technology' },
      { kind: 'setting', id: 'tone.register', label: 'plain, technical, first person plural' },
      { kind: 'setting', id: 'terminology', label: 'owner, not landlord' },
      { kind: 'example', id: 'POST-0091', label: 'Top-quartile compliance post, 12 Jul' },
    ],
    brief_ref: {
      author: 'Marco Ilves — field supervisor',
      submitted_at: minutes(-3 * DAY),
      text:
        'Crown Heights job finished. Owner came in wanting a full electrification package before ' +
        'the deadline and we talked them down to traps, balancing and air sealing. Came in well ' +
        'under, got them under the cap for this period, and the heat pump they eventually buy is ' +
        'now a smaller unit. Worth writing up — we see this every month.',
    },
    produced: { entity_type: 'draft', id: DRAFT_CLEAN },
    output_ref: 'trace://0141/step-10/output',
  }),
  step({
    id: stepId('RS-0141-11'),
    run_id: RUN_CLEAN,
    seq: 11,
    type: 'guardrail',
    label: 'L2 · schema, length, links',
    started_at: t(CLEAN_START, 45),
    guardrail_event_id: eventId('GE-0141-02'),
    latency_ms: 90,
    playback_ms: 500,
  }),
  step({
    id: stepId('RS-0141-12'),
    run_id: RUN_CLEAN,
    seq: 12,
    type: 'action',
    label: 'Score the draft',
    started_at: t(CLEAN_START, 46),
    thinking_text:
      'Mechanical checks first, no model. Then the rubric — five dimensions, returned separately. ' +
      'The weighted mean is computed here rather than asked for, because models are unreliable at ' +
      'multi-term arithmetic and a single returned number would hide whether the weights were ' +
      'applied at all.',
    /** Judge is not the drafter. Different model, deliberately (A-10). */
    model: 'claude-sonnet-5',
    model_snapshot: 'sonnet-5-2026-04-02',
    tokens_in: 3960,
    tokens_out: 240,
    cost_model_usd: 0.0198,
    latency_ms: 6100,
    playback_ms: 1600,
  }),
  step({
    id: stepId('RS-0141-13'),
    run_id: RUN_CLEAN,
    seq: 13,
    type: 'guardrail',
    label: 'L3 · banned phrases, regulated claims, personal data, sources',
    started_at: t(CLEAN_START, 53),
    guardrail_event_id: eventId('GE-0141-03'),
    latency_ms: 3400,
    playback_ms: 1500,
  }),
  step({
    id: stepId('RS-0141-14'),
    run_id: RUN_CLEAN,
    seq: 14,
    type: 'interrupt',
    label: 'Waiting for your approval',
    started_at: t(CLEAN_START, 57),
    thinking_text:
      'Scored 0.882, above the 0.85 threshold, and every guardrail passed. This pillar is ' +
      'always-review, and in this version every post goes to a person regardless — so the score ' +
      'decides where this sits in your queue, not whether you see it.',
    interrupt: {
      gate: 'draft_approval',
      awaiting: 'operator',
      options: ['approve', 'approve_with_edits', 'reject', 'escalate'],
      /** The slot's publish time minus the redraft runway. Past this the slot slips and surfaces
       *  as at-risk rather than quietly missing. */
      deadline: minutes(3 * DAY - 1 * HOUR),
    },
    latency_ms: 40,
    playback_ms: 900,
  }),
];

const warnedSteps: RunStep[] = [
  step({
    id: stepId('RS-0142-01'),
    run_id: RUN_WARNED,
    seq: 1,
    type: 'thinking',
    label: 'Load slot context',
    started_at: t(WARNED_START, 0),
    thinking_text:
      'Slot is Tuesday 08:30 on X, pillar "What it actually costs". No operator brief covers ' +
      'this angle, so this will be commentary from allowlisted sources rather than from a job we ' +
      'did. That is the weaker of the two kinds of post and worth noting.',
    model: 'claude-opus-5',
    model_snapshot: 'opus-5-2026-05-14',
    tokens_in: 1980,
    tokens_out: 140,
    cost_model_usd: 0.0331,
    latency_ms: 2700,
    playback_ms: 1200,
  }),
  step({
    id: stepId('RS-0142-02'),
    run_id: RUN_WARNED,
    seq: 2,
    type: 'tool_call',
    label: 'fetch_source',
    started_at: t(WARNED_START, 3),
    tool_name: 'fetch_source',
    tool_input: { url: 'https://www.nyserda.ny.gov/all-programs/clean-heat' },
    latency_ms: 1500,
    playback_ms: 650,
  }),
  step({
    id: stepId('RS-0142-03'),
    run_id: RUN_WARNED,
    seq: 3,
    type: 'tool_result',
    label: 'fetch_source → 1 document',
    started_at: t(WARNED_START, 6),
    tool_name: 'fetch_source',
    outcome: 'ok',
    tool_output: { bytes: 21440, content_type: 'text/html', trusted: false },
    sources: [
      {
        url: 'https://www.nyserda.ny.gov/all-programs/clean-heat',
        domain: 'nyserda.ny.gov',
        title: 'NYSERDA Clean Heat',
        publisher: 'NYSERDA',
        fetched_at: t(WARNED_START, 6),
        summary:
          'Programme overview: incentive structure and eligibility. Describes how incentives are ' +
          'calculated. Does not state a percentage reduction in heating bills.',
        citations: ['Incentive structure', 'Eligibility'],
        guard_result: 'pass',
        why_selected: 'Only allowlisted source covering incentive stacking for this angle.',
      },
    ],
    latency_ms: 1900,
    playback_ms: 800,
  }),
  step({
    id: stepId('RS-0142-04'),
    run_id: RUN_WARNED,
    seq: 4,
    type: 'guardrail',
    label: 'L1 · instructions hidden in a source',
    started_at: t(WARNED_START, 9),
    guardrail_event_id: eventId('GE-0142-01'),
    latency_ms: 240,
    playback_ms: 550,
  }),
  step({
    id: stepId('RS-0142-05'),
    run_id: RUN_WARNED,
    seq: 5,
    type: 'action',
    label: 'Write the draft',
    started_at: t(WARNED_START, 11),
    model: 'claude-opus-5',
    model_snapshot: 'opus-5-2026-05-14',
    tokens_in: 3410,
    tokens_out: 120,
    cost_model_usd: 0.0604,
    latency_ms: 14_800,
    playback_ms: 2200,
    applied_inputs: [
      { kind: 'setting', id: 'tone.register', label: 'plain, technical, first person plural' },
    ],
    produced: { entity_type: 'draft', id: DRAFT_WARNED },
    output_ref: 'trace://0142/step-5/output',
  }),
  step({
    id: stepId('RS-0142-06'),
    run_id: RUN_WARNED,
    seq: 6,
    type: 'action',
    label: 'Score the draft',
    started_at: t(WARNED_START, 27),
    thinking_text:
      'Claim support scores 0.61 — the 40% figure is not in the source I actually cited. ' +
      'Specificity 0.55: this could have been written about any building anywhere. Composite ' +
      '0.727, below the 0.85 threshold.',
    model: 'claude-sonnet-5',
    model_snapshot: 'sonnet-5-2026-04-02',
    tokens_in: 2840,
    tokens_out: 210,
    cost_model_usd: 0.0142,
    latency_ms: 5400,
    playback_ms: 1500,
  }),
  step({
    id: stepId('RS-0142-07'),
    run_id: RUN_WARNED,
    seq: 7,
    type: 'guardrail',
    label: 'L3 · numbers need a source — WARN',
    started_at: t(WARNED_START, 33),
    thinking_text:
      'The draft claims heat pumps cut a building’s heating bill by about 40%. That is a ' +
      'quantitative claim about the world, so it needs to be entailed by a source this draft ' +
      'actually used. The NYSERDA page describes incentive structure and says nothing about a ' +
      'percentage. Warning rather than blocking: a person can add the source or cut the sentence, ' +
      'and blocking would send a fixable post into a dead end.',
    guardrail_event_id: eventId('GE-0142-02'),
    latency_ms: 3900,
    playback_ms: 1800,
  }),
  step({
    id: stepId('RS-0142-08'),
    run_id: RUN_WARNED,
    seq: 8,
    type: 'interrupt',
    label: 'Waiting for you — flagged',
    started_at: t(WARNED_START, 38),
    thinking_text:
      'Arriving flagged and sorted up: a warning on an unsupported number, and a score below ' +
      'threshold. Approve is still offered, because a warn is not a fail — you can decide the ' +
      'sentence is fine, or edit it, or send it back.',
    interrupt: {
      gate: 'draft_approval',
      awaiting: 'operator',
      options: ['approve', 'approve_with_edits', 'reject', 'escalate'],
      deadline: minutes(4 * DAY - 90),
    },
    latency_ms: 40,
    playback_ms: 900,
  }),
];

const liveSteps: RunStep[] = [
  step({
    id: stepId('RS-0143-01'),
    run_id: RUN_LIVE,
    seq: 1,
    type: 'thinking',
    label: 'Load slot context',
    started_at: t(LIVE_START, 0),
    thinking_text:
      'Manual run. Slot is next Wednesday on X, pillar "Field notes". There is an unused brief ' +
      'from the Sterling Place job that has been sitting for two days.',
    model: 'claude-opus-5',
    model_snapshot: 'opus-5-2026-05-14',
    tokens_in: 2010,
    tokens_out: 160,
    cost_model_usd: 0.0348,
    latency_ms: 2900,
    playback_ms: 1300,
  }),
  step({
    id: stepId('RS-0143-02'),
    run_id: RUN_LIVE,
    seq: 2,
    type: 'thinking',
    label: 'Select sources',
    started_at: t(LIVE_START, 4),
    thinking_text:
      'Operator briefs rank first. A brief-driven post cannot be generic — its substance exists ' +
      'nowhere else — so for this pillar I am not searching news at all.',
    model: 'claude-opus-5',
    model_snapshot: 'opus-5-2026-05-14',
    tokens_in: 1240,
    tokens_out: 90,
    cost_model_usd: 0.0198,
    latency_ms: 2100,
    playback_ms: 1100,
  }),
  step({
    id: stepId('RS-0143-03'),
    run_id: RUN_LIVE,
    seq: 3,
    type: 'tool_call',
    label: 'retrieve_examples',
    started_at: t(LIVE_START, 7),
    tool_name: 'retrieve_examples',
    tool_input: { pillar: 'Field notes', channel: 'x', k: 2, min_maturity_days: 7 },
    latency_ms: 460,
    playback_ms: 600,
  }),
  step({
    id: stepId('RS-0143-04'),
    run_id: RUN_LIVE,
    seq: 4,
    type: 'tool_result',
    label: 'retrieve_examples → 2 posts',
    started_at: t(LIVE_START, 8),
    tool_name: 'retrieve_examples',
    outcome: 'ok',
    tool_output: { returned: 2, pool: 11, percentile_floor: 75, negative_examples: 0 },
    latency_ms: 510,
    playback_ms: 650,
  }),
  step({
    id: stepId('RS-0143-05'),
    run_id: RUN_LIVE,
    seq: 5,
    type: 'action',
    label: 'Write the draft',
    started_at: t(LIVE_START, 11),
    model: 'claude-opus-5',
    model_snapshot: 'opus-5-2026-05-14',
    tokens_in: 3980,
    tokens_out: 190,
    cost_model_usd: 0.0742,
    latency_ms: 17_200,
    playback_ms: 2500,
    applied_inputs: [
      { kind: 'reflection_rule', id: 'REF-003', label: 'Open on the building, not the technology' },
      { kind: 'reflection_rule', id: 'REF-002', label: 'Say owner, not landlord' },
      { kind: 'setting', id: 'tone.register', label: 'plain, technical, first person plural' },
    ],
    brief_ref: {
      author: 'Marco Ilves — field supervisor',
      submitted_at: minutes(-2 * DAY - 4 * HOUR),
      text:
        'Sterling Place — opened the party wall expecting solid brick, found a cavity about three ' +
        'feet wide running full height. Not on the drawings, not in the 1987 alteration file. ' +
        'Packed with something someone once called insulation. Changed the whole air sealing ' +
        'scope. Photos on the shared drive.',
    },
    produced: { entity_type: 'draft', id: DRAFT_LIVE },
    output_ref: 'trace://0143/step-5/output',
  }),
  step({
    id: stepId('RS-0143-06'),
    run_id: RUN_LIVE,
    seq: 6,
    type: 'guardrail',
    label: 'L2 · schema, length, links',
    started_at: t(LIVE_START, 30),
    guardrail_event_id: eventId('GE-0143-01'),
    latency_ms: 80,
    playback_ms: 500,
  }),
  /* ---- everything below this line has not happened yet. The run is here, right now. --------- */
  step({
    id: stepId('RS-0143-07'),
    run_id: RUN_LIVE,
    seq: 7,
    type: 'action',
    label: 'Score the draft',
    started_at: t(LIVE_START, 32),
    thinking_text:
      'Mechanical checks first, then the rubric. This one has a specific building, a specific ' +
      'surprise and a specific consequence, so specificity should score well.',
    model: 'claude-sonnet-5',
    model_snapshot: 'sonnet-5-2026-04-02',
    tokens_in: 3120,
    tokens_out: 220,
    cost_model_usd: 0.0156,
    latency_ms: 5800,
    playback_ms: 1700,
  }),
  step({
    id: stepId('RS-0143-08'),
    run_id: RUN_LIVE,
    seq: 8,
    type: 'guardrail',
    label: 'L3 · personal data — checking the address',
    started_at: t(LIVE_START, 38),
    thinking_text:
      'The draft names Sterling Place. That is a street, not an address, and no unit number or ' +
      'owner name appears. Passing, but this is the check most likely to fire on this pillar.',
    guardrail_event_id: eventId('GE-0143-02'),
    latency_ms: 2900,
    playback_ms: 1600,
  }),
  step({
    id: stepId('RS-0143-09'),
    run_id: RUN_LIVE,
    seq: 9,
    type: 'guardrail',
    label: 'L3 · banned phrases, regulated claims, sources',
    started_at: t(LIVE_START, 42),
    guardrail_event_id: eventId('GE-0143-03'),
    latency_ms: 3100,
    playback_ms: 1400,
  }),
  step({
    id: stepId('RS-0143-10'),
    run_id: RUN_LIVE,
    seq: 10,
    type: 'interrupt',
    label: 'Waiting for your approval',
    started_at: t(LIVE_START, 46),
    interrupt: {
      gate: 'draft_approval',
      awaiting: 'operator',
      options: ['approve', 'approve_with_edits', 'reject', 'escalate'],
      deadline: minutes(5 * DAY + 2 * HOUR),
    },
    latency_ms: 40,
    playback_ms: 900,
  }),
];

/**
 * THE TOOL-FAILURE SEQUENCE — the drawer's alternate run.
 *
 * What makes this worth building rather than describing: the retry is visible as three separate
 * steps with the attempt number and the backoff gap both rendered, and the gaps are jittered
 * rather than uniform. A retry that is not visible in the trace is indistinguishable from a system
 * that simply took a long time.
 *
 * The run parks rather than failing. Parking is a dead-letter queue that kept its position in the
 * graph and stays visible in the operator's own queue, which is why there is no separate
 * dead-letter concept anywhere in this architecture.
 */
const toolFailureSteps: RunStep[] = [
  step({
    id: stepId('RS-0144-01'),
    run_id: RUN_TOOL_FAILURE,
    seq: 1,
    type: 'thinking',
    label: 'Load slot context',
    started_at: t(FAIL_START, 0),
    thinking_text: 'Manual run against the Thursday LinkedIn slot.',
    model: 'claude-opus-5',
    model_snapshot: 'opus-5-2026-05-14',
    tokens_in: 1960,
    tokens_out: 150,
    cost_model_usd: 0.0334,
    latency_ms: 2800,
    playback_ms: 1200,
  }),
  step({
    id: stepId('RS-0144-02'),
    run_id: RUN_TOOL_FAILURE,
    seq: 2,
    type: 'tool_call',
    label: 'fetch_source · attempt 1 of 3',
    started_at: t(FAIL_START, 4),
    tool_name: 'fetch_source',
    tool_input: { url: 'https://www.urbangreencouncil.org/reports/retrofit-sequencing' },
    attempt: 1,
    latency_ms: 20_000,
    playback_ms: 1400,
  }),
  step({
    id: stepId('RS-0144-03'),
    run_id: RUN_TOOL_FAILURE,
    seq: 3,
    type: 'tool_result',
    label: 'fetch_source → 503, retrying',
    started_at: t(FAIL_START, 25),
    tool_name: 'fetch_source',
    outcome: 'error',
    /** The agent-side error union, not the console's. Different boundaries: this is what an
     *  effector returns to the orchestrator, and `kind` is what drives retry-versus-park. */
    error: { kind: 'upstream_error', status: 503 },
    attempt: 1,
    backoff_ms: 1_180,
    latency_ms: 20_000,
    playback_ms: 900,
  }),
  step({
    id: stepId('RS-0144-04'),
    run_id: RUN_TOOL_FAILURE,
    seq: 4,
    type: 'tool_result',
    label: 'fetch_source → 503, retrying',
    started_at: t(FAIL_START, 47),
    tool_name: 'fetch_source',
    outcome: 'error',
    error: { kind: 'upstream_error', status: 503 },
    attempt: 2,
    /** Jittered, not doubled exactly. A backoff sequence of 1000/2000/4000 reads as a diagram;
     *  real jitter is what makes it read as a system. */
    backoff_ms: 2_430,
    latency_ms: 20_000,
    playback_ms: 900,
  }),
  step({
    id: stepId('RS-0144-05'),
    run_id: RUN_TOOL_FAILURE,
    seq: 5,
    type: 'tool_result',
    label: 'fetch_source → 503, attempts exhausted',
    started_at: t(FAIL_START, 71),
    tool_name: 'fetch_source',
    outcome: 'error',
    error: { kind: 'upstream_error', status: 503 },
    attempt: 3,
    backoff_ms: null,
    latency_ms: 20_000,
    playback_ms: 1100,
  }),
  step({
    id: stepId('RS-0144-06'),
    run_id: RUN_TOOL_FAILURE,
    seq: 6,
    type: 'thinking',
    label: 'Classify the failure',
    started_at: t(FAIL_START, 73),
    thinking_text:
      'Three attempts, all 503. That is transient, not permanent — the domain is still on the ' +
      'allowlist and the login is fine, the server is just down. Transient means park and let the ' +
      'hourly sweep retry, rather than dropping the slot. A permanent failure, like a revoked ' +
      'login, would park differently: no sweep, and it waits for the event that fixes it.',
    latency_ms: 120,
    playback_ms: 1300,
  }),
  step({
    id: stepId('RS-0144-07'),
    run_id: RUN_TOOL_FAILURE,
    seq: 7,
    type: 'guardrail',
    label: 'Escalation raised — tool failure',
    started_at: t(FAIL_START, 74),
    guardrail_event_id: eventId('GE-0144-01'),
    latency_ms: 60,
    playback_ms: 700,
  }),
  step({
    id: stepId('RS-0144-08'),
    run_id: RUN_TOOL_FAILURE,
    seq: 8,
    type: 'action',
    label: 'Parked — will retry automatically',
    started_at: t(FAIL_START, 75),
    thinking_text:
      'Parked with the checkpoint at step 5. The sweep runs hourly and will resume from there ' +
      'rather than starting over, so the two model calls already made are not paid for twice. ' +
      'The slot still has runway; if the source is still down by the second sweep this becomes ' +
      'your decision rather than mine.',
    tool_name: 'notify_operator',
    outcome: 'ok',
    tool_input: { event: 'run_parked', run_id: 'RUN-0144', idem_key: 'notify:0144:parked:1' },
    tool_output: { delivered: 'slack', at: 'immediately' },
    latency_ms: 340,
    playback_ms: 1000,
  }),
];

export const runSteps: RunStep[] = [
  ...cleanSteps,
  ...warnedSteps,
  ...liveSteps,
  ...toolFailureSteps,
];

/**
 * WHERE THE LIVE RUN HAS ACTUALLY GOT TO.
 *
 * Steps 1–6 of RUN-0143 have happened; 7–10 have not. The console attaches mid-flight and streams
 * the rest, which is the case §4.2 asks for and the reason the emitter cannot simply start at
 * step 1 and play forwards.
 *
 * Exported as data rather than hardcoded in the client so that the fixture, not the code, decides
 * where the story is up to.
 */
export const LIVE_RUN_EMITTED_THROUGH_SEQ = 6;

/* ================================================================================================
 * GUARDRAIL EVENTS
 *
 * R7 is the least intuitive rule in the spec and the easiest to skip: an evaluation emits an event
 * on `pass`, not only on warn or fail.
 *
 * The reason is that block rate's denominator is evaluations. A fixture author who writes only the
 * interesting rows leaves the metric with no denominator — and, worse, makes a rule that has
 * silently stopped being evaluated look identical to a rule that is passing everything. That is
 * why this is the second-largest collection in the full dataset.
 * ==============================================================================================*/

function passEvent(
  id: string,
  runIdent: RunId,
  runStepIdent: RunStepId,
  draftIdent: DraftId | null,
  ruleIdent: GuardrailEvent['rule_id'],
  evaluatedAt: MinutesFromAnchor,
  detail: string,
): GuardrailEvent {
  return {
    id: eventId(id),
    run_id: runIdent,
    run_step_id: runStepIdent,
    draft_id: draftIdent,
    rule_id: ruleIdent,
    trigger_kind: 'guardrail',
    result: 'pass',
    evaluated_at: evaluatedAt,
    offending_span: null,
    span_withheld: false,
    withheld_reason: null,
    escalation_tier: 'none',
    /** Null on a plain pass. `escalation_trigger` exists only where something was escalated, which
     *  is why it is separate from `trigger_kind` rather than the same field twice. */
    escalation_trigger: null,
    raised_at: evaluatedAt,
    acknowledged_at: null,
    was_unnecessary: null,
    labelled_at: null,
    labelled_by: null,
    source_url: null,
    domain_flagged: false,
    replies: [],
    decision_deadline: null,
    detail,
  };
}

export const guardrailEvents: GuardrailEvent[] = [
  passEvent(
    'GE-0141-01',
    RUN_CLEAN,
    stepId('RS-0141-06'),
    DRAFT_CLEAN,
    RULE_INJECTION,
    t(CLEAN_START, 14),
    '1 source scored for hidden instructions. Highest score 0.04, well under the 0.6 threshold.',
  ),
  passEvent(
    'GE-0141-02',
    RUN_CLEAN,
    stepId('RS-0141-11'),
    DRAFT_CLEAN,
    RULE_BANNED_CLAIM,
    t(CLEAN_START, 45),
    'No banned phrase present. 168 tokens, inside the LinkedIn limit. No outbound links.',
  ),
  passEvent(
    'GE-0141-03',
    RUN_CLEAN,
    stepId('RS-0141-13'),
    DRAFT_CLEAN,
    RULE_ENTAILMENT,
    t(CLEAN_START, 53),
    'No quantitative claim about the world requiring a source. No personal data. No regulated claim.',
  ),
  passEvent(
    'GE-0142-01',
    RUN_WARNED,
    stepId('RS-0142-04'),
    DRAFT_WARNED,
    RULE_INJECTION,
    t(WARNED_START, 9),
    '1 source scored for hidden instructions. Highest score 0.02.',
  ),
  {
    /**
     * THE WARN. Two drafts sit in `awaiting_approval` and differ only by this row, which is the
     * only place in the product where the three-state guardrail result becomes legible: a warned
     * draft is not a separate state, it is an ordinary queue item whose warning is rendered from
     * its event.
     */
    id: eventId('GE-0142-02'),
    run_id: RUN_WARNED,
    run_step_id: stepId('RS-0142-07'),
    draft_id: DRAFT_WARNED,
    rule_id: RULE_ENTAILMENT,
    trigger_kind: 'guardrail',
    result: 'warn',
    evaluated_at: t(WARNED_START, 33),
    /** Offsets plus the version they index. The detail view highlights the span in place rather
     *  than quoting it separately, which is why the version id has to travel with it. */
    offending_span: {
      start: 0,
      end: 54,
      text: 'Heat pumps cut a building’s heating bill by about 40%.',
      version_id: V_WARNED,
    },
    span_withheld: false,
    withheld_reason: null,
    escalation_tier: 'operator',
    /** A warn and a fail are two different triggers for precision purposes, not one. A warn routes
     *  to review; a fail blocks. Lumping them makes the precision cut useless on the commonest
     *  trigger of all. */
    escalation_trigger: 'guardrail_warn',
    raised_at: t(WARNED_START, 33),
    acknowledged_at: null,
    /** Tri-state, and unlabelled is not the same as correct. If unlabelled counted as warranted,
     *  escalation precision would read high by default. One click on the detail view sets this and
     *  the dashboard figure moves — the shortest causal chain in the product. */
    was_unnecessary: null,
    labelled_at: null,
    labelled_by: null,
    source_url: 'https://www.nyserda.ny.gov/all-programs/clean-heat',
    domain_flagged: false,
    replies: [],
    decision_deadline: minutes(4 * DAY - 90),
    detail:
      'The draft states a 40% reduction. The source it cited describes incentive structure and ' +
      'makes no such claim. Add a source that supports the figure, or cut it.',
  },
  passEvent(
    'GE-0143-01',
    RUN_LIVE,
    stepId('RS-0143-06'),
    DRAFT_LIVE,
    RULE_BANNED_CLAIM,
    t(LIVE_START, 30),
    'No banned phrase present. 71 tokens, inside the X limit.',
  ),
  passEvent(
    'GE-0143-02',
    RUN_LIVE,
    stepId('RS-0143-08'),
    DRAFT_LIVE,
    RULE_PII,
    t(LIVE_START, 38),
    'Street name only. No unit number, no owner name, no full address.',
  ),
  passEvent(
    'GE-0143-03',
    RUN_LIVE,
    stepId('RS-0143-09'),
    DRAFT_LIVE,
    RULE_ENTAILMENT,
    t(LIVE_START, 42),
    'No quantitative claim requiring a source. No regulated claim.',
  ),
  {
    /**
     * A tool failure has no guardrail behind it, which is exactly why `rule_id` is nullable and
     * why `trigger_kind` exists to make that null well-formed. Minting a synthetic "tool failure"
     * rule would have been the easy shortcut and would have corrupted the per-rule block-rate
     * chart with a row that is not a guardrail.
     */
    id: eventId('GE-0144-01'),
    run_id: RUN_TOOL_FAILURE,
    run_step_id: stepId('RS-0144-07'),
    draft_id: null,
    rule_id: null,
    trigger_kind: 'tool_failure',
    result: 'fail',
    evaluated_at: t(FAIL_START, 74),
    offending_span: null,
    span_withheld: false,
    withheld_reason: null,
    escalation_tier: 'operator',
    escalation_trigger: 'tool_failure',
    raised_at: t(FAIL_START, 74),
    acknowledged_at: null,
    was_unnecessary: null,
    labelled_at: null,
    labelled_by: null,
    source_url: 'https://www.urbangreencouncil.org/reports/retrofit-sequencing',
    domain_flagged: false,
    replies: [],
    decision_deadline: null,
    detail:
      'fetch_source returned 503 three times. Run parked; the hourly sweep will resume it from ' +
      'the checkpoint. No draft was produced.',
  },
];
