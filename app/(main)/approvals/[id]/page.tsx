'use client';

/**
 * ONE ITEM, OPENED IN FULL.
 *
 * The brief's fourth screen: "the agent's reasoning trace and history." History was the one thing
 * missing from the rebuild until this page — the console's card shows the current text and nothing
 * before it, and `DraftVersion[]` already carries every prior draft with who wrote it and what
 * changed, unrendered anywhere.
 *
 * Order matches the thirty seconds a reviewer actually has: the post, then why it needs them, then
 * how it scored, then what changed to get here, then the full trace behind all of it. The trace is
 * last because it is the least-asked question — everything above it is already the answer to "is
 * this safe to publish", and the trace is where an engineer's "why" goes when someone asks it.
 */

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getDraftDetail,
  getGuardrailRules,
  getSettings,
  labelEscalationUnnecessary,
} from '@/lib/agentClient';
import type { DraftDetail } from '@/lib/agentClient';
import type { ConsoleError, DraftId, GuardrailRule, Settings } from '@/lib/types';
import { asConsoleError } from '@/lib/errorCopy';
import { DecisionBar } from '@/components/console/DecisionBar';
import { Evidence } from '@/components/console/Evidence';
import { EscalationLabel } from '@/components/console/EscalationLabel';
import { formatDateTime } from '@/lib/time';
import { EmptyState, LoadError, LoadingState } from '@/components/ScreenState';
import { StepTimeline } from '@/components/console/StepTimeline';
import { Verdict } from '@/components/console/Verdict';

const CHANNEL_LABEL: Record<string, string> = { linkedin: 'LinkedIn', x: 'X' };

const TAG_LABEL: Record<string, string> = {
  tightened: 'Tightened',
  claim_softened: 'Claim softened',
  jargon_removed: 'Jargon removed',
  specific_detail_added: 'Specific detail added',
  cta_changed: 'Call to action changed',
  hook_rewritten: 'Opening line rewritten',
  length_cut: 'Cut for length',
  terminology_corrected: 'Terminology corrected',
  client_example_added: "Client's own example added",
};

