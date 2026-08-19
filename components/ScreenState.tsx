'use client';

/**
 * LOADING, EMPTY AND ERROR — the three states every screen owes, in one place.
 *
 * The brief names these as a constraint rather than a nicety, and D-002's whole argument for the
 * `agentClient` seam is that they can be *honest* here: the data really does arrive late, and a call
 * really can fail, so none of the three has to be faked locally.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THE AUDIT FOUND, SINCE THIS FILE IS THE ANSWER TO IT
 *
 * All six rebuilt screens had all three states, which is why nothing looked wrong. Two things were
 * wrong anyway:
 *
 *   Every screen collapsed the seven-kind error taxonomy into one sentence — "Could not reach the
 *   agent. Nothing has been lost — try again." D-031 argues the kinds are seven *because the copy
 *   differs*, and v1 had already been fixed for precisely this (see `lib/errorCopy.ts`). The rebuild
 *   reintroduced it on all six screens.
 *
 *   `not_found` was rendered as a transport failure on the console, contradicting D-031's own table
 *   — it is an empty state, not an error. `app/(main)/approvals/[id]` got this right and the console
 *   did not, so two screens in one interface disagreed about what a missing record means.
 *
 * The panels below are the rebuild's own markup against `:root` tokens. Only the *words* come from
 * `lib/errorCopy.ts`, which both interfaces share — the same split HANDOVER §4 records for
 * `WEEK_SLOT_LABEL`: a plain string map is safe to share, a component that renders through
 * `[data-ui='v1']`-scoped custom properties is not.
 */

import type { ConsoleError } from '@/lib/types';
import { errorCopy } from '@/lib/errorCopy';

/**
 * A failed load.
 *
 * `role="alert"` because this replaces content the operator asked for, and a screen reader user who
 * triggered a navigation should be told it failed rather than finding an empty region.
 *
 * The kind is printed underneath in monospace. That is not decoration: an operator reading a fault
 * out to somebody else needs the name and not only the sentence, and it is the cheapest available
 * proof that the taxonomy is real rather than a table in a document. Same reasoning v1 records on
 * its own panel.
 */
export function LoadError({
  error,
  onRetry,
}: {
  error: ConsoleError;
  onRetry?: () => void;
}) {
  return (
    <div className="panel state-panel" role="alert">
      <p className="state-title">{errorCopy(error)}</p>
      <p className="state-kind mono">{error.kind}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * A refresh that failed while the screen already has data.
 *
 * Every screen subscribes to `subscribeToWorld` and reloads on any write, and every screen gated its
 * whole render on `error`. So a background refresh that failed replaced a working screen — batch
 * panel, cards, live region and all — with a retry panel. Reachable with the shipped demo control:
 * arm "Break the next read", approve a draft, and the write lands while the reload that follows it
 * destroys the page reporting the result.
 *
 * The detail page already argued this distinction for *writes* ("a read failing has nothing to show
 * and earns the whole screen; a write failing has the whole screen still valid behind it"). It is
 * the same argument for a *re*-read: the first load has nothing to show, a later one does.
 */
export function StaleWarning({ error, onRetry }: { error: ConsoleError; onRetry: () => void }) {
  return (
    <div className="stale-warn" role="alert">
      <span>{errorCopy(error)} Showing the last known state.</span>
      <button type="button" className="btn btn-sm" onClick={onRetry}>
        Refresh
      </button>
    </div>
  );
}

/**
 * Nothing here, and nothing is wrong.
 *
 * Deliberately the same neutral panel as the loading state rather than the error one. An empty queue
 * is the system working, and `not_found` belongs in this category too (D-031).
 */
export function EmptyState({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="panel state-panel">
      <p className="state-title">{title}</p>
      {detail && <p className="state-sub">{detail}</p>}
      {children}
    </div>
  );
}

/**
 * First paint, before the first read returns.
 *
 * `lines` rather than a fixed pair so a screen can roughly match its own shape — a settings page of
 * stacked panels is not the same silhouette as a three-column tile grid, and a skeleton that
 * resembles nothing on the page is just a grey bar.
 *
 * `aria-busy` and the label give a screen reader something better than silence; the bars themselves
 * are `aria-hidden` because reading "loading loading loading" is worse than reading it once.
 */
export function LoadingState({ lines = 2, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div className="panel state-panel" aria-busy="true" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <p key={i} className={`skeleton${i === lines - 1 ? ' short' : ''}`} aria-hidden />
      ))}
    </div>
  );
}
