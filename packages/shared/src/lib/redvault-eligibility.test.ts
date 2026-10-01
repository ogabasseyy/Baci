import { describe, expect, it } from 'vitest';
import { isRedvaultEligibleProduct } from './redvault-eligibility';

describe('isRedvaultEligibleProduct', () => {
  it.each([
    'Infinix',
    'Tecno',
    'Vivo',
    'Redmi',
    'Xiaomi',
    'Oppo',
    'Itel',
    'Honor',
  ])('excludes %s using the shared negotiation policy', (brand) => {
    expect(isRedvaultEligibleProduct({ brand, name: 'Phone' })).toBe(false);
  });

  it('excludes Samsung A-series but retains Samsung S and Z products', () => {
    expect(
      isRedvaultEligibleProduct({ brand: 'Samsung', name: 'Galaxy A16 5G' })
    ).toBe(false);
    expect(
      isRedvaultEligibleProduct({ brand: 'Samsung', name: 'Galaxy S25' })
    ).toBe(true);
    expect(
      isRedvaultEligibleProduct({ brand: 'Samsung', name: 'Galaxy Z Fold6' })
    ).toBe(true);
  });
});
