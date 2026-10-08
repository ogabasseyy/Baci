// Lab stores mirror reader for the merchant image pilot preflight.
//
// The mirror (merchant-image-pilot-lab-stores.json) declares per-merchant
// uncovered slots the served gate requires as explicit markers on each
// store page. It is pinned by test to lab-store-registry.ts, the TS
// source of truth.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './merchant-image-pilot-preflight-shared.mjs';

export const DEFAULT_LAB_STORES = join(
  dirname(fileURLToPath(import.meta.url)),
  'merchant-image-pilot-lab-stores.json'
);

export async function readLabStores(path) {
  const parsed = await readJson(path);
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
  return new Map(parsed.map((entry) => [entry.merchantId, entry]));
}
