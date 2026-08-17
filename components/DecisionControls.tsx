'use client';

/**
 * THE DECISION SURFACE — approve, edit then approve, reject, escalate.
 *
 * ONE IMPLEMENTATION, TWO SCREENS. This component owns the four actions, the reject-reason dialog,
 * the inline editor, the idempotency key, the rubber-stamp clock and the `submitReview` call. The
 * queue renders it once per decidable row; the console renders it at the interrupt step of a run
 * that has stopped for the operator. Neither screen contains a second copy of the write.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL, GIVEN D-051 SAID IT SHOULD NOT
 *
 * D-051 kept decisions on the queue and left the console with a link to it, on the grounds that
 * putting the same four buttons under a halted run would mean "two implementations of the
 * highest-consequence write in the product". That objection was about *duplication*, not about
 * placement, and it was correct as stated — a second hand-rolled approve path would drift from the
 * first within a week, and the two would disagree about the idempotency key, the seconds-open
 * measurement, or what a rejection actually did to the slot.
 *
 * Extracting the surface answers the objection rather than ignoring it. There is exactly one
 * `submitReview` call site in the application, and it is below. Adding a third screen costs one
 * import.
 *
 * The placement argument is the architecture board's: human review lives *inside* the per-post
 * run, and the operator sees why it came, its score, its checks and its sources at the moment the
 * run stops. Making them navigate away to act was the console announcing a problem and handing
 * over a phone number.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IT DELIBERATELY DOES NOT OWN
 *
 * *When the operator started looking.* That is `openedAt`, passed in, because only the screen
 * knows: on the queue the clock starts when a row is selected, on the console when the run halts.
 * Starting it at mount would restart the measurement at page load, and A-17's rubber-stamp figure
 * — the share of approvals decided under fifteen seconds — is exactly the number that would go
 * quietly wrong.
 *
 * *Reloading.* It reports what happened through `onDecided` and lets the screen decide what to
 * re-read. Every write reaches `applyPatch`, which announces to `subscribeToWorld`, so the rail
 * and the week move without this component knowing they exist.
 */

import { useCallback, useImperativeHandle, useState, type Ref } from 'react';
import { submitReview, type ReviewDecision } from '@/lib/agentClient';
import type {
  ConsoleError,
  Draft,
  EditTag,
  RejectionReasonCode,
  RejectionReasonEntry,
} from '@/lib/types';
import type { WorldPatch } from '@/lib/world';
import { DecisionDialogs } from '@/components/DecisionDialogs';

/**
 * What is being decided. The two differ only in wording, and the wording matters: a returned post
 * is text the operator already said yes to once, so "Approve" would be the product forgetting its
 * own history. Reject on that arm is "Drop it", because there is no redraft to promise for a post
 * that was already scheduled.
 *
 * Escalation is offered on the draft arm only. Escalating a post the owner's own rule just caught
 * would be routing it back to the person whose rule caught it.
 */
export type DecisionSubject = 'draft' | 'returned_post';

/**
 * The keyboard's way in.
 *
 * The queue's `a` / `e` / `r` bindings live on the window and act on whichever row is selected, so
 * they need to reach that row's controls. A `ref` handle is the smallest thing that does it. The
 * alternative — lifting `dialog` state back to the page — is what the extraction just removed.
 */
export type DecisionHandle = {
  approve: () => void;
  openEdit: () => void;
  openReject: () => void;
};

/** Every message the four decisions can produce, in one place, so the console and the queue cannot
 *  describe the same write two different ways. */
function approvedMessage(subject: DecisionSubject): string {
  return subject === 'returned_post' ? 'Approved again · rescheduled' : 'Approved · scheduled';
}

/**
 * A rejection has two outcomes and the patch is what knows which.
 *
 * It either slips the slot and queues a redraft, or — under two working days of runway, or on a
 * topical slot — drops it and queues nothing. The copy read "Redraft queued" unconditionally once,
 * which announced work the system had decided not to do.
 */
function rejectedMessage(patch: WorldPatch, label: string): string {
  return patch.calendarSlots?.[0]?.state === 'dropped'
    ? `Rejected · ${label}. Slot dropped.`
    : `Rejected · ${label}. Redraft queued.`;
}

