/**
 * SETTLED HISTORY — three weeks of posts that already published.
 *
 * The live batch in `pipeline.ts` is what the console, queue and detail view render. This is what
 * the dashboard is made of: every metric on that screen is an aggregate over the records below.
 * With no history each tile correctly reads "no data", and a dashboard of empty states is not the
 * deliverable.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS HAND-WRITTEN AND WHAT IS GENERATED, AND WHY THAT SPLIT
 *
 * R4 requires this to be declared per collection rather than left to be discovered, because "hand
 * written fixtures" at this row count describes work nobody will do.
 *
 * HAND-WRITTEN, because it cannot be generated convincingly:
 *   · 8 post bodies — the ones actually reachable by drilling into a chart
 *   · 6 agent/human edit pairs — edit rate, edit magnitude and the reflection-rule evidence chain
 *     all read off these diffs. The spec says protect these first if time runs out, and it is
 *     right: a generated "edit" is a string mutation, and it shows
 *
 * GENERATED deterministically from the tables below:
 *   · the remaining short posts, slots, approvals, published posts, engagement snapshots and the
 *     bulk of guardrail evaluations
 *
 * The original spec asked for ~22 hand-written bodies. Cut to 8 after checking where post text
 * actually surfaces on the dashboard: it is counts, rates and distributions almost everywhere, and
 * the text is only reachable through a drill-down. Writing fourteen more posts nobody can navigate
 * to is cost with no reader.
 *
 * ---------------------------------------------------------------------------------------------
 * R5 · SEEDED, NEVER `Math.random()`
 *
 * A dataset that changes on every reload would make the schema-version claim meaningless and would
 * make the dashboard impossible to talk over — the number you pointed at a second ago would be
 * gone. `mulberry32` is four lines and gives the same sequence every time from the same seed.
 */

import { minutes } from '../lib/types.ts';
import type {
  Approval,
  ApprovalId,
  CalendarSlot,
  CalendarSlotId,
  Channel,
  Draft,
  DraftId,
  DraftVersion,
  DraftVersionId,
  EditTag,
  GuardrailEvent,
  GuardrailEventId,
  GuardrailRuleId,
  MetricSnapshot,
  MetricSnapshotId,
  MinutesFromAnchor,
  PillarId,
  Post,
  PostId,
  RejectionReasonCode,
  Run,
  RunId,
  RunStep,
  RunStepId,
  ScoreComponents,
} from '../lib/types.ts';
import { CLIENT_ID, PILLAR_COMPLIANCE, PILLAR_COST, PILLAR_FIELD_NOTES, PILLAR_OLD_BUILDINGS } from './client.ts';
import { OPERATOR_ID, SETTINGS_V1, SETTINGS_V2, SETTINGS_V3 } from './settings.ts';
import { RULE_BANNED_CLAIM, RULE_ENTAILMENT, RULE_INJECTION, RULE_PII, RULE_SIMILARITY } from './guardrailRules.ts';

const DAY = 24 * 60;
const HOUR = 60;

/** Deterministic PRNG. Same seed, same dataset, every build. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260813);
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const intBetween = (lo: number, hi: number) => Math.round(between(lo, hi));

/* ================================================================================================
 * THE SCHEDULE
 *
 * The anchor is a Thursday. The cadence is the contracted one: three LinkedIn a week (Mon, Wed,
 * Thu) and five X (Mon–Fri), which is where 8 a week comes from.
 *
 * EVERY OFFSET LANDS ON A WEEKDAY, AND THIS USED TO BE FALSE.
 *
 * The offsets were originally written as round numbers counting back from the anchor — −21, −20,
 * −19, −18 — which reads as a sensible three-week run and is not one. The anchor is a Thursday, so
 * −19 and −18 are a Saturday and a Sunday. Six of the twenty-three entries published at the
 * weekend, on a client whose contracted cadence is Monday to Friday and whose L4 publish-time guard
 * checks a posting window before it posts. The fixture failed its own architecture.
 *
 * It survived because nothing rendered a weekday. Every surface said "3 days ago". The defect
 * became visible the moment the week view drew the data on a Monday-to-Sunday grid, which is the
 * argument for the week view in one sentence.
 *
 * The remap moved eleven entries. Each stayed inside its own ISO week and inside its own
 * `settingsVersionAt` band, so no draft changed settings cohort and the edit-rate drill-down's
 * bars are unmoved. `scripts/check.mts` now asserts the weekday invariant, so it cannot come back.
 * ==============================================================================================*/

type Planned = {
  /** Days before the anchor. */
  dayOffset: number;
  channel: Channel;
  pillar: PillarId;
  angle: string;
  /** Hand-written body, where one exists. Generated short otherwise. */
  body?: string;
  /** Default is published. */
  outcome?: 'published' | 'slipped' | 'dropped' | 'quarantined';
  /** Set on the six pairs where a human edited before approving. */
  humanEdit?: { text: string; tags: EditTag[] };
};

