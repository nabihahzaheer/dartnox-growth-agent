'use client';

/**
 * THE TWO DECISIONS THAT NEED MORE THAN A CLICK.
 *
 * Reject needs a reason, and edit needs the edited text. Both are built on the browser's own
 * `<dialog>` (D-040): focus trapping, Escape to close, the rest of the page inert and top-layer
 * rendering all come free and correct. D-025 declined the component library that would have
 * handled those, so using the platform's element is how that cost gets paid back.
 *
 * WHY A REJECTION MUST CARRY A STRUCTURED CODE. A-04 makes rejection reasons a *prompt input*,
 * bounded to the last five or thirty days and visible in settings, because an invisible prompt
 * input is one nobody can debug. Free text alone could not be fed back — it has no category to
 * group by and no way to say "avoid this again" to a drafting call. The note is optional and is
 * never the only record.
 *
 * The options come from settings rather than from a constant here. One list, two surfaces: the
 * operator can see and edit in Settings exactly what the reject dialog will offer.
 */

import { useEffect, useRef, useState } from 'react';
import type { Draft, EditTag, RejectionReasonEntry, RejectionReasonCode } from '@/lib/types';

/**
 * The edit taxonomy, offered as tags.
 *
 * These are not decoration: A-05's reflection job counts tags across recent decisions, and a tag
 * recurring three times in twenty becomes a suggested writing rule. Untagged edits still count
 * toward edit rate, but they cannot produce a rule — the pattern has nothing to be a pattern of.
 */
const EDIT_TAGS: { tag: EditTag; label: string }[] = [
  { tag: 'tightened', label: 'Tightened' },
  { tag: 'claim_softened', label: 'Softened a claim' },
  { tag: 'hook_rewritten', label: 'Rewrote the hook' },
  { tag: 'specific_detail_added', label: 'Added detail' },
  { tag: 'jargon_removed', label: 'Removed jargon' },
  { tag: 'terminology_corrected', label: 'Fixed terminology' },
  { tag: 'cta_changed', label: 'Changed the ending' },
  { tag: 'length_cut', label: 'Cut length' },
];

function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      // `m-auto` because Tailwind's preflight resets the `margin: auto` a native dialog centres
      // itself with.
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-lg border p-0 backdrop:bg-black/50"
      style={{
        borderColor: 'var(--border-strong)',
        background: 'var(--surface)',
        color: 'var(--text)',
      }}
    >
      <div className="p-4">
        <h2 className="text-[13px] font-bold">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

export function DecisionDialogs({
  open,
  draft,
  reasons,
  onClose,
  onReject,
  onSaveEdit,
}: {
  open: 'reject' | 'edit' | null;
  draft: Draft;
  reasons: RejectionReasonEntry[];
  onClose: () => void;
  onReject: (code: RejectionReasonCode, note: string | null, label: string) => void;
  onSaveEdit: (text: string, tags: EditTag[]) => void;
}) {
  const version = draft.versions.find((v) => v.id === draft.current_version_id);

  /**
   * Initialised from the draft, never reset.
   *
   * The parent keys this component on the draft id, so opening a different item **remounts** it
   * with fresh state rather than resetting it in an effect. The reset-in-an-effect version was the
   * obvious shape and is wrong for the same reason it was wrong on the console: a `setState` in an
   * effect body triggers a second render pass immediately after the first. A key is React's own
   * answer to "this is a different thing now".
   *
   * It also removes a real hazard — a reset effect can fire after the user has started typing and
   * silently discard their edit.
   */
  const [code, setCode] = useState<RejectionReasonCode | null>(null);
  const [note, setNote] = useState('');
  const [text, setText] = useState(version?.text ?? '');
  const [tags, setTags] = useState<EditTag[]>([]);

  const active = reasons.filter((r) => r.active);

  return (
    <>
      <Modal open={open === 'reject'} title="Why are you rejecting this?" onClose={onClose}>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          The reason goes back to the agent. The next attempt at this slot will name it.
        </p>

        <ul className="mt-3 space-y-1">
          {active.map((reason) => (
            <li key={reason.code}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px]">
                <input
                  type="radio"
                  name="reject-reason"
                  checked={code === reason.code}
                  onChange={() => setCode(reason.code)}
                />
                {reason.label}
              </label>
            </li>
          ))}
        </ul>

        <label htmlFor="reject-note" className="sr-only">
          Optional note
        </label>
        <textarea
          id="reject-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Anything else (optional)"
          className="mt-2 w-full resize-none rounded border px-2 py-1.5 text-[13px] outline-none"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-sunk)' }}
        />

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={code === null}
            onClick={() => {
              const chosen = active.find((r) => r.code === code);
              if (chosen) onReject(chosen.code, note.trim() || null, chosen.label);
            }}
            className="rounded px-2.5 py-1 text-[13px] font-medium disabled:opacity-30"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Reject
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-2.5 py-1 text-[13px]"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            Cancel
          </button>
        </div>
      </Modal>

      <Modal open={open === 'edit'} title="Edit before approving" onClose={onClose}>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Your version is what publishes, and what the approval binds to.
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="mt-2 w-full resize-none rounded border px-2 py-1.5 text-[13px] leading-relaxed outline-none"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-sunk)' }}
        />

        <div
          className="mt-2 font-mono text-[10px] font-bold uppercase"
          style={{ color: 'var(--text-faint)', letterSpacing: '0.1em' }}
        >
          What did you change?
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {EDIT_TAGS.map(({ tag, label }) => {
            const on = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setTags((t) => (on ? t.filter((x) => x !== tag) : [...t, tag]))}
                className="rounded border px-2 py-0.5 text-[12px]"
                style={{
                  borderColor: on ? 'var(--accent-text)' : 'var(--border-strong)',
                  color: on ? 'var(--accent-text)' : 'var(--text-muted)',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          A tag seen three times in twenty decisions becomes a suggested writing rule.
        </p>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={!text.trim() || text === version?.text}
            onClick={() => onSaveEdit(text, tags)}
            className="rounded px-2.5 py-1 text-[13px] font-medium disabled:opacity-30"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Save and approve
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-2.5 py-1 text-[13px]"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            Cancel
          </button>
        </div>
      </Modal>
    </>
  );
}
