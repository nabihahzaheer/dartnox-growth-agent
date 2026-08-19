/**
 * WEEK — the operator's unit of work, as a pure function over the record collections.
 *
 * WHY THIS MODULE EXISTS.
 *
 * The architecture's rhythm is weekly and every screen used to hide it. Monday plans next week,
 * Wednesday drafts all eight of its posts, the publish scheduler fires against slot times, Sunday
 * learns from the week's edits. The data has always carried that shape — `CalendarSlot.publish_at`
 * on twenty-nine slots, `Run.parent_run_id` fanning one batch into eight children, a planning run
 * carrying eight `proposed_calendar` entries. Nothing rendered it. The interface was organised
 * around the run, which is the *child* of a week, and so it showed a flat log of every run the
 * system had ever emitted and left the operator to reconstruct the week in their head.
 *
 * This is the read-model that makes the week a value. It sits beside `lib/metrics.ts` and follows
 * the same rule: no aggregate is stored, everything is derived, so a decision taken in the demo
 * moves what the week says. It is deliberately *not* in `lib/world.ts` — that module holds state
 * transitions, and a week is a projection, not a transition.
 *
 * ---------------------------------------------------------------------------------------------
 * THE EIGHT-SLOT JOIN, WHICH IS THE WHOLE POINT
 *
 * The board says "Approved plan = 8 posts, one independent run per post". Next week has *five*
 * `CalendarSlot` records. The other three exist only as `proposed_calendar` entries on the
 * planning run's interrupt step, because a slot record is written when drafting starts and those
 * three have not been drafted yet.
 *
 * Rendering only the five would under-report the week and quietly contradict the board. Inventing
 * three slot records would be worse. So this joins the two sources: a ratified slot wins, and a
 * proposed slot with no matching record renders as `planned` — which is exactly what it is. The
 * week reads eight, and every one of the eight is a record that already existed.
 *
 * Matching is on publish time and channel. Both are exact in the fixtures and neither is editable
 * in the prototype, so no fuzzy match is needed. `scripts/check.mts` asserts the join actually
 * resolves, because a silent miss would show up as a week that renders eleven slots instead of
 * eight — visible, but only if someone counts.
 */

import { CHANNEL_LABEL } from './types.ts';
import type {
  CalendarSlot,
  Draft,
  FixtureSet,
  MinutesFromAnchor,
  Pillar,
  Post,
  ProposedSlot,
  Run,
  RunId,
} from './types.ts';
import { NOW, weekIndexOf, weekLabel, weekStart, weekdayShort } from './time.ts';

const MINUTES_PER_DAY = 1440;

/* ================================================================================================
 * STATE — one operator-facing vocabulary for what a slot is doing
 * ==============================================================================================*/

/**
 * What the operator would say about a slot, which is not the same as any single record's state.
 *
 * A slot's situation is spread across three records: the slot itself owns `slipped`/`dropped`/
 * `quarantined` because nothing else can express them, the post owns everything from scheduling
 * onward (R6), and the draft owns everything before that. Asking a screen to walk those three in
 * the right order is how the queue and the rail end up disagreeing about the same slot, so the
 * walk happens once, here.
 */
export type WeekSlotState =
  /** Planned by Monday's run, not yet drafted. */
  | 'planned'
  | 'drafting'
  /** The only state that is a call to action. */
  | 'needs_you'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'blocked'
  | 'rejected'
  | 'failed'
  | 'pulled'
  | 'slipped'
  | 'dropped'
  | 'quarantined';

/**
 * What each state is called in English.
 *
 * Lives here rather than in `components/Badge.tsx` because it is keyed on `WeekSlotState`, declared
 * six lines above, and because the rebuilt calendar was importing it out of a v1-only component —
 * pointing the living interface at the frozen one, which is the exact dependency direction
 * `lib/errorCopy.ts` was created to avoid. Same argument, same fix; it had been made once and then
 * contradicted by a comment justifying the import instead.
 */
export const WEEK_SLOT_LABEL: Record<WeekSlotState, string> = {
  planned: 'Planned',
  drafting: 'Drafting',
  needs_you: 'Needs you',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  blocked: 'Blocked',
  rejected: 'Rejected',
  failed: 'Failed',
  pulled: 'Pulled',
  slipped: 'Slipped',
  dropped: 'Dropped',
  quarantined: 'Quarantined',
};

