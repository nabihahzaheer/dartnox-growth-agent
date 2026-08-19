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
/**
 * The digest the running code uses, imported rather than reimplemented.
 *
 * `lib/world.ts` imports types and nothing else, so a fixture reaching for it creates no cycle.
 * The reason to do it rather than copy the four lines: a hash written here and a hash written by
 * `approve()` have to be produced by the same function, or the L4 match a scheduled post is
 * supposed to survive would be comparing outputs of two implementations that agree until one is
 * edited.
 */
import { contentDigest } from '../lib/world.ts';
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
  Post,
  PostId,
  Run,
  RunId,
  ProposedSlot,
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
  PILLAR_OLD_BUILDINGS,
} from './client.ts';
import { OPERATOR_ID, SETTINGS_V3 } from './settings.ts';
import {
  RULE_BANNED_CLAIM,
  RULE_ENTAILMENT,
  RULE_HASH_MATCH,
  RULE_INJECTION,
  RULE_PII,
} from './guardrailRules.ts';
import { HOSTILE_REPLY_POST_ID } from './history.ts';
import { RULE_LEAD_WITH_BUILDING } from './reflectionRules.ts';
import { FIXTURE_SCHEMA_VERSION, type FixtureSchemaVersion } from '../lib/types.ts';

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

/**
 * MONDAY'S PLANNING RUN — the agent's headline behaviour, and it was missing entirely.
 *
 * Option B's own description opens with *"plans a content calendar from brand pillars"*, and until
 * 17 Aug no run of type `planning` existed in the fixture set. Three consequences, all found by
 * someone trying to use the product rather than by any check:
 *
 *   · every live slot's `calendar_run_id` pointed at `RUN-0132`, which did not exist — a dangling
 *     reference in a field `scripts/check.mts` did not walk
 *   · `RunStep.proposed_calendar` was built specifically to carry a proposed week and was used by
 *     nothing, so the type described a capability the fixtures never exercised
 *   · there was nowhere in the product to answer "what is this agent going to do next week", which
 *     is the first question anyone asks of a content agent
 *
 * It ran Monday 06:00, proposed eight slots, validated them deterministically, and stopped for the
 * owner. The owner approved, and Wednesday's batch drafted against it.
 */
export const RUN_PLANNING = runId('RUN-0132');

export const RUN_PARENT = runId('RUN-0140');
export const RUN_CLEAN = runId('RUN-0141');
export const RUN_WARNED = runId('RUN-0142');
export const RUN_LIVE = runId('RUN-0143');
export const RUN_TOOL_FAILURE = runId('RUN-0144');
/** The two already-approved children of the same Wednesday batch. See "ALREADY APPROVED" below. */
export const RUN_PAYBACK = runId('RUN-0145');
export const RUN_RISERS = runId('RUN-0146');
/** D-041's remaining three narratives, each playable from the failure drawer. */
export const RUN_POISONED = runId('RUN-0147');
export const RUN_HOSTILE = runId('RUN-0148');
export const RUN_RECONCILE = runId('RUN-0149');

export const DRAFT_CLEAN = draftId('DRAFT-0141');
export const DRAFT_WARNED = draftId('DRAFT-0142');
export const DRAFT_LIVE = draftId('DRAFT-0143');
export const DRAFT_PAYBACK = draftId('DRAFT-0145');
export const DRAFT_RISERS = draftId('DRAFT-0146');

const SLOT_PAYBACK = slotId('SLOT-0214');
const SLOT_RISERS = slotId('SLOT-0215');

const V_PAYBACK = versionId('DV-0145-1');
const V_RISERS = versionId('DV-0146-1');

/* ================================================================================================
 * SCORING
 * A-10's five rubric dimensions and their weights. The weights are data sitting next to the scores
 * rather than a constant buried in a function, because a single returned number hides whether the
 * weights were applied at all — and showing the arithmetic is the antidote to that.
 * ==============================================================================================*/

