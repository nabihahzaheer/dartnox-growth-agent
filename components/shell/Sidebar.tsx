'use client';

/**
 * SIDEBAR — the rebuilt interface's navigation.
 *
 * Shaped after Planable's, which is the closest shipping product to what this is: a left column of
 * destinations, then the connected channels listed under them. Two departures from v1's rail:
 *
 *   It carries navigation and nothing else. v1's rail was 240px holding navigation, a budget
 *   figure, a week stepper and up to twelve slot rows at 11px — an event log where the navigation
 *   belonged. The week is a destination here, not a permanent column.
 *
 *   The count on Approvals is the only number in it. Planable's convention, and it is the one
 *   figure an operator needs before deciding whether to open the app at all.
 *
 * Channel identity uses the platform's own colour and nothing else uses those colours, which is
 * Sprout Social's published rule and the reason a multi-channel interface does not turn to confetti.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getQueue, subscribeToWorld } from '@/lib/agentClient';
import { BreakNextRead } from './BreakNextRead';

type Dest = { href: string; label: string; glyph: string };

const DESTINATIONS: Dest[] = [
  { href: '/', label: 'Console', glyph: '◉' },
  { href: '/approvals', label: 'Approvals', glyph: '✓' },
  { href: '/week', label: 'The week', glyph: '▤' },
  { href: '/results', label: 'Results', glyph: '◔' },
  { href: '/settings', label: 'Settings', glyph: '⚙' },
];

export function Sidebar() {
  const pathname = usePathname();
  /** Own read, not a prop from the layout. The badge has to move the moment anything decides an
   *  item anywhere in the app, and a server-rendered prop would only ever reflect the page the
   *  operator loaded first. */
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void getQueue().then((items) => {
        /**
         * Not `items.length`.
         *
         * The queue holds runs that are recovering on their own — `parked_transient` renders the
         * copy "Retrying automatically", and the hourly sweep releases it without anybody touching
         * it. Counting those made the badge read 9 while the console said 5 and the week said 4, and
         * four of the nine were rows with no control on them at all. The sidebar's own docblock calls
         * this "the one figure an operator needs before deciding whether to open the app", which it
         * cannot be if it counts work nobody has to do.
         */
        const needsAPerson = items.filter(
          (i) => i.kind !== 'run' || i.run.state === 'quarantined' || i.run.state === 'parked_blocked',
        );
        if (!cancelled) setWaiting(needsAPerson.length);
      });
    };
    const unsubscribe = subscribeToWorld(refresh);
    refresh();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <aside className="shell-side">
      <div className="shell-brand">
        <span className="shell-logo" aria-hidden>
          GA
        </span>
        <span className="shell-client">Brightsill</span>
      </div>

      <nav className="shell-nav" aria-label="Sections">
        {DESTINATIONS.map((d) => {
          const active = d.href === '/' ? pathname === '/' : pathname.startsWith(d.href);
          return (
            <Link key={d.href} href={d.href} className={active ? 'is-here' : undefined}>
              <span className="shell-glyph" aria-hidden>
                {d.glyph}
              </span>
              {d.label}
              {d.href === '/approvals' && waiting > 0 && (
                <span className="shell-badge">{waiting}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <p className="shell-group">Channels</p>
      <p className="shell-chan">
        <span className="shell-dot" style={{ background: 'var(--ch-linkedin)' }} aria-hidden />
        brightsill
      </p>
      <p className="shell-chan">
        <span className="shell-dot" style={{ background: 'var(--ch-x)' }} aria-hidden />
        brightsill_nyc
      </p>

      {/** Below the channels and above the v1 link, which is where the two things that are about the
       *   prototype rather than about the client belong. Labelled as a demo control on itself — a
       *   reviewer must never have to guess whether a switch is a product feature (D-020). */}
      <BreakNextRead />

      <p className="shell-foot">
        <Link href="/v1/console">Version submitted 17 Aug →</Link>
      </p>
    </aside>
  );
}
