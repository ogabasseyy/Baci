import { describe, expect, it } from 'vitest';
import { merchantShipQuote } from './delivery-quote-test-fixtures';
import { getMerchantRateId } from './get-merchant-rate-id';

describe('getMerchantRateId', () => {
  it('recovers the bare rate id for the order POST, null for carrier quotes', () => {
    expect(getMerchantRateId(merchantShipQuote.id)).toBe(
      '9f1b2c3d-0000-4000-8000-000000000001',
    );
    expect(getMerchantRateId('door-1')).toBeNull();
    expect(getMerchantRateId('')).toBeNull();
    expect(getMerchantRateId('mrate_')).toBeNull();
  });
});
