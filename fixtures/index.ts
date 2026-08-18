/**
 * THE FIXTURE SET — assembled once, and the only thing `agentClient.ts` imports.
 *
 * D-002's rule is that no React component ever imports a fixture file. This module is the fixture
 * layer's single public surface, and `agentClient.ts` is its single permitted consumer. That is
 * why `fixtures/` sits beside `lib/` rather than inside it: the architecture should be legible
 * from `ls` before anyone opens a file.
 *
 * ---------------------------------------------------------------------------------------------
 * THIS OBJECT IS A TEMPLATE, NOT THE WORLD
 *
 * Everything exported here is module-scope and must be treated as immutable. D-037 makes
 * `agentClient.ts` the owner of the mutable world, and it takes a deep clone of this at
 * initialisation.
 *
 * The reason matters more than the rule. React 19's StrictMode mounts, unmounts and re-mounts
 * every component in development, deliberately, to surface exactly this class of bug. Mutating
 * these arrays in place would corrupt state across that double-invocation and across the
 * server/client boundary, and the symptom would look like a React rendering fault rather than the
 * aliasing bug it actually is. That is a bad afternoon, and it is avoided by one sentence of
 * discipline here and one `structuredClone` there.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS DELIBERATELY EMPTY, AND WHY THAT IS NOT AN OVERSIGHT
 *
 * `posts`, `metricSnapshots` and the settled history behind them arrive with the fixture breadth
 * pass. They are empty here because this slice exists to prove the seam — fixtures through the
 * client and the transitions into React — not to populate the dashboard.
 *
 * Empty is also useful in its own right, and briefly worth keeping: with no posts, every
 * business metric legitimately returns `no_data` through the *same code path* as the populated
 * view. The dashboard's week-one empty state is therefore exercised before the populated state
 * exists, which is the opposite of the usual order and catches the tiles that were only ever
 * designed against a number.
 */

import { FIXTURE_SCHEMA_VERSION, type FixtureSchemaVersion } from '../lib/types.ts';
import type { FixtureSet } from '../lib/types.ts';
import { ANCHOR_MS } from '../lib/time.ts';

import { client, pillars } from './client.ts';
import { settings } from './settings.ts';
import { guardrailRules } from './guardrailRules.ts';
import { reflectionRules } from './reflectionRules.ts';
import { metricDescriptors } from './metricDescriptors.ts';
import {
  approvals,
  calendarSlots,
  drafts,
  guardrailEvents,
  runSteps,
  runs,
  scheduledPosts,
} from './pipeline.ts';
import {
  batchApprovals,
  batchDrafts,
  batchEvents,
  batchRuns,
  batchSlots,
  batchSteps,
} from './batch.ts';
import {
  historyApprovals,
  historyDrafts,
  historyEvents,
  historyPosts,
  historyRuns,
  historySlots,
  historySnapshots,
  historySteps,
} from './history.ts';

export const schemaVersion: FixtureSchemaVersion = FIXTURE_SCHEMA_VERSION;

export const fixtures: FixtureSet = {
  /**
   * D-029: declared with a literal type, so a fixture file authored against a different schema
   * fails `next build` rather than the browser. Conceded honestly — with one version in existence
   * the check can never fire. It demonstrates the seam; it is not a migration path.
   */
  schemaVersion: FIXTURE_SCHEMA_VERSION,

  /**
   * The anchor every `MinutesFromAnchor` in this set is relative to, carried on the set itself so
   * a consumer never has to import the time module to know what the offsets mean.
   */
  anchor_epoch_ms: ANCHOR_MS,

  client,
  pillars,

  /**
   * Live pipeline first, then settled history. Order is not load-bearing — every consumer filters
   * or aggregates — but keeping the two groups adjacent makes the set readable, and readable
   * fixtures are the ones that get corrected when they are wrong.
   */
  calendarSlots: [...calendarSlots, ...batchSlots, ...historySlots],
  drafts: [...drafts, ...batchDrafts, ...historyDrafts],
  approvals: [...approvals, ...batchApprovals, ...historyApprovals],
  /**
   * The two scheduled posts first, then everything that already published.
   *
   * This collection used to be `historyPosts` alone, which meant every Post in the set was
   * `published` and the settings screen's banned-claim sweep had nothing to sweep on a cold load.
   * See the "ALREADY APPROVED" note in `pipeline.ts` for why there are two rather than one.
   */
  posts: [...scheduledPosts, ...historyPosts],
  metricSnapshots: historySnapshots,
  guardrailRules,
  guardrailEvents: [...guardrailEvents, ...batchEvents, ...historyEvents],
  runs: [...runs, ...batchRuns, ...historyRuns],
  runSteps: [...runSteps, ...batchSteps, ...historySteps],
  reflectionRules,
  settings,
  metricDescriptors,
};

export { LIVE_RUN_EMITTED_THROUGH_SEQ, RUN_LIVE } from './pipeline.ts';
