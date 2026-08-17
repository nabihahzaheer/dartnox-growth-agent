/**
 * GUARDRAIL RULES — thirteen, across all four layers.
 *
 * Guardrails are not tools. They are orchestrator-owned nodes the model cannot decline to call
 * (A-06), which is why none of them appears in `ToolName` and why "the model decided to skip the
 * check" is not a state this system can be in.
 *
 * Three results, not two: `pass` · `warn` (routes to a human, blocks auto-approve) · `fail`
 * (blocks the action). The middle one is what lets a check be informative without being fatal.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY `is_enabled` AND `disabled_at` EXIST ON EVERY ROW
 *
 * A-17 asks for block rate per layer per rule, and for a sudden drop in it to raise an alarm. The
 * commonest real cause of a rule's block rate falling to zero is that somebody switched the rule
 * off. Without these two fields the dashboard raises a false alarm instead of saying why, and the
 * chart cannot draw a disabled-from marker rather than pretending history changed.
 *
 * ---------------------------------------------------------------------------------------------
 * WHICH RULES ARE FIXED — AND A DISCREPANCY IN THE SPEC, RESOLVED HERE
 *
 * `DUMMY-DATA-SPEC.md` §4.1 says three things are fixed: regulated-claim, prompt-injection, and
 * the stakeholder-tier escalation triggers. Only the first two of those are *rules*; the third
 * lives in Settings. But §6 says thirteen rules with "three of them fixed", counting a rule that
 * §4.1 does not name.
 *
 * Resolved by making `content_hash_match` the third, on its merits rather than to reach a number:
 * it is the check that publishes only text a human actually approved. A tunable version of that
 * check would make the entire v1 safety invariant — every published post was read and approved —
 * an operator preference. If any rule in this file should be impossible to switch off, it is that
 * one. Flagged so the spec's two sections can be reconciled rather than left disagreeing.
 */

import { minutes } from '../lib/types.ts';
import type { GuardrailRule, GuardrailRuleId } from '../lib/types.ts';
import { FIXTURE_SCHEMA_VERSION, type FixtureSchemaVersion } from '../lib/types.ts';

export const schemaVersion: FixtureSchemaVersion = FIXTURE_SCHEMA_VERSION;

const id = (n: string) => n as GuardrailRuleId;

export const RULE_INJECTION = id('GR-L1-INJECTION');
export const RULE_BANNED_CLAIM = id('GR-L3-BANNED');
export const RULE_REGULATED = id('GR-L3-REGULATED');
export const RULE_ENTAILMENT = id('GR-L3-ENTAILMENT');
export const RULE_SIMILARITY = id('GR-L3-SIMILARITY');
export const RULE_PII = id('GR-L3-PII');
export const RULE_COMPETITOR = id('GR-L3-COMPETITOR');

