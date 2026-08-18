'use client';

/**
 * THE QUEUE — everything waiting on a person.
 *
 * The brief is specific about what this screen has to do: "approve / edit / reject flows that
 * actually update client-side state and visibly change what the agent does next." The second half
 * is the hard part, and it is what most of this file exists for. A queue whose buttons only remove
 * rows is the common failure and the brief calls it out by name.
 *
 * What each decision actually does, all of it visible without leaving the screen:
 *
 *   approve   the item leaves, a post is scheduled, and a publish run appears in the rail
 *   edit      a new version is written, and the approval binds to it rather than to what the
 *             agent wrote
 *   reject    the slot slips or drops, a redraft run is queued, and the reason is fed to the next
 *             drafting run — which then lists it as an input it consumed
 *   escalate  the draft is held and an escalation is raised against no rule
 *
 * IT HOLDS A UNION, NOT A LIST OF DRAFTS (D-033). A run quarantined at the input guardrail halts
 * before a draft exists, and a parked run needs a human despite producing nothing. Both belong in
 * a work list. Typing this as `Draft[]` would have silently dropped them.
 *
 * THE FOUR DECISIONS ARE NOT WRITTEN HERE ANY MORE. They live in `components/DecisionControls.tsx`,
 * which holds the only `submitReview` call site in the application, and the console renders the
 * same component at a halted run's interrupt. This screen keeps what is genuinely its own: the
 * work list, the selection, the keyboard, and the toast. Everything above still happens — through
 * one implementation instead of the one that used to live in this file.
 *
 * WHAT THE QUEUE IS STILL FOR, now that a decision can be taken from the console: a week arrives
 * in one batch on Wednesday, and clearing eight items in one sitting is a different job from
 * deciding on the run you happen to be watching. That is why `j` / `k` exist.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getQueue, getSettings } from '@/lib/agentClient';
import type { ConsoleError, QueueItem, Settings } from '@/lib/types';
import { Rail } from '@/components/Rail';
import { QueueRow, draftOf, itemId } from '@/components/queue/QueueRow';
import { ErrorPanel, NotFound } from '@/components/ErrorState';
import { DecisionControls, type DecisionHandle } from '@/components/DecisionControls';
import { WeekView } from '@/components/queue/WeekView';

export default function QueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ConsoleError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** What just happened, so a decision is not a row silently vanishing. */
  const [lastAction, setLastAction] = useState<string | null>(null);

  /**
   * The selected row's decision surface, reached imperatively.
   *
   * `a` / `e` / `r` are bound on the window and act on whichever row is selected, and the buttons
   * they stand for now live inside `DecisionControls`. The ref is attached to the selected row
   * only, so this is always the right instance — and it is null on a parked-run row, which has no
   * draft to decide against and therefore renders no controls. That null *is* the guard: the verbs
   * skip an item the cursor can still reach.
   */
  const controls = useRef<DecisionHandle>(null);

  /**
   * List or week — the same work, seen two ways.
   *
   * Local state, not a route and not a query param: the calendar is a second reading of this
   * screen's data, not a place you navigate to, and a `?view=` param would put view switching in the
   * back button's history. Defaults to the list because the list is where decisions get made; the
   * week answers "what is going out on Thursday", which is a different question asked less often.
   */
  const [view, setView] = useState<'list' | 'week'>('list');

  /** The list column is a reading width; the week needs seven columns. One constant so the header
   *  bar and the body below it stay aligned to the same edge in both views. */
  const shell = view === 'week' ? 'max-w-6xl' : 'max-w-3xl';

  /**
   * When the current item was selected. A ref, not state: it is read at decision time and never
   * rendered, so making it state would cause a re-render for a value nothing displays.
   *
   * Not initialised with `Date.now()` either — calling that during render is impure, and React's
   * lint rule is right to reject it. It is set when the data lands and again on every selection.
   */
  const selectedAt = useRef(0);

  const select = useCallback((index: number) => {
    setSelected(index);
    // The rubber-stamp clock starts here rather than at page load. A-17 watches the share of
    // approvals decided in under fifteen seconds, because that is how human-in-the-loop actually
    // fails — and measuring from page load would make every decision look considered.
    selectedAt.current = Date.now();
  }, []);

  /**
   * One effect owns fetching, and `reload()` bumps a counter to re-run it.
   *
   * The obvious shape — a `load()` callback called from both the effect and the decision handler —
   * puts a `setState` before the first `await` in the effect body, which triggers a second render
   * pass immediately after the first. ESLint rejects it and is right to. An async IIFE whose first
   * statement is the fetch has nothing to flush.
   */
  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [queue, config] = await Promise.all([getQueue(), getSettings()]);
        if (cancelled) return;
        setItems(queue);
        setSettings(config);
        setError(null);
        // Clamp here, where the new length is known. The first version guessed at it in the
        // decision handler using the *old* length, which is off by one whenever a decision removes
        // the last row.
        setSelected((i) => Math.min(i, Math.max(0, queue.length - 1)));
        selectedAt.current = Date.now();
      } catch (e) {
        if (!cancelled) setError(e as ConsoleError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadNonce]);

  /* `const current = items[selected]` used to live here, so this screen could hand the selected
     item's draft to its own `submitReview` call and to the dialogs it mounted once at the bottom.
     Both went to `DecisionControls`, which each row builds for its own item — so the selection is
     now expressed by which row holds the keyboard ref, and nothing needs to resolve it here. */

  /** A decision landed. The message is the shared component's — it reads a rejection's real
   *  outcome out of the returned `WorldPatch` rather than predicting it. */
  const onDecided = useCallback(
    (message: string) => {
      setLastAction(message);
      reload();
    },
    [reload],
  );

  /**
   * Keyboard. Not required by the brief, kept because it is what designing for an operator
   * clearing forty drafts looks like rather than a demo user clicking once.
   *
   * Ignored while a dialog is open or focus is in a text field — otherwise typing a rejection note
   * containing the letter "a" would approve something.
   *
   * `dialog[open]` is the open-modal test now that the dialogs belong to `DecisionControls`. The
   * alternative was reporting each row's dialog state back up to this screen, which would have put
   * the state the extraction just removed straight back into this file. A native modal is the
   * platform's own record of "something is in front of the page", and the tag-name checks above
   * were never sufficient on their own: focus inside the reject dialog can sit on a button, and
   * `a` would have approved the item behind it.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'INPUT' ||
        document.querySelector('dialog[open]') !== null;
      if (typing) return;

      if (e.key === 'j') select(Math.min(selected + 1, items.length - 1));
      if (e.key === 'k') select(Math.max(selected - 1, 0));

      if (e.key === 'a') controls.current?.approve();
      if (e.key === 'r') controls.current?.openReject();
      if (e.key === 'e') controls.current?.openEdit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, selected, select]);

  return (
    <>
      <Rail />
      <main className="flex min-w-0 flex-1 flex-col">
        <div
          className="shrink-0 border-b px-4 py-2.5"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <div className={`mx-auto flex w-full ${shell} flex-wrap items-center gap-x-3 gap-y-1`}>
            <span className="t-title">Queue</span>
            <span className="t-label">
              {/* Three states. `loading ? … : count` claimed "0 waiting on you" on a failed
                  load — asserting an empty queue when the queue is simply unknown. */}
              {loading ? 'Loading…' : error ? 'could not load' : `${items.length} waiting on you`}
            </span>

            {/* Two real buttons with `aria-pressed`, not a tab set: nothing is being navigated to
                and no panel is being revealed, so the honest semantics are "this control is on". */}
            <div className="flex overflow-hidden rounded border" style={{ borderColor: 'var(--border-strong)' }}>
              {(['list', 'week'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  onClick={() => setView(option)}
                  className="t-body px-2 py-0.5 capitalize"
                  style={{
                    background: view === option ? 'var(--accent-soft)' : 'transparent',
                    color: view === option ? 'var(--accent-text)' : 'var(--text-muted)',
                  }}
                >
                  {option}
                </button>
              ))}
            </div>

            {/*
              The hint stays visible in both views. The key handler is mounted on the window
              regardless of which view is showing — that binding is contract and is not being
              touched — so hiding the strip on the week would leave `a` silently approving the
              selected item with nothing on screen saying so.
            */}
            <span className="t-meta ml-auto font-mono">
              j / k move · a approve · e edit · r reject
            </span>

          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={`mx-auto w-full ${shell} space-y-2 px-4 py-4`}>
            {/* Above the view switch, not inside the list: a decision taken by keyboard while the
                week is showing still has to report itself. */}
            {lastAction && (
              <p
                className="t-body rounded px-2.5 py-1.5 font-bold"
                style={{ background: 'var(--note-bg)', color: 'var(--note-ink)' }}
              >
                {lastAction}
              </p>
            )}

            {error && <ErrorPanel error={error} onRetry={reload} />}

            {view === 'week' && <WeekView />}

            {view === 'list' && loading && <LoadingRows />}

            {view === 'list' && !loading && items.length === 0 && !error && <NotFound
                title="Nothing waiting"
                detail="The next drafting batch runs Wednesday 06:00."
              />}

            {view === 'list' &&
              !loading &&
              items.map((item, index) => {
                const draft = draftOf(item);
                return (
                  <QueueRow
                    key={itemId(item)}
                    item={item}
                    threshold={settings?.score_threshold ?? 0.85}
                    selected={index === selected}
                    busy={busy === itemId(item)}
                    onSelect={() => select(index)}
                    controls={
                      /**
                       * Two of the three arms are decidable and one is not: a parked or
                       * quarantined run has no draft to decide against, and clearing it is a
                       * different action. `draftOf` is the one place that branch lives.
                       */
                      draft && settings ? (
                        <DecisionControls
                          /** Only the selected row gets the ref, so the window keybindings act on
                           *  the row the highlight is on. */
                          ref={index === selected ? controls : null}
                          draft={draft}
                          reasons={settings.rejection_reason_set}
                          openedAt={selectedAt}
                          subject={item.kind === 'post' ? 'returned_post' : 'draft'}
                          blocked={
                            item.kind === 'draft' && item.events.some((e) => e.result === 'fail')
                          }
                          onDecided={onDecided}
                          onError={setError}
                          onBusyChange={(writing) => setBusy(writing ? itemId(item) : null)}
                        />
                      ) : null
                    }
                  />
                );
              })}
          </div>
        </div>

        {/* The reject dialog and the inline editor used to be mounted here, once, for the selected
            item. They travelled with the buttons into `DecisionControls` — the two dialogs *are*
            two of the four decisions, and leaving them behind would have split one surface across
            two files again. */}
      </main>
    </>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading the queue">
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


