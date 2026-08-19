'use client';

/**
 * THE DECISION, AND THE ONLY PLACE THE REBUILD WRITES ONE.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS: THE REJECTION REASON WAS A LIE IN THE AUDIT TRAIL
 *
 * Both call sites hardcoded `reasonCode: 'claim_unsupported'`. Every rejection, whatever the
 * operator actually thought, wrote that code onto `Approval.reason_code` — a record whose entire
 * purpose is to say why a person turned something down. That is not a missing feature; it is the
 * product writing a fact it invented into an audit trail, and it would have survived the defence
 * call only until someone rejected a draft for being off-pillar and read back "claim not supported
 * by a source".
 *
 * Three things in the repository already promised this control:
 *
 *   `fixtures/settings.ts` says of `rejection_reason_set`: "Rendered in Settings *and* used as the
 *   reject dialog's options. One list, two surfaces." There was one surface.
 *
 *   D-025's defence line says the prototype "has three [dialog surfaces] — a structured
 *   reject-reason picker, an inline editor, and the failure-injection drawer — and the reviewer can
 *   open all of them." A reviewer could open none of them in the rebuild.
 *
 *   A-04 makes rejection reasons a structured prompt input, bounded and visible in settings,
 *   "because an invisible prompt input is one nobody can debug".
 *
 * And it is load-bearing for the demo rather than decorative: `agentClient` keeps the last five
 * reasons and the next drafting run lists them as "Avoiding: <label>" in its `applied_inputs`. With
 * one hardcoded code, the brief's hardest queue clause — a rejection must visibly change what the
 * agent does next — was demonstrated with a constant.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE CALL SITE FOR THE WRITE
 *
 * `DraftCard` and `app/(main)/approvals/[id]` each called `submitReview` independently, with their
 * own copies of the idempotency key, the seconds-open clock and the error handling — the exact
 * duplication D-051 says was designed out ("two implementations of the highest-consequence write in
 * the product would be the real risk, and one component removes it"). They now render this.
 *
 * ---------------------------------------------------------------------------------------------
 * THE EDITOR, WHICH WAS THE ONLY ROUTE FORWARD FOR A BLOCKED DRAFT
 *
 * `approve_with_edits` rendered a button that did nothing. On a blocked draft that is not a missing
 * nicety: `scripts/check.mts` asserts the blocked gate offers `approve_with_edits` precisely so that
 * a draft which cannot be approved still has a way forward, and the one control carrying that route
 * was inert. The write path already existed — `approve()` takes `{ text, editTags }`, creates a new
 * human-authored version, and rebinds the approval to it.
 *
 * Built on the browser's own `<dialog>` (D-040): focus trapping, Escape, the rest of the page inert
 * and top-layer rendering all arrive correct and free, which is how D-025's decision to decline a
 * component library gets paid for rather than argued away.
 */

import { useEffect, useRef, useState } from 'react';
import { submitReview } from '@/lib/agentClient';
import type {
  Draft,
  DraftVersion,
  EditTag,
  InterruptOption,
  RejectionReasonCode,
  RejectionReasonEntry,
} from '@/lib/types';
import { asConsoleError, errorCopy } from '@/lib/errorCopy';

const ACTION_LABEL: Partial<Record<InterruptOption, string>> = {
  approve: 'Approve',
  /** Zendesk's distinction, and free provenance: the label records whether a human changed it. */
  approve_with_edits: 'Edit',
  reject: 'Send back',
  escalate: 'Ask the owner',
};

/** The tags an operator can attach to their own edit. A closed set because `EditTag` is closed —
 *  these are the evidence a reflection rule is later built from, so a free-text label would make
 *  the learning loop unfalsifiable. */
const TAG_OPTIONS: { tag: EditTag; label: string }[] = [
  { tag: 'tightened', label: 'Tightened' },
  { tag: 'claim_softened', label: 'Claim softened' },
  { tag: 'jargon_removed', label: 'Jargon removed' },
  { tag: 'specific_detail_added', label: 'Added a specific detail' },
  { tag: 'hook_rewritten', label: 'Rewrote the opening' },
  { tag: 'length_cut', label: 'Cut for length' },
];

type Mode = 'reject' | 'escalate' | 'edit';

