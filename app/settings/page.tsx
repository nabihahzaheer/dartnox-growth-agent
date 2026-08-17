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
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[13px] font-bold">Settings &amp; guardrails</span>
            {/* Three states, not two. The first version read `data ? version : 'Loading…'`, which
                left the header saying "Loading…" underneath a rendered error panel — caught by
                looking at the page with the read deliberately broken, which is the only way it
                could have been caught. */}
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {data
                ? `version ${data.settings.current_version_id}`
                : error
                  ? 'could not load'
                  : 'Loading…'}
            </span>
            <span className="ml-auto font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
              every change is a versioned event
            </span>
            <span className="w-full text-[11px]" style={{ color: 'var(--text-faint)' }}>
              What the agent may write and what stops it. Each control says when it takes effect —
              most apply to the next run, two apply immediately.
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-4">
            {note && (
              <p
                className="rounded px-2.5 py-1.5 text-[13px] font-bold"
                style={{ background: 'var(--note-bg)', color: 'var(--note-ink)' }}
              >
                {note}
              </p>
            )}

            {refusal && <RefusalPanel reason={refusal} onDismiss={() => setRefusal(null)} />}
            {error && <ErrorPanel error={error} onRetry={reload} notFoundCopy="Those settings could not be found." />}
            {loading && <Skeleton />}

            {data && !loading && (
              <>
                <Tone data={data} busy={busy} onWrite={write} />
                <Threshold data={data} busy={busy} onWrite={write} />
                <Rules
                  title="Approval rules"
                  caption="What forces an item in front of a person. In v1 none of these change whether a draft is seen — every post is reviewed regardless — they change how it arrives: flagged, sorted up, and with the approve control removed where a guardrail failed."
                  rows={data.settings.approval_rules}
                  kind="approval_rule"
                  standing={data.settings.phase === 'v1_all_human'}
                  busy={busy}
                  onWrite={write}
                />
                <Rules
                  title="Escalation triggers"
                  caption="Which conditions raise an escalation, and to whom. Operator-tier escalations change how an item arrives; owner-tier ones reach someone who otherwise sees only the calendar, so those genuinely change who is involved."
                  rows={data.settings.escalation_triggers}
                  kind="escalation_trigger"
                  busy={busy}
                  onWrite={write}
                />
                <Guardrails rules={data.guardrailRules} busy={busy} onWrite={write} />
                <AutoApprove data={data} busy={busy} onWrite={write} />
                <LearnedRules rules={data.reflectionRules} evidence={data.evidence} />
                <VersionHistory data={data} />

                <p className="pt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  This screen is deliberately the thinnest of the five. The brief names four
                  controls — tone, thresholds, approval rules, escalation triggers — and its closing
                  instruction says to choose an alive console over a fifth polished screen. Cadence,
                  posting windows, the two allowlists, approved entities, terminology, the budget
                  cap, auto-pull, the negative-engagement threshold, the rejection-reason set and the
                  weekend contact are all modelled and are not rendered here. That is a scoping
                  decision, and the README says so.
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
    <section>
      <h2
        className="font-mono text-[10px] font-bold uppercase"
        style={{ color: 'var(--text-faint)', letterSpacing: '0.1em' }}
      >
        {title}
      </h2>
      {caption && (
        <p className="mb-2 mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {caption}
        </p>
      )}
      <div
        className="rounded border px-3 py-2.5"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        {children}
      </div>
    </section>
  );
}

/** When a control takes effect, rendered on the control rather than in a legend. */
function Timing({ timing }: { timing: EffectTiming }) {
  return (
    <span
      className="font-mono text-[10px]"
      style={{ color: timing === 'immediate' ? 'var(--state-approved)' : 'var(--text-faint)' }}
    >
      {TIMING_LABEL[timing]}
    </span>
  );
}

