/**
 * FIXTURE SCHEMA VERSION — re-exported so nothing in `fixtures/` reaches into `lib/` for it.
 *
 * D-029 asked what "versioned fixtures" means, since the brief requires it (PDF p.3) and never
 * defines it. The weakest honest reading is "the files are in git", which is true and claims
 * nothing. This is the stronger one: every fixture file declares the schema version it was
 * authored against, as a *literal* type, so a file written against a different schema fails
 * `next build` rather than the browser.
 *
 * WHY THE CONSTANT LIVES IN `lib/types.ts` AND IS RE-EXPORTED HERE (D-029 amendment). The thing
 * that makes the check work is a type — `FixtureSchemaVersion` is the literal `'1'`, not `string`
 * — and D-023 puts types in `lib/`. Re-exporting keeps the dependency arrow pointing one way:
 * `fixtures/` imports from here, `agentClient.ts` imports `fixtures/`, and nothing in `fixtures/`
 * reaches back into `lib/` for a type it could have been handed.
 *
 * THE COST, CONCEDED. With exactly one version in existence this check can never fire. It
 * demonstrates the seam; it is not a working migration path, and calling it one would be an
 * overclaim. It becomes real the first time a fixture's shape changes after the set is written.
 */

export { FIXTURE_SCHEMA_VERSION } from '../lib/types.ts';
export type { FixtureSchemaVersion } from '../lib/types.ts';
