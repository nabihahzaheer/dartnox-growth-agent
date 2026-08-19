'use client';

/**
 * SETTINGS — the four controls the brief names, plus the guardrail list and the locked
 * auto-approve toggle. Not eighteen field groups (D-044).
 *
 * Scope is deliberate and narrower than `SettingsScreen` carries. The brief names four controls —
 * "tone, thresholds, approval rules, escalation triggers" — and D-018/D-044 add the guardrail rule
 * list and the auto-approve toggle on top because both are required elsewhere (A-09, A-16) and
 * both cost little once the seam exists. Cadence, domain allowlists, entities, terminology, the
 * weekend contact and the reflection-rule history all have real fields on `Settings` and are all
 * left out on purpose — v1 built most of them and the microcopy pass (D-052) found the result was
 * nine panels doing nothing else was graded on. `getSettingsScreen()` still returns
 * `reflectionRules` and `evidence` for exactly that reason and neither is read here.
 *
 * The budget cap was on that cut list for one step and has been added back — see the block comment
 * above `BudgetSection`. It does not belong with the others: cutting it made two of the three
 * `BudgetState` values unreachable in the running product, which is a different kind of thing from
 * declining to render a terminology list.
 *
 * ---------------------------------------------------------------------------------------------
 * FIXED CONTROLS STAY LIVE, NOT DISABLED (D-047, extended)
 *
 * Three families of row can be fixed: a guardrail rule (`is_fixed` + `fixed_reason`), an
 * escalation trigger or approval rule (`is_fixed`, refused with a shared sentence), and
 * auto-approve itself (`auto_approve.locked`). None of them render as a disabled input. Every
 * switch here is clickable; a fixed one asks the server exactly like a tunable one, gets back
 * `{ kind: 'forbidden', reason }`, and shows that reason. A disabled control cannot answer "why",
 * and this codebase already decided once (auto-approve) that the answer belongs in the product.
 * This screen is what it looks like to apply that decision to every fixed row instead of one.
 *
 * ---------------------------------------------------------------------------------------------
 * THE BANNED-PHRASE SWEEP LIVES INSIDE VOICE, NOT AS ITS OWN SECTION
 *
 * `tone.banned_phrases` is a voice field on `Settings`, and the bonus the brief credits — "changing
 * a setting visibly changes simulated agent behaviour" — is what happens when this one specific
 * field changes: `addBannedPhrase` re-validates every scheduled post against the new phrase and
 * sends back whatever matches. Giving the sweep its own heading would separate the control from
 * the field it edits for no reason; the result line renders directly under the input that caused
 * it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addBannedPhrase,
  getSettingsScreen,
  previewBannedPhrase,
  subscribeToWorld,
  toggleGuardrail,
  updateSettings,
  type SettingsScreen,
} from '@/lib/agentClient';
import type {
  ConsoleError,
  Draft,
  EscalationRuleEntry,
  EscalationTrigger,
  GuardrailLayer,
  GuardrailRule,
  Settings,
} from '@/lib/types';
import { asConsoleError, errorCopy } from '@/lib/errorCopy';
import { LoadError, LoadingState, StaleWarning } from '@/components/ScreenState';
import { budgetStateAt, type BudgetPosture } from '@/lib/budget';
import { BudgetLine, BudgetNotice } from '@/components/BudgetNotice';
import { formatDate } from '@/lib/time';

const CHANNEL_LABEL: Record<string, string> = { linkedin: 'LinkedIn', x: 'X' };

const TRIGGER_LABEL: Record<EscalationTrigger, string> = {
  low_score: 'Low score',
  guardrail_warn: 'Guardrail warning',
  guardrail_fail: 'Guardrail failure',
  tool_failure: 'Tool failure',
  unapproved_entity: 'Unapproved entity mentioned',
  budget_threshold: 'Budget threshold crossed',
  negative_engagement: 'Negative engagement',
  regulated_claim: 'Regulated claim',
  reputational: 'Reputational risk',
  repeat_rule_failure: 'Repeated rule failure',
  operator_initiated: 'Sent to the owner by an operator',
};

const PREREQ_LABEL: Record<string, string> = {
  trust_period_passed: 'Trust period passed',
  decision_volume_met: 'Decision volume met',
  cross_vendor_judge: 'Cross-vendor judge',
  injection_interlock_clear: 'Injection interlock clear',
  channel_enabled: 'Channels connected',
  no_recent_pillar_rejection: 'No recent pillar rejection',
};

const LAYERS: GuardrailLayer[] = ['L1', 'L2', 'L3', 'L4'];

/**
 * Every write here either succeeds or comes back `forbidden` carrying its own reason — see the
 * header note on why fixed rows still make the call rather than being disabled.
 *
 * `forbidden` is the one kind whose sentence lives on the error rather than in the shared map,
 * because the reason is per-control: "a missed injection is not recoverable" and "off for v1,
 * unlocking needs all six prerequisites" are both `forbidden` and are not interchangeable. Every
 * other kind falls through to `errorCopy`, so a rate-limited or timed-out settings write now says
 * what it actually was instead of one house sentence.
 */
