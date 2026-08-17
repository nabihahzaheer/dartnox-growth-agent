/**
 * lib/types.ts — DUMMY-DATA-SPEC.md expressed as types the compiler enforces.
 *
 * Section order follows the spec: conventions, the governing rules that have a type-level
 * expression (R1/R2/R3/R6), the two error taxonomies, records 3.1–3.13 in order, then §4.1's
 * enumerations inline with their records, then §4.9's queue union and §6's metric types. The
 * derived-never-stored register from §4.7 is the last section, in one place, because it is the
 * R1 defence and it is easier to check as a list than scattered through the records.
 *
 * Two conventions used throughout, stated once here rather than repeated per line:
 *
 * 1. String-literal unions, not `enum`. A TypeScript `enum` emits a runtime object into the
 *    bundle and creates a nominal type you have to import to construct a value. A union of
 *    string literals is erased entirely at compile time, so a fixture writes `'linkedin'` and
 *    the compiler still rejects `'linkedln'`. Same safety, no runtime cost, no import graph.
 *
 * 2. Field names stay snake_case to match the fixtures and the spec tables. The one exception
 *    is `ToolError`, quoted verbatim from ARCHITECTURE-DRAFT.md annex B2 — that union is the
 *    contract drawn on the Miro board, and D-002 forbids the code and the board drifting, so
 *    it keeps the board's casing rather than being tidied.
 */

/* ============================================================================================
 * 1 · SCHEMA VERSION  (R3 · D-029)
 * ==========================================================================================*/

/**
 * D-029 (as amended): the constant lives here and `fixtures/schema.ts` re-exports it, so every
 * fixture has one import for both the types and the version they were authored against. A
 * mismatch fails `next build` instead of the browser.
 */
export const FIXTURE_SCHEMA_VERSION = '1' as const;

/** The literal type of the above, so a fixture can write:
 *    export const schemaVersion: FixtureSchemaVersion = '1';
 *  Widening it to `string` would delete the check, which is the whole mechanism. */
export type FixtureSchemaVersion = typeof FIXTURE_SCHEMA_VERSION;

/* ============================================================================================
 * 2 · TIME  (R2 · D-030)
 * ==========================================================================================*/

/**
 * The brand technique, explained once because it is used for every id below.
 *
 * `unique symbol` under `declare const` exists only in the type system — no runtime value is
 * emitted. Intersecting it into a primitive produces a type that is still a string/number at
 * runtime but is not assignable from a bare string/number, so `DraftId` and `RunId` stop being
 * interchangeable even though both are strings. `B extends string` is only a label to keep the
 * brands distinct from one another.
 */
declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

/**
 * R2/D-030: no absolute dates anywhere in the fixtures. Every timestamp is a signed offset in
 * minutes from one anchor resolved at build time. Signed because records exist on both sides of
 * "now" — onboarding is negative, a scheduled post is positive.
 *
 * Branded so an offset cannot be silently added to a duration in ms, and so `Date` or an ISO
 * string can never be assigned into a timestamp field by accident. That is the point: absolute
 * dates would make queue age grow 24h per day and would put every temporal relationship in the
 * dataset under manual maintenance.
 *
 * THE ANCHOR IS A THURSDAY, MID-MORNING CLIENT-LOCAL, AND THE WEEKDAY IS LOAD-BEARING.
 * The whole schedule is weekday-shaped (A-01): planning runs Monday, the drafting batch runs
 * Wednesday for the following week, review runway is counted in *working* days, and trace T13
 * is a Friday post drawing replies on a Saturday. A Thursday anchor puts yesterday's Wednesday
 * batch in the queue with a full runway ahead of it, last Friday's post inside the 48-hour
 * engagement-poll window, and Monday's planning run in recent history with next week's slots
 * already proposed. An anchor on the wrong day puts the Wednesday batch on a Sunday and makes
 * every runway figure wrong — so the weekday is a fixture invariant, not a detail.
 */
export type MinutesFromAnchor = Brand<number, 'MinutesFromAnchor'>;

/** Cast helper for fixture authoring. Type-level only — it compiles to the identity. */
export const minutes = (n: number): MinutesFromAnchor => n as MinutesFromAnchor;

/* ============================================================================================
 * 3 · BRANDED IDENTIFIERS
 * ==========================================================================================*/

export type ClientId = Brand<string, 'ClientId'>;
export type PillarId = Brand<string, 'PillarId'>;
export type CalendarSlotId = Brand<string, 'CalendarSlotId'>;
export type DraftId = Brand<string, 'DraftId'>;
export type DraftVersionId = Brand<string, 'DraftVersionId'>;
export type ApprovalId = Brand<string, 'ApprovalId'>;
export type PostId = Brand<string, 'PostId'>;
export type MetricSnapshotId = Brand<string, 'MetricSnapshotId'>;
export type GuardrailRuleId = Brand<string, 'GuardrailRuleId'>;
export type GuardrailEventId = Brand<string, 'GuardrailEventId'>;
export type RunId = Brand<string, 'RunId'>;
export type RunStepId = Brand<string, 'RunStepId'>;
export type ReflectionRuleId = Brand<string, 'ReflectionRuleId'>;
export type SettingsVersionId = Brand<string, 'SettingsVersionId'>;
export type OperatorId = Brand<string, 'OperatorId'>;

/**
 * C3 · the grouping key that survives folding slot fields onto Draft, which made Draft 1:1 with
 * channel and destroyed the parent linking a LinkedIn and an X treatment of the same angle.
 *
 * The spec types this `string | null` rather than `id`, because no VariantGroup record exists
 * for it to point at. Branded anyway: it is still a key, and branding stops a `DraftId` being
 * dropped into it. Un-brand it if the spec means the distinction literally.
 */
export type VariantGroupId = Brand<string, 'VariantGroupId'>;

/* ============================================================================================
 * 4 · SHARED VOCABULARY
 * ==========================================================================================*/

/** Two channels in v1 (A-07). Cadence is 3 LinkedIn + 5 X. */
export type Channel = 'linkedin' | 'x';

/** A-12's three-state result, used by rules, events and per-source input checks alike. */
export type GuardrailResult = 'pass' | 'warn' | 'fail';

/** §4.1. A-16 renders defaults and effect timing as data, so the timings are a closed set. */
export type EffectTiming =
  | 'immediate'
  | 'next_draft'
  | 'next_guardrail_run'
  | 'next_calendar'
  | 'next_publish';

/** Settings values are heterogeneous but not arbitrary; `unknown` here would push a cast into
 *  every settings row renderer. */
export type ConfigValue = string | number | boolean | string[];
export type ConfigObject = Record<string, ConfigValue>;

/**
 * §4.1 · the rejection taxonomy. A closed union rather than a free string, even though Settings
 * owns a `rejection_reason_set[]` the operator can edit: the *members* are fixed and the
 * settings set chooses which are active and what each is labelled. That is what lets
 * `Draft.applied_rejection_reason_ids[]` be checked at compile time.
 */
export type RejectionReasonCode =
  | 'off_pillar'
  | 'claim_unsupported'
  | 'tone_wrong'
  | 'duplicate'
  | 'timing_wrong'
  | 'legally_risky'
  | 'competitor_reference'
  | 'low_specificity'
  | 'other';

/**
 * §4.1 · the reflection taxonomy. A-05 names it and never lists it; §4.1 lists it. This is the
 * evidence behind a suggested reflection rule and cannot be computed client-side.
 */
export type EditTag =
  | 'tightened'
  | 'claim_softened'
  | 'jargon_removed'
  | 'specific_detail_added'
  | 'cta_changed'
  | 'hook_rewritten'
  | 'length_cut'
  | 'terminology_corrected'
  | 'client_example_added';

/* ============================================================================================
 * 5 · THE TWO ERROR TAXONOMIES  (D-031 · annex B2)
 *
 * These are deliberately different unions across two different boundaries, per A-06's "two
 * contract sets, separate boundaries":
 *
 *   ConsoleError  — what `agentClient.ts` throws at the operator console. Operator-facing; each
 *                   kind exists because the copy on screen differs.
 *   ToolError     — what the agent's effectors return to the orchestrator. Machine-facing; each
 *                   kind exists because the retry/park branch differs.
 *
 * They share three names (`not_found`, `rate_limited`, `timeout`) and mean different things at
 * each layer, which is exactly why they are two types and not one.
 * ==========================================================================================*/

