import { describe, expect, it } from 'vitest';
import { jumiaProductQuerySchema } from './jumia-product-query';

describe('jumiaProductQuerySchema', () => {
  it('accepts valid product and integration ids', () => {
    expect(
      jumiaProductQuerySchema.safeParse({
        productId: '00000000-0000-4000-8000-000000000001',
        integrationId: '00000000-0000-4000-8000-000000000002',
      }).success
    ).toBe(true);
  });

  it('rejects either malformed id', () => {
    expect(
      jumiaProductQuerySchema.safeParse({
        productId: 'bad',
        integrationId: '00000000-0000-4000-8000-000000000002',
      }).success
    ).toBe(false);
  });
});