export function DecisionControls({
  draft,
  reasons,
  openedAt,
  subject = 'draft',
  blocked = false,
  onDecided,
  onError,
  onBusyChange,
  ref,
}: {
  draft: Draft;
  /** From settings, not a constant here. One list, two surfaces — the operator can see in Settings
   *  exactly what the reject dialog will offer. */
  reasons: RejectionReasonEntry[];
  /**
   * When the operator started looking at this item, in `Date.now()` milliseconds.
   *
   * A ref rather than a number: on the queue it changes on every selection and is read only at
   * decision time, so passing the value would re-render every row to move a figure nothing
   * displays.
   */
  openedAt: { readonly current: number };
  subject?: DecisionSubject;
  /**
   * A guardrail *failed*, per A-09: a warn routes to review and can be approved past, a fail
   * blocks. Approve is removed rather than disabled — a disabled primary button invites hunting
   * for the way to enable it, and there is not one.
   */
  blocked?: boolean;
  onDecided: (message: string) => void;
  onError: (error: ConsoleError) => void;
  /** So a screen can dim the row it is writing. Optional: the console has one item and does not. */
  onBusyChange?: (busy: boolean) => void;
  ref?: Ref<DecisionHandle>;
}) {
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'reject' | 'edit' | null>(null);

  /**
   * THE ONE WRITE.
   *
   * `describe` may be a function of the patch because one decision has two outcomes; see
   * `rejectedMessage`. Everything else — the version being decided against, the idempotency key,
   * the seconds-open figure — is derived here so that no call site can get one of them wrong.
   */
  const decide = useCallback(
    async (decision: ReviewDecision, describe: string | ((patch: WorldPatch) => string)) => {
      setBusy(true);
      onBusyChange?.(true);
      try {
        const patch = await submitReview(draft.id, draft.current_version_id, decision, {
          /** Derived from the draft, its version and the decision, so a double click replays
           *  rather than producing a second approval. */
          idempotencyKey: `review:${draft.id}:${draft.current_version_id}:${decision.kind}`,
          /** A-17's rubber-stamp clock. Floored at one second: a decision cannot honestly be
           *  reported as having taken none. */
          secondsOpen: Math.max(1, Math.round((Date.now() - openedAt.current) / 1000)),
        });
        onDecided(typeof describe === 'function' ? describe(patch) : describe);
      } catch (e) {
        onError(e as ConsoleError);
      } finally {
        setBusy(false);
        onBusyChange?.(false);
        setDialog(null);
      }
    },
    [draft, openedAt, onDecided, onError, onBusyChange],
  );

  const approve = useCallback(
    () => void decide({ kind: 'approve' }, approvedMessage(subject)),
    [decide, subject],
  );

  useImperativeHandle(
    ref,
    () => ({
      approve,
      openEdit: () => setDialog('edit'),
      openReject: () => setDialog('reject'),
    }),
    [approve],
  );

  return (
    <>
      {/* `aria-busy` on the group rather than on each button: the write is one operation, and a
          screen reader announcing four busy controls would misdescribe it. */}
      <div className="flex flex-wrap items-center gap-1.5" aria-busy={busy}>
        {!blocked && (
          <button
            type="button"
            onClick={approve}
            disabled={busy}
            className="t-body rounded px-2.5 py-1 font-medium disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            {subject === 'returned_post' ? 'Approve again' : 'Approve'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setDialog('edit')}
          disabled={busy}
          className="t-body rounded border px-2.5 py-1 disabled:opacity-40"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setDialog('reject')}
          disabled={busy}
          className="t-body rounded border px-2.5 py-1 disabled:opacity-40"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          {subject === 'returned_post' ? 'Drop it' : 'Reject'}
        </button>
        {subject === 'draft' && (
          <button
            type="button"
            onClick={() =>
              void decide(
                { kind: 'escalate', tier: 'stakeholder', detail: 'Raised by the operator.' },
                'Escalated to the owner',
              )
            }
            disabled={busy}
            className="t-body rounded border px-2.5 py-1 disabled:opacity-40"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }}
          >
            Escalate
          </button>
        )}
        {blocked && (
          <span className="t-label" style={{ color: 'var(--state-blocked)' }}>
            Blocked — edit or drop it
          </span>
        )}
      </div>

      <DecisionDialogs
        /** Remount on a different version, so the editor initialises from that text rather than
         *  being reset in an effect — a reset effect can fire after typing has started and discard
         *  the edit. */
        key={draft.current_version_id}
        open={dialog}
        draft={draft}
        reasons={reasons}
        onClose={() => setDialog(null)}
        onReject={(code: RejectionReasonCode, note, label) =>
          void decide({ kind: 'reject', reasonCode: code, note }, (patch) =>
            rejectedMessage(patch, label),
          )
        }
        onSaveEdit={(text, tags: EditTag[]) =>
          void decide({ kind: 'approve_with_edits', text, editTags: tags }, 'Approved with your edits')
        }
      />
    </>
  );
}