/**
 * The eight hand-written bodies are all LinkedIn, because that is where a drill-down lands: X posts
 * are two lines and read the same generated or not, LinkedIn posts are where the client's voice
 * actually lives.
 */
const PLAN: Planned[] = [
  /* ---- week of day −21 ------------------------------------------------------------------- */
  {
    dayOffset: -21,
    channel: 'linkedin',
    pillar: PILLAR_OLD_BUILDINGS,
    angle: 'Why the textbook retrofit fails in a pre-war walk-up',
    body:
      'Every retrofit guide assumes you can get to the pipes.\n\n' +
      'In a 1926 walk-up the risers are buried in a chase that was plastered over in 1954, the ' +
      'basement ceiling is original lath, and the only access is through a tenant’s kitchen ' +
      'cupboard.\n\n' +
      'So the plan we cost is never the plan in the guide. It is the plan that survives the ' +
      'building we actually opened.',
  },
  { dayOffset: -23, channel: 'x', pillar: PILLAR_COST, angle: 'What a survey actually costs' },
  { dayOffset: -20, channel: 'x', pillar: PILLAR_COMPLIANCE, angle: 'Reporting deadline reminder' },
  {
    dayOffset: -22,
    channel: 'linkedin',
    pillar: PILLAR_COMPLIANCE,
    angle: 'The three numbers an owner needs before deciding anything',
    body:
      'Before you price a single piece of equipment, you need three numbers.\n\n' +
      'What your building emits now. What your cap is for this period. What the gap costs you if ' +
      'you do nothing.\n\n' +
      'Most owners we meet have been quoted equipment before anyone worked out the third one.',
    humanEdit: {
      text:
        'Before you price a single piece of equipment, you need three numbers.\n\n' +
        'What your building emits now. What your cap is for this period. And what the gap costs ' +
        'you if you do nothing.\n\n' +
        'Most owners we meet have been quoted equipment before anyone worked out the third.',
      tags: ['tightened'],
    },
  },
  { dayOffset: -22, channel: 'x', pillar: PILLAR_FIELD_NOTES, angle: 'Found behind a riser cover' },
  {
    dayOffset: -24,
    channel: 'linkedin',
    pillar: PILLAR_FIELD_NOTES,
    angle: 'A boiler nobody had serviced since 2011',
    body:
      'We opened a boiler room in Bed-Stuy last month and found a service tag from 2011.\n\n' +
      'The building had been paying to heat the street through a cracked heat exchanger for over a ' +
      'decade. Nobody had done anything wrong — the boiler ran, the radiators got warm, and ' +
      'nothing ever failed loudly enough to get looked at.\n\n' +
      'That is the ordinary case. Not neglect. Just nothing forcing the question.',
  },
  { dayOffset: -17, channel: 'x', pillar: PILLAR_COST, angle: 'Incentive stacking, briefly' },
  { dayOffset: -16, channel: 'x', pillar: PILLAR_OLD_BUILDINGS, angle: 'Steam traps, again' },

  /* ---- week of day −14 ------------------------------------------------------------------- */
  {
    dayOffset: -14,
    channel: 'linkedin',
    pillar: PILLAR_COST,
    angle: 'Why we quote the envelope before the equipment',
    body:
      'We quote air sealing and insulation before we quote a heat pump, and owners often push back ' +
      'on that order.\n\n' +
      'The reason is arithmetic. Envelope work reduces the load, and the load determines the size ' +
      'of the unit. Do the equipment first and you buy a bigger machine than the building will ' +
      'need in two years, and you pay for it twice — once at purchase, once every winter.',
    humanEdit: {
      text:
        'We quote air sealing and insulation before we quote a heat pump, and owners often push ' +
        'back on that order.\n\n' +
        'The reason is arithmetic. Envelope work reduces the load, and the load determines the ' +
        'size of the unit. Do the equipment first and you buy a bigger machine than the building ' +
        'will need, and you pay for it twice — once at purchase, once every winter.',
      /** Two tags because the edit did two things: it dropped an unsupported timeframe ("in two
       *  years") and, in dropping it, cut a hedge the sentence did not need. Tags are the evidence
       *  behind a reflection rule, so an edit that does two things has to say so — a single tag
       *  here would have hidden one of the two patterns from the reflection job. */
      tags: ['claim_softened', 'tightened'],
    },
  },
  { dayOffset: -14, channel: 'x', pillar: PILLAR_COMPLIANCE, angle: 'One line on the next period' },
  { dayOffset: -13, channel: 'x', pillar: PILLAR_FIELD_NOTES, angle: 'Crew note from Sunset Park' },
  {
    dayOffset: -15,
    channel: 'linkedin',
    pillar: PILLAR_COMPLIANCE,
    angle: 'What a co-op board should ask its managing agent this quarter',
    body:
      'If you sit on a co-op board, there are four questions worth putting to your managing agent ' +
      'this quarter.\n\n' +
      'Has our benchmarking been filed. What did it say. Which period are we in. And what is the ' +
      'plan if we are over.\n\n' +
      'None of those need an engineer to answer. All four get harder the longer nobody asks.',
    outcome: 'slipped',
  },
  { dayOffset: -15, channel: 'x', pillar: PILLAR_COST, angle: 'Payback, without the brochure' },
  {
    dayOffset: -17,
    channel: 'linkedin',
    pillar: PILLAR_OLD_BUILDINGS,
    angle: 'Masonry cavities are not insulation',
    body:
      'A cavity in a masonry wall is not insulation. It is a cavity.\n\n' +
      'It moves air, it moves moisture, and in a lot of Brooklyn stock it moves both straight past ' +
      'whatever somebody stuffed in there in the seventies.\n\n' +
      'We open one before we cost the work. Every time.',
    humanEdit: {
      text:
        'A cavity in a masonry wall is not insulation. It is a cavity.\n\n' +
        'It moves air, it moves moisture, and in a lot of Brooklyn stock it moves both straight ' +
        'past whatever someone packed in there in the seventies.\n\n' +
        'We open one before we cost the work. Every time.',
      tags: ['terminology_corrected'],
    },
  },
  { dayOffset: -10, channel: 'x', pillar: PILLAR_FIELD_NOTES, angle: 'What we found on Gates Ave' },

  /* ---- week of day −7 -------------------------------------------------------------------- */
  {
    dayOffset: -7,
    channel: 'linkedin',
    pillar: PILLAR_FIELD_NOTES,
    angle: 'The job where we recommended doing almost nothing',
    body:
      'A 22-unit building asked us to quote a full mechanical replacement.\n\n' +
      'We came back recommending balancing, four steam traps and a weekend of air sealing. About a ' +
      'twentieth of what they expected to spend.\n\n' +
      'They asked, reasonably, why we were talking ourselves out of work. The answer is that the ' +
      'building was not ready for the bigger job, and doing it anyway would have made the bigger ' +
      'job worse when it eventually came.',
    humanEdit: {
      text:
        'A 22-unit building asked us to quote a full mechanical replacement.\n\n' +
        'We came back recommending balancing, four steam traps and a weekend of air sealing. ' +
        'About a twentieth of what they expected to spend.\n\n' +
        'They asked, reasonably, why we were talking ourselves out of work. The building was not ' +
        'ready for the bigger job, and doing it anyway would have made that job worse when it ' +
        'came.',
      /**
       * `hook_rewritten` was here and is removed, because the diff does not support it: the first
       * line is byte-identical in both versions. The edit cuts "The answer is that" and
       * "eventually" — a lead-in and a filler word — which is `tightened`, and shortens the whole
       * thing, which is `length_cut`.
       *
       * Worth naming rather than fixing quietly. A tag is the *evidence* a reflection rule is
       * built from, so an unearned one is not a mislabel — it is a rule that would be suggested on
       * a pattern that never happened.
       */
      tags: ['length_cut', 'tightened'],
    },
  },
  { dayOffset: -7, channel: 'x', pillar: PILLAR_COMPLIANCE, angle: 'Filing window opens' },
  { dayOffset: -6, channel: 'x', pillar: PILLAR_COST, angle: 'The cheapest thing you can do' },
  {
    dayOffset: -8,
    channel: 'linkedin',
    pillar: PILLAR_COST,
    angle: 'Financing is the part nobody explains',
    body:
      'The technical side of a retrofit is well documented. The financing is not.\n\n' +
      'Which programme you use changes what you can claim, what order you have to do the work in, ' +
      'and sometimes who is allowed to do it. We have seen buildings lose eligibility by starting ' +
      'work two weeks early.\n\n' +
      'Ask about the paperwork before the equipment. It constrains more than people expect.',
    humanEdit: {
      text:
        'The technical side of a retrofit is well documented. The financing is not.\n\n' +
        'Which programme you use changes what you can claim, what order you have to do the work ' +
        'in, and sometimes who is allowed to do it. We have seen a building lose eligibility by ' +
        'starting work two weeks early.\n\n' +
        'Ask about the paperwork before the equipment. It constrains more than owners expect.',
      tags: ['specific_detail_added', 'terminology_corrected'],
    },
  },
  { dayOffset: -9, channel: 'x', pillar: PILLAR_OLD_BUILDINGS, angle: 'Knob and tube, one line' },
  {
    dayOffset: -8,
    channel: 'x',
    pillar: PILLAR_FIELD_NOTES,
    angle: 'A topical note on the cold snap',
    /** Topical, rejected at T−1. A topical post that slips a week is stale by definition, so the
     *  slot is dropped rather than rescheduled — trace T4's stated loss. */
    outcome: 'dropped',
  },
  {
    dayOffset: -3,
    channel: 'linkedin',
    pillar: PILLAR_COMPLIANCE,
    angle: 'Sourced from an industry newsletter',
    /** The injection narrative. The source carried instructions aimed at the agent, so the run was
     *  quarantined before drafting and no draft exists. This is the record behind the dashboard's
     *  injection-detections tile. */
    outcome: 'quarantined',
  },
  {
    /**
     * Published yesterday, and it exists so the hostile-reply narrative has something real to
     * happen to.
     *
     * A-14 pauses a pillar on negative replies to a post **under 48 hours old**, and before this
     * the most recent published post was five days back — outside the poll window entirely, so the
     * narrative would have had to attach itself to a post the system had stopped watching.
     *
     * It also fixes something that read oddly on its own: a contracted cadence of eight a week with
     * nothing published in the last five days.
     */
    dayOffset: -1,
    channel: 'x',
    pillar: PILLAR_COST,
    angle: 'What we tell owners about payback',
  },
];

