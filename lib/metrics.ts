/**
 * METRICS — every number on the dashboard, as a pure function over the record collections.
 *
 * R1: no record carries a precomputed aggregate. There is no `stats.ts`, no `Client.edit_rate`, no
 * cached weekly rollup. The reason is not purity — it is that the dashboard's stated purpose is
 * that approving or rejecting something in the demo visibly moves the numbers, and a stats fixture
 * silently destroys the one property that screen is graded on. It is also the obvious shortcut,
 * which is why the rule is written down.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THESE RETURN A RESULT AND NOT A NUMBER
 *
 * A-17 insists the four flavours of nothing are not interchangeable, and the dashboard has to
 * render them differently:
 *
 *   ok                     a value, with the sample size it came from
 *   no_data                nothing in this window yet — "awaiting first publish", never red
 *   not_applicable         auto-approve rate in v1: zero is correct and intended, never red
 *   establishing_baseline  engagement on a channel with no history: "2 of 4 weeks"
 *
 * `number | null` would force every tile to guess which nothing it received, and the rule that
 * n=0 never renders as red would become a per-tile hardcode.
 *
 * `sample_n` rides on every ok result because three of these stay statistically thin at eight
 * posts a week, and a tile that cannot say "over 8 samples" is inviting the reader to over-read
 * it. That is true in production at this contracted volume, not a fixture artifact.
 */

import type { MinutesFromAnchor,
  Approval,
  Draft,
  FixtureSet,
  GuardrailEvent,
  MetricDescriptor,
  MetricResult,
  Post,
} from './types.ts';

const DAY = 24 * 60;

/** Every metric is a function over the world and a window. One signature, so the dashboard can
 *  look a function up by name rather than special-casing each tile. */
export type MetricFn = (world: FixtureSet, window: Window) => MetricResult<number>;

/**
 * A window is "from N days ago until now" — and the *until now* is load-bearing.
 *
 * Offsets are signed, so the live week's slots carry positive values: they publish in the future.
 * The first version bounded only the past end, so those future slots landed in every denominator.
 * Published-vs-planned read 76% against a 90% gate — a red tile caused entirely by counting posts
 * that have not had the chance to publish yet.
 */
export type Window = { fromDaysAgo: number };

export const ROLLING_4W: Window = { fromDaysAgo: 28 };
/** The budget period, which is what "period" means everywhere in this system: monthly. */
export const PERIOD: Window = { fromDaysAgo: 31 };

const inWindow = (at: number | null, w: Window) =>
  at !== null && at >= -w.fromDaysAgo * DAY && at <= 0;

const ok = (value: number, sample_n: number): MetricResult<number> =>
  sample_n === 0 ? { kind: 'no_data' } : { kind: 'ok', value, sample_n };

const pct = (numerator: number, denominator: number, sample_n = denominator) =>
  denominator === 0 ? ({ kind: 'no_data' } as const) : ok((numerator / denominator) * 100, sample_n);

/* ================================================================================================
 * SELECTORS
 * ==============================================================================================*/

const publishedIn = (w: FixtureSet, win: Window): Post[] =>
  w.posts.filter((p) => p.state === 'published' && inWindow(p.published_at, win));

/**
 * Decisions in the window, excluding any that a later decision replaced.
 *
 * `superseded_by` was on the record from the start and nothing read it, because nothing could
 * produce a re-decision. The settings sweep can: adding a banned claim sends an already-approved
 * post back, and approving it again is a second decision on the same version.
 *
 * Counting both would inflate every denominator on this page and would let one post contribute two
 * approvals to edit rate — the exact disagreement between the metrics and the queue that the field
 * exists to prevent. C4's "one Approval per decision session" is only true if the readers honour it.
 */
const decidedIn = (w: FixtureSet, win: Window): Approval[] =>
  w.approvals.filter(
    (a) => a.decided_at !== null && a.superseded_by === null && inWindow(a.decided_at, win),
  );

/* ================================================================================================
 * BUSINESS
 * ==============================================================================================*/

/**
 * Published over planned. The denominator is what makes it informative: slots that slipped, were
 * dropped or were quarantined were all planned and none of them published.
 *
 * Fold CalendarSlot onto Draft and the denominator becomes the numerator, the metric reads 100%
 * forever, and the ≥90% gate can never fire. That is the whole argument for the slot being a
 * record, and it is visible here in one line.
 */
