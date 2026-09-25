import { describe, expect, it } from 'vitest';
import { jumiaProductUpdateSchema } from './jumia-product-update';

const validIds = {
  productId: '11111111-1111-4111-8111-111111111111',
  integrationId: '22222222-2222-4222-8222-222222222222',
};

describe('jumiaProductUpdateSchema', () => {
  it('accepts valid price, status, and ordered sale dates', () => {
    const result = jumiaProductUpdateSchema.safeParse({
      ...validIds,
      overrides: {
        jumia_price: 1200,
        jumia_sale_price: 1000,
        jumia_sale_start: '2026-08-25T10:00:00Z',
        jumia_sale_end: '2026-08-26T10:00:00Z',
        is_active: true,
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects calendar-invalid sale dates', () => {
    const result = jumiaProductUpdateSchema.safeParse({
      ...validIds,
      overrides: {
        jumia_sale_start: '2026-02-31',
        jumia_sale_end: '2026-03-02',
      },
    });

    expect(result.success).toBe(false);
  });

  it('requires both sale-date fields and orders them chronologically', () => {
    const missingEnd = jumiaProductUpdateSchema.safeParse({
      ...validIds,
      overrides: { jumia_sale_start: '2026-08-26' },
    });
    const reversed = jumiaProductUpdateSchema.safeParse({
      ...validIds,
      overrides: {
        jumia_sale_start: '2026-08-27',
        jumia_sale_end: '2026-08-26',
      },
    });

    expect(missingEnd.success).toBe(false);
    expect(reversed.success).toBe(false);
  });

  it('rejects invalid IDs and non-positive prices', () => {
    const result = jumiaProductUpdateSchema.safeParse({
      productId: 'invalid',
      integrationId: validIds.integrationId,
      overrides: { jumia_price: 0 },
    });

    expect(result.success).toBe(false);
  });
});
