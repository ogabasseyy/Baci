import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PILOT_LAB_STORES } from '../../src/lib/merchant-image-variant-pilot/lab-store-registry';
import { readLabStores } from './merchant-image-pilot-preflight-lab-stores.mjs';

// The served gate is .mjs and cannot import the TS registry, so it reads
// a committed JSON mirror. This pin keeps the mirror exact: any registry
// edit (new store, slot, or uncovered declaration) must re-freeze the
// mirror in the same change, or the served gate checks stale gaps.
describe('lab stores mirror', () => {
  it('matches the lab store registry exactly', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const mirror = JSON.parse(
      await readFile(join(here, 'merchant-image-pilot-lab-stores.json'), 'utf8')
    );
    expect(mirror).toEqual(PILOT_LAB_STORES);
  });

  it('rejects duplicate merchant entries instead of keeping the last', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-lab-stores-'));
    const path = join(dir, 'lab-stores.json');
    const entry = { merchantId: 'merchant-a', uncoveredSlots: [] };
    await writeFile(path, JSON.stringify([entry, entry]));
    await expect(readLabStores(path)).rejects.toThrow(/duplicate entries/);
  });

  it('rejects an oversized mirror on size instead of buffering it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-lab-stores-'));
    const path = join(dir, 'giant.json');
    await writeFile(path, Buffer.alloc(1024 * 1024 + 1, 0x5b));
    await expect(readLabStores(path)).rejects.toThrow(/byte budget/);
  });
});
