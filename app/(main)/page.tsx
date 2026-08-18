/**
 * Placeholder. The console lands here at step 4; this exists so the shell, the palette and the
 * routing can be verified before anything is built on top of them.
 */
export default function ConsolePage() {
  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Console</h1>
        <p className="page-sub">
          The Wednesday batch lands here: eight runs, drafting in parallel, arriving for review as
          they finish.
        </p>
      </header>

      <div className="panel" style={{ padding: '18px 20px' }}>
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>
          Shell and palette only. Nothing is wired to the data layer yet.
        </p>
        <div className="swatches" aria-label="Palette check">
          <span className="sw" style={{ background: 'var(--accent)' }} />
          <span className="sw" style={{ background: 'var(--go)' }} />
          <span className="sw" style={{ background: 'var(--attend)' }} />
          <span className="sw" style={{ background: 'var(--stop)' }} />
          <span className="sw" style={{ background: 'var(--ch-linkedin)' }} />
          <span className="sw" style={{ background: 'var(--ch-x)' }} />
        </div>
        <p className="mono" style={{ margin: '14px 0 0', fontSize: 11.5, color: 'var(--text-faint)' }}>
          accent · go · attend · stop · linkedin · x
        </p>
      </div>
    </>
  );
}
