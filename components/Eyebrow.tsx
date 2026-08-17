/**
 * EYEBROW — the assignment PDF's section marker, as a component.
 *
 * A blue square followed by a Courier-Bold capitalised label in the same blue. It is the pattern
 * that opens every section of the assessment document and of the PRD, so using it here means the
 * product, the PRD and the brief share one visual vocabulary rather than three.
 *
 * Reserved for *section* labels. Field labels inside an expanded step use the same Courier caps in
 * grey with no square, which is exactly how the document distinguishes a section eyebrow from a
 * table header. Putting a square on everything would flatten that hierarchy back out.
 *
 * The square is 8x8 in the PDF against 24pt type; scaled to 7px here against 11px type, keeping
 * the proportion rather than the measurement.
 */

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="inline-block h-[7px] w-[7px] shrink-0"
        style={{ background: 'var(--accent)' }}
      />
      <span
        className="font-mono text-[11px] font-bold uppercase"
        style={{ color: 'var(--accent-text)', letterSpacing: '0.1em' }}
      >
        {children}
      </span>
    </div>
  );
}

/**
 * The document's green callout — the block it reserves for the thing you must not miss. Kept for
 * the same job here rather than reused as a general panel, or it stops meaning anything.
 */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded px-3 py-2 text-[13px] font-medium"
      style={{ background: 'var(--note-bg)', color: 'var(--note-ink)' }}
    >
      {children}
    </div>
  );
}
