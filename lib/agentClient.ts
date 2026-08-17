/**
 * agentClient — the one module that knows this system is simulated.
 *
 * D-002: no React component ever imports a fixture. Every screen calls a function here, gets a
 * promise back, and cannot tell the difference from a real API client. Replacing the bodies of
 * these functions with HTTP calls is the entire migration path, and their signatures are the
 * contract you would hand a backend engineer on day one.
 *
 * On the Miro board this module is the *Console API* box. That is deliberate — deliverables 1 and
 * 3 name the same seam, so a reviewer holding both finds them agreeing.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THE INDIRECTION ACTUALLY BUYS, SINCE "IT IS ALL FAKE ANYWAY" IS THE OBVIOUS OBJECTION
 *
 * Three things, none of which a component importing JSON can have:
 *
 *   Honest loading states, because the data really does arrive late.
 *   Honest error states, because a call can really fail.
 *   Latency that varies by operation, so a document fetch feels slower than a threshold read.
 *
 * A component importing a fixture synchronously has to fake all three locally, in every component.
 *
 * ---------------------------------------------------------------------------------------------
 * THIS MODULE OWNS THE WORLD (D-037)
 *
 * D-002 says the data comes from here; D-026 says state lives in a reducer. Left unresolved those
 * name two owners of one fact, and the moment an operator approves something the client is
 * answering with a stale world.
 *
 * Settled: this module is the server, because that is what it stands in for. It holds the single
 * mutable world, deep-cloned from the fixtures at initialisation. The React store caches what it
 * returns. Writes land here and hand back the records they changed, which is what a real API does.
 *
 * The clone is not a formality. Mutating the imported fixture arrays would corrupt state across
 * React 19 StrictMode's deliberate double-mount, and the symptom would look like a rendering fault
 * rather than the aliasing bug it is.
 */

import { fixtures } from '@/fixtures';
import type {
  Client,
  ConsoleError,
  Draft,
  DraftId,
  FixtureSet,
  MetricDescriptor,
  Pillar,
  Run,
  RunId,
  RunStep,
  Settings,
} from '@/lib/types';

/* ================================================================================================
 * THE WORLD
 * ==============================================================================================*/

/**
 * `structuredClone` rather than a spread. A spread is shallow: the nested arrays — `versions`,
 * `sources`, `prereqs` — would still be shared with the module-scope fixtures, so a write that
 * touched one would reach back into the template. Deep by default is the only safe default here.
 */
let world: FixtureSet = structuredClone(fixtures);

/** Used by the failure drawer's reset, and by anything that needs a clean slate. */
export function resetWorld(): void {
  world = structuredClone(fixtures);
}

/* ================================================================================================
 * SIMULATED TRANSPORT
 * ==============================================================================================*/

/**
 * Latency varies by operation deliberately (D-002). A settings read is a lookup; a run's full step
 * trace is a heavier query. Uniform delays are the tell that a prototype is faking it, and the
 * point of this module is that the loading states are honest rather than staged.
 *
 * Deterministic, not random: a demo that is sometimes slow and sometimes not is harder to talk
 * over, and `Math.random()` at module scope would make the build non-reproducible.
 */
const LATENCY_MS = {
  config: 120, // client, settings, pillars — small and cached in reality
  list: 260, // queue, run list
  detail: 380, // one draft with its versions
  trace: 520, // a run's full step history
} as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Failure injection (D-020). A demo affordance with no production counterpart — named as such in
 * the README. In production the equivalents are a staging environment, fault injection in CI and a
 * replay tool; none of those can be shown inside a frontend-only prototype, so the switches are
 * the only way to make the recovery paths observable rather than merely described.
 *
 * It lives here because D-002 already requires this module to be able to fail deliberately. The
 * drawer is a UI over a capability that has to exist anyway.
 */
type FailureSwitch = 'next_read_fails' | 'tool_failure';

const activeFailures = new Set<FailureSwitch>();

export function setFailure(which: FailureSwitch, on: boolean): void {
  if (on) activeFailures.add(which);
  else activeFailures.delete(which);
}

export function isFailureActive(which: FailureSwitch): boolean {
  return activeFailures.has(which);
}

/** Thrown as a plain object, not an `Error`. The caller branches on `kind` and renders different
 *  copy for each; parsing a message string would be the alternative and is worse. */
function fail(error: ConsoleError): never {
  throw error;
}

/** Every read goes through here, so latency and deliberate failure are applied in one place
 *  rather than remembered at each call site. */
async function read<T>(latency: number, produce: () => T): Promise<T> {
  await sleep(latency);
  if (activeFailures.has('next_read_fails')) {
    activeFailures.delete('next_read_fails'); // one-shot: the drawer arms it, the next call spends it
    fail({ kind: 'unavailable' });
  }
  return produce();
}

/* ================================================================================================
 * READS
 * ==============================================================================================*/

export async function getClient(): Promise<Client> {
  return read(LATENCY_MS.config, () => world.client);
}

export async function getPillars(): Promise<Pillar[]> {
  return read(LATENCY_MS.config, () => world.pillars);
}