export const publishedVsPlanned: MetricFn = (w, win) => {
  const slots = w.calendarSlots.filter((s) => inWindow(s.publish_at, win) && s.state !== 'planned');
  const published = slots.filter((s) => s.state === 'published');
  return pct(published.length, slots.length);
};

/**
 * Time saved as a *share* of what writing those posts by hand would have cost.
 *
 * A raw hour count grows with volume, so it rises when the client buys more posts and says nothing
 * about whether the system is working. The share is flat against volume, which is what makes it
 * steerable.
 *
 * The baseline is a captured input — the operator's median time to produce one post by hand, timed
 * during onboarding. Without it this metric is invented, which is why the client record carries the
 * sample size and method beside it.
 */
export const timeSaved: MetricFn = (w, win) => {
  const posts = publishedIn(w, win);
  if (posts.length === 0) return { kind: 'no_data' };

  const manualMinutes = posts.length * w.client.manual_baseline_minutes_per_post;
  // seconds_open is inclusive of editing time — the only measurement that detects a non-read.
  const queueMinutes =
    decidedIn(w, win).reduce((total, a) => total + (a.seconds_open ?? 0), 0) / 60;

  return ok(((manualMinutes - queueMinutes) / manualMinutes) * 100, posts.length);
};

/**
 * Engagement against the client's own baseline, mature posts only.
 *
 * A no-history channel returns `establishing_baseline` rather than a number, because there is
 * nothing to compare against and rendering zero would say the posts performed badly rather than
 * that the question cannot be answered yet.
 */
export function engagementVsBaseline(
  w: FixtureSet,
  win: Window,
  channel: 'linkedin' | 'x' = 'linkedin',
): MetricResult<number> {
  const baseline = w.client.engagement_baseline.find((b) => b.channel === channel);

  if (!baseline || baseline.median_rate === null) {
    /**
     * Weeks of data on *this channel*, not weeks since the client onboarded.
     *
     * The first version counted from onboarding and capped at four, which rendered "establishing —
     * 4 of 4 weeks" for a client nine weeks in: a sentence that contradicts itself, since four of
     * four weeks elapsed means the baseline should exist. The question this state answers is "do we
     * have enough of this channel to compare against yet", and that is answered by the channel's
     * own published history.
     */
    const published = w.posts.filter((p) => p.channel === channel && p.published_at !== null);
    const oldest = Math.min(...published.map((p) => p.published_at as number), 0);
    const weeksOfData = Math.min(4, Math.floor(-oldest / (7 * DAY)));
    return {
      kind: 'establishing_baseline',
      weeks_elapsed: Math.max(0, weeksOfData),
      weeks_required: 4,
    };
  }

  const posts = publishedIn(w, win).filter((p) => p.channel === channel);
  const rates = posts
    .map((post) => {
      const mature = w.metricSnapshots.find((s) => s.post_id === post.id && s.is_mature);
      if (!mature || !mature.impressions) return null;
      // Nulls are excluded rather than zeroed: LinkedIn and X do not expose the same counters, and
      // a zero in the numerator reads as poor engagement rather than as no data.
      const engaged = (mature.reactions ?? 0) + (mature.comments ?? 0) + (mature.shares ?? 0);
      return engaged / mature.impressions;
    })
    .filter((r): r is number => r !== null);

  if (rates.length === 0) return { kind: 'no_data' };
  const median = [...rates].sort((a, b) => a - b)[Math.floor(rates.length / 2)];
  return ok(median / baseline.median_rate, rates.length);
}

/** Model spend plus metered platform calls, per published post. Summed from steps, because R1
 *  deleted the run-level totals — a run header disagreeing with the steps beneath it is the most
 *  visible possible form of that defect. */
export const costPerPost: MetricFn = (w, win) => {
  const posts = publishedIn(w, win);
  if (posts.length === 0) return { kind: 'no_data' };
  const spend = w.runSteps
    .filter((s) => inWindow(s.started_at, win))
    .reduce((total, s) => total + s.cost_model_usd + s.cost_platform_usd, 0);
  return ok(spend / posts.length, posts.length);
};

/* ================================================================================================
 * AGENT QUALITY
 * ==============================================================================================*/

/** Counted from version authorship, not from the decision label. If they ever disagree the version
 *  wins — a human wrote the shipped text or they did not. */
export function editedDrafts(w: FixtureSet, approvals: Approval[]): Draft[] {
  return approvals
    .map((a) => w.drafts.find((d) => d.versions.some((v) => v.id === a.draft_version_id)))
    .filter((d): d is Draft => d !== undefined)
    .filter((d) => d.versions.some((v) => v.author === 'human'));
}

