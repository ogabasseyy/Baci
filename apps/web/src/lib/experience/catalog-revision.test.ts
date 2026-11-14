// @vitest-environment node
import { expect, it } from 'vitest';
import {
  experienceCatalogRevision,
  readConsistentCatalog,
} from './catalog-revision';

it('hashes normalized public data independently of object insertion order and changes on generation/price', async () => {
  expect(experienceCatalogRevision('1', { price: 10, name: 'Synthetic' })).toBe(
    experienceCatalogRevision('1', { name: 'Synthetic', price: 10 })
  );
  expect(experienceCatalogRevision('2', { price: 10 })).not.toBe(
    experienceCatalogRevision('1', { price: 10 })
  );
  let reads = 0;
  let sequence = 0;
  const value = await readConsistentCatalog({
    generation: async () => String([1, 2, 2, 2][sequence++]),
    read: async () => ({ price: ++reads }),
  });
  expect(value).toMatchObject({ generation: '2', data: { price: 2 } });
});
