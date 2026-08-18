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

/**
 * REFLECTION RULES — the collection this section did not walk, and the one that had the defect.
 *
 * All eighteen `evidence_ids` pointed at draft versions that do not exist. They were written as
 * placeholders against the slice fixtures and never reconciled when `history.ts` arrived with its
 * own id scheme. Every other collection above was walked; this one was not; the dangling ids were
 * here. That is the shape of the failure worth recording — the bug was a symptom, the blind spot
 * was the defect, and a checker with a gap in it is more dangerous than no checker because it
 * reads as coverage.
 *
 * The three checks below are deliberately not just "does the id resolve". An id that resolves to
 * the wrong *kind* of record is the same class of silent defect one level down:
 *
 *   · resolves at all — the original bug
 *   · resolves to a HUMAN-authored version — an agent version cannot be evidence of a human edit,
 *     and the reflection job diffs agent against human by definition
 *   · carries the rule's own `evidence_tag` — the tag *is* the pattern. A rule citing three edits
 *     that did something else is a rule suggested on evidence that does not support it, and it
 *     would render on screen looking exactly like a correct one
 */
const versionsById = new Map(
  fixtures.drafts.flatMap((d) => d.versions.map((v) => [v.id as string, v] as const)),
);

for (const rule of fixtures.reflectionRules) {
  for (const evidenceId of rule.evidence_ids) {
    const version = versionsById.get(evidenceId);
    check(`${rule.id} · evidence ${evidenceId} exists`, version !== undefined);
    if (!version) continue;
    check(`${rule.id} · evidence ${evidenceId} is human-authored`, version.author === 'human');
    check(
      `${rule.id} · evidence ${evidenceId} carries the rule's tag`,
      version.edit_tags.includes(rule.evidence_tag),
      `rule tags ${rule.evidence_tag}, version has [${version.edit_tags.join(', ')}]`,
    );
  }

  /**
   * The emission threshold, asserted rather than described. A-05 emits a rule when a tag recurs
   * three times, so a suggestion carrying fewer than three backing versions contradicts the
   * mechanism that produced it — and a suggestion is emitted from the last twenty decisions, all
   * of which are retained, so there is no honest reason for it to be short.
   *
   * Active and retired rules are exempt because they were activated 31 to 45 days ago, outside the
   * three weeks of history this set retains (D-034). Empty is the correct value there and is a
   * different statement from missing.
   */
  if (rule.status === 'suggested') {
    check(
      `${rule.id} · a suggested rule carries its three backing edits`,
      rule.evidence_ids.length >= 3,
      `has ${rule.evidence_ids.length}`,
    );
  }

  /** `activated_at` and status have to agree, or "when did this rule start affecting drafts" —
   *  which is what the metrics drill-down splits cohorts on — has no answer. */
  const shouldBeActivated = rule.status !== 'suggested';
  check(
    `${rule.id} · activation and status agree`,
    (rule.activated_at !== null) === shouldBeActivated,
  );
  check(`${rule.id} · only a retired rule has a retirement date`,
    (rule.retired_at !== null) === (rule.status === 'retired'));
}

/** At least one suggestion must exist and be expandable, because that pairing is the only visible
 *  proof in the product that the reflection loop runs. A set where every rule is already active
 *  would show the outputs of the loop and never the loop. */
check(
  'a suggested rule exists with real evidence behind it',
  fixtures.reflectionRules.some((r) => r.status === 'suggested' && r.evidence_ids.length >= 3),
);

/* ==============================================================================================
 * THE FIELDS NOTHING WAS WALKING
 *
 * Three dangling-reference bugs shipped in three different collections, and each was found by a
 * person clicking something rather than by this file: the reflection rules' `evidence_ids`, every
 * live slot's `calendar_run_id`, and a draft's `similarity.against_post_id`.
 *
 * The pattern is the point. Each was a field the checker did not know about, so "the checks pass"
 * meant "the checks pass on the fields I remembered". Below is every remaining id-bearing field in
 * the schema, walked exhaustively. If a record type grows a reference, it belongs here on the same
 * day.
 * ============================================================================================*/

section('Referential integrity · the long tail');

const postIds = new Set<string>(fixtures.posts.map((p) => p.id));
const reflectionRuleIds = new Set<string>(fixtures.reflectionRules.map((r) => r.id));

for (const slot of fixtures.calendarSlots) {
  /** Dangling for every live slot until 17 Aug: they all pointed at `RUN-0132`, a planning run that
   *  did not exist. Nothing rendered it, so nothing complained. */
  check(`${slot.id} · calendar run exists`, runIds.has(slot.calendar_run_id));
  check(`${slot.id} · pillar exists`, pillarIds.has(slot.pillar_id));
}

for (const draft of fixtures.drafts) {
  for (const postId of draft.example_refs) {
    check(`${draft.id} · example post exists`, postIds.has(postId));
  }
  for (const ruleId of draft.applied_reflection_rule_ids) {
    check(`${draft.id} · applied reflection rule exists`, reflectionRuleIds.has(ruleId));
  }
  /** The similarity arms are separately nullable and were separately unchecked. */
  if (draft.similarity?.published) {
    check(
      `${draft.id} · similarity compares against a real post`,
      postIds.has(draft.similarity.published.against_post_id),
    );
  }
  if (draft.similarity?.batch) {
    check(
      `${draft.id} · similarity compares against a real draft`,
      draftIds.has(draft.similarity.batch.against_draft_id),
    );
  }
}

for (const post of fixtures.posts) {
  check(`${post.id} · binds an existing draft version`, versionIds.has(post.draft_version_id));
}

