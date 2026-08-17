'use client';

/**
 * THE QUEUE — everything waiting on a person.
 *
 * The brief is specific about what this screen has to do: "approve / edit / reject flows that
 * actually update client-side state and visibly change what the agent does next." The second half
 * is the hard part, and it is what most of this file exists for. A queue whose buttons only remove
 * rows is the common failure and the brief calls it out by name.
 *
 * What each decision actually does, all of it visible without leaving the screen:
 *
 *   approve   the item leaves, a post is scheduled, and a publish run appears in the rail
 *   edit      a new version is written, and the approval binds to it rather than to what the
 *             agent wrote
 *   reject    the slot slips or drops, a redraft run is queued, and the reason is fed to the next
 *             drafting run — which then lists it as an input it consumed
 *   escalate  the draft is held and an escalation is raised against no rule
 *
 * IT HOLDS A UNION, NOT A LIST OF DRAFTS (D-033). A run quarantined at the input guardrail halts
 * before a draft exists, and a parked run needs a human despite producing nothing. Both belong in
 * a work list. Typing this as `Draft[]` would have silently dropped them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getQueue,
  getSettings,
  submitReview,
  type ReviewDecision,
} from '@/lib/agentClient';
import type {
  ConsoleError,
  QueueItem,
  RejectionReasonCode,
  Settings,
} from '@/lib/types';
import { Rail } from '@/components/Rail';
import { QueueRow } from '@/components/queue/QueueRow';
import { DecisionDialogs } from '@/components/queue/DecisionDialogs';

export default function QueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ConsoleError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Which dialog is open, if any. Both are decisions that need more than a click. */
  const [dialog, setDialog] = useState<'reject' | 'edit' | null>(null);
  /** What just happened, so a decision is not a row silently vanishing. */
  const [lastAction, setLastAction] = useState<string | null>(null);

  /**
   * When the current item was selected. A ref, not state: it is read at decision time and never
   * rendered, so making it state would cause a re-render for a value nothing displays.
   *
   * Not initialised with `Date.now()` either — calling that during render is impure, and React's
   * lint rule is right to reject it. It is set when the data lands and again on every selection.
   */
  const selectedAt = useRef(0);

  const select = useCallback((index: number) => {
    setSelected(index);
    // The rubber-stamp clock starts here rather than at page load. A-17 watches the share of
    // approvals decided in under fifteen seconds, because that is how human-in-the-loop actually
    // fails — and measuring from page load would make every decision look considered.
    selectedAt.current = Date.now();
  }, []);

  /**
   * One effect owns fetching, and `reload()` bumps a counter to re-run it.
   *
   * The obvious shape — a `load()` callback called from both the effect and the decision handler —
   * puts a `setState` before the first `await` in the effect body, which triggers a second render
   * pass immediately after the first. ESLint rejects it and is right to. An async IIFE whose first
   * statement is the fetch has nothing to flush.
   */
  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [queue, config] = await Promise.all([getQueue(), getSettings()]);
        if (cancelled) return;
        setItems(queue);
        setSettings(config);
        setError(null);
        selectedAt.current = Date.now();
      } catch (e) {
        if (!cancelled) setError(e as ConsoleError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadNonce]);

  const current = items[selected];

  /**
   * Every decision goes through here.
   *
   * `secondsOpen` is measured from when the item was selected, not from page load — it is the
   * rubber-stamp clock, and A-17 watches the share of approvals decided in under fifteen seconds
   * because that is how human-in-the-loop actually fails. Measuring it from page load would make
   * every decision look considered.
   */
  const decide = useCallback(
    async (decision: ReviewDecision, describe: string) => {
      if (!current || current.kind !== 'draft') return;
      const draft = current.draft;
      setBusy(draft.id);
      try {
        await submitReview(draft.id, draft.current_version_id, decision, {
          // Derived from the draft and the decision, so a double click replays rather than
          // producing a second approval.
          idempotencyKey: `review:${draft.id}:${draft.current_version_id}:${decision.kind}`,
          secondsOpen: Math.max(1, Math.round((Date.now() - selectedAt.current) / 1000)),
        });
        setLastAction(describe);
        setSelected((i) => Math.max(0, Math.min(i, items.length - 2)));
        reload();
      } catch (e) {
        setError(e as ConsoleError);
      } finally {
        setBusy(null);
        setDialog(null);
      }
    },
    [current, items.length, reload],
  );

  /**
   * Keyboard. Not required by the brief, kept because it is what designing for an operator
   * clearing forty drafts looks like rather than a demo user clicking once.
   *
   * Ignored while a dialog is open or focus is in a text field — otherwise typing a rejection note
   * containing the letter "a" would approve something.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT' || dialog !== null;
      if (typing) return;

      if (e.key === 'j') select(Math.min(selected + 1, items.length - 1));
      if (e.key === 'k') select(Math.max(selected - 1, 0));
      if (e.key === 'a' && current?.kind === 'draft') {
        void decide({ kind: 'approve' }, 'Approved · scheduled and queued to publish');
      }
      if (e.key === 'r' && current?.kind === 'draft') setDialog('reject');
      if (e.key === 'e' && current?.kind === 'draft') setDialog('edit');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, selected, current, dialog, decide, select]);

  return (
    <>
      <Rail />
      <main className="flex min-w-0 flex-1 flex-col">
        <div
          className="shrink-0 border-b px-4 py-2.5"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[13px] font-bold">Queue</span>
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {loading ? 'Loading…' : `${items.length} waiting on you`}
            </span>
            <span
              className="ml-auto font-mono text-[10px]"
              style={{ color: 'var(--text-faint)' }}
            >
              j / k move · a approve · e edit · r reject
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-2 px-4 py-4">
            {lastAction && (
              <p
                className="rounded px-2.5 py-1.5 text-[13px] font-bold"
                style={{ background: 'var(--note-bg)', color: 'var(--note-ink)' }}
              >
                {lastAction}
              </p>
            )}

            {error && <ErrorPanel error={error} onRetry={reload} />}

            {loading && <LoadingRows />}

            {!loading && items.length === 0 && !error && <EmptyQueue />}

            {!loading &&
              items.map((item, index) => (
                <QueueRow
                  key={item.kind === 'draft' ? item.draft.id : item.run.id}
                  item={item}
                  threshold={settings?.score_threshold ?? 0.85}
                  selected={index === selected}
                  busy={busy === (item.kind === 'draft' ? item.draft.id : null)}
                  onSelect={() => select(index)}
                  onApprove={() =>
                    void decide({ kind: 'approve' }, 'Approved · scheduled and queued to publish')
                  }
                  onEdit={() => {
                    select(index);
                    setDialog('edit');
                  }}
                  onReject={() => {
                    select(index);
                    setDialog('reject');
                  }}
                  onEscalate={() =>
                    void decide(
                      { kind: 'escalate', tier: 'stakeholder', detail: 'Raised by the operator.' },
                      'Escalated to the owner · draft held',
                    )
                  }
                />
              ))}
          </div>
        </div>

        {settings && current?.kind === 'draft' && (
          <DecisionDialogs
            // Remount on a different draft, so its state initialises from that draft rather than
            // being reset in an effect.
            key={current.draft.id}
            open={dialog}
            draft={current.draft}
            reasons={settings.rejection_reason_set}
            onClose={() => setDialog(null)}
            onReject={(code: RejectionReasonCode, note, label) =>
              void decide(
                { kind: 'reject', reasonCode: code, note },
                `Rejected · ${label}. Slot moved and a redraft queued — the next run will name this reason.`,
              )
            }
            onSaveEdit={(text, tags) =>
              void decide(
                { kind: 'approve_with_edits', text, editTags: tags },
                'Approved with your edits · the approval binds your version, not the agent’s',
              )
            }
          />
        )}
      </main>
    </>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading the queue">
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

function EmptyQueue() {
  return (
    <div className="py-12 text-center">
      <p className="text-[13px] font-medium">Nothing waiting</p>
      <p className="mx-auto mt-1 max-w-sm text-[13px]" style={{ color: 'var(--text-muted)' }}>
        The next drafting batch runs Wednesday 06:00.
      </p>
    </div>
  );
}

function ErrorPanel({ error, onRetry }: { error: ConsoleError; onRetry: () => void }) {
  const copy: Record<ConsoleError['kind'], string> = {
    not_found: 'That draft no longer exists.',
    /** The one that earns its place: an approval binds a version, so deciding against a stale one
     *  would break the chain the publish-time hash check depends on. */
    version_conflict: 'This draft changed while you had it open. Reload before deciding.',
    guardrail_block: 'A guardrail blocked that.',
    forbidden: 'That control is fixed and cannot be changed.',
    rate_limited: 'Too many requests. Try again shortly.',
    unavailable: 'Could not reach the agent runtime.',
    timeout: 'Timed out — we do not know whether it landed. Reload before retrying.',
  };
  return (
    <div
      className="rounded border px-3 py-2.5"
      style={{ borderColor: 'var(--state-blocked)', background: 'var(--state-blocked-bg)' }}
    >
      <p className="text-[13px] font-medium">{copy[error.kind]}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded border px-2.5 py-1 text-[13px]"
        style={{ borderColor: 'var(--border-strong)' }}
      >
        Reload
      </button>
    </div>
  );
}
