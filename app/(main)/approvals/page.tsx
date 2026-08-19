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

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { getQueue } from '@/lib/agentClient';
import type { ConsoleError, QueueItem } from '@/lib/types';
import { asConsoleError } from '@/lib/errorCopy';
import { useWorldRead } from '@/lib/useWorldRead';
import { EmptyState, LoadError, LoadingState, StaleWarning } from '@/components/ScreenState';
import { CHANNEL_LABEL, ChannelMark } from '@/components/ChannelMark';
import { formatDateTime } from '@/lib/time';

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
  const [error, setError] = useState<ConsoleError | null>(null);

  const load = useCallback(async () => {
    try {
      const queue = await getQueue();
      setItems(queue);
      setError(null);
    } catch (e) {
      setError(asConsoleError(e));
    }
  }, []);

  useWorldRead(load);

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Queue</h1>
        {/* Says what the list holds. It said "Most urgent first, then oldest", which describes a
            sort nobody asked about and skips the useful part: this list is wider than approvals —
            it also carries runs that produced nothing and posts a settings change pulled back. */}
        <p className="page-sub">
          Everything this week that has stopped somewhere: drafts to decide, runs that produced
          nothing, and posts sent back by a settings change.
        </p>
      </header>

      {error && !items && <LoadError error={error} onRetry={() => void load()} />}
      {error && items && <StaleWarning error={error} onRetry={() => void load()} />}

      {!error && !items && <LoadingState lines={3} label="Loading the queue" />}

      {!error && items && items.length === 0 && (
        <EmptyState
          title="Nothing waiting."
          detail="The next drafting batch runs Wednesday at 06:00."
        />
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

/** The opening sentence, capped. Falls back to a hard cut only if the text has no sentence break
 *  inside a reasonable length. */
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const stop = flat.search(/[.!?](\s|$)/);
  if (stop > 0 && stop < 110) return flat.slice(0, stop + 1);
  return flat.length > 110 ? `${flat.slice(0, 108).trimEnd()}…` : flat;
}

function QueueRow({ item }: { item: QueueItem }) {
  const [open, setOpen] = useState(false);

  /**
   * A RUN IS NOT A DRAFT, AND THE LIST HAS TO SHOW THAT BEFORE IT IS CLICKED.
   *
   * Every row used to render the same white card with the same amber pill, so a quarantined run —
   * which opens nothing, because no draft exists behind it — looked exactly like a draft you could
   * decide. Runs are now flat and greyed with no chevron; drafts and posts are raised, expandable,
   * and carry a channel mark with its name beside it rather than a bare coloured dot.
   */
  if (item.kind === 'run') {
    const quarantined = item.run.state === 'quarantined';
    /**
     * A run opens too, and it opens onto something different from a draft.
     *
     * Leaving these inert was worse — an operator cannot tell a row that has nothing behind it from
     * one that is simply not clickable. But making them open onto a decision would turn this screen
     * into the console. So a run expands to *why it stopped*: the reason, the rule where there is
     * one, and what happens next. No buttons, because there is nothing here to decide.
     */
    return (
      <div className={`qrow qrow-run${open ? ' is-open' : ''}`}>
        <button type="button" className="qrun-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={`qico ${quarantined ? 'qico-stop' : 'qico-wait'}`} aria-hidden>
          {quarantined ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3.5L21 19H3z" /><path d="M12 10v4M12 16.5v.01" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
              strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" />
            </svg>
          )}
        </span>
        <div className="qrow-body">
          <p className="qrow-title">
            {quarantined ? 'Stopped before drafting' : 'Paused, waiting to resume'}
          </p>
          <p className="qrow-sub">
            {quarantined
              ? 'A source carried instructions aimed at the agent, so no draft was produced.'
              : (item.run.park_reason ? PARK_LABEL[item.run.park_reason] : 'Waiting to resume.')}
          </p>
        </div>
        <span className={`pill ${quarantined ? 'pill-stop' : 'pill-calm'}`}>
          {quarantined ? 'stopped' : 'retrying'}
        </span>
        <span className={`qcar${open ? ' is-open' : ''}`} aria-hidden>▶</span>
        </button>

        {open && (
          <div className="qrow-full qrun-full">
            <dl className="qrun-kv">
              <dt>Run</dt>
              <dd className="mono">{item.run.id}</dd>
              <dt>Stopped at</dt>
              <dd>{formatDateTime(item.run.started_at)}</dd>
              {item.run.park_reason && (
                <>
                  <dt>Reason</dt>
                  <dd>{item.run.park_reason.replace(/_/g, ' ')}</dd>
                </>
              )}
              <dt>What happens next</dt>
              <dd>
                {quarantined
                  ? 'Nothing automatically. The source is archived and this slot needs a person to clear it or drop it.'
                  : 'The hourly sweep picks it up. No action needed unless it keeps failing.'}
              </dd>
            </dl>
          </div>
        )}
      </div>
    );
  }

  const draft = item.draft;
  const version = draft.versions.find((v) => v.id === draft.current_version_id);
  const isPost = item.kind === 'post';
  const blocked = draft.state === 'blocked_guardrail';

  return (
    <div className={`qrow qrow-open${blocked ? ' qrow-stop' : ''}`}>
      <button
        type="button"
        className="qrow-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChannelMark channel={draft.channel} size={17} />
        <span className="qrow-ch">{CHANNEL_LABEL[draft.channel]}</span>
        {/* The first sentence, not a character count. Slicing at 78 cut mid-word and mid-clause,
            which reads as broken rather than truncated. A post's opening sentence is also the thing
            it was written to be scanned by. */}
        <span className="qrow-excerpt">{firstSentence(version?.text ?? '')}</span>
        <span className={`pill ${blocked ? 'pill-stop' : isPost ? 'pill-attend' : 'pill-go'}`}>
          {blocked ? 'blocked' : isPost ? 'sent back' : 'needs you'}
        </span>
        <span className={`qcar${open ? ' is-open' : ''}`} aria-hidden>▶</span>
      </button>

      {open && (
        <div className="qrow-full">
          {isPost && <p className="qrow-why">{item.post.invalidated_reason}</p>}
          <p className="post">{version?.text}</p>
          <Link href={`/approvals/${draft.id}`} className="btn btn-primary qrow-go">
            Review
          </Link>
        </div>
      )}
    </div>
  );
}