/** D-031 · the seven kinds `agentClient.ts` throws. Payloads carry only what the operator-facing
 *  copy needs; anything more would be an unused field. */
export type ConsoleError =
  /** Any read. Renders as an empty state, not as an error. */
  | { kind: 'not_found' }
  /** `submitReview`. Approval binds a version (B1), so a draft that moved must not be decided
   *  against the version the operator opened. Carries the version to reload. */
  | { kind: 'version_conflict'; current_version_id: DraftVersionId }
  /** `submitReview`, `publishNow`. Shows the named rule and the offending span. */
  | { kind: 'guardrail_block'; rule_id: GuardrailRuleId; offending_span: OffendingSpan | null }
  /** `updateSettings` against a fixed, non-tunable rule (A-09/A-16). The control is disabled
   *  and says why. */
  | { kind: 'forbidden'; reason: string }
  /** Writes. Renders a retry-after countdown. */
  | { kind: 'rate_limited'; retry_after_ms: number }
  /** Any call, transient class (A-14). Renders a retry affordance. */
  | { kind: 'unavailable' }
  /** Writes only. Separate from `unavailable` because a timed-out write is genuinely ambiguous
   *  — it may have landed. The console says it does not know rather than silently retrying and
   *  risking a double approval (A-06). */
  | { kind: 'timeout' };

/** A candidate returned by `reconcile_published` when the platform read is ambiguous. Not a Post
 *  — the whole point is that we cannot yet say which of these, if any, is ours. */
export type PostRef = {
  platform_post_id: string;
  platform_url: string;
  published_at: MinutesFromAnchor;
};

/** Annex B2, verbatim including camelCase. `RunStep.error` carries this, and the retry-versus-
 *  park branch is driven off `kind`. */
export type ToolError =
  | { kind: 'not_found' }
  | { kind: 'rate_limited'; retryAfterMs: number }
  /** Permanent → `parked_blocked`, never retried. */
  | { kind: 'auth_failed'; channel: Channel }
  /** Transient → retry N5. */
  | { kind: 'upstream_error'; status: number }
  /** Ambiguous → reconcile before replay. */
  | { kind: 'timeout' }
  /** → park for human. Guessing in either direction is worse than asking. */
  | { kind: 'ambiguous_reconcile'; candidates: PostRef[] };

/* ============================================================================================
 * 6 · RECORD 3.1 · CLIENT
 * One record; D-017 is one client per console.
 *
 * Cadence and the budget block are NOT here. Both used to sit on Client and on Settings with
 * different shapes, which is the two-writers-one-fact defect R6 exists to prevent. Settings owns
 * both; see `SettingsCadenceEntry` and `BudgetSettings`.
 * ==========================================================================================*/

/** Token expiry is the planned case, tracked as data (A-07). Nullable because a channel that was
 *  never connected has no expiry, and the revoked-token demo switch sets `connected: false`. */
export type ClientChannel = {
  channel: Channel;
  /** L4 gates publish on this. */
  enabled: boolean;
  connected: boolean;
  handle: string;
  token_expires_at: MinutesFromAnchor | null;
};

/** A-17: no-history clients establish the baseline over the first four weeks, so "we do not have
 *  one yet" is a state and the rate must be nullable. */
export type EngagementBaseline = {
  channel: Channel;
  median_rate: number | null;
};

/** How `manual_baseline_minutes_per_post` was obtained. A-17 specifies the median of timed
 *  onboarding pieces; the other two exist so a fixture can be honest when it was not timed.
 *  (§4.1 does not enumerate this one — still chosen, not inherited.) */
export type BaselineMethod = 'timed_median' | 'timed_mean' | 'operator_estimate';

/** A-17's four-week rule needs a field, not an inference. */
export type EngagementBaselineSource = 'history' | 'first_4_weeks' | null;

export type Client = {
  id: ClientId;
  name: string;
  industry: string;
  blurb: string;
  /** IANA. Every publish time renders client-local, and the 2h publish grace window is
   *  meaningless without it. */
  timezone: string;
  /** Defines "week 1" for the dashboard's earliest reporting period. */
  onboarded_at: MinutesFromAnchor;
  channels: ClientChannel[];
  /**
   * R1 exception 1 of 4: a captured input measured during onboarding, not arithmetic.
   * The multiplier in hours saved = (posts × baseline minutes) − logged queue minutes.
   */
  manual_baseline_minutes_per_post: number;
  /** Provenance for the above, so "where does 47 come from" has an answer on the tooltip. */
  baseline_captured_at: MinutesFromAnchor;
  baseline_sample_n: number;
  baseline_method: BaselineMethod;
  /**
   * R1 exception 2 of 4: a carried-forward opening balance, not a sum over anything in the
   * fixture. The budget period is monthly and the dataset spans six weeks of history plus a
   * three-week forward pipeline, so it crosses a period boundary — without `budget_period_start`
   * the 80% alert cannot be computed at all, and without an opening balance the alert band is
   * only reachable by burning 80% of a month's budget inside the fixture.
   *
   * Live spend = `opening_spend_usd` + Σ step costs since `budget_period_start`. Note the spec's
   * §3.1 still writes that sum as `Σ Run.cost_total`, a field §3.10 deleted as an R1 violation;
   * the surviving source is `RunStep.cost_model_usd + cost_platform_usd`.
   */
  opening_spend_usd: number;
  budget_period_start: MinutesFromAnchor;
  /** First gate on the auto-approve prerequisite list. */
  trust_period_end: MinutesFromAnchor;
  engagement_baseline: EngagementBaseline[];
  engagement_baseline_source: EngagementBaselineSource;
  /** Calendar timeout drafts against the *last approved* pillar set, so "last approved" has to
   *  be a value. */
  pillar_set_version: number;
};

/* ============================================================================================
 * 7 · RECORD 3.2 · PILLAR
 * ==========================================================================================*/

/** A-14's decision menu already offers "pause pillar" — the behaviour is architecture, the field
 *  is new. B1's Pillar had nothing that could record a pause. */
export type PillarState = 'active' | 'paused';

export type Pillar = {
  id: PillarId;
  client_id: ClientId;
  name: string;
  /** Settings is an operator control screen; a name alone is not one. */
  description: string;
  /** Auto-approve prerequisite (per-draft tier), and the cheapest demonstration of a setting
   *  changing behaviour. */
  always_review: boolean;
  state: PillarState;
  /** Null on an active pillar. The queue must say why five items went grey at once, and link to
   *  the escalation that did it. */
  hold_reason: string | null;
  held_at: MinutesFromAnchor | null;
  hold_event_id: GuardrailEventId | null;
  /** Presentational, but the dashboard drill-down loses its visual key without a stable
   *  per-pillar colour. */
  colour_token: string;
};

/* ============================================================================================
 * 8 · RECORD 3.3 · CALENDARSLOT
 * Carries the published-vs-planned denominator.
 * ==========================================================================================*/

/**
 * §4.5 · six states, narrowed from eight. `drafting` and `scheduled` were removed because they
 * duplicated Draft and Post states on a third record, which is the same defect R6 exists to
 * prevent.
 *
 * Only three of these six are authored: `planned` (no draft exists yet), `slipped` and `dropped`
 * (the slot outcome differs from the draft outcome). `awaiting_approval`, `published` and
 * `quarantined` resolve through the slot's draft and post. The reducer therefore writes slot
 * state on exactly two transitions, not on every one.
 *
 * Note the spec's §3.3 table still lists the old eight members; §4.5 is the corrected list and
 * gives the reasoning, so §4.5 wins here. Worth fixing the §3.3 row before the PRD extract.
 */
export type CalendarSlotState =
  | 'planned'
  | 'awaiting_approval'
  | 'published'
  | 'slipped'
  | 'dropped'
  | 'quarantined';

