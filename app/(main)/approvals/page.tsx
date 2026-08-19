'use client';

/**
 * MY APPROVALS — the whole queue, not just this batch.
 *
 * The console shows Wednesday's batch, because that is the unit the operator's morning is. This
 * screen is the wider net underneath it: `getQueue()`'s three-way union, which is a draft awaiting
 * a decision, a run that never produced a draft because its source was quarantined, or a post whose
 * approval no longer holds under a settings change made after it was scheduled.
 *
 * A queue typed as an array of drafts would silently drop the two most interesting cases in the
 * system, which is D-033's own reasoning and the one this screen exists to honour. A quarantined
 * run has no draft to open, so it renders inline rather than linking to a detail page that does not
 * exist for it — the board is explicit that the operator sees the rule, the verdict and the domain,
 * and never the withheld text.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getQueue, subscribeToWorld } from '@/lib/agentClient';
import type { QueueItem } from '@/lib/types';

const CHANNEL_LABEL: Record<string, string> = { linkedin: 'LinkedIn', x: 'X' };

/** `park_reason` is a code, not a sentence — rendering it raw would print `upstream_error` at an
 *  operator. This is the plain-language side of the same taxonomy `StepTimeline`'s detail rows
 *  render as a code, because that row is for an engineer's question and this one is for a queue. */
const PARK_LABEL: Record<string, string> = {
  upstream_error: 'A source did not respond. Retrying automatically.',
  rate_limited: 'A platform is rate-limiting requests. Retrying automatically.',
  auth_failed: 'The channel login was revoked. Waiting to be reconnected.',
  injection_quarantine: 'A source carried instructions aimed at the agent.',
  budget_admission_stop: 'The monthly budget cap was reached.',
  awaiting_reconcile: 'A publish call timed out. Checking whether it went out before trying again.',
};

export default function ApprovalsPage() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const queue = await getQueue();
      setItems(queue);
      setError(null);
    } catch {
      setError('Could not reach the agent. Nothing has been lost — try again.');
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
        <h1 className="page-title">My approvals</h1>
        <p className="page-sub">
          Everything waiting on a person, in the order it started waiting: drafts to decide,
          sources the agent stopped on, and posts a settings change sent back.
        </p>
      </header>

      {error && (
        <div className="panel state-panel">
          <p className="state-title">{error}</p>
          <button type="button" className="btn" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {!error && !items && (
        <div className="panel state-panel">
          <p className="skeleton" />
          <p className="skeleton short" />
        </div>
      )}

      {!error && items && items.length === 0 && (
        <div className="panel state-panel">
          <p className="state-title">Nothing waiting.</p>
          <p className="state-sub">The next drafting batch runs Wednesday at 06:00.</p>
        </div>
      )}

      {!error && items && items.length > 0 && (
        <div className="stack">
          {items.map((item) => (
            <QueueRow key={rowKey(item)} item={item} />
          ))}
        </div>
      )}
    </>
  );
}

function rowKey(item: QueueItem): string {
  if (item.kind === 'draft') return `draft-${item.draft.id}`;
  if (item.kind === 'run') return `run-${item.run.id}`;
  return `post-${item.post.id}`;
}

function QueueRow({ item }: { item: QueueItem }) {
  if (item.kind === 'draft') {
    const version = item.draft.versions.find((v) => v.id === item.draft.current_version_id);
    const blocked = item.draft.state === 'blocked_guardrail';
    return (
      <Link href={`/approvals/${item.draft.id}`} className={`qrow${blocked ? ' qrow-stop' : ''}`}>
        <span
          className="ch-dot"
          style={{ background: `var(--ch-${item.draft.channel})` }}
          aria-hidden
        />
        <div className="qrow-body">
          <p className="qrow-title">
            {CHANNEL_LABEL[item.draft.channel]}
            <span aria-hidden> · </span>
            <span className="qrow-excerpt">{version?.text.slice(0, 90)}…</span>
          </p>
        </div>
        <span className={`pill ${blocked ? 'pill-stop' : 'pill-attend'}`}>
          {blocked ? 'blocked' : 'needs you'}
        </span>
      </Link>
    );
  }

  if (item.kind === 'run') {
    const quarantined = item.run.state === 'quarantined';
    return (
      <div className={`qrow qrow-static${quarantined ? ' qrow-stop' : ''}`}>
        <span className="qrow-glyph" aria-hidden>
          {quarantined ? '⚠' : '⏸'}
        </span>
        <div className="qrow-body">
          <p className="qrow-title mono">{item.run.id}</p>
          <p className="qrow-sub">
            {quarantined
              ? 'Quarantined before drafting; no draft was produced. The source and its instructions are not shown — you may be their target.'
              : (item.run.park_reason ? PARK_LABEL[item.run.park_reason] : 'Parked, waiting to resume.')}
          </p>
        </div>
        <span className="pill pill-attend">{quarantined ? 'quarantined' : 'parked'}</span>
      </div>
    );
  }

  const version = item.draft.versions.find((v) => v.id === item.draft.current_version_id);
  return (
    <Link href={`/approvals/${item.draft.id}`} className="qrow">
      <span
        className="ch-dot"
        style={{ background: `var(--ch-${item.post.channel})` }}
        aria-hidden
      />
      <div className="qrow-body">
        <p className="qrow-title">
          Sent back — settings changed after this was approved
          <span aria-hidden> · </span>
          <span className="qrow-excerpt">{version?.text.slice(0, 70)}…</span>
        </p>
        <p className="qrow-sub">{item.post.invalidated_reason}</p>
      </div>
      <span className="pill pill-attend">needs re-approval</span>
    </Link>
  );
}
