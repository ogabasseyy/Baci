import path from 'node:path';
import { assertPilotPublicAssets } from './pilot-public-assets';
import { canonicalDir } from './pilot-public-assets-roots';

// Merchant-image-pilot gate for Next config load, split out of
// next.config.ts under the repo line ceiling: public assets bypass
// route guards, so refuse non-lab builds with staged data.
//
// Phase-scoped: next.config.ts evaluates on EVERY config load (dev,
// build, start, typegen, any tooling importing it), but only the
// build enforces here. Dev/start stash the verified root for the
// boot gate (which owns runtime enforcement via instrumentation)
// without asserting, and unrelated loads do nothing at all — a
// local staged tree or stale preset must never fail typegen or a
// dev server that never serves the app.
export type PilotGatePhase = 'build' | 'dev' | 'other' | 'start';

// Classifies the invoking Next subcommand from argv: the subcommand
// is the arg after the entry whose basename is `next` (covers
// bin/next, pnpm/npx shims, next.exe). Vitest workers, tsx CLIs,
// typegen, custom servers, and bare `next` (no subcommand) are all
// 'other'. Pure over the passed argv for unit tests; production
// callers pass process.argv by default.
export function classifyGatePhase(
  argv: readonly string[] = process.argv
): PilotGatePhase {
  for (let index = 0; index < argv.length - 1; index++) {
    const entry = argv[index] ?? '';
    const basename = entry
      .split('/')
      .pop()
      ?.split('\\')
      .pop()
      ?.toLowerCase()
      .replace(/\.exe$/, '');
    if (basename !== 'next') {
      continue;
    }
    const subcommand = (argv[index + 1] ?? '').toLowerCase();
    if (subcommand === 'build') {
      return 'build';
    }
    if (subcommand === 'start') {
      return 'start';
    }
    if (subcommand === 'dev') {
      return 'dev';
    }
    return 'other';
  }
  return 'other';
}

export function applyPilotPublicGate(
  configDir: string,
  argv: readonly string[] = process.argv
): string {
  const pilotPublicDir = path.join(configDir, 'public');
  const phase = classifyGatePhase(argv);
  if (phase === 'other') {
    // Unrelated config evaluation: zero gate cost, zero throw, zero
    // env mutation. Nothing here boots or serves the app, so even a
    // disagreeing preset is ignored — it only constrains boots.
    return pilotPublicDir;
  }
  // Strict severities: the build is the enforcement point, so both
  // drift and content findings refuse here. Runtime boots keep drift
  // fatal (post-build tamper) but quarantine content findings and
  // continue, so a leftover staged tree neither bricks prod nor stays
  // served.
  if (phase === 'build') {
    assertPilotPublicAssets(pilotPublicDir, undefined, 'throw', 'throw');
  }
  // A preset that disagrees with the served config tree refuses the
  // process: the boot gate and request resolver trust the stash, so
  // a stale preset would validate and bind a tree Next never serves.
  // Public is always config-relative in-process, hence a mismatch is
  // always stale — unset or correct the preset. An agreeing preset
  // stays (same tree, operator spelling); empty counts as unset.
  const preset = process.env.BACI_PILOT_PUBLIC_DIR;
  if (preset && canonicalDir(preset) !== canonicalDir(pilotPublicDir)) {
    throw new Error(
      `merchant image pilot: BACI_PILOT_PUBLIC_DIR preset "${preset}" disagrees with the served config tree "${pilotPublicDir}"; refusing to stash an unverified anchor — unset or correct the preset`
    );
  }
  // The boot gate (instrumentation.ts) must inspect this same tree
  // but has no config-relative anchor at runtime: dev/start stash
  // the config-anchored root in the environment they share with the
  // boot process. The build deliberately does NOT stash: the value
  // would die with the build process anyway, and a same-process
  // stash leaks into spawned child tooling that later resolves it.
  if (phase !== 'build' && !preset) {
    process.env.BACI_PILOT_PUBLIC_DIR = pilotPublicDir;
  }
  return pilotPublicDir;
}
