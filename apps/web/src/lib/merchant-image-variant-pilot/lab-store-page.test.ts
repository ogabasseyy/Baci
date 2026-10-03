import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PILOT_LAB_STORES,
  pilotLabStoreBasePath,
  pilotLabStoreBySlug,
} from './lab-store-page';

describe('pilot lab store table', () => {
  it('covers the four sample stores with their selected slots', () => {
    expect(PILOT_LAB_STORES.map((store) => store.slug)).toEqual([
      'omnimart',
      'squishyland',
      'zorvexa',
      'ogabassey',
    ]);
    expect(PILOT_LAB_STORES.flatMap((store) => store.slots)).toHaveLength(6);
    expect(pilotLabStoreBySlug('omnimart')?.slots).toEqual([
      'header-logo',
      'product-card',
    ]);
    expect(pilotLabStoreBySlug('squishyland')?.slots).toEqual(['product-card']);
    expect(pilotLabStoreBySlug('zorvexa')?.slots).toEqual([
      'header-logo',
      'product-card',
    ]);
    expect(pilotLabStoreBySlug('ogabassey')?.slots).toEqual([
      'mobile-hero-slide-0',
    ]);
  });

  it('resolves unknown slugs to null (route 404s)', () => {
    expect(pilotLabStoreBySlug('dell')).toBeNull();
    expect(pilotLabStoreBySlug('')).toBeNull();
  });

  it('scopes lab hrefs under the store route (never production)', () => {
    const store = pilotLabStoreBySlug('omnimart');
    if (!store) {
      throw new Error('omnimart store is missing from the lab table');
    }
    expect(pilotLabStoreBasePath(store)).toBe('/pilot-lab/store/omnimart');
  });

  it('freezes the grid filler bytes (hash-pinned, separate from any selected original)', () => {
    // Grid fillers render this committed synthetic asset — never a copy of
    // the selected binding's original — identically in both arms, so the
    // byte comparison isolates the selected slot.
    const here = dirname(fileURLToPath(import.meta.url));
    const fillerPath = join(
      here,
      '..',
      '..',
      '..',
      'public',
      '__pilot',
      'fillers',
      'grid-filler-600x400.png'
    );
    const bytes = readFileSync(fillerPath);
    expect(bytes.length).toBe(1312);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '91b03b97f2218feedf29edb7daa828ce0770d1aac6ba7d947a17c1bf6c5e415a'
    );
  });
});
