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

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Dest = { href: string; label: string; glyph: string };

const DESTINATIONS: Dest[] = [
  { href: '/', label: 'Console', glyph: '◉' },
  { href: '/approvals', label: 'Approvals', glyph: '✓' },
  { href: '/week', label: 'The week', glyph: '▤' },
  { href: '/results', label: 'Results', glyph: '◔' },
  { href: '/settings', label: 'Settings', glyph: '⚙' },
];

export function Sidebar({ waiting }: { waiting: number }) {
  const pathname = usePathname();

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

      <p className="shell-foot">
        <Link href="/v1/console">Version submitted 17 Aug →</Link>
      </p>
    </aside>
  );
}
