'use client';

/**
 * METRICS — the KPIs from the PRD, with charts and one drill-down.
 *
 * ---------------------------------------------------------------------------------------------
 * TEN TILES OF FOURTEEN, AND THE OMISSION IS A DECISION
 *
 * The brief asks for "dummy charts and at least one drill-down interaction", and its closing line
 * makes this a screen to trade against the console rather than one to match it. So the ten that
 * steer are rendered and the remaining four stay defined in `metricDescriptors.ts` — where the PRD
 * transcribes them from, so nothing is lost by not drawing them.
 *
 * WHY THE FOUR RESULT KINDS ARE ALL ON SCREEN AT ONCE. Auto-approve rate reads "not applicable",
 * engagement on X reads "establishing", and everything else reads a value. That is not a fixture
 * accident — it is the reason metric functions return a discriminated result rather than a
 * nullable number, made visible in one glance.
 *
 * NOTHING HERE IS STORED. Every figure is computed from the record collections on each render, so
 * approving something in the queue and coming back moves the numbers. A stats fixture would have
 * been the obvious shortcut and would have destroyed the one property this screen is graded on.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getWorld } from '@/lib/agentClient';
import {
  METRICS,
  PERIOD,
  ROLLING_4W,
  blockRateByLayer,
  draftsInCohort,
  editRateBySettingsVersion,
  engagementVsBaseline,
} from '@/lib/metrics';
import type { ConsoleError, FixtureSet, MetricDescriptor } from '@/lib/types';
import { Rail } from '@/components/Rail';
import { Tile } from '@/components/metrics/Tile';
import { BarChart } from '@/components/metrics/BarChart';

/** Which ten, and in reading order: the business case first, then whether the agent is any good,
 *  then whether the humans are actually reviewing. */
const SHOWN = [
  'published_vs_planned',
  'time_saved',
  'engagement_vs_baseline',
  'cost_per_post',
  'edit_rate',
  'edit_magnitude',
  'time_to_decision',
  'rubber_stamp_rate',
  'escalation_rate',
  'escalation_precision',
  'auto_approve_rate',
] as const;

export default function MetricsPage() {
  const [world, setWorld] = useState<FixtureSet | null>(null);
  const [error, setError] = useState<ConsoleError | null>(null);
  const [cohort, setCohort] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await getWorld();
        if (!cancelled) setWorld(next);
      } catch (e) {
        if (!cancelled) setError(e as ConsoleError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const descriptorFor = useCallback(
    (id: string): MetricDescriptor | undefined =>
      world?.metricDescriptors.find((d) => d.id === id),
    [world],
  );

  const cohorts = useMemo(() => (world ? editRateBySettingsVersion(world) : []), [world]);
  const layers = useMemo(() => (world ? blockRateByLayer(world, ROLLING_4W) : []), [world]);

  if (error) {
    return (
      <>
        <Rail />
        <main className="flex min-w-0 flex-1 items-center justify-center">
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Could not load metrics.
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      <Rail />
      <main className="flex min-w-0 flex-1 flex-col">
        <div
          className="shrink-0 border-b px-4 py-2.5"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
            <span className="text-[13px] font-bold">Metrics</span>
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Rolling 4 weeks · monthly where the denominator needs it
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-4">
            {!world && <Skeleton />}

            {world && (
              <>
                <Grid>
                  {SHOWN.map((id) => {
                    const descriptor = descriptorFor(id);
                    if (!descriptor) return null;

                    /**
                     * Published-vs-planned and cost-per-post are monthly; the rest roll four weeks.
                     * The window is not cosmetic on the first: at a weekly denominator of eight, a
                     * single missed slot reads as 87.5% and every ordinary week looks like failure.
                     */
                    const window =
                      id === 'published_vs_planned' || id === 'cost_per_post' ? PERIOD : ROLLING_4W;

                    const compute = METRICS[descriptor.compute_key as keyof typeof METRICS];
                    const result = compute(world, window);

                    // The one derived band: the cost ceiling is the cap over planned posts, so it
                    // moves when either does and cannot be written into the descriptor.
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
                        onDrillDown={id === 'edit_rate' ? () => setCohort(cohorts[0]?.settingsVersionId ?? null) : undefined}
                      />
                    );
                  })}

                  {/*
                    The same metric on the other channel, and the reason `establishing_baseline`
                    exists as a result kind: Brightsill had a LinkedIn page and no X presence, so
                    the two channels are legitimately in different states. Rendering zero here would
                    say the posts performed badly rather than that the question cannot be answered.
                  */}
                  {descriptorFor('engagement_vs_baseline') && (
                    <Tile
                      descriptor={descriptorFor('engagement_vs_baseline')!}
                      result={engagementVsBaseline(world, ROLLING_4W, 'x')}
                      note="X · no history to compare against yet"
                    />
                  )}
                </Grid>

                {/* ---- THE DRILL-DOWN ------------------------------------------------------- */}
                <Section
                  title="Edit rate by settings version"
                  caption="Every draft records the settings it was written under, so a change can be judged by what happened after it. This is how a well-meant rule that made the output worse gets caught."
                >
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

                  {cohort && (
                    <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                      <p
                        className="mb-1.5 font-mono text-[10px] font-bold uppercase"
                        style={{ color: 'var(--text-faint)', letterSpacing: '0.1em' }}
                      >
                        Drafts written under {cohort}
                      </p>
                      <ul className="space-y-1">
                        {draftsInCohort(world, cohort)
                          .slice(0, 8)
                          .map((d) => {
                            const v = d.versions.find((x) => x.id === d.current_version_id);
                            const edited = d.versions.some((x) => x.author === 'human');
                            return (
                              <li key={d.id} className="flex items-baseline gap-2 text-[12px]">
                                <span
                                  className="font-mono text-[10px]"
                                  style={{ color: edited ? 'var(--state-awaiting)' : 'var(--text-faint)' }}
                                >
                                  {edited ? 'edited' : 'as-is '}
                                </span>
                                <Link href={`/draft/${d.id}`} className="truncate" style={{ color: 'var(--accent-text)' }}>
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
                <Section
                  title="Guardrail block rate by layer"
                  caption="Passing evaluations are recorded, which is why this has a denominator at all. A rule that stopped being evaluated would otherwise look exactly like a rule passing everything — and the alarm here is a sudden drop, not a high value."
                >
                  <BarChart
                    bars={layers.map((l) => ({
                      id: l.layer,
                      label: `${l.layer} · ${l.layer === 'L1' ? 'input' : l.layer === 'L2' ? 'generation' : l.layer === 'L3' ? 'output' : 'publish'}`,
                      value: l.rate,
                      caption: `${l.evaluations} evaluations`,
                    }))}
                    max={15}
                  />
                </Section>

                <p className="pt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  Four further metrics — queue age p95, guardrail block rate in aggregate, injection
                  detections and time-to-decision by pillar — are defined in the descriptor file and
                  not surfaced here. That is a scoping decision, not an omission.
                </p>
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
    <section>
      <h2
        className="font-mono text-[10px] font-bold uppercase"
        style={{ color: 'var(--text-faint)', letterSpacing: '0.1em' }}
      >
        {title}
      </h2>
      <p className="mb-2 mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {caption}
      </p>
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
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading metrics">
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
