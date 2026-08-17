'use client';

/**
 * STEP ROW — one line of the agent's trace.
 *
 * The brief requires the stream to show `thinking → tool call → tool result → action`, and
 * requires tool calls and results to expand to what they were called with and what came back. That
 * expansion is what those two step types *mean*; a row that only says "fetch_source" is a label,
 * not a trace.
 *
 * Every row is collapsed by default and opens on click. A console that expands everything is
 * unreadable at forty steps, and the operator's normal mode is scanning for the one step that
 * explains why an item is in front of them.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THE COLLAPSED ROW KEEPS, AND WHY THE REST MOVED
 *
 * It used to carry `09:56  claude-opus-5  2.9s  2,010 in / 140 out  $0.0348` on every row, always.
 * The person operating this console is a marketing lead at a 34-person contractor. Model
 * snapshots, token splits and four-decimal dollar figures are not their instrument panel, and
 * repeating them forty times is the single biggest reason the screen read as a debugger.
 *
 * Collapsed keeps only what carries a decision: the label, the step type, the time, a guardrail's
 * pass/warn/fail, an error, and a retry's attempt count. Latency stays, because "17.0s" answers
 * *how long did this take* — the one number a person watching an agent work actually asks — and it
 * is now the only figure on the line, so it reads as duration rather than as instrumentation.
 * Backoff went with the telemetry: "attempt 2 of 3" is the fact, "backoff 2400ms" is the mechanism.
 *
 * Nothing was deleted. Cost and token controls are an architecture requirement, so model,
 * snapshot, tokens, both cost addends, hashes and `output_ref` all render one click away — and
 * `cost_platform_usd` is rendered here for the first time, having previously had no surface at all.
 *
 * ---------------------------------------------------------------------------------------------
 * A STEP IN FLIGHT SHOWS NOTHING IT DOES NOT YET KNOW
 *
 * Steps now arrive when they *start*. Duration, tokens, cost, a guardrail result and an error are
 * all facts that do not exist until the step is over, and rendering them early was the lie that
 * made the feed read as a list being populated rather than as an agent working. In flight the row
 * shows a running mark, its label and its type; everything else waits for `settled`. The
 * disclosure is disabled for the same reason — a tool result cannot show what it returned before
 * it has returned.
 */

import { useState } from 'react';
import type { GuardrailEvent, RunStep, ToolName } from '@/lib/types';
import { formatDateTime, formatTime } from '@/lib/time';
import { Badge, guardrailTone } from '@/components/Badge';
import { Countdown } from '@/components/Countdown';

/**
 * Short typographic markers rather than icons: readable at a glance without a legend, and no
 * assets to load.
 *
 * Restricted to characters that are actually in the bundled font. The first version used ⛉ for a
 * guardrail and ⏸ for an interrupt, and both rendered as the missing-glyph box — caught by looking
 * at the running page, which is not something a typecheck or a lint rule could have told me.
 */
const TYPE_MARK: Record<RunStep['type'], string> = {
  thinking: '···',
  tool_call: '→',
  tool_result: '←',
  action: '◆',
  guardrail: '◇',
  interrupt: '‖',
  rewrite: '↻',
};

const TYPE_LABEL: Record<RunStep['type'], string> = {
  thinking: 'thinking',
  tool_call: 'tool call',
  tool_result: 'tool result',
  action: 'action',
  guardrail: 'guardrail',
  interrupt: 'interrupt',
  rewrite: 'rewrite',
};

/**
 * TOOL NAMES, IN ENGLISH.
 *
 * `retrieve_examples` is a function signature. It appeared on the console because the fixture's
 * step label is the tool name, and a marketing lead reading "retrieve_examples → 2 posts" is being
 * shown the inside of the program rather than what it did.
 *
 * ONE MAP, KEYED ON THE `ToolName` UNION, so adding an effector without labelling it is a compile
 * error rather than a raw identifier leaking onto the screen. It lives here because this is the
 * only component in the app that renders a step — the console and the draft detail view both go
 * through it — and exporting it from a fourth file would invite the second copy it exists to
 * prevent.
 *
 * The raw name is not lost: it renders as `tool` in the expanded detail, next to the payload it
 * was called with. That is where a name you would grep for belongs.
 */
