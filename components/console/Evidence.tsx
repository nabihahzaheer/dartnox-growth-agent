'use client';

/**
 * WHAT THE DRAFT WAS BUILT FROM — the fields that were modelled and rendered nowhere.
 *
 * Eight fields on `Draft` reached no screen in the rebuild. That is not a cosmetic gap: one of them
 * is `blocked_reason`, which is *why a draft cannot be approved*, and the operator was being shown a
 * blocked draft with the cause held only in the guardrail event beside it. Others carry the parts of
 * the architecture that are hardest to believe without seeing — the near-duplicate check that runs
 * against both the published corpus and the rest of the batch (N9), the deterministic stage-1 checks
 * that run before any model, and the learned rules the drafting step consumed.
 *
 * ---------------------------------------------------------------------------------------------
 * THREE OF THE EIGHT ARE DELIBERATELY ABSENT, AND IT IS A FIXTURE FACT RATHER THAN A UI ONE
 *
 * `degraded`, `example_refs` and `variant_group_id` are set on **zero** of the thirty drafts. A block
 * rendering them would be a state no reviewer could ever reach — the same defect as an error state
 * nothing can trigger, which this codebase has now been caught with twice. They are handled below
 * anyway, so that fixturing any of them later lights the row up without a code change; what is not
 * done is inventing an empty row to look thorough.
 *
 * The honest consequence, worth stating rather than hiding: `Draft.degraded` exists so the model-tier
 * fallback has a surface, and `lib/types.ts` says exactly that ("without its own field the fallback
 * path has zero surface anywhere in the product"). With no fixture setting it, the fallback path
 * still has no surface. The field is not the gap; the dataset is.
 */

import type { Draft, ReflectionRule } from '@/lib/types';

const CHECK_LABEL: Record<string, string> = {
  length: 'Length within the channel limit',
  placeholders: 'No unfilled placeholders',
  disclaimers: 'Required disclaimers present',
  links: 'Links resolve and are allowlisted',
  banned_exact_match: 'No banned phrase, matched exactly',
};

const BLOCKED_LABEL: Record<string, string> = {
  banned_claim: 'Contains a banned phrase',
  regulated_claim: 'Makes a regulated claim',
  unapproved_entity: 'Names an entity that is not approved',
  pii_detected: 'Contains personal details',
  link_not_allowlisted: 'Links somewhere not allowlisted',
  injection_archived: 'Built from a source carrying hidden instructions',
  channel_disconnected: 'The channel is disconnected',
  pillar_paused: 'Its pillar is paused',
};

export function Evidence({ draft, rules }: { draft: Draft; rules: ReflectionRule[] }) {
  const checks = draft.deterministic_checks ?? [];
  const sources = draft.source_refs ?? [];
  const sim = draft.similarity;

  const hasAny =
    draft.blocked_reason !== null ||
    draft.degraded ||
    sim !== null ||
    checks.length > 0 ||
    sources.length > 0 ||
    rules.length > 0;

  if (!hasAny) return null;

  return (
    <section className="section">
      <h3 className="sec">What it was built from</h3>
      <div className="panel ev">
        {/* First, because on a blocked draft it is the answer to the only question being asked. */}
        {draft.blocked_reason && (
          <div className="ev-row ev-stop">
            <p className="ev-k">Blocked</p>
            <p className="ev-v">
              <b>{BLOCKED_LABEL[draft.blocked_reason.code] ?? draft.blocked_reason.code}</b>
              {draft.blocked_reason.note && <> — {draft.blocked_reason.note}</>}
            </p>
          </div>
        )}

        {draft.degraded && (
          <div className="ev-row ev-attend">
            <p className="ev-k">Model</p>
            <p className="ev-v">
              Written by the fallback tier after the capable model was unavailable. Policy routes
              this to a person regardless of score.
            </p>
          </div>
        )}

        {sim && (
          <div className="ev-row">
            <p className="ev-k">Near-duplicate</p>
            <p className="ev-v">
              {/* Both arms, because N9 is conjunctive — against the published corpus *and* against
                  the rest of this batch. Rendering one would misrepresent the check as a lookup
                  against history only, which is the version that misses the intra-batch case. */}
              {sim.published && (
                <>
                  {(sim.published.max_cosine * 100).toFixed(0)}% similar to a post from the last{' '}
                  {sim.window_days} days
                  <span className="mono ev-id"> {sim.published.against_post_id}</span>
                </>
              )}
              {sim.published && sim.batch && <br />}
              {sim.batch && (
                <>
                  {(sim.batch.max_cosine * 100).toFixed(0)}% similar to another draft in this batch
                  <span className="mono ev-id"> {sim.batch.against_draft_id}</span>
                </>
              )}
              {!sim.published && !sim.batch && 'Checked against both, nothing close.'}
            </p>
          </div>
        )}

        {checks.length > 0 && (
          <div className="ev-row">
            <p className="ev-k">Checks before scoring</p>
            <div className="ev-v">
              {/* Stage 1 of A-10: deterministic, no model involved, and strictly outside the rubric
                  — these never move the score, they only pass or fail. */}
              <ul className="ev-checks">
                {checks.map((c) => (
                  <li key={c.check}>
                    <span className={`ev-tick ${c.result === 'pass' ? 'is-pass' : 'is-fail'}`} aria-hidden>
                      {c.result === 'pass' ? '✓' : '✕'}
                    </span>
                    <span className="sr-only">{c.result === 'pass' ? 'passed' : 'failed'}</span>
                    {CHECK_LABEL[c.check] ?? c.check}
                    {c.detail && <span className="ev-detail"> — {c.detail}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {rules.length > 0 && (
          <div className="ev-row">
            <p className="ev-k">Rules applied</p>
            <div className="ev-v">
              {/* Learned from the operator's own past edits. This is the only place in the product
                  where the reflection loop's output is visible on the thing it shaped. */}
              <ul className="ev-rules">
                {rules.map((r) => (
                  <li key={r.id}>
                    {r.text}
                    <span className="ev-detail"> · learned from {r.evidence_tag.replace(/_/g, ' ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {sources.length > 0 && (
          <div className="ev-row">
            <p className="ev-k">Sources</p>
            <div className="ev-v">
              <ul className="ev-rules">
                {sources.map((src) => (
                  <li key={src} className="mono ev-src">
                    {src.replace(/^https?:\/\//, '')}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
