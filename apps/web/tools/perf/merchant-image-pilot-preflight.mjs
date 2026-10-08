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
//     --public-dir <dir> --expect-sample <frozen-keys.json> \
//     [--recipe <recipe-id>] [--origin <url> \
//     --store-map <merchantId=slug,...>] [--write-mounts <path>]
//
// --expect-sample is REQUIRED: it pins the planned merchant/asset/slot
// matrix (a JSON array of "merchantId/assetId/slotId" keys). Expectations
// derive from the supplied inventory, so without the pin a silently
// reduced sample would report ok:true on weaker evidence. Pass
// merchant-image-pilot-frozen-sample.json for the handoff sample; a
// deliberate resample re-freezes that file, never omits the flag.
//
// --lab-stores overrides the committed lab store mirror
// (merchant-image-pilot-lab-stores.json, pinned by test to
// lab-store-registry.ts): per-merchant declared uncovered slots the
// served gate requires as explicit markers on each store page.
//
// --write-mounts persists the offline accepted list for downstream gates
// (the browser readiness gate consumes it as --mounts): written only when
// the offline gate passes, and any prior artifact is removed when the run
// fails — otherwise a stale list (missing a newly added binding) would
// still produce a green browser report downstream.
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
//   preflight-offline-manifest.mjs manifest stage
//   preflight-offline-tiers.mjs    committed tier stage
//   preflight-offline-staged.mjs   staged bytes stage
//   preflight-html.mjs          served-HTML extraction + URL helpers
//   preflight-agreement.mjs     preload/picture owner agreement
//   preflight-mounts.mjs        mount coverage by role kind
//   preflight-mounts-publish.mjs --write-mounts publish/invalidate
//   preflight-lab-stores.mjs    lab stores mirror reader
//   preflight-served-checks.mjs descriptors, purity, response bytes
//   preflight-served.mjs        served gate orchestration
import { pathToFileURL } from 'node:url';
import {
  parsePreflightArgs,
  parseStoreMap,
} from './merchant-image-pilot-preflight-args.mjs';
import {
  DEFAULT_LAB_STORES,
  readLabStores,
} from './merchant-image-pilot-preflight-lab-stores.mjs';
import {
  invalidateMounts,
  publishMounts,
} from './merchant-image-pilot-preflight-mounts-publish.mjs';
import { runOfflinePreflight } from './merchant-image-pilot-preflight-offline.mjs';
import { fetchServedAgreement } from './merchant-image-pilot-preflight-served.mjs';

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
  // Mounts publication is deferred until the COMPLETE preflight
  // succeeds: the readiness gate treats this file as the complete
  // expected-mount authority, so publishing after the offline phase
  // would leave a valid-looking artifact behind a failed served gate.
  const invalidate = (reason) => invalidateMounts(options.writeMounts, reason);
  if (!options.origin) {
    // Offline-only run: publish only on success, invalidate on failure.
    if (!offline.ok) {
      const note = await invalidate('offline gate failed');
      return {
        ...offline,
        failures: [...offline.failures, ...(note ? [note] : [])],
        served: null,
      };
    }
    const publishError = await publishMounts(
      options.writeMounts,
      offline.accepted
    );
    if (publishError) {
      return {
        ...offline,
        failures: [...offline.failures, publishError],
        ok: false,
        served: null,
      };
    }
    return { ...offline, served: null };
  }
  // Every inventory binding must render a section in each served arm
  // (accepted mounts and reported not-optimized rows alike); the served
  // gate fails when the route silently drops one. Every offline-accepted
  // binding must additionally have an actual mount of the expected
  // kind/identity on the gallery and on its merchant's store page.
  // The served phase reuses the validated offline snapshot — never a
  // reread: a deleted, corrupted, or swapped inventory between phases
  // must fail closed instead of silently emptying the route matrix.
  const inventory = offline.inventory;
  if (!Array.isArray(inventory) || inventory.length === 0) {
    const note = await invalidate('served gate failed');
    return {
      accepted: offline.accepted,
      checks: offline.checks,
      failures: [
        ...offline.failures,
        'served:inventory: no validated inventory snapshot to serve',
        ...(note ? [note] : []),
      ],
      ok: false,
      served: null,
    };
  }
  const expectedBindings = inventory.map(
    (record) => `${record.merchantId}/${record.assetId}`
  );
  let storeMap;
  try {
    storeMap = parseStoreMap(options.storeMap);
  } catch (error) {
    const note = await invalidate('served gate failed');
    return {
      accepted: offline.accepted,
      checks: offline.checks,
      failures: [
        ...offline.failures,
        `served:store-map: ${error.message}`,
        ...(note ? [note] : []),
      ],
      ok: false,
      served: null,
    };
  }
  const merchants = [...new Set(inventory.map((record) => record.merchantId))];
  const unmapped = merchants.filter((merchant) => !storeMap[merchant]);
  if (unmapped.length > 0) {
    const note = await invalidate('served gate failed');
    return {
      accepted: offline.accepted,
      checks: offline.checks,
      failures: [
        ...offline.failures,
        `served:store-map: no store slug for merchants: ${unmapped.join(', ')}`,
        ...(note ? [note] : []),
      ],
      ok: false,
      served: null,
    };
  }
  let labStores;
  try {
    labStores = await readLabStores(options.labStores ?? DEFAULT_LAB_STORES);
  } catch (error) {
    const note = await invalidate('served gate failed');
    return {
      accepted: offline.accepted,
      checks: offline.checks,
      failures: [
        ...offline.failures,
        `served:lab-stores: ${error instanceof Error ? error.message : String(error)}`,
        ...(note ? [note] : []),
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
      uncovered: labStores.get(merchantId)?.uncoveredSlots ?? [],
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
  const ok = offline.ok && served.ok;
  if (!ok) {
    const note = await invalidate('served gate failed');
    return {
      accepted: offline.accepted,
      checks: [...offline.checks, ...served.checks],
      coverage: served.coverage,
      failures: [
        ...offline.failures,
        ...served.failures,
        ...(note ? [note] : []),
      ],
      ok: false,
      served,
    };
  }
  const publishError = await publishMounts(
    options.writeMounts,
    offline.accepted
  );
  if (publishError) {
    return {
      accepted: offline.accepted,
      checks: [...offline.checks, ...served.checks],
      coverage: served.coverage,
      failures: [...offline.failures, ...served.failures, publishError],
      ok: false,
      served,
    };
  }
  return {
    accepted: offline.accepted,
    checks: [...offline.checks, ...served.checks],
    coverage: served.coverage,
    failures: [...offline.failures, ...served.failures],
    ok: true,
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
