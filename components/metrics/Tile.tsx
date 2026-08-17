'use client';

/**
 * ONE METRIC TILE.
 *
 * Renders a `MetricResult` against its descriptor, and the four result kinds are the whole reason
 * this component is not three lines. A-17 insists the flavours of nothing are not interchangeable:
 *
 *   ok                     the value, with the sample size it came from
 *   no_data                the descriptor's own empty-state copy. Never red
 *   not_applicable         auto-approve rate in v1: zero is correct and intended. Never red
 *   establishing_baseline  "2 of 4 weeks" — the question cannot be answered yet
 *
 * The rule that n=0 never renders as red lives here, once, rather than as a per-tile hardcode.
 */

import type { MetricDescriptor, MetricResult } from '@/lib/types';

function format(value: number, unit: string): string {
  if (unit === '%') return `${value.toFixed(0)}%`;
  if (unit === 'USD') return `$${value.toFixed(2)}`;
  if (unit === 'seconds') return value < 90 ? `${Math.round(value)}s` : `${(value / 60).toFixed(1)}m`;
  if (unit === 'hours') return `${value.toFixed(1)}h`;
  if (unit === 'x baseline') return `${value.toFixed(2)}×`;
  return value.toFixed(0);
}

/** Only an `ok` value can be out of range. That is the point of the discriminated result. */
function withinRange(value: number, range: MetricDescriptor['healthy_range']): boolean | null {
  if (range.min === null && range.max === null) return null;
  if (range.min !== null && value < range.min) return false;
  if (range.max !== null && value > range.max) return false;
  return true;
}

export function Tile({
  descriptor,
  result,
  note,
  onDrillDown,
}: {
  descriptor: MetricDescriptor;
  result: MetricResult<number>;
  /** Extra context the descriptor cannot know — a derived band, a channel name. */
  note?: string;
  onDrillDown?: () => void;
}) {
  const healthy = result.kind === 'ok' ? withinRange(result.value, descriptor.healthy_range) : null;

  const band =
    descriptor.healthy_range.min !== null && descriptor.healthy_range.max !== null
      ? `${descriptor.healthy_range.min}–${descriptor.healthy_range.max}`
      : descriptor.healthy_range.min !== null
        ? `≥ ${descriptor.healthy_range.min}`
        : descriptor.healthy_range.max !== null
          ? `≤ ${descriptor.healthy_range.max}`
          : null;

  return (
    <div
      className="rounded border px-3 py-2.5"
      style={{
        borderColor: healthy === false ? 'var(--state-awaiting)' : 'var(--border)',
        background: 'var(--surface)',
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {descriptor.label}
        </span>
        {band && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
            {band}
            {descriptor.unit === '%' ? '%' : ''}
          </span>
        )}
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        {result.kind === 'ok' ? (
          <>
            <span
              className="text-xl font-bold"
              style={{ color: healthy === false ? 'var(--state-awaiting)' : 'var(--text)' }}
            >
              {format(result.value, descriptor.unit)}
            </span>
            {/*
              Three of these stay statistically thin at eight posts a week. A tile that cannot say
              "over 4 samples" invites the reader to over-read it — and that thinness is true in
              production at this contracted volume, not a fixture artifact.
            */}
            <span className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
              n={result.sample_n}
            </span>
          </>
        ) : (
          <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {result.kind === 'not_applicable'
              ? result.reason
              : result.kind === 'establishing_baseline'
                ? `Establishing — ${result.weeks_elapsed} of ${result.weeks_required} weeks`
                : descriptor.empty_state.copy}
          </span>
        )}
      </div>

      {note && (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          {note}
        </p>
      )}

      {/* A metric with no stated response is a dashboard, not steering. Shown only once the value
          has actually left its band, so the screen is not a wall of advice. */}
      {healthy === false && (
        <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {descriptor.action_when_outside}
        </p>
      )}

      {onDrillDown && (
        <button
          type="button"
          onClick={onDrillDown}
          className="mt-2 text-[11px]"
          style={{ color: 'var(--accent-text)' }}
        >
          Break it down →
        </button>
      )}
    </div>
  );
}
