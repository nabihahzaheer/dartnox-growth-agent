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

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getDraftDetail, getGuardrailRules, submitReview } from '@/lib/agentClient';
import type { DraftDetail } from '@/lib/agentClient';
import type { DraftId, GuardrailRule, InterruptOption } from '@/lib/types';
import { StepTimeline } from '@/components/console/StepTimeline';
import { Verdict } from '@/components/console/Verdict';

const CHANNEL_LABEL: Record<string, string> = { linkedin: 'LinkedIn', x: 'X' };

const ACTION_LABEL: Partial<Record<InterruptOption, string>> = {
  approve: 'Approve',
  approve_with_edits: 'Edit',
  reject: 'Send back',
  escalate: 'Ask the owner',
};

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

function elapsedSeconds(since: number): number {
  return Math.round((Date.now() - since) / 1000);
}

export default function DraftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const draftId = id as DraftId;

  const [detail, setDetail] = useState<DraftDetail | null>(null);
  const [rules, setRules] = useState<GuardrailRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** A ref, not state — the value is read once inside `decide()` and never rendered, so setting it
   *  through state would cost a render for nothing and trip the same impure-during-render rule
   *  `DraftCard` hits for the same reason. */
  const openedAt = useRef(0);

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([getDraftDetail(draftId), getGuardrailRules()]);
      setDetail(d);
      setRules(r);
      setError(null);
      setNotFound(false);
    } catch (e) {
      if (e && typeof e === 'object' && 'kind' in e && e.kind === 'not_found') {
        setNotFound(true);
      } else {
        setError('Could not reach the agent. Nothing has been lost — try again.');
      }
    }
  }, [draftId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    openedAt.current = Date.now();
  }, [draftId]);

  if (notFound) {
    return (
      <div className="panel state-panel">
        <p className="state-title">This draft isn&rsquo;t here any more.</p>
        <p className="state-sub">It may have been withdrawn, or the slot may have been dropped.</p>
        <Link href="/approvals" className="btn" style={{ display: 'inline-block', marginTop: 13 }}>
          Back to approvals
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel state-panel">
        <p className="state-title">{error}</p>
        <button type="button" className="btn" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  if (!detail || !rules) {
    return (
      <div className="panel state-panel">
        <p className="skeleton" />
        <p className="skeleton short" />
      </div>
    );
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

  async function decide(option: InterruptOption) {
    if (!version) return;
    setBusy(option);
    try {
      const idempotencyKey = `review:${draft.id}:${version.id}:${option}`;
      const secondsOpen = elapsedSeconds(openedAt.current);
      if (option === 'approve') {
        await submitReview(draft.id, version.id, { kind: 'approve' }, { idempotencyKey, secondsOpen });
      } else if (option === 'reject') {
        await submitReview(
          draft.id,
          version.id,
          { kind: 'reject', reasonCode: 'claim_unsupported', note: null },
          { idempotencyKey, secondsOpen },
        );
      } else if (option === 'escalate') {
        await submitReview(
          draft.id,
          version.id,
          { kind: 'escalate', tier: 'stakeholder', detail: 'Sent to the owner from the detail view.' },
          { idempotencyKey, secondsOpen },
        );
      } else {
        setBusy(null);
        return;
      }
      await load();
    } catch {
      setError('That did not go through. Nothing was decided.');
    } finally {
      setBusy(null);
    }
  }

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
          {slot && <> · publishes at slot {new Date().toLocaleDateString()}</>}
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

        {offers.length > 0 && (
          <footer className="card-act">
            {offers.map((option) => {
              const label = ACTION_LABEL[option];
              if (!label) return null;
              return (
                <button
                  key={option}
                  type="button"
                  className={`btn${option === 'approve' ? ' btn-primary' : ''}`}
                  disabled={busy !== null}
                  onClick={() => decide(option)}
                >
                  {busy === option ? '…' : label}
                </button>
              );
            })}
          </footer>
        )}
      </article>

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