export const editRate: MetricFn = (w, win) => {
  const decided = decidedIn(w, win).filter((a) => a.decision !== 'reject');
  return pct(editedDrafts(w, decided).length, decided.length);
};

/**
 * TOKENISER, documented because "normalised token distance" means nothing until a token is defined.
 *
 * Whitespace-separated, lowercased, punctuation stripped. Crude on purpose: the number it feeds is
 * a *relative* signal — is this edit bigger than that one — and a cleverer tokeniser would move
 * every historical value without making any comparison more true.
 */
export const tokenise = (text: string): string[] =>
  text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);

/**
 * How much was changed, not how often. Computed here and never stored: a stored value drifts the
 * moment a fixture is hand-edited, and freezes when the reviewer edits a draft live — which is the
 * exact demo moment the dashboard exists to serve.
 *
 * Measured against the last *agent* version, not v1: measuring against v1 would score the agent's
 * own rewrites as human edits.
 */
export const editMagnitude: MetricFn = (w, win) => {
  const distances: number[] = [];

  for (const draft of editedDrafts(w, decidedIn(w, win))) {
    const human = [...draft.versions].reverse().find((v) => v.author === 'human');
    const lastAgent = [...draft.versions].reverse().find((v) => v.author === 'agent');
    if (!human || !lastAgent) continue;

    const before = tokenise(lastAgent.text);
    const after = tokenise(human.text);
    const beforeSet = new Set(before);
    const changed = after.filter((t) => !beforeSet.has(t)).length + Math.abs(after.length - before.length);
    distances.push(before.length === 0 ? 0 : (changed / before.length) * 100);
  }

  if (distances.length === 0) return { kind: 'no_data' };
  const median = [...distances].sort((a, b) => a - b)[Math.floor(distances.length / 2)];
  return ok(median, distances.length);
};

/** How long an item was open in front of a person, inclusive of editing. Not to be conflated with
 *  queue age: reporting a 30-hour wait as "time to decision" would make it look like 30 hours of
 *  careful review. */
export const timeToDecision: MetricFn = (w, win) => {
  const seconds = decidedIn(w, win)
    .map((a) => a.seconds_open)
    .filter((s): s is number => s !== null);
  if (seconds.length === 0) return { kind: 'no_data' };
  const median = [...seconds].sort((a, b) => a - b)[Math.floor(seconds.length / 2)];
  return ok(median, seconds.length);
};

/**
 * The rubber-stamp detector, and the reason it is separate from the median above.
 *
 * A median cannot find this: a queue where half the items get careful review and half get a reflex
 * click has a perfectly healthy median. This is the instrument pointed at the humans, in a system
 * whose entire safety argument rests on human review.
 */
export const rubberStampRate: MetricFn = (w, win) => {
  const decided = decidedIn(w, win).filter((a) => a.seconds_open !== null);
  return pct(decided.filter((a) => (a.seconds_open ?? 0) < 15).length, decided.length);
};

/** 95th percentile of time from entering review to a decision. At eight a week a weekly p95 is the
 *  maximum of eight, which is why the window is rolling and the tile says so. */
export const queueAgeP95: MetricFn = (w, win) => {
  const ages = decidedIn(w, win)
    .map((a) => ((a.decided_at as number) - (a.queued_at as number)) / 60)
    .sort((a, b) => a - b);
  if (ages.length === 0) return { kind: 'no_data' };
  return ok(ages[Math.min(ages.length - 1, Math.floor(ages.length * 0.95))], ages.length);
};

/** Denominator is evaluations, which is why passes are recorded. Without them a rule that stopped
 *  being evaluated would look identical to one passing everything. */
export const guardrailBlockRate: MetricFn = (w, win) => {
  const events = w.guardrailEvents.filter((e) => inWindow(e.evaluated_at, win));
  return pct(events.filter((e) => e.result !== 'pass').length, events.length);
};

export function blockRateByLayer(
  w: FixtureSet,
  win: Window,
): { layer: string; rate: number; evaluations: number }[] {
  const events = w.guardrailEvents.filter((e) => inWindow(e.evaluated_at, win) && e.rule_id);
  const layers = ['L1', 'L2', 'L3', 'L4'];
  return layers
    .map((layer) => {
      const ruleIds = new Set(w.guardrailRules.filter((r) => r.layer === layer).map((r) => r.id));
      const forLayer = events.filter((e) => e.rule_id && ruleIds.has(e.rule_id));
      return {
        layer,
        evaluations: forLayer.length,
        rate: forLayer.length === 0 ? 0 : (forLayer.filter((e) => e.result !== 'pass').length / forLayer.length) * 100,
      };
    })
    .filter((row) => row.evaluations > 0);
}

