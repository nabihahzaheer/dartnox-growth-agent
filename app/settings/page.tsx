'use client';

/**
 * SETTINGS & GUARDRAILS — deliberately the thinnest of the five screens.
 *
 * The brief names four controls: "tone, thresholds, approval rules, escalation triggers." D-004
 * makes this the screen to trade against the console, and D-044 counted eighteen field groups in an
 * earlier plan against those four names. So this builds the four properly, adds the guardrail rules
 * because that is what "& guardrails" means, and stops. The README says the thinness is a decision,
 * so it reads as intent rather than as a screen someone ran out of time on.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ORGANISING IDEA: EVERY CONTROL SAYS WHEN IT TAKES EFFECT
 *
 * Most settings here do nothing until the next run. That is the honest situation and it is also the
 * thing that makes a settings screen feel dead, so `effect_timing` is rendered on every row rather
 * than being a property of the data nobody sees. An operator about to change the tone register
 * needs to know it will not touch anything already drafted.
 *
 * Two controls are immediate, and both preview their consequence *before* they are committed:
 *
 *   The score threshold says how many waiting drafts it would flag as you drag it.
 *   The banned-phrase field says how many scheduled posts a phrase would catch as you type it.
 *
 * That is not polish. A control whose effect is invisible until after you commit is one a reviewer
 * cannot evaluate, and the banned-claim sweep in particular is unfindable without it — nobody
 * guesses which phrase occurs in which scheduled post.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY LOCKED ROWS RENDER AT ALL RATHER THAN BEING HIDDEN
 *
 * Three escalation triggers, three guardrail rules and the whole auto-approve block cannot be
 * changed. Hiding them would make the screen shorter and would hide the architecture's most
 * defensible claim: that some rules are fixed on purpose, and which ones. A greyed-out toggle with
 * no explanation reads as a bug, so every locked row carries the sentence saying why — loosening a
 * rule on the evidence of its own false positives is only safe where a false negative is
 * recoverable.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SHAPE OF THE SCREEN (D-045)
 *
 * This screen was the worst case of the inverted hierarchy the type scale exists to fix: its
 * section heading was 10px mono caps in --text-faint and the field label directly beneath it was
 * 12px sans in --text-muted, so the heading was smaller and fainter than the label it introduced.
 * Nine headings at that weight, separated by the same gap that separated rows inside them, is one
 * undifferentiated wall.
 *
 * Two changes, and the second matters more than the first:
 *
 *   1. Headings are `.t-section` — 14/600, full contrast, the only semibold text in the column.
 *   2. The nine sections became FIVE GROUPS. Tone · Review · Guardrails · Learned rules · History.
 *      Threshold, approval rules, escalation triggers and auto-approve are one question — what
 *      reaches a person — so they are four panels under one heading rather than four peers of it.
 *      Guardrails are four panels, one per layer, because L1–L4 is the ordering the architecture
 *      already uses and it was previously carried by a mono-caps line indistinguishable from a
 *      section heading.
 *
 * The rung between `.t-section` and `.t-body` is `<SubHead>`, and it is a WEIGHT step rather than a
 * size step: 13/600 full contrast over 13/400 rows. Making it a size step would have needed a 16px
 * sub-heading and a 20px heading above it, which turns a dense operator screen into a document —
 * the failure mode the scale's own comment in globals.css rejects.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  addBannedPhrase,
  getSettingsScreen,
  previewBannedPhrase,
  toggleGuardrail,
  updateSettings,
  type SettingsScreen,
} from '@/lib/agentClient';
import type {
  ConsoleError,
  EffectTiming,
  EscalationRuleEntry,
  GuardrailRule,
  ReflectionRule,
} from '@/lib/types';
import { formatDateTime, formatRelative } from '@/lib/time';
import { Badge } from '@/components/Badge';
import { ErrorPanel } from '@/components/ErrorState';
import { Rail } from '@/components/Rail';

/** What an operator would call the timing, not what the enum calls it. One lookup, so two rows
 *  cannot describe the same timing two ways. */
const TIMING_LABEL: Record<EffectTiming, string> = {
  immediate: 'takes effect now',
  next_draft: 'next draft',
  next_guardrail_run: 'next guardrail run',
  next_calendar: 'next calendar',
  next_publish: 'next publish',
};