/** A row that cannot be changed, with the sentence saying why. Never a bare disabled control. */
function Locked({ reason }: { reason: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <Badge tone="neutral" mono>
        fixed
      </Badge>
      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {reason}
      </span>
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
    <Section
      title="Tone"
      caption="How the agent writes, and what it may not say. The register feeds the drafting prompt; the banned phrases are matched literally by a guardrail, with no model involved."
    >
      <div className="space-y-3">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="register" className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Register
            </label>
            <Timing timing={settings.field_meta['tone.register']?.effect_timing ?? 'next_draft'} />
          </div>
          <div className="mt-1 flex gap-1.5">
            <input
              id="register"
              value={register}
              onChange={(e) => setRegister(e.target.value)}
              className="min-w-0 flex-1 rounded border px-2 py-1 text-[13px] outline-none"
              style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-sunk)' }}
            />
            <button
              type="button"
              disabled={register === settings.tone.register || busy !== null}
              onClick={() =>
                void onWrite('register', async () => {
                  await updateSettings({ kind: 'tone_register', value: register });
                  return 'Register saved · it applies from the next draft, not to anything already written';
                })
              }
              className="shrink-0 rounded px-2.5 py-1 text-[13px] font-medium disabled:opacity-30"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Save
            </button>
          </div>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
            Writing as “{settings.tone.person}”. Sample: {settings.tone.sample}
          </p>
        </div>

        {/* ---- banned phrases, and the sweep ---------------------------------------------- */}
        <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Banned phrases
            </span>
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
              className="min-w-0 flex-1 rounded border px-2 py-1 text-[13px] outline-none placeholder:text-[var(--text-faint)]"
              style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-sunk)' }}
            />
            <button
              type="button"
              disabled={trimmed.length === 0 || alreadyBanned || busy !== null}
              onClick={() =>
                void onWrite('banned', async () => {
                  const result = await addBannedPhrase(trimmed);
                  setPhrase('');
                  return result.invalidated === 0
                    ? `“${trimmed}” banned · ${result.scanned} scheduled posts re-validated, none affected`
                    : `“${trimmed}” banned · ${result.invalidated} of ${result.scanned} scheduled posts failed re-validation and are back in the queue`;
                })
              }
              className="shrink-0 rounded px-2.5 py-1 text-[13px] font-medium disabled:opacity-30"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {busy === 'banned' ? 'Checking…' : 'Ban it'}
            </button>
          </div>

          {/*
            THE SIGNPOST. Three states, and all three are informative:
            already banned · matches nothing · matches something, with the count.
            A control that reports nothing until after you commit cannot be evaluated.
          */}
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {trimmed.length === 0 ? (
              <>
                {scheduledCount} {scheduledCount === 1 ? 'post is' : 'posts are'} scheduled and not
                yet published. Adding a phrase re-validates{' '}
                {scheduledCount === 1 ? 'it' : 'all of them'}, and any post containing it returns to
                the queue.
              </>
            ) : alreadyBanned ? (
              <>Already on the list — nothing to add.</>
            ) : matches === 0 ? (
              <>Appears in none of the {scheduledCount} scheduled posts. Nothing would come back.</>
            ) : (
              <span style={{ color: 'var(--state-awaiting)' }}>
                Appears in {matches} of {scheduledCount} scheduled posts. Banning it returns{' '}
                {matches === 1 ? 'that post' : 'those posts'} to the queue for a fresh decision.
              </span>
            )}
          </p>
        </div>
      </div>
    </Section>
  );
}