/** One slot in a week, with everything a row needs already resolved. */
export type WeekEntry = {
  /** Stable across both sources: the slot id where one exists, otherwise the proposed slot's
   *  publish time and channel, which are unique within a week. */
  key: string;
  publish_at: MinutesFromAnchor;
  channel: 'linkedin' | 'x';
  angle: string;
  pillar: Pillar | null;
  state: WeekSlotState;
  /** Null for a proposed slot that has not been drafted. */
  slot: CalendarSlot | null;
  draft: Draft | null;
  post: Post | null;
  /**
   * The run to open when this slot is clicked. The drafting run where one exists, otherwise the
   * planning run that proposed it — which is the honest answer to "what happened to this slot"
   * when the answer is "it was planned and nothing has happened yet".
   */
  run_id: RunId | null;
  /** When the operator's decision on this slot expires. Drives the countdown; null when nothing
   *  is waiting. */
  deadline: MinutesFromAnchor | null;
  /** Where the slot was originally planned, when it has since moved. */
  moved_from: MinutesFromAnchor | null;
};

/** A run that is about the week rather than about one of its posts. There are three or four of
 *  these, against the thirty-eight rows the old rail listed. */
export type WeekRun = {
  run: Run;
  title: string;
  detail: string;
};

/**
 * The calendar gate — the board's other human gate, and the one with no surface anywhere before
 * this. The client owner has 48 hours to approve the weekly plan; silence reuses the last
 * approved themes and force-reviews every post.
 *
 * Two shapes because the fixtures currently hold a *settled* gate — the owner approved on Tuesday,
 * which is what let Wednesday's batch run at all. Rendering a live countdown against that would be
 * the console asserting a deadline the data says has already passed.
 */
export type OwnerGate =
  | { kind: 'pending'; run_id: RunId; deadline: MinutesFromAnchor }
  | { kind: 'approved'; run_id: RunId; at: MinutesFromAnchor }
  | { kind: 'none' };

export type WeekDay = {
  /** 0 = Monday. */
  index: number;
  label: string;
  /** That day, at the client's local midnight. */
  start: MinutesFromAnchor;
  isToday: boolean;
  entries: WeekEntry[];
};

export type Week = {
  index: number;
  label: string;
  start: MinutesFromAnchor;
  /** Always seven, including empty days. A calendar that omits its empty days is a list. */
  days: WeekDay[];
  /** The same entries, flat and chronological, for surfaces that are not a grid. */
  entries: WeekEntry[];
  otherRuns: WeekRun[];
  waitingOnYou: number;
  ownerGate: OwnerGate;
  /** Whether stepping in each direction would land on a week that holds anything. Computed from
   *  the data's own extent so the stepper cannot walk into empty weeks forever. */
  hasPrevious: boolean;
  hasNext: boolean;
};

/* ================================================================================================
 * RESOLUTION
 * ==============================================================================================*/

const versionIdsOf = (draft: Draft): string[] => draft.versions.map((v) => v.id as string);

/**
 * The three-record walk, in the one order that is correct.
 *
 * Slot-terminal states come first because they are outcomes: a slipped slot may still have an
 * `approved` draft hanging off it, and reporting that as "approved" would say the post went out.
 * Post beats draft second, per R6 — the post is authoritative from scheduling onward. Draft last.
 */
function resolveState(slot: CalendarSlot | null, draft: Draft | null, post: Post | null): WeekSlotState {
  if (slot) {
    if (slot.state === 'slipped') return 'slipped';
    if (slot.state === 'dropped') return 'dropped';
    if (slot.state === 'quarantined') return 'quarantined';
  }

  if (post) {
    if (post.state === 'published') return 'published';
    if (post.state === 'failed') return 'failed';
    if (post.state === 'pulled') return 'pulled';
    /** Both of these are a post that lost its approval and is back in front of a person — the
     *  settings-sweep case and the edited-after-approval case. */
    if (post.state === 'invalidated' || post.state === 'pending_reapproval') return 'needs_you';
    return 'scheduled';
  }

  if (draft) {
    if (draft.state === 'awaiting_approval') return 'needs_you';
    if (draft.state === 'drafting' || draft.state === 'scored') return 'drafting';
    if (draft.state === 'approved') return 'approved';
    if (draft.state === 'rejected') return 'rejected';
    return 'blocked';
  }

  return 'planned';
}

/** The decision deadline the run is holding this slot against, where it is holding one. */
function deadlineFor(world: FixtureSet, draft: Draft | null): MinutesFromAnchor | null {
  if (!draft) return null;
  const step = world.runSteps.find(
    (s) => s.run_id === draft.run_id && s.interrupt !== null && s.interrupt.awaiting === 'operator',
  );
  return step?.interrupt?.deadline ?? null;
}

