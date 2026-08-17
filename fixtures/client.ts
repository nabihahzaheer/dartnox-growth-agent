/**
 * THE CLIENT AND ITS BRAND PILLARS.
 *
 * ---------------------------------------------------------------------------------------------
 * WHO BRIGHTSILL IS, AND WHY THIS CLIENT RATHER THAN ANOTHER
 *
 * A fictional Brooklyn building-energy retrofit contractor. 34 people. They work on small
 * multifamily buildings — five to fifty units — for landlords, co-op boards and property managers
 * facing New York City's Local Law 97 carbon caps.
 *
 * THE CLIENT IS FICTIONAL AND MUST READ AS FICTIONAL. This repository is public and has "Dartnox"
 * in its name. `DARTNOX-CONTEXT.md` records the one hard rule from reading dartnox.com: the real
 * client names on that site are off-limits, because inventing content and performance numbers for
 * a real client relationship is fabricating facts about someone's business. Brightsill resembles
 * none of them, and the blurb says outright that it does not exist.
 *
 * WHY NOT A SOFTWARE COMPANY. `DARTNOX-CONTEXT.md` is explicit that the voice that matters here is
 * the fictional client's, not Dartnox's, and that "every post sounding like a software agency is
 * the fastest route to fixtures that read as generated." A contractor who installs heat pumps in
 * hundred-year-old buildings has a vocabulary nothing else in this repository shares.
 *
 * WHY THIS INDUSTRY SPECIFICALLY. Every guardrail in the architecture has to fire on something
 * real, or the guardrail layer is decoration. This business supplies all six naturally:
 *
 *   regulated_claim    — compliance deadlines and penalty exposure are legally consequential
 *   claim_entailment   — "payback in four years" is a quantitative claim that needs a source
 *   pii                — a case study naming a building or an owner is the obvious slip
 *   banned_claim       — the client itself forbids "guaranteed savings" (see settings)
 *   competitor_mention — a named local rival
 *   prompt_injection   — they read trade press, which is scraped, which is untrusted
 *
 * A software client would have made three of those six hypothetical.
 *
 * ON THE REAL PROGRAMMES NAMED IN THE PILLARS. Local Law 97, NYSERDA and NYC Accelerator are
 * public law and public programmes, not private companies, so naming them invents nothing about
 * anyone. Specific *numbers* attached to them are deliberately left to draft text where the
 * claim-entailment guardrail can be seen catching them — which is the honest arrangement, since
 * the product then never asserts a figure it has not sourced.
 */

import { CLIENT_TIMEZONE } from '../lib/anchor.ts';
import { minutes } from '../lib/types.ts';
import type { Client, ClientId, GuardrailEventId, Pillar, PillarId } from '../lib/types.ts';
import { FIXTURE_SCHEMA_VERSION, type FixtureSchemaVersion } from './schema.ts';

export const schemaVersion: FixtureSchemaVersion = FIXTURE_SCHEMA_VERSION;

export const CLIENT_ID = 'CLI-001' as ClientId;

/**
 * Pillar ids are exported because slots, drafts and approvals all denormalise them, and a typo in
 * a string literal repeated forty times is a dangling reference the compiler cannot see. Branded
 * ids stop a PillarId being passed where a DraftId belongs; they do not stop `'PIL-002'` being
 * mistyped as `'PIL-02'`. Referencing the constant does.
 */
export const PILLAR_COMPLIANCE = 'PIL-001' as PillarId;
export const PILLAR_COST = 'PIL-002' as PillarId;
export const PILLAR_FIELD_NOTES = 'PIL-003' as PillarId;
export const PILLAR_OLD_BUILDINGS = 'PIL-004' as PillarId;

/**
 * Nine weeks in (spec §7). Six weeks of settled history plus the three-week forward pipeline.
 *
 * This is a deliberate scope statement, not an arbitrary date. The same client cannot be in cold
 * start *and* have the published history four screens need, so the cold-start path — which A-05
 * calls the *modal* case for a real client — is invisible in the running product and lives only
 * in the PRD and on the board. That goes in the README rather than being hoped past.
 */
const ONBOARDED_AT = minutes(-9 * 7 * 24 * 60);