const TOOL_LABEL: Record<ToolName, string> = {
  search_sources: 'Look for sources',
  fetch_source: 'Read a source',
  get_performance: 'Check how posts did',
  retrieve_examples: 'Find posts that worked',
  get_engagement: 'Check replies',
  reconcile_published: 'Check what actually posted',
  schedule_post: 'Schedule the post',
  notify_operator: 'Notify you',
  notify_stakeholder: 'Notify the owner',
  publish_post: 'Publish the post',
  delete_post: 'Delete the post',
};

/**
 * The fixture writes a tool step's label as the bare tool name, or as the tool name plus what came
 * back — `retrieve_examples`, `retrieve_examples → 2 posts`, `fetch_source · attempt 1 of 3`.
 *
 * So the prefix is swapped and the suffix kept, rather than the label being replaced outright: the
 * suffix is the *result*, which is the most useful thing on the row and belongs to the fixture.
 * Replacing the whole label would have thrown "→ 2 posts" away; rewriting eighty fixture labels
 * would have put the human wording in a file the compiler cannot check against `ToolName`.
 */
function humanLabel(step: RunStep): string {
  const tool = step.tool_name;
  if (!tool || !step.label.startsWith(tool)) return step.label;
  return TOOL_LABEL[tool] + step.label.slice(tool.length);
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="t-label overflow-x-auto rounded bg-[var(--surface-sunk)] p-2 font-mono">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      {/* `.t-field` — Courier caps in grey with no square. The PDF distinguishes a section eyebrow
          (blue, squared) from a table header (grey, bare) exactly this way, and collapsing the two
          would flatten the hierarchy. This is the role's only home: labels inside an expanded step.
          It was 10px inline here, which is under the scale's floor. */}
      <div className="t-field">{label}</div>
      {children}
    </div>
  );
}

