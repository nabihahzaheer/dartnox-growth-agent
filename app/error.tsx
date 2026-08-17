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
        <h1 className="text-sm font-semibold">This screen crashed</h1>
        <p className="mt-1 text-[13px]">
          Something threw while rendering. That is a bug rather than a transient failure, and the
          state on this screen is gone — reloading starts from the fixture data again.
        </p>
        <p className="mt-2 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {error.message}
          {error.digest ? ` · ${error.digest}` : ''}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-3 rounded border px-2.5 py-1 text-sm font-medium"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          Try rendering again
        </button>
      </div>
    </div>
  );
}
