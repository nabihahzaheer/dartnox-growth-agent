'use client';

/**
 * ERROR AND EMPTY STATES — one copy map, one panel, five screens.
 *
 * The brief names loading, empty and error states as a constraint rather than a nicety, so they get
 * a pass of their own rather than being whatever each screen happened to grow.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL: THE COPY MAP WAS WRITTEN THREE TIMES
 *
 * The console, the queue and the settings screen each declared their own
 * `Record<ConsoleError['kind'], string>`. Three copies of the same seven sentences, drifting
 * independently — and the metrics screen had none of them, rendering every failure as the single
 * line "Could not load metrics."
 *
 * That is precisely the stale-duplicate failure D-028 exists to prevent, and the reason it matters
 * more here than in most places is D-031's argument for the taxonomy: **there are seven kinds
 * because the copy differs per kind.** Seven kinds collapsed to one sentence on one screen makes
 * that argument false wherever a reviewer happens to look. Same fact in three files means two of
 * them go stale.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY `not_found` IS NOT IN THE MAP
 *
 * D-031's own table says `not_found` renders as "an empty state, not an error", and then the draft
 * screen rendered it in a red panel with a blocked-state border. A draft that does not exist is not
 * a fault — nothing broke, nothing needs retrying, and colouring it as a failure tells the operator
 * to worry about the wrong thing.
 *
 * So it is deliberately absent here and callers handle it with `<NotFound>` below. Leaving it in
 * the map is what let it be styled as an error for three screens without anyone noticing.
 */

import Link from 'next/link';
import type { ConsoleError } from '@/lib/types';

/** The six failure kinds, and their copy. `not_found` is not a failure — see the header. */
export type FailureKind = Exclude<ConsoleError['kind'], 'not_found'>;

/**
 * One sentence per kind, and the differences between them are the whole justification for having
 * seven kinds rather than one. Two are worth reading closely:
 *
 *   `unavailable` says the failure is transient and invites a retry.
 *   `timeout` refuses to say that, because a timed-out *write* may have landed. The console tells
 *   the operator it does not know rather than retrying and risking a double approval (A-06).
 */
export const ERROR_COPY: Record<FailureKind, string> = {
  version_conflict: 'This changed while you had it open. Reload before deciding.',
  guardrail_block: 'A guardrail blocked that.',
  forbidden: 'That control is fixed and cannot be changed.',
  rate_limited: 'Too many requests. Try again shortly.',
  unavailable: 'Could not reach the agent runtime. This is usually transient.',
  timeout: 'Timed out, so we do not know whether it landed. Reload before retrying.',
};

/**
 * Per-screen wording for the one kind whose sentence is genuinely about the screen rather than
 * about the failure. Everything else is identical wherever it appears, which is why it is central.
 */
export function errorCopy(error: ConsoleError, notFoundCopy = 'That no longer exists.'): string {
  return error.kind === 'not_found' ? notFoundCopy : ERROR_COPY[error.kind];
}

/**
 * The failure panel.
 *
 * `onRetry` is optional but every current caller passes one, and that is a change from before: the
 * draft screen offered a link back to the queue and no way to try again, so a transient failure on
 * that route was unrecoverable without the browser's own reload button.
 */
export function ErrorPanel({
  error,
  onRetry,
  retryLabel = 'Reload',
  notFoundCopy,
  children,
}: {
  error: ConsoleError;
  onRetry?: () => void;
  retryLabel?: string;
  notFoundCopy?: string;
  /** Extra recovery specific to the screen — a link back, usually. */
  children?: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      className="rounded border px-3 py-2.5"
      style={{ borderColor: 'var(--state-blocked)', background: 'var(--state-blocked-bg)' }}
    >
      <p className="t-body font-medium">{errorCopy(error, notFoundCopy)}</p>
      {/* The kind itself, in monospace. An operator reading a trace to someone else needs the name,
          not only the sentence — and it is the cheapest possible proof that the taxonomy is real
          rather than decorative.

          `.t-meta`, not `.t-field`. It was 10px mono caps, which is the FIELD treatment, and FIELD
          labels a value rather than being one — this line IS the value. Dropping the caps also
          stops it misreporting the name: the kind is `version_conflict`, and an operator reading it
          out or grepping for it needs the string the code actually uses. */}
      <p className="t-meta mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>
        {error.kind}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="t-body rounded border px-2.5 py-1 font-medium"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            {retryLabel}
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * Nothing here, and that is not a fault.
 *
 * Deliberately neutral rather than red. D-031 puts `not_found` in this category, and so does an
 * ordinary empty collection — a queue with nothing waiting is the system working.
 */
export function NotFound({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="py-10 text-center">
      {/* `.t-section`: an empty state has one heading and this is it. It was 13px medium, the same
          treatment as the sentence beneath it, so the block had no top. */}
      <p className="t-section">{title}</p>
      {detail && <p className="t-label mx-auto mt-1 max-w-sm">{detail}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** A back-link, used by the two screens you can arrive at directly with a bad id. */
export function BackToQueue() {
  return (
    <Link href="/queue" className="t-body" style={{ color: 'var(--accent-text)' }}>
      Back to the queue
    </Link>
  );
}
