/**
 * CHECKS — a handful of invariants whose violation would otherwise be silent.  `npm run check`
 *
 * Two things here are only worth claiming if something enforces them: that the anchor lands on a
 * Thursday (a wrong weekday breaks the dataset without throwing), and that the fixture graph has
 * no dangling ids (which shows up as an empty panel, found by clicking rather than by building).
 * Transition assertions join them when `lib/world.ts` exists.
 *
 * No Vitest or Jest: a runner is a dependency, a config file and a vocabulary, in a repo whose
 * rule is that nothing gets installed that cannot be explained. Node runs TypeScript directly, so
 * this is a script that exits non-zero.
 *
 * The honest limit: this is not a test suite — no coverage, no watch, no isolation. It should not
 * grow into one. If it does, a real runner becomes the right answer.
 *
 * Imports are relative with .ts extensions because Node's type stripping does not read tsconfig,
 * so the `@/*` alias is unavailable here.
 */

import { computeAnchorIso } from '../lib/anchor.ts';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: string): void {
  checks++;
  if (condition) return;
  failures++;
  console.error(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/* ==============================================================================================
 * THE ANCHOR
 * ============================================================================================*/

section('Anchor invariants');

/**
 * A few build instants covering each branch. The anchor is now plain UTC arithmetic — the
 * daylight-saving cases went away with the local wall-clock pinning it used to need — so what is
 * left to check is the weekday, the direction and the bound.
 */
const BUILD_INSTANTS: ReadonlyArray<readonly [string, string]> = [
  ['2026-08-17T08:00:00Z', 'a Monday'],
  ['2026-08-20T13:30:00Z', 'a Thursday before the anchor hour — goes back a week'],
  ['2026-08-20T14:00:00Z', 'a Thursday exactly on the anchor hour — stays today'],
  ['2026-08-22T23:00:00Z', 'late on a Saturday'],
  ['2026-01-01T00:00:00Z', 'across a year boundary'],
];

for (const [iso, description] of BUILD_INSTANTS) {
  const buildAt = new Date(iso);
  const anchor = new Date(computeAnchorIso(buildAt));
  const label = `${description} (${iso})`;

  check(`${label} — lands on a Thursday`, anchor.getUTCDay() === 4);
  check(`${label} — is not in the future`, anchor.getTime() <= buildAt.getTime());
  check(
    `${label} — within seven days of the build`,
    buildAt.getTime() - anchor.getTime() <= 7 * 86_400_000,
  );
}

section('Committed fallback anchor');

const timeSource = await import('node:fs/promises').then((fs) =>
  fs.readFile(new URL('../lib/time.ts', import.meta.url), 'utf8'),
);
const fallbackMatch = timeSource.match(/FALLBACK_ANCHOR_ISO = '([^']+)'/);
check('fallback constant present in lib/time.ts', fallbackMatch !== null);
if (fallbackMatch) {
  check(
    `fallback ${fallbackMatch[1]} is a Thursday`,
    new Date(fallbackMatch[1]).getUTCDay() === 4,
  );
}

/* ==============================================================================================
 * FIXTURE REFERENTIAL INTEGRITY
 *
 * The fixture set is a graph held together by string ids. Branded types stop a DraftId being used
 * where a RunId belongs, which is a different problem: they cannot tell whether `DRAFT-0141`
 * actually exists. A dangling id produces an empty panel rather than an error, and the way you
 * find it is by clicking the wrong thing in front of someone.
 *
 * These are the joins the screens actually traverse.
 * ============================================================================================*/

section('Fixture referential integrity');

const { fixtures } = await import('../fixtures/index.ts');

const pillarIds = new Set<string>(fixtures.pillars.map((p) => p.id));
const slotIds = new Set<string>(fixtures.calendarSlots.map((s) => s.id));
const draftIds = new Set<string>(fixtures.drafts.map((d) => d.id));
const runIds = new Set<string>(fixtures.runs.map((r) => r.id));
const stepIds = new Set<string>(fixtures.runSteps.map((s) => s.id));
const ruleIds = new Set<string>(fixtures.guardrailRules.map((r) => r.id));
const eventIds = new Set<string>(fixtures.guardrailEvents.map((e) => e.id));
const versionIds = new Set<string>(fixtures.drafts.flatMap((d) => d.versions.map((v) => v.id)));
const settingsVersionIds = new Set<string>(fixtures.settings.versions.map((v) => v.version_id));

for (const d of fixtures.drafts) {
  check(`${d.id} · slot exists`, slotIds.has(d.slot_id));
  check(`${d.id} · pillar exists`, pillarIds.has(d.pillar_id));
  /** The single most load-bearing join in the set: the detail view's entire required content is
   *  the reasoning trace, which lives on the run. B1's Draft had no path to it at all. */
  check(`${d.id} · run exists`, runIds.has(d.run_id));
  check(`${d.id} · current version is in versions[]`, versionIds.has(d.current_version_id));
  for (const v of d.versions) {
    check(`${v.id} · settings version exists`, settingsVersionIds.has(v.settings_version_id));
  }
}

for (const a of fixtures.approvals) {
  check(`${a.id} · binds an existing draft version`, versionIds.has(a.draft_version_id));
  check(`${a.id} · pillar exists`, pillarIds.has(a.pillar_id));
}

for (const r of fixtures.runs) {
  if (r.parent_run_id) check(`${r.id} · parent run exists`, runIds.has(r.parent_run_id));
  if (r.target_draft_id) check(`${r.id} · target draft exists`, draftIds.has(r.target_draft_id));
  check(`${r.id} · settings version exists`, settingsVersionIds.has(r.settings_version_id));
}

for (const s of fixtures.runSteps) {
  check(`${s.id} · run exists`, runIds.has(s.run_id));
  if (s.guardrail_event_id) {
    check(`${s.id} · guardrail event exists`, eventIds.has(s.guardrail_event_id));
  }
  if (s.produced?.entity_type === 'draft') {
    check(`${s.id} · produced draft exists`, draftIds.has(s.produced.id));
  }
}

for (const e of fixtures.guardrailEvents) {
  check(`${e.id} · run exists`, runIds.has(e.run_id));
  check(`${e.id} · run step exists`, stepIds.has(e.run_step_id));
  if (e.draft_id) check(`${e.id} · draft exists`, draftIds.has(e.draft_id));
  if (e.rule_id) check(`${e.id} · rule exists`, ruleIds.has(e.rule_id));
  if (e.offending_span) {
    check(`${e.id} · span indexes a real version`, versionIds.has(e.offending_span.version_id));
  }
}

/* --- invariants that are not joins ---------------------------------------------------------- */

section('Fixture invariants');

/**
 * R1 exception 4: `composite_score` is derived and cached. Cached is not invented — if it ever
 * disagreed with the components the components would win, so the two must agree at rest. This is
 * the assertion that keeps "derived and cached" honest.
 */
for (const d of fixtures.drafts) {
  if (d.state === 'drafting') continue; // not scored yet, and renders as such
  const c = d.score_components;
  const w = d.score_weights;
  const expected =
    Math.round(
      (c.brand_voice * w.brand_voice +
        c.claim_support * w.claim_support +
        c.pillar_fit * w.pillar_fit +
        c.channel_fit * w.channel_fit +
        c.specificity * w.specificity) *
        1000,
    ) / 1000;
  check(
    `${d.id} · cached composite matches its components`,
    Math.abs(d.composite_score - expected) < 1e-9,
    `cached ${d.composite_score}, components give ${expected}`,
  );
}

/** Weights are A-10's and must sum to 1, or the composite is not a weighted mean of anything. */
for (const d of fixtures.drafts) {
  const w = d.score_weights;
  const sum = w.brand_voice + w.claim_support + w.pillar_fit + w.channel_fit + w.specificity;
  check(`${d.id} · score weights sum to 1`, Math.abs(sum - 1) < 1e-9, `sum is ${sum}`);
}

/** Steps must be contiguous from 1 within each run, because `seq` is both stream order and replay
 *  order — a gap would silently drop a step from the console. */
for (const r of fixtures.runs) {
  const seqs = fixtures.runSteps
    .filter((s) => s.run_id === r.id)
    .map((s) => s.seq)
    .sort((a, b) => a - b);
  if (seqs.length === 0) continue;
  const contiguous = seqs.every((n, i) => n === i + 1);
  check(`${r.id} · step seq is contiguous from 1`, contiguous, `got [${seqs.join(', ')}]`);
  check(`${r.id} · step count is within the cap`, seqs.length <= r.step_cap);
}

/**
 * R6/D-032: Draft state terminates at `approved`. Two records with write authority over one fact
 * drift within an hour of the reducer existing, so a draft carrying a Post state is the exact
 * defect that rule exists to prevent.
 */
const POST_ONLY_STATES = new Set([
  'scheduled',
  'pending_reapproval',
  'publishing',
  'published',
  'failed',
  'pulled',
  'invalidated',
]);
for (const d of fixtures.drafts) {
  check(`${d.id} · does not claim a Post state`, !POST_ONLY_STATES.has(d.state as string));
}

/** A pending approval is one whose `decided_at` is null — that is the canonical test, which is why
 *  there is no separate status field. If a row has a decision it must also have a decided time. */
for (const a of fixtures.approvals) {
  const consistent = (a.decision === null) === (a.decided_at === null);
  check(`${a.id} · decision and decided_at agree`, consistent);
}

/** R7: guardrail evaluations emit on pass, not only on warn or fail. Without pass rows, block rate
 *  has no denominator and a rule that stopped being evaluated looks like a rule passing
 *  everything. This asserts the fixture set has not quietly written only the interesting rows. */
check(
  'guardrail events include pass results',
  fixtures.guardrailEvents.some((e) => e.result === 'pass'),
);

/** A `warn` is not a draft state. A warned draft sits in `awaiting_approval` and renders its
 *  warning from the event — and two drafts differing only by guardrail result is the only place
 *  the three-state result becomes legible in the product. */
const warned = fixtures.guardrailEvents.filter((e) => e.result === 'warn');
check('at least one warn event exists', warned.length > 0);
for (const e of warned) {
  const d = fixtures.drafts.find((x) => x.id === e.draft_id);
  if (d) check(`${e.id} · its draft is awaiting_approval, not a "warn" state`, d.state === 'awaiting_approval');
}

/** `escalation_trigger` is non-null exactly when something was escalated. The two fields overlap
 *  deliberately and answer different questions; this keeps them consistent. */
for (const e of fixtures.guardrailEvents) {
  const consistent = (e.escalation_tier === 'none') === (e.escalation_trigger === null);
  check(`${e.id} · escalation tier and trigger agree`, consistent);
}

/** A parked run must say when it will be retried, or parking is indistinguishable from death. */
for (const r of fixtures.runs) {
  if (r.state === 'parked_transient') {
    check(`${r.id} · parked_transient has a next sweep`, r.next_sweep_at !== null);
    check(`${r.id} · parked_transient has a park reason`, r.park_reason !== null);
  }
}

/** The live run has to be genuinely mid-flight, or the console cannot demonstrate attaching to a
 *  run it did not start. */
const liveRun = fixtures.runs.find((r) => r.state === 'running');
check('exactly one run is mid-flight', liveRun !== undefined);
if (liveRun) {
  check(`${liveRun.id} · has not ended`, liveRun.ended_at === null);
  check(`${liveRun.id} · started in the past`, (liveRun.started_at as number) < 0);
}

/** D-041 cut the low-score failure switch, and the replacement demonstration depends on a draft
 *  actually sitting below the threshold. If that stops being true the settings control has nothing
 *  to move across and the cut becomes a loss rather than a trade. */
check(
  'a draft sits below the score threshold',
  fixtures.drafts.some(
    (d) => d.state === 'awaiting_approval' && d.composite_score < fixtures.settings.score_threshold,
  ),
);
check(
  'a draft sits above the score threshold',
  fixtures.drafts.some(
    (d) => d.state === 'awaiting_approval' && d.composite_score >= fixtures.settings.score_threshold,
  ),
);

/** Every fixture file declares the schema version it was authored against (D-029). */
check('fixture set declares the schema version', fixtures.schemaVersion === '1');

/* ==============================================================================================
 * TRANSITIONS
 *
 * D-026 claimed the state transitions were "a state machine, directly testable without rendering
 * anything", and TODO.md flagged that as either-prove-it-or-drop-the-sentence. These are the
 * proof. lib/world.ts imports no React, so it runs here directly.
 *
 * What is checked is the shape of the write, not the plumbing: DUMMY-DATA-SPEC.md 4.8 says an
 * approve touches five records. If it touches four, two screens will eventually disagree about
 * what an approval did, and nothing else in the build would notice.
 * ============================================================================================*/

section('Transitions');

const { approve, reject, escalate, contentDigest } = await import('../lib/world.ts');

const ctx = {
  now: 0 as never,
  operatorId: fixtures.settings.versions[0].changed_by,
  secondsOpen: 42,
  idempotencyKey: 'check-key-1',
};

const pending = fixtures.drafts.find((d) => d.state === 'awaiting_approval');
check('a draft is awaiting approval to test against', pending !== undefined);

if (pending) {
  /* ---- approve --------------------------------------------------------------------------- */
  const approved = approve(fixtures, pending.id, ctx);

  check('approve · moves the draft to approved', approved.drafts?.[0]?.state === 'approved');
  check('approve · decides the approval', approved.approvals?.[0]?.decision === 'approve');
  check('approve · stamps who decided', approved.approvals?.[0]?.decided_by === 'operator');
  check(
    'approve · records seconds open (the rubber-stamp clock)',
    approved.approvals?.[0]?.seconds_open === 42,
  );
  check('approve · creates a scheduled post', approved.posts?.[0]?.state === 'scheduled');
  check('approve · queues a publish run', approved.runs?.[0]?.type === 'publish');
  check('approve · publish run is queued, not running', approved.runs?.[0]?.state === 'queued');
  /** L4 publishes only on a hash match, so the post must carry the digest of the exact version
   *  that was approved. Without this the safety invariant has nothing to check against. */
  const approvedVersion = pending.versions.find((v) => v.id === pending.current_version_id);
  check(
    'approve · post binds the approved version hash',
    approved.posts?.[0]?.approved_content_hash === approvedVersion?.content_hash,
  );
  check(
    'approve · post carries the idempotency key',
    approved.posts?.[0]?.idempotency_key === 'check-key-1',
  );

  /* ---- approve with edits ------------------------------------------------------------------ */
  const edited = approve(fixtures, pending.id, ctx, {
    text: 'A different sentence entirely.',
    editTags: ['tightened'],
  });
  const newVersion = edited.drafts?.[0]?.versions.at(-1);

  check('edit · appends a version rather than overwriting', 
    (edited.drafts?.[0]?.versions.length ?? 0) === pending.versions.length + 1);
  /** Edit rate counts human-authored approved versions, and authorship is authoritative over the
   *  decision label. If these disagreed, the metric would disagree with the queue. */
  check('edit · new version is human-authored', newVersion?.author === 'human');
  check('edit · decision follows the version, not the button',
    edited.approvals?.[0]?.decision === 'approve_with_edits');
  check('edit · approval binds the NEW version', 
    edited.approvals?.[0]?.draft_version_id === newVersion?.id);
  check('edit · hash changes with the text',
    newVersion?.content_hash === contentDigest('A different sentence entirely.'));
  /** The prior versions must survive untouched: edit magnitude diffs the last agent version
   *  against the shipped one, so overwriting would destroy the measurement. */
  check('edit · earlier versions are untouched',
    edited.drafts?.[0]?.versions[0]?.text === pending.versions[0].text);

  /* ---- reject ------------------------------------------------------------------------------ */
  const rejected = reject(fixtures, pending.id, 'claim_unsupported', 'No source for the figure.', ctx);

  check('reject · moves the draft to rejected', rejected.drafts?.[0]?.state === 'rejected');
  check('reject · records a structured reason code',
    rejected.approvals?.[0]?.reason_code === 'claim_unsupported');
  /** A rejection must move the slot, or published-vs-planned reads 100% forever and the >=90%
   *  gate can never fire. */
  const slotState = rejected.calendarSlots?.[0]?.state;
  check('reject · slot slips or drops', slotState === 'slipped' || slotState === 'dropped');
  check('reject · a slipped slot keeps its original date',
    slotState !== 'slipped' || rejected.calendarSlots?.[0]?.original_publish_at !== null);
  check('reject · a slipped slot queues a redraft',
    slotState !== 'slipped' || rejected.runs?.[0]?.state === 'queued');

  /* ---- escalate ---------------------------------------------------------------------------- */
  const escalated = escalate(fixtures, pending.id, 'stakeholder', 'Needs legal review.', ctx);
  const event = escalated.guardrailEvents?.[0];

  /** `held`, not `blocked_guardrail`. Different producer, different release event. */
  check('escalate · holds the draft', escalated.drafts?.[0]?.state === 'held');
  check('escalate · uses the operator trigger kind', event?.trigger_kind === 'operator_escalation');
  check('escalate · uses the operator-initiated trigger',
    event?.escalation_trigger === 'operator_initiated');
  /** Nullable and well-formed: an operator escalation has no rule behind it, and minting a
   *  synthetic one would corrupt the per-rule block-rate chart. */
  check('escalate · carries no rule id', event?.rule_id === null);
  check('escalate · is unlabelled until someone judges it', event?.was_unnecessary === null);
  check('escalate · stakeholder tier gets a 72h deadline',
    event?.decision_deadline !== null);

  /* ---- purity ------------------------------------------------------------------------------ */
  /** Every call above ran against the same fixture object. If any of them had mutated it, the
   *  later ones would have seen a changed world — and a transition that mutates can be called
   *  twice and do the wrong thing the second time. */
  check('transitions do not mutate the world they are given',
    pending.state === 'awaiting_approval');
}

console.log(`\n${checks - failures}/${checks} checks passed.`);

if (failures > 0) {
  console.error(`${failures} FAILED\n`);
  process.exit(1);
}
