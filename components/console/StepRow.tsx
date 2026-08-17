'use client';

/**
 * STEP ROW — one line of the agent's trace.
 *
 * The brief requires the stream to show `thinking → tool call → tool result → action`, and
 * requires tool calls and results to expand to what they were called with and what came back. That
 * expansion is what those two step types *mean*; a row that only says "fetch_source" is a label,
 * not a trace.
 *
 * Every row is collapsed by default and opens on click. A console that expands everything is
 * unreadable at forty steps, and the operator's normal mode is scanning for the one step that
 * explains why an item is in front of them.
 */

import { useState } from 'react';
import type { GuardrailEvent, RunStep } from '@/lib/types';
import { formatTime } from '@/lib/time';
import { Badge, guardrailTone } from '@/components/Badge';
import { Countdown } from '@/components/Countdown';

/**
 * Short typographic markers rather than icons: readable at a glance without a legend, and no
 * assets to load.
 *
 * Restricted to characters that are actually in the bundled font. The first version used ⛉ for a
 * guardrail and ⏸ for an interrupt, and both rendered as the missing-glyph box — caught by looking
 * at the running page, which is not something a typecheck or a lint rule could have told me.
 */
const TYPE_MARK: Record<RunStep['type'], string> = {
  thinking: '···',
  tool_call: '→',
  tool_result: '←',
  action: '◆',
  guardrail: '◇',
  interrupt: '‖',
  rewrite: '↻',
};

const TYPE_LABEL: Record<RunStep['type'], string> = {
  thinking: 'thinking',
  tool_call: 'tool call',
  tool_result: 'tool result',
  action: 'action',
  guardrail: 'guardrail',
  interrupt: 'interrupt',
  rewrite: 'rewrite',
};

