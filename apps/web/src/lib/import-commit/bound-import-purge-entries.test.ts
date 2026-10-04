import { describe, expect, it } from 'vitest';
import type { InternalRevalidateProductEntry } from '@/schemas/internal-revalidate-products-route';
import { boundImportPurgeEntries } from './bound-import-purge-entries';

const INTERNAL_REVALIDATE_PRODUCTS_MAX_ENTRIES = 1000;

describe('boundImportPurgeEntries', () => {
  it('preserves entries at the internal request limit', () => {
    const entries: InternalRevalidateProductEntry[] = [
      { slug: 'phone-a', category: 'Smartphones' },
      { slug: 'phone-b', category: 'Smartphones' },
    ];

    const result = boundImportPurgeEntries(entries);

    expect(result).toEqual(entries);
    expect(result).not.toBe(entries);
  });

  it('keeps one representative per category for oversized imports', () => {
    const entries = Array.from(
      { length: INTERNAL_REVALIDATE_PRODUCTS_MAX_ENTRIES + 1 },
      (_, index) => ({
        slug: `product-${index}`,
        category: index === 0 ? 'Smartphones' : `Category ${index}`,
      })
    );

    const result = boundImportPurgeEntries(entries);

    expect(result).toHaveLength(INTERNAL_REVALIDATE_PRODUCTS_MAX_ENTRIES);
    expect(result[0]).toEqual({
      slug: 'product-0',
      category: 'Smartphones',
    });
  });
});
