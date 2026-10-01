import { describe, expect, it } from 'vitest';
import { parseOrderTaxBasis } from '@/app/dashboard/orders/order-tax-basis';

describe('parseOrderTaxBasis', () => {
  it('accepts the persisted tax basis values', () => {
    expect(parseOrderTaxBasis('exclusive')).toBe('exclusive');
    expect(parseOrderTaxBasis('inclusive')).toBe('inclusive');
  });

  it('returns undefined for missing or unsupported values', () => {
    expect(parseOrderTaxBasis(null)).toBeUndefined();
    expect(parseOrderTaxBasis(undefined)).toBeUndefined();
    expect(parseOrderTaxBasis('unknown')).toBeUndefined();
  });
});
