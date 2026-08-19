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

import { useCallback, useEffect, useState } from 'react';
import {
  METRICS,
  ROLLING_4W,
  PERIOD,
  blockRateByLayer,
  type Window,
} from '@/lib/metrics';
import { getBudget, getWorld, subscribeToWorld } from '@/lib/agentClient';
import { metricDescriptors } from '@/fixtures/metricDescriptors';
import { BudgetLine, BudgetNotice } from '@/components/BudgetNotice';
import { formatDate } from '@/lib/time';
import type { BudgetPosture } from '@/lib/budget';
import type { ConsoleError, FixtureSet, GuardrailEvent, MetricResult } from '@/lib/types';
import { asConsoleError } from '@/lib/errorCopy';
import { LoadError, LoadingState } from '@/components/ScreenState';

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

type Row = (typeof metricDescriptors)[number];

function Tile({ d, result }: { d: Row; result: MetricResult<number> }) {
  const band = bandLabel(d.unit, d.healthy_range.min, d.healthy_range.max);

  if (result.kind === 'no_data') {
    return (
      <div className="tile">
        <div className="tl2">{d.label}</div>
        <div className="tb tb-muted">—</div>
        <div className="tv nd">{d.empty_state.copy}</div>
      </div>
    );
  }
  if (result.kind === 'not_applicable') {
    return (
      <div className="tile">
        <div className="tl2">{d.label}</div>
        <div className="tb tb-muted">n/a</div>
        <div className="tv nd">{result.reason}</div>
      </div>
    );
  }
  if (result.kind === 'establishing_baseline') {
    return (
      <div className="tile">
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
    <div className="tile">
      <div className="tl2">{d.label}</div>
      <div className="tb">{formatValue(d.unit, result.value)}</div>
      <div className={`tv ${v === 'go' ? 'go' : v === 'attend' ? 'at' : 'nd'}`}>
        {band ?? `n = ${result.sample_n}`}
        {band && <span className="mono tv-n"> · n={result.sample_n}</span>}
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const [world, setWorld] = useState<FixtureSet | null>(null);
  const [budget, setBudget] = useState<BudgetPosture | null>(null);
  const [error, setError] = useState<ConsoleError | null>(null);
  const [openLayer, setOpenLayer] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [w, b] = await Promise.all([getWorld(), getBudget()]);
      setWorld(w);
      setBudget(b);
      setError(null);
    } catch (e) {
      setError(asConsoleError(e));
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToWorld(() => void load());
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [load]);

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Results</h1>
      </header>

      {error && <LoadError error={error} onRetry={() => void load()} />}

      {!error && !world && <LoadingState lines={4} label="Computing the metrics" />}

      {!error && world && budget && <Loaded world={world} budget={budget} openLayer={openLayer} setOpenLayer={setOpenLayer} />}
    </>
  );
}

function Loaded({
  world,
  budget,
  openLayer,
  setOpenLayer,
}: {
  world: FixtureSet;
  budget: BudgetPosture;
  openLayer: string | null;
  setOpenLayer: (l: string | null) => void;
}) {
  const results = new Map<string, MetricResult<number>>();
  for (const d of metricDescriptors) {
    results.set(d.id, METRICS[d.compute_key](world, windowFor(d.window_default)));
  }

  const alarms = metricDescriptors.filter((d) => ALARM_IDS.has(d.id));
  const business = metricDescriptors.filter((d) => d.family === 'business');
  const quality = metricDescriptors.filter((d) => d.family === 'agent_quality' && !ALARM_IDS.has(d.id));

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
      <p className="page-sub" style={{ margin: '-6px 0 20px' }}>
        Rolling four weeks for agent-quality figures, the monthly period for business figures — each
        tile carries its own window because a weekly denominator of eight is too thin to gate on.
      </p>

      <p className="sec">
        Alarms <span className="sec-n">the three the architecture names</span>
      </p>
      <div className="grid3">
        {alarms.map((d) => (
          <Tile key={d.id} d={d} result={results.get(d.id)!} />
        ))}
      </div>

      <p className="sec">For the business</p>
      <div className="grid3">
        {business.map((d) => (
          <Tile key={d.id} d={d} result={results.get(d.id)!} />
        ))}
      </div>

      <p className="sec">On quality</p>
      <div className="grid3">
        {quality.map((d) => (
          <Tile key={d.id} d={d} result={results.get(d.id)!} />
        ))}
      </div>

      <p className="sec">
        Blocked before review, by layer <span className="sec-n">click a bar — the required drill-down</span>
      </p>
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
            <h5>
              {openLayer} · blocked or warned in the last{' '}
              {PERIOD.fromDaysAgo} days
            </h5>
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
      <p className="sec">
        Budget <span className="sec-n">the admission gate</span>
      </p>
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