/** §4.1. A published-vs-planned figure below 100% with no on-screen explanation is a number
 *  nobody can act on. */
export type SlipReason =
  | 'unreviewed_in_time'
  | 'rejected_redraft'
  | 'guardrail_block'
  | 'upstream_auth'
  | 'tool_failure';

export type CalendarSlot = {
  id: CalendarSlotId;
  pillar_id: PillarId;
  channel: Channel;
  publish_at: MinutesFromAnchor;
  angle: string;
  is_topical: boolean;
  state: CalendarSlotState;
  /** Set when a slot slips, so the calendar shows the move rather than silently relocating. */
  original_publish_at: MinutesFromAnchor | null;
  slip_reason: SlipReason | null;
  /** Ties the slot to the planning run that proposed it and the approval that ratified it. */
  calendar_run_id: RunId;
};

/* ============================================================================================
 * 9 · RECORD 3.4 · DRAFT
 * The heaviest record: queue row, detail-view subject, drill-down destination.
 * ==========================================================================================*/

/**
 * §4.3 · R6: Draft terminates at `approved`. `scheduled | pending_reapproval | publishing |
 * published | failed | pulled | invalidated` belong to Post and appear nowhere in this union —
 * two writable records claiming one fact drift within an hour of the reducer existing. `pulled`
 * in particular was listed as a draft state in A-02 and is not one.
 *
 * `scored` is in the union with no resting fixture — it lasts milliseconds, and the stream
 * simulator transitions through it live. `warn` is not a state: a warned draft sits in
 * `awaiting_approval` and the queue renders the warning from its guardrail event, which is the
 * only place the three-state guardrail result becomes legible in the product.
 */
export type DraftState =
  | 'drafting'
  | 'scored'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'blocked_guardrail'
  | 'blocked_auth'
  | 'held';

/** A-10's five rubric dimensions, 0–1. Judge returns these; the mean is ours to compute. */
export type ScoreComponents = {
  brand_voice: number;
  claim_support: number;
  pillar_fit: number;
  channel_fit: number;
  specificity: number;
};

/** Same keys, .30/.25/.20/.15/.10. Data next to the scores, because a single returned number
 *  hides whether the weights were applied. Showing the arithmetic is the antidote. */
export type ScoreWeights = ScoreComponents;

/** A-10 stage 1. Strictly outside the rubric — these never zero the score. */
export type DeterministicCheckName =
  | 'length'
  | 'placeholders'
  | 'disclaimers'
  | 'links'
  | 'banned_exact_match';

export type DeterministicCheck = {
  check: DeterministicCheckName;
  result: 'pass' | 'fail';
  detail: string;
};

/** §4.1. The three non-terminal stop states — `blocked_guardrail`, `blocked_auth`, `held` — each
 *  need a rendered cause. */
export type BlockedReasonCode =
  | 'banned_claim'
  | 'regulated_claim'
  | 'unapproved_entity'
  | 'pii_detected'
  | 'link_not_allowlisted'
  | 'injection_archived'
  | 'channel_disconnected'
  | 'pillar_paused';

export type BlockedReason = {
  code: BlockedReasonCode;
  note: string;
};

/**
 * N9 is conjunctive: both comparisons run, against published posts in the last 30 days on the
 * same channel AND against the current batch. An earlier `scope: 'published' | 'batch'` field
 * made them exclusive, which discards the intra-batch case trace T11 exists to catch.
 *
 * Each arm is separately nullable — a draft can duplicate a published post, a sibling in its own
 * batch, both, or neither. `window_days` and `same_channel` are literal types because N9 fixes
 * them; a fixture stating a different window would misrepresent the check.
 *
 * The cosine is asserted, not computed (spec §7): a token-overlap score called a cosine would be
 * worse, and the threshold is not portable across embedding models anyway.
 */
export type Similarity = {
  published: { max_cosine: number; against_post_id: PostId } | null;
  batch: { max_cosine: number; against_draft_id: DraftId } | null;
  window_days: 30;
  same_channel: true;
};

/** Inlined version object (DraftVersion folded onto Draft). Ordered, and never truncated —
 *  edit magnitude diffs two members, so truncating loses the metric. */
export type DraftVersion = {
  id: DraftVersionId;
  version: number;
  /** Identifies the last agent version before a human edit, which is the correct baseline for
   *  edit magnitude. Measuring against v1 would score the agent's own rewrites as human edits. */
  created_at: MinutesFromAnchor;
  /** Complete on every version. Edit magnitude is uncomputable if only the current text is
   *  stored. */
  text: string;
  /** Edit rate counts human-authored approved versions. Authorship is authoritative over the
   *  decision label; if they disagree, the version wins. Also the source of the derived
   *  `rewrite_count` — the agent-authored versions after the first. */
  author: 'agent' | 'human';
  /** L4 publishes only on hash match. */
  content_hash: string;
  /** Buckets drafts into before/after cohorts around a config change. This is the x-axis of the
   *  one graded drill-down: edit rate by settings version. */
  settings_version_id: SettingsVersionId;
  /** Not for the computation. So the UI can say "changed 14 of 71 tokens"; a percentage without
   *  raw counts is unfalsifiable. */
  token_count: number;
  edit_tags: EditTag[];
};

export type Draft = {
  id: DraftId;
  slot_id: CalendarSlotId;
  /** Denormalised from the slot. Every aggregation groups by these; a join per row in every
   *  metric is not worth the purity. */
  pillar_id: PillarId;
  channel: Channel;
  /** The detail view's entire required content is the reasoning trace, which lives on the run.
   *  Bidirectional with `Run.target_draft_id`. */
  run_id: RunId;
  state: DraftState;
  /** When the draft first entered review. Null before it ever did — a `drafting` draft orphaned
   *  by an operator halt has none. Not the queue's sort key: that is `Approval.queued_at`, which
   *  records when *this* review began, and the two differ for a redraft. */
  queued_at: MinutesFromAnchor | null;
  current_version_id: DraftVersionId;
  versions: DraftVersion[];
  score_components: ScoreComponents;
  score_weights: ScoreWeights;
  /**
   * R1 exception 4 of 4: DERIVED AND CACHED.
   *
   * The weighted mean of `score_components` under `score_weights`. Cached so the queue can sort
   * without recomputing on every render. It is not an independent fact: if it disagrees with the
   * components, the components win.
   */
  composite_score: number;
  deterministic_checks: DeterministicCheck[];
  /** Model tier fallback sets it and routes to a human by policy (A-03, A-14). Never folded into
   *  the score — without its own field the fallback path has zero surface anywhere in the
   *  product. Also one of the four per-draft auto-approve prerequisites. */
  degraded: boolean;
  blocked_reason: BlockedReason | null;
  similarity: Similarity | null;
  /** C3 · the LinkedIn/X sibling link. Null for a slot with no sibling treatment. Variants are
   *  not versions — channel fit is scored per channel, and an approval binds one version to one
   *  publication. */
  variant_group_id: VariantGroupId | null;
  /** The handoff payload's expandable evidence, one array each. */
  source_refs: string[];
  example_refs: PostId[];
  applied_reflection_rule_ids: ReflectionRuleId[];
  /** A rejection "visibly changes what the agent does next" only if the next draft can point at
   *  the rejection it consumed. Holds codes from the fixed taxonomy despite the `_ids` name,
   *  which the spec kept from an earlier draft. */
  applied_rejection_reason_ids: RejectionReasonCode[];

  /* Not stored — see §22 for the full register. `rewrite_count` is a count over `versions[]`
   * where `author === 'agent'`; `is_at_risk` is deadline minus now against redraft runway; edit
   * distance is computed in the browser beside a documented tokeniser constant. */
};

/* ============================================================================================
 * 10 · RECORD 3.5 · APPROVAL
 * ==========================================================================================*/

export type ApprovalDecision = 'approve' | 'approve_with_edits' | 'reject' | 'escalate';

