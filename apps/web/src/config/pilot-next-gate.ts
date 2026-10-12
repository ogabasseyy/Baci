import path from 'node:path';
import { assertPilotPublicAssets } from './pilot-public-assets';

// Merchant-image-pilot gate for Next config load, split out of
// next.config.ts under the repo line ceiling: public assets bypass
// route guards, so refuse non-lab builds with staged data. Runs at
// import time from the config; behavior is identical to the inline
// block it replaces.
export function applyPilotPublicGate(configDir: string): string {
  const pilotPublicDir = path.join(configDir, 'public');
  assertPilotPublicAssets(pilotPublicDir);
  // The boot gate (instrumentation.ts) must inspect this same tree but
  // has no config-relative anchor at runtime: stash the config-anchored
  // root in this process's environment, where the boot gate reads it.
  // Unconditional overwrite — the config knows the truth, a stale
  // preset never does.
  process.env.BACI_PILOT_PUBLIC_DIR = pilotPublicDir;
  return pilotPublicDir;
}
