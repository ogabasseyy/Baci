// Lab launcher/preflight for the merchant image pilot.
//
// Offline gate: validates the inventory, acceptance records, committed
// manifests, output hashes, decoded dimensions, and staged lab bytes before
// any browser comparison runs. Served gate (--origin): fetches the gallery
// and every per-store lab page in both arms and proves every intended
// accepted binding has an actual mount of the expected kind/identity,
// every hero hint owner agrees with its own section's rendered picture,
// width descriptors match actual decoded bytes, and the control arm serves
// originals only. Reported not-optimized rows are audited but excluded
// from optimized coverage.
//
// Usage:
//   node merchant-image-pilot-preflight.mjs --inventory <path> \
//     --acceptances <path> --input-root <dir> --output-root <dir> \
//     --public-dir <dir> [--recipe <recipe-id>] [--origin <url> \
//     --store-map <merchantId=slug,...>] [--write-mounts <path>]
//
// --write-mounts persists the offline accepted list for downstream gates
// (the browser readiness gate consumes it as --mounts): written only when
// the offline gate passes, so a failing offline run never hands a partial
// expectation downstream.
//
// The recipe and role ladders are pinned to the generator constants (the
// same values the lab route enforces): --recipe only declares the operator's
// expectation and fails closed when it differs from the pin. Exit 0 with a
// JSON report on stdout when every check passes; exit 1 with the failures
// listed otherwise. Local files only; the only network call is the
// operator-supplied lab origin for the served gate.
//
// Layout: this file only orchestrates runPreflight and re-exports the
// tested entry points; implementations live in focused modules (each file
// under the 300-line repo ceiling):
//   preflight-shared.mjs        route-mirror patterns, check recording
//   preflight-args.mjs          CLI flags, store-map parsing
//   preflight-records.mjs       inventory/acceptance shape mirrors
//   preflight-manifest.mjs      manifest contract mirror
//   preflight-offline.mjs       offline gate orchestration
//   preflight-offline-input.mjs input + acceptance stages
//   preflight-offline-output.mjs manifest + tiers + staged stages
//   preflight-html.mjs          served-HTML extraction + URL helpers
//   preflight-agreement.mjs     preload/picture owner agreement
//   preflight-mounts.mjs        mount coverage by role kind
//   preflight-served-checks.mjs descriptors, purity, response bytes
//   preflight-served.mjs        served gate orchestration
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  parsePreflightArgs,
  parseStoreMap,
} from './merchant-image-pilot-preflight-args.mjs';
import { runOfflinePreflight } from './merchant-image-pilot-preflight-offline.mjs';
import { fetchServedAgreement } from './merchant-image-pilot-preflight-served.mjs';
import { readJson } from './merchant-image-pilot-preflight-shared.mjs';

export { assertServedAgreement } from './merchant-image-pilot-preflight-agreement.mjs';
export {
  parsePreflightArgs,
  parseStoreMap,
} from './merchant-image-pilot-preflight-args.mjs';
export {
  extractLabPictures,
  extractLabPreloads,
  extractLabSections,
} from './merchant-image-pilot-preflight-html.mjs';
export { assertManifestContract } from './merchant-image-pilot-preflight-manifest.mjs';
export { assertServedMountCoverage } from './merchant-image-pilot-preflight-mounts.mjs';
export { runOfflinePreflight } from './merchant-image-pilot-preflight-offline.mjs';
export { fetchServedAgreement } from './merchant-image-pilot-preflight-served.mjs';

export async function runPreflight(options) {
  const offline = await runOfflinePreflight(options);
  if (options.writeMounts) {
    if (!offline.ok) {
      return {
        ...offline,
        failures: [
          ...offline.failures,
          'mounts not written: offline gate failed',
        ],
        served: null,
      };
    }
    try {
      await writeFile(
        options.writeMounts,
        `${JSON.stringify(offline.accepted, null, 2)}\n`
      );
    } catch (error) {
      return {
        ...offline,
        failures: [
          ...offline.failures,
          `mounts not written: ${error instanceof Error ? error.message : String(error)}`,
        ],
        ok: false,
        served: null,
      };
    }
  }
  if (!options.origin) {
    return { ...offline, served: null };
  }
  // Every inventory binding must render a section in each served arm
  // (accepted mounts and reported not-optimized rows alike); the served
  // gate fails when the route silently drops one. Every offline-accepted
  // binding must additionally have an actual mount of the expected
  // kind/identity on the gallery and on its merchant's store page.
  let inventory = [];
  try {
    const parsed = await readJson(options.inventory);
    if (Array.isArray(parsed)) {
      inventory = parsed;
    }
  } catch {
    inventory = [];
  }
  const expectedBindings = inventory.map(
    (record) => `${record.merchantId}/${record.assetId}`
  );
  let storeMap;
  try {
    storeMap = parseStoreMap(options.storeMap);
  } catch (error) {
    return {
      accepted: offline.accepted,
      checks: offline.checks,
      failures: [...offline.failures, `served:store-map: ${error.message}`],
      ok: false,
      served: null,
    };
  }
  const merchants = [...new Set(inventory.map((record) => record.merchantId))];
  const unmapped = merchants.filter((merchant) => !storeMap[merchant]);
  if (unmapped.length > 0) {
    return {
      accepted: offline.accepted,
      checks: offline.checks,
      failures: [
        ...offline.failures,
        `served:store-map: no store slug for merchants: ${unmapped.join(', ')}`,
      ],
      ok: false,
      served: null,
    };
  }
  const bindingsFor = (merchantId) =>
    inventory
      .filter((record) => record.merchantId === merchantId)
      .map((record) => `${record.merchantId}/${record.assetId}`);
  const pages = [
    {
      bindings: expectedBindings,
      mounts: offline.accepted,
      path: '/pilot-lab',
      surface: 'gallery',
    },
    ...merchants.map((merchantId) => ({
      bindings: bindingsFor(merchantId),
      mounts: offline.accepted.filter(
        (mount) => mount.merchantId === merchantId
      ),
      path: `/pilot-lab/store/${storeMap[merchantId]}`,
      surface: 'store',
    })),
  ];
  const served = await fetchServedAgreement(options.origin, {
    arms: ['pilot', 'control'],
    expectedBindings,
    expectedMounts: offline.accepted,
    pages,
    publicDir: options.publicDir,
    timeoutMs: options.timeoutMs ?? 10_000,
  });
  return {
    accepted: offline.accepted,
    checks: [...offline.checks, ...served.checks],
    coverage: served.coverage,
    failures: [...offline.failures, ...served.failures],
    ok: offline.ok && served.ok,
    served,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const options = parsePreflightArgs(process.argv.slice(2));
  const report = await runPreflight(options);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    throw new Error(
      `merchant image pilot preflight failed (${report.failures.length} checks)`
    );
  }
}
