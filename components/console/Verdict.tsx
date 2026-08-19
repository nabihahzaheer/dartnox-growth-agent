'use client';

/**
 * WHY THIS ITEM NEEDS A PERSON — COMPOSED FROM VALUES, NOT WRITTEN.
 *
 * Every row below is a field the record already holds. The score is `composite_score`, the bar is
 * the current `score_threshold`, the weakest dimension is an argmin over `score_components`, the
 * quoted sentence is offsets into a `DraftVersion`, and the check name and mechanism come from the
 * rule. None of it can drift, because nothing wrote it.
 *
 * That matters more than it sounds. An earlier mockup of this block carried the hardcoded sentence
 * "scored 0.73, weakest on claim support" — and computing the argmin for real showed the weakest
 * dimension was *specificity*. The prose had been wrong, and no amount of care would have caught it,
 * because nothing was checking.
 *
 * `rationale` is the single exception and is marked as one. It is model-authored, returned by the
 * same call that produced the verdict, and it appears only where a model decided — a `lookup` that
 * matched a banned phrase has nothing to explain, and this says so rather than inventing prose that
 * would imply a judgement the reviewer could argue with.
 */

import type { Draft, GuardrailEvent, GuardrailRule } from '@/lib/types';

const DIMENSION_LABEL: Record<string, string> = {
  brand_voice: 'brand voice',
  claim_support: 'claim support',
  pillar_fit: 'pillar fit',
  channel_fit: 'channel fit',
  specificity: 'specificity',
};

function weakest(draft: Draft): string {
  const entries = Object.entries(draft.score_components) as [string, number][];
  const [key] = entries.reduce((a, b) => (b[1] < a[1] ? b : a));
  return DIMENSION_LABEL[key] ?? key.replace('_', ' ');
}

export function Verdict({
  draft,
  events,
  rules,
  threshold,
}: {
  draft: Draft;
  events: GuardrailEvent[];
  rules: GuardrailRule[];
  threshold: number;
}) {
  const blocked = draft.state === 'blocked_guardrail';
  /** The event that put this in front of a person. A fail outranks a warn. */
  const event =
    events.find((e) => e.result === 'fail') ?? events.find((e) => e.result === 'warn') ?? null;
  const belowBar = draft.composite_score < threshold;

  if (!blocked && !event && !belowBar) return null;

  const rule = event?.rule_id ? rules.find((r) => r.id === event.rule_id) : undefined;
  const span = event?.offending_span;

  return (
    <div className={`vd ${blocked ? 'vd-stop' : 'vd-attend'}`}>
      {/* Each line says one thing, and the headline names the cause rather than the consequence.
          "This one cannot be approved" told you what you had already worked out from the missing
          Approve button, and told you nothing about why. The other two headlines here name a cause
          — a score, a flag — so this one does too, and the consequence moves to the line below
          where the two ways forward already are. */}
      <p className="vd-head">
        {blocked ? 'Blocked by a guardrail' : belowBar ? 'Scored below your bar' : 'Flagged for a look'}
      </p>
      <p className="vd-lede">
        {blocked
          ? 'Fix it with Edit, or send it back for a redraft.'
          : 'You can still approve it.'}
      </p>

      <dl className="vd-grid">
        {(belowBar || !blocked) && (
          <>
            <dt>score</dt>
            <dd>
              <b>{draft.composite_score.toFixed(3)}</b> against a bar of {threshold.toFixed(2)}
            </dd>
            <dt>weakest</dt>
            <dd>{weakest(draft)}</dd>
          </>
        )}

        {rule && (
          <>
            <dt>check</dt>
            <dd>
              {rule.display_name} · <span className="mono">{rule.mechanism}</span>
            </dd>
          </>
        )}

        {event && (
          <>
            <dt>verdict</dt>
            <dd className={event.result === 'fail' ? 'is-bad' : 'is-warn'}>{event.result}</dd>
          </>
        )}

        {span && !event?.span_withheld && (
          <>
            <dt>sentence</dt>
            {/* Was a white block with a heavy grey left border, which is the generic
                pull-quote treatment. A highlight reads as "this exact span is the problem",
                which is what the offsets on `OffendingSpan` actually mean. */}
            <dd>
              <mark className="vd-mark">{span.text}</mark>
            </dd>
          </>
        )}

        {event?.span_withheld && (
          <>
            <dt>sentence</dt>
            <dd className="vd-withheld">{event.withheld_reason}</dd>
          </>
        )}

        {event?.source_url && (
          <>
            <dt>source</dt>
            <dd className="mono vd-src">{event.source_url.replace(/^https?:\/\//, '')}</dd>
          </>
        )}
      </dl>

      {event?.rationale ? (
        <details className="vd-rat">
          <summary>Why the check says so</summary>
          <p className="vd-rat-text">{event.rationale}</p>
          <p className="vd-rat-note mono">
            returned by the check that produced this verdict, not a separate call
          </p>
        </details>
      ) : (
        event && (
          /* Was "no explanation · a list matched", which is two fragments and a bullet, and reads as
             a failure. It is not: a lookup has nothing to explain *because* it is certain, and
             saying so is the honest version of why some checks reason and others do not. */
          <p className="vd-norat">
            {rule?.mechanism === 'lookup'
              ? 'No explanation needed. This phrase is on your banned list, so the check is a direct match rather than a judgement.'
              : 'No explanation needed. This is a measured distance against your published posts, not a judgement.'}
          </p>
        )
      )}
    </div>
  );
}
