import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAB_STORES,
  loadLabStoresForInventory,
  readLabStores,
} from './merchant-image-pilot-preflight-lab-stores.mjs';

describe('merchant-image-pilot-preflight-lab-stores', () => {
  it('reads the default lab stores mirror', async () => {
    const stores = await readLabStores(DEFAULT_LAB_STORES);
    expect(stores.size).toBeGreaterThan(0);
    const firstMerchant = [...stores.keys()][0];
    const loaded = await loadLabStoresForInventory(DEFAULT_LAB_STORES, [
      firstMerchant,
    ]);
    expect(loaded.get(firstMerchant)).toBeDefined();
  });

  it('rejects malformed mirrors, duplicate merchants, and missing inventory entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-lab-stores-'));
    const badShape = join(dir, 'bad-shape.json');
    await writeFile(badShape, JSON.stringify([{ merchantId: 123 }]));
    await expect(readLabStores(badShape)).rejects.toThrow(
      /must be an array of/
    );

    const dupMerchant = join(dir, 'dup.json');
    await writeFile(
      dupMerchant,
      JSON.stringify([
        { merchantId: 'm1', uncoveredSlots: [{ slotId: 's1' }] },
        { merchantId: 'm1', uncoveredSlots: [{ slotId: 's2' }] },
      ])
    );
    await expect(readLabStores(dupMerchant)).rejects.toThrow(
      /duplicate entries for merchant m1/
    );

    const validPath = join(dir, 'valid.json');
    await writeFile(
      validPath,
      JSON.stringify([{ merchantId: 'm1', uncoveredSlots: [{ slotId: 's1' }] }])
    );
    await expect(
      loadLabStoresForInventory(validPath, ['m1', 'm2'])
    ).rejects.toThrow(/no entry for merchants: m2/);
  });
});
