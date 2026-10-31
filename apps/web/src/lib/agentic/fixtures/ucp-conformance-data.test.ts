// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  LINE_MINOR,
  MAJOR_PRICE,
  MERCHANT,
  UNIT_MINOR,
} from './ucp-conformance-data';

describe('UCP conformance data', () => {
  it('prices one unit at N39.98 so a rounding bug shows in minor units', () => {
    expect(MAJOR_PRICE).toBe(39.98);
    expect(UNIT_MINOR).toBe(Math.round(MAJOR_PRICE * 100));
    expect(LINE_MINOR).toBe(UNIT_MINOR * 2);
    expect(Number.isInteger(UNIT_MINOR)).toBe(true);
  });

  it('describes a Paystack merchant that offers pay on delivery', () => {
    expect(MERCHANT.slug).toBe('ogabassey');
    expect(MERCHANT.feature_settings).toEqual({
      pay_on_delivery_enabled: true,
    });
    expect(MERCHANT.paystack_subaccount_code).toBeTruthy();
  });
});
