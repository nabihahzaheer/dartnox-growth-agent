'use client';

/**
 * THE BUDGET GATE, WHEN IT HAS SOMETHING TO SAY.
 *
 * The board draws an admission gate between the job queue and the orchestrator with a deliberately
 * asymmetric branch: at the alert threshold the operator is told and nothing stops, and at the cap
 * new planning and drafting wait while already-approved posts still publish and reply monitoring
 * keeps running. Every part of that was modelled — `BudgetState`, `ParkReason.budget_admission_stop`,
 * two tunable thresholds — and the interface rendered one number with no threshold behaviour
 * attached, on two screens, in monospace. `spend $121.59 / 400` is a fact nobody can act on.
 *
 * ---------------------------------------------------------------------------------------------
 * `under` RENDERS NOTHING, AND THAT IS THE POINT
 *
 * `lib/budget.ts` says it in its own type comment: a console carrying a permanent budget strip has
 * spent its most valuable pixels on a number that is fine 99% of the time. So this returns null at
 * `under` and the console header shows no budget at all in the ordinary case — which is a real
 * subtraction from that screen, made on purpose.
 *
 * The figure does not disappear from the product. Results keeps it permanently, because a dashboard
 * is exactly where a fine-but-real number belongs, and Settings shows it against the cap control
 * that governs it. The console is the one surface where budget is either urgent or absent.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE SENTENCE HERE IS NOT COMPOSED FROM A VALUE, AND IT IS THE ONLY ONE
 *
 * Every number below comes off the posture: the percentage, both thresholds, the cap, the spend.
 * The exception is the sentence naming what the stop actually does — planning and drafting pause,
 * approved posts still publish, reply checks keep running. That is a statement about the
 * architecture's behaviour, not about any record's value.
 *
 * The compose-from-values rule exists so a sentence cannot silently disagree with the data it
 * describes (see `Verdict`'s docblock and the argmin it was written for). This sentence has no data
 * to disagree with. The alternative — a `BudgetSettings.stop_behaviour` string in the fixtures —
 * would be a fixture field invented to hold one line of UI copy, which is worse: it would look like
 * data while being prose, and nothing would check it either way.
 */

import type { BudgetPosture } from '@/lib/budget';

const money = (n: number) => `$${n.toFixed(2)}`;

export function BudgetNotice({ budget }: { budget: BudgetPosture }) {
  if (budget.state === 'under') return null;

  const stopped = budget.state === 'stopped';

  return (
    <div className={`gate-band ${stopped ? 'gate-stop' : 'gate-pending'}`}>
      <span className={`gate-ic${stopped ? ' gate-ic-stop' : ''}`} aria-hidden>
        {stopped ? '✕' : '!'}
      </span>
      <p>
        {stopped ? (
          <>
            <b>Monthly cap reached</b> — {money(budget.spent)} of {money(budget.cap)}. New planning
            and drafting are paused. Approved posts still publish and reply checks keep running.
          </>
        ) : (
          <>
            <b>Spending is at {Math.round(budget.pct)}% of the {money(budget.cap)} cap.</b> Nothing
            has stopped. New planning and drafting pause at {budget.stop_pct}%.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * The always-on version, for the two screens that carry the figure whether or not it is urgent.
 *
 * Separate from the banner rather than a mode of it: this is a stat, and the banner is an
 * interruption. Collapsing them into one component with an `always` flag would mean one set of
 * markup trying to be both, which is how a stat ends up shouting.
 *
 * `state` was previously printed raw — the Results footer read `· under`, an enum rendered at an
 * operator. Same defect the approvals queue's `PARK_LABEL` map exists to prevent, and fixed the
 * same way.
 */
const STATE_LABEL: Record<BudgetPosture['state'], string> = {
  under: 'under cap',
  alert: 'alert',
  stopped: 'stopped',
};

const STATE_PILL: Record<BudgetPosture['state'], string> = {
  under: 'pill-go',
  alert: 'pill-attend',
  stopped: 'pill-stop',
};

export function BudgetLine({ budget }: { budget: BudgetPosture }) {
  return (
    <div className="bud-line">
      {/* NO PILL WHILE THE SPEND IS FINE. A green "under cap" chip beside a bar that is 30% full
          is the bar's own information said twice, and it put a coloured badge on the one state
          nobody needs telling about. The pill returns at `alert` and `stopped`, where it is the
          only thing on the line saying the gate has changed what the agent may do. */}
      {budget.state !== 'under' && (
        <span className={`pill ${STATE_PILL[budget.state]}`}>{STATE_LABEL[budget.state]}</span>
      )}
      <span className="bud-figs">
        <b>{money(budget.spent)}</b> of {money(budget.cap)} this period
      </span>
      <span className="bud-track" aria-hidden>
        {/* Clamped at 100% width — spend can exceed the cap, and a bar overflowing its own track
            would render as a layout fault rather than as the overrun it is. The figures beside it
            still say the true number. */}
        <i
          className={budget.state === 'under' ? undefined : 'bud-over'}
          style={{ width: `${Math.min(100, budget.pct)}%` }}
        />
      </span>
      <span className="bud-pct mono">{Math.round(budget.pct)}%</span>
    </div>
  );
}
