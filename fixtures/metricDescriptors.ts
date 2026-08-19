/**
 * METRIC DESCRIPTORS — the dashboard's content, and the PRD's metrics section, from one file.
 *
 * This is configuration, not a simulated record, so it is not one of the thirteen. It exists
 * because A-17 specifies per metric a definition, a healthy range, an action when the value leaves
 * that range, a phase and an empty state — and none of the thirteen records holds any of that.
 * Hardcoding it inside the dashboard component would make "defined before you build it" untrue for
 * the one screen the phrase most applies to.
 *
 * ---------------------------------------------------------------------------------------------
 * D-042 · THIS FILE IS ALSO THE PRD'S SOURCE
 *
 * The failure it prevents is cheap to make and bad to ship: the dashboard renders five metrics,
 * the PRD names six, and a reviewer holding both finds the mismatch. Two documents written days
 * apart by different halves of the same process will disagree unless something stops them.
 *
 * So the direction of authority is fixed. `ARCHITECTURE-DRAFT.md` A-17 is canonical; this file
 * transcribes A-17; the PRD's success-metrics section and the dashboard both transcribe this file.
 * A metric that belongs in the PRD and is not in A-17 is a signal to change A-17 first — not to
 * add a row here.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY `compute_key` IS A NAME AND NOT A NUMBER
 *
 * R1 forbids precomputed aggregates: every number on the dashboard is a pure function over the
 * record collections in session state, which is the property that makes approving something in the
 * demo visibly move a metric. A descriptor carrying values would be a stats fixture arriving by
 * the back door and would silently destroy the one thing that screen is graded on. So the
 * descriptor carries the *name* of the function, never its result.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY `empty_state.status` IS TYPED AGAINST THE RESULT UNION
 *
 * Metric functions return `ok | no_data | not_applicable | establishing_baseline`, not a number,
 * because A-17 insists those four flavours of nothing are not interchangeable. Auto-approve rate
 * must read "n/a by design" and never red; engagement against a baseline that does not exist yet
 * must read "establishing, 2 of 4 weeks". Typing the descriptor's status against that same union
 * means a descriptor cannot name a state the functions never return.
 */

import type { MetricDescriptor } from '../lib/types.ts';
import type { ComputeKey } from '../lib/metrics.ts';
import { FIXTURE_SCHEMA_VERSION, type FixtureSchemaVersion } from '../lib/types.ts';

export const schemaVersion: FixtureSchemaVersion = FIXTURE_SCHEMA_VERSION;

/**
 * `compute_key` narrowed to the metric registry's actual keys.
 *
 * D-042 conceded that naming a function by string lets the descriptor and the function drift, and
 * said the fix was to type the key against the map. This is that: rename or delete a metric
 * function and every descriptor pointing at it fails the build, instead of the dashboard rendering
 * a tile that silently computes nothing.
 */
