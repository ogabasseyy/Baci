// Lab stores mirror reader for the merchant image pilot preflight.
//
// The mirror (merchant-image-pilot-lab-stores.json) declares per-merchant
// uncovered slots the served gate requires as explicit markers on each
// store page. It is pinned by test to lab-store-registry.ts, the TS
// source of truth.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_INVENTORY_BYTES } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { readBoundedJson } from './merchant-image-pilot-preflight-shared.mjs';

export const DEFAULT_LAB_STORES = join(
  dirname(fileURLToPath(import.meta.url)),
  'merchant-image-pilot-lab-stores.json'
);

export async function readLabStores(path) {
  const parsed = await readBoundedJson(path, MAX_INVENTORY_BYTES);
  if (
    !Array.isArray(parsed) ||
    !parsed.every(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        typeof entry.merchantId === 'string' &&
        Array.isArray(entry.uncoveredSlots) &&
        entry.uncoveredSlots.every(
          (slot) =>
            slot && typeof slot === 'object' && typeof slot.slotId === 'string'
        )
    )
  ) {
    throw new Error(
      `lab stores mirror ${path} must be an array of {merchantId, uncoveredSlots:[{slotId}]}`
    );
  }
  const seen = new Set();
  for (const entry of parsed) {
    // A duplicate merchant entry would silently keep only the last
    // declaration, dropping uncovered markers the served gate must
    // require — fail closed instead of guessing which one wins.
    if (seen.has(entry.merchantId)) {
      throw new Error(
        `lab stores mirror ${path} has duplicate entries for merchant ${entry.merchantId}`
      );
    }
    seen.add(entry.merchantId);
  }
  return new Map(parsed.map((entry) => [entry.merchantId, entry]));
}

// Load the mirror and require exactly one entry per inventory merchant:
// a custom --lab-stores file that omits a merchant must fail, not
// silently assign that store zero uncovered consumers — the served gate
// would then report green without requiring the omitted route-matrix
// markers.
export async function loadLabStoresForInventory(path, merchants) {
  const stores = await readLabStores(path);
  const undeclared = merchants.filter((merchantId) => !stores.has(merchantId));
  if (undeclared.length > 0) {
    throw new Error(
      `lab stores mirror ${path} has no entry for merchants: ${undeclared.join(', ')}`
    );
  }
  return stores;
}
