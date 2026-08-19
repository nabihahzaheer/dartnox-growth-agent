'use client';

/**
 * ONE DRAFT, WAITING ON A PERSON.
 *
 * The post is the largest thing on the card and sits above every control, which is the whole
 * correction this rebuild exists to make: v1's approval gate asked for a decision with the text
 * nowhere on screen.
 *
 * The controls are rendered from `gate.options` rather than chosen here. A blocked draft's gate
 * omits `approve`, so this component does not decide which button to disable — it renders what the
 * gate offers. Two screens cannot then disagree about a rule the architecture states once, and
 * `scripts/check.mts` asserts the gate rather than trusting a component to remember.
 *
 * `secondsOpen` starts when the card mounts. That figure feeds the "decided under 15 seconds"
 * alarm, which is the signal that review has stopped being real — so it has to measure how long the
 * post was actually in front of someone, not how long the request took.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { BatchChild } from '@/lib/agentClient';
import { submitReview } from '@/lib/agentClient';
import type { GuardrailRule, InterruptOption, RunStep } from '@/lib/types';
import { StepTimeline } from './StepTimeline';
import { Verdict } from './Verdict';

const CHANNEL_LABEL: Record<string, string> = { linkedin: 'LinkedIn', x: 'X' };

/** Module scope on purpose. Reading the clock inside a component body — even in a handler defined
 *  there — is flagged as impure, and the rule is right in general: anything defined in the body can
 *  in principle run during render. Hoisting it makes the impurity explicit and keeps the component
 *  itself a pure function of its props. */
function elapsedSeconds(since: number): number {
  return Math.round((Date.now() - since) / 1000);
}

const ACTION_LABEL: Partial<Record<InterruptOption, string>> = {
  approve: 'Approve',
  /** Zendesk's distinction, and free provenance: the label records whether a human changed it. */
  approve_with_edits: 'Edit',
  reject: 'Send back',
  escalate: 'Ask the owner',
};

export function DraftCard({
  child,
  steps,
  rules,
  threshold,
  onDecided,
}: {
  child: BatchChild;
  steps: RunStep[];
  rules: GuardrailRule[];
  threshold: number;
  onDecided: () => void;
}) {
  const [showTrace, setShowTrace] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Zero until mounted, then stamped in an effect. `useRef(Date.now())` would call an impure
   * function on every render — the value is discarded after the first, but the call still happens,
   * and ESLint is right that a component reading the clock during render is unstable by
   * construction. The effect also re-stamps when the card switches to a different draft.
   */
  const openedAt = useRef(0);

  useEffect(() => {
    openedAt.current = Date.now();
  }, [child.draft?.id]);

  const draft = child.draft;
  if (!draft) return null;

  const version = draft.versions.find((v) => v.id === draft.current_version_id);
  const blocked = draft.state === 'blocked_guardrail';
  const offers = child.gate?.options ?? [];

  async function decide(option: InterruptOption) {
    if (!draft || !version) return;
    setBusy(option);
    setError(null);
    const secondsOpen = elapsedSeconds(openedAt.current);
    try {
      /** Derived, not random: a replayed key returns the original result rather than deciding
       *  twice, which is the property a real API would need and the reason the key exists. */
      const idempotencyKey = `review:${draft.id}:${version.id}:${option}`;
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
          { kind: 'escalate', tier: 'stakeholder', detail: 'Sent to the owner from the console.' },
          { idempotencyKey, secondsOpen },
        );
      } else {
        setBusy(null);
        return; // the editor lands in a later step
      }
      onDecided();
    } catch {
      setError('That did not go through. Nothing was decided.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className={`card${blocked ? ' card-stop' : ''}`}>
      <header className="card-head">
        <span
          className="ch-dot"
          style={{ background: `var(--ch-${draft.channel})` }}
          aria-hidden
        />
        <span>{CHANNEL_LABEL[draft.channel]}</span>
        <span aria-hidden>·</span>
        <span>{child.slot?.angle ?? 'Untitled slot'}</span>
        <span className="card-state">
          {blocked ? (
            <span className="pill pill-stop">blocked</span>
          ) : draft.composite_score < threshold ? (
            <span className="pill pill-attend">flagged</span>
          ) : (
            <span className="pill pill-go">ready</span>
          )}
        </span>
      </header>

      <div className="card-body">
        <p className="prov">
          <i aria-hidden /> Agent draft · nobody has read it yet
        </p>
        <p className="post">{version?.text}</p>
        <Verdict draft={draft} events={child.events} rules={rules} threshold={threshold} />
      </div>

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
        <button type="button" className="trace-link" onClick={() => setShowTrace((v) => !v)}>
          <span className={`trace-car${showTrace ? ' is-open' : ''}`} aria-hidden>
            ▶
          </span>
          {steps.length} steps
        </button>
        <Link href={`/approvals/${draft.id}`} className="trace-link">
          Open in full →
        </Link>
      </footer>

      {error && <p className="card-err">{error}</p>}

      {showTrace && (
        <div className="card-trace">
          <StepTimeline steps={steps} events={child.events} rules={rules} />
        </div>
      )}
    </article>
  );
}