function entryFor(
  world: FixtureSet,
  publish_at: MinutesFromAnchor,
  channel: 'linkedin' | 'x',
  angle: string,
  pillarId: string,
  slot: CalendarSlot | null,
): WeekEntry {
  const draft = slot ? (world.drafts.find((d) => d.slot_id === slot.id) ?? null) : null;
  const post = draft
    ? (world.posts.find((p) => versionIdsOf(draft).includes(p.draft_version_id as string)) ?? null)
    : null;
  const state = resolveState(slot, draft, post);

  return {
    key: slot ? (slot.id as string) : `proposed:${publish_at}:${channel}`,
    publish_at,
    channel,
    angle,
    pillar: world.pillars.find((p) => (p.id as string) === pillarId) ?? null,
    state,
    slot,
    draft,
    post,
    run_id: draft ? draft.run_id : (slot?.calendar_run_id ?? null),
    deadline: state === 'needs_you' ? deadlineFor(world, draft) : null,
    moved_from: slot?.original_publish_at ?? null,
  };
}

/* ================================================================================================
 * RUN LABELLING
 *
 * Lives here rather than in `agentClient.ts` so that the rail, the console and the queue cannot
 * describe the same run three different ways. Only `buildWeek` reads it now.
 * ==============================================================================================*/

export function describeRun(world: FixtureSet, run: Run): { title: string; detail: string } {
  const draft = run.target_draft_id
    ? world.drafts.find((d) => d.id === run.target_draft_id)
    : undefined;
  const slot = draft ? world.calendarSlots.find((s) => s.id === draft.slot_id) : undefined;
  const pillar = draft ? world.pillars.find((p) => p.id === draft.pillar_id) : undefined;

  if (run.type === 'planning') return { title: 'Plan next week', detail: 'Calendar · 8 slots' };
  if (run.type === 'publish') return { title: 'Publish', detail: slot ? slot.angle : 'Scheduled post' };
  if (run.type === 'poll') return { title: 'Check replies', detail: 'Posts under 48h' };

  if (!draft) {
    /** A batch is identified by *having children*, not by lacking a parent — a redraft is
     *  parentless too, because a rejection queues it directly. */
    if (world.runs.some((r) => r.parent_run_id === run.id)) {
      return { title: 'Weekly drafting batch', detail: '8 posts' };
    }
    if (run.state === 'queued') return { title: 'Redraft', detail: 'Queued after a rejection' };
    return {
      title: 'Draft',
      detail: run.state === 'parked_transient' ? 'Source unavailable' : 'No draft produced',
    };
  }

  return {
    title: `Draft · ${pillar?.name ?? 'Unknown pillar'}`,
    detail: `${CHANNEL_LABEL[draft.channel]}${slot ? ` · ${slot.angle}` : ''}`,
  };
}

/* ================================================================================================
 * THE PROJECTION
 * ==============================================================================================*/

/** Every slot the planning runs proposed, whether or not it was ever ratified into a record. */
function proposedSlots(world: FixtureSet): { slot: ProposedSlot; run_id: RunId }[] {
  return world.runSteps
    .filter((s) => s.proposed_calendar !== null)
    .flatMap((s) => (s.proposed_calendar ?? []).map((p) => ({ slot: p.slot, run_id: s.run_id })));
}

/** Which weeks hold anything at all, so the stepper cannot walk off into empty ones. */
function populatedWeeks(world: FixtureSet): Set<number> {
  const weeks = new Set<number>();
  for (const slot of world.calendarSlots) weeks.add(weekIndexOf(slot.publish_at));
  for (const { slot } of proposedSlots(world)) weeks.add(weekIndexOf(slot.publish_at));
  return weeks;
}

