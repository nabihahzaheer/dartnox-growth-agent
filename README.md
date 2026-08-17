# Growth Agent — operator console

Frontend-only prototype of the operator-facing product for an AI content agent: plans a weekly
content calendar from brand pillars, drafts channel-specific posts, routes every one through human
approval, schedules publishing, and feeds performance back into drafting.

Built for a technical assessment, August 2026. **Brightsill, the client in the fixtures, is
invented** — not a Dartnox client, and this is not a Dartnox product.

> **No backend, no API routes, no keys, no network calls.** All state is client-side.

**Where to start:** open `/console`, let the live run finish, then follow *Decide on this in the
queue*. The console watches; the queue decides. To see what the agent plans for the week, open the
**Plan next week** run in the left rail.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000 → redirects to /console
```

```bash
npm run verify       # check + tsc + eslint + build — 1,696 assertions
```

Node ≥ 22. On a fresh clone `tsc --noEmit` alone fails with `Cannot find name 'LayoutProps'` — Next 16
generates route types into `.next/types`, so a build must run once first. `npm run verify` orders
them correctly.

## Screens

| Route | What it does |
|---|---|
| `/console` | Live activity feed. Steps stream with real timing; tool calls and results expand; guardrails branch the run. Open **Plan next week** to see the proposed content calendar. |
| `/queue` | Everything waiting on a person — drafts, runs that never produced one, and posts sent back by a settings change. |
| `/draft/[id]` | One item opened fully: post, versions, score arithmetic, every guardrail evaluation, full reasoning trace. |
| `/metrics` | The PRD's KPIs, computed live, one drill-down. |
| `/settings` | Tone, thresholds, approval rules, escalation triggers, guardrail rules. |

## Architecture

```
app/          routes, one directory per screen
components/   shared UI
lib/
  types.ts        the data contract — 112 exported types
  agentClient.ts  the simulated API — the only module that knows this is fake
  world.ts        state transitions as pure functions
  metrics.ts      every dashboard number, computed
