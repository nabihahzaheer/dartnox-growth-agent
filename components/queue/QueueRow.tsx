'use client';

/**
 * ONE ROW OF THE QUEUE.
 *
 * The row has to carry enough to decide without opening anything, because the story this screen
 * serves is an operator clearing a week in one sitting. A-08 calls that payload out: a one-line
 * reason it needs you, the draft itself, then expandable evidence.
 *
 * So the row shows why it is here, what the agent wrote, the score with its arithmetic, and every
 * guardrail result. What it does not show is the full reasoning trace — that is the detail view,
 * and putting it here would make the queue unreadable at forty items.
 */

import Link from 'next/link';
import type { QueueItem } from '@/lib/types';
import { formatRelative } from '@/lib/time';
import { Badge, RUN_STATE_LABEL, guardrailTone, runStateTone } from '@/components/Badge';
import { Countdown } from '@/components/Countdown';

/** Why this item is in front of a person. A-09: in v1 these do not change *whether* a human sees
 *  an item — every post reaches one — they change how it arrives. */
function reasonsFlagged(item: Extract<QueueItem, { kind: 'draft' }>, threshold: number): string[] {
  const reasons: string[] = [];
  if (item.draft.composite_score < threshold) {
    reasons.push(`Scored ${item.draft.composite_score.toFixed(2)}, below ${threshold}`);
  }
  for (const event of item.events) {
    if (event.result === 'warn') reasons.push('A guardrail warned');
    if (event.result === 'fail') reasons.push('A guardrail blocked it');
  }
  if (reasons.length === 0) reasons.push('Every post is reviewed before it publishes');
  return reasons;
}

export function QueueRow({
  item,
  threshold,
  selected,
  busy,
  onSelect,
  onApprove,
  onEdit,
  onReject,
  onEscalate,
}: {
  item: QueueItem;
  threshold: number;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onApprove: () => void;
  onEdit: () => void;
  onReject: () => void;
  onEscalate: () => void;
}) {
  const frame = {
    borderColor: selected ? 'var(--accent-text)' : 'var(--border)',
    background: 'var(--surface)',
  };

  /* ---- run-backed: never became a draft, still needs a person --------------------------------- */
  if (item.kind === 'run') {
    const failure = item.events.find((e) => e.result !== 'pass');
    return (
      <div onFocusCapture={onSelect} onClick={onSelect} className="rounded border px-3 py-2.5" style={frame}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={runStateTone(item.run.state)}>
            {RUN_STATE_LABEL[item.run.state] ?? item.run.state}
          </Badge>
          <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {item.run.id}
          </span>
          <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
            {formatRelative(item.run.started_at)}
          </span>
        </div>

        <p className="mt-1.5 text-[13px]">
          {/* No draft exists to show. That is the point of this arm of the union. */}
          {failure?.detail ?? 'This run stopped and needs a person.'}
        </p>

        {item.run.next_sweep_at !== null && (
          <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Retrying automatically in <Countdown deadline={item.run.next_sweep_at} expiredLabel="any moment" />
            {' · '}nothing to do unless it fails again
          </p>
        )}
      </div>
    );
  }

  /* ---- draft-backed --------------------------------------------------------------------------- */
  const { draft, approval, events } = item;
  const version = draft.versions.find((v) => v.id === draft.current_version_id);
  const flags = reasonsFlagged(item, threshold);
  const belowThreshold = draft.composite_score < threshold;
  const blocked = events.some((e) => e.result === 'fail');

  return (
    <div
      /**
       * `onFocusCapture` as well as `onClick`: tabbing into a row's buttons selects it, so a
       * keyboard user's idea of "the current item" matches the highlight. Without it, Tab moves
       * focus while the selection — and therefore what `a` and `r` act on — stays behind.
       */
      onFocusCapture={onSelect}
      onClick={onSelect}
      className="rounded border px-3 py-2.5"
      style={{ ...frame, opacity: busy ? 0.5 : 1 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={belowThreshold || blocked ? 'awaiting' : 'neutral'}>
          {draft.channel === 'linkedin' ? 'LinkedIn' : 'X'}
        </Badge>
        <span className="text-[13px] font-medium">{flags[0]}</span>
        {events
          .filter((e) => e.result !== 'pass')
          .map((e) => (
            <Badge key={e.id} tone={guardrailTone(e.result)}>
              {e.result}
            </Badge>
          ))}
        <span className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[11px]" style={{ color: 'var(--text-faint)' }}>
            {approval ? `waiting ${formatRelative(approval.queued_at).replace(' ago', '')}` : ''}
          </span>
          {/* The queue carries enough to decide; the detail view is for when it is not enough. */}
          <Link
            href={`/draft/${draft.id}`}
            className="text-[12px]"
            style={{ color: 'var(--accent-text)' }}
          >
            Open
          </Link>
        </span>
      </div>

      {/* The draft itself. Whitespace preserved because line breaks are part of how a post reads. */}
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">{version?.text}</p>

      {/* The score with its arithmetic beside it. A single number hides whether the weights were
          applied at all, and hides which dimension is dragging — which is the thing an operator
          would actually act on. */}
      <details className="mt-2">
        <summary
          className="cursor-pointer font-mono text-[10px] font-bold uppercase"
          style={{ color: 'var(--text-faint)', letterSpacing: '0.1em' }}
        >
          Score {draft.composite_score.toFixed(3)} · {events.length} checks
        </summary>
        <div className="mt-1.5 space-y-1.5">
          <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            {(Object.keys(draft.score_components) as (keyof typeof draft.score_components)[]).map(
              (dimension) => (
                <li key={dimension} className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span style={{ color: 'var(--text-muted)' }}>
                    {dimension.replace(/_/g, ' ')}
                  </span>
                  <span className="font-mono">
                    {draft.score_components[dimension].toFixed(2)}
                    <span style={{ color: 'var(--text-faint)' }}>
                      {' '}
                      × {draft.score_weights[dimension]}
                    </span>
                  </span>
                </li>
              ),
            )}
          </ul>
          <ul className="space-y-0.5">
            {events.map((event) => (
              <li key={event.id} className="flex items-baseline gap-2 text-[12px]">
                <Badge tone={guardrailTone(event.result)}>{event.result}</Badge>
                <span style={{ color: 'var(--text-muted)' }}>{event.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {/*
          Approve is removed where a guardrail *failed*, per A-09. A warn routes to review and can
          be approved past; a fail blocks, and offering the button anyway would make the guardrail
          advisory. The distinction is the whole reason results are three-state.
        */}
        {!blocked && (
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="rounded px-2.5 py-1 text-[13px] font-medium disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Approve
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          className="rounded border px-2.5 py-1 text-[13px] disabled:opacity-40"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="rounded border px-2.5 py-1 text-[13px] disabled:opacity-40"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          Reject
        </button>
        <button
          type="button"
          onClick={onEscalate}
          disabled={busy}
          className="rounded border px-2.5 py-1 text-[13px] disabled:opacity-40"
          style={{ borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }}
        >
          Escalate
        </button>
        {blocked && (
          <span className="text-[12px]" style={{ color: 'var(--state-blocked)' }}>
            Blocked by a guardrail — edit it or drop the slot
          </span>
        )}
      </div>
    </div>
  );
}
