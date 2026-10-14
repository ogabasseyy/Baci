import 'server-only';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pinnedFillerEntries } from '@/config/pilot-public-assets';
import { resolveRoutePublicDir } from '@/config/pilot-public-assets-roots';
import {
  isPilotLabEnabled,
  loadLabConfig,
  type PilotLabConfig,
} from '@/lib/merchant-image-variant-pilot/lab-config';
import { assertNoUnexpectedStagedFiles } from '@/lib/merchant-image-variant-pilot/lab-config-stage-guard';
import {
  getFrozenLabRuntime,
  publishLabRuntime,
} from '@/lib/merchant-image-variant-pilot/lab-runtime';
import { readBoundedOperatorJson } from './lab-route-operator-json';
import {
  parseRawAcceptances,
  parseRawInventoryRecords,
} from './lab-route-records';
import { verifyStagedBytesAndFillers } from './lab-staged-verify';

// Shared loader for the lab-only pilot routes (gallery + per-store pages).
// Reads the operator's gitignored inventory/acceptances, validates the raw
// records with lab input-validation errors (never incidental TypeErrors),
// then delegates to the verified lab-config builder. Cached per frozen
// input content with in-flight dedupe, like the gallery route documents.

let cachedConfig: { config: PilotLabConfig; key: string } | null = null;
const inflightLoads = new Map<string, Promise<PilotLabConfig>>();

function loadLabConfigFromText(
  input: {
    acceptancesText: string;
    inputRoot: string;
    inventoryText: string;
    outputRoot: string;
    publicDir: string;
  },
  options?: { stage?: boolean }
): Promise<PilotLabConfig> {
  let inventoryRecords: unknown;
  let acceptances: unknown;
  try {
    inventoryRecords = JSON.parse(input.inventoryText);
  } catch {
    throw new Error('merchant image pilot: inventory.json is not valid JSON');
  }
  try {
    acceptances = JSON.parse(input.acceptancesText);
  } catch {
    throw new Error('merchant image pilot: acceptances.json is not valid JSON');
  }
  // Read-only by default (staging runs only in the pre-start CLI);
  // the caller verifies staged bytes and fails closed on drift.
  return loadLabConfig(
    {
      acceptances: parseRawAcceptances(acceptances),
      inputRoot: input.inputRoot,
      inventoryRecords: parseRawInventoryRecords(inventoryRecords),
      outputRoot: input.outputRoot,
      publicDir: input.publicDir,
    },
    { stage: options?.stage ?? false }
  );
}

// Pre-start staging entry for the pilot:stage CLI. Uses the exact same
// validated loader as the routes, but WITH writes enabled — the only
// sanctioned writer of public/__pilot bytes.
export function stageLabConfigFromText(input: {
  acceptancesText: string;
  inputRoot: string;
  inventoryText: string;
  outputRoot: string;
  publicDir: string;
}): Promise<PilotLabConfig> {
  return loadLabConfigFromText(input, { stage: true });
}

