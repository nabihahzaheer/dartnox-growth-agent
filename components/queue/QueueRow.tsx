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
 *
 * IT NO LONGER SHOWS THE BUTTONS EITHER. The decision surface is `DecisionControls`, rendered by
 * the console as well, and this component takes it as a slot. What is left here is the evidence,
 * which is what the row was always about.
 */

import Link from 'next/link';
import type { Draft, QueueItem } from '@/lib/types';
import { formatRelative } from '@/lib/time';
import { Badge, RUN_STATE_LABEL, guardrailTone, runStateTone } from '@/components/Badge';
import { Countdown } from '@/components/Countdown';

/**
 * The draft an item is about, where it has one.
 *
 * Two of the three arms carry a draft and one does not, which is the whole reason the queue is a
 * union. Every caller that wants "the text and the decision target" goes through this rather than
 * branching on `kind` again.
 */
export function draftOf(item: QueueItem): Draft | null {
  if (item.kind === 'draft') return item.draft;
  if (item.kind === 'post') return item.draft;
  return null;
}

/** A stable key and a busy-state target for every arm. */
export function itemId(item: QueueItem): string {
  if (item.kind === 'draft') return item.draft.id;
  if (item.kind === 'post') return item.post.id;
  return item.run.id;
}

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
  controls,
}: {
  item: QueueItem;
  threshold: number;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  /**
   * The decision surface, built by the screen and slotted in.
   *
   * It was four callbacks — `onApprove`, `onEdit`, `onReject`, `onEscalate` — which made this
   * component a second place that knew what the buttons are called and which arms offer which.
   * `DecisionControls` owns both now, so the row's job is back to what it says on the header: lay
   * out what a person needs in order to decide. `null` on the run arm, which has no draft to
   * decide against.
   */
  controls: React.ReactNode;
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
          <span className="t-meta font-mono" style={{ color: 'var(--text-muted)' }}>
            {item.run.id}
          </span>
          <span className="t-meta">{formatRelative(item.run.started_at)}</span>
        </div>

        <p className="t-body mt-1.5">
          {/* No draft exists to show. That is the point of this arm of the union. */}
          {failure?.detail ?? 'This run stopped and needs a person.'}
        </p>

        {item.run.next_sweep_at !== null && (
          <p className="t-label mt-1">
            Retries in{' '}
            <Countdown
              deadline={item.run.next_sweep_at}
              expiredLabel="any moment"
              className="tabular"
            />
          </p>
        )}
      </div>
    );
  }

  /* ---- post-backed: approved, scheduled, then un-approved by a settings change (D-043) --------- *
   *
   * The row leads with what changed rather than with the post, because the operator already
   * approved this text once. The question in front of them is not "is this good" — they answered
   * that — it is "a rule I just added catches something I already said yes to."
   * -------------------------------------------------------------------------------------------- */
  if (item.kind === 'post') {
    const scheduledVersion = item.draft.versions.find(
      (v) => v.id === item.post.draft_version_id,
    );
    return (
      <div
        onFocusCapture={onSelect}
        onClick={onSelect}
        className="rounded border px-3 py-2.5"
        style={{ ...frame, opacity: busy ? 0.5 : 1 }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="blocked">Returned to you</Badge>
          <Badge tone="neutral">{item.post.channel === 'linkedin' ? 'LinkedIn' : 'X'}</Badge>
          <span className="t-body font-medium">Caught by a rule you changed</span>
          <span className="ml-auto flex items-center gap-2">
            <span className="t-meta tabular font-mono">
              was publishing {formatRelative(item.post.scheduled_at)}
            </span>
            <Link
              href={`/v1/draft/${item.draft.id}`}
              className="t-label"
              style={{ color: 'var(--accent-text)' }}
            >
              Open
            </Link>
          </span>
        </div>

        {/* The rule that did it, named. A post that reappears without saying why is indistinguishable
            from a bug, and `invalidated_reason` exists on the record for this sentence. */}
        {item.post.invalidated_reason && (
          <p
            className="t-label mt-1.5 rounded px-2 py-1"
            style={{ background: 'var(--state-blocked-bg)', color: 'var(--state-blocked)' }}
          >
            {item.post.invalidated_reason}
          </p>
        )}

        <p className="mt-2 t-body whitespace-pre-wrap">
          {scheduledVersion?.text}
        </p>

        <p className="t-label mt-2">Nothing was sent.</p>

        <div className="mt-2.5">{controls}</div>
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
        <span className="t-body font-medium">{flags[0]}</span>
        {events
          .filter((e) => e.result !== 'pass')
          .map((e) => (
            <Badge key={e.id} tone={guardrailTone(e.result)}>
              {e.result}
            </Badge>
          ))}
        <span className="ml-auto flex items-center gap-2">
          <span className="t-meta tabular font-mono">
            {approval ? `waiting ${formatRelative(approval.queued_at).replace(' ago', '')}` : ''}
          </span>
          {/* The queue carries enough to decide; the detail view is for when it is not enough. */}
          <Link
            href={`/v1/draft/${draft.id}`}
            className="t-label"
            style={{ color: 'var(--accent-text)' }}
          >
            Open
          </Link>
        </span>
      </div>

      {/* The draft itself. Whitespace preserved because line breaks are part of how a post reads. */}
      <p className="mt-2 t-body whitespace-pre-wrap">{version?.text}</p>

      {/* The score with its arithmetic beside it. A single number hides whether the weights were
          applied at all, and hides which dimension is dragging — which is the thing an operator
          would actually act on. */}
      <details className="mt-2">
        {/* `.t-field` and not a heading class: this labels a stat block, which is the one job the
            PDF's mono-caps FIELD role has. It also raises the old 10px off the floor. */}
        <summary className="t-field tabular cursor-pointer">
          Score {draft.composite_score.toFixed(3)} · {events.length} checks
        </summary>
        <div className="mt-1.5 space-y-1.5">
          <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            {(Object.keys(draft.score_components) as (keyof typeof draft.score_components)[]).map(
              (dimension) => (
                <li key={dimension} className="t-label flex items-baseline justify-between gap-2">
                  <span>{dimension.replace(/_/g, ' ')}</span>
                  <span className="tabular font-mono">
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
              <li key={event.id} className="t-label flex items-baseline gap-2">
                <Badge tone={guardrailTone(event.result)}>{event.result}</Badge>
                <span>{event.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>

      {/* Approve-removed-when-blocked (A-09) moved into `DecisionControls` with the buttons: it is
          a rule about the decision surface, and leaving it here would have been the second place
          that knew it. */}
      <div className="mt-2.5">{controls}</div>
    </div>
  );
}
