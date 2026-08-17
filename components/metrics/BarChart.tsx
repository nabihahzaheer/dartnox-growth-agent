'use client';

/**
 * BAR CHART — hand-written SVG, no library (D-038).
 *
 * A bar chart is an axis scale and a `<rect>` per datum. A charting library's value is in the parts
 * this screen does not use, and it would be the one dependency in the repository whose internals
 * could not be explained on request — the same argument that rejected shadcn/ui and Zustand.
 *
 * The click target is as much the reason as the size. The brief's required drill-down is a click on
 * a bar, which is trivial on a `<rect>` you wrote and genuinely awkward through a library's
 * synthetic event layer.
 */

export type Bar = { id: string; label: string; value: number; caption?: string };

export function BarChart({
  bars,
  unit = '%',
  max,
  selectedId,
  onSelect,
}: {
  bars: Bar[];
  unit?: string;
  /** Fixed ceiling where one exists — a percentage axis that rescales to its own data makes two
   *  charts on the same screen incomparable. */
  max?: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const ceiling = max ?? Math.max(10, ...bars.map((b) => b.value)) * 1.15;

  return (
    <div className="space-y-2">
      {bars.map((bar) => {
        const width = Math.max(1, (bar.value / ceiling) * 100);
        const selected = bar.id === selectedId;

        const content = (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="t-label">{bar.label}</span>
              {/* `.tabular` because these are a column: without it the value column shifts sideways
                  as digits change width, and a chart whose labels move reads as unstable data. */}
              <span className="t-body tabular font-mono">
                {bar.value.toFixed(0)}
                {unit}
              </span>
            </div>
            <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="mt-0.5 h-1.5 w-full">
              <rect x="0" y="0" width="100" height="6" fill="var(--surface-sunk)" />
              <rect
                x="0"
                y="0"
                width={width}
                height="6"
                fill={selected ? 'var(--accent-text)' : 'var(--accent)'}
              />
            </svg>
            {bar.caption && <div className="t-meta tabular mt-0.5">{bar.caption}</div>}
          </>
        );

        /* `aria-pressed` because selection was previously carried by the bar's fill alone, which is
           invisible to a screen reader and to anyone who cannot separate the two blues. The button
           was already a real `<button>`, so the focus ring and keyboard activation come free — the
           only thing missing was the state. */
        return onSelect ? (
          <button
            key={bar.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(bar.id)}
            className="block w-full rounded text-left"
          >
            {content}
          </button>
        ) : (
          <div key={bar.id}>{content}</div>
        );
      })}
    </div>
  );
}
