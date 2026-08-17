/**
 * CHECKS — assertions that run outside the browser.
 *
 *     npm run check
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS AND WHY IT IS NOT A TEST FRAMEWORK
 *
 * There are two claims in this project that are only worth making if something enforces them.
 *
 *   The anchor is a Thursday, and the weekday is load-bearing (D-030 amendment 1). That invariant
 *   is asserted in a comment in three files. A comment does not hold, and the failure it guards
 *   against is silent — nothing throws, the dates just stop making sense.
 *
 *   The state transitions are "a state machine, directly testable without rendering anything"
 *   (D-026). `TODO.md` flagged that as either-prove-it-or-drop-the-sentence. Transition
 *   assertions arrive here when `lib/world.ts` does, and fixture referential integrity when the
 *   fixtures do.
 *
 * WHY NO VITEST OR JEST. Adding a test runner means a dependency, a config file, a watcher and a
 * vocabulary, in a repository whose stated rule is that nothing gets installed that cannot be
 * explained (D-022). Node has run TypeScript natively since v22.6, so this file is executed
 * directly with no build step and no framework. It is a script that exits non-zero.
 *
 * The honest limit, stated rather than implied: this is not a test suite. It has no coverage
 * measurement, no watch mode and no isolation between cases. It exists to hold the handful of
 * invariants whose violation would be invisible, and it should not grow into a framework by
 * accident — at that point the trade flips and a real runner is the right answer.
 *
 * WHY THE IMPORTS ARE RELATIVE. Node's type-stripping does not read `tsconfig.json`, so the `@/*`
 * alias that works everywhere else in the app is unavailable here. Relative paths, deliberately.
 */

import {
  CLIENT_TIMEZONE,
  computeAnchorIso,
  wallClockIn,
} from '../lib/anchor.ts';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: string): void {
  checks++;
  if (condition) return;
  failures++;
  console.error(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/* ==============================================================================================
 * THE ANCHOR
 * ============================================================================================*/

section('Anchor invariants');

/**
 * Build instants chosen to hit every branch and both daylight-saving transitions in the client's
 * timezone. The DST cases matter because the anchor is a *local* wall-clock time, and the offset
 * between local time and UTC is not constant — an implementation that assumed it was would pass
 * every other case here and fail twice a year.
 */
const BUILD_INSTANTS: ReadonlyArray<readonly [string, string]> = [
  ['2026-08-17T08:00:00Z', 'a Monday'],
  ['2026-08-20T07:30:00Z', 'a Thursday before the anchor hour — must go back a full week'],
  ['2026-08-20T08:00:00Z', 'a Thursday exactly on the anchor hour — must stay today'],
  ['2026-08-20T14:00:00Z', 'a Thursday afternoon'],
  ['2026-08-22T23:00:00Z', 'late on a Saturday'],
  ['2026-03-29T10:00:00Z', 'the day EU clocks go forward'],
  ['2026-03-26T09:05:00Z', 'the Thursday before the spring transition'],
  ['2026-10-25T10:00:00Z', 'the day EU clocks go back'],
  ['2026-01-01T00:00:00Z', 'across a year boundary'],
  ['2027-01-02T12:00:00Z', 'the Saturday after new year'],
];

for (const [iso, description] of BUILD_INSTANTS) {
  const buildAt = new Date(iso);
  const anchor = new Date(computeAnchorIso(buildAt));
  const local = wallClockIn(CLIENT_TIMEZONE, anchor);
  const label = `${description} (${iso})`;

  check(`${label} — lands on a Thursday`, local.weekday === 4, `got weekday ${local.weekday}`);

  check(
    `${label} — lands at 10:00 client-local`,
    local.hour === 10 && local.minute === 0,
    `got ${local.hour}:${String(local.minute).padStart(2, '0')}`,
  );

  check(
    `${label} — is not in the future relative to the build`,
    anchor.getTime() <= buildAt.getTime(),
    `anchor ${anchor.toISOString()} is after build ${iso}`,
  );

  check(
    `${label} — is within seven days of the build`,
    buildAt.getTime() - anchor.getTime() <= 7 * 86_400_000,
    `gap is ${((buildAt.getTime() - anchor.getTime()) / 86_400_000).toFixed(2)} days`,
  );
}

/**
 * The committed fallback in `lib/time.ts` must obey the same invariant as the computed value.
 * A fallback on the wrong weekday would reproduce precisely the defect the Thursday rule exists
 * to prevent, in the one situation where nobody is watching for it.
 *
 * Read as text rather than imported, because importing `lib/time.ts` would pull in
 * `process.env.ANCHOR_ISO` and this check is specifically about the value used when that is
 * absent.
 */
section('Committed fallback anchor');

const timeSource = await import('node:fs/promises').then((fs) =>
  fs.readFile(new URL('../lib/time.ts', import.meta.url), 'utf8'),
);
const fallbackMatch = timeSource.match(/FALLBACK_ANCHOR_ISO = '([^']+)'/);

check('fallback constant is present in lib/time.ts', fallbackMatch !== null);

if (fallbackMatch) {
  const fallbackLocal = wallClockIn(CLIENT_TIMEZONE, new Date(fallbackMatch[1]));
  check(
    `fallback ${fallbackMatch[1]} is a Thursday`,
    fallbackLocal.weekday === 4,
    `got weekday ${fallbackLocal.weekday}`,
  );
  check(
    `fallback ${fallbackMatch[1]} is at 10:00 client-local`,
    fallbackLocal.hour === 10 && fallbackLocal.minute === 0,
    `got ${fallbackLocal.hour}:${String(fallbackLocal.minute).padStart(2, '0')}`,
  );
}

/* ==============================================================================================
 * TODO as the build proceeds
 *   - lib/world.ts transitions (Step 5)
 *   - fixture referential integrity (Step 10)
 * ============================================================================================*/

console.log(`\n${checks - failures}/${checks} checks passed.`);

if (failures > 0) {
  console.error(`${failures} FAILED\n`);
  process.exit(1);
}
