import { describe, expect, it } from 'vitest';
import { SavingsDeviceProductSchema } from './customer-savings-device';

describe('SavingsDeviceProductSchema', () => {
  it('accepts decimal price strings and optional variants', () => {
    expect(
      SavingsDeviceProductSchema.safeParse({
        id: 'product',
        name: 'Phone',
        price: '100.00',
      }).success
    ).toBe(true);
  });
  it('rejects products without a price', () => {
    expect(
      SavingsDeviceProductSchema.safeParse({ id: 'product', name: 'Phone' })
        .success
    ).toBe(false);
  });
});
