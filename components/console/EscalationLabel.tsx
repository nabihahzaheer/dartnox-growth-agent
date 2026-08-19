'use client';

/**
 * WAS THIS ESCALATION WARRANTED? — one click, and a metric moves.
 *
 * `GuardrailEvent.was_unnecessary` is tri-state on purpose: `null` means nobody has judged it yet,
 * and `lib/metrics.ts` counts only the labelled ones, so unlabelled escalations do not silently
 * count as correct and inflate the figure. The cost of that honesty is that the metric needs a human
 * to feed it, and the rebuild shipped no way to do so — seven of ten escalations unlabelled, the
 * Results tile frozen at 66.7% over three, and no control anywhere in the interface.
 *
 * Two buttons rather than one checkbox, because "warranted" and "unnecessary" are both real answers
 * and neither is the default. A single "mark unnecessary" toggle would make the absence of a click
 * mean "fine", which is exactly the reading the tri-state exists to prevent.
 */

import { useState } from 'react';
import type { GuardrailEvent } from '@/lib/types';

export function EscalationLabel({
  event,
  onLabel,
}: {
  event: GuardrailEvent;
  onLabel: (unnecessary: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function click(unnecessary: boolean) {
    setBusy(true);
    try {
      await onLabel(unnecessary);
    } finally {
      setBusy(false);
    }
  }

  const labelled = event.was_unnecessary !== null;

  return (
    <div className="esc">
      <div className="esc-body">
        <p className="esc-head">
          Escalated to {event.escalation_tier === 'stakeholder' ? 'the client owner' : 'an operator'}
          {event.escalation_trigger && (
            <span className="esc-trigger"> · {event.escalation_trigger.replace(/_/g, ' ')}</span>
          )}
        </p>
        <p className="esc-detail">{event.detail}</p>
      </div>

      {labelled ? (
        <span className={`pill ${event.was_unnecessary ? 'pill-attend' : 'pill-go'}`}>
          {event.was_unnecessary ? 'marked unnecessary' : 'marked warranted'}
        </span>
      ) : (
        <span className="esc-act">
          <span className="t-meta">Was this warranted?</span>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void click(false)}>
            Yes
          </button>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void click(true)}>
            No
          </button>
        </span>
      )}
    </div>
  );
}
