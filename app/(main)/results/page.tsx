'use client';

/**
 * RESULTS — every number computed live, nothing precomputed.
 *
 * R1's rule for the whole dashboard: no record carries a stored aggregate, so approving something
 * in the console moves what this screen says on the next render. That is what `lib/metrics.ts`'s
 * fourteen functions and `fixtures/metricDescriptors.ts`'s fourteen descriptors already guarantee —
 * this page's whole job is to call `METRICS[d.compute_key]` for each one and render the result,
 * never to know a number itself.
 *
 * THIS SCREEN CALLS `getWorld()` AND `lib/metrics.ts` DIRECTLY, NOT A DEDICATED READ.
 *
 * Every other screen in the rebuild goes through a purpose-shaped `agentClient` function. This one
 * doesn't, and that is a known asterisk carried over from v1 rather than a new decision — v1's own
 * audit flagged it and the accepted reasoning still holds: the metric functions are pure, computing
 * fourteen of them from one bulk read is what the screen actually needs, and a real backend would
 * replace this whole endpoint with a computed-metrics API rather than fourteen small ones. Adding
 * fourteen thin wrappers to `agentClient.ts` for a single screen to call once each would be API
 * surface with no caller who needs the granularity.
 *
 * THE ALARMS BAND IS THREE OF THE FOURTEEN, NOT A FOURTH THING.
 *
 * `guardrail_block_rate`, `rubber_stamp_rate` and `queue_age_p95` are exactly the three the
 * walkthrough names as the signals that the system has failed quietly. They render once, up top,
 * and are not repeated in the grid below — "leads with" means what it says.
 *
 * Two of the three have a real `healthy_range` and get a computed go/attend verdict the same way
 * every other tile does. `guardrail_block_rate` does not — its descriptor's range is `{min:null,
 * max:null}` on purpose, because the risk named in the architecture is a rate that quietly drops
 * toward zero, which a static floor can't express without a trend to compare against. Rendering an
 * invented threshold for it would be asserting a number the descriptor deliberately does not carry.
 * It shows as an informational value here, honestly, rather than a fabricated pass/fail.
 */

import { useCallback, useState } from 'react';
import {
  METRICS,
  ROLLING_4W,
  PERIOD,
  blockRateByLayer,
  cohortDrafts,
  editRateBySettingsVersion,
  type KeyedMetricDescriptor,
  type Window,
} from '@/lib/metrics';
/**
 * `getMetricDescriptors()`, not `import { metricDescriptors } from '@/fixtures/…'`.
 *
 * That import was the only direct fixture import anywhere in `app/` or `components/`, and it
 * contradicted D-002 verbatim — "No React component imports a fixture file directly… fixtures are
 * imported by that module and nowhere else" — which is the central architectural claim of this
 * whole build and the one the walkthrough states in as many words. The seam function existed the
 * entire time and had zero callers. One grep by a reviewer finds this, and it costs the argument.
 */
import { getBudget, getMetricDescriptors, getWorld } from '@/lib/agentClient';
import { BudgetLine, BudgetNotice } from '@/components/BudgetNotice';
import { CHANNEL_LABEL } from '@/components/ChannelMark';
import { formatDate } from '@/lib/time';
import type { BudgetPosture } from '@/lib/budget';
import Link from 'next/link';
import type { ConsoleError, FixtureSet, GuardrailEvent, MetricResult } from '@/lib/types';
import { asConsoleError } from '@/lib/errorCopy';
import { useWorldRead } from '@/lib/useWorldRead';
import { firstSentence } from '@/lib/text';
import { LoadError, LoadingState, StaleWarning } from '@/components/ScreenState';

const ALARM_IDS = new Set(['guardrail_block_rate', 'rubber_stamp_rate', 'queue_age_p95']);

/**
 * `L1`–`L4` in the architecture, and on screen the place the check runs. The layers are ordered
 * points in the pipeline — what the agent reads, what it writes, what it produced, what it is
 * about to do — so naming them by that is not a rename, it is the same fact without the code.
 */
const LAYER_NAME: Record<string, string> = {
  L1: 'Sources',
  L2: 'While drafting',
  L3: 'Finished draft',
  L4: 'Before publishing',
};

const LAYER_DETAIL: Record<string, string> = {
  L1: 'What the agent is allowed to read',
  L2: 'Shape, length and links as it writes',
  L3: 'Claims, phrasing and personal details',
  L4: 'The last check before a post goes out',
};

