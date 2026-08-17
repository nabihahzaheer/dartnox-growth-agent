/**
 * SETTINGS — the operator's controls, and the audit trail behind them.
 *
 * Not a flat blob. A-16 requires every row to carry a type, a default and an effect timing, which
 * makes the settings screen a rendering of *field descriptors* rather than of raw values. That is
 * what `field_meta` at the bottom is for: without it the screen is a form that never explains when
 * a change takes effect, and "next guardrail run" versus "immediate" is exactly the thing an
 * operator needs to know before touching a control.
 *
 * ---------------------------------------------------------------------------------------------
 * THE THREE VERSIONS ARE LOAD-BEARING, NOT DECORATION
 *
 * `versions[]` is the x-axis of the one graded drill-down: edit rate split into cohorts either
 * side of each settings change (§6, D-042). Every draft version stamps the settings version it was
 * written under, so "did that rule make the output worse" is answerable rather than a matter of
 * opinion.
 *
 * That is why this is an inline history with per-key diffs rather than a version integer. A draft
 * stamped `version 3` cannot resolve what version 3 *said*, so the comparison it exists to serve
 * would be uncomputable — the reduction to a bare integer was made and then withdrawn for exactly
 * this reason (see "SettingsVersion, revised" in `ARCHITECTURE-DRAFT.md`).
 *
 * Three versions rather than seven: C9's argument holds at three, and diff arrays are among the
 * most expensive rows in the fixture set to author by hand.
 */

import { minutes } from '../lib/types.ts';
import type {
  ClientId,
  EscalationRuleEntry,
  FieldMeta,
  OperatorId,
  Settings,
  SettingsVersionId,
} from '../lib/types.ts';
import { CLIENT_ID } from './client.ts';
import { FIXTURE_SCHEMA_VERSION, type FixtureSchemaVersion } from './schema.ts';

export const schemaVersion: FixtureSchemaVersion = FIXTURE_SCHEMA_VERSION;

export const OPERATOR_ID = 'OP-001' as OperatorId;

/** Exported because every `DraftVersion` stamps one of these, and the drill-down groups on them. */
export const SETTINGS_V1 = 'SET-V1' as SettingsVersionId;
export const SETTINGS_V2 = 'SET-V2' as SettingsVersionId;
export const SETTINGS_V3 = 'SET-V3' as SettingsVersionId;

/**
 * A-09's escalation rules, as data.
 *
 * Eleven triggers across two tiers. `is_fixed` marks the three that A-09 makes non-tunable:
 * regulated-claim, prompt-injection, and the stakeholder tier as a whole. The reason those cannot
 * be loosened is worth having ready — precision-based loosening is only safe where a false
 * negative is recoverable, and a published regulated claim is not.
 *
 * Note what these do NOT do in v1, because it is the correction A-09 records against itself: since
 * every post already reaches the operator (S5), none of these changes *whether* a human sees an
 * item. They change how it arrives — flagged with the trigger named, sorted up the queue, the
 * offending span highlighted, and the approve affordance removed where the result is a fail. They
 * become gates in the ordinary sense only after auto-approve exists.
 */
const escalationTriggers: EscalationRuleEntry[] = [
  { trigger: 'low_score', tier: 'operator', enabled: true, is_fixed: false },
  { trigger: 'guardrail_warn', tier: 'operator', enabled: true, is_fixed: false },
  { trigger: 'guardrail_fail', tier: 'operator', enabled: true, is_fixed: false },
  { trigger: 'tool_failure', tier: 'operator', enabled: true, is_fixed: false },
  { trigger: 'unapproved_entity', tier: 'operator', enabled: true, is_fixed: false },
  { trigger: 'budget_threshold', tier: 'operator', enabled: true, is_fixed: false },
  { trigger: 'negative_engagement', tier: 'operator', enabled: true, is_fixed: false },
  { trigger: 'regulated_claim', tier: 'stakeholder', enabled: true, is_fixed: true },
  { trigger: 'reputational', tier: 'stakeholder', enabled: true, is_fixed: true },
  { trigger: 'repeat_rule_failure', tier: 'stakeholder', enabled: true, is_fixed: true },
  { trigger: 'operator_initiated', tier: 'operator', enabled: true, is_fixed: false },
];

