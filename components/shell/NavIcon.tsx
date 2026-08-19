/**
 * NAVIGATION ICONS.
 *
 * The rail used single characters — ◉ ✓ ▤ ◔ ⚙ — picked because they were available in a string
 * literal, not because they read as anything. They render at whatever weight the system font gives
 * them, sit on different baselines, and the "chart" one is a quarter-circle.
 *
 * These are hand-drawn on a 24px grid at a 1.6px stroke: a weight that matches the interface's type
 * rather than the heavier 2px most icon sets ship at, and square-ish corners because a large corner
 * radius is what makes an icon set look generic. Stroke-based rather than filled, so the active nav
 * item's accent colour comes through `currentColor` with no second asset.
 *
 * Drawn here rather than installed for the same reason as `ChannelMark`: five glyphs do not justify
 * a dependency in a repo where every line has to be defensible.
 */

const PATHS: Record<string, React.ReactNode> = {
  /** Console: a terminal-ish window with a live row — the batch, running. */
  console: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M3 9h18" />
      <path d="M7 13h5" />
    </>
  ),
  /** Approvals: a check inside a list, because the queue is a list of decisions. */
  approvals: (
    <>
      <path d="M4 6h9M4 11h6M4 16h5" />
      <path d="M14 14.5l2.2 2.2L21 12" />
    </>
  ),
  /** Calendar: a month grid with the header bar, which is what the week actually is. */
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
      <path d="M8 13.5h2M14 13.5h2M8 16.5h2M14 16.5h2" />
    </>
  ),
  /** Metrics: bars of unequal height, not a pie — the dashboard is bar charts. */
  metrics: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8.5 20v-6M13 20v-9.5M17.5 20v-4" />
    </>
  ),
  /** Settings: sliders, which is what this screen is — not a cog, because nothing here is machinery. */
  settings: (
    <>
      <path d="M4 7.5h10M18 7.5h2M4 16.5h4M12 16.5h8" />
      <circle cx="16" cy="7.5" r="2.2" />
      <circle cx="10" cy="16.5" r="2.2" />
    </>
  ),
};

export function NavIcon({ name }: { name: keyof typeof PATHS | string }) {
  return (
    <svg
      className="nav-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