for (const snapshot of fixtures.metricSnapshots) {
  check(`${snapshot.id} · post exists`, postIds.has(snapshot.post_id));
}

for (const run of fixtures.runs) {
  if (run.target_post_id) {
    check(`${run.id} · target post exists`, postIds.has(run.target_post_id));
  }
}

for (const approval of fixtures.approvals) {
  if (approval.superseded_by) {
    check(
      `${approval.id} · supersede points at a real approval`,
      fixtures.approvals.some((a) => a.id === approval.superseded_by),
    );
  }
}

/** Ids are quoted by operators when something goes wrong, so they have to read as one series. The
 *  `H` prefix meant "history" — a fixture-authoring label with no meaning in the product. */
for (const run of fixtures.runs) {
  check(`${run.id} · carries no internal id prefix`, !/-H\d/.test(run.id));
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

/**
 * `warn` is not a draft state (§4.7). A warned draft carries an ordinary state and renders its
 * warning from the event.
 *
 * The first version of this asserted that every warned draft is `awaiting_approval`, which failed
 * the moment history existed — a draft warned three weeks ago was subsequently approved, and that
 * is correct behaviour. The assertion had quietly encoded "warned" as though it were a state,
 * which is the exact thing the rule forbids. Narrowed to what the spec actually claims:
 *
 *   · no draft ever carries a state named after a guardrail result
 *   · a warned draft still awaiting a decision sits in `awaiting_approval` and nowhere else
 *   · two `awaiting_approval` drafts differ only by guardrail result, which is the only place in
 *     the product the three-state result becomes legible
 */
const warned = fixtures.guardrailEvents.filter((e) => e.result === 'warn');
check('at least one warn event exists', warned.length > 0);

for (const e of warned) {
  const d = fixtures.drafts.find((x) => x.id === e.draft_id);
  if (!d) continue;
  check(`${e.id} · its draft has no warn-shaped state`, !['warn', 'warned'].includes(d.state));

  const pending = fixtures.approvals.some(
    (a) => a.draft_version_id === d.current_version_id && a.decided_at === null,
  );
  if (pending) {
    check(`${e.id} · undecided warned draft is awaiting_approval`, d.state === 'awaiting_approval');
  }
}

/** The legibility claim itself, asserted rather than assumed: one warned and one clean draft, both
 *  waiting, so the difference is visible on screen rather than only in the data. */
const waiting = fixtures.drafts.filter((d) => d.state === 'awaiting_approval');
const waitingWarned = waiting.filter((d) =>
  fixtures.guardrailEvents.some((e) => e.draft_id === d.id && e.result === 'warn'),
);
check('a warned draft and a clean draft are both awaiting review',
  waitingWarned.length > 0 && waiting.length > waitingWarned.length);

/** `escalation_trigger` is non-null exactly when something was escalated. The two fields overlap
 *  deliberately and answer different questions; this keeps them consistent. */
for (const e of fixtures.guardrailEvents) {
  const consistent = (e.escalation_tier === 'none') === (e.escalation_trigger === null);
  check(`${e.id} · escalation tier and trigger agree`, consistent);
}

/**
 * A rationale is model-authored, so it may exist only where a model decided. `lookup` matched a
 * list and `embedding` measured a distance; neither has anything to explain, and prose attached to
 * one would imply reasoning that never happened. An event with no rule behind it — a tool failure,
 * a budget stop — has no mechanism at all and therefore no rationale.
 *
 * This is the assertion that turns the field's contract from a comment into a fact.
 */
const MODEL_MECHANISMS = new Set(['classifier', 'inference']);
for (const e of fixtures.guardrailEvents) {
  const rule = e.rule_id ? fixtures.guardrailRules.find((r) => r.id === e.rule_id) : undefined;
  const mayExplain = rule !== undefined && MODEL_MECHANISMS.has(rule.mechanism);
  check(
    `${e.id} · rationale present only where a model decided` +
      (rule ? ` (${rule.kind}/${rule.mechanism})` : ' (no rule)'),
    mayExplain || e.rationale === null,
  );
  if (mayExplain && e.result !== 'pass') {
    check(`${e.id} · a non-passing model verdict explains itself`, e.rationale !== null);
  }
}

/**
 * Withholding has to mean the text is absent, not merely unrendered. A withheld event carries no
 * span and says why, so there is nothing for an interface to leak by accident.
 *
 * The limit of this check, stated because it matters: it cannot prove a rationale does not
 * paraphrase the instruction it describes. Nothing in the fixture set stores the injected text —
 * deliberately — so there is nothing to compare against. That constraint lives in the prompt and in
 * the comment on the fixture, and this asserts only the part that is mechanically true.
 */
for (const e of fixtures.guardrailEvents) {
  if (e.span_withheld) {
    check(`${e.id} · a withheld span stores no text`, e.offending_span === null);
    check(`${e.id} · a withheld span says why`, (e.withheld_reason ?? '').length > 0);
  }
}

/**
 * THE HARD GATE, ASSERTED RATHER THAN TRUSTED.
 *
 * A draft blocked at a guardrail cannot be approved — the board removes the control from the item,
 * because L3 tests rules the client set at onboarding rather than a judgement about quality. That
 * lives in the interrupt's `options` so the interface renders what the gate offers instead of
 * deciding for itself which button to disable, and so two screens cannot disagree about it.
 *
 * `approve_with_edits` must survive, or a blocked draft would have no route forward at all.
 */
for (const d of fixtures.drafts.filter((x) => x.state === 'blocked_guardrail')) {
  const gate = fixtures.runSteps.find(
    (s) => s.run_id === d.run_id && s.interrupt !== null,
  )?.interrupt;
  check(`${d.id} · a blocked draft still stops at a human gate`, gate !== undefined);
  if (gate) {
    check(`${d.id} · a blocked draft's gate does not offer approve`, !gate.options.includes('approve'));
    check(
      `${d.id} · a blocked draft can still be edited forward`,
      gate.options.includes('approve_with_edits'),
    );
  }
  check(`${d.id} · a blocked draft says why`, d.blocked_reason !== null);
}

/** Conversely: an unblocked draft waiting on a person must offer the control, or the queue would
 *  show items nobody can clear. */
for (const d of fixtures.drafts.filter((x) => x.state === 'awaiting_approval')) {
  const gate = fixtures.runSteps.find(
    (s) => s.run_id === d.run_id && s.interrupt !== null,
  )?.interrupt;
  if (gate) {
    check(`${d.id} · an unblocked gate offers approve`, gate.options.includes('approve'));
  }
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

/**
 * A tunable setting has to sit inside its own declared range.
 *
 * Added after `score_threshold`'s range read 0.50–0.99 in `field_meta` while the PRD said
 * 0.60–0.95. That particular drift is a documentation mismatch a reviewer holding both would spot,
 * and no assertion can catch it — nothing here can read the PRD. What this does catch is the
 * consequence one step on: a range edited to exclude the value it governs, which renders a slider
 * whose handle starts outside its own track and cannot be returned to where it began.
 */
const settingValue: Record<string, number> = {
  score_threshold: fixtures.settings.score_threshold,
  negative_engagement_threshold: fixtures.settings.negative_engagement_threshold,
  'budget.cap': fixtures.settings.budget.cap,
};

for (const [key, meta] of Object.entries(fixtures.settings.field_meta)) {
  if (meta.range === null) continue;
  check(`${key} · declared range is not inverted`, meta.range.min < meta.range.max);

  const current = settingValue[key];
  if (current === undefined) continue;
  check(
    `${key} · current value sits inside its own range`,
    current >= meta.range.min && current <= meta.range.max,
    `value ${current}, range ${meta.range.min}–${meta.range.max}`,
  );
  /** The default has to be reachable too, or "reset to default" produces an invalid value. */
  if (typeof meta.default === 'number') {
    check(
      `${key} · default sits inside its own range`,
      meta.default >= meta.range.min && meta.default <= meta.range.max,
    );
  }
}

/* ==============================================================================================
 * SCHEDULED POSTS — what the settings screen's banned-claim sweep acts on
 *
 * The bonus the brief offers is that adding a banned claim re-validates scheduled posts and
 * returns a match to the queue. Three things have to be true of the fixture set or that feature
 * ships as a control that appears to do nothing, and none of them is visible from reading the code.
 * ============================================================================================*/

const { DEMO_BANNABLE_PHRASE } = await import('../fixtures/pipeline.ts');
/** The same digest the fixtures and `approve()` use. Imported here rather than reimplemented for
 *  the same reason the fixture imports it: two copies agree until one is edited. */
const { contentDigest } = await import('../lib/world.ts');

const scheduled = fixtures.posts.filter((p) => p.state === 'scheduled');

/** Without this the sweep runs over an empty set and reports nothing, and the reviewer cannot tell
 *  a working feature from a broken one. */
check('at least one post is scheduled for the sweep to act on', scheduled.length > 0);

/**
 * The text a Post carries is on its draft version, not on the Post — so the sweep has to resolve
 * `draft_version_id` to find anything to match against. A scheduled post whose version does not
 * resolve would make the sweep skip it silently rather than fail.
 */
const textOfPost = (versionId: string): string | null =>
  versionsById.get(versionId)?.text ?? null;

for (const post of scheduled) {
  const text = textOfPost(post.draft_version_id);
  check(`${post.id} · resolves to a draft version`, text !== null);
  if (text === null) continue;

  /**
   * L4's invariant, and nothing was asserting it.
   *
   * "Every published post is text a human approved" is checkable rather than asserted only because
   * publishing compares this hash against the approved version's. If a fixture wrote a hash that
   * does not digest its own text, both the publish check and the settings sweep would be comparing
   * two constants that happen to match, and the mechanism would look like it works.
   */
  check(
    `${post.id} · approved hash digests the version it binds`,
    post.approved_content_hash === contentDigest(text),
  );

  /** A scheduled post has not published, and conflating the two is what B1's missing
   *  `published_at` field did. */
  check(`${post.id} · scheduled means not yet published`, post.published_at === null);
}

/**
 * THE DISCRIMINATION CHECK, which is the one that earns its place.
 *
 * One scheduled post cannot demonstrate a sweep. If the only scheduled post comes back
 * invalidated, "matched the phrase" and "invalidates everything" render identically and the
 * reviewer cannot tell which they are looking at. The demo needs one that matches and one that
 * does not, and the sweep has to leave the second alone.
 */
const matching = scheduled.filter((p) =>
  (textOfPost(p.draft_version_id) ?? '').toLowerCase().includes(DEMO_BANNABLE_PHRASE),
);

check(
  `a scheduled post contains "${DEMO_BANNABLE_PHRASE}"`,
  matching.length > 0,
  'nothing for the sweep to match — the bonus would report zero invalidated',
);
check(
  `a scheduled post does NOT contain "${DEMO_BANNABLE_PHRASE}"`,
  scheduled.length > matching.length,
  'every scheduled post matches, so the sweep cannot be seen discriminating',
);

/** Banning a phrase that is already banned sweeps nothing, because no draft carrying it could have
 *  been approved in the first place. The demo phrase has to be one the operator can still add. */
check(
  `"${DEMO_BANNABLE_PHRASE}" is not already banned`,
  !fixtures.settings.tone.banned_phrases.some(
    (p) => p.toLowerCase() === DEMO_BANNABLE_PHRASE.toLowerCase(),
  ),
);

/** And the posts that already published must not carry it, or the sweep's own scope — scheduled
 *  only, because a published post is recalled rather than invalidated — would look arbitrary. */
for (const post of fixtures.posts.filter((p) => p.state === 'published')) {
  const text = textOfPost(post.draft_version_id) ?? '';
  check(
    `${post.id} · a published post does not carry the demo phrase`,
    !text.toLowerCase().includes(DEMO_BANNABLE_PHRASE),
  );
}

/* ==============================================================================================
 * THE DASHBOARD'S BANDS — which tiles the fixture set intends to render healthy
 *
 * Added after two scheduled posts and two decided approvals went in, because that change moved the
 * denominator of five metrics at once. Nothing about a fixture edit tells you it has reddened a
 * tile on another screen; you find out by opening the dashboard, and only if you happen to look.
 *
 * The interesting half is the exception. `published_vs_planned` sits at ~86% against a ≥90% band
 * ON PURPOSE — a slipped slot, a dropped topical slot and a quarantined source are all in the
 * history, and a dashboard where every tile is green demonstrates nothing about what the bands are
 * for. Listing it here as a deliberate breach is the only place that intent is written down in
 * code rather than inferred.
 * ============================================================================================*/

const metricsModule = await import('../lib/metrics.ts');

/** Deliberately outside its band. See above. */
const INTENTIONAL_BREACH = new Set(['published_vs_planned']);

for (const descriptor of fixtures.metricDescriptors) {
  const compute = metricsModule.METRICS[descriptor.compute_key as keyof typeof metricsModule.METRICS];
  if (!compute) continue;

  const window =
    descriptor.window_default === 'period' ? metricsModule.PERIOD : metricsModule.ROLLING_4W;
  const result = compute(fixtures, window);

  /** Only an `ok` value can be out of range — the point of the discriminated result. The other
   *  three kinds are legitimate states, not failures, and must never be treated as breaches. */
  if (result.kind !== 'ok') continue;

  const { min, max } = descriptor.healthy_range;
  const inBand = (min === null || result.value >= min) && (max === null || result.value <= max);

  check(
    `${descriptor.id} · renders ${INTENTIONAL_BREACH.has(descriptor.id) ? 'outside' : 'inside'} its healthy band`,
    INTENTIONAL_BREACH.has(descriptor.id) ? !inBand : inBand,
    `value ${result.value.toFixed(2)}, band ${min ?? '−∞'}–${max ?? '∞'}`,
  );
}

/* ==============================================================================================
 * THE FOUR FAILURE NARRATIVES (D-041)
 *
 * Each is a run the drawer plays. What matters is not that they exist but that each one *ends
 * badly in its own way* — the whole argument is that this system refuses differently depending on
 * what went wrong, and four runs that all parked would demonstrate nothing.
 * ============================================================================================*/

const narrative = (variant: string) => fixtures.runs.find((r) => r.variant === variant);

for (const variant of ['tool_failure', 'poisoned_source', 'hostile_reply', 'auth_revoked']) {
  const run = narrative(variant);
  check(`narrative · a ${variant} run exists for the drawer to play`, run !== undefined);
  if (!run) continue;
  const steps = fixtures.runSteps.filter((s) => s.run_id === run.id);
  check(`narrative · ${variant} has a trace`, steps.length >= 3);
}

/** Each ends in a different terminal state. If two collapsed onto the same one, one of the two
 *  switches would be showing the reviewer something they had already seen. */
const endings = new Set(
  ['tool_failure', 'poisoned_source', 'hostile_reply', 'auth_revoked']
    .map((v) => narrative(v)?.state)
    .filter(Boolean),
);
check('narrative · the four end in four distinct states', endings.size === 4, `got ${[...endings].join(', ')}`);

const poisoned = narrative('poisoned_source');
if (poisoned) {
  /** The shape D-033 exists for: a queue item with no draft behind it. */
  check('poisoned · produces no draft', poisoned.target_draft_id === null);
  check('poisoned · every step stops before drafting',
    fixtures.runSteps
      .filter((s) => s.run_id === poisoned.id)
      .every((s) => s.produced === null));
  const event = fixtures.guardrailEvents.find((e) => e.run_id === poisoned.id);
  /** The operator may be the injection's target, so the span is withheld by design — and a
   *  withheld span without a reason is indistinguishable from missing data. */
  check('poisoned · withholds the offending span', event?.span_withheld === true);
  check('poisoned · says why it was withheld', (event?.withheld_reason ?? '').length > 20);
  check('poisoned · flags the domain', event?.domain_flagged === true);
  /** An injection is not transient. If it were sweep-eligible the run would clear itself, which is
   *  the opposite of quarantine. */
  check('poisoned · does not retry on a clock', poisoned.next_sweep_at === null);
}

const hostile = narrative('hostile_reply');
if (hostile) {
  const event = fixtures.guardrailEvents.find((e) => e.run_id === hostile.id);
  check('hostile · carries the replies on the escalation', (event?.replies.length ?? 0) >= 3);
  check('hostile · crosses the configured threshold',
    (event?.replies.length ?? 0) >= fixtures.settings.negative_engagement_threshold);

  /**
   * R8, asserted rather than trusted. Reply text has exactly one permitted home; if it leaked into
   * a step payload it would be in retrieval range and on the console's highest-traffic surface.
   * This checks the actual strings, not the field names.
   */
  const replyText = (event?.replies ?? []).map((r) => r.text);
  for (const step of fixtures.runSteps.filter((s) => s.run_id === hostile.id)) {
    const payload = JSON.stringify(step.tool_input ?? {}) + JSON.stringify(step.tool_output ?? {});
    check(
      `hostile · ${step.id} carries no reply text`,
      replyText.every((text) => !payload.includes(text.slice(0, 30))),
    );
  }

  /** The agent must have no way to answer. Enforced structurally — there is no reply tool — so the
   *  assertion is that no step in this run calls one. */
  check('hostile · the run never calls a reply tool',
    fixtures.runSteps
      .filter((s) => s.run_id === hostile.id)
      .every((s) => s.tool_name !== 'publish_post'));
}

const reconcile = narrative('auth_revoked');
if (reconcile) {
  const steps = fixtures.runSteps.filter((s) => s.run_id === reconcile.id);
  const timedOut = steps.find((s) => s.error?.kind === 'timeout');
  const ambiguous = steps.find((s) => s.error?.kind === 'ambiguous_reconcile');

  check('reconcile · the publish call times out', timedOut !== undefined);
  check('reconcile · it reads the channel back before replaying', ambiguous !== undefined);
  /** The order is the argument. Reconciling *after* a retry would already have published twice. */
  check('reconcile · the read-back happens after the timeout, not before',
    (timedOut?.seq ?? 0) < (ambiguous?.seq ?? 0));
  check('reconcile · two candidates it cannot tell apart',
    ambiguous?.error?.kind === 'ambiguous_reconcile' && ambiguous.error.candidates.length === 2);
  /** The whole point: it does not retry. A `next_sweep_at` here would mean the clock eventually
   *  replays a publish that may already have landed. */
  check('reconcile · refuses to retry on a clock', reconcile.next_sweep_at === null);
  check('reconcile · parks for a human rather than the sweep',
    reconcile.state === 'parked_blocked' && reconcile.park_reason === 'awaiting_reconcile');
}

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

const { approve, reject, escalate, workingDaysUntil } = await import('../lib/world.ts');

/**
 * The runway arithmetic, checked directly.
 *
 * This decides whether a rejected slot slips or is dropped, so getting it wrong silently changes
 * a business outcome. The first implementation was right only because the epoch happens to fall on
 * the same weekday as the anchor, and ignored its own `now` argument entirely — the kind of defect
 * that passes every test you did not write.
 *
 * The anchor is a Thursday, so day 0 is Thursday, day 1 Friday, day 2 Saturday, day 3 Sunday.
 */
const DAY_MIN = 24 * 60;
const off = (d: number) => (d * DAY_MIN) as never;

check('runway · Thu -> Fri is 1 working day', workingDaysUntil(off(0), off(1)) === 1);
check('runway · Thu -> Sat is 1 (Saturday does not count)', workingDaysUntil(off(0), off(2)) === 1);
check('runway · Thu -> Sun is 1 (nor Sunday)', workingDaysUntil(off(0), off(3)) === 1);
check('runway · Thu -> Mon is 2', workingDaysUntil(off(0), off(4)) === 2);
check('runway · Thu -> next Thu is 5', workingDaysUntil(off(0), off(7)) === 5);
check('runway · a slot already past has no runway', workingDaysUntil(off(3), off(1)) === 0);

/**
 * The cases that actually separate the correct implementation from the broken one.
 *
 * The first version always walked the weekday sequence forward from the epoch — Friday, Saturday,
 * Sunday… — no matter what `now` was. So it only differs from the truth when the decision is taken
 * on a day that is not a multiple of seven from the anchor, and the first three cases below happen
 * to agree under both. These do not.
 *
 * Written after the earlier assertions passed against the broken version, which made them look
 * like a guard while guarding nothing.
 */
// Friday to Sunday: the only days in between are Saturday and Sunday, so zero working days.
// The broken version counted one, by starting its weekday walk at Friday regardless.
check('runway · Fri -> Sun is 0', workingDaysUntil(off(1), off(3)) === 0);
// Tuesday to the following Saturday spans Wed, Thu, Fri — three. The broken version said two.
check('runway · Tue -> Sat is 3', workingDaysUntil(off(5), off(9)) === 3);

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

/* ==============================================================================================
 * SETTINGS TRANSITIONS
 *
 * Three writes, and the reason they need assertions rather than a click-through is that two of
 * them are refusals. A control that silently succeeds when it should refuse looks identical on
 * screen to one that works.
 * ============================================================================================*/

const { updateSetting, settingRefusal, toggleGuardrailRule, addBannedClaim, countBannedClaimMatches } =
  await import('../lib/world.ts');

/* ---- the threshold: the one live control ---------------------------------------------------- */

const moved = updateSetting(fixtures, { kind: 'score_threshold', value: 0.72 }, ctx);
check('threshold · writes the new value', moved.settings?.score_threshold === 0.72);
/**
 * The version, not just the value. "Every change is a versioned event, and every draft records the
 * settings version it ran under" is what makes edit rate before and after a change comparable — so
 * a write that moved the number and left no version would silently break the dashboard's one
 * graded drill-down rather than anything visible here.
 */
check('threshold · appends a settings version',
  (moved.settings?.versions.length ?? 0) === fixtures.settings.versions.length + 1);
check('threshold · moves current_version_id to the new version',
  moved.settings?.current_version_id === moved.settings?.versions.at(-1)?.version_id);
check('threshold · records a per-key diff with both sides',
  moved.settings?.versions.at(-1)?.diff[0]?.key === 'score_threshold' &&
  moved.settings?.versions.at(-1)?.diff[0]?.from === fixtures.settings.score_threshold &&
  moved.settings?.versions.at(-1)?.diff[0]?.to === 0.72);

/** Clamped rather than trusted. A slider cannot produce this; a caller can, and the range is the
 *  operator-facing promise. */
const tooLow = updateSetting(fixtures, { kind: 'score_threshold', value: 0.1 }, ctx);
const tooHigh = updateSetting(fixtures, { kind: 'score_threshold', value: 4 }, ctx);
check('threshold · clamps below the declared minimum', tooLow.settings?.score_threshold === 0.6);
check('threshold · clamps above the declared maximum', tooHigh.settings?.score_threshold === 0.95);

/* ---- the refusals, which are the point ------------------------------------------------------ */

/**
 * `forbidden` existed in `ConsoleError` from D-031 and nothing threw it, so the claim that there
 * are seven kinds because the copy differs per kind was one the code did not keep. These are the
 * two sources of a refusal, and both are read from the data rather than from a list of key names.
 */
check('refusal · auto-approve is locked',
  settingRefusal(fixtures, { kind: 'auto_approve', value: true }) !== null);
check('refusal · the lock names its reason rather than being merely disabled',
  (settingRefusal(fixtures, { kind: 'auto_approve', value: true }) ?? '').length > 20);

const fixedTrigger = fixtures.settings.escalation_triggers.find((t) => t.is_fixed);
const tunableTrigger = fixtures.settings.escalation_triggers.find((t) => !t.is_fixed);
check('a fixed escalation trigger exists to test against', fixedTrigger !== undefined);
check('a tunable escalation trigger exists to test against', tunableTrigger !== undefined);

if (fixedTrigger && tunableTrigger) {
  check('refusal · a fixed escalation trigger cannot be disabled',
    settingRefusal(fixtures,
      { kind: 'escalation_trigger', trigger: fixedTrigger.trigger, enabled: false }) !== null);
  /** The other half, and the one that makes the first mean something: a checker that refused
   *  everything would pass the assertion above and the screen would be inert. */
  check('a tunable escalation trigger is NOT refused',
    settingRefusal(fixtures,
      { kind: 'escalation_trigger', trigger: tunableTrigger.trigger, enabled: false }) === null);

  const toggled = updateSetting(fixtures,
    { kind: 'escalation_trigger', trigger: tunableTrigger.trigger, enabled: false }, ctx);
  check('escalation trigger · writes the new enabled state',
    toggled.settings?.escalation_triggers.find((t) => t.trigger === tunableTrigger.trigger)
      ?.enabled === false);
  check('escalation trigger · leaves the other rows alone',
    toggled.settings?.escalation_triggers.filter((t) => t.enabled).length ===
      fixtures.settings.escalation_triggers.filter((t) => t.enabled).length - 1);
}

/* ---- guardrail rules ------------------------------------------------------------------------ */

const disabledRule = fixtures.guardrailRules.find((r) => !r.is_enabled);
const tunableRule = fixtures.guardrailRules.find((r) => r.is_enabled && !r.is_fixed);
check('a disabled guardrail rule exists', disabledRule !== undefined);
check('the disabled rule records when it was switched off', disabledRule?.disabled_at !== null);

if (tunableRule) {
  const off = toggleGuardrailRule(fixtures, tunableRule.id, false, ctx);
  check('guardrail · disabling sets is_enabled false',
    off.guardrailRules?.[0]?.is_enabled === false);
  /**
   * The pairing both fields exist for. A-17 alarms on a sudden drop in a rule's block rate, and the
   * commonest benign cause is somebody switching the rule off — without the date the dashboard
   * raises a false alarm instead of drawing a disabled-from marker.
   */
  check('guardrail · disabling stamps disabled_at', off.guardrailRules?.[0]?.disabled_at !== null);
  check('guardrail · a toggle is a versioned event too',
    (off.settings?.versions.length ?? 0) === fixtures.settings.versions.length + 1);

  const on = toggleGuardrailRule(fixtures, tunableRule.id, true, ctx);
  /** Cleared on re-enable, or a running rule would keep a permanent "switched off on the 6th"
   *  marker under its chart. */
  check('guardrail · re-enabling clears disabled_at', on.guardrailRules?.[0]?.disabled_at === null);
}

const fixedRule = fixtures.guardrailRules.find((r) => r.is_fixed);
check('a fixed guardrail rule exists', fixedRule !== undefined);
check('the fixed rule carries a reason a person can read',
  (fixedRule?.fixed_reason ?? '').length > 20);

/* ---- the banned-claim sweep ------------------------------------------------------------------ */

/**
 * The bonus, asserted on both outcomes.
 *
 * The half that is easy to get wrong is the negative one: a sweep that invalidated everything it
 * touched would pass a "something was invalidated" check and would be indistinguishable on screen
 * from one that matches.
 */
const before = countBannedClaimMatches(fixtures, DEMO_BANNABLE_PHRASE);
check(`preview · counts the posts "${DEMO_BANNABLE_PHRASE}" would catch`, before === 1);
check('preview · a phrase in nothing counts zero',
  countBannedClaimMatches(fixtures, 'a phrase that appears in no post anywhere') === 0);
check('preview · an empty phrase counts zero rather than matching everything',
  countBannedClaimMatches(fixtures, '   ') === 0);

const sweep = addBannedClaim(fixtures, DEMO_BANNABLE_PHRASE, ctx);
check('sweep · scans every scheduled post', sweep.scanned === scheduled.length);
check('sweep · invalidates the one that matches', sweep.invalidated.length === 1);
check('sweep · leaves the one that does not match alone',
  sweep.scanned - sweep.invalidated.length === 1);
check('sweep · the invalidated post carries the state',
  sweep.patch.posts?.[0]?.state === 'invalidated');
/** A post that reappears without naming the rule that sent it back is indistinguishable from a
 *  bug, which is what `invalidated_reason` is defined for and why it is defined for this case
 *  only. */
check('sweep · names the phrase in the reason the operator reads',
  (sweep.patch.posts?.[0]?.invalidated_reason ?? '').includes(DEMO_BANNABLE_PHRASE));
check('sweep · adds the phrase to the banned list',
  sweep.patch.settings?.tone.banned_phrases.includes(DEMO_BANNABLE_PHRASE) === true);
check('sweep · is a versioned event',
  (sweep.patch.settings?.versions.length ?? 0) === fixtures.settings.versions.length + 1);

/**
 * The re-decision, modelled rather than faked by clearing the old row.
 *
 * Two approvals come back: the prior one marked superseded, and a new pending one. Without the
 * pending row the post would sit in the queue with nothing to decide against and no way out of it;
 * without the supersede mark, edit rate would count one post twice.
 */
const newPending = sweep.patch.approvals?.filter((a) => a.decided_at === null) ?? [];
const superseded = sweep.patch.approvals?.filter((a) => a.superseded_by !== null) ?? [];
check('sweep · opens a pending approval so the post can leave the queue', newPending.length === 1);
check('sweep · marks the prior approval superseded', superseded.length === 1);
check('sweep · the supersede points at the new pending row',
  superseded[0]?.superseded_by === newPending[0]?.id);
check('sweep · the new approval starts its own queue clock', newPending[0]?.queued_at === 0);

/** Published posts are recalled, not invalidated — a different action with a different record and a
 *  human decision in front of it. A sweep that reached them would be claiming a post already out in
 *  the world can be un-published by editing a setting. */
check('sweep · touches no published post',
  (sweep.patch.posts ?? []).every((p) => p.state !== 'published'));

/** Same purity rule as the decision transitions above. */
check('settings transitions do not mutate the world they are given',
  fixtures.settings.score_threshold === 0.85 &&
  fixtures.settings.tone.banned_phrases.length === 4 &&
  fixtures.settings.versions.length === 3);

/* ==============================================================================================
 * THE WEEK
 *
 * The projection in `lib/week.ts` is what every screen frames itself with, and two of its failure
 * modes are silent by construction: a week that renders the wrong number of slots still renders,
 * and a slot on the wrong weekday still renders. Both were live defects — the fixtures published
 * six posts at the weekend, and the first version of the "about the week" group listed next week's
 * eight drafting runs under this week. Neither threw. Both are asserted here.
 * ============================================================================================*/

section('The week');

/** Dynamic, like the fixture import above: these modules read the build-time anchor, and importing
 *  them at the top would resolve it before the anchor section has confirmed it is a Thursday. */
const { buildWeek, defaultWeekIndex } = await import('../lib/week.ts');
const { at, weekIndexOf, wallClockIn, CLIENT_TIMEZONE } = await import('../lib/time.ts');
const initialWeek = defaultWeekIndex(fixtures);

/**
 * The contracted cadence is Monday to Friday and L4 checks a posting window before publishing, so
 * a weekend slot is a fixture contradicting the architecture it is meant to illustrate. Asserted
 * over the whole set rather than over history alone: the invariant is about the product, not about
 * one generator.
 */
for (const slot of fixtures.calendarSlots) {
  const day = wallClockIn(CLIENT_TIMEZONE, at(slot.publish_at)).weekday;
  check(
    `${slot.id} · publishes on a weekday`,
    day >= 1 && day <= 5,
    `lands on ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]}`,
  );
}

/**
 * A SLIP IS A MOVE.
 *
 * `original_publish_at` exists so the calendar shows the move rather than silently relocating a
 * slot. Both the fixture generator and the reject transition used to record the original time as
 * *equal to* the current one, which asserts a reschedule that never happened and renders as
 * `09:00 09:00` with one struck through. Neither threw; nothing read the field until the week view.
 */
for (const slot of fixtures.calendarSlots.filter((s) => s.original_publish_at !== null)) {
  check(`${slot.id} · a moved slot actually moved`, slot.original_publish_at !== slot.publish_at);
  check(`${slot.id} · it moved forwards`, (slot.original_publish_at as number) < slot.publish_at);
}

/** And the same for the transition, which is what a reviewer will actually trigger. */
/** A topical slot is dropped rather than slipped, so it would exercise the other branch. */
const slipping = fixtures.drafts.find((d) => {
  if (d.state !== 'awaiting_approval') return false;
  const slot = fixtures.calendarSlots.find((s) => s.id === d.slot_id);
  return slot !== undefined && !slot.is_topical;
});
if (slipping) {
  const slipped = reject(fixtures, slipping.id, 'tone_wrong', 'negative test', ctx)
    .calendarSlots?.[0];
  if (slipped?.state === 'slipped') {
    check('a rejected slot slips to a later time',
      (slipped.original_publish_at as number) < slipped.publish_at);
    const day = wallClockIn(CLIENT_TIMEZONE, at(slipped.publish_at)).weekday;
    check('a slipped slot lands on a weekday', day >= 1 && day <= 5);
  }
}

/**
 * The drafting week is the board's "Approved plan = 8 posts". Five are ratified `CalendarSlot`
 * records and three exist only as `proposed_calendar` entries, so this number is the join working.
 * If the match key ever drifts the week silently renders eleven — every proposed slot plus every
 * ratified one — which looks plausible and is wrong.
 */
const draftingWeek = buildWeek(fixtures, 1);
check('the drafting week holds eight slots', draftingWeek.entries.length === 8,
  `got ${draftingWeek.entries.length}`);
check('no slot is counted twice in a week',
  new Set(draftingWeek.entries.map((e) => e.key)).size === draftingWeek.entries.length);

/** A slot waiting on a person with no deadline cannot be chased, and the countdown renders nothing
 *  where the operator expects a clock. */
for (const entry of draftingWeek.entries.filter((e) => e.state === 'needs_you')) {
  check(`${entry.key} · a slot needing you carries a deadline`, entry.deadline !== null);
}

/** Every entry must fall inside the week that claims it — the `weekIndexOf`/`weekStart` pair is
 *  used in both directions and an off-by-one on a Monday boundary would be invisible. */
for (const index of [-3, -2, -1, 0, 1]) {
  const week = buildWeek(fixtures, index);
  check(
    `week ${index} · every entry falls inside it`,
    week.entries.every((e) => weekIndexOf(e.publish_at) === index),
  );
  /** A run that targets a draft or a post belongs to that record's slot. Listing it separately is
   *  how the rail got to thirty-eight rows, and how the first version of this group showed ten. */
  check(
    `week ${index} · about-the-week runs target no record`,
    week.otherRuns.every((r) => r.run.target_draft_id === null && r.run.target_post_id === null),
  );
}

/** The console and the rail open here. Opening on a week with nothing waiting would hide every
 *  pending decision behind a stepper the reviewer has no reason to press. */
check('the default week is the one with work in it', buildWeek(fixtures, initialWeek).waitingOnYou > 0);

/* ==============================================================================================
 * THE BUDGET GATE
 *
 * The cap is the one control whose effect is a system state rather than a record change, and the
 * demonstration depends on two facts that are easy to break by editing a fixture: that the shipped
 * dataset sits quietly under the cap, and that the cap can still be dragged below spend. Lose the
 * first and every screen carries a permanent budget warning; lose the second and the gate cannot be
 * shown working at all.
 * ============================================================================================*/

section('The budget gate');

const { budgetPosture } = await import('../lib/budget.ts');
const posture = budgetPosture(fixtures);

check('the shipped fixtures sit under the cap', posture.state === 'under',
  `state is ${posture.state} at ${posture.pct.toFixed(1)}%`);
check('spend is summed over real steps', posture.sample_n > 0);
check('spend exceeds the opening balance', posture.spent > fixtures.client.opening_spend_usd);

/**
 * Both cost addends contribute, asserted rather than assumed.
 *
 * A publish step incurs model *and* platform cost — X is pay-per-use, and a URL-bearing post costs
 * a multiple of a plain one. Dropping the platform term is a one-word edit that understates exactly
 * the runs the cap exists to govern, and it changes no state and throws nothing: spend simply reads
 * a little low forever. This is the only thing that would notice.
 */
const modelOnly =
  fixtures.client.opening_spend_usd +
  fixtures.runSteps
    .filter((s) => s.started_at >= fixtures.client.budget_period_start)
    .reduce((total, s) => total + s.cost_model_usd, 0);
check('platform cost is part of spend', posture.spent > modelOnly,
  `spend ${posture.spent.toFixed(4)} vs model-only ${modelOnly.toFixed(4)}`);

/** The cap's floor must be reachable from below current spend, or dragging it can never trip the
 *  gate and the control demonstrates nothing. */
const capRange = fixtures.settings.field_meta['budget.cap']?.range;
check('the cap range is declared', capRange !== undefined);
if (capRange) {
  check('the cap can be dragged below current spend', capRange.min < posture.spent,
    `min ${capRange.min} vs spend ${posture.spent.toFixed(2)}`);
}

/** Same purity rule as every other transition: the function is handed the world and must not
 *  write to it. `budget` is a nested object, so a naive field write would reach through the
 *  one-level spread in `withNewVersion` and mutate the caller's settings. */
const capBefore = fixtures.settings.budget.cap;
const capPatch = updateSetting(fixtures, { kind: 'budget_cap', value: 60 }, ctx);
check('budget_cap does not mutate the world it is given',
  fixtures.settings.budget.cap === capBefore, `world now reads ${fixtures.settings.budget.cap}`);
check('budget_cap returns the new value on the patch', capPatch.settings?.budget.cap === 60);
check('budget_cap records a diff row',
  capPatch.settings?.versions.at(-1)?.diff.some((d) => d.key === 'budget.cap') === true);

/** Clamped to the declared range rather than trusted — a caller is not a slider. */
if (capRange) {
  const tooLow = updateSetting(fixtures, { kind: 'budget_cap', value: -50 }, ctx);
  check('budget_cap clamps below its range', tooLow.settings?.budget.cap === capRange.min);
  const tooHigh = updateSetting(fixtures, { kind: 'budget_cap', value: 99_999 }, ctx);
  check('budget_cap clamps above its range', tooHigh.settings?.budget.cap === capRange.max);
}

/** And the gate actually trips when it should. Posture is read against the patched settings, which
 *  is what the screen does after a write. */
if (capPatch.settings) {
  const stopped = budgetPosture({ ...fixtures, settings: capPatch.settings });
  check('taking the cap below spend stops the gate', stopped.state === 'stopped',
    `state is ${stopped.state}`);
}

console.log(`\n${checks - failures}/${checks} checks passed.`);

if (failures > 0) {
  console.error(`${failures} FAILED\n`);
  process.exit(1);
}