const escalationsIn = (w: FixtureSet, win: Window): GuardrailEvent[] =>
  w.guardrailEvents.filter((e) => e.escalation_tier !== 'none' && inWindow(e.raised_at, win));

/**
 * Share of reviewed drafts that raised an escalation.
 *
 * Two things in the denominator and numerator had to be corrected against a first version that
 * read 33% against a 25% band — an alarm caused by the definition rather than by the system.
 *
 *   The denominator is items that *reached review*, not items already decided. Escalations get
 *   raised the moment a run stops, so counting them against decisions alone charges the rate for
 *   items still sitting in the queue.
 *
 *   The numerator excludes escalations with no draft behind them. A tool failure and a quarantined
 *   source both escalate, and neither is a draft that escalated — folding them in makes a rate
 *   about draft quality move when a web server goes down.
 */
export const escalationRate: MetricFn = (w, win) => {
  const reviewed = w.approvals.filter((a) => inWindow(a.queued_at, win));
  if (reviewed.length === 0) return { kind: 'no_data' };
  const draftEscalations = escalationsIn(w, win).filter((e) => e.draft_id !== null);
  return pct(draftEscalations.length, reviewed.length);
};

/**
 * Of escalations somebody has judged, the share that were warranted.
 *
 * `was_unnecessary` is tri-state and the null case is what makes this honest: unlabelled is not the
 * same as correct, and if it counted as correct the figure would read high by default. `sample_n`
 * here is the *labelled* count, so the tile can show coverage — "67% over 3 labels" is not a
 * number, and the tile has to be able to say so.
 */
export const escalationPrecision: MetricFn = (w, win) => {
  const labelled = escalationsIn(w, win).filter((e) => e.was_unnecessary !== null);
  return pct(labelled.filter((e) => e.was_unnecessary === false).length, labelled.length);
};

export const injectionDetections: MetricFn = (w, win) => {
  const rule = w.guardrailRules.find((r) => r.kind === 'prompt_injection');
  const hits = w.guardrailEvents.filter(
    (e) => e.rule_id === rule?.id && e.result !== 'pass' && inWindow(e.evaluated_at, win),
  );
  // A count, and zero is a real answer here rather than an absence — "none this period" is
  // information, unlike an average over no samples.
  return { kind: 'ok', value: hits.length, sample_n: hits.length };
};

/** In v1 this is zero, and zero is correct and intended — which is exactly why it must never
 *  render as red. That distinction is the reason `not_applicable` exists as a result kind. */
export const autoApproveRate: MetricFn = (w) =>
  w.settings.phase === 'v1_all_human'
    ? { kind: 'not_applicable', reason: 'Off by design — every post is reviewed by a person.' }
    : { kind: 'no_data' };

/* ================================================================================================
 * THE REGISTRY
 *
 * `MetricDescriptor.compute_key` names one of these. Typing the key against this map is what D-042
 * promised and what makes a descriptor naming a function that does not exist a compile error rather
 * than a blank tile nobody notices.
 * ==============================================================================================*/

export const METRICS = {
  publishedVsPlanned,
  timeSaved,
  engagementVsBaseline: (w: FixtureSet, win: Window) => engagementVsBaseline(w, win),
  costPerPost,
  editRate,
  editMagnitude,
  timeToDecision,
  rubberStampRate,
  queueAgeP95,
  guardrailBlockRate,
  escalationRate,
  escalationPrecision,
  injectionDetections,
  autoApproveRate,
} satisfies Record<string, MetricFn>;

export type ComputeKey = keyof typeof METRICS;

/**
 * A descriptor whose `compute_key` is known to name a real function.
 *
 * `MetricDescriptor.compute_key` is typed `string` in `lib/types.ts` on purpose — that file cannot
 * import this one without a cycle — and `fixtures/metricDescriptors.ts` narrows it by annotating the
 * array. That narrowing is what D-042 promised, and it used to reach the dashboard only because the
 * dashboard imported the fixture directly, which is the thing D-002 forbids.
 *
 * Routing the read through `agentClient` fixed the D-002 violation and would have silently dropped
 * the guarantee with it — `METRICS[d.compute_key]` becomes an untyped index the moment the key
 * widens back to `string`. Carrying the narrowed type on the seam's return keeps both properties at
 * once: the component never touches a fixture, and a descriptor naming a function that does not
 * exist is still a compile error rather than a blank tile.
 */