export function DecisionBar({
  draft,
  version,
  options,
  reasons,
  onDecided,
}: {
  draft: Draft;
  version: DraftVersion;
  options: InterruptOption[];
  /** From `Settings.rejection_reason_set`. `active` selects which members of the fixed taxonomy the
   *  dialog offers, which is what makes the setting an operator control rather than a constant. */
  reasons: RejectionReasonEntry[];
  onDecided: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);

  /** Zero until mounted, then stamped in an effect — reading the clock during render is impure and
   *  ESLint is right to flag it. Feeds the "decided in under 15 seconds" rubber-stamp alarm, so it
   *  has to measure how long the post was in front of a person, not how long the request took. */
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = Date.now();
  }, [draft.id]);

  async function write(run: () => Promise<unknown>) {
    setError(null);
    try {
      await run();
      setMode(null);
      onDecided();
    } catch (e) {
      setError(errorCopy(asConsoleError(e)));
    } finally {
      setBusy(null);
    }
  }

  /** Derived, not random: a replayed key returns the original result rather than deciding twice. */
  const keyFor = (option: string) => `review:${draft.id}:${version.id}:${option}`;
  const secondsOpen = () => Math.round((Date.now() - openedAt.current) / 1000);

  function approve() {
    setBusy('approve');
    void write(() =>
      submitReview(draft.id, version.id, { kind: 'approve' }, {
        idempotencyKey: keyFor('approve'),
        secondsOpen: secondsOpen(),
      }),
    );
  }

  function reject(reasonCode: RejectionReasonCode, note: string) {
    setBusy('reject');
    void write(() =>
      submitReview(draft.id, version.id, { kind: 'reject', reasonCode, note: note.trim() || null }, {
        idempotencyKey: `${keyFor('reject')}:${reasonCode}`,
        secondsOpen: secondsOpen(),
      }),
    );
  }

  function escalate(tier: 'operator' | 'stakeholder', detail: string) {
    setBusy('escalate');
    void write(() =>
      submitReview(draft.id, version.id, { kind: 'escalate', tier, detail }, {
        idempotencyKey: `${keyFor('escalate')}:${tier}`,
        secondsOpen: secondsOpen(),
      }),
    );
  }

  function saveEdit(text: string, editTags: EditTag[]) {
    setBusy('approve_with_edits');
    void write(() =>
      submitReview(draft.id, version.id, { kind: 'approve_with_edits', text, editTags }, {
        idempotencyKey: `${keyFor('edit')}:${text.length}`,
        secondsOpen: secondsOpen(),
      }),
    );
  }

  return (
    <>
      <footer className="card-act">
        {options.map((option) => {
          const label = ACTION_LABEL[option];
          if (!label) return null;
          return (
            <button
              key={option}
              type="button"
              className={`btn${option === 'approve' ? ' btn-primary' : ''}`}
              disabled={busy !== null}
              onClick={() => {
                if (option === 'approve') approve();
                else if (option === 'reject') setMode('reject');
                else if (option === 'escalate') setMode('escalate');
                else if (option === 'approve_with_edits') setMode('edit');
              }}
            >
              {busy === option ? '…' : label}
            </button>
          );
        })}
      </footer>

      {error && (
        <p className="card-err" role="alert">
          {error}
        </p>
      )}

      {mode === 'reject' && (
        <RejectDialog
          reasons={reasons.filter((r) => r.active)}
          busy={busy !== null}
          onCancel={() => setMode(null)}
          onConfirm={reject}
        />
      )}
      {mode === 'escalate' && (
        <EscalateDialog busy={busy !== null} onCancel={() => setMode(null)} onConfirm={escalate} />
      )}
      {mode === 'edit' && (
        <EditDialog
          initial={version.text}
          busy={busy !== null}
          onCancel={() => setMode(null)}
          onConfirm={saveEdit}
        />
      )}
    </>
  );
}

/** Opens the native dialog on mount and closes it on unmount, so `showModal()` is called exactly
 *  once per open and the browser owns focus and Escape throughout (D-040). */
function useModal(onCancel: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const close = () => onCancel();
    dialog.addEventListener('close', close);
    return () => {
      dialog.removeEventListener('close', close);
      if (dialog.open) dialog.close();
    };
  }, [onCancel]);
  return ref;
}