fixtures/     typed, versioned dummy data — imported only by agentClient.ts
scripts/      check.mts — invariants, referential integrity, transition assertions
```

**One seam.** Every screen calls `lib/agentClient.ts`, gets a promise, and cannot tell it from a real
API client. Replacing its function bodies with HTTP calls is the entire migration path, and its type
signatures are the contract you'd hand a backend engineer on day one. No component imports a fixture.

It carries the two things a backend engineer asks about first: a **discriminated error union** (7
kinds) rather than thrown strings, and an **idempotency key on every write**. Pagination is
deliberately absent — no endpoint returns an unbounded list.

**Transitions are pure.** `lib/world.ts` imports no React and does no I/O; each function takes the
world and returns the records it changed. That's why `scripts/check.mts` can test them with a plain
Node script instead of rendering anything.

`fixtures/` sits beside `lib/` rather than inside it because it's a separate layer with exactly one
permitted consumer — the file tree should say so before you open anything.

## What's real vs. pre-written

| Real | Pre-written |
|---|---|
| Steps arrive one at a time on a timer | The words — post text, reasoning, tool payloads |
| Data arrives asynchronously (loading states aren't staged) | Redraft prose after a rejection |
| Failed calls genuinely fail | Guardrail explanations |
| Runs branch on their own guardrail results | |
| Every metric computed from records on each render | |
| A submitted brief is the one the next step reads | |

So when a rejection "changes what the agent does next": the redraft text is pre-written, but the list
of inputs that run consumed is assembled at emit time from current state. What's real is **which
inputs the run consumed**, not the prose.

**Timing.** Every step carries two numbers: `latency_ms` (honest — a drafting call really takes ~20s,
shown as metadata) and `playback_ms` (how long the console waits). The showcase run's real duration
is 44s and it plays in 14s — **about 3×**. Played at true speed it's unwatchable; a uniform 300ms tick
is the faked streaming the brief rejects.

**Fixtures.** ~500 records across 13 types — three weeks of settled history plus a three-week forward
pipeline. Hand-written where a reviewer actually reads (current drafts with full traces, the long
post bodies, the human edit pairs); generated deterministically from compact tables elsewhere, with a
seeded PRNG, never `Math.random()`.

**Dates.** Every timestamp is a signed offset in minutes from one build-time anchor, never an
absolute date, so the set expresses relationships rather than timestamps kept consistent by hand. The
anchor is the most recent Thursday and **the weekday is load-bearing** — planning runs Monday, the
drafting batch Wednesday, review runway counts working days. The dataset ages in whole weeks between
deploys; one redeploy refreshes it.

## Deliberate, not broken

<details>
<summary>Things that would otherwise look like defects (click to expand)</summary>

- **Reload resets to fixture state.** No persistence, by decision — a `localStorage` layer would
  imitate durability without demonstrating anything.
- **"break something" on the console is a demo control, not a product feature.** Production
  equivalents are a staging environment, CI fault injection and a replay tool. `RunVariant` in the
  types is the same: a demo affordance with no production counterpart.
- **Settings is deliberately the thinnest screen.** The brief names four controls; its closing line
  says choose an alive console over a fifth polished screen. Cadence, posting windows, both
  allowlists, entities, terminology, budget cap, auto-pull, negative-engagement threshold,
  rejection-reason set and weekend contact are modelled and not rendered.
- **Three of five learned writing rules show no backing edits.** They were learned from decisions
  outside the three weeks of history retained. Empty is a statement, not missing data — the one
  *suggested* rule carries all three and expands to show them.
- **Hashes read `fnv1a:`, not `sha256:`.** Production uses sha256; in-browser `crypto.subtle` is
  async and making every transition async for a hash nothing here depends on cryptographically is a
  real cost for a pretend one. The prefix says what it actually is.
- **Trace steps show an input hash and output ref but inline their payloads.** Production resolves
  those through the trace store; there's no backend here to resolve against.
- **The similarity number is asserted, not a computed cosine.** A token-overlap score labelled a
  cosine would be worse, and the threshold isn't portable across embedding models.
- **The edit-distance tokeniser is crude on purpose** — whitespace-split, lowercased, punctuation
  stripped. It feeds a relative signal; a cleverer one would move every historical value without
  making any comparison more true.
- **The banned-claim sweep matches by literal string** against real post text. Type a phrase that
  appears in nothing and nothing happens. The field counts matches as you type.
- **The auto-approve control is live and refuses** rather than being greyed out — a disabled input
  fires no events, so an operator wanting to know why has nothing to click.
- **Versioned fixtures** means two things: they're in git, and each file declares the schema version
  it was authored against, compiler-checked. With one version in existence that check can never fire
  — it demonstrates the seam, it is not a migration path.
- **Cold start is invisible here.** Brightsill is nine weeks in, and one client can't both lack
  history and hold the record four screens need. That path lives in the PRD and on the diagram.
- **Desktop-first.** An operator console is a dense surface someone sits in front of for an hour. Not
  responsive below tablet width, by decision.

</details>

## With more time

- **React Query** for the data layer. Hand-rolling is right at this size (~10 lines of `useState`
  against a provider, a cache and devtools to explain); that flips the moment a real backend exists.
- **shadcn/ui** for dialogs and comboboxes. Rejected because it copies 20+ files I didn't write into
  a repo where I defend every line — the honest cost is accessibility. The browser's own `<dialog>`
  closes most of that gap, not all.
- **Persistence**, so a reload doesn't reset the demo.
- **A real test runner.** `check.mts` is a script that exits non-zero — no coverage, no watch, no
  isolation. It shouldn't grow into a suite; if it needs to, Vitest is the answer.
- **Node pinning** via `.nvmrc` and CI on the deploy target's version. `engines` is the cheap 80%.
- **Unit economics** — cost per client per month and what it implies for pricing.

## Licence

Produced as an evaluation exercise for Dartnox LLC, August 2026. Copyright remains with the author;
Dartnox stated the work would not be used commercially and that the author keeps their IP. No
third-party code is vendored — the dependency list is Next.js, React and Tailwind.