/* ================================================================================================
 * THRESHOLD — the highest-value live control
 * ==============================================================================================*/

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
    <Section
      title="Score threshold"
      caption="The composite score a draft has to clear to arrive unflagged. It changes how an item is presented, never whether it is reviewed — and lowering it cannot bypass a guardrail, because L3 blocks independently of the score."
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Review threshold
        </span>
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
        <span className="w-12 shrink-0 text-right font-mono text-[13px] font-bold">
          {value.toFixed(2)}
        </span>
        <button
          type="button"
          disabled={value === settings.score_threshold || busy !== null}
          onClick={() =>
            void onWrite('threshold', async () => {
              await updateSettings({ kind: 'score_threshold', value });
              return `Threshold now ${value.toFixed(2)} · the queue has re-sorted and review flags have moved`;
            })
          }
          className="shrink-0 rounded px-2.5 py-1 text-[13px] font-medium disabled:opacity-30"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          Save
        </button>
      </div>

      <p className="mt-1 font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
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
            <li key={draft.id} className="flex items-baseline gap-2 text-[12px]">
              <span
                className="w-11 shrink-0 font-mono text-[11px]"
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
                <span className="shrink-0 font-mono text-[10px]" style={{ color: 'var(--accent-text)' }}>
                  changes
                </span>
              )}
            </li>
          );
        })}
        {awaitingDecision.length === 0 && (
          <li className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Nothing is waiting on a decision, so moving this changes nothing you can see right now.
          </li>
        )}
      </ul>

      {willChange && (
        <p className="mt-2 text-[11px]" style={{ color: 'var(--state-awaiting)' }}>
          Saving would flag {flaggedNow.length} of {awaitingDecision.length} waiting drafts, up from{' '}
          {flaggedCommitted.length}. Flagged items sort to the top of the queue with the reason
          named.
        </p>
      )}
    </Section>
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
    <Section title={title} caption={caption}>
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
            <span className="text-[13px] font-medium">Every post is reviewed by a person</span>
            <span className="ml-auto">
              <Locked reason="The v1 invariant. Not a condition, so it has no toggle — it is the phase the client is in, and leaving it is what ends v1." />
            </span>
          </li>
        )}

        {rows.map((row) => (
          <li key={row.trigger} className="flex flex-wrap items-center gap-2">
            <span className="text-[13px]">{row.trigger.replace(/_/g, ' ')}</span>
            <Badge tone={row.tier === 'stakeholder' ? 'blocked' : 'neutral'} mono>
              {row.tier === 'stakeholder' ? 'to the owner' : 'to you'}
            </Badge>

            <span className="ml-auto flex items-center gap-2">
              {row.is_fixed ? (
                <Locked
                  reason={
                    row.tier === 'stakeholder'
                      ? 'Owner-tier. A false negative here is not recoverable.'
                      : 'A guardrail failure always blocks. Making this optional would make the guardrail advisory.'
                  }
                />
              ) : (
                <label className="flex cursor-pointer items-center gap-1.5 text-[12px]">
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
                        return `${row.trigger.replace(/_/g, ' ')} ${!row.enabled ? 'enabled' : 'disabled'} · recorded as a new settings version`;
                      })
                    }
                  />
                  <span style={{ color: 'var(--text-muted)' }}>
                    {row.enabled ? 'on' : 'off'}
                  </span>
                </label>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Section>
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
    { layer: 'L1', label: 'input · on fetched sources, before any model reads them' },
    { layer: 'L2', label: 'generation · shape of the output, no model needed' },
    { layer: 'L3', label: 'output · is this safe to publish under the client’s name' },
    { layer: 'L4', label: 'action · the last checks before an irreversible step' },
  ];

  return (
    <Section
      title="Guardrail rules"
      caption="Orchestrator-owned steps, not tools the model can decline to call. Each returns pass, warn or fail: a warn routes to a human, a fail blocks. Passing evaluations are recorded too, which is why block rate has a denominator at all."
    >
      <div className="space-y-3">
        {layers.map(({ layer, label }) => {
          const inLayer = rules.filter((r) => r.layer === layer);
          if (inLayer.length === 0) return null;
          return (
            <div key={layer}>
              <div
                className="font-mono text-[10px] font-bold uppercase"
                style={{ color: 'var(--text-faint)', letterSpacing: '0.1em' }}
              >
                {layer} · {label}
              </div>
              <ul className="mt-1 space-y-1.5">
                {inLayer.map((rule) => (
                  <li key={rule.id}>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span
                        className="text-[13px] font-medium"
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
                          <label className="flex cursor-pointer items-center gap-1.5 text-[12px]">
                            <input
                              type="checkbox"
                              checked={rule.is_enabled}
                              disabled={busy !== null}
                              onChange={() =>
                                void onWrite(`rule:${rule.id}`, async () => {
                                  await toggleGuardrail(rule.id, !rule.is_enabled);
                                  return rule.is_enabled
                                    ? `“${rule.display_name}” switched off · the dashboard will mark the date rather than alarming on the drop`
                                    : `“${rule.display_name}” switched back on`;
                                })
                              }
                            />
                            <span style={{ color: 'var(--text-muted)' }}>
                              {rule.is_enabled ? 'on' : 'off'}
                            </span>
                          </label>
                        )}
                      </span>
                    </div>

                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {rule.description}
                    </p>

                    {/*
                      The disabled-from marker, which is the reason `disabled_at` exists beside
                      `is_enabled`. A rule's block rate falling to zero has two causes — the check
                      broke, or somebody switched it off — and the dashboard cannot tell them apart
                      without this date.
                    */}
                    {!rule.is_enabled && rule.disabled_at !== null && (
                      <p className="text-[11px]" style={{ color: 'var(--state-parked)' }}>
                        Off since {formatDateTime(rule.disabled_at)}. Its block rate reads zero from
                        that date because it stopped running, not because it stopped catching
                        anything.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Section>
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
    <Section
      title="Auto-approve"
      caption="Off for the whole of v1, and this is the screen where that is a visible decision rather than a missing feature."
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">Publish without per-item review</span>
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
          onClick={() =>
            void onWrite('auto_approve', async () => {
              await updateSettings({ kind: 'auto_approve', value: true });
              return 'Auto-approve enabled';
            })
          }
          className="rounded border px-2.5 py-1 text-[12px] disabled:opacity-40"
          style={{ borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }}
        >
          Try to turn it on
        </button>
        <span className="ml-auto font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
          {met} of {auto.prereqs.length} client prerequisites met
        </span>
      </div>

      <p className="mt-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
        {auto.lock_reason}
      </p>

      {/*
        The list is the point. A greyed toggle says "no"; a greyed toggle above six named
        prerequisites, four of them unmet, says what would have to become true — which is a product
        answering the question rather than refusing it.
      */}
      <ul className="mt-2 space-y-1 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
        {auto.prereqs.map((prereq) => (
          <li key={prereq.key} className="flex items-baseline gap-2 text-[12px]">
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
      <p className="mt-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
        Four further conditions are per-draft rather than client-level — score above threshold, all
        guardrails passing, the run not degraded, and the pillar not set to always review — so they
        are checked on each draft and are not shown here.
      </p>
    </Section>
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
      caption="A weekly job compares what the agent wrote against what you shipped. A kind of edit recurring three times in the last twenty decisions becomes a suggestion, which stays editable until you activate it. Capped at fifteen active."
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
                <span className="text-[13px]">{rule.text}</span>
                <span className="ml-auto font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
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
                  <summary
                    className="cursor-pointer font-mono text-[10px] font-bold uppercase"
                    style={{ color: 'var(--text-faint)', letterSpacing: '0.1em' }}
                  >
                    {backing.length} edits behind this · {rule.evidence_tag.replace(/_/g, ' ')}
                  </summary>
                  <ul className="mt-1 space-y-1">
                    {backing.map((version) => (
                      <li
                        key={version.id}
                        className="rounded px-2 py-1 text-[12px]"
                        style={{ background: 'var(--surface-sunk)' }}
                      >
                        <span
                          className="font-mono text-[10px]"
                          style={{ color: 'var(--text-faint)' }}
                        >
                          {version.id} · {formatRelative(version.created_at)}
                        </span>
                        <p className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {version.text.split('\n')[0].slice(0, 120)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  Backing edits predate the retained history, so they are not shown.
                </p>
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
    <Section
      title="Change history"
      caption="Every change is a versioned event with a per-key diff, and every draft records the version it ran under. That is what makes edit rate before and after a change comparable — and it is the x-axis of the drill-down on the metrics screen."
    >
      <ul className="space-y-2">
        {versions.map((version, index) => (
          <li key={version.version_id}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[11px]" style={{ color: 'var(--text-faint)' }}>
                {version.version_id}
              </span>
              {index === 0 && (
                <Badge tone="approved" mono>
                  current
                </Badge>
              )}
              <span className="text-[13px]">{version.change_summary}</span>
              <span className="ml-auto font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
                {formatRelative(version.changed_at)}
              </span>
            </div>
            {/* The per-key diff, which is what makes a version reconstructible. A bare version
                integer could not answer "what did version 3 say", so the comparison it exists to
                serve would be uncomputable. */}
            {version.diff.length > 0 && (
              <ul className="mt-0.5 space-y-0.5">
                {version.diff.map((entry) => (
                  <li
                    key={entry.key}
                    className="font-mono text-[10px]"
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

      <p className="mt-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
        <Link href="/metrics" style={{ color: 'var(--accent-text)' }}>
          Edit rate by settings version
        </Link>{' '}
        on the metrics screen splits decisions into cohorts either side of each change.
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
 */
function RefusalPanel({ reason, onDismiss }: { reason: string; onDismiss: () => void }) {
  return (
    <div
      className="rounded border px-3 py-2.5"
      style={{ borderColor: 'var(--state-parked)', background: 'var(--state-parked-bg)' }}
    >
      <p className="font-mono text-[10px] font-bold uppercase" style={{ color: 'var(--state-parked)', letterSpacing: '0.1em' }}>
        fixed control
      </p>
      <p className="mt-0.5 text-[13px]">{reason}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 rounded border px-2.5 py-1 text-[13px]"
        style={{ borderColor: 'var(--border-strong)' }}
      >
        Understood
      </button>
    </div>
  );
}

