'use client';

/**
 * THE RAIL — brand, screens, and the run history.
 *
 * The run list belongs here rather than in the main column because it is *context*, not content:
 * it answers "which run am I looking at" and lets you move between them without losing the one on
 * screen. That is the same job a conversation list does in a chat client, and the same job a
 * session list does in an agent tool.
 *
 * The blue square appears once, on the brand. An earlier version repeated it on every section
 * heading, which is not what the assignment PDF does — there it opens a section, once, with a page
 * of space around it. Four squares stacked in one viewport turns a mark into wallpaper.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getRuns } from '@/lib/agentClient';
import type { Run } from '@/lib/types';
import { Badge, runStateTone } from '@/components/Badge';
import { formatRelative } from '@/lib/time';

const SCREENS = [{ href: '/console', label: 'Console' }] as const;

const RUN_TYPE_LABEL: Record<Run['type'], string> = {
  planning: 'Planning',
  draft: 'Draft',
  publish: 'Publish',
  poll: 'Poll',
};

export function Rail() {
  const pathname = usePathname();
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    let cancelled = false;
    getRuns()
      .then((all) => {
        if (!cancelled) setRuns([...all].reverse());
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside
      className="flex w-56 shrink-0 flex-col border-r"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-sunk)' }}
    >
      <div className="flex items-center gap-2 px-3 py-3">
        <span
          aria-hidden
          className="inline-block h-[9px] w-[9px] shrink-0"
          style={{ background: 'var(--accent)' }}
        />
        <span className="text-[13px] font-bold">Growth Agent</span>
      </div>

      <nav aria-label="Screens" className="px-2 pb-2">
        {SCREENS.map((screen) => {
          const active = pathname === screen.href;
          return (
            <Link
              key={screen.href}
              href={screen.href}
              aria-current={active ? 'page' : undefined}
              className="block rounded px-2 py-1 text-[13px]"
              style={{
                color: active ? 'var(--text)' : 'var(--text-muted)',
                background: active ? 'var(--surface)' : 'transparent',
              }}
            >
              {screen.label}
            </Link>
          );
        })}
      </nav>

      <div
        className="mt-1 border-t px-3 py-2 font-mono text-[10px] font-bold uppercase"
        style={{
          borderColor: 'var(--border)',
          color: 'var(--text-faint)',
          letterSpacing: '0.1em',
        }}
      >
        Recent runs
      </div>

      {/* The rail scrolls independently of the transcript. Two scroll regions is correct here —
          moving through run history should not move the run you are watching. */}
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {runs.map((run) => (
          <li key={run.id} className="mb-0.5">
            <div className="rounded px-2 py-1.5" style={{ background: 'transparent' }}>
              <div className="flex items-center justify-between gap-1">
                <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {run.id}
                </span>
                <Badge tone={runStateTone(run.state)}>
                  {run.state === 'awaiting_human' ? 'waiting' : run.state.replace(/_/g, ' ')}
                </Badge>
              </div>
              <div className="mt-0.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                {RUN_TYPE_LABEL[run.type]} · {formatRelative(run.started_at)}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div
        className="border-t px-3 py-2 text-[11px]"
        style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
      >
        Brightsill · one client per console
      </div>
    </aside>
  );
}
