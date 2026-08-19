'use client';

/**
 * A POST THAT HAS BEEN DEALT WITH.
 *
 * Replaces the "Already decided" section, which was a separate heading over a list of one-line rows
 * printing `draft.state` as a raw enum. Two problems: the heading announced a category the operator
 * does not think in ("already decided" is not a thing you look for, it is a thing you are finished
 * with), and the rows showed a slice of the post you could not open.
 *
 * Now they sit at the foot of the same stack as the work, with no heading of their own — the
 * treatment carries it. Dimmed, flat, no shadow, no action bar, and a state pill. Clicking opens the
 * full post in place, because the commonest reason to look at a decided post is to check what you
 * approved.
 */

import { useState } from 'react';
import type { Draft } from '@/lib/types';
import { ChannelMark } from '@/components/ChannelMark';

const STATE: Record<string, { label: string; pill: string }> = {
  approved: { label: 'Approved', pill: 'pill-go' },
  rejected: { label: 'Sent back', pill: 'pill-attend' },
  held: { label: 'On hold', pill: 'pill-attend' },
  blocked_auth: { label: 'Channel disconnected', pill: 'pill-stop' },
};

export function DecidedCard({ draft, angle }: { draft: Draft; angle: string }) {
  const [open, setOpen] = useState(false);
  const version = draft.versions.find((v) => v.id === draft.current_version_id);
  const state = STATE[draft.state] ?? { label: draft.state, pill: 'pill-calm' };
  const edited = draft.versions.some((v) => v.author === 'human');

  return (
    <article className={`card card-done${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="done-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChannelMark channel={draft.channel} size={14} />
        <span className="done-angle">{angle}</span>
        {edited && <span className="done-edited">edited by you</span>}
        <span className={`pill ${state.pill}`}>{state.label}</span>
        <span className={`done-car${open ? ' is-open' : ''}`} aria-hidden>▶</span>
      </button>

      {open && (
        <div className="card-body done-body">
          <p className="post">{version?.text}</p>
        </div>
      )}
    </article>
  );
}
