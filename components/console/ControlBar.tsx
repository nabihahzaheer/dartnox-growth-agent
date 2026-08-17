'use client';

/**
 * CONTROL BAR.
 *
 * WHY THIS IS NOT A CHAT COMPOSER. An earlier version had a permanent text box pinned to the
 * bottom, on the model of a chat client. That is the wrong convention borrowed onto the wrong
 * thing: this agent is not conversational. It runs on a schedule, works through a graph, and stops
 * for approval. It never answers anyone. A persistent input implies a correspondent.
 *
 * So the bottom of the screen is controls, which is what an operator console has.
 *
 * THE BRIEF INPUT STAYS, BEHIND A BUTTON. A-01 names operator briefs as the first of three source
 * types and says they arrive as free-form notes through the console. It is the only path by which
 * a person puts substance *into* this system, and a brief-driven post is the one kind that cannot
 * be generic. But it is an occasional action, not a conversation, so it opens when asked for.
 *
 * Note it is not one of the assignment's required console features — that line asks for the live
 * activity feed. It ships because the architecture specifies it and it makes the operator's input
 * visibly change the next run.
 */

import { useState } from 'react';
import { FailureDrawer } from '@/components/console/FailureDrawer';

export function ControlBar({
  onSubmitBrief,
  onRunNow,
  onHalt,
  onBackToLive,
  canHalt,
  viewingPast,
  busy,
}: {
  onSubmitBrief: (text: string) => Promise<void>;
  onRunNow: () => void;
  onHalt: () => void;
  onBackToLive: () => void;
  canHalt: boolean;
  /** Looking at a run that already finished, rather than following the live one. */
  viewingPast: boolean;
  busy: boolean;
}) {
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSubmitBrief(trimmed);
      setText('');
      setComposing(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="shrink-0 border-t"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-sunk)' }}
    >
      <div className="mx-auto w-full max-w-3xl px-4 py-2.5">
        {composing && (
          <div className="mb-2">
            <label htmlFor="brief" className="sr-only">
              Brief
            </label>
            <textarea
              id="brief"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
                if (e.key === 'Escape') setComposing(false);
              }}
              rows={3}
              placeholder="Finished the Bergen Street job — owner wanted full electrification, we talked them down to traps and air sealing…"
              className="w-full resize-none rounded border px-2.5 py-2 text-[13px] leading-relaxed outline-none placeholder:text-[var(--text-faint)]"
              style={{ borderColor: 'var(--border-strong)', background: 'var(--surface)' }}
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!text.trim() || sending}
                className="rounded px-2.5 py-1 text-[13px] font-medium disabled:opacity-30"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {sending ? 'Adding…' : 'Add brief'}
              </button>
              <button
                type="button"
                onClick={() => setComposing(false)}
                className="rounded border px-2.5 py-1 text-[13px]"
                style={{ borderColor: 'var(--border-strong)' }}
              >
                Cancel
              </button>
              <span className="ml-auto font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
                ⌘↵ to add
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          {/*
            "Start a new run", not "Run now".
            
            It was the latter, and the label was actively misleading: after clicking a past run in
            the rail, pressing it appeared to re-run *that* run and in fact started an unrelated
            one. The verb now says what happens, and the back-to-live control below gives the
            action people were actually reaching for.
          */}
          <button
            type="button"
            onClick={onRunNow}
            disabled={busy}
            className="rounded px-2.5 py-1 text-[13px] font-medium disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Start a new run
          </button>
          {viewingPast && (
            <button
              type="button"
              onClick={onBackToLive}
              disabled={busy}
              className="rounded border px-2.5 py-1 text-[13px] disabled:opacity-40"
              style={{ borderColor: 'var(--border-strong)' }}
            >
              ← Back to the latest run
            </button>
          )}
          {/* Halt, not pause. Pause implies resume, which implies a checkpoint and a restart path. */}
          <button
            type="button"
            onClick={onHalt}
            disabled={!canHalt}
            className="rounded border px-2.5 py-1 text-[13px] disabled:opacity-30"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            Halt
          </button>
          {!composing && (
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="rounded border px-2.5 py-1 text-[13px]"
              style={{ borderColor: 'var(--border-strong)' }}
            >
              Add brief
            </button>
          )}
          <div className="ml-auto">
            <FailureDrawer />
          </div>
        </div>
      </div>
    </div>
  );
}