export const metricDescriptors: (MetricDescriptor & { compute_key: ComputeKey })[] = [
  /* ============================ BUSINESS ================================================== */
  {
    id: 'published_vs_planned',
    label: 'Posts published',
    family: 'business',
    definition:
      'The share of planned slots that actually published. Slots that slipped, were dropped or ' +
      'were quarantined count against it.',
    unit: '%',
    healthy_range: { min: 90, max: null },
    action_when_outside:
      'Read the slip reasons. A pattern of "unreviewed in time" is a review-capacity problem; a ' +
      'pattern of guardrail blocks is a drafting problem.',
    phase: 'both',
    empty_state: { status: 'no_data', copy: 'No slots planned in this period yet.' },
    /**
     * MONTHLY, and the window is the point rather than a default.
     *
     * At a weekly denominator of eight, one missed slot reads as 87.5% — below the 90% gate — so
     * every ordinary week would look like a failure and the gate would stop meaning anything. A
     * monthly denominator of ~35 absorbs a single miss and still catches a pattern.
     */
    window_default: 'period',
    compute_key: 'publishedVsPlanned',
  },
  {
    id: 'time_saved',
    label: 'Time saved',
    family: 'business',
    /** The definition carries its own arithmetic because the number is otherwise unfalsifiable.
     *  The baseline is a captured input on Client, timed during onboarding — not a guess. */
    /**
     * A SHARE, not a raw hour count.
     *
     * Hours saved grows with volume, so it goes up when the client buys more posts and says
     * nothing about whether the system is working. The share — saved over what writing them by
     * hand would have cost — is flat against volume and is the number that actually steers.
     */
    definition:
      'Time saved as a share of what writing those posts by hand would have cost. Computed as ' +
      '(posts x your timed baseline − minutes spent in the queue) / (posts x baseline).',
    unit: '%',
    healthy_range: { min: 60, max: null },
    action_when_outside:
      'Below 60%, reviewing costs most of what writing did. Look at time-to-decision and at how ' +
      'many drafts needed edits. The baseline is timed at onboarding — a made-up multiplier makes ' +
      'this decorative.',
    phase: 'both',
    empty_state: { status: 'no_data', copy: 'Awaiting first publish.' },
    window_default: 'period',
    compute_key: 'timeSaved',
  },
  {
    id: 'engagement_vs_baseline',
    label: 'Engagement vs the account’s median',
    family: 'business',
    definition:
      'Engagement on agent-published posts against this channel\'s own median before the agent. ' +
      'Mature posts only — engagement is still accruing before day seven, so an immature post ' +
      'drags the median down for reasons that are not about the post.',
    unit: 'x baseline',
    healthy_range: { min: 1, max: null },
    action_when_outside:
      'Below baseline for three weeks is a content conversation, not an engineering one: pillars, ' +
      'briefs, and who is reviewing.',
    phase: 'both',
    /**
     * A-17's four-week rule, as a state rather than a footnote. A client with no history on a
     * channel has nothing to compare against, and the first four weeks establish it. Brightsill is
     * exactly this case on X and not on LinkedIn, which is why the two channels legitimately
     * render differently.
     */
    empty_state: {
      status: 'establishing_baseline',
      copy: 'Establishing this channel’s baseline over the first four weeks.',
    },
    window_default: 'rolling_4w',
    compute_key: 'engagementVsBaseline',
  },
  {
    id: 'cost_per_post',
    label: 'Cost per published post',
    family: 'business',
    /** Two addends, deliberately. Model spend and platform spend are separate fields on every
     *  step, because X is pay-per-use and a URL-bearing post costs a multiple of a plain one —
     *  which is what makes the poll interval a cost lever rather than a detail. */
    definition:
      'Model spend plus platform API spend, divided by posts published. Both addends are summed ' +
      'from individual run steps, never from a stored total.',
    unit: 'USD',
    /**
     * No static band, deliberately. The ceiling is the client's monthly cap divided by planned
     * posts, so it moves when either moves — writing a fixed number here would be a band that
     * silently stops matching the budget it is supposed to enforce. The tile derives it.
     */
    healthy_range: { min: null, max: null },
    action_when_outside:
      'The ceiling is the monthly cap divided by planned posts. Over it, check the rewrite count ' +
      'first — a draft rewritten three times costs roughly three drafts — then poll intervals. ' +
      'Raising the cap is a client decision, not an engineering one.',
    phase: 'both',
    empty_state: { status: 'no_data', copy: 'No runs in this period.' },
    window_default: 'period',
    compute_key: 'costPerPost',
  },

  /* ============================ AGENT QUALITY ============================================= */
  {
    id: 'edit_rate',
    label: 'Approved with edits',
    family: 'agent_quality',
    definition:
      'Share of approved posts where a person changed the text before approving. Counted from ' +
      'version authorship, not from the decision label.',
    unit: '%',
    /**
     * 30% in v1, 20% after auto-approve exists — because at that point nobody is reading the ones
     * that skip review.
     *
     * This descriptor is the v1 one and carried 20, which is the *other* phase's number. At our
     * actual edit rate of 24% the tile would have rendered a healthy value as out of range: a
     * false alarm on the metric most likely to be looked at. Found by reconciling against the PRD.
     */
    healthy_range: { min: null, max: 30 },
    action_when_outside:
      'Look at the edit tags. A tag recurring three times in twenty decisions should already have ' +
      'produced a suggested writing rule; if it has not, the reflection job is the problem.',
    phase: 'v1_all_human',
    empty_state: { status: 'no_data', copy: 'No approvals in this period.' },
    window_default: 'rolling_4w',
    /** The one graded drill-down splits this by settings version (D-042, §6). */
    compute_key: 'editRate',
  },
  {
    id: 'edit_magnitude',
    label: 'How much gets edited',
    family: 'agent_quality',
    /* "Normalised token distance" is the implementation, and the operator reading this screen is
       a marketing lead. The first sentence is what the number means; the mechanism follows it. */
    definition:
      'How much of a post gets rewritten when someone edits it, not how often. Computed as the ' +
      'median normalised token distance between the last agent version and the shipped one.',
    unit: '%',
    healthy_range: { min: null, max: 20 },
    action_when_outside:
      'High magnitude with low edit rate means a few drafts are being rewritten wholesale — look ' +
      'at those pillars specifically rather than at the average.',
    phase: 'both',
    empty_state: { status: 'no_data', copy: 'No edited approvals in this period.' },
    window_default: 'rolling_4w',
    compute_key: 'editMagnitude',
  },
  {
    id: 'time_to_decision',
    label: 'Time to decide',
    family: 'agent_quality',
    /** Distinct from queue age, and conflating them is the trap: this is how long the item was
     *  open in front of a person, inclusive of editing. Queue age is how long it waited. */
    definition:
      'Median seconds an item was open in front of the operator, including time spent editing.',
    unit: 'seconds',
    /** Two minutes. Section 1's cadence sizing rests on this number: eight posts at ~2 minutes is
     *  one short weekly session, and the same approve-everything rule at 10 minutes is an
     *  afternoon. If this rises, the volume the client contracted stops being reviewable. */
    healthy_range: { min: 15, max: 120 },
    action_when_outside:
      'Sustained rises mean the handoff payload is not answering the question, and the contracted ' +
      'volume stops fitting in one session.',
    phase: 'both',
    empty_state: { status: 'no_data', copy: 'No decisions in this period.' },
    window_default: 'rolling_4w',
    compute_key: 'timeToDecision',
  },
  {
    id: 'rubber_stamp_rate',
    /* Was "Decided under 15 seconds", which made the caption underneath — "Share of approvals
       decided in under fifteen seconds." — the label again as a sentence. The label names the
       behaviour; the caption says how it is measured. */
    label: 'Rubber-stamped',
    family: 'agent_quality',
    /**
     * Split out from time-to-decision rather than folded into it. A-17 writes the two together,
     * but a median cannot detect this: a queue where half the items get careful review and half
     * get a reflex click has a perfectly healthy median.
     *
     * This is the metric that measures whether human-in-the-loop is real, which A-17 identifies as
     * HITL's actual failure mode. A system whose entire safety argument rests on human review
     * needs an instrument pointed at the humans.
     */
    definition: 'Share of approvals decided in under fifteen seconds.',
    unit: '%',
    healthy_range: { min: null, max: 20 },
    action_when_outside:
      'The review gate has become theatre. This is a conversation with a named person, not a ' +
      'threshold to retune.',
    phase: 'both',
    empty_state: { status: 'no_data', copy: 'No decisions in this period.' },
    window_default: 'rolling_4w',
    compute_key: 'rubberStampRate',
  },
  {
    id: 'queue_age_p95',
    label: 'Longest wait in the queue',
    family: 'agent_quality',
    definition:
      'The 95th percentile of time from an item entering review to a decision on it. Measured ' +
      'from when this review began, so a redraft starts a new clock.',
    unit: 'hours',
    healthy_range: { min: null, max: 48 },
    action_when_outside:
      'The human is the bottleneck, not the agent. Either review capacity or cadence has to move.',
    phase: 'both',
    empty_state: { status: 'no_data', copy: 'Nothing has been through review yet.' },
    /**
     * Rolling, and the tile says so. At eight posts a week a weekly p95 is the maximum of eight
     * samples, which is not a percentile in any useful sense. That is not a fixture artifact — it
     * is true in production at this contracted volume, and a dashboard that hid it would be
     * steering on noise.
     */
    window_default: 'rolling_4w',
    compute_key: 'queueAgeP95',
  },
  {
    id: 'guardrail_block_rate',
    label: 'Blocked before review',
    family: 'agent_quality',
    /** Per layer and per rule. The denominator is *evaluations*, which is why passes are recorded
     *  and not only the interesting results (R7) — without them a rule that has silently stopped
     *  being evaluated looks identical to a rule that is passing everything. */
    definition: 'Share of checks that warned or blocked before a person saw the draft.',
    unit: '%',
    /**
     * The band is relative, not absolute: within 50% of the trailing four-week rate. There is no
     * correct absolute block rate — it depends entirely on what the drafts are like — so the only
     * meaningful alarm is a *change*, and a sudden drop is the one that matters.
     */
    healthy_range: { min: null, max: null },
    action_when_outside:
      'A sudden drop is the alarm, not a high value. Check first whether somebody switched the ' +
      'rule off — the chart marks the date if so.',
    phase: 'both',
    empty_state: { status: 'no_data', copy: 'No guardrail evaluations in this period.' },
    window_default: 'rolling_4w',
    compute_key: 'guardrailBlockRate',
  },
  {
    /**
     * Added 17 Aug. The PRD names escalation rate and precision together and this file had only
     * precision.
     *
     * They are not redundant, and the pairing is the point: precision cannot tell you escalations
     * tripled, and rate cannot tell you they were justified. A system escalating everything scores
     * perfect precision; a system escalating nothing scores none at all.
     */
    id: 'escalation_rate',
    label: 'Raised with a person',
    family: 'agent_quality',
    definition: 'Share of drafts that raised an escalation of any tier.',
    unit: '%',
    healthy_range: { min: null, max: 25 },
    action_when_outside:
      'Above 25%, escalation has stopped being exceptional and the queue is being sorted rather ' +
      'than triaged. Cut by trigger to find which rule is doing it.',
    phase: 'both',
    empty_state: { status: 'no_data', copy: 'No drafts in this period.' },
    window_default: 'rolling_4w',
    compute_key: 'escalationRate',
  },
  {
    id: 'escalation_precision',
    label: 'Escalations that were warranted',
    family: 'agent_quality',
    /**
     * The metric that only exists because there is a one-click way to label an escalation
     * unnecessary. `was_unnecessary` is tri-state — unlabelled is not the same as correct — and if
     * unlabelled counted as correct the figure would read high by default, which is what "the
     * column without which the metric is fiction" means.
     */
    definition:
      'Of escalations a person has labelled, the share that were warranted. Shown with its ' +
      'coverage, because a precision figure over four labelled events is not a measurement.',
    unit: '%',
    healthy_range: { min: 60, max: null },
    action_when_outside:
      'Cut by trigger rather than in aggregate. "Precision is 63%" steers nothing; "the ' +
      'unapproved-entity trigger is 40% junk" tunes one rule.',
    phase: 'both',
    empty_state: { status: 'no_data', copy: 'No escalations labelled yet.' },
    window_default: 'rolling_4w',
    compute_key: 'escalationPrecision',
  },
  {
    id: 'injection_detections',
    label: 'Sources quarantined',
    family: 'agent_quality',
    definition: 'Sources quarantined for carrying instructions aimed at the agent.',
    unit: '',
    /** Any detection is worth a look, so there is no healthy band — this is a count you read, not
     *  a rate you tune. */
    healthy_range: { min: null, max: null },
    action_when_outside:
      'Any detection gets reviewed. A repeat from one domain gets the domain removed from the ' +
      'source allowlist.',
    phase: 'both',
    empty_state: { status: 'no_data', copy: 'None in this period.' },
    window_default: 'period',
    compute_key: 'injectionDetections',
  },
  {
    id: 'auto_approve_rate',
    label: 'Published without review',
    family: 'agent_quality',
    definition: 'Share of posts published without per-item human review.',
    unit: '%',
    healthy_range: { min: null, max: null },
    action_when_outside: 'Not applicable while auto-approve is off.',
    phase: 'post_auto_approve',
    /**
     * The reason `not_applicable` had to be its own result kind. In v1 this is zero, and zero is
     * the correct and intended value — so it must never render as a red tile. A-17 is explicit
     * that n/a-by-design and no-data-yet are different states, and `number | null` would have
     * forced the dashboard to guess which one it had received.
     */
    empty_state: {
      status: 'not_applicable',
      copy: 'Off by design — every post is reviewed by a person.',
    },
    window_default: 'period',
    compute_key: 'autoApproveRate',
  },
];