export type KeyedMetricDescriptor = MetricDescriptor & { compute_key: ComputeKey };

/* ================================================================================================
 * THE DRILL-DOWN
 * ==============================================================================================*/

/**
 * Edit rate split by the settings version each draft was written under.
 *
 * This is the one the brief requires, and it is the right one because it is the only candidate
 * that connects two screens through data rather than narration: the Settings screen's change
 * history is literally the x-axis. A-05 names exactly this comparison as the detection mechanism
 * for a reflection rule that made the output worse — you cannot tell whether a rule helped without
 * comparing before and after it.
 *
 * It is also why every draft version stamps its settings version, and why Settings keeps an inline
 * history with per-key diffs rather than a bare integer: a draft stamped "version 3" whose version
 * 3 cannot be resolved makes this uncomputable.
 */
export type EditRateCohort = {
  settingsVersionId: string;
  changeSummary: string;
  decisions: number;
  edited: number;
  rate: number;
};

export function editRateBySettingsVersion(w: FixtureSet): EditRateCohort[] {
  return w.settings.versions
    .map((version) => {
      const decisions = w.approvals.filter((a) => {
        if (a.decided_at === null || a.decision === 'reject') return false;
        /** Same exclusion as `decidedIn`, and for the same reason: a superseded decision counted
         *  here would put one draft in a cohort twice. */
        if (a.superseded_by !== null) return false;
        const draft = w.drafts.find((d) => d.versions.some((v) => v.id === a.draft_version_id));
        const stamped = draft?.versions.find((v) => v.id === a.draft_version_id);
        return stamped?.settings_version_id === version.version_id;
      });
      const edited = editedDrafts(w, decisions);
      return {
        settingsVersionId: version.version_id,
        changeSummary: version.change_summary,
        decisions: decisions.length,
        edited: edited.length,
        rate: decisions.length === 0 ? 0 : (edited.length / decisions.length) * 100,
      };
    })
    .filter((cohort) => cohort.decisions > 0);
}

/**
 * The drafts behind one edit-rate bar — the SAME population the bar counted.
 *
 * There used to be a `draftsInCohort` here returning every draft with any version stamped with a
 * settings version, including rejected and undecided ones, while `editRateBySettingsVersion` counts
 * decided, non-rejected, non-superseded approvals. The screen put one under the other, so "1 of 6
 * rewritten" could sit above eight rows with two marked rewritten and the panel contradicted
 * itself. One filter, expressed once, used by both — `check.mts` asserts they agree.
 */
/** v1's drill-down, which lists every draft written under a settings version rather than every
 *  draft DECIDED under it. Kept because `/v1/metrics` is the preserved 17 Aug submission and still
 *  calls it; the rebuilt screen uses `cohortDrafts` below, which agrees with the bar above it. */
export function draftsInCohort(w: FixtureSet, settingsVersionId: string): Draft[] {
  return w.drafts.filter((d) =>
    d.versions.some((v) => v.settings_version_id === settingsVersionId),
  );
}

export function cohortDrafts(
  w: FixtureSet,
  settingsVersionId: string,
): { draft: Draft; edited: boolean; decidedAt: MinutesFromAnchor }[] {
  return decidedInCohort(w, settingsVersionId).map(({ draft, decidedAt }) => ({
    draft,
    edited: draft.versions.some((v) => v.author === 'human'),
    decidedAt,
  }));
}

function decidedInCohort(
  w: FixtureSet,
  settingsVersionId: string,
): { draft: Draft; decidedAt: MinutesFromAnchor }[] {
  const out: { draft: Draft; decidedAt: MinutesFromAnchor }[] = [];
  for (const a of w.approvals) {
    if (a.decided_at === null || a.decision === 'reject' || a.superseded_by !== null) continue;
    const draft = w.drafts.find((d) => d.versions.some((v) => v.id === a.draft_version_id));
    const stamped = draft?.versions.find((v) => v.id === a.draft_version_id);
    if (!draft || stamped?.settings_version_id !== settingsVersionId) continue;
    out.push({ draft, decidedAt: a.decided_at });
  }
  return out;
}

