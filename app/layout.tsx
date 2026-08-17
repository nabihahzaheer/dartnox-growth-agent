import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Growth Agent — operator console",
  description:
    "Operator console for an AI content agent: plans, drafts, routes for approval and publishes.",
};

/**
 * The root layout stays a server component. The only JavaScript it ships is the nav, which needs
 * the current path to mark the active item. D-022 originally claimed it ships none, which stopped
 * being true the moment anything here needed interactivity — amended rather than quietly broken.
 *
 * No webfont is loaded. The assignment PDF sets its type in Helvetica and Courier, both system
 * fonts, so matching the document also removed two Google Font requests.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">
        {/* The document's own header: a near-black bar with the blue square at its left. */}
        <header
          className="sticky top-0 z-10 border-b"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-[9px] w-[9px]"
                style={{ background: "var(--accent)" }}
              />
              <span className="text-sm font-bold">Growth Agent</span>
              {/* One client per console (D-017), so the client is a fact about the whole surface
                  rather than something you switch. It belongs in the chrome. */}
              <span
                className="font-mono text-[11px] uppercase"
                style={{ color: "var(--text-faint)", letterSpacing: "0.08em" }}
              >
                Brightsill
              </span>
            </div>
            <Nav />
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
