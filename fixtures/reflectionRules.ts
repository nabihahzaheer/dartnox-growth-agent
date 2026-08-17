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

export const reflectionRules: ReflectionRule[] = [
  /* --- active (3) ------------------------------------------------------------------------- */
  {
    id: rid('REF-001'),
    client_id: CLIENT_ID,
    text: 'Give the figure a source in the same sentence, or cut the figure.',
    status: 'active',
    evidence_ids: [vid('DV-0031-2'), vid('DV-0038-2'), vid('DV-0044-2')],
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
    evidence_ids: [vid('DV-0029-2'), vid('DV-0036-2'), vid('DV-0041-2')],
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
    evidence_ids: [vid('DV-0047-2'), vid('DV-0051-2'), vid('DV-0055-2')],
    evidence_tag: 'hook_rewritten',
    activated_at: minutes(-11 * DAY),
    retired_at: null,
    review_due: minutes(79 * DAY),
    version: 1,
  },

  /* --- suggested (2), awaiting the operator ------------------------------------------------ */
  {
    id: rid('REF-004'),
    client_id: CLIENT_ID,
    /** Carries its three backing edits, per the header note. This is the one the settings screen
     *  expands to show the evidence chain. */
    text: 'Cut the closing question. Three of the last twenty edits deleted one.',
    status: 'suggested',
    evidence_ids: [vid('DV-0058-2'), vid('DV-0061-2'), vid('DV-0064-2')],
    evidence_tag: 'cta_changed',
    activated_at: null,
    retired_at: null,
    review_due: minutes(7 * DAY),
    version: 1,
  },
  {
    id: rid('REF-005'),
    client_id: CLIENT_ID,
    text: 'Name the neighbourhood, not the address.',
    status: 'suggested',
    evidence_ids: [vid('DV-0059-2'), vid('DV-0062-2'), vid('DV-0066-2')],
    evidence_tag: 'specific_detail_added',
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
    evidence_ids: [vid('DV-0022-2'), vid('DV-0026-2'), vid('DV-0030-2')],
    evidence_tag: 'length_cut',
    activated_at: minutes(-45 * DAY),
    retired_at: minutes(-19 * DAY),
    review_due: minutes(-19 * DAY),
    version: 2,
  },
];