function windowFor(kind: 'rolling_4w' | 'period'): Window {
  return kind === 'rolling_4w' ? ROLLING_4W : PERIOD;
}

function formatValue(unit: string, value: number): string {
  if (unit === '%') return `${Math.round(value)}%`;
  if (unit === 'USD') return `$${value.toFixed(2)}`;
  /* `1.00×` is false precision on a ratio whose band is "1 or more", and a bare `m` after a
     number reads as metres or millions before it reads as minutes. */
  if (unit === 'x baseline') return `${Number(value.toFixed(2))}×`;
  if (unit === 'seconds')
    return value < 60 ? `${Math.round(value)}s` : `${Number((value / 60).toFixed(1))} min`;
  if (unit === 'hours') return `${value.toFixed(1)}h`;
  return `${value}`;
}

/** The healthy range said the way a person would say it. Always the descriptor's own numbers in
 *  its own unit — never a threshold invented here — but "Ceiling 20%" is a term of art and
 *  "Target: under 20%" is the same fact in the reader's language. */
function targetLabel(unit: string, min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  const f = (n: number) => formatValue(unit, n);
  if (min !== null && max !== null) return `Target ${f(min)} to ${f(max)}`;
  if (max !== null) return `Target under ${f(max)}`;
  return `Target ${f(min as number)} or more`;
}

function verdict(value: number, min: number | null, max: number | null): 'go' | 'attend' | null {
  if (min === null && max === null) return null;
  const within = (min === null || value >= min) && (max === null || value <= max);
  return within ? 'go' : 'attend';
}

/**
 * A metric, as one tile.
 *
 * WHAT CAME OFF IT, AND WHY.
 *
 * The green tint. Every group tinted its first tile green through a `lead` prop, on the reasoning
 * that one figure per row should carry emphasis. The effect was that "Posts published" sat in a
 * healthy green box with the words "Needs a look" underneath it, because the tint was keyed on
 * POSITION and the verdict on VALUE. Colour that contradicts the label is worse than no colour.
 * Green is gone entirely; amber now appears only when a figure is outside its band, so the one
 * coloured thing on the screen is the thing that needs attention.
 *
 * `n=24`. A sample size printed as an equation, on every tile, in monospace. The denominator is
 * real and worth having, so it is now said in words on the tiles where it changes the reading.
 *
 * `Ceiling 20%` / `Floor 90%`. Correct terms of art and not the user's. They read as "Target:
 * under 20%" and "Target: 90% or more".
 *
 * WHAT WENT ON. One line of definition, from the descriptor's own `definition` field rather than
 * written here, for the metrics whose label does not explain itself.
 */
function Tile({ d, result }: { d: KeyedMetricDescriptor; result: MetricResult<number> }) {
  /**
   * FOUR SLOTS, ALWAYS, IN EVERY BRANCH.
   *
   * The three non-numeric branches used to return their own markup with no target line, so a tile
   * reading "n/a" put its caption a whole line higher than the tile beside it and the row's text
   * stopped lining up. One shape, with the slots reserved whether or not they have anything in
   * them, is the only thing that keeps a grid of tiles on a grid.
   */
  const v =
    result.kind === 'ok' ? verdict(result.value, d.healthy_range.min, d.healthy_range.max) : null;

  const value =
    result.kind === 'ok'
      ? formatValue(d.unit, result.value)
      : result.kind === 'not_applicable'
        ? 'n/a'
        : result.kind === 'establishing_baseline'
          ? `${result.weeks_elapsed} of ${result.weeks_required} weeks`
          : '—';

  const note =
    result.kind === 'ok'
      ? firstSentence(d.definition)
      : result.kind === 'not_applicable'
        ? result.reason
        : d.empty_state.copy;

  return (
    <div className="tile">
      <p className="tile-label">{d.label}</p>
      <p
        className={`tile-value${v === 'attend' ? ' tile-value-attend' : ''}${
          result.kind === 'ok' ? '' : ' tile-value-off'
        }`}
      >
        {value}
      </p>
      {/* Empty where there is no target, rather than absent, so the notes underneath sit on one
          line across a row. The fallback used to print the sample size, which is the `n=` problem
          wearing a different hat: a denominator with no question attached. */}
      <p className="tile-target">
        {v === 'attend' && <span className="tile-flag">Needs a look</span>}
        {result.kind === 'ok' ? targetLabel(d.unit, d.healthy_range.min, d.healthy_range.max) : null}
      </p>
      <p className="tile-note">{note}</p>
    </div>
  );
}

