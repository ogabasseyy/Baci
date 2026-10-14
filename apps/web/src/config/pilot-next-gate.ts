import path from 'node:path';
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from 'next/constants';
import { isPilotLabEnabled } from './pilot-lab-enabled';
import { assertPilotPublicAssets } from './pilot-public-assets';
import { canonicalDir } from './pilot-public-assets-roots';

// Merchant-image-pilot gate for Next config load, split out of
// next.config.ts under the repo line ceiling: public assets bypass
// route guards, so refuse non-lab builds with staged data.
//
// Phase-scoped on the phase Next itself passes to the config
// function: the build asserts, dev/start stash the verified root for
// the boot gate (which owns runtime enforcement via instrumentation)
// without asserting, and every other phase skips the gate entirely —
// a local staged tree or stale preset never fails typegen, tests, or
// tooling that imports the config without calling it. argv sniffing
// cannot cover programmatic builds (nextBuild() passes the phase but
// no CLI argv), and process.env.NEXT_PHASE is unset at config time
// (Next assigns it late in the build, after loadConfig), so the
// phase parameter is the only truthful signal.
export type PilotGatePhase = 'build' | 'dev' | 'other' | 'start';

// Pure over the passed phase for unit tests; production callers pass
// the phase Next supplies. Anything but the three serving phases —
// test, info, export, programmatic callers that pass nothing — is
// 'other' and skips the gate.
export function classifyGatePhase(phase: string | undefined): PilotGatePhase {
  if (phase === PHASE_PRODUCTION_BUILD) {
    return 'build';
  }
  if (phase === PHASE_PRODUCTION_SERVER) {
    return 'start';
  }
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return 'dev';
  }
  return 'other';
}

export function applyPilotPublicGate(
  configDir: string,
  phase?: string
): string {
  const pilotPublicDir = path.join(configDir, 'public');
  if (classifyGatePhase(phase) === 'other') {
    // Unrelated config evaluation: zero gate cost, zero throw, zero
    // env mutation. Nothing here boots or serves the app, so even a
    // disagreeing preset is ignored — it only constrains boots.
    return pilotPublicDir;
  }
  // Strict severities: the build is the enforcement point, so
  // content findings refuse here. Filler drift is lab-scoped:
  // fixtures must be exact for lab builds (measurement exactness)
  // but must not brick unrelated storefront deploys — a pipeline
  // recompression is not tamper, and anyone who can drift a filler
  // can add a static file directly. Lab boots re-assert exact
  // fillers regardless, so a lab build without the flag still
  // refuses drift at startup.
  if (phase === PHASE_PRODUCTION_BUILD) {
    assertPilotPublicAssets(
      pilotPublicDir,
      undefined,
      isPilotLabEnabled() ? 'throw' : 'warn',
      'throw'
    );
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
  if (phase !== PHASE_PRODUCTION_BUILD && !preset) {
    process.env.BACI_PILOT_PUBLIC_DIR = pilotPublicDir;
  }
  return pilotPublicDir;
}