export function buildWeek(world: FixtureSet, index: number): Week {
  const start = weekStart(index);
  const end = (start + 7 * MINUTES_PER_DAY) as MinutesFromAnchor;
  const inWeek = (at: MinutesFromAnchor) => at >= start && at < end;

  const slots = world.calendarSlots.filter((s) => inWeek(s.publish_at));

  /**
   * A proposed slot only contributes when nothing ratified it. Matching on time and channel: the
   * pair is unique within a week, and both fields are copied verbatim when a slot record is
   * written, so an exact comparison is the right one.
   */
  const unratified = proposedSlots(world).filter(
    ({ slot }) =>
      inWeek(slot.publish_at) &&
      !slots.some((s) => s.publish_at === slot.publish_at && s.channel === slot.channel),
  );

  const entries: WeekEntry[] = [
    ...slots.map((s) => entryFor(world, s.publish_at, s.channel, s.angle, s.pillar_id as string, s)),
    ...unratified.map(({ slot }) =>
      entryFor(world, slot.publish_at, slot.channel, slot.angle, slot.pillar_id as string, null),
    ),
  ].sort((a, b) => (a.publish_at as number) - (b.publish_at as number));

  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const dayStart = (start + i * MINUTES_PER_DAY) as MinutesFromAnchor;
    const dayEnd = (dayStart + MINUTES_PER_DAY) as MinutesFromAnchor;
    return {
      index: i,
      label: weekdayShort(dayStart),
      start: dayStart,
      isToday: NOW >= dayStart && NOW < dayEnd,
      entries: entries.filter((e) => e.publish_at >= dayStart && e.publish_at < dayEnd),
    };
  });

  /**
   * Runs that are about the week rather than about one of its posts: the planning run, the batch
   * parent, the polls. A post-level run is excluded — it is already on screen as its slot, and
   * listing it twice is how the old rail got to thirty-eight rows.
   *
   * THE TEST IS THE RUN'S TARGET, NOT THIS WEEK'S SLOTS. The first version excluded runs whose id
   * appeared among *these* entries, which is subtly wrong and visibly so: a drafting run starts on
   * Wednesday and targets a slot in the week after, so every one of next week's eight drafting runs
   * reappeared under this week's "about the week" group. Ten rows, all of them duplicates of slots
   * one week over. A run that targets a draft or a post belongs to that record, in whichever week
   * the record sits.
   */
  const otherRuns: WeekRun[] = world.runs
    .filter((run) => {
      if (run.target_draft_id !== null || run.target_post_id !== null) return false;
      /** A run with no steps opens onto an empty screen, which reads as broken. */
      if (!world.runSteps.some((s) => s.run_id === run.id)) return false;
      return inWeek(run.started_at);
    })
    .map((run) => ({ run, ...describeRun(world, run) }))
    .sort((a, b) => (b.run.started_at as number) - (a.run.started_at as number));

  const populated = populatedWeeks(world);
  const indices = [...populated];

  return {
    index,
    label: weekLabel(index),
    start,
    days,
    entries,
    otherRuns,
    waitingOnYou: entries.filter((e) => e.state === 'needs_you').length,
    ownerGate: ownerGateFor(world, index),
    hasPrevious: indices.some((i) => i < index),
    hasNext: indices.some((i) => i > index),
  };
}

/**
 * The calendar gate for a week, resolved from the planning run that proposed it.
 *
 * `approved` is not a guess: a planning run that reached `completed` got past its own approval
 * interrupt, and `ended_at` is when that happened. If the run is still `awaiting_human` the gate
 * is live and carries the 48-hour deadline off the interrupt step itself.
 */
function ownerGateFor(world: FixtureSet, index: number): OwnerGate {
  const step = world.runSteps.find(
    (s) =>
      s.proposed_calendar !== null &&
      (s.proposed_calendar ?? []).some((p) => weekIndexOf(p.slot.publish_at) === index),
  );
  if (!step) return { kind: 'none' };

  const run = world.runs.find((r) => r.id === step.run_id);
  if (!run) return { kind: 'none' };

  if (run.state === 'awaiting_human' && step.interrupt) {
    return { kind: 'pending', run_id: run.id, deadline: step.interrupt.deadline };
  }
  if (run.state === 'completed' && run.ended_at !== null) {
    return { kind: 'approved', run_id: run.id, at: run.ended_at };
  }
  return { kind: 'none' };
}

/**
 * The week the operator is working on, which is not the week we are standing in.
 *
 * Wednesday drafts the *following* week, so on any day after that batch the pending decisions all
 * belong to week +1. Opening on week 0 would show a week whose posts have already published and
 * would hide every item waiting on a person. This picks the earliest week that still has something
 * waiting, and falls back to next week when nothing does.
 */
export function defaultWeekIndex(world: FixtureSet): number {
  const candidates = [...populatedWeeks(world)].sort((a, b) => a - b);
  const waiting = candidates.find((i) => buildWeek(world, i).waitingOnYou > 0);
  return waiting ?? (candidates.includes(1) ? 1 : (candidates.at(-1) ?? 0));
}
