/**
 * BADGE — the single place a record state becomes a colour.
 *
 * D-039 fixes one token per state so a state cannot be styled two ways on two screens. Every badge
 * in the app resolves through this map; adding a state without adding a token is a compile error
 * rather than a grey pill nobody notices.
 */

import type { WeekSlotState } from '@/lib/week';

export type BadgeTone = 'running' | 'awaiting' | 'approved' | 'blocked' | 'parked' | 'neutral';

const TONE_VARS: Record<BadgeTone, { fg: string; bg: string }> = {
  running: { fg: 'var(--state-running)', bg: 'var(--state-running-bg)' },
  awaiting: { fg: 'var(--state-awaiting)', bg: 'var(--state-awaiting-bg)' },
  approved: { fg: 'var(--state-approved)', bg: 'var(--state-approved-bg)' },
  blocked: { fg: 'var(--state-blocked)', bg: 'var(--state-blocked-bg)' },
  parked: { fg: 'var(--state-parked)', bg: 'var(--state-parked-bg)' },
  neutral: { fg: 'var(--state-neutral)', bg: 'var(--state-neutral-bg)' },
};

/** Run states map to tones here rather than at each call site, so the console and the queue cannot
 *  disagree about what `parked_transient` looks like. */
export function runStateTone(state: string): BadgeTone {
  if (state === 'running') return 'running';
  if (state === 'awaiting_human') return 'awaiting';
  if (state === 'completed') return 'approved';
  if (state === 'quarantined' || state === 'abandoned') return 'blocked';
  if (state.startsWith('parked')) return 'parked';
  return 'neutral';
}

/**
 * What an operator would call the state, not what the enum calls it.
 *
 * `awaiting_human` is a state name from the state machine. Nobody says that. It lives here rather
 * than in each screen so the rail and the run header cannot end up calling the same state two
 * different things.
 */
export const RUN_STATE_LABEL: Record<string, string> = {
  running: 'Running',
  awaiting_human: 'Needs you',
  parked_transient: 'Parked',
  parked_blocked: 'Blocked',
  quarantined: 'Quarantined',
  completed: 'Done',
  abandoned: 'Halted',
  queued: 'Queued',
};

/**
 * A slot's situation, in the same one-token-per-state discipline.
 *
 * `needs_you` is the only one that gets the awaiting colour, and that is the point: on a week of
 * eight slots the operator should be able to find their own work by colour alone. Everything that
 * has already resolved — published, approved, scheduled — is quiet, and every way a slot can fail
 * shares one colour rather than inviting the reader to learn four.
 */
export function weekSlotTone(state: WeekSlotState): BadgeTone {
  if (state === 'needs_you') return 'awaiting';
  if (state === 'drafting') return 'running';
  if (state === 'published' || state === 'approved' || state === 'scheduled') return 'approved';
  if (state === 'planned') return 'neutral';
  if (state === 'slipped' || state === 'dropped' || state === 'pulled') return 'parked';
  /** blocked · rejected · failed · quarantined. */
  return 'blocked';
}

/** What an operator would say about a slot. `needs_you` is second person on purpose — it is the
 *  one state that is a request rather than a description. */
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

export function guardrailTone(result: string): BadgeTone {
  if (result === 'pass') return 'approved';
  if (result === 'warn') return 'awaiting';
  return 'blocked';
}

export function Badge({
  children,
  tone = 'neutral',
  mono = false,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  mono?: boolean;
}) {
  const { fg, bg } = TONE_VARS[tone];
  return (
    <span
      /** `.t-meta` for the size and `color` below for the tone — the class supplies `--text-faint`
       *  and the inline style overrides it, which is the one place in the app that is deliberate: a
       *  badge's whole job is to carry a state colour. */
      className={`inline-flex items-center rounded px-1.5 py-0.5 t-meta font-medium ${mono ? 'font-mono' : ''}`}
      style={{ color: fg, background: bg }}
    >
      {children}
    </span>
  );
}
