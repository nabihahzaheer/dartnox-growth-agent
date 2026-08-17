/**
 * REFLECTION RULES — the one learning mechanism in this system with evidence behind it.
 *
 * A-05 ranks the two learning loops honestly, and this is the first: a weekly job diffs what the
 * agent wrote against what the human shipped, characterises each edit against a fixed tag
 * taxonomy, and when a tag recurs at least three times within the last twenty decisions it emits a
 * suggested rule to the settings screen. Visible, editable, versioned, capped at fifteen active.
 *
 * The other loop — retrieving high-performing past posts as few-shot examples — is mandated by the
 * brief and is unevidenced at this volume, and A-05 says so out loud. Four pillars times two
 * channels is eight cells; at twenty posts that is roughly two and a half per cell, which is noise
 * rather than signal. That sentence is the answer to "what has it learned by month three."
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE THRESHOLD IS THREE
 *
 * It is what stops one grumpy edit becoming permanent behaviour. An operator who rewrites a hook
 * once was having a bad morning; an operator who rewrites the hook three times in twenty decisions
 * is telling you something about the voice.
 *
 * WHY THE SUGGESTED RULE MUST CARRY ITS EVIDENCE. `evidence_ids` points at the specific draft
 * versions behind the suggestion. Showing three edits without naming the pattern makes the
 * operator re-derive the cause; naming the pattern without showing the edits asks them to take it
 * on trust. The settings screen renders both, and that pairing is the only visible proof in the
 * product that the reflection loop exists at all.
 *
 * ---------------------------------------------------------------------------------------------
 * THE EVIDENCE IDS WERE DANGLING, AND THE FIX IS NOT ONLY THE IDS — corrected 17 Aug
 *
 * Every one of the eighteen ids here pointed at a draft version that does not exist: they were
 * written as placeholders against the slice fixtures and never reconciled when `history.ts`
 * arrived with its own id scheme. `scripts/check.mts` walks drafts, approvals, runs, steps and
 * events for dangling ids and did not walk this collection, so the one place in the fixture set
 * with a referential defect was the one place nothing looked. The checker now walks it.
 *
 * Reconciling them surfaced the real constraint, which is worth stating because it decides the
 * shape below. **A rule is emitted when a tag recurs three times, and the retained history is
 * three weeks (D-034).** Five human-edited versions exist in that window. So:
 *
 *   · A *suggested* rule was emitted just now, from the last twenty decisions, all of which are
 *     retained. Its three backing versions must therefore be real, and they are.
 *
 *   · An *active* rule activated 31 to 45 days ago was emitted from decisions that reach back
 *     past the start of the retained window. Its evidence is not in this fixture set, and
 *     `evidence_ids: []` says exactly that. Pointing it at recent versions instead would have
 *     been worse than the dangling ids: those at least failed loudly once something looked. A
 *     rule citing evidence that postdates its own activation fails silently and reads as real.
 *
 * REF-003 is the one to check that reasoning against, since it activated only 11 days ago. Twenty
 * decisions at eight a week reaches back about seventeen days, to roughly day −28; the window
 * starts at −21. So its three hook rewrites straddle the boundary and are not retained either.
 *
 * The count moved from six rules to five. The second suggested rule claimed a `cta_changed`
 * pattern that occurs nowhere in the history, so it could not be evidenced at all — and one
 * suggestion a reviewer can expand and verify is worth more than two where one is decoration.
 */

import { minutes } from '../lib/types.ts';
import type { DraftVersionId, ReflectionRule, ReflectionRuleId } from '../lib/types.ts';
import { CLIENT_ID } from './client.ts';
import { FIXTURE_SCHEMA_VERSION, type FixtureSchemaVersion } from '../lib/types.ts';

export const schemaVersion: FixtureSchemaVersion = FIXTURE_SCHEMA_VERSION;

const rid = (n: string) => n as ReflectionRuleId;
const vid = (n: string) => n as DraftVersionId;

export const RULE_LEAD_WITH_BUILDING = rid('REF-003');

const DAY = 24 * 60;

/**
 * The three human-edited versions behind the one suggested rule.
 *
 * Named constants rather than inline strings for the same reason the pillar ids are: a branded id
 * stops a `DraftVersionId` being passed where a `RunId` belongs, and does nothing whatever about
 * `'DV-H004-2'` being mistyped as `'DV-H04-2'`. Referencing a constant does. These are exactly the
 * ids this file got wrong, so they are the last place to hand-write a string literal.
 *
 * All three are `history.ts` edit pairs tagged `tightened`, and each diff shows it: H004 cuts a
 * redundant noun, H009 drops an unsupported timeframe, H016 removes a lead-in clause.
 */
