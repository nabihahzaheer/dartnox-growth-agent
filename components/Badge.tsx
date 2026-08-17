/**
 * BADGE — the single place a record state becomes a colour.
 *
 * D-039 fixes one token per state so a state cannot be styled two ways on two screens. Every badge
 * in the app resolves through this map; adding a state without adding a token is a compile error
 * rather than a grey pill nobody notices.
 */

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
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${mono ? 'font-mono' : ''}`}
      style={{ color: fg, background: bg }}
    >
      {children}
    </span>
  );
}