export async function getSettings(): Promise<Settings> {
  return read(LATENCY_MS.config, () => world.settings);
}

export async function getMetricDescriptors(): Promise<MetricDescriptor[]> {
  return read(LATENCY_MS.config, () => world.metricDescriptors);
}

export async function getRuns(): Promise<Run[]> {
  return read(LATENCY_MS.list, () => world.runs);
}

export async function getRun(id: RunId): Promise<Run> {
  return read(LATENCY_MS.list, () => {
    const run = world.runs.find((r) => r.id === id);
    /** `not_found` renders as an empty state rather than as an error — D-031 is explicit that
     *  those are different things to show a person. */
    return run ?? fail({ kind: 'not_found' });
  });
}

export async function getDraft(id: DraftId): Promise<Draft> {
  return read(LATENCY_MS.detail, () => {
    const draft = world.drafts.find((d) => d.id === id);
    return draft ?? fail({ kind: 'not_found' });
  });
}

/**
 * A run's steps, ordered. Only the steps that have actually happened.
 *
 * `throughSeq` is what makes attaching to a live run possible: a run mid-flight has emitted some of
 * its steps and not the rest, and the console has to render the first group as history and receive
 * the second as they arrive.
 */
export async function getRunSteps(id: RunId, throughSeq?: number): Promise<RunStep[]> {
  return read(LATENCY_MS.trace, () =>
    world.runSteps
      .filter((s) => s.run_id === id && (throughSeq === undefined || s.seq <= throughSeq))
      .sort((a, b) => a.seq - b.seq),
  );
}

/** The run the console opens on: whatever is live, or the most recent one that stopped for a
 *  human. Falls back to the newest run so the screen is never empty by accident. */
export async function getActiveRun(): Promise<Run> {
  return read(LATENCY_MS.list, () => {
    const running = world.runs.find((r) => r.state === 'running');
    if (running) return running;
    const waiting = world.runs.find((r) => r.state === 'awaiting_human');
    if (waiting) return waiting;
    return world.runs.at(-1) ?? fail({ kind: 'not_found' });
  });
}

/* ================================================================================================
 * THE STREAM
 * ==============================================================================================*/

/** Why a run stopped. An interrupt is the normal end of a draft run — it is waiting for a person,
 *  not finished — which is a distinction the console has to render differently. */
export type StreamEndReason = 'interrupt' | 'parked' | 'completed' | 'halted';

export type StreamEvent =
  /** Steps that had already happened when we attached. Delivered together, because that is what
   *  joining a stream in progress actually looks like. */
  | { type: 'history'; steps: RunStep[] }
  | { type: 'step'; step: RunStep }
  | { type: 'end'; reason: StreamEndReason };

export type StreamHandle = {
  /** Idempotent. Safe to call from an effect cleanup, and safe to call twice. */
  stop: () => void;
};

/**
 * Emit a run's steps over time.
 *
 * WHY `playback_ms` AND NOT `latency_ms`. Every step carries both. `latency_ms` is the honest
 * number — a drafting call really does take about twenty seconds — and is rendered as metadata.
 * `playback_ms` is how long the console waits before showing the next step. A run played at its
 * true four-minute duration is unwatchable; a uniform 300ms tick is precisely the "faked
 * streaming" the brief rejects. Two numbers, and the README states the ratio rather than leaving a
 * reviewer to work out that the timings are invented.
 *
 * WHY A SELF-RESCHEDULING TIMEOUT AND A `cancelled` FLAG. React 19's StrictMode mounts every
 * component, unmounts it and mounts it again in development, on purpose, to expose effects that
 * leak. A naive `setInterval` started in an effect would survive the first unmount and run
 * alongside the second — the console would emit every step twice and look broken in development
 * only. `stop()` clears the pending timer and sets a flag, because a callback can already be in
 * flight when cleanup runs.
 */
export function streamRun(
  runId: RunId,
  fromSeq: number,
  onEvent: (event: StreamEvent) => void,
): StreamHandle {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };

  const steps = world.runSteps
    .filter((s) => s.run_id === runId)
    .sort((a, b) => a.seq - b.seq);

  const history = steps.filter((s) => s.seq <= fromSeq);
  const pending = steps.filter((s) => s.seq > fromSeq);

  // The initial delay stands in for opening the connection. Without it the history would appear
  // synchronously on first paint, which is the one moment a loading state has to be real.
  timer = setTimeout(() => {
    if (cancelled) return;
    onEvent({ type: 'history', steps: history });
    emitNext(0);
  }, LATENCY_MS.trace);

  function emitNext(index: number) {
    if (cancelled) return;

    if (index >= pending.length) {
      const last = steps.at(-1);
      const reason: StreamEndReason =
        last?.type === 'interrupt'
          ? 'interrupt'
          : last?.outcome === 'error'
            ? 'parked'
            : 'completed';
      onEvent({ type: 'end', reason });
      return;
    }

    const step = pending[index];
    timer = setTimeout(() => {
      if (cancelled) return;
      onEvent({ type: 'step', step });
      emitNext(index + 1);
    }, step.playback_ms);
  }

  return { stop };
}
