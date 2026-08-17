'use client';

/**
 * FAILURE DRAWER — a demo affordance, and it says so on itself.
 *
 * D-020. The brief requires an annotated failure path on the Miro board; making the same paths
 * playable in the running product demonstrates the thinking in a form a reviewer can test rather
 * than read. It is nearly free architecturally, because `agentClient.ts` has to be able to fail
 * deliberately anyway — that is what makes the error states honest.
 *
 * WHY THERE IS A DEBUG PANEL IN THE PRODUCT, which is a fair question to be asked. There is not,
 * in production. The equivalents there are a staging environment, fault injection in CI, and a
 * replay tool for operators — none of which a frontend-only prototype can show. Exposing the
 * switches was the only way to make the recovery paths observable inside the brief's constraints,
 * and the panel labels itself so it cannot be mistaken for a product feature.
 *
 * Built on the browser's own `<dialog>` (D-040): focus trapping, Escape to close, the rest of the
 * page inert, and top-layer rendering all come free and correct. D-025 declined the component
 * library that would have handled those, so using the platform's own element is how that cost is
 * paid back rather than argued away.
 */

import { useEffect, useRef, useState } from 'react';
import { isFailureActive, setFailure } from '@/lib/agentClient';

type Switch = {
  id: 'tool_failure' | 'next_read_fails';
  label: string;
  effect: string;
};

const SWITCHES: Switch[] = [
  {
    id: 'tool_failure',
    label: 'Next run hits a failing source',
    effect:
      'Run now streams the tool-failure variant instead: three attempts with jittered backoff, ' +
      'then the run parks and the hourly sweep picks it up.',
  },
  {
    id: 'next_read_fails',
    label: 'Next read fails',
    effect:
      'The next call to the console API throws `unavailable`, so you see the error state a ' +
      'transient runtime fault actually produces.',
  },
];

export function FailureDrawer() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  /** Mirrors the client's switch set so the checkboxes reflect real state rather than their own.
   *  The client is the source of truth; this is a view of it. */
  const [armed, setArmed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const toggle = (id: Switch['id']) => {
    const next = !isFailureActive(id);
    setFailure(id, next);
    setArmed((current) => ({ ...current, [id]: next }));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border px-2.5 py-1 font-mono text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
      >
        break something
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        aria-labelledby="failure-drawer-title"
        // `m-auto` is doing real work: a native <dialog> centres itself via `margin: auto`, and
        // Tailwind's preflight resets margin to 0 on every element — so the platform behaviour is
        // silently lost and the modal pins to the top-left corner. Caught by opening it.
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border p-0 backdrop:bg-black/50"
        style={{ borderColor: 'var(--border-strong)', background: 'var(--surface)', color: 'var(--text)' }}
      >
        <div className="space-y-3 p-4">
          <div>
            <h2 id="failure-drawer-title" className="text-sm font-semibold">
              Break something on purpose
            </h2>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              A demo control, not a product feature. In production the equivalents are a staging
              environment, fault injection in CI, and a replay tool.
            </p>
          </div>

          <ul className="space-y-2">
            {SWITCHES.map((item) => (
              <li key={item.id}>
                <label
                  className="flex cursor-pointer items-start gap-2 rounded border p-2"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <input
                    type="checkbox"
                    checked={armed[item.id] ?? false}
                    onChange={() => toggle(item.id)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-[13px] font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-[13px] text-[var(--text-muted)]">
                      {item.effect}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border px-2.5 py-1 text-sm"
              style={{ borderColor: 'var(--border-strong)' }}
            >
              Close
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