async function statFingerprint(path: string): Promise<string> {
  const info = await stat(path).catch(() => null);
  if (info === null) {
    // Full operator path goes to the server log only; the thrown message
    // can surface in route error output on shared hosts with the lab on.
    console.error(`merchant image pilot: cannot stat ${path}`);
    throw new Error(
      `merchant image pilot: cannot stat ${basename(path)}; re-run pnpm pilot:stage and restart the origin`
    );
  }
  // ctime defeats mtime pinning: every content write bumps ctime, so
  // an in-place edit always invalidates the key. Same stat, no added I/O.
  return `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
}

export async function getLabConfig(): Promise<PilotLabConfig> {
  if (!isPilotLabEnabled())
    throw new Error('merchant image pilot: refusing to load outside lab mode');
  const config = getFrozenLabRuntime();
  // Frozen config, live bytes: re-verify on the request path (not just
  // startup) so mid-measurement drift fails closed instead of skewing
  // the comparison. Steady-state cost is N+4 lstats per GET with no
  // hashes (stat fingerprints, pinned by the fast-path tests); the
  // known stage root covers the empty-allowlist branch. Filler
  // paths ride along so the binding check enumerates fillers/ too:
  // the byte verifier hashes pinned paths but never lists the dir.
  const publicDir = resolveRoutePublicDir();
  await verifyStagedBytesAndFillers(
    config.stagedPaths,
    pinnedFillerEntries(publicDir)
  );
  await assertNoUnexpectedStagedFiles(
    config.stagedPaths,
    join(publicDir, '__pilot'),
    pinnedFillerEntries(publicDir).map((entry) => entry.path)
  );
  return config;
}

export async function initializeLabRuntime(): Promise<PilotLabConfig> {
  const config = await loadLabConfigAtStartup();
  publishLabRuntime(config);
  return config;
}

export async function loadLabConfigAtStartup(): Promise<PilotLabConfig> {
  // Fail fast before any disk I/O: no caller may read operator roots
  // with lab mode off.
  if (!isPilotLabEnabled()) {
    throw new Error('merchant image pilot: refusing to load outside lab mode');
  }
  const inputRoot = process.env.BACI_IMAGE_PILOT_INPUT_ROOT;
  const outputRoot = process.env.BACI_IMAGE_PILOT_OUTPUT_ROOT;
  if (!inputRoot || !outputRoot) {
    throw new Error(
      'merchant image pilot: set BACI_IMAGE_PILOT_INPUT_ROOT and BACI_IMAGE_PILOT_OUTPUT_ROOT to serve the lab routes'
    );
  }
  // Unified with the build/boot gate root (fails closed on divergence).
  const publicDir = resolveRoutePublicDir();
  const inventoryPath = join(inputRoot, 'inventory.json');
  const acceptancesPath = join(outputRoot, 'acceptances.json');
  // Cache key commits to stat fingerprints (size+mtime+ctime — ctime
  // defeats mtime pinning), not content: content fully reloads on any
  // fingerprint change. Concurrent first requests share one in-flight
  // load per key; a failed load clears so the next request retries.
  const inventoryFingerprint = await statFingerprint(inventoryPath);
  const acceptancesFingerprint = await statFingerprint(acceptancesPath);
  const key = createHash('sha256')
    .update(
      JSON.stringify({
        acceptancesFingerprint,
        inputRoot,
        inventoryFingerprint,
        outputRoot,
        publicDir,
      })
    )
    .digest('hex');
  if (cachedConfig?.key === key) {
    // Input fingerprints don't cover staged bytes: deleted or drifted
    // files would otherwise keep serving bad URLs. Fail closed instead.
    await verifyStagedBytesAndFillers(
      cachedConfig.config.stagedPaths,
      pinnedFillerEntries(publicDir)
    );
    await assertNoUnexpectedStagedFiles(
      cachedConfig.config.stagedPaths,
      undefined,
      pinnedFillerEntries(publicDir).map((entry) => entry.path)
    );
    return cachedConfig.config;
  }
  const inflight = inflightLoads.get(key);
  if (inflight) {
    return inflight;
  }
  // Cache miss: read the full frozen inputs (a torn mid-write read fails
  // closed at JSON.parse, and the next request retries with a fresh key).
  const inventoryText = await readBoundedOperatorJson(inventoryPath);
  const acceptancesText = await readBoundedOperatorJson(acceptancesPath);
  const promise = loadLabConfigFromText({
    acceptancesText,
    inputRoot,
    inventoryText,
    outputRoot,
    publicDir,
  }).then(
    async (config) => {
      // Fresh loads verify too (forgotten pre-start stage fails here,
      // not as broken images). The finally clears poisoned in-flight
      // loads so a verify throw retries instead of replaying stale.
      try {
        await verifyStagedBytesAndFillers(
          config.stagedPaths,
          pinnedFillerEntries(publicDir)
        );
        await assertNoUnexpectedStagedFiles(
          config.stagedPaths,
          undefined,
          pinnedFillerEntries(publicDir).map((entry) => entry.path)
        );
        cachedConfig = { config, key };
        return config;
      } finally {
        if (inflightLoads.get(key) === promise) {
          inflightLoads.delete(key);
        }
      }
    },
    (error: unknown) => {
      if (inflightLoads.get(key) === promise) {
        inflightLoads.delete(key);
      }
      throw error;
    }
  );
  inflightLoads.set(key, promise);
  return promise;
}
