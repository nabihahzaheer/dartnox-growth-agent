'use client';

/**
 * ONE METRIC TILE, AND ONE ALARM CELL.
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
 * `Alarm` reuses `withinRange` for exactly that reason: promoting three metrics into their own band
 * must not fork the rule, or the band becomes the one place a thin sample can turn red.
 */

import { Badge } from '@/components/Badge';
import type { MetricDescriptor, MetricResult } from '@/lib/types';

function format(value: number, unit: string): string {
  if (unit === '%') return `${value.toFixed(0)}%`;
  if (unit === 'USD') return `$${value.toFixed(2)}`;
  if (unit === 'seconds') return value < 90 ? `${Math.round(value)}s` : `${(value / 60).toFixed(1)}m`;
  if (unit === 'hours') return `${value.toFixed(1)}h`;
  if (unit === 'x baseline') return `${value.toFixed(2)}×`;
  return value.toFixed(0);
}

/**
 * The unit suffix a *threshold* carries, which is not the same as formatting a value.
 *
 * `format` is wrong for a band: it would render the 48-hour ceiling as "48.0h" and the 120-second
 * one as "2.0m", so the band would stop matching the number written in the descriptor. A reader
 * checking the screen against the PRD has to see the same figure in both.
 */
/**
 * The lead sentence of a steering note.
 *
 * Splits on a full stop followed by a space, so the decimals and percentages these strings contain
 * ("40%.", "63%") cannot cut one short. Falls back to the whole string when there is no break,
 * which is the case for the three shortest descriptors.
 */
function firstSentence(text: string): string {
  const end = text.indexOf('. ');
  return end === -1 ? text : text.slice(0, end + 1);
}

function suffix(unit: string): string {
  if (unit === '%') return '%';
  if (unit === 'hours') return 'h';
  if (unit === 'seconds') return 's';
  return '';
}

/**
 * A bound as a reader would write it. Descriptor bounds are whole numbers and must print as
 * "20", not "20.0"; a *derived* bound is a float and must not print as "3.4615384615384617",
 * which is what shipped the first time a derived band reached this function.
 */
const bound = (n: number): string => (Number.isInteger(n) ? `${n}` : n.toFixed(1));

/** "≤ 20%", "15–120s", or null where the descriptor states no band. */
function bandText(range: MetricDescriptor['healthy_range'], unit: string): string | null {
  const u = suffix(unit);
  if (range.min !== null && range.max !== null)
    return `${bound(range.min)}–${bound(range.max)}${u}`;
  if (range.min !== null) return `≥ ${bound(range.min)}${u}`;
  if (range.max !== null) return `≤ ${bound(range.max)}${u}`;
  return null;
}

/** Only an `ok` value can be out of range. That is the point of the discriminated result. */
function withinRange(value: number, range: MetricDescriptor['healthy_range']): boolean | null {
  if (range.min === null && range.max === null) return null;
  if (range.min !== null && value < range.min) return false;
  if (range.max !== null && value > range.max) return false;
  return true;
}

/**
 * ONE ALARM.
 *
 * The three alarms are the signals that say the system has broken quietly — a guardrail that
 * stopped blocking, a reviewer who stopped reading, a queue nobody is clearing. They render as
 * instrument faces rather than as cards because an operator scans this band first and the grid
 * second, and three identical cards among a dozen cannot carry that ordering.
 *
 * FIRING IS NEVER CONVEYED BY COLOUR ALONE. The status badge carries the word, the tint is
 * secondary. That is not only accessibility: a red cell with no word is ambiguous between "this is
 * bad" and "this is the metric that goes red", which is the reading an alarm cannot afford.
 *
 * WHY `band` IS A PROP AND NOT `descriptor.healthy_range`. Two of the three carry an absolute
 * ceiling on the descriptor. The guardrail one deliberately carries none — there is no correct
 * absolute block rate — so its band is derived by the caller and passed in. Hardcoding the derived
 * floor here would put a threshold in a presentational component, which is the thing the descriptor
 * file exists to prevent.
 */