const EV_TIGHTENED_H004 = vid('DV-H004-2');
const EV_TIGHTENED_H009 = vid('DV-H009-2');
const EV_TIGHTENED_H016 = vid('DV-H016-2');

export const reflectionRules: ReflectionRule[] = [
  /* --- active (3) -------------------------------------------------------------------------
   *
   * All three activated before the retained window opens, so their backing edits are not in this
   * fixture set. See the header: an empty array is the honest statement of that, and the settings
   * screen says "evidence outside the retained history" rather than rendering a blank list.
   * ---------------------------------------------------------------------------------------- */
  {
    id: rid('REF-001'),
    client_id: CLIENT_ID,
    text: 'Give the figure a source in the same sentence, or cut the figure.',
    status: 'active',
    evidence_ids: [],
    evidence_tag: 'claim_softened',
    activated_at: minutes(-38 * DAY),
    retired_at: null,
    review_due: minutes(52 * DAY),
    version: 2,
  },
  {
    id: rid('REF-002'),
    client_id: CLIENT_ID,
    text: 'Say "owner", not "landlord", in anything public facing.',
    status: 'active',
    evidence_ids: [],
    evidence_tag: 'terminology_corrected',
    activated_at: minutes(-31 * DAY),
    retired_at: null,
    review_due: minutes(59 * DAY),
    version: 1,
  },
  {
    id: RULE_LEAD_WITH_BUILDING,
    client_id: CLIENT_ID,
    /**
     * The most recently activated rule, and the one the dashboard's drill-down is about. It was
     * activated in settings version 3 eleven days ago, which is what gives edit rate a before and
     * an after to compare — A-05 names exactly that comparison as the detection mechanism for a
     * rule that made the output worse.
     */
    text: 'Open on the building and what happened in it. The equipment comes second, if at all.',
    status: 'active',
    /**
     * Empty, and this is the rule to test the header's reasoning against, because it activated
     * only 11 days ago and the window opens at 21.
     *
     * Twenty decisions at eight a week reaches back about seventeen days, to roughly day −28. Its
     * three hook rewrites therefore straddle the start of the retained window, and none of the
     * three human edits inside it rewrote a hook. Citing one of them would have made the rule look
     * evidenced while pointing at edits that did something else.
     */
    evidence_ids: [],
    evidence_tag: 'hook_rewritten',
    activated_at: minutes(-11 * DAY),
    retired_at: null,
    review_due: minutes(79 * DAY),
    version: 1,
  },

  /* --- suggested (1), awaiting the operator ------------------------------------------------ */
  {
    id: rid('REF-004'),
    client_id: CLIENT_ID,
    /**
     * The one rule the settings screen expands to show a complete evidence chain, and the only
     * visible proof in the product that the reflection loop runs at all.
     *
     * It is a suggestion, so it was emitted from the last twenty decisions — all of which are
     * retained — which is exactly why this is the rule whose evidence can be real. The three
     * versions below are `history.ts` edit pairs, all human-authored, all tagged `tightened`, and
     * each diff visibly shows the pattern the text names.
     *
     * The rule this replaced claimed a `cta_changed` pattern that occurs nowhere in the history,
     * so it could never have been evidenced. The text now describes what the three edits actually
     * did rather than what would have been convenient.
     */
    text: 'Say it once. Three of the last twenty edits cut a lead-in or a hedge the sentence did not need.',
    status: 'suggested',
    evidence_ids: [EV_TIGHTENED_H004, EV_TIGHTENED_H009, EV_TIGHTENED_H016],
    evidence_tag: 'tightened',
    activated_at: null,
    retired_at: null,
    review_due: minutes(7 * DAY),
    version: 1,
  },

  /* --- retired (1) ------------------------------------------------------------------------- */
  {
    id: rid('REF-006'),
    client_id: CLIENT_ID,
    /**
     * Retired rather than deleted, and the distinction matters. A rule that was tried and
     * withdrawn is evidence the loop can be wrong and that somebody noticed — which is a stronger
     * claim about the mechanism than three rules that all worked.
     */
    text: 'Keep posts under 120 words.',
    status: 'retired',
    /** Activated 45 days ago, so its evidence is the furthest outside the retained window of any
     *  rule here. */
    evidence_ids: [],
    evidence_tag: 'length_cut',
    activated_at: minutes(-45 * DAY),
    retired_at: minutes(-19 * DAY),
    review_due: minutes(-19 * DAY),
    version: 2,
  },
];
