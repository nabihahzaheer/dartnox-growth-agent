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
 *
 * ---------------------------------------------------------------------------------------------
 * TYPE (D-045)
 *
 * This is the one screen in the app where somebody READS rather than scans: the post is prose, and
 * a reviewer has to judge whether it is publishable. So the post is `.t-body` with relaxed leading
 * and a measure cap, and everything around it — ids, hashes, token counts, timings — drops to
 * `.t-meta` so that the one block of prose is the only thing on the screen set for reading.
 *
 * ---------------------------------------------------------------------------------------------
 * SECTION ORDER WAS WRONG AND IS NOW A-08's
 *
 * The sections used to run post → history → score → guardrails. So a draft flagged for an
 * unsupported claim showed, in this order: the post, three superseded versions of it, five rows of
 * `0.74 × 0.3 = 0.222`, five rows of `pass` — and only then the sentence explaining why it was on
 * the screen at all. The reader's own question was last and the audit trail was first.
 *
 * It now runs post → guardrails → score → history. Why it is flagged, then how it scored, then the
 * reference material. That is A-08's sequence, which the header above already claimed this screen
 * followed and did not.
 *
 * The score block itself changed with it: the verdict and a bar per dimension lead, and the
 * weighted-mean arithmetic moved behind a disclosure. The arithmetic is kept because a single
 * returned number cannot show whether the weights were applied at all — a real way for a scoring
 * system to be quietly broken — but that is an auditor's question, and answering it first told a
 * marketing lead that long multiplication was the point of the screen.
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
          <div className="mx-auto flex w-full max-w-3xl items-baseline gap-3">
            <Link href="/v1/queue" className="t-body" style={{ color: 'var(--accent-text)' }}>
              ← Queue
            </Link>
            {/* The screen name, and this route's only `h1`. The bar previously carried the back
                link and a raw id and nothing that said what you were looking at, so the id had to
                do a job it is bad at. */}
            <h1 className="t-title">Draft</h1>
            <span className="t-meta tabular font-mono">{id}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Rhythm comes from `.section + .section` in globals.css, not from a `space-y` utility
              on this container — a gap here would flatten the 28px the scale puts between groups
              back down to a uniform one. */}
          <div className="mx-auto w-full max-w-3xl px-4 py-4">
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

/**
 * `.section` earns the 28px above the heading; `.section > .t-section` earns the 10px below it, so
 * the heading binds to its own content rather than to the block before it. The heading has to be a
 * DIRECT child for that second rule to bite.
 *
 * `.tabular` because most titles on this screen carry a count — "History · 3 versions" — and a
 * heading whose digits shift width as the data changes reads as a text field.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <h2 className="t-section tabular">{title}</h2>
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

/** The FIELD role from the assessment PDF, against its value. Used only inside the stat block and
 *  the post's provenance line — never as a heading, which is what stopped headings and labels on
 *  this screen looking identical. */
function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="t-field">{label}</span>
      <span className="t-body tabular font-mono">{children}</span>
    </div>
  );
}

/**
 * A-10's five rubric dimensions, in the order the weights descend.
 *
 * Listed rather than taken from `Object.keys(score_components)`: key order is an implementation
 * detail of whichever fixture or reducer built the object, and the bars are read as a ranking, so
 * a silent reorder would change what the screen appears to say.
 */
const DIMENSIONS = [
  'brand_voice',
  'claim_support',
  'pillar_fit',
  'channel_fit',
  'specificity',
] as const;

