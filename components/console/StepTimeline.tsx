'use client';

/**
 * THE STEP TIMELINE.
 *
 * Two levels, and only two. Level one is the row: what the step was called, its layer where it has
 * one, how long it took, and a node carrying the verdict. Level two is behind that row's own
 * chevron: the actual call, in monospace, as key and value.
 *
 * v1 put both on one surface. Every row carried a Courier type tag and a glyph, and the expansion
 * added Courier-caps field labels over raw JSON — so the screen read as a debugger whether or not
 * anything was expanded. The split here is the one Zendesk's conversation logs make: the timeline
 * says a step happened and names it; everything else is one click away, next to a route back to the
 * thing that caused it.
 *
 * There is no master "show the steps" toggle inside this component. The card owns that, because
 * whether the trace is open is a property of the item being reviewed and not of the trace.
 */

import { useState } from 'react';
import type { GuardrailEvent, GuardrailRule, RunStep } from '@/lib/types';

/** `'run'` was a fourth member `toneFor` could never return, with no `.tl-run` rule behind it —
 *  it would have rendered unstyled had the path ever been live. */
type Tone = 'ok' | 'warn' | 'bad';

function toneFor(step: RunStep, events: GuardrailEvent[]): Tone {
  if (step.error) return 'bad';
  const event = events.find((e) => e.id === step.guardrail_event_id);
  if (event?.result === 'fail') return 'bad';
  if (event?.result === 'warn') return 'warn';
  return 'ok';
}

const GLYPH: Record<Tone, string> = { ok: '✓', warn: '!', bad: '✕' };

/** The node is `aria-hidden` and its glyph is decorative, so without this a screen-reader user
 *  reading a reasoning trace gets labels and durations and no indication of which step failed. */
const TONE_LABEL: Record<Tone, string> = { ok: 'passed', warn: 'warning', bad: 'failed' };

/** The technical view. Every row is a value the record already holds — nothing here is composed
 *  prose, which is why it can be rendered flat without a template deciding what to say. */
function detailRows(step: RunStep, events: GuardrailEvent[], rules: GuardrailRule[]) {
  const rows: [string, string][] = [];
  const event = events.find((e) => e.id === step.guardrail_event_id);
  const rule = event?.rule_id ? rules.find((r) => r.id === event.rule_id) : undefined;

  if (step.tool_name) rows.push(['tool', step.tool_name]);
  if (rule) rows.push(['check', `${rule.kind} · ${rule.mechanism}`]);
  if (event) rows.push(['verdict', event.result]);
  if (step.model) rows.push(['model', step.model_snapshot ?? step.model]);
  if (step.tokens_in || step.tokens_out)
    rows.push(['tokens', `${step.tokens_in.toLocaleString()} in / ${step.tokens_out} out`]);
  if (step.cost_model_usd) rows.push(['cost', `$${step.cost_model_usd.toFixed(4)}`]);
  rows.push(['latency', `${(step.latency_ms / 1000).toFixed(1)}s`]);
  if (step.attempt > 1) rows.push(['attempt', `${step.attempt} of ${step.max_attempts}`]);
  if (step.tool_input) rows.push(['input', JSON.stringify(step.tool_input)]);
  if (step.tool_output) rows.push(['output', JSON.stringify(step.tool_output)]);
  if (step.error) {
    /** The taxonomy is a discriminated union, so the extra field differs per kind. Narrowing here
     *  rather than reaching for an optional property keeps every branch honest. */
    const e = step.error;
    const extra =
      e.kind === 'upstream_error'
        ? ` · ${e.status}`
        : e.kind === 'rate_limited'
          ? ` · retry in ${e.retryAfterMs}ms`
          : e.kind === 'auth_failed'
            ? ` · ${e.channel}`
            : e.kind === 'ambiguous_reconcile'
              ? ` · ${e.candidates.length} candidates`
              : '';
    rows.push(['error', `${e.kind}${extra}`]);
  }
  if (step.output_ref) rows.push(['output_ref', step.output_ref]);
  for (const input of step.applied_inputs)
    rows.push([input.kind.replace('_', ' '), input.label]);
  if (step.interrupt) rows.push(['gate', step.interrupt.gate]);
  if (step.interrupt) rows.push(['offers', step.interrupt.options.join(' · ')]);
  return rows;
}

function Row({
  step,
  events,
  rules,
  last,
}: {
  step: RunStep;
  events: GuardrailEvent[];
  rules: GuardrailRule[];
  last: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tone = toneFor(step, events);
  const event = events.find((e) => e.id === step.guardrail_event_id);
  const rule = event?.rule_id ? rules.find((r) => r.id === event.rule_id) : undefined;
  const rows = detailRows(step, events, rules);

  return (
    <li className={`tl-row${open ? ' is-open' : ''}${last ? ' is-last' : ''}`}>
      <span className={`tl-node tl-${tone}`} aria-hidden>
        {GLYPH[tone]}
      </span>
      <div className="tl-body">
        <button
          type="button"
          className="tl-head"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="tl-car" aria-hidden>
            ▶
          </span>
          <span className="tl-name">{step.label}</span>
          <span className="sr-only">{TONE_LABEL[tone]}</span>
          <span className="tl-meta">
            {rule && <span className="mono tl-lay">{rule.layer}</span>}
            <span className="tl-dur">{(step.latency_ms / 1000).toFixed(1)}s</span>
          </span>
        </button>

        {open && (
          <div className="tl-detail">
            <dl className="kv">
              {rows.map(([k, v], i) => (
                <div key={`${k}-${i}`} className="kv-pair">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {step.thinking_text && <p className="tl-think">{step.thinking_text}</p>}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * THE FOLDED FORM — wall-clock span, computed rather than stored.
 *
 * `latency_ms` sums to the honest cost of the work; it does not answer "how long did this take",
 * because steps queue behind each other and the gaps between them are real. This is the span from
 * the first step's start to the last step's end, which is the number a reviewer means by "done in
 * 21s" — nothing on `RunStep` states it directly, so it has to be derived the same way `Verdict`
 * derives the weakest score dimension rather than trusting a written figure.
 */
export function runDurationSeconds(steps: RunStep[]): number {
  if (steps.length === 0) return 0;
  const first = steps[0];
  const last = steps[steps.length - 1];
  const lastEndsAt = last.started_at + last.latency_ms / 60_000;
  return Math.max(0, Math.round((lastEndsAt - first.started_at) * 60));
}

export function StepTimeline({
  steps,
  events,
  rules,
}: {
  steps: RunStep[];
  events: GuardrailEvent[];
  rules: GuardrailRule[];
}) {
  return (
    <ol className="tl">
      {steps.map((s, i) => (
        <Row key={s.id} step={s} events={events} rules={rules} last={i === steps.length - 1} />
      ))}
    </ol>
  );
}