/**
 * APPROVAL RULES — which conditions force an item in front of a person.
 *
 * The brief names these explicitly as an operator control ("approval rules, escalation triggers"),
 * so they are in scope rather than summarised away.
 *
 * AN HONEST LIMIT IN THE TYPE, WORTH NAMING RATHER THAN HIDING. `EscalationRuleEntry` keys on
 * `EscalationTrigger`, which is a vocabulary of *conditions*. The single most important approval
 * rule in v1 — every post is reviewed by a human, always, unconditionally — is not a condition and
 * has no member in that union to name it. It is carried by `phase: 'v1_all_human'` instead, and
 * the settings screen renders it as a locked row read from `phase` rather than from this array.
 *
 * Sharing one type between escalation and approval was the spec's call and it very nearly fits.
 * The place it does not is the standing rule, and the right answer is to say so on the screen
 * rather than to mint a fake trigger for it — which would have put a value in the union that the
 * precision metric would then have to special-case out.
 */
const approvalRules: EscalationRuleEntry[] = [
  { trigger: 'guardrail_fail', tier: 'operator', enabled: true, is_fixed: true },
  { trigger: 'guardrail_warn', tier: 'operator', enabled: true, is_fixed: false },
  { trigger: 'low_score', tier: 'operator', enabled: true, is_fixed: false },
  { trigger: 'unapproved_entity', tier: 'operator', enabled: true, is_fixed: false },
];

/**
 * A-16's per-row descriptors. Keyed by settings path.
 *
 * `effect_timing` is the column that earns this table's existence. Most of these do not take
 * effect until the next run, which is precisely why §6b needed `run_now` to exist before the
 * settings screen could demonstrate anything at all.
 */
const fieldMeta: Record<string, FieldMeta> = {
  score_threshold: {
    type: 'number',
    default: 0.85,
    /** No run needed: recompare against every draft's cached composite and the queue re-sorts. */
    effect_timing: 'immediate',
    is_fixed: false,
    unit: 'score',
    range: { min: 0.5, max: 0.99 },
  },
  'tone.register': {
    type: 'string',
    default: 'plain, technical, first person plural',
    effect_timing: 'next_draft',
    is_fixed: false,
    unit: null,
    range: null,
  },
  'tone.banned_phrases': {
    type: 'string_list',
    default: null,
    effect_timing: 'next_guardrail_run',
    is_fixed: false,
    unit: null,
    range: null,
  },
  cadence: {
    type: 'object',
    default: null,
    effect_timing: 'next_calendar',
    is_fixed: false,
    unit: 'posts/week',
    range: null,
  },
  domain_allowlist: {
    type: 'string_list',
    default: null,
    effect_timing: 'next_draft',
    is_fixed: false,
    unit: null,
    range: null,
  },
  outbound_link_allowlist: {
    type: 'string_list',
    default: null,
    effect_timing: 'next_guardrail_run',
    is_fixed: false,
    unit: null,
    range: null,
  },
  entities: {
    type: 'string_list',
    default: null,
    effect_timing: 'next_draft',
    is_fixed: false,
    unit: null,
    range: null,
  },
  negative_engagement_threshold: {
    type: 'number',
    default: 3,
    effect_timing: 'immediate',
    is_fixed: false,
    unit: 'negative replies',
    range: { min: 1, max: 20 },
  },
  'auto_pull.enabled': {
    type: 'boolean',
    /** Default off, and that is the client's decision to make rather than ours (A-16, trace T13).
     *  Pulling is reversible and is not replying — but it is still an autonomous action. */
    default: false,
    effect_timing: 'immediate',
    is_fixed: false,
    unit: null,
    range: null,
  },
  'budget.cap': {
    type: 'number',
    default: 400,
    effect_timing: 'immediate',
    is_fixed: false,
    unit: 'USD/month',
    range: { min: 50, max: 2000 },
  },
  'auto_approve.enabled': {
    type: 'boolean',
    default: false,
    effect_timing: 'immediate',
    /** A-09 and A-19. Off and locked for the whole of v1; the toggle's job is to show which
     *  prerequisites are unmet, not to be flipped. */
    is_fixed: true,
    unit: null,
    range: null,
  },
};

