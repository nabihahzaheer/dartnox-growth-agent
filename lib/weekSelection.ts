/**
 * WHICH WEEK IS BEING LOOKED AT — shared, because two components render it and neither contains
 * the other.
 *
 * THE BUG THIS EXISTS TO FIX. The rail carries a week stepper and is present on all five screens.
 * The queue's week view carries a second one. Both held their own `useState`, so stepping either
 * left the two disagreeing: a rail reading "This week" beside a grid reading "Next week", on the
 * same screen, describing the same system. Two controls for one fact is worse than either control
 * alone, because the operator now has to work out which one the screen believes.
 *
 * WHY NOT THE OBVIOUS FIXES.
 *
 *   A store library — D-022 and D-038 already rejected Zustand, and one shared integer is not the
 *   argument that reopens it.
 *   React Context — needs a provider, and the provider would have to live in `app/layout.tsx`,
 *   which is a server component. Making the shell a client component to hold one number moves every
 *   screen off the server for no other reason.
 *   Lifting the state — there is no common ancestor below the layout. That is the whole problem.
 *   A query parameter — `useSearchParams` opts a route out of static prerender, and the console is
 *   the highest-graded screen in the project.
 *
 * WHAT THIS IS. The store contract `useSyncExternalStore` was designed for: subscribe, snapshot,
 * and a setter. React ships it; this file is the fifteen lines it needs. No dependency, no
 * provider, no route change.
 *
 * IT DELIBERATELY HOLDS NO WORLD DATA. The selected week is view state — which page of the
 * calendar is open. The week itself still comes from `agentClient.getWeek(index)` like every other
 * read, so this cannot become a second, privileged copy of the world that drifts from the first.
 */

import { initialWeekIndex } from './agentClient.ts';

/**
 * Resolved once at module load rather than per subscriber, so two components mounting in the same
 * frame cannot start on different weeks — which is the bug in miniature.
 */
let selected = initialWeekIndex();

const listeners = new Set<() => void>();

export function subscribeToWeek(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Must return a stable value for an unchanged store — `useSyncExternalStore` compares snapshots by
 * identity and re-renders forever on a fresh object. A number is stable by construction, which is
 * the other reason the selection is stored as an index rather than as a resolved `Week`.
 */
export function getSelectedWeek(): number {
  return selected;
}

export function setSelectedWeek(next: number): void {
  if (next === selected) return;
  selected = next;
  for (const listener of listeners) listener();
}

/** The server renders no client state, and the value is the same constant there anyway. Supplied
 *  explicitly because `useSyncExternalStore` throws during hydration without it. */
export const getServerWeek = getSelectedWeek;