export default function SettingsPage() {
  const [data, setData] = useState<SettingsScreen | null>(null);
  const [error, setError] = useState<ConsoleError | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  /** What the last write did, in the operator's terms. A settings change with no acknowledgement is
   *  indistinguishable from one that failed. */
  const [note, setNote] = useState<string | null>(null);
  /** A refusal, kept separate from `error`: a locked control saying no is the system working, not a
   *  failure, and rendering it in the red panel would misreport it. */
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await getSettingsScreen();
        if (cancelled) return;
        setData(next);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e as ConsoleError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  /** Every write goes through here, so the busy flag, the refusal branch and the reload happen in
   *  one place rather than being remembered at eight call sites. */
  const write = useCallback(
    async (key: string, run: () => Promise<string>) => {
      setBusy(key);
      setRefusal(null);
      try {
        setNote(await run());
        reload();
      } catch (e) {
        const err = e as ConsoleError;
        /** The kind that exists for exactly this screen. D-031 declared it and nothing threw it
         *  until the settings writes did. */
        if (err.kind === 'forbidden') setRefusal(err.reason);
        else setError(err);
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  return (
    <>
      <Rail />
      <main className="flex min-w-0 flex-1 flex-col">
        <div
          className="shrink-0 border-b px-4 py-2.5"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-baseline gap-x-3 gap-y-1">
            {/* The screen name, and the app's only `h1` on this route. It was a 13px bold span,
                which is what a screen title looks like when no scale names the role. */}
            <h1 className="t-title">Settings</h1>
            {/* Three states, not two. The first version read `data ? version : 'Loading…'`, which
                left the header saying "Loading…" underneath a rendered error panel — caught by
                looking at the page with the read deliberately broken, which is the only way it
                could have been caught. */}
            <span className="t-meta tabular">
              {data
                ? `version ${data.settings.current_version_id}`
                : error
                  ? 'could not load'
                  : 'Loading…'}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* No `space-y` here: the vertical rhythm between groups is `.section + .section` in
              globals.css, and a utility gap on the container would fight it. The transient panels
              above the groups carry their own margin instead. */}
          <div className="mx-auto w-full max-w-3xl px-4 py-4">
            {note && (
              <p
                className="t-body mb-3 rounded px-2.5 py-1.5 font-semibold"
                style={{ background: 'var(--note-bg)', color: 'var(--note-ink)' }}
              >
                {note}
              </p>
            )}

            {refusal && (
              <div className="mb-3">
                <RefusalPanel reason={refusal} onDismiss={() => setRefusal(null)} />
              </div>
            )}
            {error && (
              <div className="mb-3">
                <ErrorPanel
                  error={error}
                  onRetry={reload}
                  notFoundCopy="Those settings could not be found."
                />
              </div>
            )}
            {loading && <Skeleton />}

            {data && !loading && (
              <>
                <Tone data={data} busy={busy} onWrite={write} />

                {/*
                  THE REGROUPING, AND WHY THESE FOUR.

                  Threshold, approval rules, escalation triggers and auto-approve all answer one
                  question — what arrives in front of a person, and what does not. Rendered as four
                  peer sections they read as four unrelated preferences; rendered as four panels
                  under one heading the reader can see that turning auto-approve on and lowering the
                  threshold pull in opposite directions on the same queue.
                */}
                <Group title="Review">
                  <div className="space-y-2.5">
                    <Threshold data={data} busy={busy} onWrite={write} />
                    <Rules
                      title="Approval rules"
                      caption="What forces an item in front of a person."
                      rows={data.settings.approval_rules}
                      kind="approval_rule"
                      standing={data.settings.phase === 'v1_all_human'}
                      busy={busy}
                      onWrite={write}
                    />
                    <Rules
                      title="Escalation triggers"
                      caption="What raises an escalation, and to whom."
                      rows={data.settings.escalation_triggers}
                      kind="escalation_trigger"
                      busy={busy}
                      onWrite={write}
                    />
                    <AutoApprove data={data} busy={busy} onWrite={write} />
                  </div>
                </Group>

                <Group title="Spend" caption="What the agent may cost this client per month.">
                  <Budget data={data} busy={busy} onWrite={write} />
                </Group>

                <Guardrails rules={data.guardrailRules} busy={busy} onWrite={write} />
                <LearnedRules rules={data.reflectionRules} evidence={data.evidence} />
                <VersionHistory data={data} />

                <p className="t-meta mt-7">
                  Cadence, allowlists, entities, terminology, budget and alerting are modelled and
                  not shown here. See the README.
                </p>
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

/* ================================================================================================
 * SHARED FURNITURE
 * ==============================================================================================*/

/**
 * A group of the screen. `.section` is what earns the 28px above the heading and the 10px below it,
 * and `.t-section` has to be its DIRECT child for `.section > .t-section` to bite — so the caption
 * is a sibling of the heading rather than being wrapped with it in a header div.
 *
 * The caption's own 10px bottom margin matches the heading's, which makes heading · caption · body
 * one evenly spaced block sitting 28px clear of the group before it. More space above than below is
 * the whole mechanism: it binds the heading to its own content instead of to the previous group.
 */
function Group({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="section">
      <h2 className="t-section">{title}</h2>
      {caption && <p className="t-label mb-2.5">{caption}</p>}
      {children}
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded border px-3 py-2.5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      {children}
    </div>
  );
}

/**
 * The rung between `.t-section` and `.t-body`, and it is a weight step rather than a size step: a
 * 13px semibold heading over 13px regular rows. A size step would have forced the group heading up
 * to 16px and the screen title to 18px to stay ordered, which is how a dense console turns into a
 * document.
 *
 * Deliberately NOT `.t-field`. Mono caps is reserved for labelling a value, and the reason section
 * headings and field labels stopped looking identical is that only one of them may have it.
 */
function SubHead({ title, caption }: { title: string; caption?: string }) {
  return (
    <div className="mb-2">
      <h3 className="t-subsection">{title}</h3>
      {caption && <p className="t-label">{caption}</p>}
    </div>
  );
}

/** A one-panel group, for the four groups that hold a single block. */
function Section({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <Group title={title} caption={caption}>
      <Panel>{children}</Panel>
    </Group>
  );
}

/** When a control takes effect, rendered on the control rather than in a legend. */
function Timing({ timing }: { timing: EffectTiming }) {
  return (
    <span
      className="t-meta font-mono"
      style={
        timing === 'immediate' ? { color: 'var(--state-approved)' } : undefined
      }
    >
      {TIMING_LABEL[timing]}
    </span>
  );
}

/** A row that cannot be changed, with the sentence saying why. Never a bare disabled control.
 *  The reason sits at `.t-label` rather than at the old 11px: it is the row's justification, and
 *  the small print was the thing an operator actually has to read. */
function Locked({ reason }: { reason: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <Badge tone="neutral" mono>
        fixed
      </Badge>
      <span className="t-label">{reason}</span>
    </span>
  );
}

/* ================================================================================================
 * TONE — the first of the brief's four
 * ==============================================================================================*/

function Tone({
  data,
  busy,
  onWrite,
}: {
  data: SettingsScreen;
  busy: string | null;
  onWrite: (key: string, run: () => Promise<string>) => Promise<void>;
}) {
  const { settings, scheduledCount } = data;
  const [register, setRegister] = useState(settings.tone.register);
  const [phrase, setPhrase] = useState('');

  /**
   * The live count, and the reason this control is findable at all.
   *
   * Synchronous and local — it is a predicate over posts the screen has already caused to be
   * loaded, not a round trip, so it runs on every keystroke without a loading state. A reviewer who
   * had to commit a phrase to discover whether it matched anything would never find the one that
   * does.
   */
  const matches = useMemo(() => previewBannedPhrase(phrase), [phrase]);
  const trimmed = phrase.trim();
  const alreadyBanned = settings.tone.banned_phrases.some(
    (p) => p.toLowerCase() === trimmed.toLowerCase(),
  );

  return (
    <Section title="Tone" caption="How the agent writes, and what it may not say.">
      <div className="space-y-3">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="register" className="t-label">
              Register
            </label>
            <Timing timing={settings.field_meta['tone.register']?.effect_timing ?? 'next_draft'} />
          </div>
          <div className="mt-1 flex gap-1.5">
            <input
              id="register"
              value={register}
              onChange={(e) => setRegister(e.target.value)}
              className="t-body min-w-0 flex-1 rounded border px-2 py-1 outline-none"
              style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-sunk)' }}
            />
            <button
              type="button"
              disabled={register === settings.tone.register || busy !== null}
              aria-busy={busy === 'register'}
              onClick={() =>
                void onWrite('register', async () => {
                  await updateSettings({ kind: 'tone_register', value: register });
                  return 'Register saved · applies from the next draft';
                })
              }
              className="t-body shrink-0 rounded px-2.5 py-1 font-medium disabled:opacity-30"
              style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
            >
              Save
            </button>
          </div>
          <p className="t-meta mt-1">Writes as “{settings.tone.person}”.</p>
        </div>

        {/* ---- banned phrases, and the sweep ---------------------------------------------- */}
        <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="t-label">Banned phrases</span>
            <Timing
              timing={settings.field_meta['tone.banned_phrases']?.effect_timing ?? 'next_guardrail_run'}
            />
          </div>

          <div className="mt-1 flex flex-wrap gap-1">
            {settings.tone.banned_phrases.map((p) => (
              <Badge key={p} tone="blocked" mono>
                {p}
              </Badge>
            ))}
          </div>

          <div className="mt-2 flex gap-1.5">
            <label htmlFor="banned" className="sr-only">
              Add a banned phrase
            </label>
            <input
              id="banned"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="a phrase this client will not say"
              className="t-body min-w-0 flex-1 rounded border px-2 py-1 outline-none placeholder:text-[var(--text-faint)]"
              style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-sunk)' }}
            />
            <button
              type="button"
              disabled={trimmed.length === 0 || alreadyBanned || busy !== null}
              aria-busy={busy === 'banned'}
              onClick={() =>
                void onWrite('banned', async () => {
                  const result = await addBannedPhrase(trimmed);
                  setPhrase('');
                  return result.invalidated === 0
                    ? `“${trimmed}” banned · no scheduled posts affected`
                    : `“${trimmed}” banned · ${result.invalidated} of ${result.scanned} posts back in the queue`;
                })
              }
              className="t-body shrink-0 rounded px-2.5 py-1 font-medium disabled:opacity-30"
              style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
            >
              {busy === 'banned' ? 'Checking…' : 'Ban it'}
            </button>
          </div>

          {/*
            THE SIGNPOST. Three states, and all three are informative:
            already banned · matches nothing · matches something, with the count.
            A control that reports nothing until after you commit cannot be evaluated.

            `.t-label` rather than the old 11px faint: this is the output of a live control, so it
            is the one line here that must not read as small print.
          */}
          <p className="t-label tabular mt-1">
            {trimmed.length === 0 ? (
              <>Re-checks {scheduledCount} scheduled posts.</>
            ) : alreadyBanned ? (
              <>Already banned.</>
            ) : matches === 0 ? (
              <>No match in {scheduledCount} scheduled posts.</>
            ) : (
              <span style={{ color: 'var(--state-awaiting)' }}>
                Matches {matches} of {scheduledCount} scheduled posts — {matches === 1 ? 'it returns' : 'they return'} to the queue.
              </span>
            )}
          </p>
        </div>
      </div>
    </Section>
  );
}

/* ================================================================================================
 * THRESHOLD — the highest-value live control. A panel inside `Review` rather than a section of its
 * own: it is one of four answers to "what reaches a person".
 * ==============================================================================================*/

/* ================================================================================================
 * SPEND — the board's admission gate, made operable
 *
 * The gate sits between the job queue and the orchestrator and has an asymmetric consequence: at
 * the cap, new drafting and planning wait and the owner is notified, already-approved posts still
 * publish, and reply monitoring keeps running. The system degrades by stopping the expensive
 * optional work, not by going dark on content already in the world.
 *
 * WHY THE CONTROL IS THE CAP AND NOT A READOUT. Spend is $121 of $400 — 30%. A readout of that is a
 * number nobody acts on, and no fixture edit reaches the stop branch without inventing a month of
 * spend. Moving the cap reaches it instead: `field_meta['budget.cap']` already declared the control
 * immediate with a 50–2000 range and nothing had ever rendered it. Dragging it below spend puts the
 * client into its own stop state in front of the reviewer, by their action — the same mechanism the
 * banned-phrase sweep uses. A fifth failure switch would have demonstrated that the prototype can
 * pretend; this demonstrates that the gate is wired to the number it gates on.
 * ==============================================================================================*/

function Budget({
  data,
  busy,
  onWrite,
}: {
  data: SettingsScreen;
  busy: string | null;
  onWrite: (key: string, run: () => Promise<string>) => Promise<void>;
}) {
  const { settings, budget } = data;
  const meta = settings.field_meta['budget.cap'];
  const range = meta?.range ?? { min: 50, max: 2000 };

  const [value, setValue] = useState(settings.budget.cap);

  /**
   * The consequence, computed as the slider moves and before anything is written — the same
   * discipline as the threshold above. Recomputed against the dragged value rather than read off
   * `budget.state`, which describes the committed cap.
   */
  const pct = value === 0 ? 0 : (budget.spent / value) * 100;
  const wouldStop = pct >= settings.budget.stop_pct;
  const wouldAlert = !wouldStop && pct >= settings.budget.alert_pct;

  return (
    <Panel>
      <SubHead title="Monthly cap" caption="At the cap, drafting waits. Approved posts still go." />

      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label">Cap</span>
        <Timing timing={meta?.effect_timing ?? 'immediate'} />
      </div>

      <div className="mt-1.5 flex items-center gap-3">
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={10}
          value={value}
          aria-label="Monthly cap"
          onChange={(e) => setValue(Number(e.target.value))}
          className="min-w-0 flex-1"
          style={{ accentColor: 'var(--accent)' }}
        />
        <span className="t-body tabular w-14 shrink-0 text-right font-mono font-bold">
          ${value}
        </span>
        <button
          type="button"
          disabled={value === settings.budget.cap || busy !== null}
          aria-busy={busy === 'budget'}
          onClick={() =>
            void onWrite('budget', async () => {
              await updateSettings({ kind: 'budget_cap', value });
              return wouldStop
                ? `Cap now $${value} · at the cap, drafting paused`
                : `Cap now $${value}`;
            })
          }
          className="t-body shrink-0 rounded px-2.5 py-1 font-medium disabled:opacity-30"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          Save
        </button>
      </div>

      {/* Spend is the denominator's other half and is not editable, so it sits with the range
          rather than as a control. `sample_n` is there because a cost figure with no visible
          basis is one nobody can challenge. */}
      <p className="t-meta tabular mt-1 font-mono">
        tunable ${range.min} – ${range.max} · spent ${budget.spent.toFixed(2)} over{' '}
        {budget.sample_n} steps
      </p>

      {/* The preview, and the only place on this screen where a control announces a state change
          before it is committed. Silent while the dragged cap is comfortable — a permanent line
          saying "under the cap" is a row spent agreeing with itself. */}
      {(wouldStop || wouldAlert) && (
        <p
          className="t-label mt-1.5"
          style={{ color: wouldStop ? 'var(--state-blocked)' : 'var(--state-awaiting)' }}
        >
          {wouldStop
            ? `Would stop new drafting · ${Math.round(pct)}% of cap`
            : `Would pass the ${settings.budget.alert_pct}% alert`}
        </p>
      )}
    </Panel>
  );
}

function Threshold({
  data,
  busy,
  onWrite,
}: {
  data: SettingsScreen;
  busy: string | null;
  onWrite: (key: string, run: () => Promise<string>) => Promise<void>;
}) {
  const { settings, awaitingDecision } = data;
  const meta = settings.field_meta.score_threshold;
  const range = meta?.range ?? { min: 0.6, max: 0.95 };

  const [value, setValue] = useState(settings.score_threshold);

  /**
   * The consequence, computed as the slider moves and before anything is written.
   *
   * This is the whole reason the threshold is the control worth building: no run is needed, the
   * population is on screen, and dragging it across a draft's composite score visibly flips that
   * draft's review flag and its position in the queue. D-041 cut the low-score failure switch
   * precisely because this demonstrates the same behaviour without a scripted variant — the
   * reviewer does it themselves.
   */
  const flaggedNow = awaitingDecision.filter((d) => d.composite_score < value);
  const flaggedCommitted = awaitingDecision.filter(
    (d) => d.composite_score < settings.score_threshold,
  );
  const willChange = flaggedNow.length !== flaggedCommitted.length;

  return (
    <Panel>
      <SubHead title="Score threshold" caption="Score a draft must clear to arrive unflagged." />

      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label">Review threshold</span>
        <Timing timing={meta?.effect_timing ?? 'immediate'} />
      </div>

      <div className="mt-1.5 flex items-center gap-3">
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={0.01}
          value={value}
          aria-label="Review threshold"
          onChange={(e) => setValue(Number(e.target.value))}
          className="min-w-0 flex-1"
          style={{ accentColor: 'var(--accent)' }}
        />
        {/* The live value of the control being dragged, so it is a metric rather than a caption —
            `.tabular` stops the digits reflowing under the cursor as it moves. */}
        <span className="t-body tabular w-12 shrink-0 text-right font-mono font-bold">
          {value.toFixed(2)}
        </span>
        <button
          type="button"
          disabled={value === settings.score_threshold || busy !== null}
          aria-busy={busy === 'threshold'}
          onClick={() =>
            void onWrite('threshold', async () => {
              await updateSettings({ kind: 'score_threshold', value });
              return `Threshold now ${value.toFixed(2)} · queue re-sorted`;
            })
          }
          className="t-body shrink-0 rounded px-2.5 py-1 font-medium disabled:opacity-30"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          Save
        </button>
      </div>

      <p className="t-meta tabular mt-1 font-mono">
        tunable {range.min} – {range.max} · saved value {settings.score_threshold.toFixed(2)}
      </p>

      {/* The population, named. "2 of 2 flagged" is a number; showing which drafts and at what
          score is the thing that lets a reviewer check the claim rather than believe it. */}
      <ul className="mt-2 space-y-1 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
        {awaitingDecision.map((draft) => {
          const flagged = draft.composite_score < value;
          const wasFlagged = draft.composite_score < settings.score_threshold;
          const version = draft.versions.find((v) => v.id === draft.current_version_id);
          return (
            <li key={draft.id} className="t-body flex items-baseline gap-2">
              <span
                className="t-meta tabular w-11 shrink-0 font-mono"
                style={{ color: flagged ? 'var(--state-awaiting)' : 'var(--text-faint)' }}
              >
                {draft.composite_score.toFixed(3)}
              </span>
              <Badge tone={flagged ? 'awaiting' : 'neutral'}>
                {flagged ? 'flagged' : 'clean'}
              </Badge>
              <Link
                href={`/draft/${draft.id}`}
                className="min-w-0 flex-1 truncate"
                style={{ color: 'var(--accent-text)' }}
              >
                {version?.text.split('\n')[0].slice(0, 60)}
              </Link>
              {flagged !== wasFlagged && (
                <span className="t-meta shrink-0 font-mono" style={{ color: 'var(--accent-text)' }}>
                  changes
                </span>
              )}
            </li>
          );
        })}
        {awaitingDecision.length === 0 && <li className="t-label">Nothing waiting.</li>}
      </ul>

      {willChange && (
        <p className="t-label tabular mt-2" style={{ color: 'var(--state-awaiting)' }}>
          Would flag {flaggedNow.length} of {awaitingDecision.length}, up from {flaggedCommitted.length}.
        </p>
      )}
    </Panel>
  );
}

/* ================================================================================================
 * APPROVAL RULES AND ESCALATION TRIGGERS — two of the brief's four, one component
 * ==============================================================================================*/

function Rules({
  title,
  caption,
  rows,
  kind,
  standing,
  busy,
  onWrite,
}: {
  title: string;
  caption: string;
  rows: EscalationRuleEntry[];
  kind: 'approval_rule' | 'escalation_trigger';
  /** The one approval rule that is not a condition, so it has no row in the array. See below. */
  standing?: boolean;
  busy: string | null;
  onWrite: (key: string, run: () => Promise<string>) => Promise<void>;
}) {
  return (
    <Panel>
      <SubHead title={title} caption={caption} />
      <ul className="space-y-1.5">
        {/*
          THE RULE THE TYPE CANNOT EXPRESS, rendered rather than omitted.

          `EscalationRuleEntry` keys on `EscalationTrigger`, which is a vocabulary of *conditions*.
          The single most important approval rule in v1 — every post is reviewed by a person,
          always, unconditionally — is not a condition and has no member in that union. It is
          carried by `phase: 'v1_all_human'` instead. Minting a fake trigger for it would have put a
          value in the union that the escalation-precision metric would then have to special-case
          out, so the screen reads it from `phase` and says so.
        */}
        {standing && (
          <li
            className="flex flex-wrap items-center gap-2 rounded px-2 py-1.5"
            style={{ background: 'var(--surface-sunk)' }}
          >
            <span className="t-body font-medium">Every post is reviewed by a person</span>
            <span className="ml-auto">
              <Locked reason="Not a condition, so it has no toggle." />
            </span>
          </li>
        )}

        {rows.map((row) => (
          <li key={row.trigger} className="flex flex-wrap items-center gap-2">
            <span className="t-body">{row.trigger.replace(/_/g, ' ')}</span>
            <Badge tone={row.tier === 'stakeholder' ? 'blocked' : 'neutral'} mono>
              {row.tier === 'stakeholder' ? 'to the owner' : 'to you'}
            </Badge>

            <span className="ml-auto flex items-center gap-2">
              {row.is_fixed ? (
                <Locked
                  reason={
                    row.tier === 'stakeholder'
                      ? 'Not recoverable if missed.'
                      : 'A failure always blocks.'
                  }
                />
              ) : (
                <label className="t-label flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    disabled={busy !== null}
                    onChange={() =>
                      void onWrite(`${kind}:${row.trigger}`, async () => {
                        await updateSettings({
                          kind,
                          trigger: row.trigger,
                          enabled: !row.enabled,
                        });
                        return `${row.trigger.replace(/_/g, ' ')} ${!row.enabled ? 'enabled' : 'disabled'}`;
                      })
                    }
                  />
                  <span>{row.enabled ? 'on' : 'off'}</span>
                </label>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ================================================================================================
 * GUARDRAILS — what "& guardrails" means
 * ==============================================================================================*/

function Guardrails({
  rules,
  busy,
  onWrite,
}: {
  rules: GuardrailRule[];
  busy: string | null;
  onWrite: (key: string, run: () => Promise<string>) => Promise<void>;
}) {
  const layers: { layer: GuardrailRule['layer']; label: string }[] = [
    { layer: 'L1', label: 'sources' },
    { layer: 'L2', label: 'output shape' },
    { layer: 'L3', label: 'content' },
    { layer: 'L4', label: 'pre-publish' },
  ];

  return (
    <Group title="Guardrail rules" caption="Checks the agent cannot skip. Pass, warn or fail.">
      {/*
        ONE PANEL PER LAYER, rather than one panel with four mono-caps dividers inside it.

        The dividers were the second worst instance of the inverted hierarchy on this screen: "L3 ·
        content" was styled identically to the section heading above it, so four sub-groups and one
        group all read at the same rank. L1–L4 is a real ordering — sources, shape, content,
        pre-publish — and giving each its own panel is what makes thirteen rules scannable as four
        stages rather than as a list of thirteen.
      */}
      <div className="space-y-2.5">
        {layers.map(({ layer, label }) => {
          const inLayer = rules.filter((r) => r.layer === layer);
          if (inLayer.length === 0) return null;
          return (
            <Panel key={layer}>
              <SubHead title={`${layer} · ${label}`} />
              <ul className="space-y-2">
                {inLayer.map((rule) => (
                  <li key={rule.id}>
                    <div className="flex flex-wrap items-baseline gap-2">
                      {/* Regular weight, not medium: the semibold in this panel belongs to the
                          layer heading, and two weights competing is what flattened it before. */}
                      <span
                        className="t-body"
                        style={{ color: rule.is_enabled ? 'var(--text)' : 'var(--text-faint)' }}
                      >
                        {rule.display_name}
                      </span>
                      <Badge tone={rule.severity === 'block' ? 'blocked' : 'awaiting'} mono>
                        {rule.severity}
                      </Badge>
                      <Timing timing={rule.effect_timing} />

                      <span className="ml-auto flex items-center gap-2">
                        {rule.is_fixed ? (
                          <Locked reason={rule.fixed_reason} />
                        ) : (
                          <label className="t-label flex cursor-pointer items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={rule.is_enabled}
                              disabled={busy !== null}
                              onChange={() =>
                                void onWrite(`rule:${rule.id}`, async () => {
                                  await toggleGuardrail(rule.id, !rule.is_enabled);
                                  return rule.is_enabled
                                    ? `“${rule.display_name}” switched off`
                                    : `“${rule.display_name}” switched on`;
                                })
                              }
                            />
                            <span>{rule.is_enabled ? 'on' : 'off'}</span>
                          </label>
                        )}
                      </span>
                    </div>

                    <p className="t-label">{rule.description}</p>

                    {/*
                      The disabled-from marker, which is the reason `disabled_at` exists beside
                      `is_enabled`. A rule's block rate falling to zero has two causes — the check
                      broke, or somebody switched it off — and the dashboard cannot tell them apart
                      without this date.
                    */}
                    {!rule.is_enabled && rule.disabled_at !== null && (
                      <p className="t-meta tabular" style={{ color: 'var(--state-parked)' }}>
                        Off since {formatDateTime(rule.disabled_at)}.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          );
        })}
      </div>
    </Group>
  );
}

/* ================================================================================================
 * AUTO-APPROVE — locked, and listing what is unmet rather than merely greyed out
 * ==============================================================================================*/

function AutoApprove({
  data,
  busy,
  onWrite,
}: {
  data: SettingsScreen;
  busy: string | null;
  onWrite: (key: string, run: () => Promise<string>) => Promise<void>;
}) {
  const { auto_approve: auto } = data.settings;
  const met = auto.prereqs.filter((p) => p.met).length;

  return (
    <Panel>
      <SubHead title="Auto-approve" caption="Off in v1. Every post is reviewed." />

      <div className="flex flex-wrap items-center gap-2">
        <span className="t-body font-medium">Publish without per-item review</span>
        {/*
          A CONTROL THAT REFUSES RATHER THAN A CONTROL THAT IS DEAD.

          The obvious rendering is a `disabled` checkbox. It was the first version and it is worse
          in two ways. A disabled input fires no events, so the operator who wants to know *why*
          has nowhere to click — and the refusal only exists in the client, which means the one
          error kind written for this case (`forbidden`, D-031) would be unreachable from the
          product and the seven-kind taxonomy would be a claim the code does not keep.

          So the control is live, the write is attempted, and the API refuses it with the reason.
          That is also what a real system does: the UI discourages, the server decides. A client
          that enforced this alone would be enforcing a safety invariant in the one place the
          operator can edit.
        */}
        <button
          type="button"
          disabled={busy !== null}
          aria-busy={busy === 'auto_approve'}
          onClick={() =>
            void onWrite('auto_approve', async () => {
              await updateSettings({ kind: 'auto_approve', value: true });
              return 'Auto-approve enabled';
            })
          }
          className="t-body rounded border px-2.5 py-1 disabled:opacity-40"
          style={{ borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }}
        >
          Try to turn it on
        </button>
        <span className="t-meta tabular ml-auto font-mono">
          {met} of {auto.prereqs.length} client prerequisites met
        </span>
      </div>

      <p className="t-label mt-1.5">{auto.lock_reason}</p>

      {/*
        The list is the point. A greyed toggle says "no"; a greyed toggle above six named
        prerequisites, four of them unmet, says what would have to become true — which is a product
        answering the question rather than refusing it.
      */}
      <ul className="mt-2 space-y-1 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
        {auto.prereqs.map((prereq) => (
          <li key={prereq.key} className="t-body flex items-baseline gap-2">
            <Badge tone={prereq.met ? 'approved' : 'neutral'} mono>
              {prereq.met ? 'met' : 'not yet'}
            </Badge>
            <span style={{ color: 'var(--text-muted)' }}>{prereq.detail}</span>
          </li>
        ))}
      </ul>

      {/*
        The distinction that stops this list being misleading. A-09 has ten prerequisites; six are
        client-level and static and are the ones above. The other four are per-draft — score above
        threshold, all guardrails pass, not degraded, pillar not always-review — and rendering them
        here would show a green tick beside a draft that would not itself have qualified.
      */}
      <p className="t-meta mt-2">Four more conditions are checked per draft, not here.</p>
    </Panel>
  );
}

/* ================================================================================================
 * LEARNED WRITING RULES
 * ==============================================================================================*/

function LearnedRules({
  rules,
  evidence,
}: {
  rules: ReflectionRule[];
  evidence: Record<string, import('@/lib/types').DraftVersion[]>;
}) {
  const active = rules.filter((r) => r.status === 'active');
  const suggested = rules.filter((r) => r.status === 'suggested');
  const retired = rules.filter((r) => r.status === 'retired');

  return (
    <Section
      title="Learned writing rules"
      caption="Patterns found in your edits. Three occurrences make a suggestion."
    >
      <ul className="space-y-2">
        {[...suggested, ...active, ...retired].map((rule) => {
          const backing = evidence[rule.id] ?? [];
          return (
            <li key={rule.id}>
              <div className="flex flex-wrap items-baseline gap-2">
                <Badge
                  tone={
                    rule.status === 'active'
                      ? 'approved'
                      : rule.status === 'suggested'
                        ? 'awaiting'
                        : 'neutral'
                  }
                >
                  {rule.status}
                </Badge>
                <span className="t-body">{rule.text}</span>
                <span className="t-meta ml-auto font-mono">
                  {rule.activated_at !== null
                    ? `since ${formatRelative(rule.activated_at)}`
                    : `review by ${formatRelative(rule.review_due)}`}
                </span>
              </div>

              {/*
                THE EVIDENCE CHAIN — the only visible proof in the product that this loop runs.

                Naming a pattern without showing the edits asks the operator to take it on trust;
                showing three edits without naming the pattern makes them re-derive the cause. Both
                or neither.

                Empty is a different statement from missing, and the copy says which. A rule
                activated 31 to 45 days ago was emitted from decisions outside the three weeks of
                history this dataset retains, so there is genuinely nothing to show — as opposed to
                a suggestion, which is emitted from the last twenty decisions and therefore always
                has its three.
              */}
              {backing.length > 0 ? (
                <details className="mt-0.5">
                  {/* `.t-label`, not the old 10px mono caps. A disclosure is a control, and a
                      control set in the faintest, smallest treatment on the screen is one nobody
                      finds — which would have made the evidence chain effectively invisible. */}
                  <summary className="t-label tabular cursor-pointer font-mono">
                    {backing.length} edits behind this · {rule.evidence_tag.replace(/_/g, ' ')}
                  </summary>
                  <ul className="mt-1 space-y-1">
                    {backing.map((version) => (
                      <li
                        key={version.id}
                        className="rounded px-2 py-1"
                        style={{ background: 'var(--surface-sunk)' }}
                      >
                        <span className="t-meta tabular font-mono">
                          {version.id} · {formatRelative(version.created_at)}
                        </span>
                        <p className="t-label mt-0.5">
                          {version.text.split('\n')[0].slice(0, 120)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <p className="t-meta">Evidence not retained.</p>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/* ================================================================================================
 * VERSION HISTORY
 * ==============================================================================================*/

function VersionHistory({ data }: { data: SettingsScreen }) {
  const versions = [...data.settings.versions].reverse();

  return (
    <Section title="Change history" caption="Every change, dated, with what it changed.">
      <ul className="space-y-2">
        {versions.map((version, index) => (
          <li key={version.version_id}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="t-meta tabular font-mono">{version.version_id}</span>
              {index === 0 && (
                <Badge tone="approved" mono>
                  current
                </Badge>
              )}
              <span className="t-body">{version.change_summary}</span>
              <span className="t-meta ml-auto font-mono">{formatRelative(version.changed_at)}</span>
            </div>
            {/* The per-key diff, which is what makes a version reconstructible. A bare version
                integer could not answer "what did version 3 say", so the comparison it exists to
                serve would be uncomputable. */}
            {version.diff.length > 0 && (
              <ul className="mt-0.5 space-y-0.5">
                {version.diff.map((entry) => (
                  <li
                    key={entry.key}
                    className="t-meta tabular font-mono"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {entry.key}: {String(entry.from)} → {String(entry.to)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <p className="t-label mt-2">
        <Link href="/metrics" style={{ color: 'var(--accent-text)' }}>
          Edit rate by version →
        </Link>
      </p>
    </Section>
  );
}

/* ================================================================================================
 * STATES — named by the brief as a constraint, so they are components rather than afterthoughts
 * ==============================================================================================*/

function Skeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading settings">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 rounded border"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        />
      ))}
    </div>
  );
}

/**
 * A refusal is the system working, not a failure, so it does not render in the red panel.
 *
 * D-031's `forbidden` exists because the copy differs from every other error kind: nothing went
 * wrong, nothing needs retrying, and the reason is a design decision the operator is entitled to
 * read. Rendering it as an error would misreport a working guardrail as a broken one.
 *
 * The eyebrow is `.t-field`, which is the one call in this pass the scale did not answer cleanly.
 * It is mono caps and it sits above the reason, so it looks like a heading — but it is not one:
 * nothing is nested under it, and what it does is name the kind of the value below, which is
 * exactly the FIELD role. A `Badge` would have been the alternative and loses, because every badge
 * tone paints `--state-*-bg` and this panel is already on `--state-parked-bg`.
 */
function RefusalPanel({ reason, onDismiss }: { reason: string; onDismiss: () => void }) {
  return (
    <div
      className="rounded border px-3 py-2.5"
      style={{ borderColor: 'var(--state-parked)', background: 'var(--state-parked-bg)' }}
    >
      <p className="t-field" style={{ color: 'var(--state-parked)' }}>
        fixed control
      </p>
      <p className="t-body mt-0.5">{reason}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="t-body mt-2 rounded border px-2.5 py-1"
        style={{ borderColor: 'var(--border-strong)' }}
      >
        Dismiss
      </button>
    </div>
  );
}