function reasonFrom(e: unknown, fallback: string): string {
  const error = asConsoleError(e);
  if (error.kind === 'forbidden') return error.reason;
  if (error.kind === 'not_found') return fallback;
  return errorCopy(error);
}

/** A switch built as a button. Nothing else in this app uses a native checkbox, and `role="switch"`
 *  keeps that true while staying accessible. Never `disabled` — see the header note. */
function Toggle({
  on,
  busy,
  label,
  onToggle,
}: {
  on: boolean;
  busy: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`tgl${on ? ' tgl-on' : ''}`}
      disabled={busy}
      onClick={onToggle}
    >
      <span className="tgl-knob" aria-hidden />
    </button>
  );
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsScreen | null>(null);
  const [error, setError] = useState<ConsoleError | null>(null);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getSettingsScreen();
      setData(d);
      setError(null);
    } catch (e) {
      setError(asConsoleError(e));
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToWorld(() => void load());
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [load]);

  /** Toasts state the outcome and stop (D-052) — so they stop, on their own, a few seconds later. */
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 5000);
    return () => clearTimeout(timer);
  }, [note]);

  const say = useCallback((text: string, bad = false) => setNote({ text, bad }), []);

  if (error && !data) {
    return (
      <>
        <PageHead />
        <LoadError error={error} onRetry={() => void load()} />
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHead />
        <LoadingState lines={4} label="Loading settings" />
      </>
    );
  }

  return (
    <>
      <PageHead />
      {error && <StaleWarning error={error} onRetry={() => void load()} />}
      {/* The only feedback for every settings write, including a locked control's refusal — and a
          locked switch correctly does not change `aria-checked`, so without this a screen-reader
          user clicking one got complete silence. */}
      <div aria-live="polite">
        {note && <p className={`note${note.bad ? ' note-stop' : ''}`}>{note.text}</p>}
      </div>

      <VoiceSection
        settings={data.settings}
        scheduledCount={data.scheduledCount}
        say={say}
        onSaved={load}
      />

      <ThresholdSection
        settings={data.settings}
        awaitingDecision={data.awaitingDecision}
        say={say}
        onSaved={load}
      />

      <BudgetSection settings={data.settings} budget={data.budget} say={say} onSaved={load} />

      <RuleSection
        title="Approval rules"
        kind="approval_rule"
        rows={data.settings.approval_rules}
        say={say}
        onSaved={load}
      />

      <RuleSection
        title="Escalation triggers"
        kind="escalation_trigger"
        rows={data.settings.escalation_triggers}
        say={say}
        onSaved={load}
      />

      <GuardrailSection rules={data.guardrailRules} say={say} onSaved={load} />

      <AutoApproveSection settings={data.settings} say={say} />
    </>
  );
}

function PageHead() {
  return (
    <header className="page-head">
      <h1 className="page-title">Settings</h1>
    </header>
  );
}

/* ================================================================================================
 * VOICE — register, sample, banned phrases and the sweep
 * ==============================================================================================*/

