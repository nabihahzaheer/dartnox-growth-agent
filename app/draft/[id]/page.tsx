'use client';

/**
 * DRAFT DETAIL — one item opened fully.
 *
 * The brief: "One item opened fully (a lead thread, a draft post, an audit finding) including the
 * agent's reasoning trace and history."
 *
 * ---------------------------------------------------------------------------------------------
 * THE ORGANISING IDEA IS A-08's HANDOFF PAYLOAD, IN ITS ORDER
 *
 * A-08 specifies what a human needs in order to take over, and specifies it as a sequence: a
 * one-line reason it reached you, then the decision and its options, then the draft itself, then
 * expandable evidence — sources, examples, rules — then the checks, then the score components.
 *
 * That order is the screen's layout, deliberately. It is the difference between a page that shows
 * everything about a draft and a page built for the thirty seconds in which someone decides
 * whether to publish it. Rendering the same records sorted by record type would be the former.
 *
 * The one thing this screen has that the queue does not is the reasoning trace: the same steps the
 * console streamed, replayed statically with what each one consumed. In production that is a read
 * from the trace store — the same artifact an incident review would open.
 */

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getDraftDetail,
  labelEscalationUnnecessary,
  type DraftDetail,
} from '@/lib/agentClient';
import type { ConsoleError, DraftId } from '@/lib/types';
import { formatDateTime, formatRelative } from '@/lib/time';
import { Badge, guardrailTone } from '@/components/Badge';
import { BackToQueue, ErrorPanel, NotFound } from '@/components/ErrorState';
import { Rail } from '@/components/Rail';
import { StepRow } from '@/components/console/StepRow';

export default function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  // Next 16 hands route params as a promise; `use` unwraps it in a client component.
  const { id } = use(params);

  const [detail, setDetail] = useState<DraftDetail | null>(null);
  const [error, setError] = useState<ConsoleError | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await getDraftDetail(id as DraftId);
        if (!cancelled) {
          setDetail(next);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e as ConsoleError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, nonce]);

  const label = useCallback(async (eventId: Parameters<typeof labelEscalationUnnecessary>[0]) => {
    await labelEscalationUnnecessary(eventId, true);
    setNonce((n) => n + 1);
  }, []);

  return (
    <>
      <Rail />
      <main className="flex min-w-0 flex-1 flex-col">
        <div
          className="shrink-0 border-b px-4 py-2.5"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
            <Link href="/queue" className="text-[13px]" style={{ color: 'var(--accent-text)' }}>
              ← Queue
            </Link>
            <span className="font-mono text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {id}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4">
            {loading && <Skeleton />}

            {/*
              `not_found` is an empty state, not a failure — D-031's own table says so, and this
              screen was rendering it in a red blocked-state panel. A draft that does not exist is
              not a fault: nothing broke and nothing needs retrying, so colouring it as a failure
              points the operator at the wrong problem.

              Every other kind is a real failure and now offers a retry. Previously this screen had
              none, so a transient error on this route was unrecoverable without the browser's own
              reload button.
            */}
            {error?.kind === 'not_found' && (
              <NotFound
                title="No draft with that id"
                detail="It may have been part of a run that was halted before it produced one."
              >
                <BackToQueue />
              </NotFound>
            )}

            {error && error.kind !== 'not_found' && (
              <ErrorPanel error={error} onRetry={() => setNonce((n) => n + 1)}>
                <BackToQueue />
              </ErrorPanel>
            )}

            {detail && <Detail detail={detail} onLabel={label} />}
          </div>
        </div>
      </main>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2
        className="mb-1.5 font-mono text-[10px] font-bold uppercase"
        style={{ color: 'var(--text-faint)', letterSpacing: '0.1em' }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded border px-3 py-2.5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      {children}
    </div>
  );
}

