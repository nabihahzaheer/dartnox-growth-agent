'use client';

/**
 * THE RAIL — screens, and the list of work the agent has done.
 *
 * The run list is here rather than in the main column because it is context, not content: it
 * answers "which job am I looking at" and lets you move between them without losing your place.
 *
 * EVERY ROW SAYS WHAT THE RUN DID, not what it is called. `RUN-0143 · draft` is an id and a
 * category; "Draft · Field notes / X" is a job. The id is still there, smaller, because it is what
 * you quote when something goes wrong — but it is not what you scan by.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getRunSummaries, type RunSummary } from '@/lib/agentClient';
import type { RunId } from '@/lib/types';
import { Badge, RUN_STATE_LABEL, runStateTone } from '@/components/Badge';
import { formatRelative } from '@/lib/time';

const SCREENS = [
  { href: '/console', label: 'Console' },
  { href: '/queue', label: 'Queue' },
] as const;

export function Rail({
  selectedRunId,
  onSelectRun,
}: {
  selectedRunId?: RunId | null;
  onSelectRun?: (id: RunId) => void;
}) {
  const pathname = usePathname();
  const [summaries, setSummaries] = useState<RunSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    getRunSummaries()
      .then((all) => {
        if (!cancelled) setSummaries([...all].reverse());
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside
      className="flex w-60 shrink-0 flex-col border-r"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-sunk)' }}
    >
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-[9px] w-[9px] shrink-0"
            style={{ background: 'var(--accent)' }}
          />
          <span className="text-[13px] font-bold">Growth Agent</span>
        </div>
        {/* The client the console operates. One client per console (D-017), so it is a fact about
            the whole surface — and naming it as a client stops it being an unexplained word. */}
        <div className="mt-0.5 pl-[17px] text-[11px]" style={{ color: 'var(--text-faint)' }}>
          Client: Brightsill
        </div>
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
        Runs
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {summaries.map(({ run, title, detail }) => {
          const selected = run.id === selectedRunId;
          return (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => onSelectRun?.(run.id)}
                aria-current={selected ? 'true' : undefined}
                className="mb-0.5 w-full rounded px-2 py-1.5 text-left"
                style={{ background: selected ? 'var(--surface)' : 'transparent' }}
              >
                <div className="flex items-start justify-between gap-1.5">
                  <span className="text-[12px] leading-tight">{title}</span>
                  <Badge tone={runStateTone(run.state)}>
                    {RUN_STATE_LABEL[run.state] ?? run.state}
                  </Badge>
                </div>
                <div className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  {detail}
                </div>
                <div className="mt-0.5 font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
                  {run.id} · {formatRelative(run.started_at)}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