function Json({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded bg-[var(--surface-sunk)] p-2 font-mono text-xs leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      {/* Courier caps in grey with no square. The PDF distinguishes a section eyebrow (blue,
          squared) from a table header (grey, bare) exactly this way, and collapsing the two would
          flatten the hierarchy. */}
      <div
        className="font-mono text-[10px] font-bold uppercase"
        style={{ color: 'var(--text-faint)', letterSpacing: '0.1em' }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

export function StepRow({
  step,
  event,
  isNew,
}: {
  step: RunStep;
  /** The guardrail event this step produced, if it is a guardrail step. Paired by id rather than
   *  looked up by run, because a run's L4 events belong to the *publish* run and would not join. */
  event?: GuardrailEvent;
  /** Only steps that arrived live animate in. Replayed history appearing with a stagger would be
   *  theatre — it already happened. */
  isNew: boolean;
}) {
  const [open, setOpen] = useState(false);

  const hasDetail =
    step.thinking_text !== null ||
    step.tool_input !== null ||
    step.tool_output !== null ||
    step.sources.length > 0 ||
    step.applied_inputs.length > 0 ||
    step.brief_ref !== null ||
    step.error !== null ||
    step.interrupt !== null ||
    event !== undefined;

  return (
    <li className={isNew ? 'step-enter' : undefined}>
      <div
        className="rounded border"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--surface)',
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={!hasDetail}
          aria-expanded={hasDetail ? open : undefined}
          className="flex w-full items-start gap-3 px-3 py-2 text-left disabled:cursor-default"
        >
          <span
            aria-hidden
            className="mt-0.5 w-5 shrink-0 text-center font-mono text-sm"
            style={{ color: 'var(--text-faint)' }}
          >
            {TYPE_MARK[step.type]}
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{step.label}</span>
              <span className="font-mono text-[11px] text-[var(--text-faint)]">
                {TYPE_LABEL[step.type]}
              </span>
              {event && (
                <Badge tone={guardrailTone(event.result)}>{event.result}</Badge>
              )}
              {step.outcome === 'error' && <Badge tone="blocked">error</Badge>}
              {step.attempt > 1 && (
                <span className="font-mono text-[11px] text-[var(--text-faint)]">
                  attempt {step.attempt} of {step.max_attempts}
                </span>
              )}
            </span>

            {/* The honest numbers, always visible rather than hidden behind the expander: the model
                that ran the step, its real latency, and what it cost. This row is where the model
                layer stops being a diagram and becomes a per-step fact. */}
            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 font-mono text-[11px] text-[var(--text-faint)]">
              <span>{formatTime(step.started_at)}</span>
              {step.model && <span>{step.model}</span>}
              {step.latency_ms > 0 && <span>{(step.latency_ms / 1000).toFixed(1)}s</span>}
              {step.tokens_in > 0 && (
                <span>
                  {step.tokens_in.toLocaleString()} in / {step.tokens_out.toLocaleString()} out
                </span>
              )}
              {step.cost_model_usd > 0 && <span>${step.cost_model_usd.toFixed(4)}</span>}
              {step.backoff_ms !== null && <span>backoff {step.backoff_ms}ms</span>}
            </span>
          </span>

          {hasDetail && (
            <span
              aria-hidden
              className="mt-0.5 shrink-0 font-mono text-xs"
              style={{ color: 'var(--text-faint)' }}
            >
              {open ? '−' : '+'}
            </span>
          )}
        </button>

        {open && hasDetail && (
          <div className="space-y-3 border-t px-3 py-3" style={{ borderColor: 'var(--border)' }}>
            {step.thinking_text && (
              <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
                {step.thinking_text}
              </p>
            )}

            {step.brief_ref && (
              <Field label={`operator brief · ${step.brief_ref.author}`}>
                <p className="rounded bg-[var(--surface-sunk)] p-2 text-[13px] leading-relaxed">
                  {step.brief_ref.text}
                </p>
              </Field>
            )}

            {/* The field that closes the brief's two hardest loops. A rejection changing what the
                agent does next, and a setting visibly changing behaviour, are both demonstrated by
                the next run's drafting step listing what it consumed. */}
            {step.applied_inputs.length > 0 && (
              <Field label="inputs this step consumed">
                <ul className="space-y-1">
                  {step.applied_inputs.map((input) => (
                    <li key={`${input.kind}-${input.id}`} className="flex items-baseline gap-2">
                      <Badge mono>{input.kind.replace('_', ' ')}</Badge>
                      <span className="text-[13px]">{input.label}</span>
                    </li>
                  ))}
                </ul>
              </Field>
            )}

            {step.tool_input && (
              <Field label={`called with · ${step.tool_name ?? ''}`}>
                <Json value={step.tool_input} />
              </Field>
            )}

            {step.tool_output && (
              <Field label="returned">
                <Json value={step.tool_output} />
              </Field>
            )}

            {step.error && (
              <Field label="error">
                <Json value={step.error} />
              </Field>
            )}

            {step.sources.length > 0 && (
              <Field label="sources">
                <ul className="space-y-2">
                  {step.sources.map((source) => (
                    <li
                      key={source.url}
                      className="rounded border p-2"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium text-[13px]">{source.title}</span>
                        <span className="font-mono text-[11px] text-[var(--text-faint)]">
                          {source.domain}
                        </span>
                        <Badge tone={guardrailTone(source.guard_result)}>
                          {source.guard_result}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[13px] text-[var(--text-muted)]">{source.summary}</p>
                      {/* What makes source choice legible rather than magical. */}
                      <p className="mt-1 text-[13px] italic text-[var(--text-muted)]">
                        Selected because: {source.why_selected}
                      </p>
                    </li>
                  ))}
                </ul>
              </Field>
            )}

            {event && (
              <Field label="guardrail result">
                <p className="text-[13px] leading-relaxed">{event.detail}</p>
                {event.offending_span && (
                  <p className="mt-1 rounded bg-[var(--state-awaiting-bg)] p-2 text-[13px]">
                    <span className="font-mono text-[11px] uppercase text-[var(--text-faint)]">
                      flagged span ·{' '}
                    </span>
                    {event.offending_span.text}
                  </p>
                )}
                {/* Withheld by design, not missing. The operator may be the injection's target, so
                    an empty span with no explanation would read as a bug. */}
                {event.span_withheld && (
                  <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                    {event.withheld_reason}
                  </p>
                )}
              </Field>
            )}

            {step.interrupt && (
              <Field label={`waiting on ${step.interrupt.awaiting}`}>
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span>Options:</span>
                  {step.interrupt.options.map((option) => (
                    <Badge key={option} mono>
                      {option.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                </div>
                <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                  Slot slips in{' '}
                  <Countdown deadline={step.interrupt.deadline} expiredLabel="already slipped" />
                </p>
              </Field>
            )}

            {/* C1 · hashes stay as displayed provenance while payloads are inlined above.
                Production resolves the reference through the trace store; there is no backend here
                to resolve it against, and the README says so. */}
            {(step.input_hash || step.output_ref) && (
              <div className="font-mono text-[11px] text-[var(--text-faint)]">
                {step.input_hash && <div>input {step.input_hash}</div>}
                {step.output_ref && <div>output {step.output_ref}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