/* ================================================================================================
 * GENERATION
 * ==============================================================================================*/

const shortBodies: Record<string, string> = {
  'What a survey actually costs': 'A survey is a day on site and about a week of analysis. It is the cheapest part of any retrofit and the only part that stops you buying the wrong thing.',
  'Reporting deadline reminder': 'Benchmarking filings are due before the period closes. If your managing agent has not mentioned it this quarter, ask.',
  'Found behind a riser cover': 'Behind a riser cover on Putnam: three abandoned pipes, one live one, and a 1970s repair nobody had recorded. The drawings showed one pipe.',
  'Incentive stacking, briefly': 'Incentives stack, but the order matters. Starting work before an application lands can cost you the programme entirely.',
  'Steam traps, again': 'Half the buildings we survey have failed steam traps. It is the least interesting fix available and usually the one with the shortest payback.',
  'One line on the next period': 'The next compliance period is not far away, and the buildings that struggle are rarely the ones you would guess.',
  'Crew note from Sunset Park': 'Sunset Park job: the basement was drier than the survey suggested, which moved the insulation spec and took two days off the schedule.',
  'Payback, without the brochure': 'Payback depends on what you are replacing, what you pay for fuel, and how the building is run. Anyone quoting a single number has not asked.',
  'What we found on Gates Ave': 'Gates Ave: a boiler sized for a building twice this one, short-cycling since at least 2018. The fix was smaller than the diagnosis.',
  'Filing window opens': 'The filing window is open. Earlier is better — the queue at the end is real and nobody enjoys it.',
  'The cheapest thing you can do': 'The cheapest thing you can do this winter is balance the system you already have. It costs a day and it is not glamorous.',
  'Knob and tube, one line': 'Knob and tube in a wall you were about to insulate is a stop-work, not a detail. Check before the crew arrives.',
  'A topical note on the cold snap': 'Cold snap notes from this week’s jobs.',
  'Sourced from an industry newsletter': '',
  /** The post the hostile-reply narrative lands on. Deliberately reasonable and deliberately about
   *  money — the replies it draws are an argument, not an error, which is the case a human has to
   *  judge rather than a rule catch. */
  'What we tell owners about payback':
    'We will not quote a payback figure until we have seen a year of your fuel bills. Anyone who quotes one before that is guessing with your money.',
};

