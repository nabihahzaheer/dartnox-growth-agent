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
import { QueueRow, draftOf, itemId } from '@/components/queue/QueueRow';
import { ErrorPanel, NotFound } from '@/components/ErrorState';
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
        // Clamp here, where the new length is known. The first version guessed at it in the
        // decision handler using the *old* length, which is off by one whenever a decision removes
        // the last row.
        setSelected((i) => Math.min(i, Math.max(0, queue.length - 1)));
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
      /**
       * Two of the three arms are decidable and one is not: a parked or quarantined run has no
       * draft to decide against, and clearing it is a different action. `draftOf` is the one place
       * that branch lives, so a fourth arm would not mean auditing every handler.
       */
      const draft = current ? draftOf(current) : null;
      if (!draft) return;
      setBusy(itemId(current!));
      try {
        await submitReview(draft.id, draft.current_version_id, decision, {
          // Derived from the draft and the decision, so a double click replays rather than
          // producing a second approval.
          idempotencyKey: `review:${draft.id}:${draft.current_version_id}:${decision.kind}`,
          secondsOpen: Math.max(1, Math.round((Date.now() - selectedAt.current) / 1000)),
        });
        setLastAction(describe);
        reload();
      } catch (e) {
        setError(e as ConsoleError);
      } finally {
        setBusy(null);
        setDialog(null);
      }
    },
    [current, reload],
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

      /** Decidable means "has a draft behind it" — the draft arm and the returned-post arm. A
       *  parked run is skipped by the verbs rather than by the cursor, so `j`/`k` still move
       *  through everything. */
      const decidable = current ? draftOf(current) !== null : false;
      if (e.key === 'a' && decidable) {
        void decide({ kind: 'approve' }, 'Approved · scheduled and queued to publish');
      }
      if (e.key === 'r' && decidable) setDialog('reject');
      if (e.key === 'e' && decidable) setDialog('edit');
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
              {/* Three states. `loading ? … : count` claimed "0 waiting on you" on a failed
                  load — asserting an empty queue when the queue is simply unknown. */}
              {loading ? 'Loading…' : error ? 'could not load' : `${items.length} waiting on you`}
            </span>
            <span
              className="ml-auto font-mono text-[10px]"
              style={{ color: 'var(--text-faint)' }}
            >
              j / k move · a approve · e edit · r reject
            </span>
            <span className="w-full text-[11px]" style={{ color: 'var(--text-faint)' }}>
              Everything waiting on a decision, in one list — drafts, runs that never produced one,
              and posts sent back by a settings change. This is where you approve, edit and reject.
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

            {!loading && items.length === 0 && !error && <NotFound
                title="Nothing waiting"
                detail="The next drafting batch runs Wednesday 06:00."
              />}

            {!loading &&
              items.map((item, index) => (
                <QueueRow
                  key={itemId(item)}
                  item={item}
                  threshold={settings?.score_threshold ?? 0.85}
                  selected={index === selected}
                  busy={busy === itemId(item)}
                  onSelect={() => select(index)}
                  onApprove={() =>
                    void decide(
                      { kind: 'approve' },
                      item.kind === 'post'
                        ? 'Approved again · rescheduled, and the approval binds the current rules'
                        : 'Approved · scheduled and queued to publish',
                    )
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

        {settings && current && draftOf(current) && (
          <DecisionDialogs
            // Remount on a different draft, so its state initialises from that draft rather than
            // being reset in an effect.
            key={draftOf(current)!.id}
            open={dialog}
            draft={draftOf(current)!}
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