function RejectDialog({
  reasons,
  busy,
  onCancel,
  onConfirm,
}: {
  reasons: RejectionReasonEntry[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (code: RejectionReasonCode, note: string) => void;
}) {
  const ref = useModal(onCancel);
  const [code, setCode] = useState<RejectionReasonCode | null>(null);
  const [note, setNote] = useState('');

  return (
    <dialog ref={ref} className="dlg" aria-label="Send this draft back">
      <h2 className="t-section">Send it back</h2>
      <p className="t-label dlg-sub">
        The reason is recorded on the decision and read by the next drafting run.
      </p>

      <fieldset className="dlg-reasons">
        <legend className="sr-only">Reason</legend>
        {reasons.map((r) => (
          <label key={r.code} className={`dlg-reason${code === r.code ? ' is-picked' : ''}`}>
            <input
              type="radio"
              name="reason"
              value={r.code}
              checked={code === r.code}
              onChange={() => setCode(r.code)}
            />
            {r.label}
          </label>
        ))}
      </fieldset>

      <label className="t-label" htmlFor="reject-note">
        Anything to add (optional)
      </label>
      <textarea
        id="reject-note"
        className="txt dlg-note"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <div className="dlg-act">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        {/* Disabled until a reason is chosen. The whole point is that the code written is the one a
            person picked, so defaulting it would reintroduce the bug this dialog exists to fix. */}
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || code === null}
          onClick={() => code && onConfirm(code, note)}
        >
          {busy ? '…' : 'Send back'}
        </button>
      </div>
    </dialog>
  );
}

function EscalateDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (tier: 'operator' | 'stakeholder', detail: string) => void;
}) {
  const ref = useModal(onCancel);
  /** Both tiers, because the tier was hardcoded to `stakeholder` and the operator tier was
   *  unreachable — and they are not the same act: the stakeholder tier starts N14's 72-hour
   *  acknowledgement clock and the operator tier does not. */
  const [tier, setTier] = useState<'operator' | 'stakeholder'>('stakeholder');
  const [detail, setDetail] = useState('');

  return (
    <dialog ref={ref} className="dlg" aria-label="Escalate this draft">
      <h2 className="t-section">Ask someone else</h2>
      <p className="t-label dlg-sub">
        The owner tier starts a 72-hour acknowledgement clock; the operator tier does not.
      </p>

      <fieldset className="dlg-reasons">
        <legend className="sr-only">Who to ask</legend>
        <label className={`dlg-reason${tier === 'stakeholder' ? ' is-picked' : ''}`}>
          <input
            type="radio"
            name="tier"
            checked={tier === 'stakeholder'}
            onChange={() => setTier('stakeholder')}
          />
          The client owner
        </label>
        <label className={`dlg-reason${tier === 'operator' ? ' is-picked' : ''}`}>
          <input
            type="radio"
            name="tier"
            checked={tier === 'operator'}
            onChange={() => setTier('operator')}
          />
          Another operator
        </label>
      </fieldset>

      <label className="t-label" htmlFor="esc-detail">
        What do they need to decide?
      </label>
      <textarea
        id="esc-detail"
        className="txt dlg-note"
        rows={2}
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
      />

      <div className="dlg-act">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || detail.trim().length === 0}
          onClick={() => onConfirm(tier, detail.trim())}
        >
          {busy ? '…' : 'Send it up'}
        </button>
      </div>
    </dialog>
  );
}

function EditDialog({
  initial,
  busy,
  onCancel,
  onConfirm,
}: {
  initial: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (text: string, tags: EditTag[]) => void;
}) {
  const ref = useModal(onCancel);
  const [text, setText] = useState(initial);
  const [tags, setTags] = useState<EditTag[]>([]);

  const changed = text.trim() !== initial.trim() && text.trim().length > 0;

  return (
    <dialog ref={ref} className="dlg dlg-wide" aria-label="Edit this draft">
      <h2 className="t-section">Edit and approve</h2>
      <p className="t-label dlg-sub">
        Your edit becomes a new version and the approval binds to it, so what publishes is the text
        you approved.
      </p>

      <textarea
        className="txt dlg-editor"
        rows={9}
        value={text}
        aria-label="Post text"
        onChange={(e) => setText(e.target.value)}
      />

      <p className="t-label" style={{ marginTop: 10 }}>
        What did you change? (optional — this is what the agent learns from)
      </p>
      <div className="chip-row">
        {TAG_OPTIONS.map(({ tag, label }) => (
          <button
            key={tag}
            type="button"
            className={`tag-btn${tags.includes(tag) ? ' is-on' : ''}`}
            aria-pressed={tags.includes(tag)}
            onClick={() =>
              setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
            }
          >
            {label}
          </button>
        ))}
      </div>

      <div className="dlg-act">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !changed}
          onClick={() => onConfirm(text.trim(), tags)}
        >
          {busy ? '…' : 'Approve this version'}
        </button>
      </div>
    </dialog>
  );
}