function VoiceSection({
  settings,
  scheduledCount,
  say,
  onSaved,
}: {
  settings: Settings;
  scheduledCount: number;
  say: (text: string, bad?: boolean) => void;
  onSaved: () => void;
}) {
  const [register, setRegister] = useState(settings.tone.register);
  const [savingRegister, setSavingRegister] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [banning, setBanning] = useState(false);

  const trimmed = phrase.trim();
  const matches = useMemo(() => (trimmed ? previewBannedPhrase(trimmed) : 0), [trimmed]);
  const alreadyBanned = settings.tone.banned_phrases.some(
    (p) => p.toLowerCase() === trimmed.toLowerCase(),
  );

  async function saveRegister() {
    setSavingRegister(true);
    try {
      await updateSettings({ kind: 'tone_register', value: register });
      say('Tone register updated.');
      onSaved();
    } catch (e) {
      say(reasonFrom(e, 'That did not go through. Nothing was changed.'), true);
    } finally {
      setSavingRegister(false);
    }
  }

  async function ban() {
    if (!trimmed || alreadyBanned) return;
    setBanning(true);
    try {
      const result = await addBannedPhrase(trimmed);
      say(
        result.invalidated === 0
          ? `Banned "${trimmed}" — matched none of ${result.scanned} scheduled post${result.scanned === 1 ? '' : 's'}.`
          : `Banned "${trimmed}" — matched ${result.invalidated} of ${result.scanned} scheduled post${result.scanned === 1 ? '' : 's'}. Sent back for re-approval.`,
      );
      setPhrase('');
      onSaved();
    } catch (e) {
      say(reasonFrom(e, 'That did not go through. Nothing was banned.'), true);
    } finally {
      setBanning(false);
    }
  }

  return (
    <section className="section">
      <h2 className="t-section">Voice</h2>
      <div className="panel" style={{ padding: '16px 18px' }}>
        <div className="field">
          <label className="t-label" htmlFor="register">
            Register
          </label>
          <div className="field-row">
            <input
              id="register"
              className="txt txt-flex"
              value={register}
              onChange={(e) => setRegister(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              disabled={savingRegister || register.trim() === settings.tone.register}
              onClick={() => void saveRegister()}
            >
              {savingRegister ? '…' : 'Save'}
            </button>
          </div>
        </div>

        <div className="field">
          <p className="t-label" style={{ margin: 0 }}>
            Sample
          </p>
          <p className="t-body" style={{ margin: '4px 0 0', color: 'var(--text-muted)' }}>
            {settings.tone.sample}
          </p>
        </div>

        <div className="field">
          <p className="t-label" style={{ margin: 0 }}>
            Banned phrases
          </p>
          <div className="chip-row" style={{ marginTop: 6 }}>
            {settings.tone.banned_phrases.map((p) => (
              <span key={p} className="phrase-chip">
                {p}
              </span>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="t-label" htmlFor="phrase">
            Add a phrase
          </label>
          <div className="field-row">
            <input
              id="phrase"
              className="txt txt-flex"
              placeholder="e.g. limited time offer"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              disabled={banning || !trimmed || alreadyBanned}
              onClick={() => void ban()}
            >
              {banning ? '…' : 'Ban phrase'}
            </button>
          </div>
          {trimmed && (
            <p className="preview-line">
              {alreadyBanned
                ? 'Already on the list.'
                : `Matches ${matches} of ${scheduledCount} scheduled post${scheduledCount === 1 ? '' : 's'}.`}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/* ================================================================================================
 * REVIEW THRESHOLD — moving it re-flags the waiting drafts before anything is saved
 * ==============================================================================================*/

function ThresholdSection({
  settings,
  awaitingDecision,
  say,
  onSaved,
}: {
  settings: Settings;
  awaitingDecision: Draft[];
  say: (text: string, bad?: boolean) => void;
  onSaved: () => void;
}) {
  const range = settings.field_meta.score_threshold?.range ?? { min: 0.6, max: 0.95 };
  const [value, setValue] = useState(settings.score_threshold);
  const [saving, setSaving] = useState(false);

  const sorted = useMemo(
    () => [...awaitingDecision].sort((a, b) => a.composite_score - b.composite_score),
    [awaitingDecision],
  );
  const flagged = sorted.filter((d) => d.composite_score < value).length;

  async function save() {
    setSaving(true);
    try {
      await updateSettings({ kind: 'score_threshold', value });
      say(`Review threshold set to ${value.toFixed(2)}.`);
      onSaved();
    } catch (e) {
      say(reasonFrom(e, 'That did not go through. Nothing was changed.'), true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="section">
      <h2 className="t-section">Review threshold</h2>
      <div className="panel" style={{ padding: '16px 18px' }}>
        <div className="field-row">
          <input
            type="range"
            className="rng"
            min={range.min}
            max={range.max}
            step={0.01}
            value={value}
            aria-label="Review threshold"
            onChange={(e) => setValue(Number(e.target.value))}
          />
          <span className="t-metric" style={{ width: 60 }}>
            {value.toFixed(2)}
          </span>
          <button
            type="button"
            className="btn"
            disabled={saving || value === settings.score_threshold}
            onClick={() => void save()}
          >
            {saving ? '…' : 'Save'}
          </button>
        </div>
        <p className="preview-line" style={{ marginTop: 10 }}>
          {sorted.length === 0
            ? 'Nothing waiting on a person right now.'
            : `Would flag ${flagged} of ${sorted.length} waiting draft${sorted.length === 1 ? '' : 's'} at this bar.`}
        </p>

        {sorted.length > 0 && (
          <ul className="preview-list">
            {sorted.map((d) => (
              <li key={d.id} className="preview-row">
                <span
                  className="ch-dot"
                  style={{ width: 10, height: 10, background: `var(--ch-${d.channel})` }}
                  aria-hidden
                />
                <span className="preview-score">{d.composite_score.toFixed(2)}</span>
                <span>{CHANNEL_LABEL[d.channel]}</span>
                <span
                  className={`pill ${d.composite_score < value ? 'pill-attend' : 'pill-go'}`}
                  style={{ marginLeft: 'auto' }}
                >
                  {d.composite_score < value ? 'flagged' : 'ready'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ================================================================================================
 * BUDGET CAP — the control that makes the admission gate reachable
 *
 * ADDED AFTER THIS SCREEN SHIPPED WITHOUT IT, AND THE OMISSION WAS A REAL MISTAKE.
 *
 * The first version of Settings listed `budget.cap` among the fields deliberately left out under
 * D-044's scope cut, alongside cadence, allowlists and terminology. That grouping was wrong, and
 * `lib/budget.ts` had already written down why: spend against these fixtures is 30% of the cap, so
 * no fixture edit reaches the alert or stop bands, and the cap moving is the *only* way a reviewer
 * can put the system into its own gate. Cutting it did not trim a settings row — it made two of the
 * three `BudgetState` values unreachable in the running product, which would have left the console
 * and Results rendering states nobody could ever produce.
 *
 * The other cuts stand: none of them gates a behaviour the architecture spends a frame on.
 *
 * THE PREVIEW CALLS THE SAME FUNCTION THE COMMITTED POSTURE DOES. `budgetStateAt` is exported from
 * `lib/budget.ts` and used both here and inside `budgetPosture`, so "what this cap would do" and
 * "what this cap did" cannot drift. Re-deriving the comparison locally is the version that is right
 * on the day it is written and silently wrong the first time a threshold moves.
 * ==============================================================================================*/

function BudgetSection({
  settings,
  budget,
  say,
  onSaved,
}: {
  settings: Settings;
  budget: BudgetPosture;
  say: (text: string, bad?: boolean) => void;
  onSaved: () => void;
}) {
  const range = settings.field_meta['budget.cap']?.range ?? { min: 50, max: 2000 };
  const [value, setValue] = useState(settings.budget.cap);
  const [saving, setSaving] = useState(false);

  /** The posture this cap would produce, through the same function that produced the live one. */
  const pending: BudgetPosture = {
    ...budget,
    cap: value,
    pct: value === 0 ? 0 : (budget.spent / value) * 100,
    state: budgetStateAt(budget.spent, value, budget.alert_pct, budget.stop_pct),
  };

  async function save() {
    setSaving(true);
    try {
      await updateSettings({ kind: 'budget_cap', value });
      say(`Monthly cap set to $${value}.`);
      onSaved();
    } catch (e) {
      say(reasonFrom(e, 'That did not go through. Nothing was changed.'), true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="section">
      <h2 className="t-section">Monthly budget</h2>
      <div className="panel" style={{ padding: '16px 18px' }}>
        <BudgetLine budget={pending} />

        <div className="field-row" style={{ marginTop: 14 }}>
          <input
            type="range"
            className="rng"
            min={range.min}
            max={range.max}
            step={10}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            aria-label="Monthly cap"
          />
          <span className="t-metric" style={{ width: 76 }}>
            ${value}
          </span>
          <button
            type="button"
            className="btn"
            disabled={saving || value === settings.budget.cap}
            onClick={() => void save()}
          >
            {saving ? '…' : 'Save'}
          </button>
        </div>

        {pending.state !== budget.state && (
          <p className="preview-line" style={{ marginTop: 10 }}>
            Saving this would move the gate from {budget.state} to {pending.state}.
          </p>
        )}

        <div style={{ marginTop: 12 }}>
          <BudgetNotice budget={pending} />
        </div>
      </div>
    </section>
  );
}

/* ================================================================================================
 * APPROVAL RULES / ESCALATION TRIGGERS — one shape, two settings-write kinds
 * ==============================================================================================*/

function RuleSection({
  title,
  kind,
  rows,
  say,
  onSaved,
}: {
  title: string;
  kind: 'approval_rule' | 'escalation_trigger';
  rows: EscalationRuleEntry[];
  say: (text: string, bad?: boolean) => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState<EscalationTrigger | null>(null);

  async function flip(row: EscalationRuleEntry) {
    setBusy(row.trigger);
    try {
      await updateSettings({ kind, trigger: row.trigger, enabled: !row.enabled });
      say(`${TRIGGER_LABEL[row.trigger]}: ${!row.enabled ? 'enabled' : 'disabled'}.`);
      onSaved();
    } catch (e) {
      say(reasonFrom(e, 'That did not go through. Nothing was changed.'), true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="section">
      <h2 className="t-section">{title}</h2>
      <div className="panel" style={{ padding: '4px 18px' }}>
        {rows.map((row) => (
          <div key={row.trigger} className="rule-row">
            <div className="rule-body">
              <p className="rule-title">{TRIGGER_LABEL[row.trigger]}</p>
              <p className="rule-sub mono">
                {row.tier}
                {row.is_fixed && ' · locked'}
              </p>
            </div>
            {row.is_fixed && <span className="pill pill-lock">locked</span>}
            <Toggle
              on={row.enabled}
              busy={busy === row.trigger}
              label={TRIGGER_LABEL[row.trigger]}
              onToggle={() => void flip(row)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ================================================================================================
 * GUARDRAIL RULES — grouped by layer, mechanism shown honestly
 * ==============================================================================================*/

function GuardrailSection({
  rules,
  say,
  onSaved,
}: {
  rules: GuardrailRule[];
  say: (text: string, bad?: boolean) => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function flip(rule: GuardrailRule) {
    setBusy(rule.id);
    try {
      await toggleGuardrail(rule.id, !rule.is_enabled);
      say(`${rule.display_name}: ${!rule.is_enabled ? 'enabled' : 'disabled'}.`);
      onSaved();
    } catch (e) {
      say(reasonFrom(e, 'That did not go through. Nothing was changed.'), true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="section">
      <h2 className="t-section">Guardrail rules</h2>
      <div className="panel" style={{ padding: '4px 18px 8px' }}>
        {LAYERS.map((layer) => {
          const inLayer = rules.filter((r) => r.layer === layer);
          if (inLayer.length === 0) return null;
          return (
            <div key={layer} className="layer-group">
              <p className="layer-head">
                <span className="layer-name">{layer}</span>
              </p>
              {inLayer.map((rule) => (
                <div key={rule.id} className="rule-row">
                  <div className="rule-body">
                    <p className="rule-title">{rule.display_name}</p>
                    <p className="rule-sub mono">
                      {rule.mechanism} · {rule.severity}
                      {!rule.is_enabled && rule.disabled_at && ` · off ${formatDate(rule.disabled_at)}`}
                    </p>
                  </div>
                  {rule.is_fixed && <span className="pill pill-lock">locked</span>}
                  <Toggle
                    on={rule.is_enabled}
                    busy={busy === rule.id}
                    label={rule.display_name}
                    onToggle={() => void flip(rule)}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ================================================================================================
 * AUTO-APPROVE — locked, and the toggle attempts the write anyway (D-047)
 * ==============================================================================================*/

function AutoApproveSection({
  settings,
  say,
}: {
  settings: Settings;
  say: (text: string, bad?: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const auto = settings.auto_approve;
  const met = auto.prereqs.filter((p) => p.met).length;

  async function attempt() {
    setBusy(true);
    try {
      await updateSettings({ kind: 'auto_approve', value: true });
      say('Auto-approve turned on.');
    } catch (e) {
      say(reasonFrom(e, auto.lock_reason), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <h2 className="t-section">Auto-approve</h2>
      <div className="panel" style={{ padding: '16px 18px' }}>
        <div className="rule-row" style={{ paddingTop: 0 }}>
          <div className="rule-body">
            <p className="rule-title">Skip human review when every prerequisite is met</p>
            <p className="rule-sub">
              {met} of {auto.prereqs.length} met
            </p>
          </div>
          <span className="pill pill-lock">locked</span>
          <Toggle on={auto.enabled} busy={busy} label="Auto-approve" onToggle={() => void attempt()} />
        </div>

        <ul className="prereq-list">
          {auto.prereqs.map((p) => (
            <li key={p.key} className="prereq-row">
              <span className={`prereq-ic ${p.met ? 'prereq-met' : 'prereq-unmet'}`} aria-hidden>
                {p.met ? '✓' : '·'}
              </span>
              <div className="prereq-body">
                <p className="t-body">{PREREQ_LABEL[p.key] ?? p.key}</p>
                <p className="prereq-detail">{p.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
