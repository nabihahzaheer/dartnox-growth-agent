/**
 * BUDGET — the admission gate, as a value the interface can render.
 *
 * WHY THIS EXISTS.
 *
 * The board draws a **budget gate** between the job queue and the orchestrator, and gives it a
 * branch with a deliberately asymmetric consequence: when a client's monthly cap is reached, new
 * drafting and planning wait and the owner is notified, **already-approved posts still publish**,
 * and **reply monitoring keeps running**. That asymmetry is one of the architecture's better
 * arguments — it says the system degrades by stopping the expensive optional work rather than by
 * going dark on content already out in the world.
 *
 * The prototype modelled every part of it and surfaced none. `budget_admission_stop` is a valid
 * `ParkReason` with nowhere to appear, `BudgetSettings` carries a cap and two thresholds, and the
 * word "budget" reached the screen twice: as a caption on one metric tile, and in a Settings line
 * saying budget is "modelled and not shown here."
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE CAP IS AN OPERATOR CONTROL RATHER THAN A BANNER
 *
 * Spend against the fixtures is $121.25 of a $400 cap — 30%. A banner reporting that is a number
 * nobody acts on, and no fixture edit can make the cap-reached branch reachable without either
 * inventing a month of spend or adding a demo switch that fakes it.
 *
 * So the cap moves instead of the spend. `budget.cap` already carries a `field_meta` descriptor
 * with `effect_timing: 'immediate'` and a declared range of 50–2000, and it was simply never
 * rendered. Dragging it below current spend puts the system into its own stop state, in front of
 * the reviewer, driven by their action — the same mechanism the banned-phrase sweep uses to
 * demonstrate the L4 re-check. The alternative, a fifth failure switch, would demonstrate that the
 * prototype can pretend; this demonstrates that the gate is wired to the number it gates on.
 *
 * R1: nothing here is stored. Spend is summed from `RunStep` costs on every read, because the run
 * steps are the only surviving source — §3.10 deleted `Run.cost_total` as an R1 violation.
 */

import type { FixtureSet, MinutesFromAnchor } from './types.ts';

/**
 * `under` is the quiet case and renders nothing anywhere. A console that carries a permanent
 * budget strip has spent its most valuable pixels on a number that is fine 99% of the time.
 */
export type BudgetState = 'under' | 'alert' | 'stopped';

export type BudgetPosture = {
  state: BudgetState;
  cap: number;
  spent: number;
  /** Of the cap. Can exceed 100 — the gate stops new work, it does not refund what already ran. */
  pct: number;
  period_start: MinutesFromAnchor;
  /** How many steps the sum is over, so the figure is auditable rather than asserted. */
  sample_n: number;
  /**
   * The two thresholds this posture was judged against, carried rather than left in Settings for
   * a renderer to fetch separately.
   *
   * Same reasoning as `DraftDetail.threshold`, which carries the score bar so the detail view can
   * say "below the 0.85 bar" instead of printing a bare number: a banner saying "new work pauses
   * at 100%" is composing a sentence from a value, and the value has to travel with the posture or
   * the sentence is a literal typed next to a number it does not come from.
   */
  alert_pct: number;
  stop_pct: number;
};

/**
 * The gate rule itself, extracted so it has exactly one home.
 *
 * The Settings cap slider has to answer "what would this cap do" *before* the write lands, which
 * means the preview and the committed posture are two calls that must never disagree. Re-deriving
 * `pct >= stop ? … : pct >= alert ? …` inside the settings screen is the version of that which is
 * correct on the day it is written and silently wrong the first time a threshold moves.
 *
 * Ordered stop-first: at a cap below spend both comparisons are true, and `stopped` is the
 * answer — a system that has blown its cap is not merely alerting.
 */
export function budgetStateAt(
  spent: number,
  cap: number,
  alertPct: number,
  stopPct: number,
): BudgetState {
  const pct = cap === 0 ? 0 : (spent / cap) * 100;
  return pct >= stopPct ? 'stopped' : pct >= alertPct ? 'alert' : 'under';
}

/**
 * Live spend = the carried-forward opening balance + every step cost since the period began.
 *
 * The opening balance is one of the four deliberate R1 exceptions: the dataset spans six weeks and
 * the budget period is monthly, so it crosses a period boundary. Without it the alert band would be
 * reachable only by burning 80% of a month inside the fixture.
 *
 * Both cost fields are summed. A publish step incurs model *and* platform cost — X is pay-per-use —
 * and dropping the platform addend would understate exactly the runs the cap exists to govern.
 */
export function budgetPosture(world: FixtureSet): BudgetPosture {
  const { cap, alert_pct, stop_pct } = world.settings.budget;
  const since = world.client.budget_period_start;

  const steps = world.runSteps.filter((s) => s.started_at >= since);
  const spent =
    world.client.opening_spend_usd +
    steps.reduce((total, s) => total + s.cost_model_usd + s.cost_platform_usd, 0);

  const pct = cap === 0 ? 0 : (spent / cap) * 100;

  return {
    state: budgetStateAt(spent, cap, alert_pct, stop_pct),
    cap,
    spent,
    pct,
    period_start: since,
    sample_n: steps.length,
    alert_pct,
    stop_pct,
  };
}