export const guardrailRules: GuardrailRule[] = [
  /* ---------------------------------------------------------------------------------------- *
   * L1 · INPUT — runs on fetched sources, before any model sees them
   * ---------------------------------------------------------------------------------------- */
  {
    id: RULE_INJECTION,
    layer: 'L1',
    kind: 'prompt_injection',
    config: { classifier: 'guard-class-sm', threshold: 0.6, action_on_hit: 'quarantine' },
    severity: 'block',
    /**
     * Fixed, and this is the one worth being able to argue. Precision-based loosening — relaxing a
     * rule because it produced false positives — is only safe where a false negative is
     * recoverable. A missed injection is not: the operator may be the injection's target, so the
     * person who would normally catch it is the person being attacked.
     *
     * A-12 is blunt that the real backstop against injection is human review, not L4, because L4
     * verifies approved text and a subtly poisoned approved draft matches by construction. That is
     * the same sentence read from the other end: widening autonomy narrows the injection defence.
     */
    is_fixed: true,
    display_name: 'Instructions hidden in a source',
    description:
      'Scores every fetched page for text aimed at the agent rather than at a reader. A hit ' +
      'quarantines the run before drafting and flags the domain. You see the verdict and the ' +
      'domain, never the text.',
    is_enabled: true,
    disabled_at: null,
    fixed_reason:
      'Cannot be tuned down. A missed injection is not recoverable, and you may be its target.',
    default_config: { classifier: 'guard-class-sm', threshold: 0.6, action_on_hit: 'quarantine' },
    effect_timing: 'next_draft',
  },
  {
    id: id('GR-L1-DOMAIN'),
    layer: 'L1',
    kind: 'domain_allowlist',
    config: { mode: 'strict' },
    severity: 'block',
    is_fixed: false,
    display_name: 'Source must be on the allowlist',
    description:
      'The agent only reads from domains on the source allowlist. The list is built with you ' +
      'during onboarding; it is not a blocklist, because a blocklist only forbids what someone ' +
      'already thought of.',
    is_enabled: true,
    disabled_at: null,
    fixed_reason: '',
    default_config: { mode: 'strict' },
    effect_timing: 'next_draft',
  },

  /* ---------------------------------------------------------------------------------------- *
   * L2 · GENERATION — shape of the output, checked without a model
   * ---------------------------------------------------------------------------------------- */
  {
    id: id('GR-L2-LENGTH'),
    layer: 'L2',
    kind: 'length_limit',
    config: { linkedin_max: 2800, x_max: 280 },
    severity: 'block',
    is_fixed: false,
    display_name: 'Channel length limit',
    description: 'Hard platform limits. No model needed — this is counting.',
    is_enabled: true,
    disabled_at: null,
    fixed_reason: '',
    default_config: { linkedin_max: 2800, x_max: 280 },
    effect_timing: 'next_draft',
  },
  {
    id: id('GR-L2-LINKS'),
    layer: 'L2',
    kind: 'outbound_link_allowlist',
    config: { mode: 'strict' },
    severity: 'block',
    is_fixed: false,
    display_name: 'Outbound links must be allowlisted',
    description:
      'Separate from the source allowlist. Where the agent may read and where a published post ' +
      'may link are different questions, and conflating them once made posts unable to link to ' +
      'your own site.',
    is_enabled: true,
    disabled_at: null,
    fixed_reason: '',
    default_config: { mode: 'strict' },
    effect_timing: 'next_guardrail_run',
  },

  /* ---------------------------------------------------------------------------------------- *
   * L3 · OUTPUT — is this safe to publish under the client's name
   * ---------------------------------------------------------------------------------------- */
  {
    id: RULE_BANNED_CLAIM,
    layer: 'L3',
    kind: 'banned_claim',
    /** Deterministic: an exact list, matched as strings. No model, because a model would be
     *  slower, dearer and less predictable than `includes`. */
    config: { match: 'exact_phrase', case_sensitive: false },
    severity: 'block',
    is_fixed: false,
    display_name: 'Banned phrases',
    description:
      'Exact phrases you have ruled out, matched literally against the draft. Editing the list ' +
      're-validates anything already scheduled.',
    is_enabled: true,
    disabled_at: null,
    fixed_reason: '',
    default_config: { match: 'exact_phrase', case_sensitive: false },
    /** The setting that produces the brief's bonus moment: add a phrase, and a scheduled post
     *  carrying it comes back to the queue with the rule attached. */
    effect_timing: 'next_guardrail_run',
  },
  {
    id: RULE_REGULATED,
    layer: 'L3',
    kind: 'regulated_claim',
    config: { classifier: 'claim-class', threshold: 0.5, tier: 'stakeholder' },
    severity: 'block',
    /** Fixed for the same reason as injection: a published regulated claim is not recoverable by
     *  noticing it afterwards. */
    is_fixed: true,
    display_name: 'Regulated or legal claims',
    description:
      'Statements about compliance obligations, penalties or eligibility. Wording varies too ' +
      'much for a phrase list, so this is a classifier. A hit goes to the owner, not to you.',
    is_enabled: true,
    disabled_at: null,
    fixed_reason: 'Cannot be tuned down. A published regulated claim cannot be un-published.',
    default_config: { classifier: 'claim-class', threshold: 0.5, tier: 'stakeholder' },
    effect_timing: 'next_guardrail_run',
  },
  {
    id: RULE_ENTAILMENT,
    layer: 'L3',
    kind: 'claim_entailment',
    config: { scope: 'quantitative_world_claims', model_tier: 'capable' },
    /** Warn, not block. An unsupported claim is a quality problem with a human answer; the human
     *  can add the source or cut the sentence. Blocking would route perfectly good posts into a
     *  dead end. */
    severity: 'warn',
    is_fixed: false,
    display_name: 'Numbers need a source',
    description:
      'Every quantitative claim about the world or about performance is checked against the ' +
      'sources the draft actually used. "Three tips" needs no source; "payback in four years" ' +
      'does.',
    is_enabled: true,
    disabled_at: null,
    fixed_reason: '',
    default_config: { scope: 'quantitative_world_claims', model_tier: 'capable' },
    effect_timing: 'next_guardrail_run',
  },
  {
    id: RULE_SIMILARITY,
    layer: 'L3',
    kind: 'similarity',
    /** N9, and it is conjunctive: against published posts in the last 30 days on the same channel
     *  AND against the rest of the current batch. The intra-batch half only became checkable when
     *  the check moved out of the score and into the guardrail layer (trace T11). */
    config: { threshold: 0.85, window_days: 30, same_channel: true, include_batch: true },
    severity: 'warn',
    is_fixed: false,
    display_name: 'Too close to something recent',
    description:
      'Compares each draft against what you published in the last 30 days on that channel, and ' +
      'against the other drafts in the same batch. A warning shows both side by side.',
    is_enabled: true,
    disabled_at: null,
    fixed_reason: '',
    default_config: { threshold: 0.85, window_days: 30, same_channel: true, include_batch: true },
    effect_timing: 'next_guardrail_run',
  },
  {
    id: RULE_PII,
    layer: 'L3',
    kind: 'pii',
    config: { detect: 'names,addresses,unit_numbers', action: 'block' },
    severity: 'block',
    is_fixed: false,
    display_name: 'Personal details',
    description:
      'Names, addresses and unit numbers. A field-notes post about a specific building is the ' +
      'obvious way this gets tripped, which is why it blocks rather than warns.',
    is_enabled: true,
    disabled_at: null,
    fixed_reason: '',
    default_config: { detect: 'names,addresses,unit_numbers', action: 'block' },
    effect_timing: 'next_guardrail_run',
  },
  {
    id: RULE_COMPETITOR,
    layer: 'L3',
    kind: 'competitor_mention',
    config: { classifier: 'competitor-class', threshold: 0.5 },
    severity: 'warn',
    is_fixed: false,
    /**
     * Switched off eleven days ago, deliberately, and this is not filler.
     *
     * A-17 wants a sudden drop in a rule's block rate to raise an alarm. A disabled rule is the
     * commonest benign cause of exactly that drop, so the dashboard needs one real instance to
     * prove it can tell the two apart — "fell to zero because this rule was switched off on the
     * 6th" rather than an alarm nobody can act on.
     */
    is_enabled: false,
    disabled_at: minutes(-11 * 24 * 60),
    display_name: 'Competitor mentions',
    description:
      'Flags drafts naming another contractor. Off since the 6th — it was firing on generic ' +
      'trade references.',
    fixed_reason: '',
    default_config: { classifier: 'competitor-class', threshold: 0.5 },
    effect_timing: 'next_guardrail_run',
  },

  /* ---------------------------------------------------------------------------------------- *
   * L4 · ACTION — the last checks before an irreversible step
   * ---------------------------------------------------------------------------------------- */
  {
    id: id('GR-L4-HASH'),
    layer: 'L4',
    kind: 'content_hash_match',
    config: { algorithm: 'sha256' },
    severity: 'block',
    /** See the header note: the third fixed rule, on its merits. */
    is_fixed: true,
    display_name: 'Publish only what was approved',
    description:
      'The text about to go out is hashed and compared against the version you approved. A ' +
      'mismatch parks the post for investigation rather than publishing either version.',
    is_enabled: true,
    disabled_at: null,
    fixed_reason:
      'Cannot be switched off. This is the check that makes "a human approved every published ' +
      'post" a fact rather than an intention.',
    default_config: { algorithm: 'sha256' },
    effect_timing: 'next_publish',
  },
  {
    id: id('GR-L4-CHANNEL'),
    layer: 'L4',
    kind: 'channel_enabled',
    config: { require_connected: true },
    severity: 'block',
    is_fixed: false,
    display_name: 'Channel is connected',
    description: 'Nothing publishes to a channel whose login has expired or been revoked.',
    is_enabled: true,
    disabled_at: null,
    fixed_reason: '',
    default_config: { require_connected: true },
    effect_timing: 'next_publish',
  },
  {
    id: id('GR-L4-WINDOW'),
    layer: 'L4',
    kind: 'posting_window',
    /** The 2h grace is B3's: later than that escalates instead of publishing, because a nine
     *  o'clock post going out at nine in the evening is worse than none. */
    config: { grace_minutes: 120, on_late: 'escalate' },
    severity: 'block',
    is_fixed: false,
    display_name: 'Inside the posting window',
    description:
      'A post more than two hours past its slot escalates instead of publishing. Out-of-window ' +
      'is the one L4 failure that reschedules itself rather than needing you.',
    is_enabled: true,
    disabled_at: null,
    fixed_reason: '',
    default_config: { grace_minutes: 120, on_late: 'escalate' },
    effect_timing: 'next_publish',
  },
];
