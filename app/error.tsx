'use client';

/**
 * ROUTE ERROR BOUNDARY.
 *
 * One uncaught error in a client component blanks an entire App Router route — not a component, the
 * whole page. This build deliberately ships a panel whose purpose is causing failures, so shipping
 * without a boundary would mean an armed switch could produce a white screen with no way back.
 *
 * Distinct from the in-page error state on the console. That one handles a *call* failing, which is
 * expected and recoverable. This one handles a render throwing, which is a bug — so the copy says
 * so rather than pretending it is routine.
 */

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div
        className="rounded border px-4 py-4"
        style={{ borderColor: 'var(--state-blocked)', background: 'var(--state-blocked-bg)' }}
      >
        {/* `.t-title` rather than `.t-section`: this route renders no top bar, so this line is the
            screen name as well as the heading — the one place the title role appears here. */}
        <h1 className="t-title">This screen crashed</h1>
        {/* Cut from three clauses to one. It still says both things that change what the operator
            does — it is a bug, and the state is gone — and an error panel is the last place a
            product should be explaining itself at length. */}
        <p className="t-body mt-1">A bug, not a transient failure. Reloading restarts from the fixtures.</p>
        <p className="t-meta mt-2 font-mono" style={{ color: 'var(--text-muted)' }}>
          {error.message}
          {error.digest ? ` · ${error.digest}` : ''}
        </p>
        <button
          type="button"
          onClick={reset}
          className="t-body mt-3 rounded border px-2.5 py-1 font-medium"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          Try rendering again
        </button>
      </div>
    </div>
  );
}