function Detail({
  detail,
  onLabel,
}: {
  detail: DraftDetail;
  onLabel: (eventId: Parameters<typeof labelEscalationUnnecessary>[0]) => Promise<void>;
}) {
  const { draft, run, steps, events, approval, slot, pillar, threshold } = detail;
  const version = draft.versions.find((v) => v.id === draft.current_version_id);
  const escalations = events.filter((e) => e.escalation_tier !== 'none');

  const belowThreshold = draft.composite_score < threshold;
  const failedChecks = draft.deterministic_checks.filter((c) => c.result === 'fail');

  /**
   * The lowest-scoring dimension, which is the only part of a rubric result anyone can act on.
   *
   * Deliberately the raw score and not the weighted contribution: `specificity` at 0.55 is the
   * thing to fix even though its 10% weight makes its contribution the smallest number in the
   * column. Ranking by contribution would always nominate whichever dimension carries 30%.
   */
  const weakest = DIMENSIONS.reduce((low, d) =>
    draft.score_components[d] < draft.score_components[low] ? d : low,
  );

  return (
    <>
      {/* 1 · why this reached you, and what you can do about it. A `.section` with no heading, so
             that the next group still gets its 28px from `.section + .section`. */}
      <section className="section">
        <Panel>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={draft.state === 'awaiting_approval' ? 'awaiting' : 'neutral'}>
              {draft.state.replace(/_/g, ' ')}
            </Badge>
            <span className="t-body font-medium">{pillar?.name}</span>
            <span className="t-body" style={{ color: 'var(--text-muted)' }}>
              {draft.channel === 'linkedin' ? 'LinkedIn' : 'X'}
            </span>
            {slot && (
              <span className="t-meta tabular">publishes {formatDateTime(slot.publish_at)}</span>
            )}
          </div>
          {approval && (
            <p className="t-label mt-1.5">
              {approval.decided_at === null
                ? `Waiting since ${formatRelative(approval.queued_at)}`
                : `Decided ${formatRelative(approval.decided_at)} · ${approval.decision}`}
            </p>
          )}
        </Panel>
      </section>

      {/* 2 · the draft itself */}
      <Section title="The post">
        <Panel>
          {/*
            The only prose on the screen, and the only thing set for reading rather than scanning.
            `.t-body` is the size; the two additions are what make it comfortable at that size.

            `max-w-[62ch]` because the column is 768px wide and 13px prose runs past 110 characters
            in it — roughly twice the measure at which a reader reliably finds the next line. The
            constraint is on the text, not on the panel, so the panel still fills the column and the
            provenance line below still spans it.
          */}
          <p className="t-body max-w-[62ch] leading-relaxed whitespace-pre-wrap">{version?.text}</p>
          {/*
            The hash is truncated to its first twelve characters, with the whole thing on the
            title.

            It was printed in full: 64 hex characters wrapping under the post, which is more
            physical space than the provenance line's other three facts combined and reads as a
            rendering accident. Twelve is enough to compare two by eye, which is the only thing
            anyone does with it here — L4 compares them in code, not on this screen. The full value
            stays reachable because "we only publish what a human approved" is checkable, not
            asserted, and a truncated hash would undercut that claim if it were the only copy.
          */}
          <p
            className="t-meta tabular mt-2 font-mono"
            title={version?.content_hash}
          >
            v{version?.version} · {version?.author}-written · {version?.token_count} tokens ·{' '}
            {version?.content_hash.slice(0, 19)}…
          </p>
        </Panel>
      </Section>

      {/* 5 · every guardrail evaluation, passes included. R7: block rate's denominator is
             evaluations, and a rule that stopped being evaluated must not look like a rule that is
             passing everything. */}
      <Section title={`Guardrails · ${events.length} evaluations`}>
        <div className="space-y-1.5">
          {events.map((event) => (
            <Panel key={event.id}>
              <div className="flex flex-wrap items-baseline gap-2">
                <Badge tone={guardrailTone(event.result)}>{event.result}</Badge>
                <span className="t-label">{event.detail}</span>
              </div>

              {/* The offending text itself, so it is `.t-body` — it is quoted evidence a reviewer
                  reads, not a caption about it. */}
              {event.offending_span && (
                <p
                  className="t-body mt-1.5 max-w-[62ch] rounded px-2 py-1"
                  style={{ background: 'var(--state-awaiting-bg)' }}
                >
                  {event.offending_span.text}
                </p>
              )}

              {/* Withheld by design, not missing. The operator may be the injection's target, so an
                  empty span with no explanation would read as a bug. */}
              {event.span_withheld && <p className="t-label mt-1.5">{event.withheld_reason}</p>}

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
                      className="t-body rounded border px-2 py-0.5"
                      style={{ borderColor: 'var(--border-strong)' }}
                    >
                      This shouldn’t have escalated
                    </button>
                  ) : (
                    <span className="t-label">
                      Labelled {event.was_unnecessary ? 'unnecessary' : 'warranted'} — counted in
                      escalation precision
                    </span>
                  )}
                </div>
              )}
            </Panel>
          ))}
          {events.length === 0 && <p className="t-label">No evaluations recorded for this draft yet.</p>}
        </div>
      </Section>

      {/*
        4 · THE SCORE — the verdict first, the arithmetic on request.

        THIS SECTION WAS A LONG-MULTIPLICATION TABLE. Five rows reading `0.74 × 0.3 = 0.222`, above
        five rows of `pass`, above the one thing that actually explains why the draft is on this
        screen. The person reading it is a marketing lead at a 34-person contractor. They need to
        know whether this is publishable and what is dragging it down; they do not need the weighted
        mean shown as working, and putting it first said the opposite.

        The defence for showing the arithmetic is real and is kept: a single returned number hides
        whether the weights were applied at all, which is a genuine way for a scoring system to be
        quietly broken. That is an auditor's question, not a reviewer's — so it moves behind a
        disclosure instead of leading. Nothing is deleted.

        What leads instead: the number, whether it clears the bar, and which dimension is lowest —
        the only part of a rubric score anyone can act on.
      */}
      <Section title="Score">
        <Panel>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="t-metric">{draft.composite_score.toFixed(2)}</span>
            <span
              className="t-body font-semibold"
              style={{ color: belowThreshold ? 'var(--state-awaiting)' : 'var(--state-approved)' }}
            >
              {belowThreshold ? `Below the ${threshold} bar` : `Clears the ${threshold} bar`}
            </span>
            {weakest && (
              <span className="t-label">
                weakest: {weakest.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          {/*
            Five bars, not five equations.

            The bar is the comparison — five numbers between 0 and 1 are a shape, and a shape is
            read in one glance where a column of decimals has to be read five times. Weight rides
            on the label because a dimension worth 10% dragging is a different problem from one
            worth 30% dragging, and that is the distinction the bare bar would lose.
          */}
          <div className="mt-3 space-y-1.5 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            {DIMENSIONS.map((d) => {
              const value = draft.score_components[d];
              return (
                <div key={d} className="flex items-center gap-2">
                  <span className="t-label w-28 shrink-0 truncate">{d.replace(/_/g, ' ')}</span>
                  <span
                    className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
                    style={{ background: 'var(--surface-sunk)' }}
                    aria-hidden
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.round(value * 100)}%`,
                        background:
                          d === weakest ? 'var(--state-awaiting)' : 'var(--accent-text)',
                      }}
                    />
                  </span>
                  <span className="t-body tabular w-9 shrink-0 text-right font-mono">
                    {value.toFixed(2)}
                  </span>
                  <span className="t-meta tabular w-8 shrink-0 text-right">
                    {Math.round(draft.score_weights[d] * 100)}%
                  </span>
                </div>
              );
            })}
          </div>

          {/* The auditor's view. `<details>` rather than state: it is a disclosure with no other
              behaviour, and the browser already has one. */}
          <details className="mt-3 border-t pt-2.5" style={{ borderColor: 'var(--border)' }}>
            <summary className="t-label cursor-pointer">How this was calculated</summary>
            <div className="mt-2 space-y-1">
              {DIMENSIONS.map((d) => (
                <Stat key={d} label={d.replace(/_/g, ' ')}>
                  {draft.score_components[d].toFixed(2)} × {draft.score_weights[d]} ={' '}
                  {(draft.score_components[d] * draft.score_weights[d]).toFixed(3)}
                </Stat>
              ))}
              <p className="t-meta tabular pt-1">
                sum {draft.composite_score.toFixed(3)}
              </p>
            </div>
          </details>

          {/*
            Stage-1 checks sit strictly outside the rubric and never zero the score (A-10).

            All-pass collapses to a count. Five rows saying "No unresolved placeholders", "No
            outbound links", "No banned phrase present" is five lines spent telling the reviewer
            that nothing is wrong — the definition of noise crowding the queue that A-10 warns
            about. A failure is the opposite and stays expanded, because it is the reason to look.
          */}
          {draft.deterministic_checks.length > 0 &&
            (failedChecks.length === 0 ? (
              <details className="mt-2.5 border-t pt-2.5" style={{ borderColor: 'var(--border)' }}>
                <summary className="t-label cursor-pointer">
                  {draft.deterministic_checks.length} mechanical checks passed
                </summary>
                <ul className="mt-1.5 space-y-1">
                  {draft.deterministic_checks.map((c) => (
                    <li key={c.check} className="t-label">
                      {c.detail}
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <ul
                className="mt-2.5 space-y-1 border-t pt-2.5"
                style={{ borderColor: 'var(--border)' }}
              >
                {failedChecks.map((c) => (
                  <li key={c.check} className="flex items-baseline gap-2">
                    <Badge tone="blocked">{c.result}</Badge>
                    <span className="t-label">{c.detail}</span>
                  </li>
                ))}
                <li className="t-meta">
                  {draft.deterministic_checks.length - failedChecks.length} others passed
                </li>
              </ul>
            ))}
        </Panel>
      </Section>

      {/* 3 · history. Every version kept, never truncated — edit magnitude diffs two of them, so
             dropping any would destroy the measurement. */}
      {draft.versions.length > 1 && (
        <Section title={`History · ${draft.versions.length} versions`}>
          <div className="space-y-1.5">
            {draft.versions.map((v) => (
              <Panel key={v.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={v.author === 'human' ? 'approved' : 'neutral'}>v{v.version}</Badge>
                  <span className="t-meta">
                    {v.author} · {formatRelative(v.created_at)}
                  </span>
                  {v.edit_tags.map((t) => (
                    <Badge key={t} mono>
                      {t.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                </div>
                {/* Superseded text sits at `.t-label`: it is here to be compared against the
                    current version, not read on its own, and rendering it at the same size and
                    contrast as the live post would make the two indistinguishable at a glance. */}
                <p className="t-label mt-1 max-w-[62ch] whitespace-pre-wrap">{v.text}</p>
              </Panel>
            ))}
          </div>
        </Section>
      )}

      {escalations.length > 0 && (
        <Section title="Escalations">
          <Panel>
            {escalations.map((e) => (
              <p key={e.id} className="t-body">
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
          <p className="t-meta tabular mb-2">
            <Link href="/v1/console" className="font-mono" style={{ color: 'var(--accent-text)' }}>
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
