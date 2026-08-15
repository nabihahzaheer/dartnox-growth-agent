# Growth Agent — operator console

Frontend-only prototype of the operator-facing product for an AI content agent. The agent
plans a content calendar from a client's brand pillars, drafts channel-specific posts,
routes them through human approval, schedules publishing, and feeds per-post performance
back into future drafting.

Built for a technical assessment, August 2026. This is not a Dartnox product and is not
affiliated with any live system.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

Built against Node 25 locally and deployed on Vercel's current LTS runtime. Nothing here
depends on a specific Node version.

## What is simulated

All of it. There is no backend, no API routes, no keys and no network calls. Every piece
of state lives client-side.

Every piece of data is served by `lib/agentClient.ts` — the single module standing in for
a real API client. Its functions are `async`, resolve after a delay that varies by
operation, and can be made to fail deliberately, so loading and error states in the UI are
honest rather than staged locally in each component. No component imports a fixture file
directly. Fixtures live in `fixtures/` as versioned, typed data and are read by that one
module and nowhere else.

That module is the entire migration path. Replacing it with a real HTTP client is the
whole job, and the type signatures on its functions are the API contract you would hand a
backend engineer on day one.

## Structure

```
app/          routes, one directory per screen
components/   shared UI
lib/          types.ts (the data contract), agentClient.ts (the simulated API)
fixtures/     typed, versioned dummy data — imported only by agentClient.ts
```

`fixtures/` sits beside `lib/` rather than inside it on purpose: it is a separate layer
with exactly one permitted consumer, and the file tree should say so.

## What I would do differently with more time

Filled in at submission.