export default function DraftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const draftId = id as DraftId;

  const [detail, setDetail] = useState<DraftDetail | null>(null);
  const [rules, setRules] = useState<GuardrailRule[] | null>(null);
  /** For the reject dialog's options. `Settings.rejection_reason_set` decides which members of the
   *  fixed taxonomy are offered, so the picker is an operator control rather than a constant. */
  const [settings, setSettings] = useState<Settings | null>(null);
  /**
   * One `ConsoleError` rather than a string plus a separate `notFound` boolean.
   *
   * The pair was two representations of one fact, and they could disagree — nothing stopped both
   * being set. The kind already carries the distinction, and `not_found` is branched on below
   * exactly as before.
   */
  const [error, setError] = useState<ConsoleError | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, r, st] = await Promise.all([
        getDraftDetail(draftId),
        getGuardrailRules(),
        getSettings(),
      ]);
      setDetail(d);
      setRules(r);
      setSettings(st);
      setError(null);
    } catch (e) {
      setError(asConsoleError(e));
    }
  }, [draftId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  if (error && error.kind === 'not_found') {
    return (
      <EmptyState
        title="This draft isn’t here any more."
        detail="It may have been withdrawn, or the slot may have been dropped."
      >
        <Link href="/approvals" className="btn" style={{ display: 'inline-block', marginTop: 13 }}>
          Back to approvals
        </Link>
      </EmptyState>
    );
  }

  if (error) {
    return <LoadError error={error} onRetry={() => void load()} />;
  }

  if (!detail || !rules) {
    return <LoadingState lines={3} label="Loading the draft" />;
  }

  const { draft, run, steps, events, slot, pillar } = detail;
  const version = draft.versions.find((v) => v.id === draft.current_version_id);

  /**
   * A FOUND BUG, LEFT VISIBLE RATHER THAN QUIETLY FIXED IN THE API.
   *
   * The interrupt step is a historical record of what a run stopped at — it stays in `steps`
   * forever, options and all, even once the draft it gated has been decided. Testing an approve
   * from this page against a live draft showed the Approve button still rendered afterwards,
   * because the step's `options` never change; only the draft's `state` does.
   *
   * The fix is here rather than in `getBatch`/`getDraftDetail`, because the interrupt genuinely is
   * an accurate record of that moment and changing it would make the trace lie about the past. What
   * was missing is the caller checking whether the draft is *still* in a state a decision applies
   * to — the same check the console and the approvals list already make before rendering a card at
   * all. This page opens by direct link, including to an already-decided draft, so it has to make
   * the check itself rather than relying on an upstream filter.
   */
  const decidable = draft.state === 'awaiting_approval' || draft.state === 'blocked_guardrail';
  const gate = decidable ? (steps.find((s) => s.interrupt !== null)?.interrupt ?? null) : null;
  const offers = gate?.options ?? [];
  const history = [...draft.versions].sort((a, b) => b.version - a.version);

  return (
    <>
      <p className="crumb">
        <Link href="/approvals">Approvals</Link> <span aria-hidden>/</span>{' '}
        <span className="mono">{draft.id}</span>
      </p>

      <header className="page-head">
        <h1 className="page-title">{slot?.angle ?? 'Untitled slot'}</h1>
        <p className="page-sub">
          {CHANNEL_LABEL[draft.channel]}
          {pillar && <> · {pillar.name}</>}
          {/* Was `new Date().toLocaleDateString()` — today's date, on every draft, labelled as the
              slot's publish time. Both a wrong number and a D-030 hydration hazard: the server and
              the browser read the clock at different instants. `formatDateTime` resolves the slot's
              own offset against the build-fixed anchor, so it is the right value and both renders
              agree. */}
          {slot && <> · publishes {formatDateTime(slot.publish_at)}</>}
        </p>
      </header>

      <article className="card">
        <div className="card-body">
          <p className="prov">
            <i aria-hidden />
            {version?.author === 'human' ? 'Last edited by the operator' : 'Agent draft · nobody has read it yet'}
          </p>
          <p className="post">{version?.text}</p>
          <Verdict draft={draft} events={events} rules={rules} threshold={detail.threshold} />
        </div>

        {version && offers.length > 0 && (
          <DecisionBar
            draft={draft}
            version={version}
            options={offers}
            reasons={settings?.rejection_reason_set ?? []}
            onDecided={() => void load()}
          />
        )}
      </article>

      <Evidence draft={draft} rules={detail.appliedRules} />

      {/**
       * The one-click control that makes escalation precision a real metric, which had no surface.
       *
       * `lib/types.ts` calls `was_unnecessary` "the shortest causal chain in the product between an
       * action and a metric", and the rebuild left it unreachable — so the Results tile read 66.7%
       * over three labels with seven escalations unlabelled and no way to label them. A metric that
       * cannot move is a decoration.
       */}
      {events.filter((e) => e.escalation_tier !== 'none').map((e) => (
        <EscalationLabel
          key={e.id}
          event={e}
          onLabel={async (unnecessary) => {
            await labelEscalationUnnecessary(e.id, unnecessary);
            await load();
          }}
        />
      ))}

      {history.length > 1 && (
        <section>
          <h3 className="sec">
            History <span className="sec-n">{history.length} versions</span>
          </h3>
          <ol className="hist">
            {history.map((v) => (
              <li key={v.id} className="hist-row">
                <span className={`hist-dot ${v.author === 'human' ? 'hist-human' : 'hist-agent'}`} aria-hidden />
                <div className="hist-body">
                  <p className="hist-head">
                    <b>v{v.version}</b>
                    <span className="mono hist-author">{v.author === 'human' ? 'operator' : 'agent'}</span>
                    {v.id === draft.current_version_id && <span className="pill pill-go">current</span>}
                  </p>
                  {v.edit_tags.length > 0 && (
                    <p className="hist-tags">
                      {v.edit_tags.map((t) => (
                        <span key={t} className="tag-soft">
                          {TAG_LABEL[t] ?? t}
                        </span>
                      ))}
                    </p>
                  )}
                  <p className="hist-text">{v.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section>
        <h3 className="sec">
          Reasoning trace <span className="sec-n">{steps.length} steps</span>
        </h3>
        <div className="panel" style={{ padding: '6px 16px' }}>
          <StepTimeline steps={steps} events={events} rules={rules} />
        </div>
        {run && (
          <p className="trace-foot mono">
            {run.id} · {run.trigger} · {run.state}
          </p>
        )}
      </section>
    </>
  );
}