export const client: Client = {
  id: CLIENT_ID,
  name: 'Brightsill',
  industry: 'Building energy retrofit · small multifamily',
  blurb:
    'Fictional client, invented for this assessment. Brooklyn retrofit contractor, 34 people, ' +
    'working on 5–50 unit buildings for landlords and co-op boards under Local Law 97. ' +
    'Brightsill is not a real company and is not affiliated with Dartnox or any Dartnox client.',

  /** Imported, not repeated. The anchor is "Thursday 10:00" in this zone, so a second copy of the
   *  string that drifted would move the whole dataset off its weekday. */
  timezone: CLIENT_TIMEZONE,
  onboarded_at: ONBOARDED_AT,

  channels: [
    {
      channel: 'linkedin',
      enabled: true,
      connected: true,
      handle: 'brightsill',
      /**
       * A-07: token expiry is the *planned* case, tracked as data and pre-notified, not an
       * incident. Sixty-day LinkedIn tokens, so this one is 11 days out — close enough that the
       * settings screen has something real to warn about, far enough that it is not the demo's
       * subject. The revocation narrative is a separate, deliberate failure (D-041).
       */
      token_expires_at: minutes(11 * 24 * 60),
    },
    {
      channel: 'x',
      enabled: true,
      connected: true,
      handle: 'brightsill_nyc',
      token_expires_at: minutes(46 * 24 * 60),
    },
  ],

  /**
   * R1 exception 1 of 4. A captured input, measured during onboarding — not arithmetic over
   * anything in this fixture set.
   *
   * Hours saved is (posts × this) − logged queue minutes. Without it the metric is invented, which
   * is why A-17 defines the baseline as the operator's median time to produce one post by hand,
   * timed during onboarding. The provenance fields below exist so the dashboard tooltip can answer
   * "where does 52 minutes come from" with "median of 3 timed pieces, captured during onboarding"
   * rather than leaving the number to be taken on trust.
   */
  manual_baseline_minutes_per_post: 52,
  baseline_captured_at: minutes(-9 * 7 * 24 * 60 + 2 * 24 * 60),
  baseline_sample_n: 3,
  baseline_method: 'timed_median',

  /**
   * R1 exception 2 of 4. A carried-forward opening balance, not a sum.
   *
   * The budget period is monthly and this dataset spans nine weeks, so it crosses a period
   * boundary. Live spend is this figure plus the step costs since `budget_period_start` — summed
   * from `RunStep`, since `Run.cost_total` was deleted as an R1 violation. The opening figure
   * exists so the 80% alert band is reachable in a demo without burning most of a month's budget
   * inside the fixture.
   */
  opening_spend_usd: 118.4,
  budget_period_start: minutes(-17 * 24 * 60),

  /** First gate on A-09's auto-approve prerequisite list. Thirty days after onboarding, so it has
   *  passed — which is what lets the locked toggle show one prerequisite met and the rest not. */
  trust_period_end: minutes(-9 * 7 * 24 * 60 + 30 * 24 * 60),

  /**
   * A-17: engagement is measured against the client's own baseline, and a client with no history
   * establishes it over the first four weeks. Brightsill had a LinkedIn page and no X presence, so
   * the two channels are legitimately in different states — LinkedIn has a rate, X does not.
   *
   * That asymmetry is the point. It gives the dashboard a metric that must render
   * `establishing_baseline` rather than a zero, which is the distinction D-035 insists on.
   */
  engagement_baseline: [
    { channel: 'linkedin', median_rate: 0.021 },
    { channel: 'x', median_rate: null },
  ],
  engagement_baseline_source: 'history',

  /** Calendar timeout drafts against the *last approved* pillar set (A-08, trace T2), so "last
   *  approved" has to be a value rather than an assumption. */
  pillar_set_version: 2,
};

/**
 * FOUR PILLARS (S4, convention 3–5).
 *
 * The set is built so the four are not interchangeable, because interchangeable pillars make
 * `pillar_fit` scoring meaningless and make the per-pillar drill-down a list of near-identical
 * bars. Each one has a different relationship to risk and to evidence:
 *
 *   Compliance clock  — highest regulatory exposure. `always_review` is on.
 *   What it costs     — where unsupported quantitative claims live.
 *   Field notes       — the differentiation engine. Fed by operator briefs, so its substance
 *                       exists nowhere else and cannot be generic.
 *   Old buildings     — craft and explanation. Lowest risk, highest voice.
 */
export const pillars: Pillar[] = [
  {
    id: PILLAR_COMPLIANCE,
    client_id: CLIENT_ID,
    name: 'The compliance clock',
    description:
      'Local Law 97 deadlines, what the caps actually require, and what an owner has to decide ' +
      'and by when. Never states a penalty figure without a citation.',
    /**
     * A-09 auto-approve prerequisite, per-draft tier, and the cheapest possible demonstration of a
     * setting changing behaviour: toggling this flips the badge and the eligibility on every draft
     * in the pillar with no run required (§6b).
     *
     * On, because a wrong compliance claim is the one mistake here with a legal consequence for
     * the client rather than an embarrassment.
     */
    always_review: true,
    state: 'active',
    hold_reason: null,
    held_at: null,
    hold_event_id: null as GuardrailEventId | null,
    colour_token: 'pillar-compliance',
  },
  {
    id: PILLAR_COST,
    client_id: CLIENT_ID,
    name: 'What it actually costs',
    description:
      'Pricing, payback, financing and incentive stacking, said plainly. Numbers carry sources ' +
      'or they do not go out.',
    always_review: false,
    state: 'active',
    hold_reason: null,
    held_at: null,
    hold_event_id: null,
    colour_token: 'pillar-cost',
  },
  {
    id: PILLAR_FIELD_NOTES,
    client_id: CLIENT_ID,
    name: 'Field notes',
    description:
      'Specific jobs: what we found behind the wall, what went wrong, what we would do ' +
      'differently. Sourced from crew briefs, never from news.',
    always_review: false,
    state: 'active',
    hold_reason: null,
    held_at: null,
    hold_event_id: null,
    colour_token: 'pillar-field',
  },
  {
    id: PILLAR_OLD_BUILDINGS,
    client_id: CLIENT_ID,
    name: 'Working with old buildings',
    description:
      'Steam risers, uninsulated masonry, knob-and-tube, and why the textbook retrofit does not ' +
      'survive contact with a 1926 walk-up.',
    always_review: false,
    state: 'active',
    hold_reason: null,
    held_at: null,
    hold_event_id: null,
    colour_token: 'pillar-old',
  },
];
