import { describe, expect, it } from 'vitest';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { validateRedvaultRequest } from './validate-redvault-request';

const input = {
  merchantId: OGABASSEY_MERCHANT_ID,
  hasVoucherItem: false,
  idempotencyKey: 'checkout-1',
};
describe('REDVAULT request guard', () => {
  it('accepts an isolated merchant checkout with a retry key', () =>
    expect(validateRedvaultRequest(input)).toBeNull());
  it.each([
    { merchantId: 'other' },
    { idempotencyKey: null },
    { idempotencyKey: '   ' },
    { useWallet: true },
    { useSavings: true },
    { hasVoucherItem: true },
    { discountCode: 'ANY' },
  ])('rejects unsupported or incomplete requests before side effects', (override) =>
    expect(validateRedvaultRequest({ ...input, ...override })).not.toBeNull());
});