export const settings: Settings = {
  client_id: CLIENT_ID as ClientId,
  current_version_id: SETTINGS_V3,

  /**
   * Ordered oldest first. Each diff is per-key so a prior version can be reconstructed, which is
   * the whole reason this is a history and not an integer.
   */
  versions: [
    {
      version_id: SETTINGS_V1,
      changed_at: minutes(-9 * 7 * 24 * 60),
      changed_by: OPERATOR_ID,
      change_summary: 'Onboarding wizard: pillars, tone, banned claims, entities, cadence.',
      diff: [],
    },
    {
      version_id: SETTINGS_V2,
      changed_at: minutes(-24 * 24 * 60),
      changed_by: OPERATOR_ID,
      change_summary:
        'Raised the review threshold after two soft posts went out, and banned "guaranteed ' +
        'savings" outright.',
      diff: [
        { key: 'score_threshold', from: 0.8, to: 0.85 },
        {
          key: 'tone.banned_phrases',
          from: 'zero emissions',
          to: 'zero emissions, guaranteed savings',
        },
      ],
    },
    {
      version_id: SETTINGS_V3,
      changed_at: minutes(-11 * 24 * 60),
      changed_by: OPERATOR_ID,
      /**
       * This is the change the drill-down is *about*. A reflection rule was activated, and the
       * question the dashboard has to answer is whether edit rate moved after it. A-05 names this
       * comparison as the detection mechanism for a bad rule; without a settings change to split
       * on, the metric has no cohorts and the drill-down has no x-axis.
       */
      change_summary:
        'Activated the learned rule about leading with the building, not the technology. Added ' +
        'NYC Accelerator to approved entities.',
      diff: [
        { key: 'reflection_rules.active', from: 2, to: 3 },
        {
          key: 'entities',
          from: 'Local Law 97, NYSERDA, Con Edison',
          to: 'Local Law 97, NYSERDA, Con Edison, NYC Accelerator',
        },
      ],
    },
  ],

  /** Picks which of A-17's two threshold sets the dashboard colours against. */
  phase: 'v1_all_human',

  tone: {
    register: 'plain, technical, first person plural',
    person: 'we',
    /**
     * Client-set, not ours. "Guaranteed savings" is here because the client's own counsel struck
     * it — which is what makes the banned-claim guardrail a business rule rather than a style
     * preference, and what makes adding one in the demo a plausible thing for an operator to do.
     */
    banned_phrases: ['guaranteed savings', 'zero emissions', 'no upfront cost', 'risk-free'],
    sample:
      'We opened a wall on Sterling Place expecting brick and found a cavity nobody had ' +
      'recorded. Here is what that changes about the quote.',
  },

  /** A-10's defined scale. The highest-value live control (§6b): no run needed, the queue
   *  re-sorts and review flags appear and clear as it moves. */
  score_threshold: 0.85,

  auto_approve: {
    enabled: false,
    locked: true,
    lock_reason:
      'Off for v1 by design. Every post is read and approved by a person. Unlocking requires all ' +
      'six client-level prerequisites below, and each draft still qualifies individually.',
    /**
     * A-09 lists ten prerequisites. Only these six are client-level and static; the other four are
     * per-draft (score above threshold, all guardrails pass, not degraded, pillar not
     * always-review) and are computed on the draft itself.
     *
     * The split is not pedantry. Rendering all ten as a client-level checklist would show a green
     * tick beside a draft that would not itself have qualified, which is the misleading version of
     * this screen.
     */
    prereqs: [
      {
        key: 'trust_period_passed',
        met: true,
        detail: '30-day trust period ended in week 5.',
      },
      {
        key: 'decision_volume_met',
        met: false,
        detail: '41 of 60 decisions logged; 9 of 15 on the strongest pillar.',
      },
      {
        key: 'cross_vendor_judge',
        met: false,
        detail: 'Judge and drafter are the same vendor. A-03 makes a second vendor a prerequisite.',
      },
      {
        key: 'injection_interlock_clear',
        met: false,
        detail: 'One source domain flagged in the last 14 days; interlock holds until it clears.',
      },
      { key: 'channel_enabled', met: true, detail: 'LinkedIn and X both connected.' },
      {
        key: 'no_recent_pillar_rejection',
        met: false,
        detail: 'A draft on "What it actually costs" was rejected 3 days ago.',
      },
    ],
  },

  /** S3: 3 LinkedIn + 5 X = 8 a week. A contracted volume, set here rather than learned. */
  cadence: [
    {
      channel: 'linkedin',
      per_week: 3,
      posting_windows: [
        { day_of_week: 1, start_local_minute: 8 * 60, end_local_minute: 10 * 60 },
        { day_of_week: 3, start_local_minute: 8 * 60, end_local_minute: 10 * 60 },
        { day_of_week: 4, start_local_minute: 8 * 60, end_local_minute: 10 * 60 },
      ],
    },
    {
      channel: 'x',
      per_week: 5,
      posting_windows: [
        { day_of_week: 1, start_local_minute: 8 * 60, end_local_minute: 18 * 60 },
        { day_of_week: 2, start_local_minute: 8 * 60, end_local_minute: 18 * 60 },
        { day_of_week: 3, start_local_minute: 8 * 60, end_local_minute: 18 * 60 },
        { day_of_week: 4, start_local_minute: 8 * 60, end_local_minute: 18 * 60 },
        { day_of_week: 5, start_local_minute: 8 * 60, end_local_minute: 16 * 60 },
      ],
    },
  ],

  /**
   * Rendered in Settings *and* used as the reject dialog's options. One list, two surfaces.
   *
   * A-04 makes rejection reasons a structured prompt input, bounded to the last five or thirty
   * days, and visible in settings — because an invisible prompt input is one nobody can debug.
   * `active` selects which members of the fixed taxonomy the dialog offers.
   */
  rejection_reason_set: [
    { code: 'off_pillar', label: 'Off pillar', active: true },
    { code: 'claim_unsupported', label: 'Claim not supported by a source', active: true },
    { code: 'tone_wrong', label: 'Tone is off', active: true },
    { code: 'duplicate', label: 'Too close to something we already posted', active: true },
    { code: 'timing_wrong', label: 'Wrong moment', active: true },
    { code: 'legally_risky', label: 'Legally risky', active: true },
    { code: 'competitor_reference', label: 'References a competitor', active: true },
    { code: 'low_specificity', label: 'Too generic', active: true },
    { code: 'other', label: 'Other', active: true },
  ],

  escalation_triggers: escalationTriggers,
  approval_rules: approvalRules,

  /**
   * Two lists, deliberately. A-12 L2 records that conflating them once made posts unable to link
   * to the client's own site: the first is where the agent may *read* from, the second is where a
   * published post may *link* to. A domain can easily be one and not the other.
   */
  domain_allowlist: [
    'nyc.gov',
    'nyserda.ny.gov',
    'urbangreencouncil.org',
    'aceee.org',
    'buildingsnyenergy.example.com',
    'brightsill.example.com',
  ],
  outbound_link_allowlist: ['brightsill.example.com', 'nyc.gov', 'nyserda.ny.gov'],

  /** Named entities the agent may reference. All public programmes or the client's own; nothing
   *  here invents a fact about a private company. */
  entities: ['Local Law 97', 'NYSERDA', 'Con Edison', 'NYC Accelerator', 'Brightsill'],
  terminology: [
    'retrofit, not renovation',
    'building, not property',
    'heat pump, not HVAC',
    'crew, not team',
    'owner, not landlord (in posts)',
  ],

  /** A-14: the count of negative replies inside the poll window that holds the pillar. */
  negative_engagement_threshold: 3,

  /** Default off. Flipping it before throwing the hostile-reply switch changes the outcome, which
   *  is one of the nine controls with a demonstrable live effect (§6b). */
  auto_pull: { enabled: false, after_hours: 12 },

  /**
   * Trace T13's fix. The automatic half of hostile-reply handling works at the weekend; the human
   * half had nobody in it. Naming a contact and a response expectation at onboarding converts an
   * ambush into a decision the client made with their eyes open.
   */
  weekend_escalation_contact: {
    name: 'Dana Roque — owner',
    channel: 'SMS, then email',
    response_expectation: 'Best effort within 4 hours, Sat–Sun 09:00–18:00.',
  },

  /** N6. Alert at 80%, admission stop at 100%. Safety polls are exempt from the stop (trace T5) —
   *  switching off angry-reply detection to save metered calls while approved posts continue
   *  publishing is the worst available trade. */
  budget: { cap: 400, alert_pct: 80, stop_pct: 100 },

  field_meta: fieldMeta,
};