/**
 * One panel. Every section on this screen is one of these — including the two charts and the
 * budget, which used to be bare `<h2>`s over unstyled panels with a decorative pill beside them
 * ("the graded drill-down", "by guardrail layer", "the admission gate"). Three treatments for
 * three sections of one dashboard, and the pills were labels for the author rather than the
 * reader.
 */
function Panel({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mpanel">
      <header className="mpanel-head">
        <h2 className="mpanel-title">{title}</h2>
        {detail && <p className="mpanel-detail">{detail}</p>}
      </header>
      {children}
    </section>
  );
}

function MetricPanel({
  title,
  detail,
  rows,
  results,
}: {
  title: string;
  detail?: string;
  rows: KeyedMetricDescriptor[];
  results: Map<string, MetricResult<number>>;
}) {
  if (rows.length === 0) return null;
  return (
    <Panel title={title} detail={detail}>
      <div className="tile-grid">
        {rows.map((d) => (
          <Tile key={d.id} d={d} result={results.get(d.id)!} />
        ))}
      </div>
    </Panel>
  );
}

export default function ResultsPage() {
  const [world, setWorld] = useState<FixtureSet | null>(null);
  const [descriptors, setDescriptors] = useState<KeyedMetricDescriptor[] | null>(null);
  const [budget, setBudget] = useState<BudgetPosture | null>(null);
  const [error, setError] = useState<ConsoleError | null>(null);

  const load = useCallback(async () => {
    try {
      const [w, d, b] = await Promise.all([getWorld(), getMetricDescriptors(), getBudget()]);
      setWorld(w);
      setDescriptors(d);
      setBudget(b);
      setError(null);
    } catch (e) {
      setError(asConsoleError(e));
    }
  }, []);

  useWorldRead(load);

  return (
    <>
      {/**
       * THE LEDE BELONGS TO THE HEADING.
       *
       * It used to be rendered by `Loaded`, two components away, so it inherited `.page-head`'s
       * bottom margin as its own TOP margin and then sat flush against the first panel. Which is
       * exactly backwards: a big gap between a title and the line explaining it, and none between
       * that line and the content it is introducing. Every other screen already nests it here.
       */}
      <header className="page-head">
        <h1 className="page-title">Metrics</h1>
        <p className="page-sub">
          Live figures for Brightsill. Quality metrics cover the last four weeks; business metrics
          cover the last {PERIOD.fromDaysAgo} days.
        </p>
      </header>

      {error && !world && <LoadError error={error} onRetry={() => void load()} />}
      {error && world && <StaleWarning error={error} onRetry={() => void load()} />}

      {!world && !error && <LoadingState lines={4} label="Computing the metrics" />}

      {world && descriptors && budget && (
        <Loaded
          world={world}
          descriptors={descriptors}
          budget={budget}
        />
      )}
    </>
  );
}

