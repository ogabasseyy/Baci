import { describe, expect, it } from 'vitest';
import { jumiaMappedProductQuerySchema } from './jumia-mapped-product-query';

describe('jumiaMappedProductQuerySchema', () => {
  it('accepts a UUID integration id', () => {
    expect(
      jumiaMappedProductQuerySchema.safeParse({
        integrationId: '00000000-0000-4000-8000-000000000099',
      }).success
    ).toBe(true);
  });

  it('rejects a missing or malformed integration id', () => {
    expect(
      jumiaMappedProductQuerySchema.safeParse({ integrationId: 'bad' }).success
    ).toBe(false);
    expect(jumiaMappedProductQuerySchema.safeParse({}).success).toBe(false);
  });
});
