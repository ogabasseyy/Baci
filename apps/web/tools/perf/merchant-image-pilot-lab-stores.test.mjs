import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PILOT_LAB_STORES } from '../../src/lib/merchant-image-variant-pilot/lab-store-registry';

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
});
