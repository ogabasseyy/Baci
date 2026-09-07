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
it.each([
  ['ethereum', 'ETH'],
  ['polygon', 'MATIC'],
  ['tron', 'TRX'],
  ['avalanche', 'AVAXC'],
  [' ETH ', 'ETH'],
])('normalizes provider chain %s to %s', (chain, expected) => {
  const result = cryptoAddressStatusSchema.safeParse({
    success: true,
    status: 'CANCELLED',
    crypto_address: { address: 'wallet', chain, currency: 'USDT' },
  });
  expect(result.success).toBe(true);
  if (result.success)
    expect(result.data).toMatchObject({
      status: 'cancelled',
      crypto_address: { chain: expected },
    });
});
it('rejects unsupported provider networks', () => {
  const result = cryptoAddressStatusSchema.safeParse({
    success: true,
    crypto_address: { address: 'wallet', chain: 'bitcoin', currency: 'USDT' },
  });
  expect(result.success).toBe(false);
});
