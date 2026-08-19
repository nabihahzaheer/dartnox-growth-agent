/**
 * THE REBUILT INTERFACE'S SHELL.
 *
 * A route group, so the URLs are `/`, `/approvals`, `/week` and so on with no `(main)` segment,
 * and so `app/v1` inherits none of it. The two interfaces share only the root layout, which now
 * holds no layout opinion because they disagree about whether the page scrolls.
 *
 * The sidebar owns its own read against `agentClient` — see its file — rather than taking the
 * count as a prop, because a layout-level prop would only ever reflect whichever page the operator
 * loaded first and would not move when a different page decides an item.
 */
import { Sidebar } from '@/components/shell/Sidebar';

export default function MainLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="shell">
      <Sidebar />
      <main className="shell-main">{children}</main>
    </div>
  );
}
