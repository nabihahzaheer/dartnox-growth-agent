import type { Metadata } from "next";
import "./globals.css";
import { Rail } from "@/components/Rail";

export const metadata: Metadata = {
  title: "Growth Agent — operator console",
  description:
    "Operator console for an AI content agent: plans, drafts, routes for approval and publishes.",
};

/**
 * APP SHELL — a fixed viewport, not a document.
 *
 * The first version scrolled like a page: a big title, stacked sections, content running off the
 * bottom. That is the wrong model. An operator console is an application someone sits in front of
 * for an hour clearing a queue, and applications of this kind share a shape — a left rail for
 * context, one scrolling region, and controls pinned where the hand already is.
 *
 * So the body is exactly the viewport height and never scrolls. Only the transcript inside the
 * main column does. That single constraint is what makes the difference between "a web page about
 * an agent" and "an agent you are watching".
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="flex h-dvh overflow-hidden">
        <Rail />
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