/**
 * An Approval row is created when the run hits the approval interrupt, not when a decision is
 * made — `queued_at` is "the moment the run hit the interrupt", `decided_at: null` is the
 * canonical pending test, §4.8 says the queue orders on `Approval.queued_at`, and §6 fixtures
 * ~10 pending rows. So the six decision fields below are all nullable and all fill together.
 *
 * (§4.8's "Approve → `Approval` (new: …)" reads as though the row is created on approve. Taken
 * literally that contradicts the three statements above and leaves the queue with nothing to
 * sort on. Treated as loose prose about which fields the action writes.)
 */
export type Approval = {
  id: ApprovalId;
  /** Approval binds a *version*, not a draft. L4's hash check depends on it. */
  draft_version_id: DraftVersionId;
  decision: ApprovalDecision | null;
  /** Structured code from the fixed taxonomy, plus a note. B1 had collapsed this to the code
   *  alone. Both null on an approve with no comment. */
  reason_code: RejectionReasonCode | null;
  reason_note: string | null;
  /** The moment the run hit the approval interrupt. Queue-age p95 has no start without it, and
   *  this — not `Draft.queued_at` — is what the p95 measures. */
  queued_at: MinutesFromAnchor;
  /** Null means pending, so no separate status field is needed. */
  decided_at: MinutesFromAnchor | null;
  /**
   * Inclusive of editing time — the rubber-stamp clock (A-17: approvals under 15s).
   * Not to be conflated with `decided_at − queued_at`, which is how long the item sat in the
   * queue. Reporting queue age as "time to decision" makes a 30-hour wait look like 30 hours of
   * careful review.
   */
  seconds_open: number | null;
  /** The auto-approve-rate numerator is unaddressable without it, even while v1 is all-human. */
  decided_by: 'operator' | 'system' | null;
  /** Constant under one client per console, but the metric's stated action is a conversation
   *  with a specific person. */
  operator_id: OperatorId;
  /** C4: one Approval per decision session. `superseded_by` marks a genuine re-decision, which
   *  is what keeps edit rate and approval rate from disagreeing with the queue. */
  superseded_by: ApprovalId | null;
  /** Denormalised so the dashboard can slice decisions without a three-hop join through
   *  version → draft → slot. */
  pillar_id: PillarId;
  channel_at_decision: Channel;
};

/* ============================================================================================
 * 11 · RECORD 3.6 · POST
 * R6: authoritative from scheduling onward.
 * ==========================================================================================*/

/**
 * §4.4 · seven states. `pending_reapproval` and `invalidated` are two different cases that were
 * previously collapsed:
 *
 *   pending_reapproval — trace T7. An operator edits an already-approved post; the edit creates a
 *                        new version, the prior approval is invalidated, and the post leaves
 *                        `scheduled` until re-approval.
 *   invalidated        — the settings-change case. A scheduled post re-validated at L4 and
 *                        bounced back to the queue. This is the brief's bonus moment, and
 *                        `invalidated_reason` is defined for this case only, which is why the two
 *                        cannot share a state.
 */
export type PostState =
  | 'scheduled'
  | 'pending_reapproval'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'pulled'
  | 'invalidated';

/** §4.1. Pulling is reversible and is not replying (A-14/A-16). */
export type PullReason =
  | 'negative_engagement'
  | 'stakeholder_request'
  | 'factual_error'
  | 'auto_pull_threshold';

export type Post = {
  id: PostId;
  draft_version_id: DraftVersionId;
  channel: Channel;
  scheduled_at: MinutesFromAnchor;
  state: PostState;
  /** Blocking for four metrics. B1 had only `scheduled_at`, and the entire point is that
   *  scheduled ≠ published. */
  published_at: MinutesFromAnchor | null;
  platform_post_id: string | null;
  platform_url: string | null;
  /** PublishAttempt was dropped, so the two fields that make at-least-once auditable surface
   *  here. The publish run renders the hash comparison as a visible step. */
  approved_content_hash: string;
  idempotency_key: string;
  /** Cost per post has two addends and run steps only carry the model one. X is pay-per-use; a
   *  URL-bearing post costs a multiple of a plain one. */
  platform_cost_usd: number;
  /** The bonus moment must say *which* setting change invalidated it. Defined for the
   *  `invalidated` case only — `pending_reapproval` has its own cause on the new version. */
  invalidated_reason: string | null;
  pulled_at: MinutesFromAnchor | null;
  pull_reason: PullReason | null;
};

/* ============================================================================================
 * 12 · RECORD 3.7 · METRICSNAPSHOT
 * ==========================================================================================*/

/** The classification may be stored; the reply text may not (R8 — it lives only on
 *  GuardrailEvent). */
export type Sentiment = 'neutral' | 'negative' | 'severe';

export type MetricSnapshot = {
  id: MetricSnapshotId;
  post_id: PostId;
  /** Multiple snapshots per post give the accrual curve the drill-down needs. */
  captured_at: MinutesFromAnchor;
  /** Denormalised; determines which counter schema applies. */
  channel: Channel;
  /**
   * Nullable, and nulls are excluded rather than zeroed. LinkedIn and X do not expose the same
   * counters; a zero in the numerator reads as poor engagement rather than as no data.
   */
  impressions: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
  /** N8. Not an independent truth — must be consistent with `published_at + 7d`. A snapshot must
   *  not claim maturity at day three. */
  is_mature: boolean;
  /**
   * R1 exception 3 of 4: stored deliberately, not by oversight. A-05 recomputes percentiles on a
   * schedule over a rolling 12-month window per client and channel, so in production this is a
   * captured value with a computation date, not a live derivation. Deriving it live over six
   * weeks of fixtures would model something the architecture explicitly does not do.
   * Explains why a post was retrieved as a few-shot example.
   */
  percentile: number | null;
  sentiment: Sentiment | null;
};

/* ============================================================================================
 * 13 · RECORD 3.8 · GUARDRAILRULE
 * 13 rules across four layers; three of them fixed (regulated-claim, prompt-injection, and the
 * stakeholder-tier escalation triggers — A-09).
 * ==========================================================================================*/

/** Layer is a chart axis, so it must be a field. */
export type GuardrailLayer = 'L1' | 'L2' | 'L3' | 'L4';

/** §4.1. `prompt_injection` is enumerated explicitly so the injection filter is a lookup rather
 *  than a string match on a display name. */
export type GuardrailKind =
  // L1 input, on sources
  | 'prompt_injection'
  | 'domain_allowlist'
  | 'content_type'
  // L2 generation
  | 'output_schema'
  | 'length_limit'
  | 'outbound_link_allowlist'
  // L3 output
  | 'banned_claim'
  | 'regulated_claim'
  | 'competitor_mention'
  | 'pii'
  | 'claim_entailment'
  | 'similarity'
  // L4 action, pre-publish
  | 'content_hash_match'
  | 'channel_enabled'
  | 'posting_window'
  | 'rate_limit'
  | 'reconciliation';

export type GuardrailRule = {
  id: GuardrailRuleId;
  layer: GuardrailLayer;
  kind: GuardrailKind;
  config: ConfigObject;
  /** B1: block or warn. */
  severity: 'block' | 'warn';
  /** A-09's fixed, non-tunable set. Three rules, not two. */
  is_fixed: boolean;
  /** A settings row reading `L3/regulated_claim` is not an operator control. */
  display_name: string;
  description: string;
  /** The commonest real cause of a block rate falling to zero is somebody switching the rule off.
   *  Without these the dashboard raises a false alarm instead of saying why, and the chart can
   *  annotate a disabled-from marker rather than pretending history changed. */
  is_enabled: boolean;
  disabled_at: MinutesFromAnchor | null;
  /** A disabled toggle with no explanation reads as a bug. Empty when `is_fixed` is false. */
  fixed_reason: string;
  /** A-16 mandates the settings table carry defaults and effect timing. Rendered text is data. */
  default_config: ConfigObject;
  effect_timing: EffectTiming;
};

/* ============================================================================================
 * 14 · RECORD 3.9 · GUARDRAILEVENT
 * EscalationEvent merged in. R7: emitted on `pass` too — block rate's denominator is
 * evaluations, and a rule that stopped being evaluated must not look identical to a rule that
 * is passing everything.
 * ==========================================================================================*/