function Loaded({
  world,
  descriptors,
  budget,
}: {
  world: FixtureSet;
  descriptors: KeyedMetricDescriptor[];
  budget: BudgetPosture;
}) {
  /** Held here rather than lifted. Both are open/closed flags for charts that live only inside this
   *  component, and `Loaded` never unmounts once the first read lands, so lifting them bought
   *  nothing and drilled four props through a boundary that had no use for them. */
  const [openLayer, setOpenLayer] = useState<string | null>(null);
  const [openCohort, setOpenCohort] = useState<string | null>(null);
  const results = new Map<string, MetricResult<number>>();
  for (const d of descriptors) {
    results.set(d.id, METRICS[d.compute_key](world, windowFor(d.window_default)));
  }

  const alarms = descriptors.filter((d) => ALARM_IDS.has(d.id));
  const business = descriptors.filter((d) => d.family === 'business');
  const quality = descriptors.filter((d) => d.family === 'agent_quality' && !ALARM_IDS.has(d.id));

  const cohorts = editRateBySettingsVersion(world);
  const versionNumber = (id: string) =>
    world.settings.versions.findIndex((v) => v.version_id === id) + 1;
  const measured = blockRateByLayer(world, PERIOD);
  /**
   * ALL FOUR STAGES, INCLUDING ONES NOTHING RAN AT.
   *
   * `blockRateByLayer` drops layers with no evaluations, which is right for a computation and
   * wrong for a chart: a stage that is silently missing looks the same as a stage that was never
   * checked. Four rows always; the ones with nothing behind them say so.
   */
  const layers = (Object.keys(LAYER_NAME) as string[]).map(
    (layer) => measured.find((m) => m.layer === layer) ?? { layer, rate: 0, evaluations: 0 },
  );
  /**
   * BARS RUN TO 100%, NOT TO THE LONGEST ROW.
   *
   * Both were `(rate / max) * 100`, so the biggest row always painted a full bar whatever it said:
   * "12% of 26 checks" could fill the track end to end, and the two charts could not be compared
   * with each other because each had its own invisible maximum. These are already percentages, so
   * the bar is the percentage.
   */

  const drillEvents: GuardrailEvent[] = openLayer
    ? world.guardrailEvents
        .filter((e) => {
          const rule = e.rule_id ? world.guardrailRules.find((r) => r.id === e.rule_id) : undefined;
          return rule?.layer === openLayer && e.result !== 'pass';
        })
        .sort((a, b) => (b.evaluated_at as number) - (a.evaluated_at as number))
    : [];

  return (
    <>
      {/**
       * SIX PANELS, ONE SHAPE.
       *
       * Three of these used to be cards with their titles inside them and three were bare `<h2>`s
       * floating over an unstyled `.panel`, with a decorative pill beside the heading. Same screen,
       * two grammars, and the pills ("the graded drill-down", "by guardrail layer", "the admission
       * gate") were the author labelling their own work rather than telling a reader anything.
       */}
      <MetricPanel
        title="Early warnings"
        detail="The three figures that move first when the system starts failing quietly."
        rows={alarms}
        results={results}
      />
      <MetricPanel
        title="Business results"
        detail="What the client is paying for: posts out, time back, engagement, cost."
        rows={business}
        results={results}
      />
      <MetricPanel
        title="Agent quality"
        detail="How much of the agent's output survives review without a person rewriting it."
        rows={quality}
        results={results}
      />

      {/**
       * THE DRILL-DOWN THE ARCHITECTURE ACTUALLY NOMINATES.
       *
       * D-042 and `lib/metrics.ts` both name edit rate split by settings version as *the*
       * drill-down: the Settings change history is literally its x-axis, and A-05 names exactly
       * this comparison as the way to detect a learned rule that made the output worse. It is why
       * every `DraftVersion` stamps a `settings_version_id`.
       *
       * The bars stayed — three values compared against each other is what a bar chart is for —
       * but every label on them was a code. `SET-V1` is a database key; a person wants to know
       * WHICH CHANGE, so each row is now named by what changed and when it took effect, and the
       * number reads "17% edited · 1 of 6 decisions" rather than "17% · 1/6".
       */}
      <Panel
        title="Edit rate by settings version"
        detail="How often a person rewrote the agent, split by the settings in force at the time."
      >
        <div className="mpanel-body">
          {cohorts.length === 0 ? (
            <p className="mpanel-empty">No decisions recorded under any settings version yet.</p>
          ) : (
            <div className="chart">
              {cohorts.map((c) => (
                <button
                  key={c.settingsVersionId}
                  type="button"
                  className={`crow${openCohort === c.settingsVersionId ? ' crow-on' : ''}`}
                  aria-expanded={openCohort === c.settingsVersionId}
                  onClick={() =>
                    setOpenCohort(openCohort === c.settingsVersionId ? null : c.settingsVersionId)
                  }
                >
                  <span className="cname">
                    {/* Numbered from the settings history, not from this array. Cohorts with no
                        decisions are filtered out upstream, so the third row could be `SET-V4`
                        while the screen called it "Version 3". */}
                    <span className="cname-t">Version {versionNumber(c.settingsVersionId)}</span>
                    <span className="cname-s">{firstSentence(c.changeSummary)}</span>
                  </span>
                  <span className="ctrack" aria-hidden>
                    <i style={{ width: `${c.rate}%` }} />
                  </span>
                  <span className="cval">
                    <span className="cval-n">{c.rate.toFixed(0)}%</span>
                    <span className="cval-s">
                      {c.edited} of {c.decisions} rewritten
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {openCohort && (
            <div className="drill">
              <h3 className="drill-h">
                {cohorts.find((c) => c.settingsVersionId === openCohort)?.changeSummary}
              </h3>
              {/**
               * THE SAME POPULATION THE BAR COUNTED, AND POSTS YOU CAN IDENTIFY.
               *
               * `draftsInCohort` returns every draft with any version stamped with this settings
               * version — including rejected and undecided ones — while the bar above counts
               * decided, non-rejected, non-superseded approvals. So "1 of 6 rewritten" could sit
               * above eight rows with two marked Edited, and the panel contradicted itself. The
               * list is filtered to the bar's own population.
               *
               * Each row also says WHICH post, with a link, the way the queue does. A row you
               * cannot identify is a row you cannot act on.
               */}
              {cohortDrafts(world, openCohort).length === 0 ? (
                <p className="mpanel-empty">No decided drafts under this version.</p>
              ) : (
                cohortDrafts(world, openCohort).map(({ draft, edited, decidedAt }) => (
                  <div key={draft.id} className="dritem">
                    <span className="dt2">{decidedAt === null ? '' : formatDate(decidedAt)}</span>
                    <span className="dq">
                      <b>{edited ? 'Rewritten' : 'Approved as written'}</b> ·{' '}
                      {CHANNEL_LABEL[draft.channel]} ·{' '}
                      <Link href={`/approvals/${draft.id}`}>
                        {firstSentence(
                          draft.versions.find((v) => v.id === draft.current_version_id)?.text ?? '',
                        )}
                      </Link>
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </Panel>

      {/* `L1`–`L4` are the architecture's names for the four points a check can run at. They are
          correct and they are internal; the screen says where the check runs instead. */}
      <Panel
        title="Where problems get caught"
        detail={`Share of checks that warned or blocked, at each stage, over the last ${PERIOD.fromDaysAgo} days.`}
      >
        <div className="mpanel-body">
          {measured.length === 0 ? (
            <p className="mpanel-empty">No checks have run in this period.</p>
          ) : (
            <div className="chart">
              {layers.map((l) => (
                <button
                  key={l.layer}
                  type="button"
                  className={`crow${openLayer === l.layer ? ' crow-on' : ''}`}
                  aria-expanded={openLayer === l.layer}
                  disabled={l.evaluations === 0}
                  onClick={() => setOpenLayer(openLayer === l.layer ? null : l.layer)}
                >
                  <span className="cname">
                    <span className="cname-t">{LAYER_NAME[l.layer] ?? l.layer}</span>
                    <span className="cname-s">{LAYER_DETAIL[l.layer] ?? ''}</span>
                  </span>
                  <span className="ctrack" aria-hidden>
                    <i style={{ width: `${l.rate}%` }} />
                  </span>
                  <span className="cval">
                    <span className="cval-n">
                      {l.evaluations === 0 ? '—' : `${l.rate.toFixed(0)}%`}
                    </span>
                    <span className="cval-s">
                      {l.evaluations === 0 ? 'no checks yet' : `of ${l.evaluations} checks`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {openLayer && (
            <div className="drill">
              <h3 className="drill-h">
                {LAYER_NAME[openLayer] ?? openLayer} · warned or blocked in the last{' '}
                {PERIOD.fromDaysAgo} days
              </h3>
              {drillEvents.length === 0 ? (
                <p className="mpanel-empty">Nothing was caught here in this period.</p>
              ) : (
                drillEvents.map((e) => {
                  const rule = e.rule_id
                    ? world.guardrailRules.find((r) => r.id === e.rule_id)
                    : undefined;
                  return (
                    <div key={e.id} className="dritem">
                      <span className="dt2">{formatDate(e.evaluated_at)}</span>
                      <span className="dq">
                        <b>{rule?.display_name ?? 'Unnamed check'}</b> · {e.detail}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </Panel>

      <Panel
        title="Monthly spend"
        detail={`The agent alerts at ${budget.alert_pct}% of the cap and pauses new planning and drafting at ${budget.stop_pct}%.`}
      >
        <div className="mpanel-body">
          <BudgetLine budget={budget} />
          <p className="panel-caption">Counted since {formatDate(budget.period_start)}.</p>
          <BudgetNotice budget={budget} />
        </div>
      </Panel>

    </>
  );
}
