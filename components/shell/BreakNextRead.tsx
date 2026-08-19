'use client';

/**
 * ◆ DEMO AFFORDANCE — no production counterpart, and it says so on itself.
 *
 * D-020 ships a panel that lets the reviewer break the system on purpose, on the argument that the
 * brief grades failure handling first and a paragraph about a recovery path is not first-class. The
 * rebuild dropped it: `setFailure`/`isFailureActive` exist in `agentClient.ts` and, until this file,
 * were referenced by exactly one component — v1's `FailureDrawer`, reachable only from `/v1/console`.
 *
 * So the rebuilt interface had six screens with error states that **nobody could reach**. They
 * compiled, they were typed, and no reviewer could have seen one. That is the same class of defect
 * as a metric nothing renders or a type nothing constructs, and it is the reason this audit needed a
 * control rather than only a read-through.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE SWITCH, NOT v1'S FIVE, AND THE REASON IS NOT BREVITY
 *
 * v1's drawer carries four run-variant switches (`tool_failure`, `poisoned_source`, `hostile_reply`,
 * `auth_revoked`) plus this one. Those four choose which pre-written run `runNow()` plays — and the
 * rebuild never calls `runNow`, because its console is organised around the Wednesday batch rather
 * than around starting a run. Porting them would ship four controls that arm a switch nothing reads:
 * worse than absent, because they would look like they worked.
 *
 * Whether the rebuild should regain a run-starting control is a real design question about the batch
 * console and it is Nabihah's, not something to settle inside a state audit. Recorded rather than
 * quietly decided. `next_read_fails` is the one switch that needs no run at all — it breaks the
 * transport, which is what every screen's error state is actually about.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY IT IS ONE-SHOT, WHICH IS THE HONEST BEHAVIOUR RATHER THAN A SHORTCUT
 *
 * `read()` spends the switch on the next call. So arming it and navigating shows the failure once,
 * and pressing "Try again" succeeds — which is exactly the shape of a transient fault and exactly
 * what `unavailable`'s copy promises ("usually transient"). A latch that failed every read until
 * switched off would demonstrate a different, permanent thing the taxonomy has no kind for.
 */

import { useEffect, useState } from 'react';
import { isFailureActive, setFailure, subscribeToFailures } from '@/lib/agentClient';

export function BreakNextRead() {
  /**
   * Read from the client on mount rather than defaulting to `false`.
   *
   * The switch is module state and survives navigation, so a component that assumed `false` would
   * show "off" while the client held one armed — and clicking it would then *disarm* what the
   * operator was trying to arm. That exact bug cost ten minutes in v1's drawer and is recorded on it;
   * this is the same lazy initialiser, written the right way round the first time.
   */
  const [armed, setArmed] = useState(() => isFailureActive('next_read_fails'));

  /**
   * AND THE OTHER HALF OF THE SAME BUG, WHICH I SHIPPED BEFORE CATCHING IT IN THE BROWSER.
   *
   * v1's fix covers arming and disarming by click. It does not cover the switch spending *itself* —
   * `read()` deletes `next_read_fails` when it fires, so after one failure the client is disarmed
   * and a control holding only local state still reads "Armed — next read fails". Observed exactly
   * that: armed the switch, navigated to Results, got the error state, and the button was still
   * claiming to be armed while the client had already cleared it.
   *
   * Subscribing makes this a view of the client rather than a copy of it, which is the property the
   * lazy initialiser above was reaching for and only half achieved.
   */
  useEffect(() => subscribeToFailures(() => setArmed(isFailureActive('next_read_fails'))), []);

  function toggle() {
    setFailure('next_read_fails', !armed);
  }

  return (
    <div className="demo-box">
      <p className="demo-label">Demo control</p>
      <button
        type="button"
        className={`demo-btn${armed ? ' demo-armed' : ''}`}
        aria-pressed={armed}
        onClick={toggle}
      >
        {armed ? 'Armed — next read fails' : 'Break the next read'}
      </button>
      <p className="demo-hint">
        {armed
          ? 'Open any screen to see its error state. It clears itself after one failure.'
          : 'Not a product feature — it makes the recovery paths testable.'}
      </p>
    </div>
  );
}