/**
 * The discriminator that makes a null `rule_id` well-formed rather than broken. Minting synthetic
 * rules for "budget" and "tool failure" would corrupt the per-rule block-rate chart with rules
 * that are not guardrails.
 *
 * RESOLVED: `operator_escalation` is the eighth member. §4.8's Escalate action had nothing valid
 * to write, so the reducer could not produce the record its own transition table described. It
 * also carries no rule, which is the case this union exists to make well-formed.
 *
 * This overlaps `EscalationTrigger` deliberately; they answer different questions. This one says
 * what produced the record and governs whether `rule_id` may be non-null. That one is the
 * precision cut, and exists only on events where `escalation_tier !== 'none'`.
 */
export type TriggerKind =
  | 'guardrail'
  | 'tool_failure'
  | 'budget'
  | 'entity'
  | 'engagement'
  | 'low_score'
  | 'auth'
  | 'operator_escalation';

export type EscalationTier = 'none' | 'operator' | 'stakeholder';

/**
 * §3.9 · eleven values. A-09 writes six operator triggers, but "any warn/fail" is two triggers
 * for this purpose — a warn routes to review and a fail blocks, and lumping them makes the
 * precision-per-trigger cut useless on the most common trigger of all. That gives seven.
 * `operator_initiated` is the eleventh: `Approval.decision` includes `escalate` and A-08 lists
 * escalation take-over as a gate, so an operator can raise one and nothing recorded it.
 *
 * Precision per trigger is the actionable cut — "escalation precision is 63%" steers nothing;
 * "the unapproved-entity trigger is 40% junk" tunes a rule.
 */
export type EscalationTrigger =
  // operator tier
  | 'low_score'
  | 'guardrail_warn'
  | 'guardrail_fail'
  | 'tool_failure'
  | 'unapproved_entity'
  | 'budget_threshold'
  | 'negative_engagement'
  // stakeholder tier
  | 'regulated_claim'
  | 'reputational'
  | 'repeat_rule_failure'
  // operator-raised
  | 'operator_initiated';

/** Offsets plus the version they index are what let the detail view highlight the span. */
export type OffendingSpan = {
  start: number;
  end: number;
  text: string;
  version_id: DraftVersionId;
};

/**
 * R8's only permitted home for inbound reply text. Never in retrieval or drafting context, and
 * never inlined on a RunStep — `get_engagement`'s inlined tool output carries counts, sentiment
 * labels and reply ids only, and the console links across to the escalation for the text.
 */
export type Reply = {
  author_handle: string;
  text: string;
  sentiment: Sentiment;
  received_at: MinutesFromAnchor;
};

export type GuardrailEvent = {
  id: GuardrailEventId;
  run_id: RunId;
  /** The console renders the check at its position in the stream. Run-level attachment cannot
   *  order it. */
  run_step_id: RunStepId;
  /** Null for a planning-run event, which belongs to no draft. A join through `run_id` also fails
   *  for L4 events, where the run is the *publish* run. */
  draft_id: DraftId | null;
  /** Nullable: half the merged escalations have no guardrail behind them. `trigger_kind` is what
   *  makes the null well-formed. */
  rule_id: GuardrailRuleId | null;
  trigger_kind: TriggerKind;
  result: GuardrailResult;
  /** Every dashboard chart has a time axis; `run_id` carries none. */
  evaluated_at: MinutesFromAnchor;
  offending_span: OffendingSpan | null;
  /** For injection events the span is withheld by design — the operator may be the injection's
   *  target. An empty span with no explanation looks like missing data. */
  span_withheld: boolean;
  withheld_reason: string | null;
  escalation_tier: EscalationTier;
  /** Null on a plain pass event, which escalates nothing. */
  escalation_trigger: EscalationTrigger | null;
  raised_at: MinutesFromAnchor;
  /** N14's 72-hour stakeholder countdown. */
  acknowledged_at: MinutesFromAnchor | null;
  /**
   * Tri-state, not boolean. `null` means unlabelled. If unlabelled escalations counted as correct
   * the precision metric would read high by default — which is what "the column without which the
   * metric is fiction" means. One click sets it, and the precision figure moves: the shortest
   * causal chain in the product between an action and a metric.
   */
  was_unnecessary: boolean | null;
  /** Lets the dashboard show coverage beside precision: "67% over 18 labelled of 24". */
  labelled_at: MinutesFromAnchor | null;
  labelled_by: OperatorId | null;
  /** Makes domain flagging visible rather than asserted. */
  source_url: string | null;
  domain_flagged: boolean;
  replies: Reply[];
  decision_deadline: MinutesFromAnchor | null;
  /** The one-line reason at the top of the handoff payload. */
  detail: string;
};

/* ============================================================================================
 * 15 · RECORD 3.10 · RUN
 * ==========================================================================================*/

export type RunType = 'planning' | 'draft' | 'publish' | 'poll';

/** A-01's six entry points. The console header saying *why* this run fired is the difference
 *  between a feed and a trace. `manual.run_now` is also the §6b unlock that makes every
 *  "next draft" setting demonstrable. */
export type RunTrigger =
  | 'schedule.weekly_plan'
  | 'schedule.weekly_draft'
  | 'manual.run_now'
  | 'poll.performance'
  | 'poll.engagement'
  | 'sweep.resume';

/** §4.2 · A-02's canonical eight. `awaiting_human` covers both the draft gate and the calendar
 *  gate — which human is waiting is carried by the interrupt step, not by a second state. */
export type RunState =
  | 'queued'
  | 'running'
  | 'awaiting_human'
  /** Sweep-eligible only. */
  | 'parked_transient'
  /** Re-armed by an event, not by the clock. */
  | 'parked_blocked'
  /** Human clearance only. No draft produced. */
  | 'quarantined'
  | 'completed'
  | 'abandoned';

/** §4.1. */
export type ParkReason =
  | 'upstream_error'
  | 'rate_limited'
  | 'auth_failed'
  | 'injection_quarantine'
  | 'budget_admission_stop'
  | 'awaiting_reconcile';

/** §4.1, abandoned only. C6: the architecture named the state and nothing that creates one.
 *  `operator_halt` maps the halt control onto `abandoned` rather than inventing a `halted`
 *  state, which makes the state reachable through the reviewer's own action. */
export type EndReason = 'step_cap_exceeded' | 'cost_ceiling_exceeded' | 'operator_halt';

/**
 * ◆ DEMO AFFORDANCE — no production counterpart. Must be named as such in the README.
 * Selects among alternate pre-written step sequences for the failure drawer. In production a run
 * has no variant; it has whatever happened.
 */
export type RunVariant =
  | 'nominal'
  | 'tool_failure'
  | 'poisoned_source'
  | 'auth_revoked'
  | 'hostile_reply';
// `low_score` removed (D-041). A-09 already establishes that in v1 a score below threshold
// reroutes nothing, because every draft reaches the operator regardless. Its two real
// consequences are demonstrated without a variant: the rewrite loop appears as `rewrite` steps
// in the nominal trace, and the queue treatment (flagged, sorted up, review flag) is produced by
// moving `score_threshold` in Settings across a below-threshold draft that the fixtures carry.

export type Run = {
  id: RunId;
  client_id: ClientId;
  type: RunType;
  /** Fan-out: one parent, eight children, two failing without failing the week. */
  parent_run_id: RunId | null;
  state: RunState;
  checkpoint_ref: string;
  trigger: RunTrigger;
  park_reason: ParkReason | null;
  end_reason: EndReason | null;
  started_at: MinutesFromAnchor;
  ended_at: MinutesFromAnchor | null;
  /** N4. Literal because a run approaching its cap is a state worth showing, and a fixture with
   *  a different cap would misrepresent the architecture. */
  step_cap: 20;
  /** Same omission as on Draft: tier fallback has no surface without it. */
  degraded: boolean;
  /** The run is where config was resolved. */
  settings_version_id: SettingsVersionId;
  /** Bidirectional with `Draft.run_id`; also the per-post cost drill-down. */
  target_draft_id: DraftId | null;
  target_post_id: PostId | null;
  /** A parked run must show when it will be retried, or parking looks like death. */
  next_sweep_at: MinutesFromAnchor | null;
  /** ◆ demo affordance — see RunVariant. */
  variant: RunVariant;

  /* Removed as R1 violations: `step_count`, `tokens_total`, `cost_total`. All three are sums over
   * this run's RunSteps, and a run header disagreeing with the steps rendered directly beneath it
   * is the most visible possible instance of the defect. `step_cap` stays because it is a policy
   * value, not a sum. */
};

