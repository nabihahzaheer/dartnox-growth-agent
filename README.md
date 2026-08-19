# Growth Agent — operator console

Frontend-only prototype of the operator-facing product for an AI content agent: plans a weekly
content calendar from brand pillars, drafts channel-specific posts, routes every one through human
approval, schedules publishing, and feeds performance back into drafting.

Built for a technical assessment, August 2026. **Brightsill, the client in the fixtures, is
invented** — not a Dartnox client, and this is not a Dartnox product.

> **No backend, no API routes, no keys, no network calls.** All state is client-side.

**Where to start:** open **`/`**, the console. It shows Wednesday's drafting batch — eight posts, one
run each. One child is still mid-flight and streams its steps as they arrive; the rest are waiting on
you, each rendered as the post first with the decision under it. One of them is **blocked** and
offers no Approve at all — the gate withholds it, and the interface renders whatever the gate offers
rather than deciding for itself which button to grey out. Send one back, pick a reason, then reopen
the live run and expand **Writing the draft**: the reason you chose is listed as an input that run
consumed. Then try **`/week`** for the calendar and
**`/settings`**, where dragging the monthly cap under current spend puts the system into its own
budget stop.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000 → the console
```

```bash
npm run verify       # check + build + tsc + eslint — 2,035 assertions
```

Node ≥ 22. On a fresh clone `tsc --noEmit` alone fails with `Cannot find name 'LayoutProps'` — Next 16
generates route types into `.next/types`, so a build has to run first. `npm run verify` runs the
build before the typecheck for that reason; run them the other way round on a clean checkout and the
typecheck fails on generated types that do not exist yet.

## Screens

| Route | What it does |
|---|---|
| `/` | **Console** — Wednesday's drafting batch. The posts waiting on you, largest thing on the page, with the decision under each. The one child still running streams its steps: a step appears when it *starts* and settles after its own duration, so the agent is visibly mid-work rather than producing finished rows. Expanding a step shows its model, tokens and cost. |
| `/approvals` | Everything waiting on a person — drafts, runs that never produced one because their source was quarantined, and posts a settings change sent back. |
| `/approvals/[id]` | One item opened fully: the post, why it needs you, the score and its weakest dimension, every version with what changed, then the whole reasoning trace. |
| `/week` | Three weeks of slots on a Monday–Sunday grid, with the client owner's plan-approval gate and any slot that slipped showing where it moved from. |
| `/results` | The PRD's fourteen metrics, computed live from the records on every render, leading with the three alarms. One drill-down: block rate by guardrail layer. |
| `/settings` | Voice and banned phrases, the review threshold, the monthly budget cap, approval rules, escalation triggers, the guardrail list, and the locked auto-approve toggle. |
| `/v1/*` | The interface submitted on 17 August, kept for comparison. See **Two interfaces** below. |

## Architecture

```
app/          routes, one directory per screen
components/   shared UI
lib/
  types.ts        the data contract — 113 exported types
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
| The rejection reason you pick is what the next run consumes | |

So when a rejection "changes what the agent does next": the redraft text is pre-written, but the list
of inputs that run consumed is assembled at emit time from current state. What's real is **which
inputs the run consumed**, not the prose. Send a draft back marked *off pillar* and the next drafting
step lists `Avoiding: Off pillar`; pick a different reason and it says that instead.

**Timing.** Every step carries two numbers: `latency_ms` (honest — the drafting call really takes
18.6s, and that is the duration shown on the step) and `playback_ms` (how long that step is shown
working). A drafting child's real duration is **38.8s** and it plays over **3m36s**, or 3m02s from
where the console attaches mid-run. So the playback does not compress — it **slows down**, by about
**5.6×**. Four children stream at once inside fixed-height windows; at true speed that is four cards
blurring through eleven steps each in under forty seconds, which is motion without legibility.

The slowdown is not uniform. Each step's share of the budget tracks roughly the **square root** of
its own latency, so the 18.6s drafting call does not swallow half the run and a 0.14s tool result
does not flash past — and every step's live clock advances at a rate you can read. A uniform 300ms
tick is the faked streaming the brief rejects; so is a progress bar with nothing behind it. Both
numbers sit on every step, and `PLAYBACK_SCALE` (`lib/agentClient.ts`) is the single multiplier
between `playback_ms` and the wall clock.

A step arrives when it **starts**, not when it finishes, and settles after its own duration. While
it's in flight the console withholds the duration, tokens and cost, because those facts don't exist
yet.

**Fixtures.** ~590 records across 12 collections — three weeks of settled history plus a three-week forward
pipeline. Hand-written where a reviewer actually reads (current drafts with full traces, the long
post bodies, the human edit pairs); generated deterministically from compact tables elsewhere, with a
seeded PRNG, never `Math.random()`.

**Dates.** Every timestamp is a signed offset in minutes from one build-time anchor, never an
absolute date, so the set expresses relationships rather than timestamps kept consistent by hand. The
anchor is **this week's Thursday** and **the weekday is load-bearing** — planning runs Monday, the
drafting batch Wednesday, review runway counts working days.

This week's Thursday rather than the most recent one, which is a change and a deliberate one. The
dataset is built around the anchor: the batch ran "yesterday" and drafts the posts for "next week".
Anchoring backwards meant that late in a week the fixture's "next week" was the week the real
calendar was already in, so the console announced it was drafting next week's posts while the
calendar showed those same posts inside the week it had labelled current. Anchoring to the current
week's Thursday puts the fixture's now inside the real current week and makes "next week" mean the
same thing on both screens. The anchor may then sit up to three days ahead of the build; drift
against the real clock is at most three days either way, where the old rule ran up to seven days
behind. One redeploy re-centres it.

## Deliberate, not broken

<details>
<summary>Things that would otherwise look like defects (click to expand)</summary>

- **Reload resets to fixture state.** No persistence, by decision — a `localStorage` layer would
  imitate durability without demonstrating anything.
- **"Break the next read" in the sidebar is a demo control, not a product feature.** Production
  equivalents are a staging environment, CI fault injection and a replay tool. It arms one transport
  failure, spends itself on the next call, and through it every screen's error state is reachable —
  which is the only reason those states are reviewable rather than merely written. `RunVariant` in
  the types is the same: a demo affordance with no production counterpart. v1 carries four further
  switches that arm whole failure *runs*; they live at `/v1/console` and not here, because this
  interface has no run-starting control to arm them against.
- **Settings is deliberately narrow.** The brief names four controls — tone, thresholds, approval
  rules, escalation triggers — and its closing line says choose an alive console over a fifth
  polished screen. Those four ship, plus the guardrail list, the monthly budget cap and the locked
  auto-approve toggle. Cadence, posting windows, both allowlists, entities, terminology, auto-pull,
  the negative-engagement threshold and the weekend contact are modelled and not rendered. The
  rejection-reason set *is* rendered — in the reject dialog rather than as a settings row, because
  that is where an operator actually meets it.
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
- **Desktop-first.** An operator console is a dense surface. Below 860px the sidebar becomes a
  horizontal strip so every screen stays reachable, and the week grid drops to two columns below
  900px — but these layouts are designed for a desktop viewport and a phone is a fallback, not a
  target.

</details>

## Two interfaces

`main` holds the version submitted on 17 August. This branch rebuilds the interface on the same
backend — same `agentClient` seam, same fixtures, same transitions — and the original is preserved at
**`/v1/*`** so the two can be opened side by side.

**Why it was rebuilt.** The submitted interface asked for an approve/reject decision **without the
post text on screen**, which was the worst finding of reviewing it. Around that sat a dark,
monospace-heavy surface with a two-pixel type scale, reverse-engineered from the assessment PDF's own
header bar — a fact about a PDF rather than about a marketing lead clearing eight posts a week. And
engineer vocabulary (`fetch_source`, `L1`/`L2`/`L3`, HTTP status codes) had reached the *fixtures*,
not just the components, so it could not be fixed in the UI alone.

**One caveat about `/v1`.** It is not byte-identical to what was submitted. The language pass rewrote
~74 step labels and 13 metric names inside the **shared** fixtures, so v1 renders the new
plain-language labels too. Its layout, density, palette and interaction are untouched. Forking 2,800
lines of fixtures to freeze it exactly was judged worse than the drift — but it does mean v1 reads
slightly differently from the screenshots in the walkthrough PDF.

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
