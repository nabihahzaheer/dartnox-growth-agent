import type { NextConfig } from 'next';
import { computeAnchorIso } from './lib/anchor';

/**
 * The fixture time anchor, resolved once here and inlined into the bundle as a string literal
 * (D-030 and its amendments). Everything on screen that has a date is computed from it.
 *
 * WHY THE VALUE IS COMPUTED RATHER THAN WRITTEN DOWN. It has to be recent, or the demo reads as
 * abandoned, and it has to be identical in the server render and the browser render, or React
 * reports a hydration mismatch. Computing it at build satisfies both: fresh on every deploy,
 * frozen for the lifetime of that deploy.
 *
 * WHY `env` RATHER THAN A `.env` FILE. Next's own documentation marks this config block as
 * legacy and points at `.env` files, which is the right default and is not usable here: a `.env`
 * file is a static list of strings and cannot compute the previous Thursday. The alternative is a
 * prebuild script that generates a TypeScript file, wired through the `build` script — more
 * machinery, one more generated artifact, and one more thing to explain, for the same result.
 *
 * TWO THINGS THE DOCUMENTATION IS EXPLICIT ABOUT, BOTH LOAD-BEARING:
 *
 *   A `NEXT_PUBLIC_` prefix would do nothing here. Values set through this block are *always*
 *   inlined into the client bundle; the prefix only means anything for variables arriving from
 *   the environment or a `.env` file. Naming this `NEXT_PUBLIC_ANCHOR_ISO` would advertise a
 *   mechanism that is not the one in use, so it is plain `ANCHOR_ISO`.
 *
 *   `process.env` cannot be destructured, because the substitution is textual rather than a real
 *   object lookup. `lib/time.ts` reads `process.env.ANCHOR_ISO` written out in full, and has a
 *   comment saying why.
 *
 * Nothing secret goes in this block, and nothing could: this whole build has no keys, no network
 * calls and no backend by construction (D-002).
 */
const nextConfig: NextConfig = {
  env: {
    ANCHOR_ISO: computeAnchorIso(new Date()),
  },
};

export default nextConfig;
