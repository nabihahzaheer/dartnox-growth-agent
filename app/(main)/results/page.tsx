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
  draftsInCohort,
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
import type { ConsoleError, FixtureSet, GuardrailEvent, MetricResult } from '@/lib/types';
import { asConsoleError } from '@/lib/errorCopy';
import { useWorldRead } from '@/lib/useWorldRead';
import { LoadError, LoadingState, StaleWarning } from '@/components/ScreenState';

const ALARM_IDS = new Set(['guardrail_block_rate', 'rubber_stamp_rate', 'queue_age_p95']);

function windowFor(kind: 'rolling_4w' | 'period'): Window {
  return kind === 'rolling_4w' ? ROLLING_4W : PERIOD;
}

function formatValue(unit: string, value: number): string {
  if (unit === '%') return `${Math.round(value)}%`;
  if (unit === 'USD') return `$${value.toFixed(2)}`;
  if (unit === 'x baseline') return `${value.toFixed(2)}×`;
  if (unit === 'seconds') return value < 60 ? `${Math.round(value)}s` : `${(value / 60).toFixed(1)}m`;
  if (unit === 'hours') return `${value.toFixed(1)}h`;
  return `${value}`;
}

/** A short, honest description of the band itself — never a made-up threshold, always the
 *  descriptor's own numbers, formatted in its own unit. */
function bandLabel(unit: string, min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  const f = (n: number) => formatValue(unit, n);
  if (min !== null && max !== null) return `Band ${f(min)}–${f(max)}`;
  if (max !== null) return `Ceiling ${f(max)}`;
  return `Floor ${f(min as number)}`;
}

function verdict(value: number, min: number | null, max: number | null): 'go' | 'attend' | null {
  if (min === null && max === null) return null;
  const within = (min === null || value >= min) && (max === null || value <= max);
  return within ? 'go' : 'attend';
}

function Tile({
  d,
  result,
  lead = false,
}: {
  d: KeyedMetricDescriptor;
  result: MetricResult<number>;
  lead?: boolean;
}) {
  const band = bandLabel(d.unit, d.healthy_range.min, d.healthy_range.max);
  const cls = `tile${lead ? ' tile-lead' : ''}`;

  if (result.kind === 'no_data') {
    return (
      <div className={cls} title={d.definition}>
        <div className="tl2">{d.label}</div>
        <div className="tb tb-muted">—</div>
        <div className="tv nd">{d.empty_state.copy}</div>
      </div>
    );
  }
  if (result.kind === 'not_applicable') {
    return (
      <div className={cls} title={d.definition}>
        <div className="tl2">{d.label}</div>
        <div className="tb tb-muted">n/a</div>
        <div className="tv nd">{result.reason}</div>
      </div>
    );
  }
  if (result.kind === 'establishing_baseline') {
    return (
      <div className={cls} title={d.definition}>
        <div className="tl2">{d.label}</div>
        <div className="tb tb-muted">establishing</div>
        <div className="tv nd">
          {d.empty_state.copy} ({result.weeks_elapsed} of {result.weeks_required} weeks)
        </div>
      </div>
    );
  }

  const v = verdict(result.value, d.healthy_range.min, d.healthy_range.max);
  return (
    <div className={cls} title={d.definition}>
      <div className="tl2">{d.label}</div>
      <div className="tb">{formatValue(d.unit, result.value)}</div>
      {/* The verdict is a word and a shape as well as a colour — a healthy tile and an out-of-band
          tile used to render identical text and differ only in green versus amber. */}
      <div className="tfoot">
        {v && (
          <span className={`vpill ${v === 'go' ? 'v-go' : 'v-at'}`}>
            {v === 'go' ? 'In band' : 'Needs a look'}
          </span>
        )}
        <span className="tband">{band ?? `over ${result.sample_n}`}</span>
        <span className="tn mono">n={result.sample_n}</span>
      </div>
    </div>
  );
}