/**
 * The post the hostile-reply poll run reports on, derived rather than written down.
 *
 * Ids here are positional — `POST-H004` is the fourth plan entry — so a literal in `pipeline.ts`
 * would silently point at a different post the moment an entry is inserted above. Deriving it is
 * two lines and cannot drift.
 */
export const HOSTILE_REPLY_POST_ID =
  `POST-${String(PLAN.length + 100).padStart(4, '0')}` as PostId;

const pillarLabel: Record<string, string> = {
  [PILLAR_COMPLIANCE]: 'compliance',
  [PILLAR_COST]: 'cost',
  [PILLAR_FIELD_NOTES]: 'field',
  [PILLAR_OLD_BUILDINGS]: 'old',
};

/** Which settings version was in force at a given offset. This is the drill-down's x-axis: edit
 *  rate split into cohorts either side of each settings change. */
function settingsVersionAt(dayOffset: number) {
  if (dayOffset >= -11) return SETTINGS_V3;
  if (dayOffset >= -18) return SETTINGS_V2;
  return SETTINGS_V1;
}

function scoreFor(hasEdit: boolean): ScoreComponents {
  // Edited drafts score a little lower on the dimensions a human tends to fix. Not random noise —
  // the correlation is what makes the dashboard's cohorts mean anything.
  const base = hasEdit ? 0.82 : 0.9;
  return {
    brand_voice: Number((base + between(-0.04, 0.05)).toFixed(2)),
    claim_support: Number((base + between(-0.05, 0.06)).toFixed(2)),
    pillar_fit: Number((base + between(-0.03, 0.06)).toFixed(2)),
    channel_fit: Number((base + between(-0.05, 0.05)).toFixed(2)),
    specificity: Number((base + between(-0.08, 0.04)).toFixed(2)),
  };
}

const WEIGHTS: ScoreComponents = {
  brand_voice: 0.3,
  claim_support: 0.25,
  pillar_fit: 0.2,
  channel_fit: 0.15,
  specificity: 0.1,
};