export function Alarm({
  descriptor,
  result,
  band,
  meta,
}: {
  descriptor: MetricDescriptor;
  result: MetricResult<number>;
  /** Usually `descriptor.healthy_range`; derived by the caller where the descriptor has none. */
  band: MetricDescriptor['healthy_range'];
  /** Window and band provenance — "7d vs 4w", "4w". Labels only, never a sentence. */
  meta?: string;
}) {
  const within = result.kind === 'ok' ? withinRange(result.value, band) : null;
  /**
   * Only `ok` can fire. `no_data`, `not_applicable` and `establishing_baseline` are three different
   * kinds of nothing and none of them is a broken system — an alarm that reddens on an empty
   * window trains the operator to ignore the band, which costs more than the alarm ever earns.
   */
  const firing = within === false;

  const status =
    result.kind === 'ok'
      ? within === false
        ? 'Firing'
        : within === true
          ? 'Clear'
          : /** No band to judge against. Not the same as clear, and saying "clear" would be a lie. */
            'No band'
      : result.kind === 'no_data'
        ? 'No data'
        : result.kind === 'not_applicable'
          ? 'n/a'
          : 'Baseline';

  const threshold = [bandText(band, descriptor.unit), meta].filter(Boolean).join(' · ');

  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5"
      style={{ background: firing ? 'var(--state-blocked-bg)' : 'var(--surface-sunk)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        {/* The FIELD role: a mono-caps label naming the value under it. Not a heading — the band's
            heading is the `.t-section` above, and using the same treatment for both is what made
            headings and labels indistinguishable before the type scale existed. */}
        <span className="t-field">{descriptor.label}</span>
        <Badge tone={firing ? 'blocked' : 'neutral'}>{status}</Badge>
      </div>

      <div className="flex items-baseline gap-2">
        {result.kind === 'ok' ? (
          <>
            <span
              className="t-metric"
              style={{ color: firing ? 'var(--state-blocked)' : 'var(--text)' }}
            >
              {format(result.value, descriptor.unit)}
            </span>
            <span className="t-meta tabular font-mono">n={result.sample_n}</span>
          </>
        ) : (
          /* The descriptor's own empty state, at body size rather than metric size — a sentence set
             in 24px semibold reads as a value and this is the absence of one. */
          <span className="t-body" style={{ color: 'var(--text-muted)' }}>
            {result.kind === 'not_applicable'
              ? result.reason
              : result.kind === 'establishing_baseline'
                ? `Establishing — ${result.weeks_elapsed} of ${result.weeks_required} weeks`
                : descriptor.empty_state.copy}
          </span>
        )}
      </div>

      {threshold && <span className="t-meta tabular">{threshold}</span>}
    </div>
  );
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
  const band = bandText(descriptor.healthy_range, descriptor.unit);

  return (
    <div
      className="rounded border px-3 py-2.5"
      style={{
        borderColor: healthy === false ? 'var(--state-awaiting)' : 'var(--border)',
        background: 'var(--surface)',
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label">{descriptor.label}</span>
        {band && <span className="t-meta tabular font-mono">{band}</span>}
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        {result.kind === 'ok' ? (
          <>
            <span
              className="t-metric"
              style={{ color: healthy === false ? 'var(--state-awaiting)' : 'var(--text)' }}
            >
              {format(result.value, descriptor.unit)}
            </span>
            {/*
              Three of these stay statistically thin at eight posts a week. A tile that cannot say
              "over 4 samples" invites the reader to over-read it — and that thinness is true in
              production at this contracted volume, not a fixture artifact.
            */}
            <span className="t-meta tabular font-mono">n={result.sample_n}</span>
          </>
        ) : (
          <span className="t-body" style={{ color: 'var(--text-muted)' }}>
            {result.kind === 'not_applicable'
              ? result.reason
              : result.kind === 'establishing_baseline'
                ? `Establishing — ${result.weeks_elapsed} of ${result.weeks_required} weeks`
                : descriptor.empty_state.copy}
          </span>
        )}
      </div>

      {note && <p className="t-meta mt-1">{note}</p>}

      {/* A metric with no stated response is a dashboard, not steering (A-17). Shown only once the
          value has actually left its band, so the screen is not a wall of advice.

          THE FIRST SENTENCE ONLY, WITH THE REST ON HOVER. The descriptors carry 20–45 words each,
          and rendering all of them put a paragraph inside a tile — the one thing on this screen that
          still read as an essay rather than as an instrument. Every one of these strings leads with
          its own conclusion ("Read the slip reasons.", "The review gate has become theatre.", "The
          human is the bottleneck, not the agent."), so the first sentence is the steer and the rest
          is the reasoning behind it. The reasoning is kept, not cut: it is on the `title` and it is
          in the PRD, which is where somebody reads an argument.

          Deliberately NOT rendered in the alarm band at all: an alarm row is name, value, threshold
          and firing-or-not. */}
      {healthy === false && (
        <p className="t-label mt-1.5" title={descriptor.action_when_outside}>
          {firstSentence(descriptor.action_when_outside)}
        </p>
      )}

      {onDrillDown && (
        <button
          type="button"
          onClick={onDrillDown}
          className="t-label mt-2 rounded"
          style={{ color: 'var(--accent-text)' }}
        >
          Break it down →
        </button>
      )}
    </div>
  );
}
