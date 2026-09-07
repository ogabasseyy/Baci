import { expect, it } from 'vitest';
import { cryptoAddressStatusSchema } from './crypto-address-status';

it.each([
  null,
  { address: 'wallet', chain: 'TRX', currency: 'USDT' },
])('accepts a pending or complete status: %j', (crypto_address) => {
  const result = cryptoAddressStatusSchema.safeParse({
    success: true,
    crypto_address,
  });
  expect(result.success).toBe(true);
});
it('rejects a missing status address field', () => {
  const result = cryptoAddressStatusSchema.safeParse({ success: true });
  expect(result.success).toBe(false);
});
