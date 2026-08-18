/**
 * THE REBUILT INTERFACE'S SHELL.
 *
 * A route group, so the URLs are `/`, `/approvals`, `/week` and so on with no `(main)` segment,
 * and so `app/v1` inherits none of it. The two interfaces share only the root layout, which now
 * holds no layout opinion because they disagree about whether the page scrolls.
 *
 * The waiting count is passed to the sidebar rather than read there, because the sidebar should not
 * own a data dependency. It becomes a live read against `agentClient` when the console lands.
 */
import { Sidebar } from '@/components/shell/Sidebar';

export default function MainLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="shell">
      <Sidebar waiting={8} />
      <main className="shell-main">{children}</main>
    </div>
  );
}