/* ============================================================================================
 * 16 · RECORD 3.11 · RUNSTEP
 * The record the highest-weighted screen is made of.
 * ==========================================================================================*/

/** The brief mandates the first four by name. The graph forces the last three — a run stopping at
 *  an approval interrupt has to render that stop. */
export type RunStepType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'action'
  | 'guardrail'
  | 'interrupt'
  | 'rewrite';

/** Annex B2's effectors. Guardrails are not tools — they are orchestrator-owned nodes the model
 *  cannot decline to call — so no guardrail appears here.
 *
 *  `delete_post` was missing from this union while appearing in both B2 and on the board. It is
 *  the effector behind the operator's pull decision on the hostile-reply path (A-14), so without
 *  it that remediation step had no valid `tool_name` and the narrative could not be fixtured.
 *  Irreversible and operator-initiated only: the agent never calls it on its own. */
export type ToolName =
  | 'search_sources'
  | 'fetch_source'
  | 'get_performance'
  | 'retrieve_examples'
  | 'get_engagement'
  | 'reconcile_published'
  | 'schedule_post'
  | 'notify_operator'
  | 'notify_stakeholder'
  | 'publish_post'
  | 'delete_post';

/** §4.1. A result step with no outcome is not a result. `skipped` covers retrieval below N7. */
export type StepOutcome = 'ok' | 'error' | 'skipped';

/** SourceDocument's inlining. `why_selected` is what makes source choice legible rather than
 *  magical. */
export type StepSource = {
  url: string;
  domain: string;
  title: string;
  publisher: string;
  fetched_at: MinutesFromAnchor;
  summary: string;
  citations: string[];
  guard_result: GuardrailResult;
  why_selected: string;
};

/** Operator briefs are ranked first as the differentiation engine and have no record of their
 *  own. They ride here or the substance layer is invisible. */
export type BriefRef = {
  author: string;
  submitted_at: MinutesFromAnchor;
  text: string;
};

/**
 * The field that closes the brief's two hardest loops. A rejection changing what the agent does
 * next, and a setting visibly changing behaviour, are both demonstrated by the next run's
 * drafting step listing what it consumed.
 *
 * §6b's load-bearing requirement: this array must be assembled from current settings at run time,
 * not pre-baked into the fixture. That single requirement is what converts every "next draft"
 * setting from undemonstrable to demonstrable via `run_now`.
 */
export type AppliedInput = {
  kind: 'reflection_rule' | 'rejection_reason' | 'example' | 'setting';
  id: string;
  label: string;
};

/** Lets a step that produced a record navigate to it. */
export type ProducedRef =
  | { entity_type: 'draft'; id: DraftId }
  | { entity_type: 'post'; id: PostId }
  | { entity_type: 'calendar_slot'; id: CalendarSlotId }
  | { entity_type: 'approval'; id: ApprovalId }
  | { entity_type: 'metric_snapshot'; id: MetricSnapshotId };

/** A-08's four human gates. */
export type InterruptGate =
  | 'calendar_approval'
  | 'draft_approval'
  | 'escalation_takeover'
  | 'post_publish_intervention';

/**
 * §4.6 narrowed the vocabulary: of the Agent Inbox pattern's accept/edit/respond/ignore, two do
 * not apply. `respond` is a reply to an agent question this graph never asks, and `ignore` is
 * indistinguishable from letting the slot slip, which is already modelled on the slot. So the
 * options are the four decisions plus A-14's hostile-reply menu.
 */
export type InterruptOption = ApprovalDecision | 'resume' | 'pull' | 'pause_pillar';

export type StepInterrupt = {
  gate: InterruptGate;
  awaiting: 'operator' | 'stakeholder';
  options: InterruptOption[];
  /** N1b 48h for the calendar gate, N14 72h for stakeholder escalation. */
  deadline: MinutesFromAnchor;
};

/** The planning run proposes slots *before* any of them are ratified, so this cannot be a
 *  CalendarSlot — no slot record exists yet. */
export type ProposedSlot = {
  pillar_id: PillarId;
  channel: Channel;
  publish_at: MinutesFromAnchor;
  angle: string;
  is_topical: boolean;
};

export type RunStep = {
  id: RunStepId;
  run_id: RunId;
  /** Stream order and replay order. */
  seq: number;
  type: RunStepType;
  label: string;
  thinking_text: string | null;
  started_at: MinutesFromAnchor;
  /** C2 · the honest number, shown as metadata. A drafting call is ~20s. */
  latency_ms: number;
  /**
   * ◆ DEMO AFFORDANCE — no production counterpart. Must be named as such in the README.
   * C2: a run played at its true four-minute duration is unwatchable; a uniform 300ms tick is
   * the faked streaming the brief rejects. Two numbers, ratio stated in the README.
   */
  playback_ms: number;
  model: string | null;
  model_snapshot: string | null;
  /** Replaces B1's single `tokens`. Input and output pricing differ ~5×; one count makes the
   *  cost figure unauditable. */
  tokens_in: number;
  tokens_out: number;
  /** Two fields, not one amount plus a kind — a publish step can incur both. Also the only
   *  surviving source for run and period cost totals, now that Run carries no sums. */
  cost_model_usd: number;
  cost_platform_usd: number;
  /** C1: hashes stay as *displayed provenance* while payloads are inlined below. Production
   *  resolves the reference through the trace store; the prototype has no backend to resolve it
   *  against, and the README says so. */
  input_hash: string | null;
  output_ref: string | null;
  /**
   * The brief requires expandable tool inputs and outputs; a reference cannot be dereferenced
   * with no backend. `unknown` rather than `any` — call sites must narrow.
   *
   * R8 collision, resolved: `get_engagement`'s output carries counts, sentiment labels and reply
   * ids only. Reply *text* resolves from the GuardrailEvent the escalation created. Putting it
   * here would break R8 on the highest-traffic screen.
   */
  tool_input: Record<string, unknown> | null;
  tool_output: Record<string, unknown> | null;
  tool_name: ToolName | null;
  outcome: StepOutcome | null;
  /** The agent-side union, not `ConsoleError`. The retry-versus-park branch is driven by this. */
  error: ToolError | null;
  /** N5. Backoff is only visible if the attempt number *and* the gap are both data; the jitter is
   *  what makes it read as real. `max_attempts` is literal for the same reason as `step_cap`. */
  attempt: number;
  max_attempts: 3;
  backoff_ms: number | null;
  sources: StepSource[];
  brief_ref: BriefRef | null;
  applied_inputs: AppliedInput[];
  /** Pairs a guardrail step with its event. */
  guardrail_event_id: GuardrailEventId | null;
  produced: ProducedRef | null;
  interrupt: StepInterrupt | null;
  /** Carried on the planning run's interrupt step. */
  proposed_calendar: { slot: ProposedSlot }[] | null;
};

/* ============================================================================================
 * 17 · RECORD 3.12 · REFLECTIONRULE
 * Five rules: 3 active, 1 suggested, 1 retired. The 15-rule cap is a count over
 * `status === 'active'`, not a field.
 *
 * Was six, with two suggested. The second claimed a `cta_changed` pattern that occurs in none of
 * the retained history, so it could not carry the evidence a suggestion is defined by — see the
 * header of `fixtures/reflectionRules.ts`.
 * ==========================================================================================*/

export type ReflectionRuleStatus = 'suggested' | 'active' | 'retired';

