'use client';

/**
 * COMPOSER — where the operator puts something into the agent, and the run controls.
 *
 * WHY THERE IS AN INPUT AT ALL, since this agent is not a chatbot and never answers questions.
 *
 * A-01 names three source types and ranks them. Operator briefs come first, because a brief-driven
 * post cannot be generic — its substance exists nowhere else. News commentary is the floor. And
 * the architecture already specifies these arrive "as free-form notes through the console", so
 * this is the surface it was describing.
 *
 * That is the difference between borrowing a chat affordance and having one. The agent will never
 * reply here. What the operator types is raw material, and the next drafting run consumes it — the
 * step's own detail panel shows which brief it read.
 *
 * The controls sit alongside it because this is where the hand already is. Run now next to the
 * input is the pairing that makes a settings change demonstrable: most settings take effect "next
 * draft", so without a run on demand they take effect at a moment nobody is watching.
 */

import { useState } from 'react';
import { FailureDrawer } from '@/components/console/FailureDrawer';

export function Composer({
  onSubmitBrief,
  onRunNow,
  onHalt,
  canHalt,
  busy,
}: {
  onSubmitBrief: (text: string) => Promise<void>;
  onRunNow: () => void;
  onHalt: () => void;
  canHalt: boolean;
  busy: boolean;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSubmitBrief(trimmed);
      setText('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="shrink-0 border-t px-4 py-3"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-sunk)' }}
    >
      <div className="mx-auto w-full max-w-3xl">
        <div
          className="rounded-lg border focus-within:border-[var(--accent-text)]"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--surface)' }}
        >
          <label htmlFor="brief" className="sr-only">
            Submit a brief for the agent to draft from
          </label>
          <textarea
            id="brief"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line — the convention every tool with a
              // composer uses, and the one an operator's hands already expect.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            placeholder="Brief the agent — what happened on site, a customer story, an opinion worth publishing…"
            className="w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] leading-relaxed outline-none placeholder:text-[var(--text-faint)]"
          />

          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onRunNow}
                disabled={busy}
                className="rounded px-2.5 py-1 text-[13px] font-medium disabled:opacity-40"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                Run now
              </button>
              {/*
                Halt, not pause. Pause implies resume, which implies a checkpoint and a restart
                path — a different feature. A pause button that cannot resume invites exactly the
                question the orchestrator has to answer on the board anyway.
              */}
              <button
                type="button"
                onClick={onHalt}
                disabled={!canHalt}
                className="rounded border px-2.5 py-1 text-[13px] disabled:opacity-30"
                style={{ borderColor: 'var(--border-strong)' }}
              >
                Halt
              </button>
              <FailureDrawer />
            </div>

            <button
              type="button"
              onClick={() => void submit()}
              disabled={!text.trim() || sending}
              className="rounded border px-2.5 py-1 text-[13px] font-medium disabled:opacity-30"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--accent-text)' }}
            >
              {sending ? 'Sending…' : 'Send brief'}
            </button>
          </div>
        </div>

        <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          The agent never replies here. A brief is raw material — the next drafting run reads it,
          and its step shows which one it used.
        </p>
      </div>
    </div>
  );
}
