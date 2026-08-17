import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Growth Agent — operator console",
  description:
    "Operator console for an AI content agent: plans, drafts, routes for approval and publishes.",
};

/**
 * The root layout stays a server component. The only JavaScript it ships is the nav, which needs
 * the current path to mark the active item.
 *
 * D-022 originally said this layout ships no JavaScript at all, which stopped being true the
 * moment anything here needed interactivity — the decision is amended rather than quietly broken.
 * The rule that survives, and still fits in a sentence: the layout is a server component, and
 * every interactive piece is a client component beneath it.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header
          className="sticky top-0 z-10 border-b"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-2">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">Growth Agent</span>
              {/* One client per console (D-017), so the client is a fact about the whole surface
                  rather than something you switch. It belongs in the chrome. */}
              <span className="font-mono text-xs" style={{ color: "var(--text-faint)" }}>
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