export type ReflectionRule = {
  id: ReflectionRuleId;
  client_id: ClientId;
  text: string;
  status: ReflectionRuleStatus;
  /**
   * The draft versions whose edits produced the suggestion. A `suggested` rule must carry its
   * three backing edits — that is the only visible evidence in the product that the reflection
   * loop exists, and a suggestion emitted from the last twenty decisions has all three retained by
   * construction.
   *
   * Empty is meaningful and is not the same as missing: a rule activated before the retained
   * history window was emitted from decisions this fixture set no longer holds. `scripts/check.mts`
   * enforces the distinction — every id present must resolve to a human-authored version carrying
   * this rule's `evidence_tag`, and a `suggested` rule must have three.
   */
  evidence_ids: DraftVersionId[];
  review_due: MinutesFromAnchor;
  /** Showing three edits without naming the recurring pattern makes the operator re-derive the
   *  rule's cause. */
  evidence_tag: EditTag;
  /** Splits edit rate into before/after cohorts, and explains a benign drop in a guardrail's
   *  block rate. */
  activated_at: MinutesFromAnchor | null;
  retired_at: MinutesFromAnchor | null;
  /** Rules are "visible, editable, versioned". */
  version: number;
};

/* ============================================================================================
 * 18 · RECORD 3.13 · SETTINGS
 * Not a flat blob. A-16 mandates per-row types, defaults and effect timing, which makes the
 * settings screen a rendering of field descriptors, not of raw values.
 * ==========================================================================================*/

/** C9: a bare version integer cannot resolve what version 3 *said*. Inline history with per-key
 *  diffs, plural, because A-16 requires an audit trail of versioned change *events*. Three
 *  versions in the fixture — the argument holds at three, and diff arrays are among the hardest
 *  rows to author. This history is also the x-axis of the one graded drill-down. */
export type SettingsDiffEntry = {
  key: string;
  from: ConfigValue | null;
  to: ConfigValue | null;
};

export type SettingsVersion = {
  version_id: SettingsVersionId;
  changed_at: MinutesFromAnchor;
  changed_by: OperatorId;
  change_summary: string;
  diff: SettingsDiffEntry[];
};

/** Picks which of A-17's two thresholds the dashboard colours against. */
export type SettingsPhase = 'v1_all_human' | 'post_auto_approve';

/** A required operator control. A-16 does not enumerate register or person, and `field_meta`
 *  supplies the control shape per key, so these stay strings rather than inventing a taxonomy. */
export type ToneSettings = {
  register: string;
  person: string;
  banned_phrases: string[];
  sample: string;
};

/**
 * A-09's ten prerequisites, split because conflating them would show a green checklist beside a
 * draft that would not have qualified.
 *
 * These six are client-level and static. They are the checklist rendered next to the locked
 * toggle, and three of them are not derivable from the other fixtures, so `met` is stored.
 */
export type AutoApproveClientPrereq =
  | 'trust_period_passed'
  | 'decision_volume_met'
  | 'cross_vendor_judge'
  | 'injection_interlock_clear'
  | 'channel_enabled'
  | 'no_recent_pillar_rejection';

/**
 * The other four are per-draft and must render on the *draft*, not as a client-level tick. All
 * four are computable from records already in the fixture — `Draft.composite_score` against
 * `Settings.score_threshold`, the draft's GuardrailEvents, `Draft.degraded`, and
 * `Pillar.always_review` — so nothing stores them.
 */
export type AutoApproveDraftPrereq =
  | 'score_above_threshold'
  | 'all_guardrails_pass'
  | 'not_degraded'
  | 'pillar_not_always_review';

/** Kept so the count of ten stays expressible in one place. */
export type AutoApprovePrereq = AutoApproveClientPrereq | AutoApproveDraftPrereq;

export type AutoApprovePrereqStatus = {
  key: AutoApproveClientPrereq;
  met: boolean;
  detail: string;
};

/**
 * `enabled` and `locked` are literal types, not booleans. A-09 makes auto-approve off and locked
 * for the whole of v1 and A-19 makes the gate itself a permanent invariant, so a fixture that
 * turned it on should fail the build rather than render a screen the architecture forbids.
 */
export type AutoApproveSettings = {
  enabled: false;
  locked: true;
  lock_reason: string;
  prereqs: AutoApprovePrereqStatus[];
};

/** Best historical slot per channel/day is a lookup *within* these windows (A-02). Minutes from
 *  local midnight rather than a time string, so the lookup is arithmetic. §6b makes these live
 *  via `run_now`: changing one moves the next planning run's proposed calendar. */
export type PostingWindow = {
  /** 0 = Sunday. */
  day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  start_local_minute: number;
  end_local_minute: number;
};

/** Settings owns cadence outright — it used to sit on Client too, with a different shape. */
export type SettingsCadenceEntry = {
  channel: Channel;
  per_week: number;
  posting_windows: PostingWindow[];
};

/** Rendered in Settings *and* as the reject dialog's options — an invisible prompt input is
 *  undebuggable. `active` selects which of the fixed taxonomy's members the dialog offers. */
export type RejectionReasonEntry = {
  code: RejectionReasonCode;
  label: string;
  active: boolean;
};

/** Human approval on every post renders as a *locked* row, which is what `is_fixed` is for. */
export type EscalationRuleEntry = {
  trigger: EscalationTrigger;
  tier: EscalationTier;
  enabled: boolean;
  is_fixed: boolean;
};

export type WeekendEscalationContact = {
  name: string;
  channel: string;
  response_expectation: string;
};

/**
 * N6. Settings owns the budget block outright; Client carries only the opening balance and the
 * period start. Defaults are alert 80 / stop 100, both numbers because both are tunable — and
 * §6b makes `cap` a live demo control: drag it below current spend and the admission stop
 * engages while the engagement poll keeps running, labelled "exempt: safety".
 */
export type BudgetSettings = {
  cap: number;
  alert_pct: number;
  stop_pct: number;
};

/** Default off, the client's choice (A-16). Pulling is reversible and is not replying. */
export type AutoPullSettings = {
  enabled: boolean;
  after_hours: number;
};

/** A-16's per-row descriptor. Without it the screen is a form with no explanation of when a
 *  change takes effect. */
export type FieldMeta = {
  type: 'boolean' | 'number' | 'string' | 'string_list' | 'enum' | 'object';
  default: ConfigValue | null;
  effect_timing: EffectTiming;
  is_fixed: boolean;
  unit: string | null;
  range: { min: number; max: number } | null;
};

export type Settings = {
  client_id: ClientId;
  current_version_id: SettingsVersionId;
  versions: SettingsVersion[];
  phase: SettingsPhase;
  tone: ToneSettings;
  /** A-10's defined scale; default 0.85. The highest-value live control — §6b's one setting that
   *  needs no run at all: recompare against every draft's composite score and the queue re-sorts
   *  while review flags appear and clear. */
  score_threshold: number;
  auto_approve: AutoApproveSettings;
  cadence: SettingsCadenceEntry[];
  rejection_reason_set: RejectionReasonEntry[];
  escalation_triggers: EscalationRuleEntry[];
  approval_rules: EscalationRuleEntry[];
  /** Two fields, deliberately. Conflating them once made posts unable to link to the client's own
   *  site (A-12 L2). */
  domain_allowlist: string[];
  outbound_link_allowlist: string[];
  entities: string[];
  terminology: string[];
  negative_engagement_threshold: number;
  auto_pull: AutoPullSettings;
  weekend_escalation_contact: WeekendEscalationContact;
  budget: BudgetSettings;
  /** Keyed by settings path, e.g. `'score_threshold'`. */
  field_meta: Record<string, FieldMeta>;
};

/* ============================================================================================
 * 19 · THE QUEUE HOLDS A UNION  (§4.9 · C5 · D-033)
 * ==========================================================================================*/

