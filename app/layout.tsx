import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Growth Agent — operator console",
  description:
    "Operator console for an AI content agent: plans, drafts, routes for approval and publishes.",
};

/**
 * ROOT LAYOUT — deliberately empty of layout.
 *
 * This used to impose `flex h-dvh overflow-hidden` on the body, because v1 was a fixed viewport
 * that never scrolled. That constraint moved to `app/v1/layout.tsx`, where it belongs: it is a
 * property of that interface, not of the application. Two interfaces now share this root and they
 * disagree about whether the page scrolls, so the root holds neither opinion.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body>{children}</body>
    </html>
  );
}