function Detail({
  detail,
  onLabel,
}: {
  detail: DraftDetail;
  onLabel: (eventId: Parameters<typeof labelEscalationUnnecessary>[0]) => Promise<void>;
}) {
  const { draft, run, steps, events, approval, slot, pillar } = detail;
  const version = draft.versions.find((v) => v.id === draft.current_version_id);
  const escalations = events.filter((e) => e.escalation_tier !== 'none');

  return (
    <>
      {/* 1 · why this reached you, and what you can do about it */}
      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={draft.state === 'awaiting_approval' ? 'awaiting' : 'neutral'}>
            {draft.state.replace(/_/g, ' ')}
          </Badge>
          <span className="text-[13px] font-medium">{pillar?.name}</span>
          <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {draft.channel === 'linkedin' ? 'LinkedIn' : 'X'}
          </span>
          {slot && (
            <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
              publishes {formatDateTime(slot.publish_at)}
            </span>
          )}
        </div>
        {approval && (
          <p className="mt-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {approval.decided_at === null
              ? `Waiting since ${formatRelative(approval.queued_at)}`
              : `Decided ${formatRelative(approval.decided_at)} · ${approval.decision}`}
          </p>
        )}
      </Panel>

      {/* 2 · the draft itself */}
      <Section title="The post">
        <Panel>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{version?.text}</p>
          <p className="mt-2 font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
            v{version?.version} · {version?.author}-written · {version?.token_count} tokens ·{' '}
            {version?.content_hash}
          </p>
        </Panel>
      </Section>

      {/* 3 · history. Every version kept, never truncated — edit magnitude diffs two of them, so
             dropping any would destroy the measurement. */}
      {draft.versions.length > 1 && (
        <Section title={`History · ${draft.versions.length} versions`}>
          <div className="space-y-1.5">
            {draft.versions.map((v) => (
              <Panel key={v.id}>
                <div className="flex items-center gap-2">
                  <Badge tone={v.author === 'human' ? 'approved' : 'neutral'}>v{v.version}</Badge>
                  <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    {v.author} · {formatRelative(v.created_at)}
                  </span>
                  {v.edit_tags.map((t) => (
                    <Badge key={t} mono>
                      {t.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  {v.text}
                </p>
              </Panel>
            ))}
          </div>
        </Section>
      )}

      {/* 4 · the score, with its arithmetic. A single number hides whether the weights were applied
             and hides which dimension is dragging, which is the part an operator can act on. */}
      <Section title="Score">
        <Panel>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold">{draft.composite_score.toFixed(3)}</span>
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              weighted mean of five dimensions
            </span>
          </div>
          <ul className="mt-2 space-y-0.5">
            {(Object.keys(draft.score_components) as (keyof typeof draft.score_components)[]).map(
              (d) => (
                <li key={d} className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span style={{ color: 'var(--text-muted)' }}>{d.replace(/_/g, ' ')}</span>
                  <span className="font-mono">
                    {draft.score_components[d].toFixed(2)} × {draft.score_weights[d]} ={' '}
                    {(draft.score_components[d] * draft.score_weights[d]).toFixed(3)}
                  </span>
                </li>
              ),
            )}
          </ul>
          {/* Stage-1 checks sit strictly outside the rubric and never zero the score — mechanical
              noise must not crowd the queue (A-10). */}
          {draft.deterministic_checks.length > 0 && (
            <ul className="mt-2 space-y-0.5 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
              {draft.deterministic_checks.map((c) => (
                <li key={c.check} className="flex items-baseline gap-2 text-[12px]">
                  <Badge tone={c.result === 'pass' ? 'approved' : 'blocked'}>{c.result}</Badge>
                  <span style={{ color: 'var(--text-muted)' }}>{c.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Section>

      {/* 5 · every guardrail evaluation, passes included. R7: block rate's denominator is
             evaluations, and a rule that stopped being evaluated must not look like a rule that is
             passing everything. */}
      <Section title={`Guardrails · ${events.length} evaluations`}>
        <div className="space-y-1.5">
          {events.map((event) => (
            <Panel key={event.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={guardrailTone(event.result)}>{event.result}</Badge>
                <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  {event.detail}
                </span>
              </div>

              {event.offending_span && (
                <p
                  className="mt-1.5 rounded px-2 py-1 text-[12px]"
                  style={{ background: 'var(--state-awaiting-bg)' }}
                >
                  {event.offending_span.text}
                </p>
              )}

              {/* Withheld by design, not missing. The operator may be the injection's target, so an
                  empty span with no explanation would read as a bug. */}
              {event.span_withheld && (
                <p className="mt-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  {event.withheld_reason}
                </p>
              )}

              {/*
                The one-click label, and the shortest causal chain in the product between an action
                and a metric. `was_unnecessary` is tri-state: unlabelled is not the same as correct,
                and if it were, escalation precision would read high by default.
              */}
              {event.escalation_tier !== 'none' && (
                <div className="mt-2 flex items-center gap-2">
                  {event.was_unnecessary === null ? (
                    <button
                      type="button"
                      onClick={() => void onLabel(event.id)}
                      className="rounded border px-2 py-0.5 text-[12px]"
                      style={{ borderColor: 'var(--border-strong)' }}
                    >
                      This shouldn’t have escalated
                    </button>
                  ) : (
                    <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                      Labelled {event.was_unnecessary ? 'unnecessary' : 'warranted'} — counted in
                      escalation precision
                    </span>
                  )}
                </div>
              )}
            </Panel>
          ))}
          {events.length === 0 && (
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              No evaluations recorded for this draft yet.
            </p>
          )}
        </div>
      </Section>

      {escalations.length > 0 && (
        <Section title="Escalations">
          <Panel>
            {escalations.map((e) => (
              <p key={e.id} className="text-[12px]">
                {e.escalation_tier} · {e.escalation_trigger?.replace(/_/g, ' ')} ·{' '}
                {e.acknowledged_at === null ? 'unacknowledged' : 'acknowledged'}
              </p>
            ))}
          </Panel>
        </Section>
      )}

      {/* 6 · the reasoning trace. The same steps the console streamed, replayed. In production this
             is a read from the trace store — the same artifact an incident review opens. */}
      <Section title={`Reasoning trace · ${steps.length} steps`}>
        {run && (
          <p className="mb-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <Link href="/console" style={{ color: 'var(--accent-text)' }}>
              {run.id}
            </Link>{' '}
            · {formatRelative(run.started_at)}
          </p>
        )}
        <ol className="space-y-2">
          {steps.map((step) => (
            <StepRow
              key={step.id}
              step={step}
              event={events.find((e) => e.run_step_id === step.id)}
              // Nothing animates: this already happened, and a stagger would imply it is happening
              // now.
              isNew={false}
            />
          ))}
        </ol>
      </Section>
    </>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading the draft">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 rounded border"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        />
      ))}
    </div>
  );
}