/**
 * The run-backed arm exists because a quarantined run halts before a draft is created, and a
 * parked run awaiting reconnection needs a human too. Both need clearing; neither is a draft. A
 * queue typed as `Draft[]` silently drops the two most interesting items in the system.
 *
 * Members are whole records rather than ids: the queue row renders the draft's score, the
 * approval's clock and the events' badges together, and a queue that held ids would make every
 * row do three lookups.
 *
 * ---------------------------------------------------------------------------------------------
 * THE THIRD ARM, AND WHY IT IS THE SAME ARGUMENT AGAIN (D-043)
 *
 * A scheduled post that fails re-validation after a settings change goes to `Post.invalidated` and
 * comes back for a decision. It is not a draft — `Draft` terminates at `approved` (D-032), so the
 * draft behind it cannot return to `awaiting_approval` — and it is not a run. The board's lifecycle
 * frame draws it as `scheduled → invalidated → scheduled` and says the queue renders it.
 *
 * So the union grows a third member for exactly the reason it had two: a queue typed too narrowly
 * drops the item the demo is about. The cost is that every queue-rendering component branches on
 * three kinds instead of two, which is cheap now and expensive after the screen is built against
 * two — which is why it is done before the screen rather than after.
 */
export type QueueItem =
  | {
      kind: 'draft';
      draft: Draft;
      /** Null only before the run reaches the approval interrupt. */
      approval: Approval | null;
      events: GuardrailEvent[];
    }
  | {
      kind: 'run';
      /** Quarantined or parked. */
      run: Run;
      events: GuardrailEvent[];
    }
  | {
      kind: 'post';
      /** `invalidated`. A post whose approval no longer holds under current settings. */
      post: Post;
      /**
       * The draft the post's version belongs to, carried rather than looked up: the row renders the
       * text that is about to publish, and that text lives on a `DraftVersion`, not on the Post.
       * Resolving it in the component would make the row do the join the queue exists to have
       * already done.
       */
      draft: Draft;
      /** The pending re-approval the sweep opened. Never null — a post in the queue with nothing
       *  to decide against would have no way out of it. */
      approval: Approval;
      events: GuardrailEvent[];
    };

/* ============================================================================================
 * 20 · METRIC RESULTS  (§6)
 * ==========================================================================================*/

/**
 * Metric functions return a discriminated result, not a number. A-17 insists the four flavours of
 * nothing are not interchangeable, and `number | null` forces the UI to guess which nothing it
 * received. Generic over the value type because not every metric is a scalar — a distribution or
 * a per-layer breakdown uses the same four outcomes.
 *
 * The week-one empty state falls out of this for free: setting the window to the client's first
 * week makes every metric legitimately return `no_data` through the *same code path* as the
 * populated view, so empty states are handled rather than special-cased.
 */
export type MetricResult<T> =
  | {
      kind: 'ok';
      value: T;
      /** Three metrics stay thin even at this volume: queue-age p95 (n = 8 per week, so the p95
       *  is the maximum of eight), per-rule weekly block rate (n ≈ 7 per rule-week), and
       *  edit-magnitude median (n ≈ 12). The tile says so, which it cannot do without the count. */
      sample_n: number;
    }
  /** Renders the descriptor's empty-state copy, e.g. "awaiting first publish". Never red. */
  | { kind: 'no_data' }
  /** Auto-approve rate in v1: n/a by design, never red. */
  | { kind: 'not_applicable'; reason: string }
  /** A-17's four-week rule for no-history clients: "2 of 4 weeks". */
  | { kind: 'establishing_baseline'; weeks_elapsed: number; weeks_required: number };

/** Derived from the union above so the descriptor's empty-state status and the runtime result can
 *  never drift apart. */
export type MetricResultKind = MetricResult<unknown>['kind'];

/** Spellings now aligned with `SettingsPhase`; a descriptor may additionally be `'both'`, which a
 *  Settings value never is. Built from `SettingsPhase` so the two cannot drift. */
export type MetricPhase = SettingsPhase | 'both';

/**
 * `metricDescriptors.ts` — configuration, not a simulated record, so it is not one of the 13.
 * A-17 specifies per metric a definition, a healthy range, an action, a phase and an empty state.
 * Hardcoding those in the dashboard component would make "defined before you build it" untrue for
 * the one screen it most applies to.
 */
export type MetricDescriptor = {
  id: string;
  label: string;
  family: 'business' | 'agent_quality';
  /** One sentence, rendered in the tooltip. */
  definition: string;
  unit: string;
  /** Each side nullable: "≥90%" has no max, and "<20%" has no min. */
  healthy_range: { min: number | null; max: number | null };
  /** A-17's stated response. A metric with none is a dashboard, not steering. */
  action_when_outside: string;
  phase: MetricPhase;
  /** Which flavour of nothing this metric shows when its window is empty, plus the copy. Typed
   *  against the result union so a descriptor cannot name a status the functions never return. */
  empty_state: { status: MetricResultKind; copy: string };
  window_default: 'rolling_4w' | 'period';
  /**
   * Names the pure function that produces the value. This is what stops the descriptor file
   * becoming a stats fixture by the back door: the descriptor carries no numbers, only the name
   * of the function that computes them.
   *
   * Typed as a plain string *here* and narrowed at the fixture, deliberately. `lib/metrics.ts`
   * imports this file, so typing it against that module's registry would be a cycle. The
   * constraint lives where the descriptors are declared instead — `fixtures/metricDescriptors.ts`
   * annotates the array as carrying `ComputeKey`, so a descriptor naming a function that does not
   * exist is a compile error rather than a blank tile nobody notices.
   *
   * D-042 promised that check and the code did not keep it until now.
   */
  compute_key: string;
};

/* ============================================================================================
 * 21 · THE FIXTURE SET
 * ==========================================================================================*/

/**
 * The shape `agentClient.ts` loads. Not a spec record — an assembly type, so the schema version
 * is declared once for the whole set and a reducer can hold the world in session state.
 *
 * No aggregate collection appears here (R1). Every dashboard number is a pure function over these
 * arrays, which is the property that makes approving something in the demo visibly move a metric.
 */
export type FixtureSet = {
  schemaVersion: FixtureSchemaVersion;
  /** The build-fixed anchor every `MinutesFromAnchor` is relative to, as epoch ms. D-030:
   *  resolved at build time so prerender and hydration agree. Must be a Thursday mid-morning in
   *  the client's timezone — see `MinutesFromAnchor`. */
  anchor_epoch_ms: number;
  client: Client;
  pillars: Pillar[];
  calendarSlots: CalendarSlot[];
  drafts: Draft[];
  approvals: Approval[];
  posts: Post[];
  metricSnapshots: MetricSnapshot[];
  guardrailRules: GuardrailRule[];
  guardrailEvents: GuardrailEvent[];
  runs: Run[];
  runSteps: RunStep[];
  reflectionRules: ReflectionRule[];
  settings: Settings;
  metricDescriptors: MetricDescriptor[];
};

/* ============================================================================================
 * 22 · DERIVED, NEVER STORED  (§4.7 · R1)
 *
 * The register, in one place, because it is the R1 defence and it is easier to audit as a list
 * than scattered through eighteen record types. Nothing below appears as a field anywhere above.
 *
 *   Draft.is_at_risk        deadline minus now against redraft runway. Computing it keeps it
 *                           true; storing it makes it wrong the moment the clock moves.
 *   Draft.rewrite_count     count over `versions[]` where `author === 'agent'`.
 *   Draft edit distance     computed in the browser beside a documented tokeniser constant. A
 *                           stored value drifts when a fixture is hand-edited and freezes when
 *                           the reviewer edits a draft live — the exact demo moment it serves.
 *   Run.step_count          count over the run's RunSteps.
 *   Run.tokens_total        sums over RunStep. A run header disagreeing with the steps rendered
 *   Run.cost_total          beneath it is the most visible possible form of this bug.
 *   Client.budget_spent     `opening_spend_usd` + Σ step costs since `budget_period_start`.
 *   CalendarSlot.state      partially. `planned`, `slipped` and `dropped` are stored because no
 *                           other record can express them; `awaiting_approval`, `published` and
 *                           `quarantined` resolve through the slot's draft and post.
 *   Auto-approve, per-draft the four `AutoApproveDraftPrereq` checks, all computable from
 *                           existing fields.
 *   Every dashboard number  R1. No `weeklyMetrics`, no `dashboardStats.ts`.
 *
 * The four stored exceptions, each named at its field: `Client.manual_baseline_minutes_per_post`,
 * `Client.opening_spend_usd`, `MetricSnapshot.percentile`, `Draft.composite_score`. Nothing else.
 * ==========================================================================================*/
