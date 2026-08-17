'use client';

/**
 * NAV — only routes that exist.
 *
 * Screens are added here as they land rather than stubbed out in advance. A nav item leading to a
 * placeholder is worse than a shorter nav: it advertises something that is not there, and this
 * repository is deployed continuously so a reviewer could open it at any moment.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ROUTES = [{ href: '/console', label: 'Console' }] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Screens" className="flex items-center gap-1">
      {ROUTES.map((route) => {
        const active = pathname === route.href;
        return (
          <Link
            key={route.href}
            href={route.href}
            aria-current={active ? 'page' : undefined}
            className="rounded px-2 py-1 text-sm transition-colors"
            style={{
              color: active ? 'var(--accent-text)' : 'var(--text-muted)',
              background: active ? 'var(--accent-soft)' : 'transparent',
            }}
          >
            {route.label}
          </Link>
        );
      })}
    </nav>
  );
}
