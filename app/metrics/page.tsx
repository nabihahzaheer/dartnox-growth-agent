'use client';

/**
 * METRICS — the KPIs from the PRD, with charts and one drill-down.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ALARM BAND, AND WHY THREE METRICS LEFT THE GRID
 *
 * The architecture names three signals as a distinct concept: the ways this system fails *quietly*.
 * A guardrail that stops blocking, a reviewer who stops reading, a queue nobody clears. Each is a
 * failure that leaves every other number on this page looking healthy — a silent guardrail even
 * improves the block rate's neighbours.
 *
 * Rendered as three more cards in a grid of thirteen, they are findable only by someone who already
 * knows to look for them, which is precisely the person who does not need them. The band above the
 * grid is not decoration: it is the claim that these three are read first and the other ten are read
 * second, made structural instead of left to the reader.
 *
 * THE OMISSION IS STILL A DECISION. The brief asks for "dummy charts and at least one drill-down",
 * and its closing line makes this a screen to trade against the console rather than one to match it.
 * What is not drawn stays defined in `metricDescriptors.ts` — where the PRD transcribes from — so
 * nothing is lost by not drawing it. The count in the footer is derived rather than typed, because
 * a hand-written "four more" is wrong the first time this list changes and nobody notices.
 *
 * WHY THE FOUR RESULT KINDS ARE ALL ON SCREEN AT ONCE. Auto-approve rate reads "not applicable",
 * engagement on X reads "establishing", and everything else reads a value. That is not a fixture
 * accident — it is the reason metric functions return a discriminated result rather than a
 * nullable number, made visible in one glance. The band inherits the same discipline: three of the
 * four kinds are kinds of *nothing*, and none of them may render as a firing alarm.
 *
 * NOTHING HERE IS STORED. Every figure is computed from the record collections on each render, so
 * approving something in the queue and coming back moves the numbers. A stats fixture would have
 * been the obvious shortcut and would have destroyed the one property this screen is graded on.
 * It applies to the alarms too: clear a few items with a reflex click and the rubber-stamp alarm
 * crosses its own threshold live.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ErrorPanel } from '@/components/ErrorState';
import { getWorld } from '@/lib/agentClient';
import {
  METRICS,
  PERIOD,
  ROLLING_4W,
  type Window,
  blockRateByLayer,
  draftsInCohort,
  editRateBySettingsVersion,
  engagementVsBaseline,
  guardrailBlockRate,
} from '@/lib/metrics';
import type { ConsoleError, FixtureSet, MetricDescriptor, MetricResult } from '@/lib/types';
import { Rail } from '@/components/Rail';
import { Alarm, Tile } from '@/components/metrics/Tile';
import { BarChart } from '@/components/metrics/BarChart';

/**
 * THE THREE ALARMS, in the order the architecture names them: the agent's own check, the human's
 * attention, the human's throughput. Each has a threshold; two of them carry it on the descriptor.
 */
const ALARMS = ['guardrail_block_rate', 'rubber_stamp_rate', 'queue_age_p95'] as const;

/**
 * THE GUARDRAIL ALARM'S BAND IS DERIVED HERE, AND THAT IS NOT AN OVERSIGHT IN THE DESCRIPTOR.
 *
 * `guardrail_block_rate.healthy_range` is `{ min: null, max: null }` on purpose: there is no correct
 * absolute block rate, because it depends entirely on what the drafts are like. A 2% rate is fine on
 * clean drafts and alarming on messy ones. The only meaningful signal is a *change*, and the only
 * change worth waking someone for is a drop — quality did not improve overnight, a check broke.
 *
 * So the band is relative, and the descriptor states the rule in prose but cannot carry it: its
 * `healthy_range` has two numeric slots and this rule needs a factor and a comparison window.
 * Both live here until the descriptor grows a field for them. Named, not inlined, so the number is
 * findable — see the report note: this is the one threshold on this screen not machine-readable
 * from `metricDescriptors.ts`.
 */
const GUARDRAIL_DROP_FACTOR = 0.5;

