import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Growth Agent — operator console",
  description:
    "Operator console for an AI content agent: plans, drafts, routes for approval and publishes.",
};

/**
 * APP SHELL — a fixed viewport, not a document.
 *
 * The body is exactly the viewport height and never scrolls; only regions inside it do. That one
 * constraint is the difference between a web page about an agent and an application you watch an
 * agent inside.
 *
 * The rail lives in the screen rather than here, because it needs to know which run is selected.
 * It moves up to this layout once the shared store exists and that selection has somewhere to
 * live other than a single page's state.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="flex h-dvh overflow-hidden">{children}</body>
    </html>
  );
}
