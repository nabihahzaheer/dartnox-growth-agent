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
import { needsAPerson } from '@/lib/world';
import { BreakNextRead } from './BreakNextRead';
import { NavIcon } from './NavIcon';
import { ChannelMark } from '@/components/ChannelMark';

type Dest = { href: string; label: string; icon: string };

/** Renamed per Nabihah: "The week" said nothing about what it holds, and "Results" reads as an
 *  outcome report rather than the instrument panel it is. */
const DESTINATIONS: Dest[] = [
  { href: '/', label: 'Console', icon: 'console' },
  { href: '/approvals', label: 'Approvals', icon: 'approvals' },
  { href: '/week', label: 'Content calendar', icon: 'calendar' },
  { href: '/results', label: 'Metrics', icon: 'metrics' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
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
        /** Not `items.length` — see `needsAPerson` in `lib/world.ts` for what that counted and why
         *  the badge disagreed with the console. */
        if (!cancelled) setWaiting(items.filter(needsAPerson).length);
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
              <NavIcon name={d.icon} />
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
        <ChannelMark channel="linkedin" size={15} />
        brightsill
      </p>
      <p className="shell-chan">
        <ChannelMark channel="x" size={15} />
        brightsill_nyc
      </p>

      {/** Last in the rail, below the channels: it is about the prototype rather than about the
       *   client. Labelled as a demo control on itself, because a reviewer must never have to guess
       *   whether a switch is a product feature (D-020). */}
      <BreakNextRead />

    </aside>
  );
}
