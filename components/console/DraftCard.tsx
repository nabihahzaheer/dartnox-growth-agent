'use client';

/**
 * ONE DRAFT, WAITING ON A PERSON.
 *
 * The post is the largest thing on the card and sits above every control, which is the whole
 * correction this rebuild exists to make: v1's approval gate asked for a decision with the text
 * nowhere on screen.
 *
 * The controls are rendered from `gate.options` rather than chosen here. A blocked draft's gate
 * omits `approve`, so this component does not decide which button to disable — it renders what the
 * gate offers. Two screens cannot then disagree about a rule the architecture states once, and
 * `scripts/check.mts` asserts the gate rather than trusting a component to remember.
 *
 * `secondsOpen` starts when the card mounts. That figure feeds the "decided under 15 seconds"
 * alarm, which is the signal that review has stopped being real — so it has to measure how long the
 * post was actually in front of someone, not how long the request took.
 */

import { useState } from 'react';
import Link from 'next/link';
import type { BatchChild } from '@/lib/agentClient';
import type { GuardrailRule, RejectionReasonEntry, RunStep } from '@/lib/types';
import { ChannelMark } from '@/components/ChannelMark';
import { DecisionBar } from './DecisionBar';
import { StepTimeline, runDurationSeconds } from './StepTimeline';
import { Verdict } from './Verdict';

function formatSpan(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function DraftCard({
  child,
  steps,
  rules,
  threshold,
  reasons,
  onDecided,
}: {
  child: BatchChild;
  steps: RunStep[];
  rules: GuardrailRule[];
  threshold: number;
  reasons: RejectionReasonEntry[];
  onDecided: () => void;
}) {
  const [showTrace, setShowTrace] = useState(false);

  const draft = child.draft;
  if (!draft) return null;

  const version = draft.versions.find((v) => v.id === draft.current_version_id);
  const blocked = draft.state === 'blocked_guardrail';
  const offers = child.gate?.options ?? [];

    return (
    <article className={`card${blocked ? ' card-stop' : ''}`}>
      <header className="card-head">
        <ChannelMark channel={draft.channel} withLabel />
        <span aria-hidden>·</span>
        <span>{child.slot?.angle ?? 'Untitled slot'}</span>
        <span className="card-state">
          {blocked ? (
            <span className="pill pill-stop">blocked</span>
          ) : draft.composite_score < threshold ? (
            <span className="pill pill-attend">flagged</span>
          ) : (
            <span className="pill pill-go">ready</span>
          )}
        </span>
      </header>

      <div className="card-body">
        {/* Read from the version. This was hardcoded to "Agent draft", which is true only while
            every waiting draft is single-version and agent-authored — it becomes a false statement
            the moment a human-edited version is awaiting approval, which `approve_with_edits`
            produces. The detail page already branched on authorship. */}
        <p className="prov">
          <i aria-hidden />
          {version?.author === 'human'
            ? 'Edited by you · not yet approved'
            : 'Agent draft'}
        </p>
        <p className="post">{version?.text}</p>
        <Verdict draft={draft} events={child.events} rules={rules} threshold={threshold} />
      </div>

    
      {version && (
        <DecisionBar
          draft={draft}
          version={version}
          options={offers}
          reasons={reasons}
          onDecided={onDecided}
        />
      )}

      <div className="step-foldrow">
        {/**
         * THE LINDY FOLD.
         *
         * While a run is live, its steps appear one at a time in the console's "Still drafting"
         * region — nothing folds there, because there is nothing finished yet to summarise. Once a
         * run has reached a person, showing the same step-by-step list by default would put the
         * process ahead of the thing it produced. This is the fold: a single line stating what
         * happened and how long it took, computed rather than written, that opens back into the full
         * `StepTimeline` on click. The order stays post-first either way — this sits below the
         * verdict, not above the draft, because "post first" is the correction the whole rebuild is
         * for and a folded step count does not earn front billing over it.
         */}
        <button
          type="button"
          className="step-fold"
          onClick={() => setShowTrace((v) => !v)}
          aria-expanded={showTrace}
        >
          <span className="step-fold-tick" aria-hidden>
            ✓
          </span>
          <span>
            {steps.length} steps · done in {formatSpan(runDurationSeconds(steps))}
          </span>
          <span className={`trace-car${showTrace ? ' is-open' : ''}`} aria-hidden>
            ▶
          </span>
        </button>
        <Link href={`/approvals/${draft.id}`} className="trace-link">
          Open in full →
        </Link>
      </div>

      {showTrace && (
        <div className="card-trace">
          <StepTimeline steps={steps} events={child.events} rules={rules} />
        </div>
      )}
    </article>
  );
}