export const WEIGHTS: ScoreWeights = {
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
export function composite(c: ScoreComponents): number {
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
export function step(
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

  /* ---- the two slots whose drafts are already approved and scheduled ---------------------- */
  {
    id: SLOT_PAYBACK,
    pillar_id: PILLAR_COST,
    channel: 'linkedin',
    /** Next Thursday 09:00, inside the LinkedIn window (Thu 08:00–10:00). Both of these sit inside
     *  their channel's configured posting window on purpose: L4 checks the window before it
     *  publishes, so a scheduled post outside one would be a fixture that fails its own guardrail. */
    publish_at: minutes(7 * DAY - 1 * HOUR),
    angle: 'What "pays for itself" actually depends on',
    is_topical: false,
    /**
     * `awaiting_approval` on a slot whose draft has been approved looks wrong and is correct.
     *
     * §4.5 makes slot state derived rather than authored, and `approve()` in `lib/world.ts`
     * deliberately writes no slot state — it returns drafts, approvals, posts and runs. So a slot
     * whose draft was approved through the product's own code path still carries whatever it had
     * before. Authoring these two any other way would make the fixture disagree with what the
     * running code produces, which is the drift `scripts/check.mts` exists to prevent.
     *
     * The honest gap this exposes: `CalendarSlotState` has no member for "approved, scheduled, not
     * yet published". Nothing renders slot state, and `publishedVsPlanned` excludes future slots
     * from its window, so it costs nothing today. Recorded rather than papered over.
     */
    state: 'awaiting_approval',
    original_publish_at: null,
    slip_reason: null,
    calendar_run_id: runId('RUN-0132'),
  },
  {
    id: SLOT_RISERS,
    pillar_id: PILLAR_OLD_BUILDINGS,
    channel: 'x',
    /** Next Friday 14:00, inside the X window (Fri 08:00–16:00). */
    publish_at: minutes(8 * DAY + 4 * HOUR),
    angle: 'Risers sized for a building that no longer exists',
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

/* ================================================================================================
 * DRAFTS 0145 AND 0146 — ALREADY APPROVED, SCHEDULED, NOT YET PUBLISHED
 *
 * Two more children of the same Wednesday batch, decided yesterday evening. They exist for a
 * reason the rest of the set could not supply.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY A SCHEDULED POST HAD TO EXIST AT ALL
 *
 * Adding a banned claim re-validates scheduled posts and returns any match to the queue — the
 * bonus the brief offers, and the one moment it explicitly awards credit for. Before these, every
 * `Post` in the set was `published`, and the only producer of a `scheduled` one was `approve()`.
 * So the sweep would have run across an empty set on a cold load and reported nothing, and the
 * reviewer would have had to approve a draft first and then guess a phrase occurring in that exact
 * text. A miss reads as a broken feature rather than as a demo they drove wrong.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY TWO AND NOT ONE, WHICH IS THE PART THAT ACTUALLY MATTERS
 *
 * One scheduled post cannot show the sweep discriminating. If the only scheduled post comes back
 * invalidated, "matched the phrase" and "invalidates everything it touches" produce identical
 * screens, and the reviewer has no way to tell which they are looking at.
 *
 * So 0145 carries the phrase and 0146 does not, and the sweep has to leave one of them alone. The
 * result the operator reads — one of two scheduled posts returned — is the claim being
 * demonstrated, not the fact that something happened.
 *
 * `scripts/check.mts` asserts both halves: that a scheduled post containing the phrase exists, and
 * that a scheduled post *not* containing it exists.
 *
 * ---------------------------------------------------------------------------------------------
 * THE PHRASE
 *
 * "pays for itself" — standard retrofit marketing, and exactly the kind of claim a careful owner's
 * counsel strikes, because payback depends on fuel price and on how the building is run. It is the
 * same family as the four already in `tone.banned_phrases` and is deliberately not one of them:
 * the four existing ones are already caught, so banning any of them again would demonstrate
 * nothing.
 *
 * Note what 0145 does *not* contain: any of `guaranteed savings`, `zero emissions`,
 * `no upfront cost` or `risk-free`. Its L3 pass event and its `banned_exact_match` deterministic
 * check both say it is clean, and a draft that tripped an existing rule while claiming to pass
 * would be a fixture lying about its own guardrails.
 * ==============================================================================================*/

/**
 * The phrase the settings demo turns on, named once.
 *
 * Exported because three places have to agree about it and none of them can see the others: the
 * post below has to contain it, the sibling post has to not, and `scripts/check.mts` asserts both.
 * Left as a literal in each, a reworded post would silently kill the demo and everything would
 * still pass.
 *
 * It is deliberately NOT in `tone.banned_phrases`. Adding a phrase that is already banned would
 * sweep nothing, because the draft would never have been approved carrying it.
 */
export const DEMO_BANNABLE_PHRASE = 'pays for itself';

const paybackText =
  'Owners ask whether a retrofit pays for itself. It is the right question, and the honest ' +
  'answer has three variables in it: what you pay for fuel, how the building is actually run, ' +
  'and which incentives you land.\n\n' +
  'We have costed the same scope at a four-year payback in one building and eleven in another ' +
  'two blocks away. The difference was not the equipment. It was a boiler nobody had rebalanced ' +
  'since 2009, and a super who kept the lobby windows open through February.\n\n' +
  'Ask for the assumptions behind any payback figure. If nobody will show you them, the figure ' +
  'is marketing.';

const risersText =
  'Steam risers in a 1920s building were sized for a heat load that no longer exists.\n\n' +
  'Half of balancing is undoing decisions made for a building that has since been insulated, ' +
  'subdivided and re-glazed.';

const paybackScores: ScoreComponents = {
  brand_voice: 0.91,
  claim_support: 0.87,
  pillar_fit: 0.94,
  channel_fit: 0.88,
  specificity: 0.84,
};

const risersScores: ScoreComponents = {
  brand_voice: 0.89,
  claim_support: 0.9,
  pillar_fit: 0.92,
  channel_fit: 0.87,
  specificity: 0.76,
};

export const drafts: Draft[] = [
  {
    id: DRAFT_CLEAN,
    slot_id: SLOT_CLEAN,
    pillar_id: PILLAR_COMPLIANCE,
    channel: 'linkedin',
    run_id: RUN_CLEAN,
    /** Still being written. `landRun` stamps `queued_at` when the run reaches its gate. */
    state: 'drafting',
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
      /** A real post in the set. This read `POST-0098`, which never existed — the similarity arms
       *  were among the fields nothing walked. A dangling comparison target renders as a
       *  similarity warning pointing at nothing. */
      published: { max_cosine: 0.42, against_post_id: 'POST-0101' as PostId },
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

  /* ---- approved yesterday evening, scheduled for next week -------------------------------- */
  {
    id: DRAFT_PAYBACK,
    slot_id: SLOT_PAYBACK,
    pillar_id: PILLAR_COST,
    channel: 'linkedin',
    run_id: RUN_PAYBACK,
    /** Terminal for a Draft (D-032). Everything after this point belongs to the Post. */
    state: 'approved',
    queued_at: minutes(-28 * HOUR + 61),
    current_version_id: V_PAYBACK,
    versions: [
      {
        id: V_PAYBACK,
        version: 1,
        created_at: minutes(-28 * HOUR + 58),
        text: paybackText,
        /** Agent-authored and approved unedited, so these two add decisions to the edit-rate
         *  denominator without adding to its numerator. Edit rate moves 25% → 23%, which is inside
         *  the band either way — worth checking rather than assuming, because two extra approvals
         *  are exactly the kind of change that quietly reddens a tile. */
        author: 'agent',
        /**
         * Computed by the same function `approve()` uses, not a hand-typed literal.
         *
         * L4 publishes only on a hash match against the approved version, and the settings sweep
         * invalidates by comparing that same pair. A fixture hash that did not actually digest its
         * own text would make both mechanisms look like they work while comparing two constants.
         */
        content_hash: contentDigest(paybackText),
        settings_version_id: SETTINGS_V3,
        token_count: paybackText.trim().split(/\s+/).length,
        edit_tags: [],
      },
    ],
    score_components: paybackScores,
    score_weights: WEIGHTS,
    composite_score: composite(paybackScores),
    deterministic_checks: [
      { check: 'length', result: 'pass', detail: '104 tokens, LinkedIn limit 2800 characters.' },
      { check: 'placeholders', result: 'pass', detail: 'No unresolved placeholders.' },
      { check: 'disclaimers', result: 'pass', detail: 'No disclaimer required for this pillar.' },
      { check: 'links', result: 'pass', detail: 'No outbound links.' },
      /** True at authoring time, and it has to be: "pays for itself" is not yet banned. That is the
       *  whole point — the reviewer adds it, and this draft's already-scheduled post comes back. */
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
    id: DRAFT_RISERS,
    slot_id: SLOT_RISERS,
    pillar_id: PILLAR_OLD_BUILDINGS,
    channel: 'x',
    run_id: RUN_RISERS,
    state: 'approved',
    queued_at: minutes(-28 * HOUR + 69),
    current_version_id: V_RISERS,
    versions: [
      {
        id: V_RISERS,
        version: 1,
        created_at: minutes(-28 * HOUR + 66),
        text: risersText,
        author: 'agent',
        content_hash: contentDigest(risersText),
        settings_version_id: SETTINGS_V3,
        token_count: risersText.trim().split(/\s+/).length,
        edit_tags: [],
      },
    ],
    score_components: risersScores,
    score_weights: WEIGHTS,
    composite_score: composite(risersScores),
    deterministic_checks: [
      { check: 'length', result: 'pass', detail: '33 tokens, X limit 280 characters.' },
      { check: 'placeholders', result: 'pass', detail: 'No unresolved placeholders.' },
      { check: 'disclaimers', result: 'pass', detail: 'No disclaimer required for this pillar.' },
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

  /* ---- decided yesterday evening. `decided_at` non-null is what makes these not pending ---- */
  {
    id: approvalId('APR-0145'),
    draft_version_id: V_PAYBACK,
    decision: 'approve',
    reason_code: null,
    reason_note: null,
    queued_at: minutes(-28 * HOUR + 61),
    decided_at: minutes(-19 * HOUR),
    /** Inclusive of reading time. Both are comfortably over fifteen seconds, so neither lands in
     *  the rubber-stamp bucket — a pair of approvals that both read as reflex clicks would move
     *  that tile for a reason that has nothing to do with the operator. */
    seconds_open: 112,
    decided_by: 'operator',
    operator_id: OPERATOR_ID,
    superseded_by: null,
    pillar_id: PILLAR_COST,
    channel_at_decision: 'linkedin',
  },
  {
    id: approvalId('APR-0146'),
    draft_version_id: V_RISERS,
    decision: 'approve',
    reason_code: null,
    reason_note: null,
    queued_at: minutes(-28 * HOUR + 69),
    decided_at: minutes(-19 * HOUR + 4),
    seconds_open: 64,
    decided_by: 'operator',
    operator_id: OPERATOR_ID,
    superseded_by: null,
    pillar_id: PILLAR_OLD_BUILDINGS,
    channel_at_decision: 'x',
  },
];

/* ================================================================================================
 * POSTS — the only `scheduled` records in the set
 *
 * R6/D-032: Post is authoritative from scheduling onward, which is why these are Posts and not a
 * draft state. Each binds the digest of the exact version that was approved — L4 publishes only on
 * a match against it, and the settings sweep invalidates by comparing that same pair.
 *
 * `published_at`, `platform_post_id` and `platform_url` are null because nothing has published.
 * That is the distinction the whole record exists for: scheduled is not published, and B1 having
 * only `scheduled_at` was the omission that made four metrics uncomputable.
 * ==============================================================================================*/

export const scheduledPosts: Post[] = [
  {
    id: 'POST-0145' as PostId,
    draft_version_id: V_PAYBACK,
    channel: 'linkedin',
    scheduled_at: minutes(7 * DAY - 1 * HOUR),
    state: 'scheduled',
    published_at: null,
    platform_post_id: null,
    platform_url: null,
    approved_content_hash: contentDigest(paybackText),
    idempotency_key: `pub:${DRAFT_PAYBACK}:${V_PAYBACK}`,
    /** LinkedIn is not pay-per-use; X is. The two addends behind cost per post. */
    platform_cost_usd: 0,
    invalidated_reason: null,
    pulled_at: null,
    pull_reason: null,
  },
  {
    id: 'POST-0146' as PostId,
    draft_version_id: V_RISERS,
    channel: 'x',
    scheduled_at: minutes(8 * DAY + 4 * HOUR),
    state: 'scheduled',
    published_at: null,
    platform_post_id: null,
    platform_url: null,
    approved_content_hash: contentDigest(risersText),
    idempotency_key: `pub:${DRAFT_RISERS}:${V_RISERS}`,
    platform_cost_usd: 0.02,
    invalidated_reason: null,
    pulled_at: null,
    pull_reason: null,
  },
];

/* ================================================================================================
 * RUNS
 * ==============================================================================================*/

/** Monday 06:00, three days before the anchor. The planning run's origin. */
const PLAN_START = -3 * DAY - 4 * HOUR;

export const BATCH_START = minutes(-28 * HOUR);

/** Start offsets for the three failure narratives, in minutes before the anchor. Declared here
 *  rather than beside their step arrays because the runs array below needs them first. */
const POISONED_START = -186;
const HOSTILE_START = -52;
const RECONCILE_START = -140;

export const runs: Run[] = [
  {
    id: RUN_PLANNING,
    client_id: CLIENT_ID,
    type: 'planning',
    parent_run_id: null,
    /** Completed: the owner approved on Tuesday, which is what let Wednesday's batch draft against
     *  it. The interrupt step stays in the trace as the record of what was put to them. */
    state: 'completed',
    checkpoint_ref: 'ckpt:0132:final',
    trigger: 'schedule.weekly_plan',
    park_reason: null,
    end_reason: null,
    started_at: minutes(PLAN_START),
    ended_at: minutes(PLAN_START + 26 * HOUR),
    step_cap: 20,
    degraded: false,
    settings_version_id: SETTINGS_V3,
    target_draft_id: null,
    target_post_id: null,
    next_sweep_at: null,
    variant: 'nominal',
  },
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
    /** One of the four still in flight when the console opens — see `batchRuns` in
     *  `fixtures/batch.ts`. The two left waiting are the warned draft and the blocked one, which is
     *  the more useful pair to land on anyway: both need a person, for different reasons. */
    state: 'running',
    checkpoint_ref: '',
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
    parent_run_id: RUN_PARENT,
    state: 'running',
    checkpoint_ref: 'ckpt:0143:step:6',
    /**
     * `schedule.weekly_draft`, not `manual.run_now`.
     *
     * This run is already in flight when the console opens, and its trigger made the header read
     * "Started by you" — for a run the operator had not started. So the one screen whose job is to
     * explain what the agent is doing opened by telling you a thing you knew to be false, and the
     * obvious next question was "why is it running, I did not press anything".
     *
     * It is a child of the Wednesday batch like the others, which is the honest answer: the agent
     * runs on a schedule, and you arrive mid-flight. `manual.run_now` still exists and is what the
     * Start-a-new-run button produces.
     */
    trigger: 'schedule.weekly_draft',
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

  /* ---- the two children that got all the way through --------------------------------------- */
  {
    id: RUN_PAYBACK,
    client_id: CLIENT_ID,
    type: 'draft',
    /** Same parent as the two still waiting. The batch fans out into children that each finish on
     *  their own — which is what makes "two of eight are still in the queue and two are already
     *  scheduled" an ordinary Thursday rather than a broken run. */
    parent_run_id: RUN_PARENT,
    /** `completed`, not `awaiting_human`: the interrupt was cleared when the operator approved. */
    state: 'completed',
    checkpoint_ref: 'ckpt:0145:final',
    trigger: 'schedule.weekly_draft',
    park_reason: null,
    end_reason: null,
    started_at: minutes(-28 * HOUR + 3),
    ended_at: minutes(-19 * HOUR),
    step_cap: 20,
    degraded: false,
    settings_version_id: SETTINGS_V3,
    target_draft_id: DRAFT_PAYBACK,
    target_post_id: 'POST-0145' as PostId,
    next_sweep_at: null,
    variant: 'nominal',
  },
  {
    id: RUN_RISERS,
    client_id: CLIENT_ID,
    type: 'draft',
    parent_run_id: RUN_PARENT,
    state: 'completed',
    checkpoint_ref: 'ckpt:0146:final',
    trigger: 'schedule.weekly_draft',
    park_reason: null,
    end_reason: null,
    started_at: minutes(-28 * HOUR + 3),
    ended_at: minutes(-19 * HOUR + 4),
    step_cap: 20,
    degraded: false,
    settings_version_id: SETTINGS_V3,
    target_draft_id: DRAFT_RISERS,
    target_post_id: 'POST-0146' as PostId,
    next_sweep_at: null,
    variant: 'nominal',
  },

  /* ---- the publish runs those approvals created -------------------------------------------- *
   *
   * Queued, with no steps, waiting for the scheduler to reach their slot. Shape and id copied from
   * what `approve()` writes rather than invented — `RUN-P<draft number>`, `step_cap` 20, started_at
   * equal to the post's scheduled time — so a reviewer who approves something in the queue gets a
   * rail entry indistinguishable from these two.
   *
   * A draft run never stays open waiting on a clock. That is the whole reason publishing is a
   * separate run and not a final step on the drafting graph.
   * ---------------------------------------------------------------------------------------------- */
  {
    id: runId('RUN-P0145'),
    client_id: CLIENT_ID,
    type: 'publish',
    parent_run_id: null,
    state: 'queued',
    checkpoint_ref: '',
    trigger: 'schedule.weekly_draft',
    park_reason: null,
    end_reason: null,
    started_at: minutes(7 * DAY - 1 * HOUR),
    ended_at: null,
    step_cap: 20,
    degraded: false,
    settings_version_id: SETTINGS_V3,
    target_draft_id: DRAFT_PAYBACK,
    target_post_id: 'POST-0145' as PostId,
    next_sweep_at: null,
    variant: 'nominal',
  },
  {
    id: runId('RUN-P0146'),
    client_id: CLIENT_ID,
    type: 'publish',
    parent_run_id: null,
    state: 'queued',
    checkpoint_ref: '',
    trigger: 'schedule.weekly_draft',
    park_reason: null,
    end_reason: null,
    started_at: minutes(8 * DAY + 4 * HOUR),
    ended_at: null,
    step_cap: 20,
    degraded: false,
    settings_version_id: SETTINGS_V3,
    target_draft_id: DRAFT_RISERS,
    target_post_id: 'POST-0146' as PostId,
    next_sweep_at: null,
    variant: 'nominal',
  },

  /* ---- the three remaining failure narratives (D-041) -------------------------------------- */
  {
    id: RUN_POISONED,
    client_id: CLIENT_ID,
    type: 'draft',
    parent_run_id: null,
    /** Human clearance only, and no draft was produced. The queue's run-backed arm exists for
     *  exactly this shape. */
    state: 'quarantined',
    checkpoint_ref: 'ckpt:0147:guard_input',
    trigger: 'manual.run_now',
    park_reason: 'injection_quarantine',
    end_reason: null,
    started_at: minutes(POISONED_START),
    ended_at: minutes(POISONED_START + 1),
    step_cap: 20,
    degraded: false,
    settings_version_id: SETTINGS_V3,
    target_draft_id: null,
    target_post_id: null,
    /** No sweep. An injection is not transient — the domain stays flagged until a person clears it,
     *  which is the difference between `quarantined` and `parked_transient`. */
    next_sweep_at: null,
    variant: 'poisoned_source',
  },
  {
    id: RUN_HOSTILE,
    client_id: CLIENT_ID,
    type: 'poll',
    parent_run_id: null,
    state: 'awaiting_human',
    checkpoint_ref: 'ckpt:0148:interrupt:post_publish_intervention',
    trigger: 'poll.engagement',
    park_reason: null,
    end_reason: null,
    started_at: minutes(HOSTILE_START),
    ended_at: null,
    step_cap: 20,
    degraded: false,
    settings_version_id: SETTINGS_V3,
    target_draft_id: null,
    target_post_id: HOSTILE_REPLY_POST_ID,
    next_sweep_at: null,
    variant: 'hostile_reply',
  },
  {
    id: RUN_RECONCILE,
    client_id: CLIENT_ID,
    type: 'publish',
    parent_run_id: null,
    /**
     * `parked_blocked`, not `parked_transient`. The distinction is the release event: a transient
     * park is re-armed by the clock, and this one cannot be — no amount of waiting resolves which
     * of two candidate posts is ours. It waits for a person.
     */
    state: 'parked_blocked',
    checkpoint_ref: 'ckpt:0149:step:6',
    trigger: 'schedule.weekly_draft',
    park_reason: 'awaiting_reconcile',
    end_reason: null,
    started_at: minutes(RECONCILE_START),
    ended_at: null,
    step_cap: 20,
    degraded: false,
    settings_version_id: SETTINGS_V3,
    target_draft_id: null,
    target_post_id: null,
    /** Deliberately null: retrying is the one thing this branch exists to refuse. */
    next_sweep_at: null,
    variant: 'auth_revoked',
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
    label: 'Loading the slot',
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
    playback_ms: 5_100,
    input_hash: 'sha256:6b1e…c904',
  }),
  step({
    id: stepId('RS-0141-02'),
    run_id: RUN_CLEAN,
    seq: 2,
    type: 'tool_call',
    label: 'Looking for sources',
    started_at: t(CLEAN_START, 4),
    tool_name: 'search_sources',
    tool_input: {
      query: 'Local Law 97 compliance period multifamily under 30 units',
      since_days: 21,
      limit: 8,
      allowlist_only: true,
    },
    latency_ms: 900,
    playback_ms: 2_800,
  }),
  step({
    id: stepId('RS-0141-03'),
    run_id: RUN_CLEAN,
    seq: 3,
    type: 'tool_result',
    label: 'Found 3 candidate sources',
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
    playback_ms: 3_200,
  }),
  step({
    id: stepId('RS-0141-04'),
    run_id: RUN_CLEAN,
    seq: 4,
    type: 'tool_call',
    label: 'Reading a source',
    started_at: t(CLEAN_START, 7),
    tool_name: 'fetch_source',
    tool_input: { url: 'https://www.nyc.gov/site/sustainablebuildings/ll97/local-law-97.page' },
    latency_ms: 1800,
    playback_ms: 3_900,
  }),
  step({
    id: stepId('RS-0141-05'),
    run_id: RUN_CLEAN,
    seq: 5,
    type: 'tool_result',
    label: 'Read 1 document',
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
    playback_ms: 4_500,
  }),
  step({
    id: stepId('RS-0141-06'),
    run_id: RUN_CLEAN,
    seq: 6,
    type: 'guardrail',
    label: 'Screening the sources',
    started_at: t(CLEAN_START, 14),
    guardrail_event_id: eventId('GE-0141-01'),
    latency_ms: 260,
    playback_ms: 1_500,
  }),
  step({
    id: stepId('RS-0141-07'),
    run_id: RUN_CLEAN,
    seq: 7,
    type: 'thinking',
    label: 'Summarising the sources',
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
    playback_ms: 6_000,
  }),
  step({
    id: stepId('RS-0141-08'),
    run_id: RUN_CLEAN,
    seq: 8,
    type: 'tool_call',
    label: 'Looking up posts that performed',
    started_at: t(CLEAN_START, 21),
    tool_name: 'retrieve_examples',
    tool_input: { pillar: 'The compliance clock', channel: 'linkedin', k: 2, min_maturity_days: 7 },
    latency_ms: 480,
    playback_ms: 2_000,
  }),
  step({
    id: stepId('RS-0141-09'),
    run_id: RUN_CLEAN,
    seq: 9,
    type: 'tool_result',
    label: 'Found 2 past posts to draw on',
    started_at: t(CLEAN_START, 22),
    tool_name: 'retrieve_examples',
    outcome: 'ok',
    /** Top performers only. No negative examples, ever — in-context examples get imitated, so
     *  showing the model what not to do shows it what to do (A-05). */
    tool_output: { returned: 2, pool: 24, percentile_floor: 75, negative_examples: 0 },
    latency_ms: 520,
    playback_ms: 2_100,
  }),
  step({
    id: stepId('RS-0141-10'),
    run_id: RUN_CLEAN,
    seq: 10,
    type: 'action',
    label: 'Writing the draft',
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
    playback_ms: 12_800,
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
    label: 'Checking format, length and links',
    started_at: t(CLEAN_START, 45),
    guardrail_event_id: eventId('GE-0141-02'),
    latency_ms: 90,
    playback_ms: 900,
  }),
  step({
    id: stepId('RS-0141-12'),
    run_id: RUN_CLEAN,
    seq: 12,
    type: 'action',
    label: 'Scoring the draft',
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
    playback_ms: 7_200,
  }),
  step({
    id: stepId('RS-0141-13'),
    run_id: RUN_CLEAN,
    seq: 13,
    type: 'guardrail',
    label: 'Checking the finished draft',
    started_at: t(CLEAN_START, 53),
    guardrail_event_id: eventId('GE-0141-03'),
    latency_ms: 3400,
    playback_ms: 5_400,
  }),
  step({
    id: stepId('RS-0141-14'),
    run_id: RUN_CLEAN,
    seq: 14,
    type: 'interrupt',
    label: 'Waiting for a decision',
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
    label: 'Loading the slot',
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
    label: 'Reading a source',
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
    label: 'Read 1 document',
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
    label: 'Screening the sources',
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
    label: 'Writing the draft',
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
    label: 'Scoring the draft',
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
    label: 'Checking claims against their sources',
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
    label: 'Waiting for a decision',
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
    label: 'Loading the slot',
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
    playback_ms: 7_100,
  }),
  step({
    id: stepId('RS-0143-02'),
    run_id: RUN_LIVE,
    seq: 2,
    type: 'thinking',
    label: 'Selecting sources',
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
    playback_ms: 6_100,
  }),
  step({
    id: stepId('RS-0143-03'),
    run_id: RUN_LIVE,
    seq: 3,
    type: 'tool_call',
    label: 'Looking up posts that performed',
    started_at: t(LIVE_START, 7),
    tool_name: 'retrieve_examples',
    tool_input: { pillar: 'Field notes', channel: 'x', k: 2, min_maturity_days: 7 },
    latency_ms: 460,
    playback_ms: 2_800,
  }),
  step({
    id: stepId('RS-0143-04'),
    run_id: RUN_LIVE,
    seq: 4,
    type: 'tool_result',
    label: 'Found 2 past posts to draw on',
    started_at: t(LIVE_START, 8),
    tool_name: 'retrieve_examples',
    outcome: 'ok',
    tool_output: { returned: 2, pool: 11, percentile_floor: 75, negative_examples: 0 },
    latency_ms: 510,
    playback_ms: 3_000,
  }),
  step({
    id: stepId('RS-0143-05'),
    run_id: RUN_LIVE,
    seq: 5,
    type: 'action',
    label: 'Writing the draft',
    started_at: t(LIVE_START, 11),
    model: 'claude-opus-5',
    model_snapshot: 'opus-5-2026-05-14',
    tokens_in: 3980,
    tokens_out: 190,
    cost_model_usd: 0.0742,
    latency_ms: 17_200,
    playback_ms: 17_400,
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
    label: 'Checking format, length and links',
    started_at: t(LIVE_START, 30),
    guardrail_event_id: eventId('GE-0143-01'),
    latency_ms: 80,
    playback_ms: 1_300,
  }),
  /* ---- everything below this line has not happened yet. The run is here, right now. --------- */
  step({
    id: stepId('RS-0143-07'),
    run_id: RUN_LIVE,
    seq: 7,
    type: 'action',
    label: 'Scoring the draft',
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
    playback_ms: 10_100,
  }),
  step({
    id: stepId('RS-0143-08'),
    run_id: RUN_LIVE,
    seq: 8,
    type: 'guardrail',
    label: 'Checking for personal data',
    started_at: t(LIVE_START, 38),
    thinking_text:
      'The draft names Sterling Place. That is a street, not an address, and no unit number or ' +
      'owner name appears. Passing, but this is the check most likely to fire on this pillar.',
    guardrail_event_id: eventId('GE-0143-02'),
    latency_ms: 2900,
    playback_ms: 7_100,
  }),
  step({
    id: stepId('RS-0143-09'),
    run_id: RUN_LIVE,
    seq: 9,
    type: 'guardrail',
    label: 'Checking the finished draft',
    started_at: t(LIVE_START, 42),
    guardrail_event_id: eventId('GE-0143-03'),
    latency_ms: 3100,
    playback_ms: 7_400,
  }),
  step({
    id: stepId('RS-0143-10'),
    run_id: RUN_LIVE,
    seq: 10,
    type: 'interrupt',
    label: 'Waiting for a decision',
    started_at: t(LIVE_START, 46),
    interrupt: {
      gate: 'draft_approval',
      awaiting: 'operator',
      options: ['approve', 'approve_with_edits', 'reject', 'escalate'],
      deadline: minutes(5 * DAY + 2 * HOUR),
    },
    latency_ms: 40,
    playback_ms: 1_300,
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
    label: 'Loading the slot',
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
    label: 'Reading a source',
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
    label: 'The source did not respond, trying again',
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
    label: 'The source did not respond, trying again',
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
    label: 'The source did not respond after three tries',
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
    label: 'Working out what failed',
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
    label: 'Raised it with you',
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
    label: 'Paused, will try again on its own',
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

/* ================================================================================================
 * THE TWO APPROVED CHILDREN
 *
 * Shorter than the showcase trace on purpose. These runs exist so the rail is not showing two
 * scheduled posts whose runs open to an empty screen, and so cost per post has steps to sum — not
 * to be read closely. The showcase is RUN-0141 and nothing should compete with it.
 *
 * Both END AT THE APPROVAL INTERRUPT and go no further, which is the same shape `approve()`
 * produces: a draft run stops for the human, and clearing it creates a *separate queued publish
 * run* rather than the draft run carrying on to publish. Writing a `schedule_post` step onto the
 * end of these would have been the obvious way to show the post being created and would have made
 * the fixture describe an architecture the code does not implement.
 * ==============================================================================================*/

const APPROVED_START = -28 * HOUR + 3;

function approvedChildSteps(
  run: RunId,
  draft: DraftId,
  prefix: string,
  channel: 'linkedin' | 'x',
  deadline: MinutesFromAnchor,
): RunStep[] {
  const id = (seq: number) => stepId(`${prefix}-0${seq}`);
  return [
    step({
      id: id(1), run_id: run, seq: 1, type: 'thinking',
      label: 'Loading the slot',
      started_at: t(APPROVED_START, 0), latency_ms: 2400, playback_ms: 620,
      model: 'claude-opus-5', model_snapshot: 'opus-5-2026-05-14',
      tokens_in: 2140, tokens_out: 168, cost_model_usd: 0.0341,
      thinking_text:
        'Slot is a ' + (channel === 'linkedin' ? 'LinkedIn' : 'X') + ' post for next week. Pulling ' +
        'the pillar description, the active writing rules and the tone settings before drafting.',
    }),
    step({
      id: id(2), run_id: run, seq: 2, type: 'tool_call',
      label: 'Looking up posts that performed',
      started_at: t(APPROVED_START, 6), latency_ms: 900, playback_ms: 480,
      tool_name: 'retrieve_examples',
      tool_input: { pillar_id: 'PIL-002', channel, k: 3 },
    }),
    step({
      id: id(3), run_id: run, seq: 3, type: 'tool_result',
      label: 'No past posts to draw on yet',
      started_at: t(APPROVED_START, 8), latency_ms: 120, playback_ms: 460,
      tool_name: 'retrieve_examples',
      /** N7: retrieval stays off below twenty published posts, because under that there is nothing
       *  to rank. `skipped` is its own outcome for exactly this — it is not an error and it is not
       *  a success, and collapsing it into either would hide a live policy. */
      outcome: 'skipped',
      tool_output: { skipped: true, reason: 'Retrieval enables at 20 published posts.' },
    }),
    step({
      id: id(4), run_id: run, seq: 4, type: 'action',
      label: 'Writing the draft',
      started_at: t(APPROVED_START, 11), latency_ms: 19_400, playback_ms: 900,
      model: 'claude-opus-5', model_snapshot: 'opus-5-2026-05-14',
      tokens_in: 3860, tokens_out: 341, cost_model_usd: 0.0724,
      produced: { entity_type: 'draft', id: draft },
      applied_inputs: [
        { kind: 'setting', id: 'tone.register', label: 'plain, technical, first person plural' },
        { kind: 'setting', id: 'tone.banned_phrases', label: '4 banned phrases in force' },
      ],
    }),
    step({
      id: id(5), run_id: run, seq: 5, type: 'guardrail',
      label: 'Checking the finished draft',
      started_at: t(APPROVED_START, 32), latency_ms: 3100, playback_ms: 700,
      guardrail_event_id: eventId(`GE-${prefix.replace('RS-', '')}-01`),
    }),
    step({
      id: id(6), run_id: run, seq: 6, type: 'action',
      label: 'Scoring the draft',
      started_at: t(APPROVED_START, 37), latency_ms: 5400, playback_ms: 760,
      model: 'claude-sonnet-5', model_snapshot: 'sonnet-5-2026-04-02',
      tokens_in: 2980, tokens_out: 214, cost_model_usd: 0.0168,
      cost_platform_usd: 0,
    }),
    step({
      id: id(7), run_id: run, seq: 7, type: 'interrupt',
      label: 'Waiting for a decision',
      started_at: t(APPROVED_START, 44), latency_ms: 0, playback_ms: 600,
      interrupt: {
        gate: 'draft_approval',
        awaiting: 'operator',
        options: ['approve', 'approve_with_edits', 'reject', 'escalate'],
        deadline,
      },
    }),
  ];
}

const paybackSteps = approvedChildSteps(
  RUN_PAYBACK, DRAFT_PAYBACK, 'RS-0145', 'linkedin', minutes(7 * DAY - 25 * HOUR),
);
const risersSteps = approvedChildSteps(
  RUN_RISERS, DRAFT_RISERS, 'RS-0146', 'x', minutes(8 * DAY - 20 * HOUR),
);

/* ================================================================================================
 * THE THREE REMAINING FAILURE NARRATIVES (D-041)
 *
 * Tool failure already ships as RUN-0144. These are the other three, each written as a run the
 * drawer can play rather than as a paragraph in a document — the brief grades failure handling
 * first, and a demonstrated recovery path costs less to believe than a described one.
 *
 * All three END BADLY ON PURPOSE and none of them produces a draft. That is the point: the
 * interesting property of this architecture is not that it drafts, it is what it refuses to do when
 * something is wrong.
 * ==============================================================================================*/

/* ---- 1 · POISONED SOURCE — quarantined before any model reads the text --------------------- */

const poisonedSteps: RunStep[] = [
  step({
    id: stepId('RS-0147-01'), run_id: RUN_POISONED, seq: 1, type: 'thinking',
    label: 'Loading the slot', started_at: t(POISONED_START, 0),
    latency_ms: 2300, playback_ms: 600,
    model: 'claude-opus-5', model_snapshot: 'opus-5-2026-05-14',
    tokens_in: 2050, tokens_out: 151, cost_model_usd: 0.0327,
    thinking_text:
      'Compliance-clock slot for next week. The pillar leans on published guidance, so this one ' +
      'wants a trade source rather than a crew brief.',
  }),
  step({
    id: stepId('RS-0147-02'), run_id: RUN_POISONED, seq: 2, type: 'tool_call',
    label: 'Looking for sources', started_at: t(POISONED_START, 5),
    latency_ms: 1400, playback_ms: 520, tool_name: 'search_sources',
    tool_input: { query: 'Local Law 97 2030 caps multifamily', allowlist_only: true, k: 4 },
  }),
  step({
    id: stepId('RS-0147-03'), run_id: RUN_POISONED, seq: 3, type: 'tool_result',
    label: 'Found 2 approved sources', started_at: t(POISONED_START, 8),
    latency_ms: 900, playback_ms: 520, tool_name: 'search_sources', outcome: 'ok',
    /** The domain allowlist has already done its job here: four results, two from domains the
     *  client approved. The two it dropped never reach the fetch. */
    tool_output: { returned: 2, dropped_not_allowlisted: 2 },
  }),
  step({
    id: stepId('RS-0147-04'), run_id: RUN_POISONED, seq: 4, type: 'tool_call',
    label: 'Reading a source', started_at: t(POISONED_START, 12),
    latency_ms: 2600, playback_ms: 600, tool_name: 'fetch_source',
    tool_input: { url: 'https://buildingsnyenergy.example.com/newsletter/week-33' },
  }),
  step({
    id: stepId('RS-0147-05'), run_id: RUN_POISONED, seq: 5, type: 'tool_result',
    label: 'Read 1 document', started_at: t(POISONED_START, 17),
    latency_ms: 1800, playback_ms: 640, tool_name: 'fetch_source', outcome: 'ok',
    sources: [
      {
        url: 'https://buildingsnyenergy.example.com/newsletter/week-33',
        domain: 'buildingsnyenergy.example.com',
        title: 'Week 33 — compliance roundup',
        publisher: 'Buildings NY Energy',
        fetched_at: t(POISONED_START, 17),
        /** The summary is what a *reader* would take from the page. The instruction aimed at the
         *  agent is not in it, and is not shown anywhere, which is the whole point below. */
        summary:
          'Roundup of filing deadlines and two enforcement notices. Nothing new on the 2030 caps.',
        citations: [],
        /** The rule ran on the fetched text before any model saw it, and this is its verdict. */
        guard_result: 'fail',
        why_selected: 'On the source allowlist and covers the compliance pillar weekly.',
      },
    ],
  }),
  step({
    id: stepId('RS-0147-06'), run_id: RUN_POISONED, seq: 6, type: 'guardrail',
    label: 'Screening the sources', started_at: t(POISONED_START, 21),
    latency_ms: 900, playback_ms: 900,
    /** A cheap classifier, and it runs *before* the capable model. Ordering is the defence: a model
     *  that has already read the injected text cannot un-read it. */
    model: 'guard-class-sm', model_snapshot: 'guard-class-sm-2026-02-11',
    tokens_in: 1840, tokens_out: 12, cost_model_usd: 0.0009,
    guardrail_event_id: eventId('GE-0147-01'),
  }),
  step({
    id: stepId('RS-0147-07'), run_id: RUN_POISONED, seq: 7, type: 'action',
    label: 'Stopped the run and flagged the site', started_at: t(POISONED_START, 23),
    latency_ms: 300, playback_ms: 760,
    tool_name: 'notify_operator',
    tool_input: { event: 'injection_quarantine', domain: 'buildingsnyenergy.example.com' },
    /** No `produced`. The run halts before the drafting node, so there is no draft to point at —
     *  which is exactly why the queue holds a union and not an array of drafts (D-033). */
  }),
];

/* ---- 2 · HOSTILE REPLY — the only failure whose resolution is a human decision -------------- */

const hostileSteps: RunStep[] = [
  step({
    id: stepId('RS-0148-01'), run_id: RUN_HOSTILE, seq: 1, type: 'thinking',
    label: 'Checking replies on recent posts', started_at: t(HOSTILE_START, 0),
    latency_ms: 400, playback_ms: 520,
    thinking_text:
      'Two posts are inside the reply window. Checking both for new replies since the last sweep.',
  }),
  step({
    id: stepId('RS-0148-02'), run_id: RUN_HOSTILE, seq: 2, type: 'tool_call',
    label: 'Reading replies', started_at: t(HOSTILE_START, 2),
    latency_ms: 1600, playback_ms: 560, tool_name: 'get_engagement',
    tool_input: { post_id: HOSTILE_REPLY_POST_ID, since_minutes: 30 },
  }),
  step({
    id: stepId('RS-0148-03'), run_id: RUN_HOSTILE, seq: 3, type: 'tool_result',
    label: 'Found 4 replies, 3 hostile', started_at: t(HOSTILE_START, 5),
    latency_ms: 2100, playback_ms: 700, tool_name: 'get_engagement', outcome: 'ok',
    /**
     * R8, and this is the collision it exists to resolve. The tool output carries counts, sentiment
     * labels and reply *ids* — never the reply text. Inbound text from strangers has exactly one
     * permitted home, the escalation record, and putting it here would leak it onto the highest
     * traffic screen in the product and into anything that later reads a trace.
     */
    tool_output: {
      replies_new: 4,
      sentiment: { neutral: 1, negative: 2, severe: 1 },
      reply_ids: ['r_8841', 'r_8843', 'r_8847', 'r_8850'],
      note: 'Reply text is held on the escalation record only.',
    },
  }),
  step({
    id: stepId('RS-0148-04'), run_id: RUN_HOSTILE, seq: 4, type: 'action',
    label: 'Paused the pillar: What it actually costs', started_at: t(HOSTILE_START, 9),
    latency_ms: 250, playback_ms: 860,
    /**
     * The pillar, not the account and not nothing. The theme is the likely cause, so pausing
     * everything overreacts and pausing nothing repeats the mistake. The other three pillars keep
     * publishing on schedule.
     */
    tool_input: { pillar_id: PILLAR_COST, scope: 'remaining_scheduled_this_pillar', affected: 2 },
  }),
  step({
    id: stepId('RS-0148-05'), run_id: RUN_HOSTILE, seq: 5, type: 'action',
    label: 'Told you, and will email in 30 minutes',
    started_at: t(HOSTILE_START, 10), latency_ms: 700, playback_ms: 640,
    tool_name: 'notify_operator', outcome: 'ok',
    tool_input: { channel: 'slack', escalate_to_email_after_minutes: 30 },
    guardrail_event_id: eventId('GE-0148-01'),
  }),
  step({
    id: stepId('RS-0148-06'), run_id: RUN_HOSTILE, seq: 6, type: 'interrupt',
    label: 'Waiting for a decision',
    started_at: t(HOSTILE_START, 11), latency_ms: 0, playback_ms: 700,
    interrupt: {
      gate: 'post_publish_intervention',
      awaiting: 'operator',
      /**
       * Three options and no reply. The agent never answers a comment — enforced structurally
       * rather than by policy, because no reply tool exists in its tool set. `delete_post` is in
       * `ToolName` and is operator-initiated only.
       */
      options: ['resume', 'pull', 'pause_pillar'],
      deadline: minutes(12 * 60),
    },
  }),
];

/* ---- 3 · AUTH REVOCATION, REDUCED TO ITS AMBIGUOUS RECONCILE (D-041) ------------------------ *
 *
 * The full narrative costs three screen surfaces: a reconnect affordance, the parked siblings
 * releasing on reconnect, and this. `BACKLOG.md` ranks the whole thing as a cut candidate while
 * separately calling this branch the architecture's most distinctive honesty claim — which points
 * at a split rather than a verdict. The two records that carry the argument stay; the choreography
 * goes.
 *
 * WHAT THE ARGUMENT IS. The publish call timed out. At the time of writing no platform in scope
 * honours an idempotency key, so replaying it might post twice, and not replaying it might post
 * nothing. The system reads the channel back and finds two candidates it cannot tell apart — so it
 * refuses to guess and parks for a person. Most systems retry here and hope.
 * -------------------------------------------------------------------------------------------- */

const reconcileSteps: RunStep[] = [
  step({
    id: stepId('RS-0149-01'), run_id: RUN_RECONCILE, seq: 1, type: 'guardrail',
    label: 'Final check before publishing', started_at: t(RECONCILE_START, 0),
    latency_ms: 120, playback_ms: 560,
    guardrail_event_id: eventId('GE-0149-01'),
  }),
  step({
    id: stepId('RS-0149-02'), run_id: RUN_RECONCILE, seq: 2, type: 'tool_call',
    label: 'Publishing', started_at: t(RECONCILE_START, 2),
    latency_ms: 30_000, playback_ms: 900, tool_name: 'publish_post',
    tool_input: {
      channel: 'linkedin',
      idempotency_key: 'pub:DRAFT-0116:DV-0116-2',
      approved_hash: 'fnv1a:…',
    },
  }),
  step({
    id: stepId('RS-0149-03'), run_id: RUN_RECONCILE, seq: 3, type: 'tool_result',
    label: 'The platform did not answer', started_at: t(RECONCILE_START, 34),
    latency_ms: 30_000, playback_ms: 820, tool_name: 'publish_post', outcome: 'error',
    /** Ambiguous, not failed. The request may have been received. This is the distinction the
     *  whole branch exists for. */
    error: { kind: 'timeout' },
  }),
  step({
    id: stepId('RS-0149-04'), run_id: RUN_RECONCILE, seq: 4, type: 'thinking',
    label: 'Checking whether it went out',
    started_at: t(RECONCILE_START, 66), latency_ms: 200, playback_ms: 900,
    thinking_text:
      'A timeout is not a failure. The platform does not honour our idempotency key, so replaying ' +
      'could publish a second copy under the client’s name. Reading the channel back is the only ' +
      'safe next step.',
  }),
  step({
    id: stepId('RS-0149-05'), run_id: RUN_RECONCILE, seq: 5, type: 'tool_call',
    label: 'Reading the channel back', started_at: t(RECONCILE_START, 68),
    latency_ms: 2400, playback_ms: 700, tool_name: 'reconcile_published',
    tool_input: { channel: 'linkedin', window_minutes: 15, match_on: 'approved_hash' },
  }),
  step({
    id: stepId('RS-0149-06'), run_id: RUN_RECONCILE, seq: 6, type: 'tool_result',
    label: 'Two posts look alike, cannot tell them apart',
    started_at: t(RECONCILE_START, 72), latency_ms: 1100, playback_ms: 900,
    tool_name: 'reconcile_published', outcome: 'error',
    /**
     * Two posts in the window, neither an exact hash match — the platform normalises whitespace on
     * ingest, so a byte comparison cannot settle it. Guessing in either direction is worse than
     * asking: publish again and the client has two; assume it published and the slot silently
     * misses.
     */
    error: {
      kind: 'ambiguous_reconcile',
      /** Whole-minute offsets. Every timestamp in this system is a signed offset from the anchor
       *  (R2), and this payload is rendered as raw JSON in the trace — a fractional offset like
       *  `-139.41666666` reads as a floating-point bug rather than as a minute-resolution
       *  timestamp, which is a distraction on the one step whose payload a reviewer will read. */
      candidates: [
        {
          platform_post_id: 'li_88213004',
          platform_url: 'https://example.com/linkedin/88213004',
          published_at: minutes(RECONCILE_START + 1),
        },
        {
          platform_post_id: 'li_88213119',
          platform_url: 'https://example.com/linkedin/88213119',
          published_at: minutes(RECONCILE_START + 2),
        },
      ],
    },
  }),
  step({
    id: stepId('RS-0149-07'), run_id: RUN_RECONCILE, seq: 7, type: 'action',
    label: 'Paused for you: we cannot tell if this published',
    started_at: t(RECONCILE_START, 75), latency_ms: 250, playback_ms: 820,
    tool_name: 'notify_operator', outcome: 'ok',
    tool_input: { event: 'awaiting_reconcile', candidates: 2, auto_retry: false },
    guardrail_event_id: eventId('GE-0149-02'),
  }),
];

/* ================================================================================================
 * THE PLANNING RUN'S TRACE
 *
 * Eight proposed slots, and this is the only place in the product that answers "what is the agent
 * going to do next week". `proposed_calendar` rather than `CalendarSlot[]` because no slot record
 * exists yet — the planning run *proposes*, and slots are created when the owner ratifies. A type
 * that reused CalendarSlot here would have had to invent ids for records that may never exist.
 *
 * Note the fixture models five of the eight resulting slots. The proposal is a self-contained
 * record of what was put to the owner; modelling all eight would add slot, draft and run records
 * that no screen renders.
 * ==============================================================================================*/

/**
 * Next week, in the client's contracted shape: 3 LinkedIn (Mon/Wed/Thu) + 5 X (Mon–Fri).
 *
 * Sorted by publish time at the end rather than by hand. A calendar listed out of chronological
 * order reads as a bug regardless of whether the underlying data is right, and hand-ordering it
 * means the next person to add a slot has to remember where it goes.
 */
const proposedWeek: { slot: ProposedSlot }[] = ([
  { slot: { pillar_id: PILLAR_COMPLIANCE, channel: 'linkedin', publish_at: minutes(4 * DAY - 1 * HOUR), angle: 'What the next compliance period actually asks of a 30-unit building', is_topical: false } },
  { slot: { pillar_id: PILLAR_FIELD_NOTES, channel: 'x', publish_at: minutes(4 * DAY + 3 * HOUR), angle: 'One line from the Bed-Stuy basement', is_topical: false } },
  { slot: { pillar_id: PILLAR_COST, channel: 'x', publish_at: minutes(5 * DAY - 90), angle: 'Payback maths, plainly', is_topical: false } },
  { slot: { pillar_id: PILLAR_OLD_BUILDINGS, channel: 'x', publish_at: minutes(5 * DAY + 5 * HOUR), angle: 'Why the riser diagram is always wrong', is_topical: false } },
  { slot: { pillar_id: PILLAR_FIELD_NOTES, channel: 'x', publish_at: minutes(6 * DAY + 2 * HOUR), angle: 'The cavity nobody had recorded', is_topical: false } },
  { slot: { pillar_id: PILLAR_OLD_BUILDINGS, channel: 'linkedin', publish_at: minutes(6 * DAY - 1 * HOUR), angle: 'Knob and tube is a stop-work, not a detail', is_topical: false } },
  { slot: { pillar_id: PILLAR_COST, channel: 'linkedin', publish_at: minutes(7 * DAY - 1 * HOUR), angle: 'What "pays for itself" actually depends on', is_topical: false } },
  { slot: { pillar_id: PILLAR_OLD_BUILDINGS, channel: 'x', publish_at: minutes(8 * DAY + 4 * HOUR), angle: 'Risers sized for a building that no longer exists', is_topical: false } },
] as { slot: ProposedSlot }[]).sort(
  (a, b) => (a.slot.publish_at as number) - (b.slot.publish_at as number),
);

const planningSteps: RunStep[] = [
  step({
    id: stepId('RS-0132-01'), run_id: RUN_PLANNING, seq: 1, type: 'thinking',
    label: 'Loading the pillars and last week', started_at: t(PLAN_START, 0),
    latency_ms: 3100, playback_ms: 640,
    model: 'claude-opus-5', model_snapshot: 'opus-5-2026-05-14',
    tokens_in: 4820, tokens_out: 240, cost_model_usd: 0.0611,
    thinking_text:
      'Four active pillars, none paused. Cadence is 3 LinkedIn and 5 X. Checking which pillars ran ' +
      'thin last week so the plan does not stack three compliance posts again.',
  }),
  step({
    id: stepId('RS-0132-02'), run_id: RUN_PLANNING, seq: 2, type: 'tool_call',
    label: 'Reading last week’s numbers', started_at: t(PLAN_START, 6),
    latency_ms: 1500, playback_ms: 500, tool_name: 'get_performance',
    tool_input: { window_days: 28, group_by: ['pillar', 'channel'] },
  }),
  step({
    id: stepId('RS-0132-03'), run_id: RUN_PLANNING, seq: 3, type: 'tool_result',
    label: 'Read 4 pillars across 2 channels', started_at: t(PLAN_START, 9),
    latency_ms: 1900, playback_ms: 560, tool_name: 'get_performance', outcome: 'ok',
    tool_output: {
      best: { pillar: 'Field notes', channel: 'linkedin', median_rate: 0.038 },
      worst: { pillar: 'The compliance clock', channel: 'x', median_rate: 0.011 },
      note: 'Posting times taken from the client’s best historical slots, not from a model call.',
    },
  }),
  step({
    id: stepId('RS-0132-04'), run_id: RUN_PLANNING, seq: 4, type: 'action',
    label: 'Proposing next week', started_at: t(PLAN_START, 14),
    latency_ms: 12_400, playback_ms: 1000,
    model: 'claude-opus-5', model_snapshot: 'opus-5-2026-05-14',
    tokens_in: 5240, tokens_out: 690, cost_model_usd: 0.0884,
    /** The field this run exists to fill. Rendered by `StepRow` as the week's schedule. */
    proposed_calendar: proposedWeek,
  }),
  step({
    id: stepId('RS-0132-05'), run_id: RUN_PLANNING, seq: 5, type: 'guardrail',
    label: 'Checking the plan', started_at: t(PLAN_START, 28),
    latency_ms: 90, playback_ms: 700,
    /**
     * Deterministic on purpose. Pillar coverage, cadence totals, channel split and minimum spacing
     * are all counting — a model would be slower, dearer and less certain at it, and this check has
     * to be right every week rather than usually.
     */
    tool_output: {
      cadence_matches_settings: true,
      all_pillars_covered: true,
      min_spacing_hours: 18,
      paused_pillars_excluded: 0,
    },
    guardrail_event_id: eventId('GE-0132-01'),
  }),
  step({
    id: stepId('RS-0132-06'), run_id: RUN_PLANNING, seq: 6, type: 'interrupt',
    label: 'Waiting for the owner to approve', started_at: t(PLAN_START, 29),
    latency_ms: 0, playback_ms: 800,
    interrupt: {
      /** The first of A-08's four gates, and the only one that reaches the owner rather than the
       *  operator. They approve what the company will talk about, not individual posts. */
      gate: 'calendar_approval',
      awaiting: 'stakeholder',
      options: ['approve', 'reject'],
      /** N1b. After 48 hours drafting proceeds against the *last approved* pillar set and the owner
       *  is escalated — silence does not stop the week, but it is not treated as consent either. */
      deadline: minutes(PLAN_START + 48 * HOUR),
    },
  }),
  step({
    id: stepId('RS-0132-07'), run_id: RUN_PLANNING, seq: 7, type: 'action',
    label: 'Owner approved the plan',
    started_at: t(PLAN_START, 26 * HOUR), latency_ms: 400, playback_ms: 700,
    outcome: 'ok',
    tool_input: { approved_by: 'Dana Roque — owner', via: 'signed expiring link', slots_created: 8 },
  }),
];

export const runSteps: RunStep[] = [
  ...planningSteps,
  ...cleanSteps,
  ...warnedSteps,
  ...liveSteps,
  ...toolFailureSteps,
  ...paybackSteps,
  ...risersSteps,
  ...poisonedSteps,
  ...hostileSteps,
  ...reconcileSteps,
];

/**
 * WHERE THE LIVE RUN HAS ACTUALLY GOT TO.
 *
 * Steps 1–2 of RUN-0143 have happened; 3–10 have not. The console attaches mid-flight and streams
 * the rest, which is the case §4.2 asks for and the reason the emitter cannot simply start at
 * step 1 and play forwards.
 *
 * MOVED 6 → 2. At 6 the run arrived with its whole interesting half already finished: sourcing,
 * retrieval and drafting were all history, and the only steps left to watch were three guardrail
 * checks and the stop. Those carry no model, no sources and no applied inputs, so the live card had
 * nothing to show underneath them and the streaming read as a progress bar with labels.
 *
 * At 2 the drafting step itself streams, which is the one step that names a model, spends tokens and
 * lists the rules and rejections it consumed — the things that make the sub-lines in `LiveRun` worth
 * rendering. Nothing about the run changes; this only says how far along the operator arrives.
 *
 * Exported as data rather than hardcoded in the client so that the fixture, not the code, decides
 * where the story is up to.
 */
export const LIVE_RUN_EMITTED_THROUGH_SEQ = 2;

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
  /** Non-null only where a model produced the verdict. A passing lookup has nothing to explain,
   *  and `scripts/check.mts` asserts that against the rule's `mechanism`. */
  rationale: string | null = null,
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
    rationale,
  };
}

export const guardrailEvents: GuardrailEvent[] = [
  passEvent(
    'GE-0132-01',
    RUN_PLANNING,
    stepId('RS-0132-05'),
    null,
    null,
    t(PLAN_START, 28),
    'Cadence matches settings, all four pillars covered, minimum 18h spacing, no paused pillars included.',
  ),
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
    /**
     * `claim_entailment` runs on `inference`, so this is the one guardrail in the healthy path that
     * has something to explain. Written by the same call that returned `warn`, which already had
     * the span and both summaries in context.
     */
    rationale:
      'Neither cited source states a 40% figure. The NYSERDA page sets out how the incentives ' +
      'stack and gives no reduction percentage; the Accelerator page covers eligibility only. ' +
      'The claim is not entailed by the material this draft cites.',
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
    rationale: null,
  },

  /**
   * The two approved children's L3 evaluations.
   *
   * R7 again, and it is load-bearing here rather than book-keeping: `GE-0145-01` records that the
   * banned-claim rule ran against DRAFT-0145 and passed. When the reviewer adds "pays for itself"
   * and the sweep sends that post back, the pair reads as a rule whose *result changed* because
   * the configuration changed — which is the claim — rather than as a rule that had never looked
   * at the post before.
   */
  passEvent(
    'GE-0145-01',
    RUN_PAYBACK,
    stepId('RS-0145-05'),
    DRAFT_PAYBACK,
    RULE_BANNED_CLAIM,
    t(APPROVED_START, 33),
    'No banned phrase present. 104 tokens, inside the LinkedIn limit. No outbound links.',
  ),
  passEvent(
    'GE-0146-01',
    RUN_RISERS,
    stepId('RS-0146-05'),
    DRAFT_RISERS,
    RULE_BANNED_CLAIM,
    t(APPROVED_START, 33),
    'No banned phrase present. 33 tokens, inside the X limit.',
  ),

  /* ---- the three failure narratives' events ------------------------------------------------ */
  {
    /**
     * THE INJECTION DETECTION, and the one event in the set that deliberately withholds its own
     * evidence.
     *
     * `span_withheld` exists because the operator may be the injection's target: a hidden
     * instruction is written to be read by whoever reads it, and rendering it in a console to prove
     * the rule fired would deliver the payload to the person the rule protects. So the operator
     * gets the verdict, the rule and the domain, and never the text.
     */
    id: eventId('GE-0147-01'),
    run_id: RUN_POISONED,
    run_step_id: stepId('RS-0147-06'),
    draft_id: null,
    rule_id: RULE_INJECTION,
    trigger_kind: 'guardrail',
    result: 'fail',
    evaluated_at: t(POISONED_START, 21),
    offending_span: null,
    span_withheld: true,
    withheld_reason:
      'The text is withheld. An injected instruction targets whoever reads it, and that could be ' +
      'you. The domain is flagged and the slot will be redrafted from other sources.',
    escalation_tier: 'operator',
    escalation_trigger: 'guardrail_fail',
    raised_at: t(POISONED_START, 21),
    acknowledged_at: null,
    was_unnecessary: null,
    labelled_at: null,
    labelled_by: null,
    source_url: 'https://buildingsnyenergy.example.com/newsletter/week-33',
    domain_flagged: true,
    replies: [],
    decision_deadline: null,
    detail:
      'A fetched source carried instructions aimed at the agent rather than at a reader. ' +
      'Quarantined before drafting; no draft was produced.',
    /**
     * `prompt_injection` runs on `classifier`, so it has a rationale — and this one is written under
     * a constraint the others are not. The span is withheld because the operator may be the
     * instruction's target, and a rationale that quoted or paraphrased the instruction closely
     * would route around that withholding and deliver the payload anyway. It characterises the
     * shape of what was found and stops there.
     */
    rationale:
      'The page carries an imperative addressed to an automated reader rather than to a person, ' +
      'placed in markup a human visitor would not see. Scored 0.94 against a threshold of 0.30. ' +
      'What it asks for is not repeated here.',
  },
  {
    /**
     * R8's only permitted home for inbound reply text.
     *
     * It is not on the RunStep, not in retrieval, and not in any drafting prompt. Reply text is
     * untrusted input from strangers, and the moment it enters a prompt it becomes an injection
     * surface on the one path that reaches a published account.
     */
    id: eventId('GE-0148-01'),
    run_id: RUN_HOSTILE,
    run_step_id: stepId('RS-0148-05'),
    draft_id: null,
    rule_id: null,
    /** No rule behind it — this is engagement, not a guardrail. `trigger_kind` is what makes the
     *  null `rule_id` well-formed rather than broken. */
    trigger_kind: 'engagement',
    result: 'fail',
    evaluated_at: t(HOSTILE_START, 9),
    offending_span: null,
    span_withheld: false,
    withheld_reason: null,
    escalation_tier: 'operator',
    escalation_trigger: 'negative_engagement',
    raised_at: t(HOSTILE_START, 9),
    acknowledged_at: null,
    was_unnecessary: null,
    labelled_at: null,
    labelled_by: null,
    source_url: null,
    domain_flagged: false,
    replies: [
      {
        author_handle: '@rk_property',
        text: 'Easy to say when you are the one billing for the year of monitoring.',
        sentiment: 'negative',
        received_at: t(HOSTILE_START, -40),
      },
      {
        author_handle: '@bkbuildings',
        text: 'Every contractor says this and every one of them still quotes a number by week two.',
        sentiment: 'negative',
        received_at: t(HOSTILE_START, -22),
      },
      {
        author_handle: '@sunsetmgmt',
        text: 'This reads as a way to avoid committing to anything. Owners need numbers to plan.',
        sentiment: 'severe',
        received_at: t(HOSTILE_START, -6),
      },
    ],
    /** 12 hours, and it is a real deadline: the pillar stays paused until a person decides, so
     *  silence costs the client two scheduled posts. */
    decision_deadline: minutes(12 * 60),
    detail:
      'Three negative replies in one poll window on a post under 48 hours old, against a threshold ' +
      'of 3. The "What it actually costs" pillar is paused; the other three are unaffected.',
    rationale: null,
  },
  passEvent(
    'GE-0149-01',
    RUN_RECONCILE,
    stepId('RS-0149-01'),
    null,
    RULE_HASH_MATCH,
    t(RECONCILE_START, 0),
    'Text matches the approved version exactly. Cleared to publish.',
  ),
  {
    id: eventId('GE-0149-02'),
    run_id: RUN_RECONCILE,
    run_step_id: stepId('RS-0149-07'),
    draft_id: null,
    rule_id: null,
    /** Not a guardrail and not engagement — the publish effector failed ambiguously. */
    trigger_kind: 'tool_failure',
    result: 'fail',
    evaluated_at: t(RECONCILE_START, 75),
    offending_span: null,
    span_withheld: false,
    withheld_reason: null,
    escalation_tier: 'operator',
    escalation_trigger: 'tool_failure',
    raised_at: t(RECONCILE_START, 75),
    acknowledged_at: null,
    was_unnecessary: null,
    labelled_at: null,
    labelled_by: null,
    source_url: null,
    domain_flagged: false,
    replies: [],
    decision_deadline: null,
    detail:
      'The publish call timed out and the channel read back two candidates that cannot be told ' +
      'apart. We do not know whether this published. Parked rather than retried — replaying could ' +
      'post a second copy under the client’s name.',
    rationale: null,
  },
];
