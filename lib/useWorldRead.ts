'use client';

/**
 * SUBSCRIBE TO THE WORLD, AND LOAD ONCE ON MOUNT.
 *
 * Every screen ran this same seven-line effect, and the duplication was not the problem — 28 lines
 * across five files is nothing. The problem was that the *reasoning* for its exact shape lived in
 * one copy, on the console, and the other four carried the trickiest effect in the app with no
 * explanation. In a codebase whose whole claim is that every line can be defended, four of five
 * copies could not be.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY IT IS SHAPED LIKE THIS
 *
 * Subscribe first, then let the subscription drive the initial load too. `subscribeToWorld` fires
 * on every write, so this effect only ever registers a listener and asks an external system for a
 * first value — it never calls `setState` itself. That is the shape ESLint's
 * `react-hooks/set-state-in-effect` is asking for, and it is the honest description of what these
 * screens are: a view onto a world that changes underneath them.
 *
 * The `setTimeout(…, 0)` rather than calling `load()` directly is what keeps that true. A direct
 * call runs during the effect body, which cascades a second render before the first has committed;
 * deferring it by a tick means one render per load instead of two.
 *
 * ---------------------------------------------------------------------------------------------
 * DELIBERATELY NOT A DATA HOOK
 *
 * This owns no state and returns nothing. A `useResource<T>` that also held loading and error state
 * and handed back a tuple would be the obvious next step and would be wrong here: the five screens
 * genuinely differ in what they hold — one draft plus its rules plus settings, a week, a world plus
 * descriptors plus a budget posture — and in how they branch on `not_found`. Flattening that into
 * one generic would cost more than the 28 lines it saves and would need explaining. This is not an
 * abstraction, it is a named effect.
 */

import { useEffect } from 'react';
import { subscribeToWorld } from '@/lib/agentClient';

export function useWorldRead(load: () => Promise<void>): void {
  useEffect(() => {
    const unsubscribe = subscribeToWorld(() => void load());
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [load]);
}