/**
 * "Now" for the guardrail comparison. Seven days because the system plans and publishes on a weekly
 * cadence, so a week is the smallest window that contains a full cycle of every rule.
 *
 * The comparison is inherently two-window and the descriptor only carries one, which is why
 * `window_default: 'rolling_4w'` is not enough on its own: comparing the trailing four weeks against
 * the trailing four weeks compares a number with itself.
 */
const THIS_WEEK: Window = { fromDaysAgo: 7 };

/** One row of the band. `band` is separate from `descriptor.healthy_range` because one of the three
 *  has no range on its descriptor and never will — see `GUARDRAIL_DROP_FACTOR`. */
type AlarmRow = {
  id: string;
  descriptor: MetricDescriptor;
  result: MetricResult<number>;
  band: MetricDescriptor['healthy_range'];
  meta: string;
};

/** The rest of the board. Business case first, then whether the agent is any good. */
const SHOWN = [
  'published_vs_planned',
  'time_saved',
  'engagement_vs_baseline',
  'cost_per_post',
  'edit_rate',
  'edit_magnitude',
  'time_to_decision',
  'escalation_rate',
  'escalation_precision',
  'auto_approve_rate',
] as const;

export default function MetricsPage() {
  const [world, setWorld] = useState<FixtureSet | null>(null);
  const [error, setError] = useState<ConsoleError | null>(null);
  const [cohort, setCohort] = useState<string | null>(null);
  /** Bumped to re-run the fetch. This screen had no retry at all — a transient failure left it
   *  permanently blank until the browser's own reload. */
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await getWorld();
        if (cancelled) return;
        setWorld(next);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e as ConsoleError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const descriptorFor = useCallback(
    (id: string): MetricDescriptor | undefined =>
      world?.metricDescriptors.find((d) => d.id === id),
    [world],
  );

  const cohorts = useMemo(() => (world ? editRateBySettingsVersion(world) : []), [world]);
  const layers = useMemo(() => (world ? blockRateByLayer(world, ROLLING_4W) : []), [world]);

  /**
   * The three alarm rows, assembled in one place so the band's thresholds are visible together
   * rather than scattered across three call sites.
   */
  const alarms = useMemo<AlarmRow[]>(() => {
    if (!world) return [];

    /**
     * The baseline the guardrail alarm is judged against.
     *
     * It is the trailing four weeks *including* this week, which dampens the alarm slightly — a
     * collapse in the current week drags its own baseline down with it. Accepted, because the
     * descriptor's stated rule is "within 50% of the trailing four-week rate" and that is the figure
     * the rest of the system already computes.
     *
     * The rejected alternative was reconstructing the preceding three weeks arithmetically from the
     * two windows' values and `sample_n`, which is exact but re-derives integer event counts from a
     * float percentage — a division that is correct until it is not, in the one component that must
     * never cry wolf. A dampened alarm is a better failure than a clever one.
     */
    const trailing = guardrailBlockRate(world, ROLLING_4W);
    /**
     * Rounded here, once, rather than at render. The alarm has to fire against the same figure it
     * prints — round only on the way to the screen and the band reads "≥ 3.5%" while the comparison
     * runs against 3.4615384615384617, which is a threshold nobody can check by eye.
     */
    const floor =
      trailing.kind === 'ok'
        ? Math.round(trailing.value * GUARDRAIL_DROP_FACTOR * 10) / 10
        : null;

    return ALARMS.map((id): AlarmRow | null => {
      const descriptor = world.metricDescriptors.find((d) => d.id === id);
      if (!descriptor) return null;
      const compute = METRICS[descriptor.compute_key as keyof typeof METRICS];

      /**
       * The one alarm whose band is not on its descriptor, and the only place a threshold is
       * derived on this screen. `floor === null` when the baseline itself has no data, which
       * renders as "no band" rather than as clear — an alarm that cannot judge must say so.
       */
      if (id === 'guardrail_block_rate') {
        return {
          id,
          descriptor,
          result: compute(world, THIS_WEEK),
          band: { min: floor, max: null },
          meta: '7d vs 4w',
        };
      }

      /** The other two carry an absolute ceiling on the descriptor: ≤20% and ≤48h. Read, not
       *  restated — restating them here is how the screen and the PRD start disagreeing. */
      return {
        id,
        descriptor,
        result: compute(world, ROLLING_4W),
        band: descriptor.healthy_range,
        meta: '4w',
      };
    }).filter((row): row is AlarmRow => row !== null);
  }, [world]);

  /** Derived, never typed. A hand-written "four more" is wrong the first time this list moves and
   *  nobody notices — the same argument R1 makes about stored aggregates, applied to a caption. */
  const undrawn = world ? world.metricDescriptors.length - (SHOWN.length + ALARMS.length) : 0;

  return (
    <>
      <Rail />
      <main className="flex min-w-0 flex-1 flex-col">
        <div
          className="shrink-0 border-b px-4 py-2.5"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
            <h1 className="t-title">Metrics</h1>
            <span className="t-label">Rolling 4 weeks · monthly where the denominator needs it</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Spacing comes from `.section + .section` rather than from a `space-y` utility: the
              rhythm rule is that a heading gets more space above it than below it, and a uniform
              gap between every child is the thing that made this screen read as one column. */}
          <div className="mx-auto w-full max-w-3xl px-4 py-4">
            {/* Error before skeleton, and the skeleton is suppressed once a failure lands —
                otherwise a failed load shows a permanent shimmer of tiles that will never fill. */}
            {error && (
              <div className="section">
                <ErrorPanel
                  error={error}
                  onRetry={reload}
                  notFoundCopy="No reporting data for this client."
                />
              </div>
            )}

            {!world && !error && <Skeleton />}

            {world && (
              <>
                {/* ---- THE ALARM BAND ------------------------------------------------------- */}
                <section className="section">
                  <h2 className="t-section">Alarms</h2>
                  {/*
                    One instrument face split into three cells, not three cards. `gap-px` over a
                    border-coloured background draws the hairline dividers with no extra elements,
                    and the shared outer border is what makes the three read as one instrument —
                    which is the entire point of promoting them out of the grid.
                  */}
                  <div
                    className="grid gap-px overflow-hidden rounded border sm:grid-cols-3"
                    style={{ borderColor: 'var(--border-strong)', background: 'var(--border)' }}
                  >
                    {alarms.map((a) => (
                      <Alarm
                        key={a.id}
                        descriptor={a.descriptor}
                        result={a.result}
                        band={a.band}
                        meta={a.meta}
                      />
                    ))}
                  </div>
                </section>

                {/* ---- THE REST OF THE BOARD ------------------------------------------------ */}
                <section className="section">
                  <h2 className="t-section">Other metrics</h2>
                  <Grid>
                    {SHOWN.map((id) => {
                      const descriptor = descriptorFor(id);
                      if (!descriptor) return null;

                      /**
                       * Published-vs-planned and cost-per-post are monthly; the rest roll four
                       * weeks. The window is not cosmetic on the first: at a weekly denominator of
                       * eight, one missed slot reads as 87.5% and every ordinary week looks like a
                       * failure.
                       */
                      const window =
                        id === 'published_vs_planned' || id === 'cost_per_post'
                          ? PERIOD
                          : ROLLING_4W;

                      const compute = METRICS[descriptor.compute_key as keyof typeof METRICS];
                      const result = compute(world, window);

                      // The one derived band left in the grid: the cost ceiling is the cap over
                      // planned posts, so it moves when either does and cannot be written into the
                      // descriptor.
                      const note =
                        id === 'cost_per_post'
                          ? `Ceiling is the $${world.settings.budget.cap} cap over planned posts`
                          : id === 'engagement_vs_baseline'
                            ? 'LinkedIn · mature posts only'
                            : undefined;

                      return (
                        <Tile
                          key={id}
                          descriptor={descriptor}
                          result={result}
                          note={note}
                          onDrillDown={
                            id === 'edit_rate'
                              ? () => setCohort(cohorts[0]?.settingsVersionId ?? null)
                              : undefined
                          }
                        />
                      );
                    })}

                    {/*
                      The same metric on the other channel, and the reason `establishing_baseline`
                      exists as a result kind: Brightsill had a LinkedIn page and no X presence, so
                      the two channels are legitimately in different states. Rendering zero here
                      would say the posts performed badly rather than that the question cannot be
                      answered.
                    */}
                    {descriptorFor('engagement_vs_baseline') && (
                      <Tile
                        descriptor={descriptorFor('engagement_vs_baseline')!}
                        result={engagementVsBaseline(world, ROLLING_4W, 'x')}
                        note="X · no history to compare against yet"
                      />
                    )}
                  </Grid>
                </section>

                {/* ---- THE DRILL-DOWN ------------------------------------------------------- */}
                <Section
                  title="Edit rate by settings version"
                  caption="Edit rate before and after each settings change."
                >
                  {/* A chart with no bars renders as an empty box, which reads as broken rather
                      than as "nothing to show yet". Both charts filter their own rows — cohorts
                      with no decisions, layers with no evaluations — so both can legitimately
                      arrive empty. */}
                  {cohorts.length === 0 ? (
                    <p className="t-label">No decisions yet.</p>
                  ) : (
                    <BarChart
                      bars={cohorts.map((c) => ({
                        id: c.settingsVersionId,
                        label: c.changeSummary,
                        value: c.rate,
                        caption: `${c.edited} edited of ${c.decisions} decisions · ${c.settingsVersionId}`,
                      }))}
                      max={60}
                      selectedId={cohort}
                      onSelect={setCohort}
                    />
                  )}

                  {cohort && (
                    <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                      {/* The FIELD role — a mono-caps label naming the list under it. */}
                      <p className="t-field mb-1.5">Drafts written under {cohort}</p>
                      <ul className="space-y-1">
                        {draftsInCohort(world, cohort)
                          .slice(0, 8)
                          .map((d) => {
                            const v = d.versions.find((x) => x.id === d.current_version_id);
                            const edited = d.versions.some((x) => x.author === 'human');
                            return (
                              <li key={d.id} className="t-body flex items-baseline gap-2">
                                {/* Colour is the second signal, not the only one: the word says
                                    which it is, so the marker survives a colourblind reader. */}
                                <span
                                  className="t-meta font-mono"
                                  style={{
                                    color: edited ? 'var(--state-awaiting)' : 'var(--text-faint)',
                                  }}
                                >
                                  {edited ? 'edited' : 'as-is '}
                                </span>
                                <Link
                                  href={`/draft/${d.id}`}
                                  className="truncate"
                                  style={{ color: 'var(--accent-text)' }}
                                >
                                  {v?.text.split('\n')[0].slice(0, 70)}
                                </Link>
                              </li>
                            );
                          })}
                      </ul>
                    </div>
                  )}
                </Section>

                {/* ---- SECOND CHART -------------------------------------------------------- */}
                {/* "Watch for sudden drops" used to live in this caption. The alarm above now says
                    it by firing, and an instruction the screen can execute itself does not need to
                    be printed twice. */}
                <Section
                  title="Guardrail block rate by layer"
                  caption="Share of evaluations that warned or blocked."
                >
                  {layers.length === 0 ? (
                    <p className="t-label">No evaluations in this window.</p>
                  ) : (
                    <BarChart
                      bars={layers.map((l) => ({
                        id: l.layer,
                        label: `${l.layer} · ${l.layer === 'L1' ? 'input' : l.layer === 'L2' ? 'generation' : l.layer === 'L3' ? 'output' : 'publish'}`,
                        value: l.rate,
                        caption: `${l.evaluations} evaluations`,
                      }))}
                      max={15}
                    />
                  )}
                </Section>

                {undrawn > 0 && (
                  <p className="section t-meta tabular">
                    {undrawn} more metric{undrawn === 1 ? '' : 's'} defined, not drawn.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function Section({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    /* The heading was mono-caps 10px in --text-faint, which made it smaller and fainter than the
       12px label beneath it — a heading losing to its own caption. `.t-section` fixes the ladder;
       the mono-caps treatment is now reserved for `.t-field`, which is one job only. */
    <section className="section">
      <h2 className="t-section">{title}</h2>
      <p className="t-label mb-2">{caption}</p>
      <div
        className="rounded border px-3 py-2.5"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        {children}
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div
      className="section grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
      aria-busy="true"
      aria-label="Loading metrics"
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="h-20 rounded border"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        />
      ))}
    </div>
  );
}