export function StepRow({
  step,
  event,
  isNew,
  inFlight = false,
  onDecide,
  decision,
}: {
  step: RunStep;
  /** The guardrail event this step produced, if it is a guardrail step. Paired by id rather than
   *  looked up by run, because a run's L4 events belong to the *publish* run and would not join. */
  event?: GuardrailEvent;
  /** Only steps that arrived live animate in. Replayed history appearing with a stagger would be
   *  theatre — it already happened. */
  isNew: boolean;
  /** The step has started and has not finished. Defaults false, which is what history and a
   *  replayed run are: every step in them is already over. */
  inFlight?: boolean;
  /** Route to the queue. Absent on the draft detail screen, which is already showing the item the
   *  decision would be about. */
  onDecide?: () => void;
  /**
   * The decision surface, when this screen can take the decision here.
   *
   * A slot rather than the four callbacks it would otherwise take: the console builds one
   * `DecisionControls` and this component only decides *where* it goes — under the interrupt the
   * operator is waiting at. The draft detail view passes nothing and is unaffected.
   */
  decision?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  /** Model, tokens, cost, hashes: demoted from the collapsed row, so their presence has to keep
   *  the row expandable or the demotion would be a deletion. */
  const hasTelemetry =
    step.model !== null ||
    step.tokens_in > 0 ||
    step.cost_model_usd > 0 ||
    step.cost_platform_usd > 0 ||
    step.backoff_ms !== null ||
    step.tool_name !== null ||
    step.input_hash !== null ||
    step.output_ref !== null;

  const hasDetail =
    !inFlight &&
    (step.thinking_text !== null ||
      step.tool_input !== null ||
      step.tool_output !== null ||
      step.sources.length > 0 ||
      step.applied_inputs.length > 0 ||
      step.brief_ref !== null ||
      step.error !== null ||
      step.interrupt !== null ||
      /** Without this the planning run's "Propose next week" step carries eight slots and refuses
       *  to open, because it has no thinking text or tool payload of its own. */
      (step.proposed_calendar?.length ?? 0) > 0 ||
      hasTelemetry ||
      event !== undefined);

  return (
    <li className={isNew ? 'step-enter' : undefined} aria-busy={inFlight || undefined}>
      <div
        className="rounded border"
        style={{
          /** The running token on the frame, not just on the mark. At a glance down a
           *  forty-step column the border is what tells you where the agent currently is. */
          borderColor: inFlight ? 'var(--state-running)' : 'var(--border)',
          background: 'var(--surface)',
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={!hasDetail}
          aria-expanded={hasDetail ? open : undefined}
          className="flex w-full items-start gap-3 px-3 py-2 text-left disabled:cursor-default"
        >
          <span
            aria-hidden
            className="t-body mt-0.5 flex w-5 shrink-0 justify-center font-mono"
            style={{ color: 'var(--text-faint)' }}
          >
            {inFlight ? (
              /**
               * One element, in the gutter the type mark already occupies, so nothing moves when
               * the step settles.
               *
               * `motion-safe:` rather than a second `prefers-reduced-motion` block: the global one
               * strips transitions and the `.step-enter` animation, and adding another exception in
               * `app/globals.css` would put the same policy in two places. Tailwind's own variant
               * is the media query, applied at the one element that needs it.
               */
              <span
                className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full motion-safe:animate-pulse"
                style={{ background: 'var(--state-running)' }}
              />
            ) : (
              TYPE_MARK[step.type]
            )}
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="t-body font-medium">{humanLabel(step)}</span>
              <span className="t-meta font-mono">{TYPE_LABEL[step.type]}</span>
              {/* Outcomes, withheld until there is one. A `pass` badge on a check that has not run
                  yet is the console asserting a result it does not have. */}
              {!inFlight && event && <Badge tone={guardrailTone(event.result)}>{event.result}</Badge>}
              {!inFlight && step.outcome === 'error' && <Badge tone="blocked">error</Badge>}
              {/* Not an outcome: which attempt this is, is known the moment it starts. */}
              {step.attempt > 1 && (
                <span className="t-meta tabular font-mono">
                  attempt {step.attempt} of {step.max_attempts}
                </span>
              )}
            </span>

            {/* When it happened, and how long it took. The model snapshot, the token split and the
                cost used to sit on this line and now open with the row. */}
            <span className="t-meta tabular mt-0.5 flex flex-wrap items-center gap-x-3 font-mono">
              <span>{formatTime(step.started_at)}</span>
              {!inFlight && step.latency_ms > 0 && (
                <span>{(step.latency_ms / 1000).toFixed(1)}s</span>
              )}
            </span>
          </span>

          {hasDetail && (
            <span aria-hidden className="t-meta mt-0.5 shrink-0 font-mono">
              {open ? '−' : '+'}
            </span>
          )}
        </button>

        {open && hasDetail && (
          <div className="space-y-3 border-t px-3 py-3" style={{ borderColor: 'var(--border)' }}>
            {/* Reasoning is the record, not an annotation on it, so it is `.t-body` at muted
                contrast rather than `.t-label`. */}
            {step.thinking_text && (
              <p className="t-body text-[var(--text-muted)]">{step.thinking_text}</p>
            )}

            {step.brief_ref && (
              <Field label={`operator brief · ${step.brief_ref.author}`}>
                <p className="t-body rounded bg-[var(--surface-sunk)] p-2">{step.brief_ref.text}</p>
              </Field>
            )}

            {/* The field that closes the brief's two hardest loops. A rejection changing what the
                agent does next, and a setting visibly changing behaviour, are both demonstrated by
                the next run's drafting step listing what it consumed. */}
            {step.applied_inputs.length > 0 && (
              <Field label="inputs this step consumed">
                <ul className="space-y-1">
                  {step.applied_inputs.map((input) => (
                    <li key={`${input.kind}-${input.id}`} className="flex items-baseline gap-2">
                      <Badge mono>{input.kind.replace('_', ' ')}</Badge>
                      <span className="t-body">{input.label}</span>
                    </li>
                  ))}
                </ul>
              </Field>
            )}

            {step.tool_input && (
              <Field label={`called with · ${step.tool_name ?? ''}`}>
                <Json value={step.tool_input} />
              </Field>
            )}

            {step.tool_output && (
              <Field label="returned">
                <Json value={step.tool_output} />
              </Field>
            )}

            {step.error && (
              <Field label="error">
                <Json value={step.error} />
              </Field>
            )}

            {step.sources.length > 0 && (
              <Field label="sources">
                <ul className="space-y-2">
                  {step.sources.map((source) => (
                    <li
                      key={source.url}
                      className="rounded border p-2"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="t-body font-medium">{source.title}</span>
                        <span className="t-meta font-mono">{source.domain}</span>
                        <Badge tone={guardrailTone(source.guard_result)}>
                          {source.guard_result}
                        </Badge>
                      </div>
                      <p className="t-label mt-1">{source.summary}</p>
                      {/* What makes source choice legible rather than magical. */}
                      <p className="t-label mt-1 italic">Selected because: {source.why_selected}</p>
                    </li>
                  ))}
                </ul>
              </Field>
            )}

            {event && (
              <Field label="guardrail result">
                <p className="t-body">{event.detail}</p>
                {event.offending_span && (
                  <p className="t-body mt-1 rounded bg-[var(--state-awaiting-bg)] p-2">
                    <span className="t-field">flagged span · </span>
                    {event.offending_span.text}
                  </p>
                )}
                {/* Withheld by design, not missing. The operator may be the injection's target, so
                    an empty span with no explanation would read as a bug. */}
                {event.span_withheld && <p className="t-label mt-1">{event.withheld_reason}</p>}

                {/*
                  INBOUND REPLY TEXT, rendered here and nowhere else.

                  R8 gives it exactly one permitted home — the escalation record — because it is
                  untrusted text from strangers, and the moment it enters retrieval or a drafting
                  prompt it becomes an injection surface on the one path that reaches a published
                  account. The `get_engagement` step two rows up carries counts, sentiment labels
                  and reply *ids* only, deliberately.

                  It was fixtured and rendered nowhere, which made the hostile-reply narrative
                  arrive with its evidence missing: the operator is asked to decide whether to pull
                  a post without being shown what people actually said.
                */}
                {event.replies.length > 0 && (
                  <ul className="mt-1.5 space-y-1.5">
                    {event.replies.map((reply, i) => (
                      <li
                        key={`${reply.author_handle}-${i}`}
                        className="rounded border p-2"
                        style={{
                          borderColor:
                            reply.sentiment === 'severe'
                              ? 'var(--state-blocked)'
                              : 'var(--border)',
                        }}
                      >
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="t-meta font-mono">{reply.author_handle}</span>
                          <Badge tone={reply.sentiment === 'severe' ? 'blocked' : 'awaiting'}>
                            {reply.sentiment}
                          </Badge>
                          <span className="t-meta tabular font-mono">
                            {formatTime(reply.received_at)}
                          </span>
                        </div>
                        <p className="t-body mt-1">{reply.text}</p>
                      </li>
                    ))}
                    <li className="t-meta">Held here only. The agent has no reply tool.</li>
                  </ul>
                )}
              </Field>
            )}

            {/*
              THE WEEK THE AGENT PROPOSED.

              `proposed_calendar` is a `ProposedSlot[]` and not `CalendarSlot[]` because no slot
              record exists yet — the planning run proposes, and slots are created when the owner
              ratifies. The field existed from the start and nothing rendered it, which meant the
              product had no answer to "what is this agent going to do next week" — the first
              question anyone asks of a content agent.
            */}
            {step.proposed_calendar && step.proposed_calendar.length > 0 && (
              <Field label={`proposed week · ${step.proposed_calendar.length} slots`}>
                <ol className="space-y-1">
                  {step.proposed_calendar.map(({ slot }, i) => (
                    <li
                      key={`${slot.publish_at}-${i}`}
                      className="flex flex-wrap items-baseline gap-2 rounded px-2 py-1"
                      style={{ background: 'var(--surface-sunk)' }}
                    >
                      <span className="t-meta tabular w-28 shrink-0 font-mono">
                        {formatDateTime(slot.publish_at)}
                      </span>
                      <Badge tone="neutral">
                        {slot.channel === 'linkedin' ? 'LinkedIn' : 'X'}
                      </Badge>
                      <span className="t-body min-w-0 flex-1">{slot.angle}</span>
                      {slot.is_topical && (
                        <Badge tone="awaiting" mono>
                          topical
                        </Badge>
                      )}
                    </li>
                  ))}
                </ol>
                <p className="t-meta mt-1">Nothing drafts until the owner approves.</p>
              </Field>
            )}

            {/*
              THE INTERRUPT, AND THE DEAD END IT USED TO BE.

              This listed the gate's options as `<Badge>` pills — `approve`, `approve with edits`,
              `reject`, `escalate` — which look exactly like buttons and are `<span>`s. So the one
              place the product says "I need you" offered four things that appeared clickable and
              were not, and no route to anywhere that was.

              D-051 then made them a link to the queue, on the grounds that a second set of buttons
              here would mean two implementations of the highest-consequence write in the product.
              The objection was about duplication and it was right; the answer is `DecisionControls`,
              one component holding the only `submitReview` call site, rendered by both screens. The
              board puts human review inside the per-post run, and sending the operator to another
              screen to act on the run they are watching was the console announcing a problem and
              handing over a phone number.

              `decision` is absent on the draft detail view and on the calendar gate, and the row
              falls back to the route. See the console's `needsOperator`.
            */}
            {step.interrupt && (
              <Field label={`waiting on ${step.interrupt.awaiting}`}>
                {step.interrupt.awaiting === 'stakeholder' && (
                  <p className="t-label">Approved by the owner by email.</p>
                )}

                {step.interrupt.awaiting === 'operator' &&
                  (decision ?? (
                    <>
                      <p className="t-label">Approve, edit, reject or escalate from the queue.</p>
                      {onDecide && (
                        <button
                          type="button"
                          onClick={onDecide}
                          className="t-body mt-1.5 rounded px-2.5 py-1 font-medium"
                          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                        >
                          Decide on this →
                        </button>
                      )}
                    </>
                  ))}

                <p className="t-label mt-1.5">
                  {step.interrupt.gate === 'calendar_approval' ? 'Drafting starts in ' : 'Slot slips in '}
                  <Countdown
                    className="tabular"
                    deadline={step.interrupt.deadline}
                    expiredLabel={
                      step.interrupt.gate === 'calendar_approval' ? 'already started' : 'already slipped'
                    }
                  />
                </p>
              </Field>
            )}

            {/*
              THE ENGINEER'S NUMBERS. Moved here off the collapsed row, not removed — an
              architecture that requires cost and token controls cannot have them disappear, and
              this is the surface an incident review or a budget question opens.

              C1 · hashes stay as displayed provenance while payloads are inlined above. Production
              resolves the reference through the trace store; there is no backend here to resolve it
              against, and the README says so.
            */}
            {hasTelemetry && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {step.model && (
                  <Field label="model">
                    <p className="t-body font-mono">{step.model}</p>
                    {step.model_snapshot && (
                      <p className="t-meta font-mono">{step.model_snapshot}</p>
                    )}
                  </Field>
                )}
                {step.tokens_in > 0 && (
                  <Field label="tokens">
                    <p className="t-body tabular font-mono">
                      {step.tokens_in.toLocaleString()} in / {step.tokens_out.toLocaleString()} out
                    </p>
                  </Field>
                )}
                {(step.cost_model_usd > 0 || step.cost_platform_usd > 0) && (
                  <Field label="cost">
                    <p className="t-body tabular font-mono">
                      ${step.cost_model_usd.toFixed(4)} model
                      {step.cost_platform_usd > 0 &&
                        ` · $${step.cost_platform_usd.toFixed(4)} platform`}
                    </p>
                  </Field>
                )}
                {/* The raw effector name, kept where a name you would grep for belongs. */}
                {step.tool_name && (
                  <Field label="tool">
                    <p className="t-body font-mono">{step.tool_name}</p>
                  </Field>
                )}
                {step.backoff_ms !== null && (
                  <Field label="backoff">
                    <p className="t-body tabular font-mono">{step.backoff_ms}ms</p>
                  </Field>
                )}
                {step.input_hash && (
                  <Field label="input hash">
                    <p className="t-meta font-mono">{step.input_hash}</p>
                  </Field>
                )}
                {step.output_ref && (
                  <Field label="output ref">
                    <p className="t-meta font-mono">{step.output_ref}</p>
                  </Field>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
