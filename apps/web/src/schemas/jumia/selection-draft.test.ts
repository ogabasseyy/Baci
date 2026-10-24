import { describe, expect, it } from 'vitest';
import { jumiaGamingDraftPageSchema } from './selection-draft';

const validPage = {
  selectionId: '00000000-0000-4000-8000-000000000020',
  sourceCategoryId: '00000000-0000-4000-8000-000000000010',
  total: 1,
  page: 1,
  limit: 50,
  totalPages: 1,
  legacyUnmappedCount: 0,
  products: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      ordinal: 1,
      available: true,
      unavailableReason: null,
      capturedSourceVersion: 'a'.repeat(64),
      currentSourceVersion: 'a'.repeat(64),
      product: { product: { name: 'Gamepad' } },
    },
  ],
};

describe('Gaming draft page boundary', () => {
  it('accepts canonical captured evidence and preserves unavailable membership', () => {
    expect(jumiaGamingDraftPageSchema.parse(validPage).products[0].id).toBe(
      '00000000-0000-4000-8000-000000000001'
    );
    expect(
      jumiaGamingDraftPageSchema.safeParse({
        ...validPage,
        products: [
          {
            ...validPage.products[0],
            available: false,
            currentSourceVersion: null,
            product: null,
          },
        ],
      }).success
    ).toBe(true);
  });

  it.each([
    { sourceCategoryId: 'category' },
    { total: Number.MAX_SAFE_INTEGER },
    { totalPages: 100_001 },
    { limit: 101 },
    { page: 2 },
    { totalPages: 0 },
    { products: [] },
    { products: [{ ...validPage.products[0], id: 'not-a-uuid' }] },
    {
      products: [
        {
          ...validPage.products[0],
          id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
        },
      ],
    },
    { products: [{ ...validPage.products[0], capturedSourceVersion: 'v1' }] },
    {
      products: [
        { ...validPage.products[0], currentSourceVersion: 'A'.repeat(64) },
      ],
    },
    { products: [{ ...validPage.products[0], ordinal: 2 }] },
  ])('rejects malformed or inconsistent frozen evidence: %j', (override) => {
    expect(
      jumiaGamingDraftPageSchema.safeParse({ ...validPage, ...override })
        .success
    ).toBe(false);
  });
});