const composite = (c: ScoreComponents) =>
  Math.round(
    (c.brand_voice * WEIGHTS.brand_voice +
      c.claim_support * WEIGHTS.claim_support +
      c.pillar_fit * WEIGHTS.pillar_fit +
      c.channel_fit * WEIGHTS.channel_fit +
      c.specificity * WEIGHTS.specificity) *
      1000,
  ) / 1000;

function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a:${h.toString(16).padStart(8, '0')}`;
}

export const historySlots: CalendarSlot[] = [];
export const historyDrafts: Draft[] = [];
export const historyApprovals: Approval[] = [];
export const historyPosts: Post[] = [];
export const historySnapshots: MetricSnapshot[] = [];
export const historyRuns: Run[] = [];
export const historyEvents: GuardrailEvent[] = [];
export const historySteps: RunStep[] = [];

/**
 * A compact trace per history run — six steps rather than the fourteen a hand-written showcase
 * carries.
 *
 * Generated, and required rather than decorative. Three things depend on these existing:
 *
 *   · Cost per post is summed from `RunStep.cost_model_usd + cost_platform_usd` (R1 deleted the
 *     run-level totals), so with no history steps that metric would have read near zero
 *   · Every guardrail event attaches to a step, because the console renders a check at its
 *     position in the stream and run-level attachment cannot order it
 *   · Opening a history run from the rail should show a trace, not an empty screen
 *
 * The models and token counts follow A-03's routing: Haiku summarises, Opus drafts, Sonnet judges.
 * A trace where one model did everything would contradict the model layer on the board.
 */
function compactTrace(
  runId: RunId,
  draftId: DraftId | null,
  startedAt: MinutesFromAnchor,
  channel: Channel,
): RunStep[] {
  const t = (secondsIn: number) => minutes((startedAt as number) + secondsIn / 60);
  const base = {
    run_id: runId,
    thinking_text: null,
    playback_ms: 600,
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
    max_attempts: 3 as const,
    backoff_ms: null,
    sources: [],
    brief_ref: null,
    applied_inputs: [],
    guardrail_event_id: null,
    produced: null,
    interrupt: null,
    proposed_calendar: null,
  };

  const idFor = (seq: number) => `${runId.replace('RUN-', 'RS-')}-0${seq}` as RunStepId;

  return [
    { ...base, id: idFor(1), seq: 1, type: 'thinking' as const, label: 'Loading the slot',
      started_at: t(0), latency_ms: 2600, model: 'claude-opus-5', model_snapshot: 'opus-5-2026-05-14',
      tokens_in: intBetween(1800, 2400), tokens_out: intBetween(120, 200),
      cost_model_usd: Number(between(0.03, 0.04).toFixed(4)) },
    { ...base, id: idFor(2), seq: 2, type: 'tool_call' as const, label: 'Reading a source',
      started_at: t(4), latency_ms: 1700, tool_name: 'fetch_source' as const },
    { ...base, id: idFor(3), seq: 3, type: 'tool_result' as const, label: 'Read 1 document',
      started_at: t(7), latency_ms: 2100, tool_name: 'fetch_source' as const, outcome: 'ok' as const },
    { ...base, id: idFor(4), seq: 4, type: 'thinking' as const, label: 'Summarising the sources',
      started_at: t(10), latency_ms: 3900, model: 'claude-haiku-4-5', model_snapshot: 'haiku-4-5-20251001',
      tokens_in: intBetween(9000, 13000), tokens_out: intBetween(240, 380),
      cost_model_usd: Number(between(0.009, 0.014).toFixed(4)) },
    { ...base, id: idFor(5), seq: 5, type: 'action' as const, label: 'Writing the draft',
      started_at: t(16), latency_ms: 17_000, model: 'claude-opus-5', model_snapshot: 'opus-5-2026-05-14',
      tokens_in: intBetween(3200, 4600), tokens_out: intBetween(120, 420),
      cost_model_usd: Number(between(0.05, 0.095).toFixed(4)),
      produced: draftId ? ({ entity_type: 'draft', id: draftId } as const) : null },
    { ...base, id: idFor(6), seq: 6, type: 'action' as const, label: 'Scoring the draft',
      started_at: t(35), latency_ms: 5600, model: 'claude-sonnet-5', model_snapshot: 'sonnet-5-2026-04-02',
      tokens_in: intBetween(2600, 3400), tokens_out: intBetween(180, 260),
      cost_model_usd: Number(between(0.013, 0.021).toFixed(4)),
      // Platform spend lands on the publish call. X is pay-per-use; LinkedIn is not.
      cost_platform_usd: channel === 'x' ? 0.02 : 0 },
  ];
}

const PASS_RULES: GuardrailRuleId[] = [
  RULE_INJECTION,
  RULE_BANNED_CLAIM,
  RULE_ENTAILMENT,
  RULE_PII,
  RULE_SIMILARITY,
];

PLAN.forEach((entry, index) => {
  /**
   * ONE ID SERIES, NO `H`.
   *
   * These read `RUN-H001` until 17 Aug. The `H` meant "history" — a fixture-authoring label that
   * had no meaning to anyone reading the product, where it showed up in the run rail beside ids
   * like `RUN-0141` and looked arbitrary. Ids are the thing an operator quotes when something goes
   * wrong, so they have to look like one series.
   *
   * History occupies 0101–0124 and the live pipeline 0132–0149, so the two sets never interleave.
   *
   * They are no longer strictly chronological *within* the history block. Ids are assigned by array
   * position and the weekday remap below moved eleven entries without reordering the array —
   * deliberately, because `evidence_ids`, `example_refs` and `HOSTILE_REPLY_POST_ID` all name
   * specific ids, and reordering would have silently repointed every one of them at different
   * content. Nothing reads these ids as an ordering: every surface sorts on `publish_at`.
   */
  const n = String(index + 101).padStart(4, '0');
  const outcome = entry.outcome ?? 'published';
  const publishAt = minutes(entry.dayOffset * DAY + 9 * HOUR);
  const draftedAt = minutes(entry.dayOffset * DAY - 2 * DAY);
  const slotId = `SLOT-${n}` as CalendarSlotId;
  const runId = `RUN-${n}` as RunId;

  historySlots.push({
    id: slotId,
    pillar_id: entry.pillar,
    channel: entry.channel,
    publish_at: publishAt,
    angle: entry.angle,
    is_topical: outcome === 'dropped',
    state:
      outcome === 'published'
        ? 'published'
        : outcome === 'slipped'
          ? 'slipped'
          : outcome === 'dropped'
            ? 'dropped'
            : 'quarantined',
    /**
     * A SLIP IS A MOVE, SO THE TWO TIMES HAVE TO DIFFER.
     *
     * This read `original_publish_at: publishAt` — the original time set equal to the current one.
     * `CalendarSlot.original_publish_at` exists so the calendar can *show the move* rather than
     * silently relocating a slot, and a slot whose two times are identical claims a reschedule that
     * never happened. Rendered on the week grid it printed `09:00 09:00`, one struck through, which
     * reads as a bug in the renderer rather than as a fact about the slot.
     *
     * It survived because nothing rendered `original_publish_at` at all. The week view is the first
     * surface that reads it.
     *
     * The slot was planned a day earlier and went out late, which is what `unreviewed_in_time`
     * means: the review runway ran out, the slot missed its own window, and the post published on
     * the next available day. A day back, not an hour, because the slip reason is a missed *day* of
     * review — and staying on a weekday keeps the weekday invariant this file now asserts.
     */
    original_publish_at: outcome === 'slipped' ? minutes((publishAt as number) - DAY) : null,
    slip_reason: outcome === 'slipped' ? 'unreviewed_in_time' : null,
    calendar_run_id: runId,
  });

  historyRuns.push({
    id: runId,
    client_id: CLIENT_ID,
    type: 'draft',
    parent_run_id: null,
    state: outcome === 'quarantined' ? 'quarantined' : 'completed',
    checkpoint_ref: '',
    trigger: 'schedule.weekly_draft',
    park_reason: outcome === 'quarantined' ? 'injection_quarantine' : null,
    end_reason: null,
    started_at: draftedAt,
    ended_at: outcome === 'quarantined' ? draftedAt : minutes((draftedAt as number) + 4),
    step_cap: 20,
    degraded: false,
    settings_version_id: settingsVersionAt(entry.dayOffset),
    target_draft_id: outcome === 'quarantined' ? null : (`DRAFT-${n}` as DraftId),
    target_post_id: null,
    next_sweep_at: null,
    variant: outcome === 'quarantined' ? 'poisoned_source' : 'nominal',
  });

  /**
   * A quarantined run is TRUNCATED, not shortened.
   *
   * It halts at the input guardrail, before the drafting node — so its trace has to stop after the
   * fetch. The first version gave it the same six-step trace as everything else, which meant a run
   * whose queue row says "no draft produced" opened onto steps reading "Write the draft" and "Score
   * the draft". Nothing failed; the fixture simply described a run contradicting its own state, and
   * the way you find it is by clicking the quarantined item in front of someone.
   */
  const fullTrace = compactTrace(
    runId,
    outcome === 'quarantined' ? null : (`DRAFT-${n}` as DraftId),
    draftedAt,
    entry.channel,
  );
  historySteps.push(...(outcome === 'quarantined' ? fullTrace.slice(0, 3) : fullTrace));

  /**
   * A quarantined run produces no draft at all — it halts at the input guardrail, before the
   * drafting node. That is exactly why CalendarSlot is a record rather than folded onto Draft:
   * this slot was planned and never published, and it is the case that makes published-vs-planned
   * informative rather than permanently 100%.
   */
  if (outcome === 'quarantined') {
    historyEvents.push({
      id: `GE-${n}-INJ` as GuardrailEventId,
      // classifier + fail, so it explains itself. Characterises the shape only: the span is
      // withheld because the operator may be the instruction's target.
      rationale:
        'The page carries an imperative addressed to an automated reader rather than to a ' +
        'person. Above threshold. What it asks for is not repeated here.',
      run_id: runId,
      run_step_id: `RS-${n}-03` as RunStepId,
      draft_id: null,
      rule_id: RULE_INJECTION,
      trigger_kind: 'guardrail',
      result: 'fail',
      evaluated_at: draftedAt,
      offending_span: null,
      /** Withheld by design: the operator may be the injection's target. */
      span_withheld: true,
      withheld_reason:
        'The text is withheld — an injected instruction targets whoever reads it, and that could ' +
        'be you. The domain is flagged and the slot was redrafted from other sources.',
      escalation_tier: 'operator',
      escalation_trigger: 'guardrail_fail',
      raised_at: draftedAt,
      acknowledged_at: minutes((draftedAt as number) + 90),
      was_unnecessary: false,
      labelled_at: minutes((draftedAt as number) + 95),
      labelled_by: OPERATOR_ID,
      source_url: 'https://buildingsnyenergy.example.com/newsletter/week-31',
      domain_flagged: true,
      replies: [],
      decision_deadline: null,
      detail: 'A source carried instructions aimed at the agent. Quarantined before drafting.',
    });
    return;
  }

  const draftId = `DRAFT-${n}` as DraftId;
  const body = entry.body ?? shortBodies[entry.angle] ?? entry.angle;
  const settingsVersion = settingsVersionAt(entry.dayOffset);

  const versions: DraftVersion[] = [
    {
      id: `DV-${n}-1` as DraftVersionId,
      version: 1,
      created_at: draftedAt,
      text: body,
      author: 'agent',
      content_hash: digest(body),
      settings_version_id: settingsVersion,
      token_count: body.split(/\s+/).length,
      edit_tags: [],
    },
  ];

  if (entry.humanEdit) {
    versions.push({
      id: `DV-${n}-2` as DraftVersionId,
      version: 2,
      created_at: minutes((draftedAt as number) + 40),
      text: entry.humanEdit.text,
      author: 'human',
      content_hash: digest(entry.humanEdit.text),
      settings_version_id: settingsVersion,
      token_count: entry.humanEdit.text.split(/\s+/).length,
      edit_tags: entry.humanEdit.tags,
    });
  }

  const current = versions[versions.length - 1];
  const scores = scoreFor(Boolean(entry.humanEdit));

  historyDrafts.push({
    id: draftId,
    slot_id: slotId,
    pillar_id: entry.pillar,
    channel: entry.channel,
    run_id: runId,
    state: outcome === 'slipped' ? 'rejected' : 'approved',
    queued_at: minutes((draftedAt as number) + 5),
    current_version_id: current.id,
    versions,
    score_components: scores,
    score_weights: WEIGHTS,
    composite_score: composite(scores),
    deterministic_checks: [],
    degraded: false,
    blocked_reason: null,
    similarity: null,
    variant_group_id: null,
    source_refs: [],
    example_refs: [],
    applied_reflection_rule_ids: [],
    applied_rejection_reason_ids: [],
  });

  /**
   * `seconds_open` is the rubber-stamp clock, and the spread here is deliberate: roughly one in
   * six decisions lands under fifteen seconds, which is what makes A-17's rubber-stamp tile show a
   * real number rather than a zero. A dataset where every review took two minutes would hide the
   * failure mode the metric exists to detect.
   */
  const rushed = index % 6 === 0;
  const secondsOpen = rushed ? intBetween(6, 14) : intBetween(45, 260);
  const decidedAt = minutes((draftedAt as number) + intBetween(60, 26 * HOUR));

  historyApprovals.push({
    id: `APR-${n}` as ApprovalId,
    draft_version_id: current.id,
    decision: outcome === 'slipped' ? 'reject' : entry.humanEdit ? 'approve_with_edits' : 'approve',
    reason_code: outcome === 'slipped' ? ('timing_wrong' as RejectionReasonCode) : null,
    reason_note: null,
    queued_at: minutes((draftedAt as number) + 5),
    decided_at: decidedAt,
    seconds_open: secondsOpen,
    decided_by: 'operator',
    operator_id: OPERATOR_ID,
    superseded_by: null,
    pillar_id: entry.pillar,
    channel_at_decision: entry.channel,
  });

  // Guardrail evaluations. R7: passes are recorded, because block rate's denominator is
  // evaluations — and a rule that stopped being evaluated must not look like one passing
  // everything.
  for (const rule of PASS_RULES) {
    historyEvents.push({
      id: `GE-${n}-${pillarLabel[entry.pillar]}-${rule}` as GuardrailEventId,
      // PASS_RULES are lookup and embedding checks. A matched list and a measured distance have
      // nothing to explain, and prose here would imply reasoning that never happened.
      rationale: null,
      run_id: runId,
      run_step_id: `RS-${n}-06` as RunStepId,
      draft_id: draftId,
      rule_id: rule,
      trigger_kind: 'guardrail',
      result: 'pass',
      evaluated_at: minutes((draftedAt as number) + 3),
      offending_span: null,
      span_withheld: false,
      withheld_reason: null,
      escalation_tier: 'none',
      escalation_trigger: null,
      raised_at: minutes((draftedAt as number) + 3),
      acknowledged_at: null,
      was_unnecessary: null,
      labelled_at: null,
      labelled_by: null,
      source_url: null,
      domain_flagged: false,
      replies: [],
      decision_deadline: null,
      detail: 'Passed.',
    });
  }

  /**
   * Escalations across the history, with mixed labels.
   *
   * Escalation precision is only meaningful with a denominator: one labelled event gives 100% and
   * says nothing. The PRD makes the same point — "67% over three labels is not a number" — which is
   * why the tile shows coverage beside the figure. Roughly one draft in three escalates, most get
   * judged, and two are deliberately left unlabelled so the coverage line has something to report.
   */
  if (index % 8 === 1) {
    const judged = index !== 9; // one stays unlabelled, so coverage has something to report
    const warranted = index !== 1; // and one judged escalation turned out not to be warranted
    historyEvents.push({
      id: `GE-${n}-ESC` as GuardrailEventId,
      // claim_entailment runs on inference, and this one warned, so it carries a rationale.
      rationale:
        'A quantitative claim in this draft is not supported by the sources it cites.',
      run_id: runId,
      run_step_id: `RS-${n}-06` as RunStepId,
      draft_id: draftId,
      rule_id: RULE_ENTAILMENT,
      trigger_kind: 'guardrail',
      result: 'warn',
      evaluated_at: minutes((draftedAt as number) + 4),
      offending_span: null,
      span_withheld: false,
      withheld_reason: null,
      escalation_tier: 'operator',
      /** A warn and a fail are two different triggers for precision purposes: a warn routes to
       *  review, a fail blocks, and lumping them makes the cut useless on the commonest of all. */
      escalation_trigger: 'guardrail_warn',
      raised_at: minutes((draftedAt as number) + 4),
      acknowledged_at: minutes((draftedAt as number) + 30),
      was_unnecessary: judged ? !warranted : null,
      labelled_at: judged ? minutes((draftedAt as number) + 35) : null,
      labelled_by: judged ? OPERATOR_ID : null,
      source_url: null,
      domain_flagged: false,
      replies: [],
      decision_deadline: null,
      detail: 'A figure in the draft was not supported by the sources it cited.',
    });
  }

  if (outcome === 'slipped') return;

  const postId = `POST-${n}` as PostId;
  const publishedAt = minutes((publishAt as number) + intBetween(0, 4));
  const mature = entry.dayOffset <= -7;

  historyPosts.push({
    id: postId,
    draft_version_id: current.id,
    channel: entry.channel,
    scheduled_at: publishAt,
    state: 'published',
    published_at: publishedAt,
    platform_post_id: `p_${n}`,
    platform_url: `https://example.com/${entry.channel}/${n}`,
    approved_content_hash: current.content_hash,
    idempotency_key: `pub:${draftId}:${current.id}`,
    /** X is pay-per-use, LinkedIn is not. Cost per post has two addends and this is the second. */
    platform_cost_usd: entry.channel === 'x' ? 0.02 : 0,
    invalidated_reason: null,
    pulled_at: null,
    pull_reason: null,
  });

  /**
   * Day-7 snapshot for every post, plus a 3-point accrual curve for the four most recent — which
   * is what the engagement drill-down needs and what nothing else does. Generating curves for
   * posts nobody clicks would be rows with no reader.
   */
  const captures = index >= PLAN.length - 6 ? [DAY, 3 * DAY, 7 * DAY] : [7 * DAY];
  const reach = intBetween(700, 2600);

  captures.forEach((offset, capture) => {
    const share = (capture + 1) / captures.length;
    historySnapshots.push({
      id: `MS-${n}-${capture}` as MetricSnapshotId,
      post_id: postId,
      captured_at: minutes((publishedAt as number) + offset),
      channel: entry.channel,
      impressions: Math.round(reach * share),
      reactions: Math.round(reach * share * between(0.015, 0.035)),
      comments: Math.round(reach * share * between(0.001, 0.006)),
      /** LinkedIn and X do not expose the same counters, and a null is excluded rather than
       *  zeroed — a zero reads as poor engagement rather than as no data. */
      shares: entry.channel === 'linkedin' ? Math.round(reach * share * between(0.002, 0.008)) : null,
      clicks: entry.channel === 'linkedin' ? Math.round(reach * share * between(0.004, 0.012)) : null,
      is_mature: mature && offset === 7 * DAY,
      percentile: mature && offset === 7 * DAY ? intBetween(20, 95) : null,
      sentiment: 'neutral',
    });
  });
});
