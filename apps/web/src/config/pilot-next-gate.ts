import path from 'node:path';
import { assertPilotPublicAssets } from './pilot-public-assets';
import { canonicalDir } from './pilot-public-assets-roots';

// Merchant-image-pilot gate for Next config load, split out of
// next.config.ts under the repo line ceiling: public assets bypass
// route guards, so refuse non-lab builds with staged data. Runs at
// import time from the config; behavior is identical to the inline
// block it replaces.
export function applyPilotPublicGate(configDir: string): string {
  const pilotPublicDir = path.join(configDir, 'public');
  // Strict severities: the build is the enforcement point, so both
  // drift and content findings refuse here. Runtime boots keep drift
  // fatal (post-build tamper) but quarantine content findings and
  // continue, so a leftover staged tree neither bricks prod nor stays
  // served.
  assertPilotPublicAssets(pilotPublicDir, undefined, 'throw', 'throw');
  // The boot gate (instrumentation.ts) must inspect this same tree but
  // has no config-relative anchor at runtime: stash the config-anchored
  // root in this process's environment, where the boot gate reads it.
  // A preset that disagrees with the served config tree refuses the
  // build: the boot gate and request resolver trust the stash, so a
  // stale preset would validate and bind a tree Next never serves.
  // Public is always config-relative in-process, hence a mismatch is
  // always stale — unset or correct the preset. An agreeing preset
  // stays (same tree, operator spelling); empty counts as unset.
  const preset = process.env.BACI_PILOT_PUBLIC_DIR;
  if (preset && canonicalDir(preset) !== canonicalDir(pilotPublicDir)) {
    throw new Error(
      `merchant image pilot: BACI_PILOT_PUBLIC_DIR preset "${preset}" disagrees with the served config tree "${pilotPublicDir}"; refusing to stash an unverified anchor — unset or correct the preset`
    );
  }
  if (!preset) {
    process.env.BACI_PILOT_PUBLIC_DIR = pilotPublicDir;
  }
  return pilotPublicDir;
}