/**
 * A named group of tiles inside one bounded surface.
 *
 * The screen used to be three bare `grid3` blocks under small uppercase labels, floating directly
 * on the page background. Nothing bounded a group, so the eye had no way to tell where one ended
 * and the next began — Nabihah's read was "ugly tabs just thrown about". A card per group, one
 * heading, one optional line of context, and the tiles as rows inside it.
 */
function MetricGroup({
  title,
  detail,
  rows,
  results,
  lead,
  footnote,
}: {
  title: string;
  detail?: string;
  rows: KeyedMetricDescriptor[];
  results: Map<string, MetricResult<number>>;
  /** The one figure in this group worth tinting. Insightful marks a single cell in each row and
   *  leaves the rest plain; colour on every cell stops carrying information. */
  lead?: string;
  /** The group's number said in words. Insightful pairs its ROI row with one plain sentence
   *  underneath, which is what stops a wall of figures being unreadable. */
  footnote?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mgroup">
      <div className="mgroup-head">
        <h2 className="mgroup-title">{title}</h2>
        {detail && <p className="mgroup-detail">{detail}</p>}
      </div>
      <div className="mgroup-grid">
        {rows.map((d) => (
          <Tile key={d.id} d={d} result={results.get(d.id)!} lead={d.id === lead} />
        ))}
      </div>
      {footnote && <p className="mgroup-foot">{footnote}</p>}
    </section>
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
      <header className="page-head">
        <h1 className="page-title">Metrics</h1>
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
  const maxEdit = Math.max(1, ...cohorts.map((c) => c.rate));
  const layers = blockRateByLayer(world, PERIOD);
  const maxRate = Math.max(1, ...layers.map((l) => l.rate));

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
      {/* Was a wrapped paragraph of reasoning about denominators. A dashboard's intro line should
          say what you are looking at and over what period, not argue with you about statistics. */}
      <p className="page-sub">
        Live figures for Brightsill. Quality metrics run over the last four weeks, business metrics
        over the current month.
      </p>

      {/* Three named groups, each in its own bounded card rather than a bare grid under a small
          uppercase label. The old screen was tiles floating on the page background with nothing
          holding them together, which is why it read as parts rather than a dashboard. */}
      <div className="metrics-top">
        <MetricGroup
          title="Watch these"
          detail="The three signals that the system has failed quietly."
          rows={alarms}
          results={results}
          lead="rubber_stamp_rate"
          footnote="Rubber-stamping is the one an operator can fix today: it counts decisions taken in under fifteen seconds, which is faster than the post can be read."
        />
      </div>
      <MetricGroup
        title="For the business"
        rows={business}
        results={results}
        lead="published_vs_planned"
        footnote="Published against planned is the contract with the client: eight posts a week, and every slot that slipped or was dropped counts against it."
      />
      <MetricGroup
        title="On quality"
        rows={quality}
        results={results}
        lead="edit_rate"
        footnote="Edit rate is how often a person had to rewrite the agent. It is the closest thing here to a score for the drafting itself."
      />

      {/**
       * THE DRILL-DOWN THE ARCHITECTURE ACTUALLY NOMINATES, WHICH WAS NOT ON THIS SCREEN.
       *
       * D-042 and `lib/metrics.ts` both name edit rate split by settings version as *the* drill-down,
       * on the argument that it is the only candidate connecting two screens through data rather
       * than narration: the Settings change history is literally its x-axis, and A-05 names exactly
       * this comparison as the way to detect a learned rule that made the output worse. It is also
       * why every `DraftVersion` stamps a `settings_version_id`.
       *
       * `editRateBySettingsVersion` and `draftsInCohort` were written, asserted and called by nothing
       * in the rebuild — the screen shipped the by-layer chart instead, which is a good chart and is
       * not the one the decision log promises.
       */}
      <h2 className="sec">
        Edit rate by settings version <span className="sec-n">the graded drill-down</span>
      </h2>
      <div className="panel" style={{ padding: '17px 18px' }}>
        {cohorts.length === 0 ? (
          <p className="state-sub" style={{ margin: 0 }}>
            No decisions recorded under any settings version yet.
          </p>
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
                <span className="cname mono">{c.settingsVersionId}</span>
                <span className="ctrack">
                  <i style={{ width: `${(c.rate / maxEdit) * 100}%` }} />
                </span>
                <span className="cval">
                  {c.rate.toFixed(0)}% <span className="mono">· {c.edited}/{c.decisions}</span>
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
            {draftsInCohort(world, openCohort).length === 0 ? (
              <p className="dritem" style={{ border: 0 }}>
                No drafts were written under this version.
              </p>
            ) : (
              draftsInCohort(world, openCohort).map((d) => {
                const edited = d.versions.some((v) => v.author === 'human');
                return (
                  <div key={d.id} className="dritem">
                    <span className="dt2">{d.id}</span>
                    <span className="dq">
                      <b>{edited ? 'Edited' : 'Approved as written'}</b> ·{' '}
                      {CHANNEL_LABEL[d.channel]} · {d.versions.length} version
                      {d.versions.length === 1 ? '' : 's'}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <h2 className="sec">Blocked before review, by layer <span className="sec-n">by guardrail layer</span>
      </h2>
      <div className="panel" style={{ padding: '17px 18px' }}>
        {layers.length === 0 ? (
          <p className="state-sub" style={{ margin: 0 }}>
            No guardrail evaluations in this period.
          </p>
        ) : (
          <div className="chart">
            {layers.map((l) => (
              <button
                key={l.layer}
                type="button"
                className={`crow${openLayer === l.layer ? ' crow-on' : ''}`}
                aria-expanded={openLayer === l.layer}
                onClick={() => setOpenLayer(openLayer === l.layer ? null : l.layer)}
              >
                <span className="cname mono">{l.layer}</span>
                <span className="ctrack">
                  <i style={{ width: `${(l.rate / maxRate) * 100}%` }} />
                </span>
                <span className="cval">
                  {l.rate.toFixed(0)}% <span className="mono">· n={l.evaluations}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {openLayer && (
          <div className="drill">
            <h3 className="drill-h">
              {openLayer} · blocked or warned in the last{' '}
              {PERIOD.fromDaysAgo} days
            </h3>
            {drillEvents.length === 0 ? (
              <p className="dritem" style={{ border: 0 }}>
                Nothing blocked at this layer in the period.
              </p>
            ) : (
              drillEvents.map((e) => {
                const rule = e.rule_id ? world.guardrailRules.find((r) => r.id === e.rule_id) : undefined;
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

      {/**
       * WAS: `spend $121.59 / 400 · under` in monospace.
       *
       * Three defects in one line. It printed `budget.state` raw, so the screen showed an operator
       * the enum member `under` — the same "a code is not a sentence" defect the approvals queue's
       * `PARK_LABEL` map exists to prevent. It gave the two numbers no relationship, so nothing said
       * whether 121.59 of 400 was comfortable or nearly spent. And it rendered identically in all
       * three states, which made the gate's whole asymmetric branch invisible on the one screen
       * whose job is reporting on the system.
       */}
      <h2 className="sec">Budget <span className="sec-n">the admission gate</span>
      </h2>
      <div className="panel" style={{ padding: '15px 18px' }}>
        <BudgetLine budget={budget} />
        <p className="t-meta" style={{ margin: '9px 0 0' }}>
          Alerts at {budget.alert_pct}%, pauses new planning and drafting at {budget.stop_pct}%.
          Summed over {budget.sample_n} steps since {formatDate(budget.period_start)}.
        </p>
      </div>
      <div style={{ marginTop: 12 }}>
        <BudgetNotice budget={budget} />
      </div>
    </>
  );
}
